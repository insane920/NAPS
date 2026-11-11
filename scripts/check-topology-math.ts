import assert from 'node:assert/strict';
import { solveCircuitTransient } from '../src/math/circuitSolver';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import { buildCalculationReport } from '../src/math/calculationReport';
import { validateSimulation } from '../src/math/validateSimulation';
import { SAMPLE_CIRCUITS } from '../src/data/sampleCircuits';
import type { CircuitElement, CircuitWire, ComponentType, TransientSettings } from '../src/types';
import { sourceValue } from '../src/math/linearTransient';

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

const currentDrive = [e('IA', 'I_AC', 0.02, { secondaryValue: 50 }), e('RL', 'R', 100), e('G0', 'GND')];
near(sourceValue(e('SIN', 'V_AC', 2, { secondaryValue: 50, modelParams: { sourceOffset: 3, sourcePhaseDeg: 90 } }), 0), 5);
const rampPulse = e('PUL', 'I_PULSE', 1, { secondaryValue: 100, initialCondition: 0.5, modelParams: { pulseLow: -1, pulseHigh: 3, pulseDelay: 0.002, pulseRise: 0.001, pulseFall: 0.001 } });
near(sourceValue(rampPulse, 0), -1);
near(sourceValue(rampPulse, 0.0025), 1);
near(sourceValue(rampPulse, 0.004), 3);
near(sourceValue(rampPulse, 0.0065), 1);
near(sourceValue(rampPulse, 0.007), -1);
const currentDriveWires = [w('IA', '1', 'RL', '1'), w('IA', '2', 'RL', '2'), w('RL', '2', 'G0', '1')];
const sineCurrent = solveCircuitTransient(currentDrive, currentDriveWires, settings(['I(IA)', 'U(RL)'], 0.02, 0.005));
near(sineCurrent.signals['I(IA)'][1], 0.02);
near(sineCurrent.signals['U(RL)'][1], -2);
const pulseCurrent = solveCircuitTransient(currentDrive.map(item => item.id === 'IA' ? { ...item, type: 'I_PULSE', secondaryValue: 100, initialCondition: 0.25 } : item), currentDriveWires, settings(['I(IA)'], 0.01, 0.0025));
near(pulseCurrent.signals['I(IA)'][0], 0.02);
near(pulseCurrent.signals['I(IA)'][pulseCurrent.time.findIndex(t => t >= 0.0025)], 0);
assert.throws(() => solveCircuitTransient(
  currentDrive.map(item => item.id === 'IA' ? { ...item, type: 'I_PULSE', secondaryValue: 75, initialCondition: 0.5 } : item),
  currentDriveWires, settings(['I(IA)'], 0.02, 0.02 / 19999),
), /с учётом фронтов импульсов/, 'Pulse edges cannot be silently omitted at the 20,000-point limit');

const controlledBase = [e('VCTL', 'V_DC', 2), e('RC', 'R', 100), e('G0', 'GND')];
const controlledWires = [w('VCTL', '1', 'RC', '1'), w('RC', '2', 'G0', '1'), w('VCTL', '2', 'G0', '1')];
const voltageControlled = [e('E1', 'VCVS', 3), e('LOAD', 'R', 100), ...controlledBase];
const voltageControlledWires = [...controlledWires, w('E1', 'ctrl_pos', 'VCTL', '1'), w('E1', 'ctrl_neg', 'G0', '1'), w('E1', '1', 'LOAD', '1'), w('E1', '2', 'G0', '1'), w('LOAD', '2', 'G0', '1')];
const vcResult = solveCircuitTransient(voltageControlled, voltageControlledWires, settings(['U(LOAD)']));
near(vcResult.signals['U(LOAD)'][0], 6);
assert.equal(validateSimulation(voltageControlled, voltageControlledWires, settings(['U(LOAD)']), vcResult).status, 'passed');
const conductanceControlled = voltageControlled.map(item => item.id === 'E1' ? { ...item, type: 'VCCS' as const, value: 0.5 } : item);
const vccsResult = solveCircuitTransient(conductanceControlled, voltageControlledWires, settings(['U(LOAD)', 'I(E1)']));
near(vccsResult.signals['U(LOAD)'][0], -100);
assert.equal(validateSimulation(conductanceControlled, voltageControlledWires, settings(['U(LOAD)', 'I(E1)']), vccsResult).status, 'passed');
near(solveCircuitTransient(conductanceControlled, voltageControlledWires, settings(['I(E1)'])).signals['I(E1)'][0], 1);
const currentControlled = [e('H1', 'CCVS', 50, { controlSource: 'VCTL' }), e('LOAD', 'R', 100), ...controlledBase];
const currentControlledWires = [...controlledWires, w('H1', '1', 'LOAD', '1'), w('H1', '2', 'G0', '1'), w('LOAD', '2', 'G0', '1')];
near(solveCircuitTransient(currentControlled, currentControlledWires, settings(['U(LOAD)'])).signals['U(LOAD)'][0], -1);
const currentCurrent = currentControlled.map(item => item.id === 'H1' ? { ...item, type: 'CCCS' as const, value: 2 } : item);
near(solveCircuitTransient(currentCurrent, currentControlledWires, settings(['U(LOAD)'])).signals['U(LOAD)'][0], 4);
const savedControlled = parseYamlScm(exportToYamlScm(currentCurrent, currentControlledWires, settings(['U(LOAD)'])));
assert.equal(savedControlled.elements.find(item => item.name === 'H1')?.controlSource, 'VCTL');
near(solveCircuitTransient(savedControlled.elements, savedControlled.wires, savedControlled.transient).signals['U(LOAD)'][0], 4);
assert.throws(() => solveCircuitTransient(currentCurrent.map(item => item.id === 'H1' ? { ...item, controlSource: 'missing' } : item), currentControlledWires, settings(['U(LOAD)'])), /управляющий источник/);

const series = [e('V1', 'V_DC', 5), e('D1', 'DIODE'), e('R1', 'R', 100), e('G', 'GND'), e('OUT', 'PORT', 0, { portName: 'OUT' })];
const seriesWires = [w('V1', '1', 'D1', '1'), w('D1', '2', 'R1', '1'), w('R1', '1', 'OUT', '1'), w('R1', '2', 'G', '1'), w('V1', '2', 'G', '1')];
const selected = settings(['I(D1)', 'U(OUT)', 'P(R1)']);
const diode = solveCircuitTransient(series, seriesWires, selected);
const seriesWithoutGround = series.filter(item => item.type !== 'GND');
const wiresWithoutGround = [
  ...seriesWires.filter(item => item.fromCompId !== 'G' && item.toCompId !== 'G'),
  w('R1', '2', 'V1', '2'),
];
const ungroundedDiode = solveCircuitTransient(seriesWithoutGround, wiresWithoutGround, selected);
near(ungroundedDiode.signals['I(D1)'][0], diode.signals['I(D1)'][0]);
near(ungroundedDiode.signals['U(OUT)'][0], diode.signals['U(OUT)'][0]);
assert.equal(diode.model, 'topology-mna');
near(diode.signals['I(D1)'][0], (5 - 0.7) / 100.01);
near(diode.signals['U(OUT)'][0], 100 * (5 - 0.7) / 100.01);
near(diode.signals['P(R1)'][0], 100 * ((5 - 0.7) / 100.01) ** 2);
const idealSeries = series.map(item => item.type === 'DIODE' ? { ...item, diodeModel: 'ideal' as const } : item);
const idealForward = solveCircuitTransient(idealSeries, seriesWires, selected);
near(idealForward.signals['I(D1)'][0], 5 / 100);
near(idealForward.signals['U(OUT)'][0], 5);
assert.equal(validateSimulation(idealSeries, seriesWires, selected, idealForward).status, 'passed');
const idealReverse = solveCircuitTransient(idealSeries, [w('V1', '1', 'D1', '2'), w('D1', '1', 'R1', '1'), ...seriesWires.slice(2)], selected);
near(idealReverse.signals['I(D1)'][0], 0);
const savedIdeal = parseYamlScm(exportToYamlScm(idealSeries, seriesWires, selected));
assert.equal(savedIdeal.elements.find(item => item.name === 'D1')?.diodeModel, 'ideal');
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
assert.throws(() => solveCircuitTransient(series.filter(el => el.type !== 'GND'), seriesWires, selected), /отсутствующий/);
assert.throws(() => solveCircuitTransient(series, [...seriesWires, w('D1', 'bad', 'R1', '1')], selected), /отсутствующий элемент или вывод/);
const badModel = series.map(el => el.id === 'D1' ? { ...el, modelParams: { onResistance: -1 } } : el);
assert.throws(() => solveCircuitTransient(badModel, seriesWires, selected), /сопротивление открытого состояния/);
console.log('PASS: topology MNA diode, two diodes, rewiring, switch, thyristor, op-amp, saturation, SCM and invalid models.');
