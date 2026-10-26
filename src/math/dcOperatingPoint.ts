import type { CircuitElement, CircuitWire } from '../types';
import { buildCircuitGraph, getCircuitPinIds } from './circuitSolver';
import { createMnaMatrix } from './mnaCore';
import { solveDenseSystem } from './linearTransient';
import { controlBranch, validateControlledSources } from './controlledSources';
import { stampTransistor, transistorTypes, validateTransistor } from './transistorModel';
import { sourceValue } from './linearTransient';
import { passiveLaw, validatePassiveModel } from './passiveModel';

export type DeviceState = -1 | 0 | 1;
export interface OperatingPoint {
  potentials: Map<number, number>;
  states: Map<string, DeviceState>;
  branchCurrents: Map<string, number>;
}
const passive = new Set(['GND', 'PORT', 'JUNCTION', 'TEXT']);

/** DC active-set operating point. Capacitors are open, inductors are shorts. */
export function solveDCOperatingPoint(elements: CircuitElement[], wires: CircuitWire[]): OperatingPoint {
  const active = elements.filter(e => !passive.has(e.type) && !e.isolation);
  active.forEach(e => { validateTransistor(e); validatePassiveModel(e); });
  validateControlledSources(elements);
  const graph = buildCircuitGraph(elements, wires);
  const pin = (e: CircuitElement, p: string) => graph.pinToNode.get(`${e.id}_${p}`)!;
  const used = [...new Set(active.flatMap(e => getCircuitPinIds(e.type, e).map(p => pin(e, p))))].filter(n => n !== 0);
  const nodes = new Map(used.map((n, i) => [n, i]));
  const extras = active.flatMap(e => e.type === 'TR3' ? [`${e.id}:1`, `${e.id}:2`] : e.type.startsWith('V_') || e.type === 'VCVS' || e.type === 'CCVS' || (e.type === 'DIODE' && e.diodeModel === 'ideal') || e.type === 'L' || e.type === 'OPAMP' ? [e.id] : []);
  const extraIndex = new Map(extras.map((id, i) => [id, used.length + i]));
  const states = new Map<string, DeviceState>();
  for (const e of active) if (['DIODE', 'SWITCH', 'THYRISTOR', 'OPAMP'].includes(e.type)) states.set(e.id, 0);
  const idx = (n: number) => n === 0 ? undefined : nodes.get(n);
  let potentials = new Map<number, number>([[0, 0]]);
  let guess = new Array<number>(used.length + extras.length).fill(0);
  for (let iteration = 0; iteration < 80; iteration++) {
    const { a, b, add, current, conductance, voltage } = createMnaMatrix(used.length + extras.length);
    for (const e of active) {
      const p = idx(pin(e, e.type === 'OPAMP' ? 'out' : '1'));
      const m = e.type === 'OPAMP' ? undefined : idx(pin(e, '2'));
      const params = e.modelParams;
      if (e.type === 'R') {
        const u = (p === undefined ? 0 : guess[p]) - (m === undefined ? 0 : guess[m]);
        const law = passiveLaw(e, u);
        conductance(p, m, law.derivative, law.value - law.derivative * u);
      }
      else if (transistorTypes.has(e.type)) {
        const terminalNodes = ['1', '2', 'gate'].map(id => idx(pin(e, id)));
        stampTransistor(e, terminalNodes.map(index => index === undefined ? 0 : guess[index]) as [number, number, number], terminalNodes, add, b);
      }
      else if (e.type === 'I_DC') current(p, m, e.value);
      else if (e.type === 'I_AC') current(p, m, e.modelParams?.sourceOffset ?? 0);
      else if (e.type === 'I_PULSE') current(p, m, sourceValue(e, 0));
      else if (e.type === 'VCVS' || e.type === 'VCCS') {
        const cp = idx(pin(e, 'ctrl_pos')), cm = idx(pin(e, 'ctrl_neg'));
        if (e.type === 'VCVS') {
          const q = extraIndex.get(e.id)!;
          voltage(p, m, q, 0); add(q, cp, -e.value); add(q, cm, e.value);
        } else {
          add(p, cp, e.value); add(p, cm, -e.value);
          add(m, cp, -e.value); add(m, cm, e.value);
        }
      }
      else if (e.type === 'CCVS' || e.type === 'CCCS') {
        const control = extraIndex.get(controlBranch(e, active).id)!;
        if (e.type === 'CCVS') {
          const q = extraIndex.get(e.id)!;
          voltage(p, m, q, 0); add(q, control, -e.value);
        } else {
          add(p, control, e.value); add(m, control, -e.value);
        }
      }
      else if (e.type.startsWith('V_')) voltage(p, m, extraIndex.get(e.id)!, e.type === 'V_AC' ? e.modelParams?.sourceOffset ?? 0 : sourceValue(e, 0));
      else if (e.type === 'L') voltage(p, m, extraIndex.get(e.id)!, 0);
      else if (e.type === 'TR3') {
        voltage(idx(pin(e, '1')), idx(pin(e, '2')), extraIndex.get(`${e.id}:1`)!, 0);
        voltage(idx(pin(e, '3')), idx(pin(e, '4')), extraIndex.get(`${e.id}:2`)!, 0);
      } else if (e.type === 'DIODE' && e.diodeModel === 'ideal') {
        const q = extraIndex.get(e.id)!;
        if (states.get(e.id) === 1) voltage(p, m, q, 0);
        else { a[q][q] = 1; b[q] = 0; }
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
        if (e.type === 'DIODE' && e.diodeModel === 'ideal') after = before === 1 ? (answer[extraIndex.get(e.id)!] >= -1e-10 ? 1 : 0) : delta > 1e-10 ? 1 : 0;
        else if (e.type === 'DIODE') after = forward ? 1 : 0;
        else after = forward && u(e, 'gate') - u(e, '2') >= (params?.gateThreshold ?? 2.5) ? 1 : 0;
      } else if (e.type === 'SWITCH') after = u(e, 'gate') - u(e, '2') >= (params?.gateThreshold ?? 2.5) ? 1 : 0;
      else if (e.type === 'OPAMP') {
        const drive = e.value * (u(e, 'in_pos') - u(e, 'in_neg'));
        const limit = params?.outputLimit ?? 15;
        after = drive > limit + 1e-9 ? 1 : drive < -limit - 1e-9 ? -1 : 0;
      }
      if (after !== before) { states.set(e.id, after); changes++; }
    }
    const delta = active.some(e => transistorTypes.has(e.type) || e.passiveModel === 'nonlinear')
      ? Math.max(0, ...answer.map((value, i) => Math.abs(value - guess[i]))) : 0;
    guess = answer;
    if (!changes && delta <= 1e-8 * Math.max(1, ...answer.map(Math.abs))) {
      // Retain every current already solved as an MNA unknown, including
      // voltage sources and controlled branches, not only inductors.
      return { potentials, states, branchCurrents: new Map(extras.map(id => [id, answer[extraIndex.get(id)!]])) };
    }
  }
  throw new Error('DC-рабочая точка: нелинейная схема не сошлась за 80 итераций.');
}
