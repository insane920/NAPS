import assert from 'node:assert/strict';
import { solveCircuitTransient } from '../src/math/circuitSolver';
import { validateSimulation } from '../src/math/validateSimulation';
import { SAMPLE_CIRCUITS } from '../src/data/sampleCircuits';
import type { CircuitElement, CircuitWire, TransientSettings } from '../src/types';
import { buildCalculationReport, calculationReportHtml } from '../src/math/calculationReport';
import { assembleLinearSystem, electricalElements, pulseIsHigh } from '../src/math/linearTransient';
import { buildCircuitGraph } from '../src/math/circuitSolver';
import { parseEngValue, normalizeEngNotation } from '../src/math/circuitSolver';
import { nearestSample, plotSampleIndices, timeAtPlotFraction } from '../src/math/plotGeometry';

const element = (id: string, type: CircuitElement['type'], value: number): CircuitElement => ({ id, name: id, type, value, x: 0, y: 0, rotation: 0, valueStr: String(value), unit: '' });
const wire = (a: string, ap: string, b: string, bp: string): CircuitWire => ({ id: `${a}${ap}-${b}${bp}`, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
const settings = (exprs: string[], step = 1e-5, tMax = 0.001): TransientSettings => ({ tMax, step, tMaxStr: '', stepStr: '', eps: 0.001, signals: exprs.map((exprY, i) => ({ id: String(i), exprY, exprX: 't', plotIndex: 1, color: '#000000', enabled: true })) });
const near = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
assert.equal(pulseIsHigh(100 * 6e-7, 1e-5, 0.5), true);
assert.equal(pulseIsHigh(6.5e-5, 1e-5, 0.5), false);
assert.equal(pulseIsHigh(0, 1e-5, 0), false);
for (const [input, expected] of [['0,5 мкФ', 0.5e-6], ['.5m', 0.0005], ['2.2µF', 2.2e-6], ['10 мОм', 0.01], ['1MΩ', 1e6], ['1mA', 0.001], ['20 kHz', 20000], ['3 Гн', 3], ['1e-3', 0.001]] as const) near(parseEngValue(input), expected, Math.abs(expected) * 1e-12);
for (const invalid of ['1кк', '1garbage', '1k/2', 'Infinity', '', '1e999', '0x10']) {
  assert.ok(Number.isNaN(parseEngValue(invalid)), `${invalid}: invalid nominal must not be partially parsed`);
}
for (const [input, compact] of [['1 кОм', '1к'], ['1k', '1к'], ['1к', '1к'], ['10 мГн', '10м'], ['2.2uF', '2.2мк'], ['1MΩ', '1М']] as const) {
  assert.equal(normalizeEngNotation(input), compact);
  near(parseEngValue(input), parseEngValue(compact), Math.abs(parseEngValue(input)) * 1e-12);
}
assert.equal(nearestSample([10, 100, 1000], 110), 1);
near(timeAtPlotFraction(0.5, 10, 1000, true), 100);
near(timeAtPlotFraction(0.5, 0, 10, false), 5);
const pulse = new Array(2001).fill(0); pulse[103] = 12; pulse[108] = -3;
const selectedSamples = plotSampleIndices(pulse);
assert.ok(selectedSamples.includes(103) && selectedSamples.includes(108) && selectedSamples.includes(2000));

// Unequal resistive divider and source current sign; independent Ohm's law reference.
const es = [element('V1', 'V_DC', 12), element('R1', 'R', 1000), element('R2', 'R', 2000), element('G', 'GND', 0)];
const ws = [wire('V1', '1', 'R1', '1'), wire('R1', '2', 'R2', '1'), wire('R2', '2', 'G', '1'), wire('V1', '2', 'G', '1')];
const s = settings(['U(R2)', 'I(V1)', 'P(R1)']);
const divider = solveCircuitTransient(es, ws, s);
near(divider.signals['U(R2)'][0], 8); near(divider.signals['I(V1)'][0], -0.004); near(divider.signals['P(R1)'][0], 0.016);
assert.equal(validateSimulation(es, ws, s, divider).status, 'passed');
// Same components, changed wiring: parallel resistors must both receive 12 V.
const parallel = [wire('V1', '1', 'R1', '1'), wire('V1', '1', 'R2', '1'), wire('R1', '2', 'G', '1'), wire('R2', '2', 'G', '1'), wire('V1', '2', 'G', '1')];
near(solveCircuitTransient(es, parallel, s).signals['U(R2)'][0], 12);
const shortR2 = es.map(e => e.id === 'R2' ? { ...e, isolation: 'short' as const } : e);
const shortGraph = buildCircuitGraph(shortR2, ws);
assert.equal(shortGraph.pinToNode.get('R2_1'), shortGraph.pinToNode.get('R2_2'), 'Shorted component must merge its terminal nodes');
assert.ok(!electricalElements(shortR2).some(e => e.id === 'R2'), 'Shorted component must not stamp its normal model');
near(solveCircuitTransient(shortR2, ws, s).signals['U(R2)'][0], 0);
const openR2 = es.map(e => e.id === 'R2' ? { ...e, isolation: 'open' as const } : e);
assert.ok(!electricalElements(openR2).some(e => e.id === 'R2'), 'Open component must not stamp its normal model');
assert.notEqual(buildCircuitGraph(openR2, ws).pinToNode.get('R2_1'), buildCircuitGraph(openR2, ws).pinToNode.get('R2_2'), 'Open component must not merge its terminals');
near(solveCircuitTransient(openR2, ws, s).signals['I(V1)'][0], 0);
// Independent current source, sign pin 1 -> pin 2.
const ies = [element('I1', 'I_DC', 0.002), element('R1', 'R', 1500), element('G', 'GND', 0)];
const iws = [wire('I1', '1', 'G', '1'), wire('I1', '2', 'R1', '1'), wire('R1', '2', 'G', '1')];
near(solveCircuitTransient(ies, iws, settings(['U(R1)'])).signals['U(R1)'][0], 3);

// RC step: exact Uc(t)=1-exp(-t/RC); nonzero IC is also checked.
const rc = SAMPLE_CIRCUITS.find(c => c.id === 'rc-filter')!;
const rs = { ...rc.transient, tMax: 0.002, step: 1e-6, eps: 0.001 };
const rr = solveCircuitTransient(rc.elements, rc.wires, rs);
near(rr.signals['U(OUT)'][0], 0);
rr.time.forEach((t, k) => near(rr.signals['U(OUT)'][k], 1 - Math.exp(-t / 0.001), 0.00019));
assert.equal(validateSimulation(rc.elements, rc.wires, rs, rr).status, 'passed');
const icElements = rc.elements.map(e => e.type === 'C' ? { ...e, initialCondition: 0.4 } : e);
near(solveCircuitTransient(icElements, rc.wires, rs).signals['U(OUT)'][0], 0.4);
const coarseSettings = { ...rs, step: 0.0002 };
assert.equal(validateSimulation(rc.elements, rc.wires, coarseSettings, solveCircuitTransient(rc.elements, rc.wires, coarseSettings)).status, 'failed');

// RLC exact underdamped step response: alpha=R/(2L), wd=sqrt(1/LC-alpha²).
const rlc = SAMPLE_CIRCUITS.find(c => c.id === 'rlc-oscillatory')!;
const ls = { ...rlc.transient, tMax: 0.002, step: 2e-7 };
const lr = solveCircuitTransient(rlc.elements, rlc.wires, ls);
const alpha = 5 / (2 * 0.01), wd = Math.sqrt(1 / (0.01 * 10e-6) - alpha ** 2);
lr.time.forEach((t, k) => near(lr.signals['U(OUT)'][k], 10 * (1 - Math.exp(-alpha * t) * (Math.cos(wd * t) + alpha / wd * Math.sin(wd * t))), 0.014));

// Error detection must catch corrupted results, invalid signals/topology/values.
const corrupt = structuredClone(divider); corrupt.branchCurrents.R1[0] += 0.01;
assert.equal(validateSimulation(es, ws, s, corrupt).status, 'failed');
const corruptSignal = structuredClone(divider); corruptSignal.signals['U(R2)'][0] = 42;
assert.equal(validateSimulation(es, ws, s, corruptSignal).status, 'failed');
assert.throws(() => solveCircuitTransient(es, ws, settings(['U(missing)'])), /Не найден сигнал/);
assert.throws(() => solveCircuitTransient(es, ws, { ...s, step: Infinity }), /положительные/);
assert.throws(() => solveCircuitTransient(es, ws, { ...s, tMax: 0 }), /положительные/);
assert.throws(() => solveCircuitTransient(es, ws, { ...s, tMax: 1, step: 1e-6 }), /20 000 шагов/);
assert.throws(() => solveCircuitTransient(es.map(e => e.id === 'R1' ? { ...e, value: 0 } : e), ws, s), /номинал/);
assert.throws(() => solveCircuitTransient(es.filter(e => e.type !== 'GND'), ws, s), /землю/);
assert.throws(() => solveCircuitTransient(es, [...ws, wire('missing', '1', 'R1', '1')], s), /отсутствующий/);
const floating = [...es, element('R3', 'R', 100)];
assert.throws(() => solveCircuitTransient(floating, ws, s), /вырождена/);
const buck = SAMPLE_CIRCUITS[0];
const buckResult = solveCircuitTransient(buck.elements, buck.wires, buck.transient);
assert.ok(buckResult.time.length > 0 && Object.values(buckResult.signals).every(values => values.every(Number.isFinite)));
console.log('PASS: divider, rewiring, current source, RC/RLC analytical references, initial conditions, convergence, corrupted results and invalid circuits.');

// The visible derivation must use the actual matrix and result series, including k=0.
for (const k of [0, 1, 500, rr.time.length - 1]) {
  const report = buildCalculationReport(rc.elements, rc.wires, rs, rr, k);
  near(report.signals.find(row => row.name === 'U(OUT)')!.value, rr.signals['U(OUT)'][k]);
  near(report.steps.find(row => row.name === 'I(R1)')!.value, rr.branchCurrents.R1[k]);
  assert.ok(report.steps.some(row => row.name.startsWith('Система: строка')));
  assert.ok(!report.steps.some(row => /NaN|undefined|Infinity/.test(row.substitution)));
  const graph = buildCircuitGraph(rc.elements, rc.wires), branches = electricalElements(rc.elements);
  const voltage = (e: CircuitElement, idx: number) => rr.nodeVoltages[`node_${graph.pinToNode.get(`${e.id}_1`)}`][idx] - rr.nodeVoltages[`node_${graph.pinToNode.get(`${e.id}_2`)}`][idx];
  const system = assembleLinearSystem(branches, graph, !k, rr.time[k], k ? rr.time[k] - rr.time[k - 1] : 0, Object.fromEntries(branches.map(e => [e.name, k ? voltage(e, k - 1) : 0])), Object.fromEntries(branches.map(e => [e.name, k ? rr.branchCurrents[e.name][k - 1] : 0])));
  const x = [...system.used.map(id => rr.nodeVoltages[`node_${id}`][k]), ...system.extra.map(e => rr.branchCurrents[e.name][k])];
  system.a.forEach((row, i) => near(row.reduce((sum, a, j) => sum + a * x[j], 0), system.b[i], 1e-10));
}
const htmlReport = buildCalculationReport(es, ws, s, divider, 1);
htmlReport.title = '<script>alert(1)</script>';
const html = calculationReportHtml(htmlReport, divider);
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(!html.includes('<script>'));
assert.ok(html.includes('Все точки графиков'));
assert.ok(!html.includes('проверки пройдены'));
console.log('PASS: displayed matrix residuals, selected-point formulas, signal mapping and escaped standalone HTML report.');

