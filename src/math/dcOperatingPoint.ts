import type { CircuitElement, CircuitWire } from '../types';
import { buildCircuitGraph, getCircuitPinIds } from './circuitSolver';
import { createMnaMatrix } from './mnaCore';
import { solveDenseSystem } from './linearTransient';

export type DeviceState = -1 | 0 | 1;
export interface OperatingPoint {
  potentials: Map<number, number>;
  states: Map<string, DeviceState>;
}
const passive = new Set(['GND', 'PORT', 'JUNCTION', 'TEXT']);

/** DC active-set operating point. Capacitors are open, inductors are shorts. */
export function solveDCOperatingPoint(elements: CircuitElement[], wires: CircuitWire[]): OperatingPoint {
  const active = elements.filter(e => !passive.has(e.type) && !e.isolation);
  const graph = buildCircuitGraph(elements, wires);
  const pin = (e: CircuitElement, p: string) => graph.pinToNode.get(`${e.id}_${p}`)!;
  const used = [...new Set(active.flatMap(e => getCircuitPinIds(e.type).map(p => pin(e, p))))].filter(n => n !== 0);
  const nodes = new Map(used.map((n, i) => [n, i]));
  const extras = active.flatMap(e => e.type === 'TR3' ? [`${e.id}:1`, `${e.id}:2`] : e.type.startsWith('V_') || e.type === 'L' || e.type === 'OPAMP' ? [e.id] : []);
  const extraIndex = new Map(extras.map((id, i) => [id, used.length + i]));
  const states = new Map<string, DeviceState>();
  for (const e of active) if (['DIODE', 'SWITCH', 'THYRISTOR', 'OPAMP'].includes(e.type)) states.set(e.id, 0);
  const idx = (n: number) => n === 0 ? undefined : nodes.get(n);
  let potentials = new Map<number, number>([[0, 0]]);
  for (let iteration = 0; iteration < 60; iteration++) {
    const { a, b, add, current, conductance, voltage } = createMnaMatrix(used.length + extras.length);
    for (const e of active) {
      const p = idx(pin(e, e.type === 'OPAMP' ? 'out' : '1'));
      const m = e.type === 'OPAMP' ? undefined : idx(pin(e, '2'));
      const params = e.modelParams;
      if (e.type === 'R') conductance(p, m, 1 / e.value);
      else if (e.type === 'I_DC') current(p, m, e.value);
      else if (e.type.startsWith('V_')) voltage(p, m, extraIndex.get(e.id)!, e.type === 'V_DC' ? e.value : 0);
      else if (e.type === 'L') voltage(p, m, extraIndex.get(e.id)!, 0);
      else if (e.type === 'TR3') {
        voltage(idx(pin(e, '1')), idx(pin(e, '2')), extraIndex.get(`${e.id}:1`)!, 0);
        voltage(idx(pin(e, '3')), idx(pin(e, '4')), extraIndex.get(`${e.id}:2`)!, 0);
      } else if (e.type === 'DIODE' || e.type === 'THYRISTOR') {
        const on = states.get(e.id) === 1;
        const ron = params?.onResistance ?? 0.01, roff = params?.offResistance ?? 1e9;
        const vf = params?.forwardVoltage ?? (e.value > 0 ? e.value : 0.7);
        conductance(p, m, 1 / (on ? ron : roff), on ? -vf / ron : 0);
      } else if (e.type === 'SWITCH') conductance(p, m, 1 / (states.get(e.id) === 1 ? params?.onResistance ?? 0.01 : params?.offResistance ?? 1e9));
      else if (e.type === 'OPAMP') {
        const q = extraIndex.get(e.id)!;
        voltage(p, undefined, q, 0);
        const saturated = states.get(e.id)!;
        if (saturated) b[q] = saturated * (params?.outputLimit ?? 15);
        else { add(q, idx(pin(e, 'in_neg')), e.value); add(q, idx(pin(e, 'in_pos')), -e.value); }
      }
    }
    let answer: number[];
    try { answer = solveDenseSystem(a, b); }
    catch (error) { throw new Error(`DC-рабочая точка: ${error instanceof Error ? error.message : 'система не решена'}`); }
    potentials = new Map([[0, 0], ...used.map((n, i) => [n, answer[i]] as [number, number])]);
    const u = (e: CircuitElement, p: string) => potentials.get(pin(e, p)) ?? 0;
    let changes = 0;
    for (const e of active) {
      const before = states.get(e.id);
      if (before === undefined) continue;
      const params = e.modelParams;
      let after: DeviceState = before;
      if (e.type === 'DIODE' || e.type === 'THYRISTOR') {
        const delta = u(e, '1') - u(e, '2');
        const vf = params?.forwardVoltage ?? (e.value > 0 ? e.value : 0.7);
        const forward = delta >= vf - 1e-9;
        if (e.type === 'DIODE') after = forward ? 1 : 0;
        else after = forward && u(e, 'gate') - u(e, '2') >= (params?.gateThreshold ?? 2.5) ? 1 : 0;
      } else if (e.type === 'SWITCH') after = u(e, 'gate') - u(e, '2') >= (params?.gateThreshold ?? 2.5) ? 1 : 0;
      else if (e.type === 'OPAMP') {
        const drive = e.value * (u(e, 'in_pos') - u(e, 'in_neg'));
        const limit = params?.outputLimit ?? 15;
        after = drive > limit + 1e-9 ? 1 : drive < -limit - 1e-9 ? -1 : 0;
      }
      if (after !== before) { states.set(e.id, after); changes++; }
    }
    if (!changes) return { potentials, states };
  }
  throw new Error('DC-рабочая точка: нелинейные состояния не сошлись за 60 итераций.');
}
