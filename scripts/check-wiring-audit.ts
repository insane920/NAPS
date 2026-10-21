import assert from 'node:assert/strict';
import {
  buildStoredWireRoute,
  computeOrthogonalWirePoints,
  getComponentPins,
  isAllowedWireSegment,
  moveFreeWireSegment,
  moveSelectedElements,
  materializeWireCrossings,
  collapseAutomaticCrossings,
  normalizeCrossingTopology,
  projectPointToWire,
  simplifyPoints,
  snapManualWirePoint,
  type Point,
} from '../src/components/SchematicEditor';
import { buildCircuitGraph, getCircuitPinIds } from '../src/math/circuitSolver';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import { SAMPLE_CIRCUITS } from '../src/data/sampleCircuits';
import { SpatialIndex, type SpatialEntry } from '../src/utils/spatialIndex';
import type { CircuitElement, CircuitWire } from '../src/types';

const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const key = (a: Point, b: Point) => [a, b]
  .map(point => `${point.x},${point.y}`).sort().join('|');

function assertRoute(points: Point[], start: Point, end: Point, label: string) {
  assert(points.length > 0, `${label}: nonempty route`);
  assert.deepEqual(points[0], start, `${label}: exact source pin`);
  assert.deepEqual(points.at(-1), end, `${label}: exact target pin`);
  const edges = new Set<string>();
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    assert(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y), `${label}: finite coordinates`);
    assert(!close(a, b), `${label}: no zero-length segment`);
    assert(isAllowedWireSegment(a, b), `${label}: legal wire angle`);
    const edge = key(a, b);
    assert(!edges.has(edge), `${label}: no repeated visible segment`);
    edges.add(edge);
  }
}

assert.deepEqual(simplifyPoints([{ x: 0, y: 0 }, { x: 0, y: 0 }]), [{ x: 0, y: 0 }], 'duplicate pair collapses');
assert.deepEqual(computeOrthogonalWirePoints({ x: -20, y: 40 }, { x: -20, y: 40 }), [{ x: -20, y: 40 }], 'coincident terminals have no zero-length SVG segment');
assertRoute(
  computeOrthogonalWirePoints({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: -30, y: 0 }, undefined, undefined, 20, 20),
  { x: 0, y: 0 }, { x: 20, y: 0 }, 'short offset route',
);

// Fixed-seed generative checks cover short, negative, aligned and oblique endpoints.
let seed = 0x51a7e;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
for (let iteration = 0; iteration < 1000; iteration++) {
  const start = { x: (Math.floor(random() * 21) - 10) * 20, y: (Math.floor(random() * 21) - 10) * 20 };
  const end = { x: (Math.floor(random() * 21) - 10) * 20, y: (Math.floor(random() * 21) - 10) * 20 };
  const offset = (Math.floor(random() * 5) - 2) * 20;
  const route = computeOrthogonalWirePoints(start, end, { x: 30, y: 0 }, { x: -30, y: 0 }, undefined, undefined, offset, 20);
  assertRoute(route, start, end, `generated route ${iteration}`);
  const cursor = { x: start.x + (random() - 0.5) * 300, y: start.y + (random() - 0.5) * 300 };
  const waypoint = snapManualWirePoint(start, cursor, 20);
  assert(Number.isFinite(waypoint.x) && Number.isFinite(waypoint.y), 'finite manual waypoint');
  const manual = buildStoredWireRoute(start, end, [waypoint], undefined, undefined, undefined, undefined, 20);
  assertRoute(manual, start, end, `generated manual route ${iteration}`);
  if (route.length > 1) {
    const hit = projectPointToWire(route, route[0], 20);
    assert(hit && Number.isFinite(hit.distance), 'projection stays finite');
  }
}

const sample = SAMPLE_CIRCUITS[0];
const topology = (elements: typeof sample.elements, wires: typeof sample.wires) => {
  const nodes = buildCircuitGraph(elements, wires).pinToNode;
  return elements.flatMap(element => getCircuitPinIds(element.type, element)
    .map(pin => [element.name, pin, nodes.get(`${element.id}_${pin}`)]));
};
const original = topology(sample.elements, sample.wires);
const moved = sample.elements.map((element, index) => ({
  ...element, x: element.x - 400 + index * 20, y: element.y + 260, rotation: (element.rotation + 90) % 360,
}));
assert.deepEqual(topology(moved, sample.wires), original, 'movement and rotation do not change topology');
const pair = sample.elements.slice(0, 2);
const groupWire = { id: 'group-route', fromCompId: pair[0].id, fromPinId: '1', toCompId: pair[1].id, toPinId: '1', waypoints: [{ x: 120, y: 140 }, { x: 180, y: 140 }], manual: true };
const translated = moveSelectedElements(pair, [groupWire], new Set(pair.map(element => element.id)), 40, 20);
assert.deepEqual(translated.wires[0].waypoints, [{ x: 160, y: 160 }, { x: 220, y: 160 }], 'group move translates internal manual route');
assert.deepEqual(topology(translated.elements, translated.wires), topology(pair, [groupWire]), 'group move preserves electrical endpoints');
const partial = moveSelectedElements(pair, [groupWire], new Set([pair[0].id]), 40, 20);
assert.deepEqual(partial.wires[0].waypoints, [{ x: 160, y: 160 }, { x: 180, y: 140 }], 'moving one endpoint keeps the distant manual bend');
const restored = parseYamlScm(exportToYamlScm(moved, sample.wires, sample.transient));
assert.deepEqual(topology(restored.elements, restored.wires), original, 'SCM round trip keeps topology');

const directWire = { ...sample.wires[0], routeMode: 'direct' as const };
const directWires = [directWire, ...sample.wires.slice(1)];
const directScm = exportToYamlScm(sample.elements, directWires, sample.transient);
assert.match(directScm, /MajorVersion: 7/);
assert.match(directScm, /Geometry:\n  Version: 1\n  Unit: mm/);
assert.match(directScm, /RouteMode: direct/, 'direct wire mode is serialized');
const directRestored = parseYamlScm(directScm);
assert.equal(directRestored.wires[0].routeMode, 'direct', 'direct mode survives SCM reload');
assert.deepEqual(topology(directRestored.elements, directRestored.wires), original, 'direct geometry leaves electrical topology unchanged');
assert.throws(() => parseYamlScm(directScm.replace('RouteMode: direct', 'RouteMode: unknown')), /Некорректный режим/, 'invalid route mode is rejected');
assert.throws(() => parseYamlScm(directScm.replace('Unit: mm', 'Unit: px')), /SCM 7\/8 требует/, 'unknown coordinate units cannot silently scale a project');
assert.throws(() => parseYamlScm(directScm.replace('MajorVersion: 7', 'MajorVersion: 9')), /Неподдерживаемая версия/, 'future formats are rejected');
assert.equal(directRestored.crossingMode, 'explicit', 'old SCM keeps explicit-junction semantics');
const crossingElements = sample.elements.slice(0, 4).map((element, index) => ({ ...element, id: `cross_${index}`, name: `R${index + 1}` }));
const crossingWires = [
  { id: 'horizontal', fromCompId: 'cross_0', fromPinId: '1', toCompId: 'cross_1', toPinId: '1', routeMode: 'direct' as const },
  { id: 'vertical', fromCompId: 'cross_2', fromPinId: '1', toCompId: 'cross_3', toPinId: '1', routeMode: 'direct' as const },
];
const oldCrossing = parseYamlScm(exportToYamlScm(crossingElements, crossingWires, sample.transient));
assert.notEqual(buildCircuitGraph(oldCrossing.elements, oldCrossing.wires).pinToNode.get(`${oldCrossing.elements[0].id}_1`),
  buildCircuitGraph(oldCrossing.elements, oldCrossing.wires).pinToNode.get(`${oldCrossing.elements[2].id}_1`), 'old visual crossing remains separate');
const newCrossing = materializeWireCrossings(crossingElements, crossingWires, [
  { wire: crossingWires[0], points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
  { wire: crossingWires[1], points: [{ x: 0, y: -100 }, { x: 0, y: 100 }] },
], 'vertical');
assert.equal(newCrossing.elements.filter(element => element.type === 'JUNCTION').length, 1, 'crossing creates a single explicit junction');
assert.equal(newCrossing.wires.length, 4, 'both crossing wires are split');
assert.equal(buildCircuitGraph(newCrossing.elements, newCrossing.wires).pinToNode.get('cross_0_1'),
  buildCircuitGraph(newCrossing.elements, newCrossing.wires).pinToNode.get('cross_2_1'), 'crossing connects both nets');
const newScm = exportToYamlScm(newCrossing.elements, newCrossing.wires, sample.transient, undefined, undefined, 'current', 'connect');
assert.match(newScm, /MajorVersion: 8/);
const newRestored = parseYamlScm(newScm);
assert.equal(newRestored.crossingMode, 'connect');
assert.equal(buildCircuitGraph(newRestored.elements, newRestored.wires).pinToNode.get(`${newRestored.elements[0].id}_1`),
  buildCircuitGraph(newRestored.elements, newRestored.wires).pinToNode.get(`${newRestored.elements[2].id}_1`), 'v8 SCM preserves crossing connectivity');
assert.equal(newRestored.elements.filter(element => element.autoCrossing).length, 1, 'v8 retains automatic crossing provenance');
assert.equal(newRestored.wires.filter(wire => wire.originWireId).length, 4, 'v8 retains the two original conductor identities');
const reopenedRoutes = newRestored.wires.map(wire => {
  const endpoint = (id: string, pinId: string) => {
    const element = newRestored.elements.find(item => item.id === id)!;
    const pin = getComponentPins(element).find(item => item.id === pinId)!;
    return { x: element.x + pin.x, y: element.y + pin.y };
  };
  return { wire, points: [endpoint(wire.fromCompId, wire.fromPinId), ...(wire.waypoints ?? []), endpoint(wire.toCompId, wire.toPinId)] };
});
const collapsed = collapseAutomaticCrossings(newRestored.elements, newRestored.wires, reopenedRoutes);
assert.equal(collapsed.elements.length, 4, 'automatic junction can be removed before rerouting');
assert.equal(collapsed.wires.length, 2, 'split fragments reconstruct their original conductors');
const overlap = materializeWireCrossings(crossingElements, crossingWires, [
  { wire: crossingWires[0], points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
  { wire: crossingWires[1], points: [{ x: -50, y: 0 }, { x: 150, y: 0 }] },
], 'vertical');
assert.equal(overlap.elements.filter(element => element.type === 'JUNCTION').length, 1, 'overlapping conductors create a junction');
assert.equal(buildCircuitGraph(overlap.elements, overlap.wires).pinToNode.get('cross_0_1'),
  buildCircuitGraph(overlap.elements, overlap.wires).pinToNode.get('cross_2_1'), 'overlapping conductors unite their nets');
for (const [shape, horizontal, vertical] of [
  ['X', [{ x: -100, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: -100 }, { x: 0, y: 100 }]],
  ['T', [{ x: -100, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: -100 }, { x: 0, y: 0 }]],
  ['L', [{ x: -100, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 100 }]],
  ['endpoint', [{ x: -100, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 100, y: 0 }]],
] as const) {
  const connected = materializeWireCrossings(crossingElements, crossingWires, [
    { wire: crossingWires[0], points: [...horizontal] },
    { wire: crossingWires[1], points: [...vertical] },
  ], 'vertical');
  assert.equal(connected.elements.filter(element => element.autoCrossing).length, 1, `${shape} makes a junction`);
  assert.equal(buildCircuitGraph(connected.elements, connected.wires).pinToNode.get('cross_0_1'),
    buildCircuitGraph(connected.elements, connected.wires).pinToNode.get('cross_2_1'), `${shape} unites nets`);
}
const editorElements: CircuitElement[] = [
  [100, 200, 0], [500, 200, 0], [300, 50, 90], [300, 350, 90],
].map(([x, y, rotation], index) => ({ ...sample.elements[5], type: 'R' as const,
  id: `editor_${index}`, name: `R${index + 1}`, x, y, rotation }));
const editorWires: CircuitWire[] = [
  { id: 'h', fromCompId: 'editor_0', fromPinId: '2', toCompId: 'editor_1', toPinId: '1', routeMode: 'direct' as const },
  { id: 'v', fromCompId: 'editor_2', fromPinId: '2', toCompId: 'editor_3', toPinId: '1', routeMode: 'direct' as const },
];
const endpointFor = (items: CircuitElement[], id: string, pinId: string) => {
  const element = items.find(item => item.id === id)!;
  const pin = getComponentPins(element).find(item => item.id === pinId)!;
  return { x: element.x + pin.x, y: element.y + pin.y };
};
const routedFor = (items: CircuitElement[], routes: CircuitWire[]) => routes.map(wire => ({ wire,
  points: [endpointFor(items, wire.fromCompId, wire.fromPinId), ...(wire.waypoints ?? []), endpointFor(items, wire.toCompId, wire.toPinId)] }));
const normalizedCross = normalizeCrossingTopology(editorElements, editorWires, routedFor(editorElements, editorWires), 'connect');
assert.equal(normalizedCross.elements.filter(element => element.autoCrossing).length, 1, 'shared normalizer creates a crossing');
const collapsedCross = collapseAutomaticCrossings(normalizedCross.elements, normalizedCross.wires,
  routedFor(normalizedCross.elements, normalizedCross.wires));
const detouredWires = collapsedCross.wires.map(wire => wire.id === 'v' ? { ...wire,
  waypoints: [{ x: 480, y: 80 }, { x: 480, y: 320 }] } : wire);
const separated = normalizeCrossingTopology(collapsedCross.elements, detouredWires,
  routedFor(collapsedCross.elements, detouredWires), 'connect');
assert.equal(separated.elements.filter(element => element.autoCrossing).length, 0, 'moving a route away removes the electrical crossing');
assert.notEqual(buildCircuitGraph(separated.elements, separated.wires).pinToNode.get('editor_0_2'),
  buildCircuitGraph(separated.elements, separated.wires).pinToNode.get('editor_2_2'), 'separated routes become different electrical nets');
const translatedCrossingElements = collapsedCross.elements.map(element => element.id === 'editor_2' || element.id === 'editor_3'
  ? { ...element, x: element.x + 500 } : element);
const movedCross = normalizeCrossingTopology(translatedCrossingElements, collapsedCross.wires,
  routedFor(translatedCrossingElements, collapsedCross.wires), 'connect');
assert.equal(movedCross.elements.filter(element => element.autoCrossing).length, 0,
  'moving both connected components away removes the obsolete crossing');
assert.notEqual(buildCircuitGraph(movedCross.elements, movedCross.wires).pinToNode.get('editor_0_2'),
  buildCircuitGraph(movedCross.elements, movedCross.wires).pinToNode.get('editor_2_2'),
  'group movement separates the electrical nets');
const legacyMoved = normalizeCrossingTopology(editorElements, editorWires, routedFor(editorElements, editorWires), 'explicit');
assert.equal(legacyMoved.elements, editorElements, 'SCM 7 mode never normalizes visible crossings');
assert.throws(() => exportToYamlScm(sample.elements, directWires, sample.transient, undefined, undefined, 'legacy'), /не поддерживает произвольные углы/, 'legacy export never silently changes a free-angle route');
const legacyScm = exportToYamlScm(moved, sample.wires, sample.transient, undefined, undefined, 'legacy');
assert.match(legacyScm, /MajorVersion: 6/);
assert(!legacyScm.includes('Geometry:'), 'legacy copy uses the original format');
let migration = parseYamlScm(legacyScm);
for (let pass = 0; pass < 20; pass++) {
  migration = parseYamlScm(exportToYamlScm(migration.elements, migration.wires, migration.transient));
  assert.deepEqual(migration.elements.map(element => [element.x, element.y, element.rotation, element.value]), moved.map(element => [element.x, element.y, element.rotation, element.value]), 'repeated migration does not rescale coordinates or parameters');
  assert.deepEqual(topology(migration.elements, migration.wires), original, 'repeated migration preserves connectivity');
}
const arbitrary = moveFreeWireSegment([{ x: 0, y: 0 }, { x: 30, y: 10 }], 0, 20);
assert.deepEqual(arbitrary[0], { x: 0, y: 0 });
assert.deepEqual(arbitrary.at(-1), { x: 30, y: 10 });
assert.equal(arbitrary.length, 4, 'moving a free-angle segment creates two editable bends');
const editedDirect = { ...directWire, waypoints: arbitrary.slice(1, -1), manual: true };
const editedDirectScm = parseYamlScm(exportToYamlScm(sample.elements, [editedDirect], sample.transient));
assert.equal(editedDirectScm.wires[0].routeMode, 'direct');
assert.deepEqual(editedDirectScm.wires[0].waypoints, editedDirect.waypoints, 'arbitrary-angle bends survive SCM');

const controlled = { ...sample.elements[0], type: 'VCVS' as const, x: 100, y: -60 };
for (const rotation of [0, 45, 90, 180, 270]) {
  const pins = getComponentPins({ ...controlled, rotation });
  assert.deepEqual(pins.map(pin => pin.id), ['1', '2', 'ctrl_pos', 'ctrl_neg'], 'polarity pin IDs stay stable after rotation');
  const positive = pins.find(pin => pin.id === 'ctrl_pos')!;
  const negative = pins.find(pin => pin.id === 'ctrl_neg')!;
  assert.equal(positive.label, 'U+');
  assert.equal(negative.label, 'U−');
  assert(Math.abs(Math.hypot(positive.x, positive.y) - 30) < 0.001, 'positive control pin remains on the symbol boundary');
  assert(Math.abs(positive.x + negative.x) < 0.001 && Math.abs(positive.y + negative.y) < 0.001, 'U+ and U− stay opposite');
}

const boxes: SpatialEntry<number>[] = Array.from({ length: 1000 }, (_, index) => {
  const x = Math.floor(random() * 2000) - 1000;
  const y = Math.floor(random() * 2000) - 1000;
  return { minX: x, minY: y, maxX: x + 1 + Math.floor(random() * 300), maxY: y + 1 + Math.floor(random() * 300), value: index };
});
const index = new SpatialIndex(boxes);
for (let iteration = 0; iteration < 1000; iteration++) {
  const x = Math.floor(random() * 2400) - 1200;
  const y = Math.floor(random() * 2400) - 1200;
  const radius = random() * 30;
  const brute = boxes.filter(box => box.minX <= x + radius && box.maxX >= x - radius && box.minY <= y + radius && box.maxY >= y - radius).map(box => box.value).sort((a, b) => a - b);
  assert.deepEqual(index.query(x, y, radius).sort((a, b) => a - b), brute, `spatial query ${iteration}`);
}

console.log('PASS: 1000 generated wire routes, 1000 spatial queries, direct-mode SCM, topology and round trip.');
