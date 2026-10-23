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
for (const drive of [1000, 1e12]) {
  const stressed = [element('I', 'I_DC', -drive), element('R', 'R', 1000, nonlinear(1)), element('G', 'GND', 0)];
  const stressedWires = [wire('I', '1', 'R', '1'), wire('I', '2', 'G', '1'), wire('R', '2', 'G', '1')];
  const voltage = [...solveDCOperatingPoint(stressed, stressedWires).potentials.values()].find(value => value > 0)!;
  near(voltage / 1000 + voltage ** 3, drive, 1e-8);
}

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

const table = (pairs: Array<[number, number]>): Partial<CircuitElement> => ({
  passiveModel: 'nonlinear', passiveLawDefinition: {
    kind: 'table', points: pairs.map(([argument, value]) => ({ argument, value })),
  },
});
const resistorCurve = table([[-2, -0.9], [-1, -0.3], [0, 0], [1, 0.3], [2, 0.9]]);
const tabulatedResistor = resistor.map(item => item.id === 'R' ? { ...item, ...resistorCurve } : item);
near(passiveLaw(tabulatedResistor[1], 1).value, 0.3);
const localDerivative = passiveLaw(tabulatedResistor[1], 0.5).derivative;
near(localDerivative, (passiveLaw(tabulatedResistor[1], 0.500001).value -
  passiveLaw(tabulatedResistor[1], 0.499999).value) / 0.000002, 1e-6);
const tableCurrentSource = tabulatedResistor.map(item => item.id === 'V' ? {
  ...item, type: 'I_DC' as const, value: -0.3, valueStr: '-0.3', modelParams: undefined,
} : item);
near(solveCircuitTransient(tableCurrentSource, resistorWires, transient('U(R)', 0.1, 0.1)).signals['U(R)'][0], 1);
const tableAcSource = tabulatedResistor.map(item => item.id === 'V' ? {
  ...item, modelParams: { sourceOffset: 1 },
} : item);
near(solveCircuitAC(tableAcSource, resistorWires, ac('mag(I(R))', 10)).signals['mag(I(R))'][0],
  passiveLaw(tabulatedResistor[1], 1).derivative);
const inverseResistor: Partial<CircuitElement> = { passiveModel: 'nonlinear', passiveLawDefinition: {
  kind: 'inverseTable', points: [[-2, -0.9], [-1, -0.3], [0, 0], [1, 0.3], [2, 0.9]]
    .map(([argument, value]) => ({ argument, value })),
} };
const inverseElement = element('RI', 'R', 10, inverseResistor);
near(passiveLaw(inverseElement, 0.3).value, 1);
near(passiveLaw(inverseElement, 0.3).derivative, 1 / 0.4);
const inverseDriven = resistor.map(item => item.id === 'R' ? { ...item, ...inverseResistor }
  : item.id === 'V' ? { ...item, type: 'I_DC' as const, value: -1, valueStr: '-1', modelParams: undefined } : item);
near(solveCircuitTransient(inverseDriven, resistorWires, transient('U(R)', 0.1, 0.1)).signals['U(R)'][0], 0.3);
const inverseAc = resistor.map(item => item.id === 'R' ? { ...item, ...inverseResistor }
  : item.id === 'V' ? { ...item, modelParams: { sourceOffset: 0.3 } } : item);
near(solveCircuitAC(inverseAc, resistorWires, ac('mag(I(R))', 10)).signals['mag(I(R))'][0], 2.5);

const capacitorCurve = table([[-2, -0.005], [-1, -0.002], [0, 0], [1, 0.002], [2, 0.005]]);
const tabulatedCapacitor = capacitor.map(item => item.id === 'C' ? { ...item, ...capacitorCurve } : item);
near(solveCircuitTransient(tabulatedCapacitor, capacitorWires, cSettings).signals['I(C)'][1], 2);
const tableCapAc = biasedCapacitor.map(item => item.id === 'C' ? { ...item, ...capacitorCurve } : item);
near(solveCircuitAC(tableCapAc, capacitorWires, ac('mag(I(C))', 1 / (2 * Math.PI))).signals['mag(I(C))'][0],
  passiveLaw(tableCapAc[1], 2).derivative);

const inductorCurve = table([[-2, -3], [-1, -1], [0, 0], [1, 1], [2, 3]]);
const tabulatedInductor = inductor.map(item => item.id === 'L' ? { ...item, ...inductorCurve } : item);
near(solveCircuitTransient(tabulatedInductor, inductorWires, lSettings).signals['I(L)'][1], 1);
const saturation: Partial<CircuitElement> = { passiveModel: 'nonlinear', passiveLawDefinition: {
  kind: 'saturation', limitingInductance: 0.2, saturationCurrent: 0.5,
} };
const saturatingInductor = element('LS', 'L', 1, saturation);
near(passiveLaw(saturatingInductor, 0).derivative, 1);
near(passiveLaw(saturatingInductor, 10).derivative, 0.2);
near(passiveLaw(saturatingInductor, 0.5).value, 0.1 + 0.4 * Math.tanh(1));
const saturatedCircuit = inductor.map(item => item.id === 'L' ? { ...item, ...saturation } : item);
const saturatedTransient = solveCircuitTransient(saturatedCircuit, inductorWires, lSettings).signals['I(L)'][1];
near(passiveLaw(saturatingInductor, saturatedTransient).value, 1);
const saturationAc = biasedInductor.map(item => item.id === 'L' ? { ...item, ...saturation } : item);
near(solveCircuitAC(saturationAc, biasedInductorWires, ac('mag(U(L))', 1 / (2 * Math.PI))).signals['mag(U(L))'][0],
  passiveLaw(saturationAc[1], 1).derivative);

const formula = (argumentScale: number, outputScale: number): Partial<CircuitElement> => ({
  passiveModel: 'nonlinear', passiveLawDefinition: {
    kind: 'expression', expression: 'n*x + y0*tanh(x/x0)', argumentScale, outputScale,
  },
});
const expressionR = resistor.map(item => item.id === 'R' ? { ...item, ...formula(1, 0.2) } : item);
const expectedCurrent = 0.2 + 0.2 * Math.tanh(2);
near(solveCircuitTransient(expressionR, resistorWires, transient('I(R)', 0.1, 0.1)).signals['I(R)'][0], expectedCurrent);
near(solveCircuitAC(expressionR, resistorWires, ac('mag(I(R))', 10)).signals['mag(I(R))'][0],
  0.1 + 0.2 * (1 - Math.tanh(2) ** 2));
const inverseVoltage = 1 + 0.2 * Math.tanh(1);
const inverseExpressionR = resistor.map(item => item.id === 'R' ? { ...item, passiveModel: 'nonlinear' as const,
  passiveLawDefinition: { kind: 'inverseExpression' as const, expression: 'n*x + y0*tanh(x/x0)',
    argumentScale: 0.1, outputScale: 0.2 } } : { ...item,
  modelParams: { ...item.modelParams, sourceOffset: inverseVoltage } });
near(passiveLaw(inverseExpressionR[1], inverseVoltage).value, 0.1);
near(passiveLaw(inverseExpressionR[1], inverseVoltage).derivative,
  1 / (10 + 2 * (1 - Math.tanh(1) ** 2)));
near(solveCircuitTransient(inverseExpressionR, resistorWires, transient('I(R)', 0.1, 0.1)).signals['I(R)'][0], 0.1);
near(solveCircuitAC(inverseExpressionR, resistorWires, ac('mag(I(R))', 10)).signals['mag(I(R))'][0],
  1 / (10 + 2 * (1 - Math.tanh(1) ** 2)));
const almostFlat = element('Rflat', 'R', 1000, { passiveModel: 'nonlinear',
  passiveLawDefinition: { kind: 'inverseExpression', expression: 'n*x - y0*tanh(x/x0)',
    argumentScale: 0.001, outputScale: 0.999 } });
validatePassiveModel(almostFlat);
const smallCurrent = 0.0001;
const smallVoltage = 1000 * smallCurrent - 0.999 * Math.tanh(smallCurrent / 0.001);
near(passiveLaw(almostFlat, smallVoltage).value, smallCurrent, 1e-9);
near(passiveLaw(almostFlat, smallVoltage).derivative,
  1 / (1000 - 999 * (1 - Math.tanh(smallCurrent / 0.001) ** 2)), 1e-8);
const expressionC = capacitor.map(item => item.id === 'C' ? { ...item, ...formula(1, 0.001) } : item);
const expressionCResult = solveCircuitTransient(expressionC, capacitorWires, cSettings);
near(expressionCResult.signals['I(C)'][1], 2);
const expressionCVoltage = solveCircuitTransient(expressionC, capacitorWires, transient('U(C)', 0.001, 0.001)).signals['U(C)'][1];
near(passiveLaw(expressionC[1], expressionCVoltage).value, 0.002, 1e-6);
const expressionL = inductor.map(item => item.id === 'L' ? { ...item, ...formula(1, 0.2) } : item);
const expressionLCurrent = solveCircuitTransient(expressionL, inductorWires, lSettings).signals['I(L)'][1];
near(passiveLaw(expressionL[1], expressionLCurrent).value, 1, 1e-6);
const expressionLAc = biasedInductor.map(item => item.id === 'L' ? { ...item, ...formula(1, 0.2) } : item);
near(solveCircuitAC(expressionLAc, biasedInductorWires, ac('mag(U(L))', 1 / (2 * Math.PI))).signals['mag(U(L))'][0],
  passiveLaw(expressionLAc[1], 1).derivative);
for (const model of [expressionR, inverseExpressionR, expressionC, expressionL]) {
  const saved = exportToYamlScm(model, model[1].type === 'R' ? resistorWires : model[1].type === 'C' ? capacitorWires : inductorWires,
    transient('I(' + model[1].name + ')', 0.1, 0.1), undefined, undefined, 'current', 'connect');
  assert.deepEqual(parseYamlScm(saved).elements[1].passiveLawDefinition, model[1].passiveLawDefinition);
}
const invalidFormula = (expression: string) => element('RF', 'R', 10, { passiveModel: 'nonlinear',
  passiveLawDefinition: { kind: 'expression', expression, argumentScale: 1, outputScale: 0.1 } });
for (const expression of ['n*x + x', 'n*x + y0*tanh(x)', 'n*x + y0*log(-x/x0)',
  'n*x + y0*evil(x/x0)', 'n*x + y0/(x/x0)', 'n*x-y0*exp(x/x0)']) {
  assert.throws(() => validatePassiveModel(invalidFormula(expression)));
}
assert.throws(() => validatePassiveModel(invalidFormula('n*x - y0*(x/x0)^3')), /дифференциальн|зависимость/);
assert.throws(() => validatePassiveModel(element('Cbad', 'C', 1, { passiveModel: 'nonlinear',
  passiveLawDefinition: { kind: 'inverseExpression', expression: 'n*x', argumentScale: 1, outputScale: 1 } })), /только для резистора/);

for (const [elements, wires, signal, settings] of [
  [tabulatedResistor, resistorWires, 'I(R)', transient('I(R)', 0.25, 0.25)],
  [inverseAc, resistorWires, 'I(R)', transient('I(R)', 0.25, 0.25)],
  [tabulatedCapacitor, capacitorWires, 'I(C)', cSettings],
  [tabulatedInductor, inductorWires, 'I(L)', lSettings],
  [saturatedCircuit, inductorWires, 'I(L)', lSettings],
] as const) {
  const saved = exportToYamlScm(elements, wires, settings, undefined, undefined, 'current', 'connect');
  const reopened = parseYamlScm(saved);
  assert.deepEqual(reopened.elements.find(item => item.passiveModel === 'nonlinear')?.passiveLawDefinition,
    elements.find(item => item.passiveModel === 'nonlinear')?.passiveLawDefinition);
  near(solveCircuitTransient(reopened.elements, reopened.wires, settings).signals[signal][1],
    solveCircuitTransient(elements, wires, settings).signals[signal][1]);
}
assert.throws(() => validatePassiveModel(element('R', 'R', 10, table([[-1, -1], [0, 0], [1, -2]]))), /таблица/);
assert.throws(() => validatePassiveModel(element('C', 'C', 1, inverseResistor)), /только для резистора/);
assert.throws(() => validatePassiveModel(element('L', 'L', 1, { passiveModel: 'nonlinear', passiveLawDefinition: {
  kind: 'saturation', limitingInductance: 2, saturationCurrent: 1,
} })), /насыщение/);
console.log('PASS: cubic, tables, dimension-checked expressions and saturation for I(U), Q(U), Ψ(I), DC, transient, AC and SCM round-trips.');
