import assert from 'node:assert/strict';
import { buildCircuitGraph, solveCircuitAC, solveCircuitTransient } from '../src/math/circuitSolver';
import { solveDCOperatingPoint } from '../src/math/dcOperatingPoint';
import { bindCurrentControls, replaceElementPreservingControls, validateControlledSources } from '../src/math/controlledSources';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import type { CircuitElement, CircuitWire, TransientSettings, ACSettings } from '../src/types';
import { swapElementTerminals } from '../src/utils/terminalSwap';

const e = (id: string, type: CircuitElement['type'], value = 0): CircuitElement => ({ id, name: id, type, value, valueStr: String(value), unit: '', x: 0, y: 0, rotation: 0 });
const w = (a: string, ap: string, b: string, bp: string): CircuitWire => ({ id: `${a}${ap}${b}${bp}`, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
const transient: TransientSettings = { tMax: .002, tMaxStr: '.002', step: .001, stepStr: '.001', eps: .001,
  signals: [{ id: 'out', exprX: 't', exprY: 'U(LOAD)', enabled: true, color: '#000', plotIndex: 1 }] };
const ac: ACSettings = { fMin: 10, fMax: 100, points: 2, scaleType: 'log', signals: [
  { id: 'mag', exprX: 'f', exprY: 'mag(U(LOAD))', enabled: true, color: '#000', plotIndex: 1 },
  { id: 'phase', exprX: 'f', exprY: 'phs(U(LOAD))', enabled: true, color: '#000', plotIndex: 2 },
] };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const wires = [w('VIN', '1', 'RIN', '1'), w('VIN', '2', 'G0', '1'), w('RIN', '2', 'G0', '1'),
  w('DEP', '1', 'LOAD', '1'), w('DEP', '2', 'G0', '1'), w('LOAD', '2', 'G0', '1')];
for (const [type, gain, expected] of [['VCVS', 3, 6], ['VCCS', .5, -100], ['CCVS', 50, -1], ['CCCS', 2, 4]] as const) {
  for (const sign of [-1, 1]) for (const crossingMode of ['explicit', 'connect'] as const) {
    const dependent: CircuitElement = { ...e('DEP', type, gain * sign),
      ...(['VCVS', 'VCCS'].includes(type) ? { controlVoltage: { positive: { elementId: 'VIN', pinId: '1' }, negative: { elementId: 'G0', pinId: '1' } } }
        : { controlSource: 'VIN', controlSourceId: 'VIN' }) };
    let elements = [e('VIN', 'V_DC', 2), e('RIN', 'R', 100), dependent, e('LOAD', 'R', 100), e('G0', 'GND')];
    elements = replaceElementPreservingControls(elements, { ...elements[0], name: 'RENAMED' });
    const graph = buildCircuitGraph(elements, wires);
    assert.notEqual(graph.pinToNode.get('VIN_1'), graph.pinToNode.get('G0_1'), 'probe must not merge networks');
    const saved = parseYamlScm(exportToYamlScm(elements, wires, transient, ac, undefined, 'current', crossingMode));
    assert.equal(saved.crossingMode, crossingMode);
    const out = saved.elements.find(item => item.name === 'LOAD')!;
    const loadedGraph = buildCircuitGraph(saved.elements, saved.wires);
    const dc = solveDCOperatingPoint(saved.elements, saved.wires);
    near(dc.potentials.get(loadedGraph.pinToNode.get(`${out.id}_1`)!)!, expected * sign);
    near(solveCircuitTransient(saved.elements, saved.wires, saved.transient).signals['U(LOAD)'][1], expected * sign);
    const sineElements = saved.elements.map(item => item.name === 'RENAMED' ? { ...item, type: 'V_AC' as const, secondaryValue: 50 } : item);
    const result = solveCircuitAC(sineElements, saved.wires, ac);
    near(result.signals['mag(U(LOAD))'][0], Math.abs(expected));
    near(Math.cos(result.signals['phs(U(LOAD))'][0] * Math.PI / 180), Math.sign(expected * sign));
    const dependentId = saved.elements.find(item => item.name === 'DEP')!.id;
    const reversed = swapElementTerminals(saved.elements, saved.wires, dependentId);
    near(solveCircuitTransient(reversed.elements, reversed.wires, saved.transient).signals['U(LOAD)'][1], -expected * sign);
    const reversedAc = swapElementTerminals(sineElements, saved.wires, dependentId);
    const reverseResult = solveCircuitAC(reversedAc.elements, reversedAc.wires, ac);
    near(reverseResult.signals['mag(U(LOAD))'][0], Math.abs(expected));
    near(Math.cos(reverseResult.signals['phs(U(LOAD))'][0] * Math.PI / 180), -Math.sign(expected * sign));
    // Removal followed by name reuse must not silently rebind either type of probe.
    const removed = saved.elements.filter(item => item.name !== 'RENAMED');
    removed.push(e('replacement', 'V_DC', 99)); removed.at(-1)!.name = 'RENAMED';
    assert.throws(() => validateControlledSources(removed), /управляющ/);
    const missingReload = parseYamlScm(exportToYamlScm(removed, [], transient));
    assert.throws(() => validateControlledSources(missingReload.elements), /управляющ/);
  }
}
const legacy = bindCurrentControls([e('VIN', 'V_DC', 2), { ...e('DEP', 'CCCS', 2), controlSource: 'vin' }]);
assert.equal(legacy[1].controlSourceId, 'VIN');
assert.throws(() => validateControlledSources([{ ...legacy[0], isolation: 'open' }, legacy[1]]), /изолирован/);
assert.throws(() => validateControlledSources([{ ...e('DEP', 'VCVS', 1), controlVoltage: { positive: { elementId: 'DEP', pinId: 'missing' }, negative: { elementId: 'DEP', pinId: '2' } } }]), /контакт/);
console.log('PASS: four controlled sources, signed DC/transient/AC, stable references, deletion, rename and SCM 7/8.');
