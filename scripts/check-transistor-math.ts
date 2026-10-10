import assert from 'node:assert/strict';
import type { CircuitElement, CircuitWire, ComponentType, TransientSettings } from '../src/types';
import { buildCircuitGraph, solveCircuitTransient } from '../src/math/circuitSolver';
import { solveDCOperatingPoint } from '../src/math/dcOperatingPoint';
import { transistorAt, validateTransistor } from '../src/math/transistorModel';
import { solveACAnalysis } from '../src/math/acAnalysis';
import { validateSimulation } from '../src/math/validateSimulation';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';

const e = (name: string, type: ComponentType, value = 0, extra: Partial<CircuitElement> = {}): CircuitElement => ({ id: name, name, type, value, valueStr: String(value), unit: '', x: 100, y: 100, rotation: 0, ...extra });
const w = (id: string, a: string, ap: string, b: string, bp: string): CircuitWire => ({ id, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
const settings: TransientSettings = { tMax: 0.002, tMaxStr: '0.002', step: 0.001, stepStr: '0.001', eps: 0.001, signals: ['I(VT1)', 'U(RD)'].map((exprY, index) => ({ id: String(index), plotIndex: 1, exprX: 't', exprY, color: '#000000', enabled: true })) };
const elements = [e('VDD', 'V_DC', 5), e('VG', 'V_DC', 3), e('RD', 'R', 1000), e('VT1', 'NMOS', 0.001, { transistorModel: 'nonlinear' }), e('G', 'GND')];
const wires = [w('1', 'VDD', '1', 'RD', '1'), w('2', 'RD', '2', 'VT1', '1'), w('3', 'VG', '1', 'VT1', 'gate'), w('4', 'VT1', '2', 'G', '1'), w('5', 'VG', '2', 'G', '1'), w('6', 'VDD', '2', 'G', '1')];
const result = solveCircuitTransient(elements, wires, settings);
assert.equal(validateSimulation(elements, wires, settings, result).status, 'passed');
const current = result.branchCurrents.VT1[0];
assert.ok(current > 0.0005 && current < 0.0006, `NMOS current ${current}`);
assert.ok(Math.abs(result.elementVoltages!.RD[0] - current * 1000) < 1e-8);
assert.ok(Math.abs(solveDCOperatingPoint(elements, wires).potentials.get(0)!) < 1e-12);
const linear = elements.map(item => item.type === 'NMOS' ? { ...item, transistorModel: 'small-signal' as const, modelParams: { biasControlVoltage: 3, biasOutputVoltage: 4.5 } } : item);
const linearResult = solveCircuitTransient(linear, wires, settings);
assert.ok(Math.abs(linearResult.branchCurrents.VT1[0] - current) < 1e-4);
const pulsedGate = elements.map(item => item.id === 'VG' ? { ...item, type: 'V_PULSE' as const, secondaryValue: 100, initialCondition: 0.5, modelParams: { pulseLow: 0, pulseHigh: 3, pulseDelay: 0.005 } } : item);
const pulsedResult = solveCircuitTransient(pulsedGate, wires, { ...settings, tMax: 0.015, step: 0.0025 });
assert.ok(Math.abs(pulsedResult.branchCurrents.VT1[0]) < 1e-10, 'MOS is off before the gate pulse');
assert.ok(pulsedResult.branchCurrents.VT1[pulsedResult.time.findIndex(t => t >= 0.005)] > 0.0005, 'MOS turns on from the actual pulse source');
const saved = parseYamlScm(exportToYamlScm(linear, wires, settings));
assert.equal(saved.elements.find(item => item.name === 'VT1')?.transistorModel, 'small-signal');
assert.equal(saved.elements.find(item => item.name === 'VT1')?.modelParams?.biasControlVoltage, 3);

const npn = e('Q1', 'NPN', 100, { modelParams: { saturationCurrent: 1e-15, betaForward: 100, betaReverse: 1, thermalVoltage: 0.02585 } });
const bjtElements = [e('VDD', 'V_DC', 5), e('VB', 'V_DC', 0.7), e('RC', 'R', 1000), npn, e('G', 'GND')];
const bjtWires = [w('b1', 'VDD', '1', 'RC', '1'), w('b2', 'RC', '2', 'Q1', '1'), w('b3', 'VB', '1', 'Q1', 'gate'), w('b4', 'Q1', '2', 'G', '1'), w('b5', 'VB', '2', 'G', '1'), w('b6', 'VDD', '2', 'G', '1')];
const bjtSettings = { ...settings, signals: [...settings.signals.map(sig => ({ ...sig, exprY: sig.exprY.replace('VT1', 'Q1').replace('RD', 'RC') })), { ...settings.signals[0], id: 'power', exprY: 'P(Q1)' }] };
const bjtResult = solveCircuitTransient(bjtElements, bjtWires, bjtSettings);
assert.ok(bjtResult.branchCurrents.Q1[0] > 0 && bjtResult.branchCurrents.Q1[0] < 0.001, 'BJT common-emitter current');
assert.equal(validateSimulation(bjtElements, bjtWires, bjtSettings, bjtResult).status, 'passed');
const bjtGraph = buildCircuitGraph(bjtElements, bjtWires);
const terminalVoltages = (['1', '2', 'gate'] as const).map(pin => bjtResult.nodeVoltages[`node_${bjtGraph.pinToNode.get(`Q1_${pin}`)}`][0]) as [number, number, number];
const terminalCurrents = transistorAt(npn, terminalVoltages).currents;
const expectedPower = terminalVoltages.reduce((sum, voltage, index) => sum + voltage * terminalCurrents[index], 0);
assert.ok(Math.abs(bjtResult.signals['P(Q1)'][0] - expectedPower) < 1e-8, 'BJT power includes the base terminal');
const bjt = transistorAt(npn, [4, 0, 0.7]);
assert.ok(bjt.currents[0] > 0 && bjt.currents[0] < 0.001);
assert.ok(Math.abs(bjt.currents.reduce((sum, value) => sum + value, 0)) < 1e-12, 'BJT KCL');
for (const [device, volts] of [[npn, [4, 0, 0.7]], [elements[3], [4.5, 0, 3]]] as Array<[CircuitElement, [number, number, number]]>) {
  const model = transistorAt(device, volts);
  for (let column = 0; column < 3; column++) {
    const perturbed = [...volts] as [number, number, number];
    perturbed[column] += 1e-6;
    const next = transistorAt(device, perturbed);
    for (let row = 0; row < 3; row++) assert.ok(Math.abs((next.currents[row] - model.currents[row]) / 1e-6 - model.jacobian[row][column]) < 1e-5, `${device.type} Jacobian ${row},${column}`);
  }
}
const pnp = transistorAt({ ...npn, type: 'PNP' }, [-4, 0, -0.7]);
assert.ok(Math.abs(pnp.currents[0] + bjt.currents[0]) < 1e-12, 'PNP duality');
const pmos = transistorAt({ ...elements[3], type: 'PMOS' }, [-4.5, 0, -3]);
assert.ok(Math.abs(pmos.currents[0] + transistorAt(elements[3], [4.5, 0, 3]).currents[0]) < 1e-12, 'PMOS duality');
assert.throws(() => validateTransistor({ ...npn, modelParams: { saturationCurrent: -1 } }), /параметры транзистора/);
const acElements = elements.map(item => item.id === 'VG' ? { ...item, type: 'V_AC' as const, value: 0.1, secondaryValue: 1000, modelParams: { sourceOffset: 3 } } : item);
const ac = solveACAnalysis(acElements, wires, { fMin: 100, fMax: 1000, points: 2, scaleType: 'linear', signals: [{ id: 'ac', plotIndex: 1, exprX: 'f', exprY: 'I(VT1)', color: '#000', enabled: true }] });
assert.ok(ac.signals['I(VT1)'][0] > 0.00009 && ac.signals['I(VT1)'][0] < 0.00012, 'MOS AC transconductance about DC operating point');
console.log('PASS: MOS Level-1, Ebers-Moll BJT, PNP/PMOS polarity, DC/linear stamps and SCM parameters.');
