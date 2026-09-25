import type { CircuitElement, CircuitWire, CircuitSimulationResults, TransientSettings } from '../types';
import { buildCircuitGraph } from './circuitSolver';
import { electricalElements, isLinearCircuit, linearTypes, solveLinearTransient, sourceValue } from './linearTransient';

export interface ValidationReport { status: 'passed' | 'failed' | 'unsupported'; messages: string[]; }
export function validateSimulation(elements: CircuitElement[], wires: CircuitWire[], settings: TransientSettings, result: CircuitSimulationResults): ValidationReport {
  const messages: string[] = [];
  const fail = (message: string): ValidationReport => ({ status: 'failed', messages: [...messages, message] });
  if (!isLinearCircuit(elements) || result.model !== 'linear-mna' || result.isAC || result.sweepInfo) {
    const types = [...new Set(elements.filter(e => !linearTypes.has(e.type)).map(e => e.type))];
    return { status: 'unsupported', messages: [`Точность не подтверждена. ${types.length ? `Нет проверяемой модели для: ${types.join(', ')}.` : 'Этот режим расчёта пока не поддерживается проверкой.'}`, 'Доступна проверка линейных цепей R, L, C и независимых источников. Старые упрощённые модели могут не учитывать реальные соединения.'] };
  }
  const time = result.time;
  if (time.length < 2 || time[0] !== 0 || !time.every((t, k) => Number.isFinite(t) && (!k || t > time[k - 1])) || Math.abs(time.at(-1)! - settings.tMax) > settings.tMax * 1e-10) return fail('Неверная временная сетка или интервал расчёта.');
  if (!Object.keys(result.signals).length) return fail('Нет выбранных сигналов для проверки графика.');
  for (const [name, values] of Object.entries({ ...result.nodeVoltages, ...result.branchCurrents, ...result.signals })) {
    if (values.length !== time.length || !values.every(Number.isFinite)) return fail(`${name}: неверное число точек, NaN или бесконечность.`);
  }
  messages.push(`Данные: ${time.length} точек; временная сетка и числовые значения корректны.`);
  const largestStep = Math.max(...time.slice(1).map((t, k) => t - time[k]));
  for (const e of elements.filter(e => e.type === 'V_AC' || e.type === 'V_PULSE')) {
    const period = 1 / (e.secondaryValue ?? 50);
    const duty = e.initialCondition ?? 0.5;
    const shortest = e.type === 'V_PULSE' && duty > 0 && duty < 1 ? period * Math.min(duty, 1 - duty) : period;
    if (largestStep > shortest / 20 * (1 + 1e-10)) return fail(`${e.name}: шаг слишком велик для частоты источника. Нужно не менее 20 точек на период, а для импульса — на его кратчайшую фазу. Уменьшите шаг.`);
  }
  const graph = buildCircuitGraph(elements, wires);
  const branches = electricalElements(elements);
  const eps = settings.eps;
  if (!Number.isFinite(eps) || eps <= 0 || eps >= 1) return fail('EPS должен быть больше 0 и меньше 1.');
  let maxKcl = 0, maxLaw = 0;
  for (let k = 0; k < time.length; k++) {
    const balances = new Map<number, number>(), magnitudes = new Map<number, number>();
    for (const e of branches) {
      const p = graph.pinToNode.get(`${e.id}_1`)!, m = graph.pinToNode.get(`${e.id}_2`)!;
      const up = result.nodeVoltages[`node_${p}`]?.[k], um = result.nodeVoltages[`node_${m}`]?.[k];
      const i = result.branchCurrents[e.name]?.[k];
      if (![up, um, i].every(Number.isFinite)) return fail(`${e.name}: отсутствуют напряжения узлов или ток ветви.`);
      const u = up - um;
      for (const [n, sign] of [[p, 1], [m, -1]]) { balances.set(n, (balances.get(n) ?? 0) + sign * i); magnitudes.set(n, (magnitudes.get(n) ?? 0) + Math.abs(i)); }
      let actual = i, expected = i, absolute = 1e-8;
      if (e.type === 'R') expected = u / e.value;
      else if (e.type === 'I_DC') expected = e.value;
      else if (e.type.startsWith('V_')) { actual = u; expected = sourceValue(e, time[k]); absolute = 1e-6; }
      else if (e.type === 'C') {
        if (!k) { actual = u; expected = e.initialCondition ?? 0; absolute = 1e-6; }
        else { const prevU = result.nodeVoltages[`node_${p}`][k - 1] - result.nodeVoltages[`node_${m}`][k - 1]; expected = e.value * (u - prevU) / (time[k] - time[k - 1]); }
      } else if (e.type === 'L') {
        if (!k) expected = e.initialCondition ?? 0;
        else { actual = u; expected = e.value * (i - result.branchCurrents[e.name][k - 1]) / (time[k] - time[k - 1]); absolute = 1e-6; }
      }
      maxLaw = Math.max(maxLaw, Math.abs(actual - expected) / (absolute + eps * Math.max(Math.abs(actual), Math.abs(expected))));
    }
    for (const [n, balance] of balances) maxKcl = Math.max(maxKcl, Math.abs(balance) / (1e-8 + eps * magnitudes.get(n)!));
  }
  messages.push(`Баланс токов Кирхгофа: ${maxKcl <= 1 ? 'в допуске' : 'нарушен'}. Уравнения компонентов и начальные условия: ${maxLaw <= 1 ? 'в допуске' : 'нарушены'}.`);
  if (maxKcl > 1 || maxLaw > 1) return fail('График не прошёл проверку электрических уравнений.');
  try {
    const dt = settings.tMax / (time.length - 1);
    const fine = solveLinearTransient(elements, wires, { ...settings, step: dt / 2 });
    let worst = 0, worstName = '';
    // Compare every electrical variable, not only the visible curves. Interpolate
    // using actual times: a floating point ceil must not misalign sample indices.
    for (const [group, fineGroup] of [[result.signals, fine.signals], [result.nodeVoltages, fine.nodeVoltages], [result.branchCurrents, fine.branchCurrents]] as const) {
      for (const [name, values] of Object.entries(group)) {
        const reference = fineGroup[name];
        if (!reference) return fail(`Нет контрольного ряда ${name}.`);
        let error = 0, peak = 0, j = 0;
        for (let k = 0; k < time.length; k++) {
          while (j + 1 < fine.time.length - 1 && fine.time[j + 1] < time[k]) j++;
          const f = (time[k] - fine.time[j]) / (fine.time[j + 1] - fine.time[j]);
          const ref = reference[j] + f * (reference[j + 1] - reference[j]);
          error = Math.max(error, Math.abs(values[k] - ref)); peak = Math.max(peak, Math.abs(ref));
        }
        const absolute = group === result.branchCurrents || /^I\(/i.test(name) ? 1e-8 : 1e-6;
        const ratio = error / (absolute + eps * peak);
        if (ratio > worst) { worst = ratio; worstName = name; }
      }
    }
    messages.push(`Повторный расчёт с шагом вдвое меньше: ${worst <= 1 ? 'расхождение в допуске' : 'допуск превышен'}${worstName ? ` (${worstName}: ${worst.toPrecision(3)} × допуск)` : ''}. EPS = ${eps}; абсолютный допуск 1 мкВ / 10 нА (для мощности — 1 мкВт).`);
    if (worst > 1) return fail('Уменьшите шаг в настройках, пересчитайте график и повторите проверку.');
    messages.push('Численные проверки пройдены для идеальной линейной модели. Это оценка согласованности и сходимости, а не гарантия точности физической модели.');
    return { status: 'passed', messages };
  } catch (error) { return fail(`Контрольный расчёт не выполнен: ${error instanceof Error ? error.message : 'ошибка'}`); }
}
