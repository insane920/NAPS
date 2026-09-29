import type { CircuitElement, CircuitSimulationResults, CircuitWire, TransientSettings } from '../types';
import { buildCircuitGraph, getCircuitPinIds } from './circuitSolver';
import { solveDenseSystem, sourceValue } from './linearTransient';
import { createMnaMatrix } from './mnaCore';
import { digitalModel, digitalOutputPins, digitalTypes, evaluateDigital, inputLogic, type DigitalEvent, type Logic } from './digitalEvents';

/** Models supported by the topology-based transient solver. Other symbols are editor-only. */
export const topologyTypes = new Set([
  'R', 'L', 'C', 'V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'DIODE',
  'SWITCH', 'THYRISTOR', 'OPAMP', 'TR3', 'GND', 'PORT', 'JUNCTION', 'TEXT', ...digitalTypes,
]);

type State = -1 | 0 | 1;
type Model = { vf: number; ron: number; roff: number; gate: number; hold: number; gain: number; limit: number };
const passive = new Set(['GND', 'PORT', 'JUNCTION', 'TEXT']);

function modelOf(e: CircuitElement): Model {
  const p = e.modelParams;
  const model = {
    vf: p?.forwardVoltage ?? (e.value > 0 ? e.value : 0.7),
    ron: p?.onResistance ?? 0.01,
    roff: p?.offResistance ?? 1e9,
    gate: p?.gateThreshold ?? 2.5,
    hold: p?.holdingCurrent ?? 0.01,
    gain: e.value,
    limit: p?.outputLimit ?? 15,
  };
  const positive = (v: number, label: string) => {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`${e.name}: ${label} должно быть положительным конечным числом.`);
  };
  if (e.type === 'DIODE' || e.type === 'THYRISTOR') {
    if (!Number.isFinite(model.vf) || model.vf < 0) throw new Error(`${e.name}: пороговое напряжение не может быть отрицательным.`);
    positive(model.ron, 'сопротивление открытого состояния');
    positive(model.roff, 'сопротивление закрытого состояния');
  }
  if (e.type === 'SWITCH') {
    positive(model.ron, 'сопротивление открытого состояния');
    positive(model.roff, 'сопротивление закрытого состояния');
  }
  if (e.type === 'SWITCH' || e.type === 'THYRISTOR') {
    if (!Number.isFinite(model.gate)) throw new Error(`${e.name}: неверный порог управления.`);
  }
  if (e.type === 'THYRISTOR' && (!Number.isFinite(model.hold) || model.hold < 0)) throw new Error(`${e.name}: ток удержания не может быть отрицательным.`);
  if (e.type === 'OPAMP') { positive(model.gain, 'коэффициент усиления'); positive(model.limit, 'предел выхода'); }
  return model;
}

/**
 * Topology-based MNA with backward Euler for C/L and an active-set iteration for
 * piecewise-linear devices. Current is positive from pin 1 (anode) to pin 2.
 * A diode/thyristor is a Vf + Ron branch when conducting and Roff when blocked.
 * The controlled switch is Ron/Roff according to V(gate)-V(pin 2). The op-amp
 * is a zero-input-current VCVS with finite gain and symmetric output clipping.
 * These explicit idealised models are not manufacturer device models.
 */
export function solveTopologyTransient(elements: CircuitElement[], wires: CircuitWire[], settings: TransientSettings): CircuitSimulationResults {
  const started = performance.now();
  const unsupported = [...new Set(elements.filter(e => !topologyTypes.has(e.type)).map(e => e.type))];
  if (unsupported.length) throw new Error(`Нет расчётной модели для: ${unsupported.join(', ')}.`);
  if (!Number.isFinite(settings.tMax) || !Number.isFinite(settings.step) || settings.tMax <= 0 || settings.step <= 0) throw new Error('Укажите положительные конечное время и шаг.');
  const count = Math.ceil(settings.tMax / settings.step);
  if (!Number.isFinite(count) || count > 20000) throw new Error('Более 20 000 шагов. Увеличьте шаг или уменьшите интервал расчёта.');
  if (!elements.some(e => e.type === 'GND')) throw new Error('Добавьте землю GND для задания нулевого потенциала.');
  const ids = new Set(elements.map(e => e.id));
  if (ids.size !== elements.length) throw new Error('Идентификаторы элементов должны быть уникальными.');
  const byId = new Map(elements.map(e => [e.id, e]));
  const active = elements.filter(e => !passive.has(e.type) && !e.isolation);
  const isolated = elements.filter(e => !passive.has(e.type) && e.isolation);
  if (!active.length) throw new Error('В схеме нет электрических компонентов.');
  if (new Set(elements.filter(e => !passive.has(e.type)).map(e => e.name.toUpperCase())).size !== elements.filter(e => !passive.has(e.type)).length) throw new Error('Имена электрических компонентов должны быть уникальными.');
  for (const wire of wires) for (const [id, pin] of [[wire.fromCompId, wire.fromPinId], [wire.toCompId, wire.toPinId]]) {
    const element = byId.get(id);
    if (!element || !getCircuitPinIds(element.type).includes(pin)) throw new Error('Провод ссылается на отсутствующий элемент или вывод.');
  }
  for (const e of active) {
    if ((e.type === 'SWITCH' || e.type === 'THYRISTOR') && !wires.some(w => (w.fromCompId === e.id && w.fromPinId === 'gate') || (w.toCompId === e.id && w.toPinId === 'gate'))) {
      throw new Error(`${e.name}: подключите управляющий вывод gate к источнику управления.`);
    }
    if (!Number.isFinite(e.value) || (['R', 'L', 'C', 'OPAMP', 'TR3'].includes(e.type) && e.value <= 0)) throw new Error(`${e.name}: недопустимый номинал.`);
    if (e.type === 'TR3') {
      const ratio = e.modelParams?.turnsRatio ?? e.secondaryValue ?? 1;
      const coupling = e.modelParams?.couplingFactor ?? 0.999;
      if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(coupling) || coupling <= 0 || coupling >= 1) throw new Error(`${e.name}: коэффициент трансформации должен быть > 0, связь — от 0 до 1 (не включая 1).`);
    }
    if (e.initialCondition !== undefined && !Number.isFinite(e.initialCondition)) throw new Error(`${e.name}: неверное начальное условие.`);
    if (['V_AC', 'V_PULSE'].includes(e.type) && (!Number.isFinite(e.secondaryValue ?? 50) || (e.secondaryValue ?? 50) <= 0)) throw new Error(`${e.name}: частота должна быть положительной.`);
    if (e.type === 'V_PULSE' && ((e.initialCondition ?? 0.5) < 0 || (e.initialCondition ?? 0.5) > 1)) throw new Error(`${e.name}: коэффициент заполнения должен быть от 0 до 1.`);
  }
  const graph = buildCircuitGraph(elements, wires);
  const pin = (e: CircuitElement, id: string) => graph.pinToNode.get(`${e.id}_${id}`)!;
  const used = [...new Set(active.flatMap(e => getCircuitPinIds(e.type).map(id => pin(e, id))))].filter(n => n !== 0);
  const nodeIndex = new Map(used.map((n, i) => [n, i]));
  const models = new Map(active.map(e => [e.id, modelOf(e)]));
  const state = new Map<string, State>();
  for (const e of active) if (['DIODE', 'SWITCH', 'THYRISTOR', 'OPAMP'].includes(e.type)) state.set(e.id, 0);
  const time = Array.from({ length: count + 1 }, (_, k) => k * settings.tMax / count);
  // Pulse edges must be included even if the user's nominal step is longer than a pulse.
  for (const e of active.filter(e => e.type === 'V_PULSE')) {
    const period = 1 / (e.secondaryValue ?? 50), duty = e.initialCondition ?? 0.5;
    for (let n = 0; n * period <= settings.tMax && time.length < 20000; n++) {
      for (const edge of [n * period, (n + duty) * period]) {
        if (edge > 0 && edge < settings.tMax) time.push(edge);
      }
    }
  }
  time.sort((a, b) => a - b);
  for (let i = time.length - 1; i > 0; i--) if (time[i] - time[i - 1] <= 1e-13 * Math.max(1, time[i])) time.splice(i, 1);
  if (time.length > 20000) throw new Error('Более 20 000 точек с учётом фронтов импульсов.');
  const nodeVoltages: Record<string, number[]> = { node_0: [] };
  for (const n of used) nodeVoltages[`node_${n}`] = [];
  const branchCurrents: Record<string, number[]> = {};
  const voltages: Record<string, number[]> = {};
  for (const e of [...active, ...isolated]) { branchCurrents[e.name] = []; voltages[e.name] = []; if (e.type === 'TR3') branchCurrents[`${e.name}:secondary`] = []; }
  const digitalElements = active.filter(e => digitalTypes.has(e.type));
  const digitalModels = new Map(digitalElements.map(e => [e.id, digitalModel(e)]));
  const logic = new Map<string, Logic>(digitalElements.map(e => [e.id, e.initialCondition === 1 ? 1 : 0]));
  const previousClock = new Map<string, Logic>(digitalElements.filter(e => e.type === 'D_FF' || e.type === 'JK_FF').map(e => [e.id, 0]));
  const events: DigitalEvent[] = [];
  const digitalStates: NonNullable<CircuitSimulationResults['digitalStates']> = Object.fromEntries(digitalElements.map(e => [e.name, []]));

  for (let k = 0; k < time.length; k++) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].time <= time[k] + 1e-13 * Math.max(1, time[k])) {
        logic.set(events[i].elementId, events[i].value); events.splice(i, 1);
      }
    }
    const stepStartLogic = new Map(logic);
    const initial = k === 0, dt = initial ? 0 : time[k] - time[k - 1];
    const extra = active.filter(e => e.type.startsWith('V_') || e.type === 'OPAMP' || e.type === 'TR3' || (initial ? e.type === 'C' : e.type === 'L'));
    const size = used.length + extra.length + active.filter(e => e.type === 'TR3').length;
    if (size > 160) throw new Error('Схема слишком велика для текущего решателя (более 160 неизвестных).');
    const extraIndex = new Map(extra.map((e, i) => [e.id, used.length + i]));
    const secondaryIndex = new Map(active.filter(e => e.type === 'TR3').map((e, i) => [e.id, used.length + extra.length + i]));
    let solution: number[] = [];
    let converged = false;
    const blockedThyristors = new Set<string>();
    for (let iteration = 0; iteration < 40; iteration++) {
      const { a, b, add, current: stampI, conductance: stampG, voltage: addVoltage } = createMnaMatrix(size);
      const idx = (n: number) => n === 0 ? undefined : nodeIndex.get(n);
      const stampV = (e: CircuitElement, p: number | undefined, m: number | undefined, value: number) => {
        const q = extraIndex.get(e.id)!;
        addVoltage(p, m, q, value);
      };
      for (const e of active) {
        const p = idx(pin(e, e.type === 'OPAMP' ? 'out' : '1'));
        const m = idx(e.type === 'OPAMP' ? 0 : pin(e, '2'));
        const mod = models.get(e.id)!;
        if (e.type === 'R') stampG(p, m, 1 / e.value);
        else if (e.type === 'I_DC') stampI(p, m, e.value);
        else if (e.type === 'C') {
          if (initial) stampV(e, p, m, e.initialCondition ?? 0);
          else { const g = e.value / dt; stampG(p, m, g, -g * voltages[e.name][k - 1]); }
        } else if (e.type === 'L') {
          if (initial) stampI(p, m, e.initialCondition ?? 0);
          else {
            stampV(e, p, m, 0);
            const q = extraIndex.get(e.id)!;
            a[q][q] = -e.value / dt;
            b[q] = -e.value / dt * branchCurrents[e.name][k - 1];
          }
        } else if (e.type.startsWith('V_')) stampV(e, p, m, sourceValue(e, time[k]));
        else if (e.type === 'TR3') {
          const q1 = extraIndex.get(e.id)!;
          const q2 = secondaryIndex.get(e.id)!;
          const p2 = idx(pin(e, '3')), m2 = idx(pin(e, '4'));
          // Dot convention: pins 1 and 3 have the same instantaneous polarity.
          add(p, q1, 1); add(m, q1, -1); add(p2, q2, 1); add(m2, q2, -1);
          if (initial) {
            a[q1][q1] = 1; a[q2][q2] = 1;
            b[q1] = e.initialCondition ?? 0; b[q2] = 0;
          } else {
            const ratio = e.modelParams?.turnsRatio ?? e.secondaryValue ?? 1;
            const l1 = e.value, l2 = l1 * ratio * ratio;
            const mutual = (e.modelParams?.couplingFactor ?? 0.999) * Math.sqrt(l1 * l2);
            add(q1, p, 1); add(q1, m, -1); add(q2, p2, 1); add(q2, m2, -1);
            add(q1, q1, -l1 / dt); add(q1, q2, -mutual / dt);
            add(q2, q1, -mutual / dt); add(q2, q2, -l2 / dt);
            const previousPrimary = branchCurrents[e.name][k - 1];
            const previousSecondary = branchCurrents[`${e.name}:secondary`][k - 1];
            b[q1] = -(l1 * previousPrimary + mutual * previousSecondary) / dt;
            b[q2] = -(mutual * previousPrimary + l2 * previousSecondary) / dt;
          }
        }
        else if (digitalTypes.has(e.type)) {
          const model = digitalModels.get(e.id)!;
          const q = logic.get(e.id)!;
          for (const output of digitalOutputPins(e.type)) {
            const level = output === '4' && q !== 'X' ? (q === 0 ? 1 : 0) : q;
            const conduct = level === 'X' ? 1e-12 : 1 / model.resistance;
            const target = level === 'X' ? 0 : level === 1 ? model.high : model.low;
            stampG(idx(pin(e, output)), undefined, conduct, -conduct * target);
          }
        }
        else if (e.type === 'DIODE' || e.type === 'THYRISTOR') {
          const on = state.get(e.id) === 1;
          stampG(p, m, on ? 1 / mod.ron : 1 / mod.roff, on ? -mod.vf / mod.ron : 0);
        } else if (e.type === 'SWITCH') stampG(p, m, 1 / (state.get(e.id) === 1 ? mod.ron : mod.roff));
        else if (e.type === 'OPAMP') {
          const q = extraIndex.get(e.id)!;
          add(p, q, 1); add(q, p, 1);
          const saturation = state.get(e.id)!;
          if (saturation) b[q] = saturation * mod.limit;
          else {
            add(q, idx(pin(e, 'in_neg')), mod.gain);
            add(q, idx(pin(e, 'in_pos')), -mod.gain);
          }
        }
      }
      try { solution = solveDenseSystem(a, b); }
      catch (error) { throw new Error(`t=${time[k]} с: ${error instanceof Error ? error.message : 'не удалось решить систему'}`); }
      const potential = (n: number) => n === 0 ? 0 : solution[nodeIndex.get(n)!];
      let changes = 0;
      for (const e of active) {
        const mod = models.get(e.id)!;
        const before = state.get(e.id);
        let after = before;
        if (e.type === 'DIODE') {
          const u = potential(pin(e, '1')) - potential(pin(e, '2'));
          after = u > mod.vf + 1e-9 || (before === 1 && u >= mod.vf - 1e-9) ? 1 : 0;
        } else if (e.type === 'SWITCH') {
          const gate = potential(pin(e, 'gate')) - potential(pin(e, '2'));
          after = gate >= mod.gate ? 1 : 0;
        } else if (e.type === 'THYRISTOR') {
          const u = potential(pin(e, '1')) - potential(pin(e, '2'));
          const gate = potential(pin(e, 'gate')) - potential(pin(e, '2'));
          const current = before === 1 ? (u - mod.vf) / mod.ron : u / mod.roff;
          if (before === 1 && current < mod.hold) blockedThyristors.add(e.id);
          after = blockedThyristors.has(e.id) ? 0 : (before === 1 && current >= mod.hold) || (gate >= mod.gate && u > mod.vf) ? 1 : 0;
        } else if (e.type === 'OPAMP') {
          const drive = mod.gain * (potential(pin(e, 'in_pos')) - potential(pin(e, 'in_neg')));
          after = drive > mod.limit + 1e-9 ? 1 : drive < -mod.limit - 1e-9 ? -1 : 0;
        }
        if (after !== before) { state.set(e.id, after!); changes++; }
      }
      for (const e of digitalElements) {
        const model = digitalModels.get(e.id)!;
        const before = logic.get(e.id)!;
        const desired = evaluateDigital(e, p => potential(pin(e, p)), e.type === 'JK_FF' ? stepStartLogic.get(e.id)! : before, previousClock.get(e.id) ?? 0, model);
        if (model.delay === 0) {
          if (desired !== before) { logic.set(e.id, desired); changes++; }
        } else {
          const old = events.find(event => event.elementId === e.id);
          if (desired === before) {
            if (old) events.splice(events.indexOf(old), 1);
          } else if (!old || old.value !== desired) {
            if (old) events.splice(events.indexOf(old), 1);
            const due = time[k] + model.delay;
            if (due <= settings.tMax) {
              events.push({ elementId: e.id, time: due, value: desired });
              if (due > time[k] && !time.some(t => Math.abs(t - due) <= 1e-13 * Math.max(1, due))) {
                let insert = k + 1;
                while (insert < time.length && time[insert] < due) insert++;
                time.splice(insert, 0, due);
                if (time.length > 20000) throw new Error('Более 20 000 точек с учётом цифровых событий.');
              }
            }
          }
        }
      }
      if (!changes) { converged = true; break; }
    }
    if (!converged) throw new Error(`t=${time[k]} с: состояния нелинейных элементов не сошлись за 40 итераций. Уменьшите шаг или проверьте соединения и параметры.`);
    const potential = (n: number) => n === 0 ? 0 : solution[nodeIndex.get(n)!];
    nodeVoltages.node_0.push(0);
    for (const n of used) nodeVoltages[`node_${n}`].push(potential(n));
    for (const e of digitalElements) {
      digitalStates[e.name].push(logic.get(e.id)!);
      if (previousClock.has(e.id)) previousClock.set(e.id, inputLogic(potential(pin(e, e.type === 'D_FF' ? '2' : 'clk')), digitalModels.get(e.id)!));
    }
    for (const e of active) {
      const mod = models.get(e.id)!;
      const output = digitalOutputPins(e.type)[0];
      const u = output ? potential(pin(e, output)) : e.type === 'OPAMP' ? potential(pin(e, 'out')) : potential(pin(e, '1')) - potential(pin(e, '2'));
      let current = 0;
      if (extraIndex.has(e.id)) current = solution[extraIndex.get(e.id)!];
      else if (e.type === 'R') current = u / e.value;
      else if (e.type === 'I_DC') current = e.value;
      else if (e.type === 'L') current = e.initialCondition ?? 0;
      else if (e.type === 'C') current = e.value * (u - voltages[e.name][k - 1]) / dt;
      else if (e.type === 'DIODE' || e.type === 'THYRISTOR') current = state.get(e.id) === 1 ? (u - mod.vf) / mod.ron : u / mod.roff;
      else if (e.type === 'SWITCH') current = u / (state.get(e.id) === 1 ? mod.ron : mod.roff);
      else if (output) {
        const q = logic.get(e.id)!;
        const model = digitalModels.get(e.id)!;
        current = q === 'X' ? 0 : ((q === 1 ? model.high : model.low) - u) / model.resistance;
      }
      voltages[e.name].push(u); branchCurrents[e.name].push(current);
      if (e.type === 'TR3') branchCurrents[`${e.name}:secondary`].push(solution[secondaryIndex.get(e.id)!]);
    }
    for (const e of isolated) {
      const first = graph.pinToNode.get(`${e.id}_1`), second = graph.pinToNode.get(`${e.id}_2`);
      const u = first === undefined || second === undefined ? NaN : (first === 0 || nodeIndex.has(first)) && (second === 0 || nodeIndex.has(second)) ? potential(first) - potential(second) : NaN;
      voltages[e.name].push(u); branchCurrents[e.name].push(0);
      if (e.type === 'TR3') branchCurrents[`${e.name}:secondary`].push(0);
    }
  }
  for (const [name, n] of graph.namedNodes) if (nodeVoltages[`node_${n}`]) nodeVoltages[name] = nodeVoltages[`node_${n}`];
  const signals: Record<string, number[]> = {};
  const stats: CircuitSimulationResults['summary']['stats'] = {};
  for (const sig of settings.signals.filter(s => s.enabled)) {
    if (sig.exprX.trim().toLowerCase() !== 't') throw new Error('Для переходного процесса ось X должна быть t.');
    const match = sig.exprY.trim().match(/^([UIP])\(([^)]+)\)$/i);
    if (!match) throw new Error(`Неподдерживаемое выражение: ${sig.exprY}. Используйте U(...), I(...) или P(...).`);
    const kind = match[1].toUpperCase(), target = match[2].trim().toUpperCase();
    const e = [...active, ...isolated].find(item => item.name.toUpperCase() === target);
    const n = graph.namedNodes.get(target) ?? (/^\d+$/.test(target) ? Number(target) : undefined);
    let values = kind === 'U' ? (n !== undefined ? nodeVoltages[`node_${n}`] : e ? voltages[e.name] : undefined) : e ? branchCurrents[e.name] : undefined;
    if (kind === 'I' && !values) values = Object.entries(branchCurrents).find(([name]) => name.toUpperCase() === target)?.[1];
    if (kind === 'P' && e) values = voltages[e.name].map((u, i) => u * branchCurrents[e.name][i]);
    if (!values) throw new Error(`Не найден сигнал ${sig.exprY}. Проверьте имя компонента, порта или номер узла.`);
    if (values.some(value => !Number.isFinite(value))) throw new Error(`${sig.exprY}: потенциал не определён.`);
    signals[sig.exprY] = values;
    let integral = 0, squareIntegral = 0;
    for (let i = 1; i < time.length; i++) {
      const a = values[i - 1], b = values[i], h = time[i] - time[i - 1];
      integral += h * (a + b) / 2;
      squareIntegral += h * (a * a + a * b + b * b) / 3;
    }
    stats[sig.exprY] = { mean: integral / settings.tMax, rms: Math.sqrt(squareIntegral / settings.tMax), min: Math.min(...values), max: Math.max(...values), unit: kind === 'I' ? 'А' : kind === 'P' ? 'Вт' : 'В' };
  }
  const durationMs = performance.now() - started;
  return { time, signals, nodeVoltages, branchCurrents, elementVoltages: voltages, digitalStates, model: 'topology-mna', summary: { durationMs, calculationTimeMs: durationMs, pointsCount: time.length, stats } };
}
