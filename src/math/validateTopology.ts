import type { CircuitElement, CircuitSimulationResults, CircuitWire, TransientSettings } from '../types';
import { buildCircuitGraph } from './circuitSolver';
import { sourceValue } from './linearTransient';
import { solveTopologyTransient } from './topologyTransient';

/** Independently checks KCL and each configured device equation at every sample. */
export function validateTopologySimulation(elements: CircuitElement[], wires: CircuitWire[], settings: TransientSettings, result: CircuitSimulationResults) {
  const fail = (message: string) => ({ status: 'failed' as const, messages: [message] });
  const time = result.time;
  if (time.length < 2 || time[0] !== 0 || !time.every((t, k) => Number.isFinite(t) && (!k || t > time[k - 1])) || Math.abs(time.at(-1)! - settings.tMax) > settings.tMax * 1e-10) return fail('Неверная временная шкала расчёта.');
  if (!Object.keys(result.signals).length) return fail('Нет выбранных сигналов для проверки.');
  for (const [name, values] of Object.entries({ ...result.nodeVoltages, ...result.branchCurrents, ...result.signals })) {
    if (values.length !== time.length || !values.every(Number.isFinite)) return fail(`${name}: неполный ряд, NaN или бесконечность.`);
  }
  const graph = buildCircuitGraph(elements, wires);
  const active = elements.filter(e => !['GND', 'PORT', 'JUNCTION', 'TEXT'].includes(e.type) && !e.isolation);
  const pin = (e: CircuitElement, id: string) => graph.pinToNode.get(`${e.id}_${id}`)!;
  const v = (n: number, k: number) => result.nodeVoltages[`node_${n}`]?.[k];
  const eps = settings.eps;
  if (!Number.isFinite(eps) || eps <= 0 || eps >= 1) return fail('EPS должен быть больше 0 и меньше 1.');
  let maxKcl = 0, maxLaw = 0;
  for (let k = 0; k < time.length; k++) {
    const balance = new Map<number, number>(), magnitude = new Map<number, number>();
    for (const e of active) {
      const p = pin(e, e.type === 'OPAMP' ? 'out' : '1'), m = e.type === 'OPAMP' ? 0 : pin(e, '2');
      const vp = v(p, k), vm = v(m, k), i = result.branchCurrents[e.name]?.[k];
      if (![vp, vm, i].every(Number.isFinite)) return fail(`${e.name}: нет напряжения узла или тока ветви.`);
      const u = vp - vm;
      for (const [node, sign] of [[p, 1], [m, -1]]) {
        balance.set(node, (balance.get(node) ?? 0) + sign * i);
        magnitude.set(node, (magnitude.get(node) ?? 0) + Math.abs(i));
      }
      let actual = i, expected = i, absolute = 1e-8;
      if (e.type === 'R') expected = u / e.value;
      else if (e.type === 'I_DC') expected = e.value;
      else if (e.type.startsWith('V_')) { actual = u; expected = sourceValue(e, time[k]); absolute = 1e-6; }
      else if (e.type === 'C') {
        if (!k) { actual = u; expected = e.initialCondition ?? 0; absolute = 1e-6; }
        else expected = e.value * (u - (v(p, k - 1) - v(m, k - 1))) / (time[k] - time[k - 1]);
      } else if (e.type === 'L') {
        if (!k) expected = e.initialCondition ?? 0;
        else { actual = u; expected = e.value * (i - result.branchCurrents[e.name][k - 1]) / (time[k] - time[k - 1]); absolute = 1e-6; }
      } else if (e.type === 'DIODE' || e.type === 'THYRISTOR') {
        const vf = e.modelParams?.forwardVoltage ?? (e.value > 0 ? e.value : 0.7), ron = e.modelParams?.onResistance ?? 0.01, roff = e.modelParams?.offResistance ?? 1e9;
        const on = (u - vf) / ron, off = u / roff;
        expected = Math.abs(i - on) < Math.abs(i - off) ? on : off;
      } else if (e.type === 'SWITCH') {
        const gate = v(pin(e, 'gate'), k) - vm;
        const resistance = gate >= (e.modelParams?.gateThreshold ?? 2.5) ? e.modelParams?.onResistance ?? 0.01 : e.modelParams?.offResistance ?? 1e9;
        expected = u / resistance;
      } else if (e.type === 'OPAMP') {
        const drive = e.value * (v(pin(e, 'in_pos'), k) - v(pin(e, 'in_neg'), k));
        const limit = e.modelParams?.outputLimit ?? 15;
        actual = u; expected = Math.max(-limit, Math.min(limit, drive)); absolute = 1e-6;
      }
      const residual = Math.abs(actual - expected) / (absolute + eps * Math.max(Math.abs(actual), Math.abs(expected)));
      if (residual > maxLaw) maxLaw = residual;
    }
    for (const [node, sum] of balance) maxKcl = Math.max(maxKcl, Math.abs(sum) / (1e-8 + eps * (magnitude.get(node) ?? 0)));
  }
  if (maxLaw > 1 || maxKcl > 1) return fail(`Нарушены уравнения схемы: закон элемента ${maxLaw.toPrecision(3)} × допуск, баланс узлов ${maxKcl.toPrecision(3)} × допуск.`);
  const messages = [`Проверены ${time.length} точек: баланс токов Кирхгофа и уравнения всех элементов выполняются в допуске EPS=${eps}.`];
  if (time.length <= 10001) {
    try {
      const refined = solveTopologyTransient(elements, wires, { ...settings, step: settings.tMax / (2 * (time.length - 1)) });
      let worst = 0, worstName = '';
      for (const [group, refinedGroup] of [[result.signals, refined.signals], [result.nodeVoltages, refined.nodeVoltages], [result.branchCurrents, refined.branchCurrents]] as const) {
        for (const [name, values] of Object.entries(group)) {
          const reference = refinedGroup[name];
          if (!reference) return fail(`Нет контрольного ряда ${name}.`);
          const peak = reference.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
          const absolute = group === result.branchCurrents || /^I\(/i.test(name) ? 1e-8 : 1e-6;
          let j = 0;
          for (let k = 0; k < time.length; k++) {
            while (j + 1 < refined.time.length - 1 && refined.time[j + 1] < time[k]) j++;
            const fraction = (time[k] - refined.time[j]) / (refined.time[j + 1] - refined.time[j]);
            const fineValue = reference[j] + fraction * (reference[j + 1] - reference[j]);
            const ratio = Math.abs(values[k] - fineValue) / (absolute + eps * peak);
            if (ratio > worst) { worst = ratio; worstName = name; }
          }
        }
      }
      messages.push(`Повторный расчёт с шагом вдвое меньше: максимальное расхождение ${worst.toPrecision(3)} × допуск (${worstName}).`);
      if (worst > 1) return { status: 'failed' as const, messages: [...messages, 'Уменьшите шаг времени и повторите расчёт: сетка недостаточно точна для этого процесса.'] };
    } catch (error) { return fail(`Контрольный расчёт с меньшим шагом не выполнен: ${error instanceof Error ? error.message : 'ошибка'}`); }
  } else messages.push('Повторный расчёт с меньшим шагом пропущен из-за ограничения в 20 000 шагов; оценка точности временной сетки не выполнена.');
  return { status: 'passed' as const, messages: [
    ...messages,
    'Проверка подтверждает согласованность расчёта с выбранной идеализированной моделью. Она не подтверждает паспортную точность реального диода, ключа, тиристора или ОУ.',
  ] };
}
