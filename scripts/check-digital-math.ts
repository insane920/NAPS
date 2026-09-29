import assert from 'node:assert/strict';
import { solveCircuitTransient } from '../src/math/circuitSolver';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import type { CircuitElement, CircuitWire, TransientSettings } from '../src/types';

const element = (id: string, type: CircuitElement['type'], value = 0): CircuitElement => ({ id, name: id, type, value, x: 0, y: 0, rotation: 0, valueStr: String(value), unit: '' });
const wire = (a: string, ap: string, b: string, bp: string): CircuitWire => ({ id: `${a}${ap}-${b}${bp}`, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
const settings = (tMax = 1e-5, step = 1e-6): TransientSettings => ({ tMax, step, tMaxStr: String(tMax), stepStr: String(step), eps: 1e-3,
  signals: [{ id: 'out', plotIndex: 1, exprX: 't', exprY: 'U(OUT)', color: '#000', enabled: true }] });
const near = (a: number, b: number, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

for (const [kind, inputs, expected] of [
  ['NOT', [0], 1], ['NOT', [5], 0],
  ['AND', [0, 0], 0], ['AND', [5, 0], 0], ['AND', [5, 5], 1],
  ['OR', [0, 0], 0], ['OR', [5, 0], 1], ['XOR', [5, 0], 1], ['XOR', [5, 5], 0],
] as Array<[CircuitElement['type'], number[], number]>) {
  const outPin = kind === 'NOT' ? '2' : '3';
  const gate = element('GATE', kind);
  const inputsElements = inputs.map((v, i) => element(`V${i}`, 'V_DC', v));
  const elements = [gate, ...inputsElements, element('LOAD', 'R', 1000), element('G', 'GND'), { ...element('OUT', 'PORT'), portName: 'OUT' }];
  const wires = inputsElements.flatMap((v, i) => [wire(v.id, '1', 'GATE', String(i + 1)), wire(v.id, '2', 'G', '1')]);
  wires.push(wire('GATE', outPin, 'LOAD', '1'), wire('GATE', outPin, 'OUT', '1'), wire('LOAD', '2', 'G', '1'));
  const result = solveCircuitTransient(elements, wires, settings());
  near(result.signals['U(OUT)'][0], expected * 5 * 1000 / 1010);
  assert.equal(result.digitalStates?.GATE[0], expected);
}

const comparator = [element('POS', 'V_DC', 3), element('NEG', 'V_DC', 2), element('CMP', 'COMPARATOR'), element('LOAD', 'R', 1000), element('G', 'GND'), { ...element('OUT', 'PORT'), portName: 'OUT' }];
const comparatorWires = [wire('POS', '1', 'CMP', 'in_pos'), wire('NEG', '1', 'CMP', 'in_neg'), wire('POS', '2', 'G', '1'), wire('NEG', '2', 'G', '1'), wire('CMP', 'out', 'OUT', '1'), wire('CMP', 'out', 'LOAD', '1'), wire('LOAD', '2', 'G', '1')];
near(solveCircuitTransient(comparator, comparatorWires, settings()).signals['U(OUT)'][0], 5 * 1000 / 1010);
near(solveCircuitTransient(comparator.map(e => e.id === 'POS' ? { ...e, value: 1 } : e), comparatorWires, settings()).signals['U(OUT)'][0], 0);

const rs = [element('SET', 'V_DC', 5), element('RESET', 'V_DC', 0), element('FF', 'RS_FF'), element('LOAD', 'R', 1000), element('G', 'GND'), { ...element('OUT', 'PORT'), portName: 'OUT' }];
const rsWires = [wire('SET', '1', 'FF', '1'), wire('RESET', '1', 'FF', '2'), wire('SET', '2', 'G', '1'), wire('RESET', '2', 'G', '1'), wire('FF', '3', 'OUT', '1'), wire('FF', '3', 'LOAD', '1'), wire('LOAD', '2', 'G', '1')];
assert.equal(solveCircuitTransient(rs, rsWires, settings()).digitalStates?.FF[0], 1);
assert.equal(solveCircuitTransient(rs.map(e => e.id === 'RESET' ? { ...e, value: 5 } : e), rsWires, settings()).digitalStates?.FF[0], 'X');

const clock = { ...element('CLK', 'V_PULSE', 5), secondaryValue: 100000, initialCondition: 0.2 };
const d = [element('DATA', 'V_DC', 5), clock, element('FF', 'D_FF'), element('LOAD', 'R', 1000), element('G', 'GND'), { ...element('OUT', 'PORT'), portName: 'OUT' }];
const dWires = [wire('DATA', '1', 'FF', '1'), wire('CLK', '1', 'FF', '2'), wire('DATA', '2', 'G', '1'), wire('CLK', '2', 'G', '1'), wire('FF', '3', 'OUT', '1'), wire('FF', '3', 'LOAD', '1'), wire('LOAD', '2', 'G', '1')];
const dResult = solveCircuitTransient(d, dWires, settings(2e-5, 5e-6));
assert.equal(dResult.digitalStates?.FF[0], 1);
assert.ok(dResult.time.some(t => Math.abs(t - 2e-6) < 1e-12), 'short clock falling edge must be sampled');

const jk = [element('J', 'V_DC', 5), element('K', 'V_DC', 5), clock, element('FF', 'JK_FF'), element('LOAD', 'R', 1000), element('G', 'GND'), { ...element('OUT', 'PORT'), portName: 'OUT' }];
const jkWires = [wire('J', '1', 'FF', '1'), wire('K', '1', 'FF', '2'), wire('CLK', '1', 'FF', 'clk'), wire('J', '2', 'G', '1'), wire('K', '2', 'G', '1'), wire('CLK', '2', 'G', '1'), wire('FF', '3', 'OUT', '1'), wire('FF', '3', 'LOAD', '1'), wire('LOAD', '2', 'G', '1')];
const jkResult = solveCircuitTransient(jk, jkWires, settings(2e-5, 5e-6));
assert.equal(jkResult.digitalStates?.FF[0], 1);
const secondEdge = jkResult.time.findIndex(t => Math.abs(t - 1e-5) < 1e-12);
assert.ok(secondEdge >= 0);
assert.equal(jkResult.digitalStates?.FF[secondEdge], 0);

const delayed = [element('IN', 'V_DC', 0), { ...element('INV', 'NOT'), modelParams: { propagationDelay: 2e-6 } }, element('LOAD', 'R', 1000), element('G', 'GND'), { ...element('OUT', 'PORT'), portName: 'OUT' }];
const delayedWires = [wire('IN', '1', 'INV', '1'), wire('IN', '2', 'G', '1'), wire('INV', '2', 'OUT', '1'), wire('INV', '2', 'LOAD', '1'), wire('LOAD', '2', 'G', '1')];
const delayedResult = solveCircuitTransient(delayed, delayedWires, settings(5e-6, 5e-6));
const due = delayedResult.time.findIndex(t => Math.abs(t - 2e-6) < 1e-12);
assert.ok(due > 0);
assert.equal(delayedResult.digitalStates?.INV[0], 0);
assert.equal(delayedResult.digitalStates?.INV[due], 1);

const saved = parseYamlScm(exportToYamlScm(jk, jkWires, settings()));
const restored = saved.elements.find(e => e.type === 'JK_FF')!;
assert.ok(saved.wires.some(w => w.toCompId === restored.id && w.toPinId === 'clk'));
assert.equal(solveCircuitTransient(saved.elements, saved.wires, saved.transient).digitalStates?.FF[0], 1);

// A digital inverter drives the electrical gate of an analog switch through its output resistance.
const mixed = [element('IN', 'V_DC', 0), element('LOGIC', 'NOT'), element('POWER', 'V_DC', 5), element('R1', 'R', 1000), element('S1', 'SWITCH'), element('G', 'GND'), { ...element('OUT', 'PORT'), portName: 'OUT' }];
const mixedWires = [wire('IN', '1', 'LOGIC', '1'), wire('IN', '2', 'G', '1'), wire('LOGIC', '2', 'S1', 'gate'),
  wire('POWER', '1', 'R1', '1'), wire('POWER', '2', 'G', '1'), wire('R1', '2', 'S1', '1'), wire('R1', '2', 'OUT', '1'), wire('S1', '2', 'G', '1')];
const on = solveCircuitTransient(mixed, mixedWires, settings());
near(on.branchCurrents.S1[0], 5 / 1000.01, 1e-7);
const off = solveCircuitTransient(mixed.map(e => e.id === 'IN' ? { ...e, value: 5 } : e), mixedWires, settings());
assert.ok(Math.abs(off.branchCurrents.S1[0]) < 1e-7);
assert.equal(on.digitalStates?.LOGIC[0], 1);
assert.equal(off.digitalStates?.LOGIC[0], 0);
console.log('PASS: logic truth tables, comparator, RS/D/JK, pulse edges, delayed events and SCM terminals.');
