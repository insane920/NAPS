import assert from 'node:assert/strict';
import { solveCircuitAC, solveCircuitTransient } from '../src/math/circuitSolver';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import type { ACSettings, CircuitElement, CircuitWire } from '../src/types';

const element = (id: string, type: CircuitElement['type'], value: number): CircuitElement => ({ id, name: id, type, value, x: 0, y: 0, rotation: 0, valueStr: String(value), unit: '' });
const wire = (a: string, ap: string, b: string, bp: string): CircuitWire => ({ id: `${a}${ap}-${b}${bp}`, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
const settings = (exprs: string[], frequency: number): ACSettings => ({ fMin: frequency, fMax: frequency * 1.000001, points: 2, scaleType: 'linear', signals: exprs.map((exprY, i) => ({ id: String(i), plotIndex: /^phs/i.test(exprY) ? 2 : 1, exprX: 'f', exprY, color: '#000', enabled: true })) });
const near = (actual: number, expected: number, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);

const divider = [element('V1', 'V_AC', 10), element('R1', 'R', 1000), element('R2', 'R', 2000), element('G', 'GND', 0), { ...element('OUT', 'PORT', 0), portName: 'OUT' }];
const dividerWires = [wire('V1', '1', 'R1', '1'), wire('R1', '2', 'R2', '1'), wire('R1', '2', 'OUT', '1'), wire('R2', '2', 'G', '1'), wire('V1', '2', 'G', '1')];
const d = solveCircuitAC(divider, dividerWires, settings(['mag(U(OUT))', 'db(U(OUT)/U(V1))', 'phs(U(OUT)/U(V1))'], 1000));
assert.equal(d.isAC, true);
near(d.signals['mag(U(OUT))'][0], 20 / 3);
near(d.signals['db(U(OUT)/U(V1))'][0], 20 * Math.log10(2 / 3));
near(d.signals['phs(U(OUT)/U(V1))'][0], 0);

// RC low-pass: H(jw) = 1/(1+jwRC); at the corner |H|=1/sqrt(2), phase=-45°.
const corner = 1 / (2 * Math.PI * 1000 * 1e-6);
// Use a series R and shunt C; retain the graph's explicit node mapping.
const lowpass = [element('V1', 'V_AC', 1), element('R1', 'R', 1000), element('C1', 'C', 1e-6), element('G', 'GND', 0), { ...element('OUT', 'PORT', 0), portName: 'OUT' }];
const lowpassWires = [wire('V1', '1', 'R1', '1'), wire('R1', '2', 'C1', '1'), wire('R1', '2', 'OUT', '1'), wire('C1', '2', 'G', '1'), wire('V1', '2', 'G', '1')];
const lp = solveCircuitAC(lowpass, lowpassWires, settings(['mag(U(OUT))', 'phs(U(OUT)/U(V1))'], corner));
near(lp.signals['mag(U(OUT))'][0], Math.SQRT1_2);
near(lp.signals['phs(U(OUT)/U(V1))'][0], -45);

const rlCorner = 1000 / (2 * Math.PI * 0.1);
const rl = [element('V1', 'V_AC', 1), element('R1', 'R', 1000), element('L1', 'L', 0.1), element('G', 'GND', 0), { ...element('OUT', 'PORT', 0), portName: 'OUT' }];
const rlWires = [wire('V1', '1', 'R1', '1'), wire('R1', '2', 'L1', '1'), wire('L1', '1', 'OUT', '1'), wire('L1', '2', 'G', '1'), wire('V1', '2', 'G', '1')];
const rlResult = solveCircuitAC(rl, rlWires, settings(['mag(U(OUT))', 'phs(U(OUT)/U(V1))'], rlCorner));
near(rlResult.signals['mag(U(OUT))'][0], Math.SQRT1_2);
near(rlResult.signals['phs(U(OUT)/U(V1))'][0], 45);

const resonance = 1 / (2 * Math.PI * Math.sqrt(0.01 * 10e-6));
const rlc = [element('V1', 'V_AC', 1), element('R1', 'R', 10), element('L1', 'L', 0.01), element('C1', 'C', 10e-6), element('G', 'GND', 0)];
const rlcWires = [wire('V1', '1', 'R1', '1'), wire('R1', '2', 'L1', '1'), wire('L1', '2', 'C1', '1'), wire('C1', '2', 'G', '1'), wire('V1', '2', 'G', '1')];
const rlcResult = solveCircuitAC(rlc, rlcWires, settings(['mag(I(R1))', 'phs(I(R1)/U(V1))'], resonance));
near(rlcResult.signals['mag(I(R1))'][0], 0.1);
near(rlcResult.signals['phs(I(R1)/U(V1))'][0], 0);

const biasedDiode = [element('BIAS', 'V_DC', 5), element('V1', 'V_AC', 1), element('R1', 'R', 1000),
  { ...element('D1', 'DIODE', 0.7), modelParams: { forwardVoltage: 0.7, onResistance: 0.01, offResistance: 1e9 } },
  element('G', 'GND', 0), { ...element('OUT', 'PORT', 0), portName: 'OUT' }];
const diodeWires = [wire('BIAS', '2', 'G', '1'), wire('BIAS', '1', 'V1', '2'), wire('V1', '1', 'R1', '1'),
  wire('R1', '2', 'D1', '1'), wire('D1', '1', 'OUT', '1'), wire('D1', '2', 'G', '1')];
const diodeAC = solveCircuitAC(biasedDiode, diodeWires, settings(['mag(U(OUT))'], 1000));
near(diodeAC.signals['mag(U(OUT))'][0], 0.01 / 1000.01, 1e-9);
const reverse = solveCircuitAC(biasedDiode.map(e => e.id === 'BIAS' ? { ...e, value: -5 } : e), diodeWires, settings(['mag(U(OUT))'], 1000));
near(reverse.signals['mag(U(OUT))'][0], 1e9 / (1e9 + 1000), 1e-9);

const transformer = [element('V1', 'V_AC', 10), { ...element('T1', 'TR3', 1), modelParams: { turnsRatio: 2, couplingFactor: 0.99 } }, element('RL', 'R', 1000), element('G', 'GND', 0), { ...element('OUT', 'PORT', 0), portName: 'OUT' }];
const transformerWires = [wire('V1', '1', 'T1', '1'), wire('V1', '2', 'T1', '2'), wire('V1', '2', 'G', '1'), wire('T1', '3', 'RL', '1'), wire('T1', '3', 'OUT', '1'), wire('T1', '4', 'RL', '2'), wire('T1', '4', 'G', '1')];
const tr = solveCircuitAC(transformer, transformerWires, settings(['mag(U(OUT))', 'phs(U(OUT)/U(V1))', 'mag(I(T1:secondary))'], 1000));
const leakAngle = Math.atan(2 * Math.PI * 1000 * 4 * (1 - 0.99 ** 2) / 1000);
near(tr.signals['mag(U(OUT))'][0], 10 * 2 * 0.99 * Math.cos(leakAngle), 1e-9);
near(tr.signals['phs(U(OUT)/U(V1))'][0], -leakAngle * 180 / Math.PI, 1e-9);
near(tr.signals['mag(I(T1:secondary))'][0], tr.signals['mag(U(OUT))'][0] / 1000, 1e-9);
const savedTransformer = parseYamlScm(exportToYamlScm(transformer, transformerWires,
  { tMax: 1e-3, step: 1e-5, tMaxStr: '1m', stepStr: '10u', eps: 1e-3, signals: [] }, settings(['mag(U(OUT))'], 1000)));
assert.equal(savedTransformer.elements.find(e => e.type === 'TR3')?.modelParams?.turnsRatio, 2);
assert.equal(savedTransformer.elements.find(e => e.type === 'TR3')?.modelParams?.couplingFactor, 0.99);
assert.equal(savedTransformer.ac?.signals[0].exprY, 'mag(U(OUT))');
near(solveCircuitAC(savedTransformer.elements, savedTransformer.wires, savedTransformer.ac!).signals['mag(U(OUT))'][0], tr.signals['mag(U(OUT))'][0]);
assert.throws(() => solveCircuitAC(lowpass, lowpassWires, settings(['db(U(OUT)/U(MISSING))'], corner)), /не найден/);
assert.throws(() => solveCircuitAC(lowpass, lowpassWires, { ...settings(['mag(U(OUT))'], corner), fMin: 0 }), /начальная частота/);
assert.throws(() => solveCircuitAC(lowpass.map(e => e.id === 'V1' ? { ...e, value: 0 } : e), lowpassWires, settings(['mag(U(OUT))'], corner)), /ненулевой амплитудой/);
assert.throws(() => solveCircuitAC([...lowpass, element('FLOAT', 'R', 100)], lowpassWires, settings(['mag(U(OUT))'], corner)), /вырождена/);
assert.throws(() => solveCircuitAC(biasedDiode.map(e => e.id === 'D1' ? { ...e, modelParams: { onResistance: 0 } } : e), diodeWires, settings(['mag(U(OUT))'], 1000)), /сопротивления/);
const transient = solveCircuitTransient(
  transformer.map(e => e.id === 'V1' ? { ...e, type: 'V_DC' as const } : e), transformerWires,
  { tMax: 5e-6, tMaxStr: '5u', step: 1e-6, stepStr: '1u', eps: 0.001,
    signals: [{ id: 'tr', plotIndex: 1, exprX: 't', exprY: 'U(OUT)', color: '#000', enabled: true }] },
);
assert.equal(transient.model, 'topology-mna');
assert.ok(transient.branchCurrents['T1:secondary'].every(Number.isFinite));
const iPrimary = transient.branchCurrents.T1;
const iSecondary = transient.branchCurrents['T1:secondary'];
for (let k = 1; k < transient.time.length; k++) {
  const dt = transient.time[k] - transient.time[k - 1];
  const expectedPrimary = (iPrimary[k] - iPrimary[k - 1] + 0.99 * 2 * (iSecondary[k] - iSecondary[k - 1])) / dt;
  near(expectedPrimary, 10, 1e-5);
}
console.log('PASS: AC divider, RC corner magnitude/phase, transformer coupling, invalid signals and settings.');
