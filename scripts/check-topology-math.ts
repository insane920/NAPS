import assert from 'node:assert/strict';
import { solveCircuitTransient } from '../src/math/circuitSolver';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import { buildCalculationReport } from '../src/math/calculationReport';
import { validateSimulation } from '../src/math/validateSimulation';
import { SAMPLE_CIRCUITS } from '../src/data/sampleCircuits';
import type { CircuitElement, CircuitWire, ComponentType, TransientSettings } from '../src/types';

const e = (name: string, type: ComponentType, value = 0, extra: Partial<CircuitElement> = {}): CircuitElement => ({
  id: name, name, type, value, valueStr: String(value), unit: '', x: 0, y: 0, rotation: 0, ...extra,
});
let wireId = 0;
const w = (a: string, ap: string, b: string, bp: string): CircuitWire => ({ id: `test-${++wireId}`, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
const settings = (signals: string[], tMax = 0.02, step = 0.001): TransientSettings => ({
  tMax, tMaxStr: String(tMax), step, stepStr: String(step), eps: 0.001,
  signals: signals.map((exprY, i) => ({ id: String(i), plotIndex: 1, exprX: 't', exprY, color: '#000000', enabled: true })),
});
const near = (actual: number, expected: number, tolerance = 1e-7) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
  `${actual} differs from ${expected}`,
);

const series = [e('V1', 'V_DC', 5), e('D1', 'DIODE'), e('R1', 'R', 100), e('G', 'GND'), e('OUT', 'PORT', 0, { portName: 'OUT' })];
const seriesWires = [w('V1', '1', 'D1', '1'), w('D1', '2', 'R1', '1'), w('R1', '1', 'OUT', '1'), w('R1', '2', 'G', '1'), w('V1', '2', 'G', '1')];
const selected = settings(['I(D1)', 'U(OUT)', 'P(R1)']);
const diode = solveCircuitTransient(series, seriesWires, selected);
assert.equal(diode.model, 'topology-mna');
near(diode.signals['I(D1)'][0], (5 - 0.7) / 100.01);
near(diode.signals['U(OUT)'][0], 100 * (5 - 0.7) / 100.01);
near(diode.signals['P(R1)'][0], 100 * ((5 - 0.7) / 100.01) ** 2);
const diodeReport = buildCalculationReport(series, seriesWires, selected, diode, 0);
near(diodeReport.steps.find(row => row.name === 'I(D1)')!.value, diode.signals['I(D1)'][0]);
near(diodeReport.steps.find(row => row.name === 'Узел 0: закон Кирхгофа')!.value, 0);
assert.ok(diodeReport.steps.find(row => row.name === 'I(D1)')!.formula.includes('Vf'));
assert.equal(validateSimulation(series, seriesWires, selected, diode).status, 'passed');
const corrupted = structuredClone(diode);
corrupted.branchCurrents.D1[0] += 0.5;
assert.equal(validateSimulation(series, seriesWires, selected, corrupted).status, 'failed');
const renamed = series.map(el => el.type === 'DIODE' ? { ...el, name: 'RECT' } : el.type === 'R' ? { ...el, name: 'LOAD' } : el);
near(solveCircuitTransient(renamed, seriesWires, settings(['U(OUT)'])).signals['U(OUT)'][0], diode.signals['U(OUT)'][0]);
const reverseWires = [w('V1', '1', 'D1', '2'), w('D1', '1', 'R1', '1'), ...seriesWires.slice(2)];
assert.ok(Math.abs(solveCircuitTransient(series, reverseWires, settings(['I(D1)'])).signals['I(D1)'][0]) < 1e-7);
const acSeries = series.map(el => el.id === 'V1' ? { ...el, type: 'V_AC' as const, value: 10, secondaryValue: 50 } : el);
const rectified = solveCircuitTransient(acSeries, seriesWires, settings(['U(OUT)', 'I(D1)']));
near(rectified.signals['U(OUT)'][5], 100 * (10 - 0.7) / 100.01);
assert.ok(Math.abs(rectified.signals['U(OUT)'][15]) < 0.001, 'reverse half-cycle blocks the diode');
const filteredSample = SAMPLE_CIRCUITS.find(sample => sample.id === 'rectifier-bridge')!;
const filtered = solveCircuitTransient(filteredSample.elements, filteredSample.wires, filteredSample.transient);
assert.equal(filtered.model, 'topology-mna');
assert.ok(Math.max(...filtered.signals['U(OUT)']) > 100, 'diode and capacitor charge the output');
assert.ok(filtered.signals['U(OUT)'].every(Number.isFinite));
const filteredVerification = validateSimulation(filteredSample.elements, filteredSample.wires, filteredSample.transient, filtered);
assert.equal(filteredVerification.status, 'passed', filteredVerification.messages.join('; '));

const twoDiodes = [...series, e('D2', 'DIODE')];
const twoWires = [w('V1', '1', 'D1', '1'), w('D1', '2', 'D2', '1'), w('D2', '2', 'R1', '1'), ...seriesWires.slice(2)];
near(solveCircuitTransient(twoDiodes, twoWires, selected).signals['I(D1)'][0], (5 - 1.4) / 100.02);
const saved = parseYamlScm(exportToYamlScm(twoDiodes, twoWires, selected));
near(solveCircuitTransient(saved.elements, saved.wires, saved.transient).signals['I(D1)'][0], (5 - 1.4) / 100.02);
const tuned = twoDiodes.map(el => el.id === 'D1' ? { ...el, modelParams: { forwardVoltage: 0.9, onResistance: 0.2, offResistance: 1e8 } } : el);
const tunedSaved = parseYamlScm(exportToYamlScm(tuned, twoWires, selected));
assert.deepEqual(tunedSaved.elements.find(el => el.name === 'D1')?.modelParams, tuned[1].modelParams);
near(solveCircuitTransient(tunedSaved.elements, tunedSaved.wires, tunedSaved.transient).signals['I(D1)'][0], (5 - 1.6) / 100.21);

// Gate referenced to terminal 2: a low-side switch keeps its control well-defined.
const switched = [e('V1', 'V_DC', 10), e('R1', 'R', 100), e('S1', 'SWITCH', 0), e('VG', 'V_PULSE', 5, { secondaryValue: 50, initialCondition: 0.5 }), e('G', 'GND')];
const switchedWires = [w('V1', '1', 'R1', '1'), w('R1', '2', 'S1', '1'), w('S1', '2', 'G', '1'), w('V1', '2', 'G', '1'), w('VG', '1', 'S1', 'gate'), w('VG', '2', 'G', '1')];
const switchResult = solveCircuitTransient(switched, switchedWires, settings(['I(S1)']));
near(switchResult.signals['I(S1)'][0], 10 / 100.01);
assert.ok(Math.abs(switchResult.signals['I(S1)'][15]) < 1e-7);

const thyristor = switched.map(el => el.type === 'SWITCH' ? e('S1', 'THYRISTOR', 0) : el);
const thyristorResult = solveCircuitTransient(thyristor, switchedWires, settings(['I(S1)']));
near(thyristorResult.signals['I(S1)'][0], (10 - 0.7) / 100.01);
near(thyristorResult.signals['I(S1)'][15], (10 - 0.7) / 100.01);

const amp = [e('V1', 'V_DC', 1), e('R1', 'R', 1000), e('R2', 'R', 10000), e('OA', 'OPAMP', 1000), e('G', 'GND'), e('OUT', 'PORT', 0, { portName: 'OUT' })];
const ampWires = [w('V1', '1', 'R1', '1'), w('R1', '2', 'OA', 'in_neg'), w('R1', '2', 'R2', '1'), w('R2', '2', 'OA', 'out'), w('OA', 'out', 'OUT', '1'), w('OA', 'in_pos', 'G', '1'), w('V1', '2', 'G', '1')];
const ampResult = solveCircuitTransient(amp, ampWires, settings(['U(OUT)', 'I(R1)']));
near(ampResult.signals['U(OUT)'][0], -10000 / 1011);
assert.equal(validateSimulation(amp, ampWires, settings(['U(OUT)', 'I(R1)']), ampResult).status, 'passed');
const highInput = amp.map(el => el.id === 'V1' ? { ...el, value: 5 } : el);
near(solveCircuitTransient(highInput, ampWires, settings(['U(OUT)'])).signals['U(OUT)'][0], -15);

const unsupported = [...amp, e('N1', 'NOT')];
assert.throws(() => solveCircuitTransient(unsupported, ampWires, settings(['U(OUT)'])), /вырождена/);
assert.throws(() => solveCircuitTransient(series.filter(el => el.type !== 'GND'), seriesWires, selected), /землю/);
assert.throws(() => solveCircuitTransient(series, [...seriesWires, w('D1', 'bad', 'R1', '1')], selected), /отсутствующий элемент или вывод/);
const badModel = series.map(el => el.id === 'D1' ? { ...el, modelParams: { onResistance: -1 } } : el);
assert.throws(() => solveCircuitTransient(badModel, seriesWires, selected), /сопротивление открытого состояния/);
console.log('PASS: topology MNA diode, two diodes, rewiring, switch, thyristor, op-amp, saturation, SCM and invalid models.');
