import assert from 'node:assert/strict';
import { SAMPLE_CIRCUITS } from '../src/data/sampleCircuits';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import { solveCircuitTransient, solveCircuitAC, matchesSpecializedExample, getCircuitPinIds, formatEngValue } from '../src/math/circuitSolver';
import { COMPONENT_CATALOG, terminalGroupForType } from '../src/components/ComponentPalette';
import { renderComponentSymbol } from '../src/components/ComponentSymbol';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildStoredWireRoute, computeOrthogonalWirePoints, getComponentPins, isAllowedWireSegment, moveWireSegment, projectPointToWire, snapManualWirePoint, splitWireRoute } from '../src/components/SchematicEditor';
import { buildCircuitGraph } from '../src/math/circuitSolver';

assert.equal(formatEngValue(150e-6, 'с'), '150 мкс');
assert.equal(formatEngValue(200, 'В'), '200 В');
assert.equal(formatEngValue(1.5, 'А'), '1.5 А');
for (const sample of SAMPLE_CIRCUITS) {
  const content = exportToYamlScm(sample.elements, sample.wires, sample.transient);
  const parsed = parseYamlScm(content);
  assert.equal(parsed.elements.length, sample.elements.length, `${sample.id}: element count`);
  assert.equal(parsed.wires.length, sample.wires.length, `${sample.id}: wire count`);
  assert.deepEqual(parsed.elements.map(e => e.type), sample.elements.map(e => e.type), `${sample.id}: types`);
  assert.deepEqual(parsed.elements.map(e => [e.name, e.x, e.y, e.value, e.valueStr, e.secondaryValue]), sample.elements.map(e => [e.name, e.x, e.y, e.value, e.valueStr, e.secondaryValue]), `${sample.id}: parameters`);
  const ids = new Set(parsed.elements.map(e => e.id));
  assert.ok(parsed.wires.every(w => ids.has(w.fromCompId) && ids.has(w.toCompId)), `${sample.id}: connections`);
  const results = solveCircuitTransient(parsed.elements, parsed.wires, parsed.transient);
  assert.ok(results.time.length > 0 && results.time.every(Number.isFinite), `${sample.id}: time series`);
  for (const [name, values] of Object.entries(results.signals)) {
    assert.equal(values.length, results.time.length, `${sample.id}: signal ${name} length`);
    assert.ok(values.every(Number.isFinite), `${sample.id}: signal ${name} values`);
  }
}
const specializedSamples = SAMPLE_CIRCUITS.filter(sample => sample.elements.some(element => !['R', 'L', 'C', 'V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'GND', 'PORT', 'JUNCTION', 'TEXT'].includes(element.type)));
for (const sample of specializedSamples) {
  assert.equal(matchesSpecializedExample(sample.elements, sample.wires), true, `${sample.id}: original topology is supported`);
  assert.equal(matchesSpecializedExample(sample.elements, sample.wires.slice(1)), false, `${sample.id}: changed topology must be rejected`);
  assert.throws(() => solveCircuitTransient(sample.elements, sample.wires.slice(1), sample.transient), /нелинейной схемы/);
}
assert.throws(() => solveCircuitAC([], [], { fMin: 10, fMax: 1000, points: 20, scaleType: 'log', signals: [] }), /Частотный анализ/);
const connectedSample = SAMPLE_CIRCUITS[0];
const beforeGraph = buildCircuitGraph(connectedSample.elements, connectedSample.wires);
const movedElements = connectedSample.elements.map((element, index) => ({ ...element, x: element.x + index * 20, y: element.y - index * 40, rotation: (element.rotation + 90) % 360 }));
const afterGraph = buildCircuitGraph(movedElements, connectedSample.wires);
assert.deepEqual([...afterGraph.pinToNode], [...beforeGraph.pinToNode], 'Movement and rotation must preserve connectivity');
for (const wire of connectedSample.wires) {
  const from = movedElements.find(e => e.id === wire.fromCompId)!;
  const to = movedElements.find(e => e.id === wire.toCompId)!;
  const fromPin = getComponentPins(from).find(p => p.id === wire.fromPinId)!;
  const toPin = getComponentPins(to).find(p => p.id === wire.toPinId)!;
  const start = { x: from.x + fromPin.x, y: from.y + fromPin.y };
  const end = { x: to.x + toPin.x, y: to.y + toPin.y };
  const path = computeOrthogonalWirePoints(start, end, fromPin, toPin, from.type, to.type);
  assert.deepEqual(path[0], start);
  assert.deepEqual(path.at(-1), end);
  assert.ok(path.slice(1).every((point, i) => point.x === path[i].x || point.y === path[i].y), 'All wire segments must remain orthogonal');
}
const straightRoute = computeOrthogonalWirePoints({ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 30, y: 0 }, { x: -30, y: 0 });
const separatedRoute = computeOrthogonalWirePoints({ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 30, y: 0 }, { x: -30, y: 0 }, undefined, undefined, 20);
assert.notDeepEqual(separatedRoute, straightRoute, 'Parallel wires must support separate grid tracks');
assert.ok(separatedRoute.slice(1).every((point, i) => point.x === separatedRoute[i].x || point.y === separatedRoute[i].y), 'Separated wire tracks must remain orthogonal');
const editedRoute = moveWireSegment(straightRoute, 0, 20);
assert.deepEqual(editedRoute[0], straightRoute[0]);
assert.deepEqual(editedRoute.at(-1), straightRoute.at(-1));
assert.ok(editedRoute.slice(1).every((point, i) => point.x === editedRoute[i].x || point.y === editedRoute[i].y), 'Edited wire must remain orthogonal');
const diagonalEnd = snapManualWirePoint({ x: 0, y: 0 }, { x: 96, y: 102 });
assert.deepEqual(diagonalEnd, { x: 100, y: 100 }, 'Manual diagonal must snap to exactly 45 degrees');
assert.deepEqual(snapManualWirePoint({ x: 0, y: 0 }, { x: 100, y: 15 }), { x: 100, y: 0 }, 'Horizontal manual movement must not turn diagonal');
const diagonalRoute = buildStoredWireRoute({ x: 0, y: 0 }, { x: 140, y: 100 }, [diagonalEnd]);
assert.deepEqual(diagonalRoute, [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 140, y: 100 }]);
assert.deepEqual(buildStoredWireRoute({ x: 0, y: 0 }, { x: 60, y: 60 }, []), [{ x: 0, y: 0 }, { x: 60, y: 60 }], 'Split manual diagonal keeps a straight 45-degree route');
assert.ok(diagonalRoute.slice(1).every((point, i) => isAllowedWireSegment(diagonalRoute[i], point)));
const diagonalHit = projectPointToWire(diagonalRoute, { x: 43, y: 49 })!;
assert.deepEqual(diagonalHit.point, { x: 40, y: 40 }, 'Diagonal junction must lie on the visible wire');
const splitDiagonal = splitWireRoute(diagonalRoute, diagonalHit.segmentIndex, diagonalHit.point);
assert.deepEqual(splitDiagonal.first.at(-1), splitDiagonal.second[0]);
assert.deepEqual([...splitDiagonal.first, ...splitDiagonal.second.slice(1)], [diagonalRoute[0], diagonalHit.point, ...diagonalRoute.slice(1)]);
const shiftedDiagonal = moveWireSegment([{ x: 0, y: 0 }, { x: 100, y: 100 }], 0, 20);
assert.deepEqual(shiftedDiagonal[0], { x: 0, y: 0 });
assert.deepEqual(shiftedDiagonal.at(-1), { x: 100, y: 100 });
assert.ok(shiftedDiagonal.slice(1).every((point, i) => isAllowedWireSegment(shiftedDiagonal[i], point)), 'Shifted 45-degree segment must keep legal angles');
const movedManual = buildStoredWireRoute({ x: 20, y: 0 }, { x: 140, y: 120 }, [diagonalEnd]);
assert.deepEqual(movedManual[0], { x: 20, y: 0 });
assert.deepEqual(movedManual.at(-1), { x: 140, y: 120 });
assert.ok(movedManual.slice(1).every((point, i) => isAllowedWireSegment(movedManual[i], point)), 'Moved endpoints must preserve an 8-way route');
const crossingElements = [
  { id: 'A', type: 'R' as const, name: 'A', x: 0, y: 0, rotation: 0, value: 1, valueStr: '1', unit: 'Ом' },
  { id: 'B', type: 'R' as const, name: 'B', x: 100, y: 100, rotation: 0, value: 1, valueStr: '1', unit: 'Ом' },
  { id: 'C', type: 'R' as const, name: 'C', x: 0, y: 100, rotation: 0, value: 1, valueStr: '1', unit: 'Ом' },
  { id: 'D', type: 'R' as const, name: 'D', x: 100, y: 0, rotation: 0, value: 1, valueStr: '1', unit: 'Ом' },
];
const crossingWires = [
  { id: 'AB', fromCompId: 'A', fromPinId: '2', toCompId: 'B', toPinId: '1', waypoints: [{ x: 50, y: 50 }], manual: true },
  { id: 'CD', fromCompId: 'C', fromPinId: '2', toCompId: 'D', toPinId: '1', waypoints: [{ x: 50, y: 50 }], manual: true },
];
const crossingGraph = buildCircuitGraph(crossingElements, crossingWires);
assert.notEqual(crossingGraph.pinToNode.get('A_2'), crossingGraph.pinToNode.get('C_2'), 'Crossing without junction must remain disconnected');
const crossingSaved = parseYamlScm(exportToYamlScm(crossingElements, crossingWires, connectedSample.transient));
assert.deepEqual(crossingSaved.wires.map(w => w.waypoints), crossingWires.map(w => w.waypoints), 'Manual routes must survive SCM round trip');
assert.ok(crossingSaved.wires.every(w => w.manual), 'Manual route mode must survive SCM round trip');
const crossingJunction = { id: 'J', type: 'JUNCTION' as const, name: 'N1', x: 50, y: 50, rotation: 0, value: 0, valueStr: '', unit: '' };
const joinedGraph = buildCircuitGraph([...crossingElements, crossingJunction], [
  { id: 'AJ', fromCompId: 'A', fromPinId: '2', toCompId: 'J', toPinId: '1' },
  { id: 'BJ', fromCompId: 'B', fromPinId: '1', toCompId: 'J', toPinId: '1' },
  { id: 'CJ', fromCompId: 'C', fromPinId: '2', toCompId: 'J', toPinId: '1' },
  { id: 'DJ', fromCompId: 'D', fromPinId: '1', toCompId: 'J', toPinId: '1' },
]);
assert.equal(joinedGraph.pinToNode.get('A_2'), joinedGraph.pinToNode.get('C_2'), 'Explicit crossing junction must merge electrical nodes');
const isolated = connectedSample.elements.map((el, index) => index === 0 ? { ...el, isolation: 'open' as const } : el);
const isolatedRoundTrip = parseYamlScm(exportToYamlScm(isolated, connectedSample.wires, connectedSample.transient));
assert.equal(isolatedRoundTrip.elements[0].isolation, 'open', 'Isolation must survive SCM save/load');
const angled = connectedSample.elements.map((el, index) => index === 0 ? { ...el, rotation: 45 } : el);
const angledRoundTrip = parseYamlScm(exportToYamlScm(angled, connectedSample.wires, connectedSample.transient));
assert.equal(angledRoundTrip.elements[0].rotation, 45, '45-degree rotation must survive SCM save/load');
const angledPins = getComponentPins(angled[0]);
assert.ok(angledPins.some(pin => Math.abs(pin.x) > 1 && Math.abs(pin.y) > 1), '45-degree pin geometry must rotate on both axes');
for (const component of COMPONENT_CATALOG) {
  const markup = renderToStaticMarkup(renderComponentSymbol({ id: 'test', type: component.type, name: 'test', x: 0, y: 0, rotation: 0, value: 0, valueStr: '', unit: '' }));
  assert.ok(markup.length > 0, `${component.type}: symbol`);
  assert.ok(!markup.includes('r="10"'), `${component.type}: fallback symbol must not be used`);
}
for (const component of COMPONENT_CATALOG) {
  const group = terminalGroupForType(component.type);
  if (!group) continue;
  const pins = getComponentPins({ id: 'group-test', type: component.type, name: 'test', x: 0, y: 0, rotation: 0, value: 0, valueStr: '', unit: '' });
  assert.deepEqual(pins.map(pin => pin.id), getCircuitPinIds(component.type), `${component.type}: editor and electrical pin IDs agree`);
  assert.equal(group, pins.length === 2 ? 'two' : pins.length === 3 ? 'three' : pins.length === 4 ? 'four' : 'multi', `${component.type}: terminal group`);
}
const validScm = exportToYamlScm(connectedSample.elements, connectedSample.wires, connectedSample.transient);
assert.throws(() => parseYamlScm(validScm.replace(/To:\s+\{ ID: \d+, Pin: (?:"[^"]+"|\d+) \}/, 'To: { ID: 999, Pin: "1" }')), /Провод 1.*не найден/);
assert.throws(() => parseYamlScm(validScm.replace(/To:\s+\{ ID: \d+, Pin: (?:"[^"]+"|\d+) \}/, 'To: { ID: 2, Pin: "missing" }')), /Провод 1.*не найден/);
assert.throws(() => parseYamlScm(validScm.replace('  - ID: 2', '  - ID: 1')), /повторяющийся ID/);
assert.throws(() => exportToYamlScm(connectedSample.elements, [...connectedSample.wires, { id: 'broken', fromCompId: 'missing', fromPinId: '1', toCompId: connectedSample.elements[0].id, toPinId: '1' }], connectedSample.transient), /Схема не сохранена/);
assert.equal(terminalGroupForType('GND'), null, 'Reference potential is not a component group');
assert.equal(terminalGroupForType('JUNCTION'), null, 'Wire junction is not a component group');
console.log(`PASS: ${SAMPLE_CIRCUITS.length} sample file round-trips and simulations; ${COMPONENT_CATALOG.length} component symbols.`);
