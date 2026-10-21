import assert from 'node:assert/strict';
import type { ACSettings, CircuitElement, CircuitWire, TransientSettings } from '../src/types';
import { solveCircuitAC, solveCircuitTransient } from '../src/math/circuitSolver';
import { solveDCOperatingPoint } from '../src/math/dcOperatingPoint';
import { passiveLaw, validatePassiveModel } from '../src/math/passiveModel';
import { validateSimulation } from '../src/math/validateSimulation';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';

const element = (id: string, type: CircuitElement['type'], value: number, extra: Partial<CircuitElement> = {}): CircuitElement =>
  ({ id, name: id, type, value, valueStr: String(value), unit: '', x: 0, y: 0, rotation: 0, ...extra });
const wire = (a: string, ap: string, b: string, bp: string): CircuitWire =>
  ({ id: `${a}${ap}-${b}${bp}`, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
const transient = (expr: string, tMax: number, step: number): TransientSettings => ({
  tMax, step, tMaxStr: String(tMax), stepStr: String(step), eps: 1e-3,
  signals: [{ id: expr, plotIndex: 1, exprX: 't', exprY: expr, color: '#000', enabled: true }],
});
const ac = (expr: string, frequency: number): ACSettings => ({
  fMin: frequency, fMax: frequency * 1.000001, points: 2, scaleType: 'linear',
  signals: [{ id: expr, plotIndex: 1, exprX: 'f', exprY: expr, color: '#000', enabled: true }],
});
const near = (actual: number, expected: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const nonlinear = (coefficient: number): Partial<CircuitElement> =>
  ({ passiveModel: 'nonlinear', modelParams: { cubicCoefficient: coefficient } });

const resistor = [element('V', 'V_AC', 1, { secondaryValue: 1, modelParams: { sourceOffset: 2 } }),
  element('R', 'R', 10, nonlinear(0.5)), element('G', 'GND', 0)];
const resistorWires = [wire('V', '1', 'R', '1'), wire('V', '2', 'G', '1'), wire('R', '2', 'G', '1')];
const rBias = solveDCOperatingPoint(resistor, resistorWires);
near([...rBias.potentials.values()].find(value => value === 2)!, 2);
const rTransient = solveCircuitTransient(resistor, resistorWires, transient('I(R)', 0.25, 0.25));
near(rTransient.signals['I(R)'][0], 2 / 10 + 0.5 * 2 ** 3);
assert.equal(validateSimulation(resistor, resistorWires, transient('I(R)', 0.25, 0.25), rTransient).status, 'passed');
near(solveCircuitAC(resistor, resistorWires, ac('mag(I(R))', 10)).signals['mag(I(R))'][0], 1 / 10 + 3 * 0.5 * 2 ** 2);
const currentDrivenResistor = resistor.map(item => item.id === 'V' ? { ...item, type: 'I_DC' as const, value: -2,
  valueStr: '-2', modelParams: undefined } : item);
const currentResult = solveCircuitTransient(currentDrivenResistor, resistorWires, transient('U(R)', 0.1, 0.1));
const currentVoltage = currentResult.signals['U(R)'][0];
near(currentVoltage / 10 + 0.5 * currentVoltage ** 3, 2);

const capacitor = [element('V', 'I_DC', -2),
  element('C', 'C', 0.001, { ...nonlinear(0.001), initialCondition: 0 }), element('G', 'GND', 0)];
const capacitorWires = [wire('V', '1', 'C', '1'), wire('V', '2', 'G', '1'), wire('C', '2', 'G', '1')];
const cSettings = transient('I(C)', 0.001, 0.001);
const cTransient = solveCircuitTransient(capacitor, capacitorWires, cSettings);
near(cTransient.signals['I(C)'][1], (0.001 + 0.001) / 0.001);
assert.equal(validateSimulation(capacitor, capacitorWires, cSettings, cTransient).status, 'passed');
const biasedCapacitor = capacitor.map(item => item.id === 'V' ? { ...item, type: 'V_AC' as const, value: 1,
  secondaryValue: 1, modelParams: { sourceOffset: 2 } } : item);
near(solveCircuitAC(biasedCapacitor, capacitorWires, ac('mag(I(C))', 1 / (2 * Math.PI))).signals['mag(I(C))'][0], 0.001 + 3 * 0.001 * 2 ** 2);

const inductor = [element('V', 'V_DC', 1), element('L', 'L', 1, { ...nonlinear(1), initialCondition: 0 }), element('G', 'GND', 0)];
const inductorWires = [wire('V', '1', 'L', '1'), wire('V', '2', 'G', '1'), wire('L', '2', 'G', '1')];
const lSettings = transient('I(L)', 1, 1);
const lTransient = solveCircuitTransient(inductor, inductorWires, lSettings);
const root = lTransient.signals['I(L)'][1];
near(root + root ** 3, 1);
assert.equal(validateSimulation(inductor, inductorWires, lSettings, lTransient).status, 'passed');
const biasedInductor = [element('IA', 'I_AC', 1, { secondaryValue: 1, modelParams: { sourceOffset: 1 } }),
  element('L', 'L', 1, nonlinear(1)), element('G', 'GND', 0)];
const biasedInductorWires = [wire('IA', '1', 'L', '1'), wire('IA', '2', 'G', '1'), wire('L', '2', 'G', '1')];
near(solveCircuitAC(biasedInductor, biasedInductorWires, ac('mag(U(L))', 1 / (2 * Math.PI))).signals['mag(U(L))'][0], 4);

for (const [elements, wires, settings] of [[resistor, resistorWires, transient('I(R)', 0.25, 0.25)],
  [capacitor, capacitorWires, cSettings], [inductor, inductorWires, lSettings]] as const) {
  const restored = parseYamlScm(exportToYamlScm(elements, wires, settings, undefined, undefined, 'current', 'connect'));
  const original = elements.find(item => item.passiveModel === 'nonlinear')!;
  const copy = restored.elements.find(item => item.name === original.name)!;
  assert.equal(copy.passiveModel, 'nonlinear');
  assert.equal(copy.modelParams?.cubicCoefficient, original.modelParams?.cubicCoefficient);
  near(solveCircuitTransient(restored.elements, restored.wires, settings).signals[settings.signals[0].exprY][1],
    solveCircuitTransient(elements, wires, settings).signals[settings.signals[0].exprY][1]);
}
assert.throws(() => validatePassiveModel(element('R', 'R', 10, nonlinear(-1))), /коэффициент/);
assert.throws(() => solveCircuitTransient(resistor.map(item => item.id === 'R' ? { ...item, modelParams: { cubicCoefficient: -1 } } : item),
  resistorWires, transient('I(R)', 0.1, 0.1)), /коэффициент/);
near(passiveLaw(element('R', 'R', 10, nonlinear(1)), 2).derivative, 12.1);
console.log('PASS: nonlinear I(U), Q(U), Ψ(I), DC bias, transient, AC linearization and SCM round-trips.');
