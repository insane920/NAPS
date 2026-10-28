import assert from 'node:assert/strict';
import {
  buildStoredWireRoute,
  computeOrthogonalWirePoints,
  routeCircuitWires,
  promoteVisibleBranch,
  getComponentPins,
  isAllowedWireSegment,
  moveFreeWireSegment,
  moveSelectedElements,
  materializeWireCrossings,
  collapseAutomaticCrossings,
  normalizeCrossingTopology,
  freezeCrossingProvenance,
  removeWiresPreservingTopology,
  reconnectWireEndpoint,
  projectPointToWire,
  reanchorManualWiresForChanges,
  simplifyPoints,
  snapManualWirePoint,
  type Point,
} from '../src/components/SchematicEditor';
import { buildCircuitGraph, getCircuitPinIds } from '../src/math/circuitSolver';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import { SAMPLE_CIRCUITS } from '../src/data/sampleCircuits';
import { SpatialIndex, type SpatialEntry } from '../src/utils/spatialIndex';
import { componentObstacle, routeAroundObstacles, routeIsClear, automaticRouteCost, isOrthogonalAutomaticRoute, reanchorAutomaticRoute } from '../src/utils/orthogonalRouter';
import { mergeCoincidentAutomaticCrossings, mergeCoincidentJunctions, promoteAnchoredCrossings } from '../src/utils/junctionTopology';
import { derivedBranchMarkers, uniqueWireInk } from '../src/utils/wireInk';
import type { CircuitElement, CircuitWire } from '../src/types';

const freeCorner = routeAroundObstacles({ x: 0, y: 0 }, { x: 120, y: 80 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 20, [], [], [])!;
assert.deepEqual(freeCorner, [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 80 }], 'free contacts use one deterministic L, not a midpoint Z');
const referencePair: CircuitElement[] = [[200, 300], [600, 500]].map(([x, y], index) => ({
  id: `pair_${index}`, name: `R${index + 1}`, type: 'R', x, y, rotation: 0,
  value: 1000, valueStr: '1к', unit: 'Ом',
}));
const referenceWire: CircuitWire = { id: 'pair_wire', fromCompId: 'pair_0', fromPinId: '2',
  toCompId: 'pair_1', toPinId: '1', routeMode: 'orthogonal' };
const referenceCache = new Map<string, Point[]>();
const pairRoute = (secondY: number) => routeCircuitWires(
  referencePair.map((element, index) => index ? { ...element, y: secondY } : element),
  [referenceWire], 20, referenceCache)[0].points.map(({ x, y }) => ({ x, y }));
const offsetPair = pairRoute(500);
assert.equal(automaticRouteCost(offsetPair).bends, 2,
  'FASTMEAN reference: displaced horizontal contacts use the minimum two bends');
assert.deepEqual(pairRoute(300), [{ x: 230, y: 300 }, { x: 570, y: 300 }],
  'FASTMEAN reference: aligning two resistors collapses the route to a straight line');
assert.deepEqual(pairRoute(500), offsetPair,
  'returning the resistor to its starting position restores the same stable Z route');
const branchElements: CircuitElement[] = [
  ['A', 'R', 200, 300, 0], ['B', 'R', 600, 300, 0], ['C', 'R', 420, 100, 90], ['J', 'JUNCTION', 420, 320, 0],
].map(([id, type, x, y, rotation]) => ({ id: String(id), name: String(id), type: type as CircuitElement['type'],
  x: Number(x), y: Number(y), rotation: Number(rotation), value: 1000, valueStr: '1к', unit: 'Ом' }));
const branchWires: CircuitWire[] = [['a', 'A', '2'], ['b', 'B', '1'], ['c', 'C', '2']].map(([id, fromCompId, fromPinId]) =>
  ({ id, fromCompId, fromPinId, toCompId: 'J', toPinId: '1' }));
const branchBefore = routeCircuitWires(branchElements, branchWires, 20);
const promotedBranch = promoteVisibleBranch(branchElements, branchWires, branchBefore, { x: 420, y: 300 });
assert(promotedBranch?.junction.branchAnchor, 'clicked visual T becomes a durable electrical junction');
assert.equal(promotedBranch.wires.length, 4, 'shared suffix to the old junction is stored only once');
const branchPins = buildCircuitGraph(promotedBranch.elements, promotedBranch.wires).pinToNode;
assert.equal(new Set(['A_2', 'B_1', 'C_2', 'J_1', `${promotedBranch.junction.id}_1`].map(key => branchPins.get(key))).size, 1);
const branchCache = new Map<string, Point[]>();
for (let repetition = 0; repetition < 50; repetition++) {
  const [x, y] = [[440, 280], [460, 260], [420, 300]][repetition % 3];
  const moved = promotedBranch.elements.map(element => element.id === promotedBranch.junction.id ? { ...element, x, y } : element);
  const routes = routeCircuitWires(moved, promotedBranch.wires, 20, branchCache);
  assert(routes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
    '50 movements keep every branch orthogonal and routed');
  assert(routes.every(route => automaticRouteCost(route.points).bends <= 2),
    'FASTMEAN reference: moving the T node keeps each unobstructed branch simple');
  assert.deepEqual(derivedBranchMarkers(routes.map(route => ({ id: route.wire.id, net: 'shared', points: route.points })),
    moved.filter(element => element.type === 'JUNCTION').map(({ x, y }) => ({ x, y }))), [],
  'all four visible branches meet at the controlled junction without another T marker');
}
const promotedSaved = parseYamlScm(exportToYamlScm(promotedBranch.elements, promotedBranch.wires,
  SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect'));
assert(promotedSaved.elements.some(element => element.type === 'JUNCTION' && element.branchAnchor),
  'SCM 8 retains the user-controlled branch identity');
assert(routeCircuitWires(promotedSaved.elements, promotedSaved.wires, 20).every(route => !route.unrouted),
  'SCM 8 reload keeps every promoted branch routable');
const reversedBranchWires = branchWires.map(wire => wire.id === 'b' ? {
  ...wire, fromCompId: wire.toCompId, fromPinId: wire.toPinId,
  toCompId: wire.fromCompId, toPinId: wire.fromPinId,
} : wire);
const reversedBranch = promoteVisibleBranch(branchElements, reversedBranchWires,
  routeCircuitWires(branchElements, reversedBranchWires, 20), { x: 420, y: 300 });
assert.equal(reversedBranch?.wires.length, 4,
  'promoting a T branch removes the shared trunk even when its routes have opposite orientations');
assert.equal(new Set(['A_2', 'B_1', 'C_2', 'J_1'].map(key =>
  buildCircuitGraph(reversedBranch!.elements, reversedBranch!.wires).pinToNode.get(key))).size, 1,
  'deduplicating the reversed shared trunk keeps the electrical network intact');
assert(routeCircuitWires(reversedBranch!.elements, reversedBranch!.wires, 20)
  .every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
  'reversed T branches remain visibly routable after promotion');
const reversedBranchSaved = parseYamlScm(exportToYamlScm(reversedBranch!.elements, reversedBranch!.wires,
  SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect'));
assert.equal(reversedBranchSaved.wires.length, 4,
  'SCM 8 reload does not restore a duplicate trunk from oppositely directed T branches');
assert.equal(new Set(['A_2', 'B_1', 'C_2', 'J_1'].map(key =>
  buildCircuitGraph(reversedBranchSaved.elements, reversedBranchSaved.wires).pinToNode.get(key))).size, 1,
  'SCM 8 reload preserves the reversed T branch network');
for (let repetition = 0; repetition < 50; repetition++) {
  const [x, y] = [[440, 280], [460, 260], [420, 300]][repetition % 3];
  const moved = reversedBranchSaved.elements.map(element => element.id === reversedBranch!.junction.id
    ? { ...element, x, y } : element);
  const routes = routeCircuitWires(moved, reversedBranchSaved.wires, 20);
  assert(routes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
    'reversed T branches remain routable through repeated junction moves');
  assert.equal(new Set(['A_2', 'B_1', 'C_2', 'J_1'].map(key =>
    buildCircuitGraph(moved, reversedBranchSaved.wires).pinToNode.get(key))).size, 1,
    'reversed T branch remains one electrical network through repeated junction moves');
}
const outOfOrderNodes: CircuitElement[] = [0, 100, 300, 400].map((x, index) => ({
  id: `order_${index}`, name: `N${index}`, type: 'JUNCTION', x, y: 0,
  rotation: 0, value: 0, valueStr: '', unit: '',
}));
const orderWire = (id: string, from: number, to: number): CircuitWire => ({
  id, fromCompId: `order_${from}`, fromPinId: '1', toCompId: `order_${to}`, toPinId: '1',
  routeMode: 'orthogonal',
});
const outOfOrderWires = [orderWire('ab', 0, 1), orderWire('cd', 2, 3), orderWire('bc', 1, 2), orderWire('ac', 0, 2)];
const orderedNet = routeCircuitWires(outOfOrderNodes, outOfOrderWires, 20);
assert(orderedNet.every(route => !route.unrouted), 'file order does not block the bridge between two pieces of one electrical net');
assert.deepEqual(orderedNet.find(route => route.wire.id === 'bc')?.points.map(({ x, y }) => ({ x, y })),
  [{ x: 100, y: 0 }, { x: 300, y: 0 }], 'the bridge remains a straight visible conductor');
assert.equal(uniqueWireInk(orderedNet.map(route => ({ id: route.wire.id, net: 'same', points: route.points }))).get('ac')?.length ?? 0, 0,
  'a redundant same-net chord follows the tree without painting a geometric loop');
const mixedOrderWires = outOfOrderWires.map(wire => wire.id === 'ab' || wire.id === 'cd'
  ? { ...wire, routeMode: 'direct' as const, manual: true } : wire);
assert(routeCircuitWires(outOfOrderNodes, mixedOrderWires, 20).every(route => !route.unrouted),
  'two disjoint manual stretches of one net do not reserve each other before the automatic bridge');
const otherNetNodes: CircuitElement[] = [-60, 60].map((y, index) => ({
  id: `foreign_${index}`, name: `F${index}`, type: 'JUNCTION', x: 200, y,
  rotation: 0, value: 0, valueStr: '', unit: '',
}));
const crossingOtherNet: CircuitWire = { id: 'foreign', fromCompId: 'foreign_0', fromPinId: '1',
  toCompId: 'foreign_1', toPinId: '1', routeMode: 'direct', manual: true };
const reservedForeign = routeCircuitWires([...outOfOrderNodes, ...otherNetNodes],
  [...mixedOrderWires, crossingOtherNet], 20);
const detouredBridge = reservedForeign.find(route => route.wire.id === 'bc');
assert(detouredBridge && !detouredBridge.unrouted && detouredBridge.points.length >= 4,
  'a future manual conductor of another net is reserved before routing the bridge');
assert(routeIsClear(detouredBridge.points, [],
  [reservedForeign.find(route => route.wire.id === 'foreign')!.points]),
  'the automatic bridge never creates a false crossing with the other network');
const cachedStraight = [{ x: 100, y: 0 }, { x: 300, y: 0 }];
const movingForeignCache = new Map<string, { x: number; y: number }[]>([['bc', cachedStraight]]);
const movedForeign = routeCircuitWires([...outOfOrderNodes, ...otherNetNodes],
  [...mixedOrderWires, crossingOtherNet], 20, movingForeignCache);
const movedBridge = movedForeign.find(route => route.wire.id === 'bc');
assert(movedBridge && !movedBridge.unrouted &&
  routeIsClear(movedBridge.points, [], [movedForeign.find(route => route.wire.id === 'foreign')!.points]),
  'a cached automatic route is revalidated when another electrical net moves across it');
const clearAgainElements = [...outOfOrderNodes, ...otherNetNodes.map(element => ({ ...element, x: 500 }))];
const clearAgain = routeCircuitWires(clearAgainElements, [...mixedOrderWires, crossingOtherNet],
  20, movingForeignCache);
assert.deepEqual(clearAgain.find(route => route.wire.id === 'bc')?.points.map(({ x, y }) => ({ x, y })),
  [{ x: 100, y: 0 }, { x: 300, y: 0 }],
  'when the foreign network moves away, an automatic detour collapses to the straight route');
for (const crossingMode of ['explicit', 'connect'] as const) {
  for (const savedWires of [outOfOrderWires, mixedOrderWires]) {
    const saved = parseYamlScm(exportToYamlScm(outOfOrderNodes, savedWires, SAMPLE_CIRCUITS[0].transient,
      undefined, undefined, 'current', crossingMode));
    assert(routeCircuitWires(saved.elements, saved.wires, 20).every(route => !route.unrouted),
      `${crossingMode}: shuffled electrical network remains routable after SCM reload`);
    const pins = buildCircuitGraph(saved.elements, saved.wires).pinToNode;
    assert.equal(pins.get('order_0_1'), pins.get('order_3_1'), `${crossingMode}: one electrical network is preserved`);
  }
}
const wireTopology = (network: CircuitWire[]) => {
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    if (!parent.has(key)) parent.set(key, key);
    const current = parent.get(key)!;
    if (current !== key) parent.set(key, root(current));
    return parent.get(key)!;
  };
  for (const wire of network.filter(wire => !wire.disabled)) {
    const from = `${wire.fromCompId}_${wire.fromPinId}`;
    const to = `${wire.toCompId}_${wire.toPinId}`;
    parent.set(root(from), root(to));
  }
  const edges = network.filter(wire => !wire.disabled).length;
  const vertices = parent.size;
  const components = new Set([...parent.keys()].map(root)).size;
  return { vertices, components, cycles: edges - vertices + components };
};
const rectangleElements: CircuitElement[] = [
  ['NW', 0, 0], ['NE', 200, 0], ['SE', 200, 160], ['SW', 0, 160],
].map(([id, x, y]) => ({ id: String(id), name: String(id), type: 'JUNCTION',
  x: Number(x), y: Number(y), rotation: 0, value: 0, valueStr: '', unit: '' }));
const rectangleWires: CircuitWire[] = [
  ['top', 'NW', 'NE'], ['right', 'NE', 'SE'], ['bottom', 'SE', 'SW'], ['left', 'SW', 'NW'],
].map(([id, fromCompId, toCompId]) => ({ id, fromCompId, fromPinId: '1', toCompId, toPinId: '1' }));
assert.deepEqual(wireTopology(rectangleWires), { vertices: 4, components: 1, cycles: 1 },
  'a closed rectangle contains one independent conductor cycle');
const rectangleRoutes = routeCircuitWires(rectangleElements, rectangleWires, 20);
assert(rectangleRoutes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
  'all sides of a closed rectangle remain routed and orthogonal');
assert.equal(new Set(rectangleElements.map(element =>
  buildCircuitGraph(rectangleElements, rectangleWires).pinToNode.get(`${element.id}_1`))).size, 1,
  'the closed rectangle remains one electrical node');
const reversedTop: CircuitWire = { ...rectangleWires[0], id: 'top-reverse',
  fromCompId: 'NE', toCompId: 'NW' };
const duplicateRoutes = routeCircuitWires(rectangleElements, [...rectangleWires, reversedTop], 20);
const duplicateInk = uniqueWireInk(duplicateRoutes.map(route => ({
  id: route.wire.id, net: 'rectangle', points: route.points,
})));
assert.equal(duplicateInk.get('top-reverse')?.length ?? 0, 0,
  'a same-net segment traversed in reverse is painted only once');
assert.deepEqual(wireTopology([...rectangleWires, reversedTop]),
  { vertices: 4, components: 1, cycles: 2 },
  'paint deduplication preserves the parallel conductor in the editable topology');
for (const [x, y] of [[40, 40], [0, 0]]) {
  const moved = rectangleElements.map(element => element.id === 'NW' ? { ...element, x, y } : element);
  const routes = routeCircuitWires(moved, rectangleWires, 20);
  assert(routes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
    'moving a junction on a closed contour keeps its conductors routable');
  assert.deepEqual(wireTopology(rectangleWires), { vertices: 4, components: 1, cycles: 1 },
    'moving a junction cannot change the contour cycle rank');
  assert.equal(new Set(moved.map(element =>
    buildCircuitGraph(moved, rectangleWires).pinToNode.get(`${element.id}_1`))).size, 1,
    'moving a junction cannot split the electrical node');
}
const rectangleSaved = parseYamlScm(exportToYamlScm(rectangleElements, rectangleWires,
  SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect'));
assert.deepEqual(wireTopology(rectangleSaved.wires), { vertices: 4, components: 1, cycles: 1 },
  'SCM 8 reload preserves the independent rectangle cycle');
const twoLoopElements: CircuitElement[] = [
  ['TL', 0, 0], ['TM', 200, 0], ['TR', 400, 0],
  ['BL', 0, 160], ['BM', 200, 160], ['BR', 400, 160],
].map(([id, x, y]) => ({ id: String(id), name: String(id), type: 'JUNCTION',
  x: Number(x), y: Number(y), rotation: 0, value: 0, valueStr: '', unit: '' }));
const twoLoopWires: CircuitWire[] = [
  ['tl-tm', 'TL', 'TM'], ['tm-tr', 'TM', 'TR'], ['tr-br', 'TR', 'BR'],
  ['br-bm', 'BR', 'BM'], ['bm-bl', 'BM', 'BL'], ['bl-tl', 'BL', 'TL'],
  ['shared', 'TM', 'BM'],
].map(([id, fromCompId, toCompId]) => ({ id, fromCompId, fromPinId: '1', toCompId, toPinId: '1' }));
const twoLoopMetrics = { vertices: 6, components: 1, cycles: 2 };
assert.deepEqual(wireTopology(twoLoopWires), twoLoopMetrics,
  'two closed contours sharing one branch retain two independent cycles');
const assertUniqueVisibleInk = (routes: ReturnType<typeof routeCircuitWires>, description: string) => {
  const overrides = uniqueWireInk(routes.map(route => ({ id: route.wire.id, net: 'same', points: route.points })));
  const segments = routes.flatMap(route => overrides.has(route.wire.id) ? overrides.get(route.wire.id)! :
    route.points.slice(1).map((point, index) => [route.points[index], point] as [Point, Point]));
  for (let i = 0; i < segments.length; i++) for (let j = 0; j < i; j++) {
    const [a, b] = segments[i], [c, d] = segments[j];
    if (Math.abs(a.y - b.y) < 1e-6 && Math.abs(c.y - d.y) < 1e-6 && Math.abs(a.y - c.y) < 1e-6) {
      const overlap = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
      assert(overlap <= 1e-6, `${description}: horizontal ink has no duplicated stretch`);
    }
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(c.x - d.x) < 1e-6 && Math.abs(a.x - c.x) < 1e-6) {
      const overlap = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
      assert(overlap <= 1e-6, `${description}: vertical ink has no duplicated stretch`);
    }
  }
  return segments.reduce((length, [from, to]) => length + Math.hypot(to.x - from.x, to.y - from.y), 0);
};
const twoLoopRoutes = routeCircuitWires(twoLoopElements, twoLoopWires, 20);
assert(twoLoopRoutes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)));
assert.equal(assertUniqueVisibleInk(twoLoopRoutes, 'two-loop shared-branch network'), 1280,
  'both rectangular contours and their shared branch remain visible');
for (const order of [[...twoLoopWires].reverse(), [twoLoopWires[6], ...twoLoopWires.slice(0, 6)]]) {
  const routes = routeCircuitWires(twoLoopElements, order, 20);
  assert(routes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)));
  assert.equal(assertUniqueVisibleInk(routes, 'shuffled two-loop network'), 1280,
    'changing SCM wire order cannot erase a valid closed contour');
  assert.deepEqual(wireTopology(order), twoLoopMetrics);
}
const openedLoop = removeWiresPreservingTopology(twoLoopElements, twoLoopWires, new Set(['shared']));
assert.deepEqual(wireTopology(openedLoop.wires), { vertices: 6, components: 1, cycles: 1 },
  'deleting the shared branch leaves one outer contour rather than disconnecting the network');
assert.equal(assertUniqueVisibleInk(routeCircuitWires(openedLoop.elements, openedLoop.wires, 20),
  'shared branch removed'), 1120,
  'deleting the shared branch removes exactly that visible conductor');
assert.deepEqual(wireTopology(twoLoopWires), twoLoopMetrics,
  'deletion does not mutate the original snapshot used by undo');
assertUniqueVisibleInk(branchBefore, 'three T branches using one common segment');
assertUniqueVisibleInk(routeCircuitWires(branchElements, reversedBranchWires, 20),
  'oppositely directed T branches using one common segment');
const resistorOnLoop: CircuitElement = { id: 'loop-R', name: 'Rloop', type: 'R',
  x: 500, y: 80, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' };
const loopResistorWire: CircuitWire = { id: 'loop-load', fromCompId: 'BR', fromPinId: '1',
  toCompId: resistorOnLoop.id, toPinId: '1' };
const componentLoopWires = [...twoLoopWires, loopResistorWire];
assert.deepEqual(wireTopology(componentLoopWires), { vertices: 7, components: 1, cycles: 2 });
for (const [x, y] of [[540, 120], [500, 80]]) {
  const moved = moveSelectedElements([...twoLoopElements, resistorOnLoop], componentLoopWires,
    new Set([resistorOnLoop.id]), x - resistorOnLoop.x, y - resistorOnLoop.y);
  const routes = routeCircuitWires(moved.elements, moved.wires, 20);
  assert(routes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
    'moving a component connected to a cycle preserves routed branches');
  assertUniqueVisibleInk(routes, 'moved component on two-loop network');
  assert.deepEqual(wireTopology(moved.wires), { vertices: 7, components: 1, cycles: 2 });
}
const movedLoop = moveSelectedElements(twoLoopElements, twoLoopWires, new Set(['TM']), 20, 40);
const movedSharedJunction = movedLoop.elements;
const movedLoopRoutes = routeCircuitWires(movedLoop.elements, movedLoop.wires, 20);
assert(movedLoopRoutes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
  'moving a junction shared by two cycles retains routable branches');
assertUniqueVisibleInk(movedLoopRoutes, 'moved shared junction');
assert.deepEqual(wireTopology(movedLoop.wires), twoLoopMetrics);
const restoredLoop = moveSelectedElements(movedLoop.elements, movedLoop.wires, new Set(['TM']), -20, -40);
assert.deepEqual(restoredLoop.elements, twoLoopElements,
  'returning the shared junction restores its original document coordinates');
assert.deepEqual(routeCircuitWires(restoredLoop.elements, restoredLoop.wires, 20).map(route => route.points.map(({ x, y }) => ({ x, y }))),
  twoLoopRoutes.map(route => route.points.map(({ x, y }) => ({ x, y }))),
  'returning the shared junction restores the original loop geometry');
const cycleCache = new Map<string, Point[]>();
for (let repetition = 0; repetition < 50; repetition++) {
  const [x, y] = [[220, 40], [180, 20], [200, 0]][repetition % 3];
  const changed = twoLoopElements.map(element => element.id === 'TM' ? { ...element, x, y } : element);
  const routes = routeCircuitWires(changed, twoLoopWires, 20, cycleCache);
  assert(routes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
    '50 moves of a junction in a cyclic network never leave an unrouted branch');
  assertUniqueVisibleInk(routes, 'repeated cyclic junction movement');
  assert.deepEqual(wireTopology(twoLoopWires), twoLoopMetrics);
}
assert.deepEqual(routeCircuitWires(twoLoopElements, twoLoopWires, 20, cycleCache)
  .map(route => route.points.map(({ x, y }) => ({ x, y }))),
  twoLoopRoutes.map(route => route.points.map(({ x, y }) => ({ x, y }))),
  'returning after 50 cyclic moves restores the same visible geometry');
const movedLoopSaved = parseYamlScm(exportToYamlScm(movedSharedJunction, movedLoop.wires,
  SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect'));
assert.deepEqual(wireTopology(movedLoopSaved.wires), twoLoopMetrics,
  'SCM 8 reload preserves both shared-branch cycles after moving a junction');
assert(routeCircuitWires(movedLoopSaved.elements, movedLoopSaved.wires, 20)
  .every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
  'SCM 8 reload preserves the moved cyclic network geometry');
const gridNodes: CircuitElement[] = [
  ['g00', 0, 0], ['g10', 100, 0], ['g20', 200, 0],
  ['g01', 0, 80], ['g11', 100, 80], ['g21', 200, 80],
  ['g02', 0, 160], ['g12', 100, 160], ['g22', 200, 160],
].map(([id, x, y]) => ({ id: String(id), name: String(id), type: 'JUNCTION',
  x: Number(x), y: Number(y), rotation: 0, value: 0, valueStr: '', unit: '' }));
const gridPairs = [
  ['g00', 'g10'], ['g10', 'g20'], ['g01', 'g11'], ['g11', 'g21'],
  ['g02', 'g12'], ['g12', 'g22'], ['g00', 'g01'], ['g01', 'g02'],
  ['g10', 'g11'], ['g11', 'g12'], ['g20', 'g21'], ['g21', 'g22'],
] as const;
const gridWires: CircuitWire[] = gridPairs.map(([fromCompId, toCompId], index) => ({
  id: `grid-${index}`, fromCompId, fromPinId: '1', toCompId, toPinId: '1',
}));
assert.deepEqual(wireTopology(gridWires), { vertices: 9, components: 1, cycles: 4 },
  'a network containing T branches and an X junction has four independent cycles');
const gridRoutes = routeCircuitWires(gridNodes, gridWires, 20);
assert(gridRoutes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
  'the mixed T/X cyclic network routes every branch');
assert.equal(assertUniqueVisibleInk(gridRoutes, 'mixed T/X cyclic network'), 1080,
  'the T/X network retains every edge of its four visible cycles');
assert.equal(new Set(gridNodes.map(element =>
  buildCircuitGraph(gridNodes, gridWires).pinToNode.get(`${element.id}_1`))).size, 1,
  'all T and X junctions in the same cyclic network have one electrical node');
const gridSaved = parseYamlScm(exportToYamlScm(gridNodes, gridWires,
  SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect'));
assert.deepEqual(wireTopology(gridSaved.wires), { vertices: 9, components: 1, cycles: 4 },
  'SCM 8 reload preserves the T/X cycle rank');
const visibleTree = [
  { id: 'left', net: 'n1', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }] },
  { id: 'right', net: 'n1', points: [{ x: 40, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }] },
  { id: 'top', net: 'n1', points: [{ x: 20, y: -20 }, { x: 20, y: 20 }] },
];
assert.deepEqual(derivedBranchMarkers(visibleTree, [{ x: 20, y: 20 }]), [{ x: 20, y: 0 }], 'a shared real electrical branch is marked at its geometric T point');
assert.deepEqual(derivedBranchMarkers(visibleTree, [{ x: 20, y: 0 }]), [], 'an explicit junction is not painted twice');
assert.deepEqual(derivedBranchMarkers([...visibleTree, { id: 'other', net: 'n2', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] }], []), [],
  'a foreign electrical net at the same geometric point must not gain a false branch marker');
const mazeBoxes = [
  { left: 100, right: 160, top: -1000, bottom: 20 },
  { left: 260, right: 320, top: -20, bottom: 1000 },
  { left: 420, right: 480, top: -1000, bottom: 20 },
];
const fewestBends = routeAroundObstacles({ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, 20, [], mazeBoxes, [])!;
assert.ok(fewestBends && isOrthogonalAutomaticRoute(fewestBends));
assert.equal(automaticRouteCost(fewestBends).bends, 4, 'four-turn outside path beats a shorter path with more turns');
assert.equal(automaticRouteCost(fewestBends).length, 2600, 'minimum length within the four-turn class');
assert.deepEqual(routeAroundObstacles({ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, 20, [], [...mazeBoxes].reverse(), []), fewestBends, 'obstacle iteration order does not change routing');
const referenceRouteCost = (boxes: Array<{ left: number; right: number; top: number; bottom: number }>) => {
  type State = { x: number; y: number; direction: number; bends: number; length: number };
  const queue: State[] = [{ x: 0, y: 0, direction: -1, bends: 0, length: 0 }];
  const seen = new Set<string>();
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    queue.sort((a, b) => a.bends - b.bends || a.length - b.length);
    const current = queue.shift()!;
    const key = `${current.x},${current.y},${current.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (current.x === 120 && current.y === 80) return { bends: current.bends, length: current.length };
    for (let index = 0; index < directions.length; index++) {
      if (current.direction >= 0 && index === (current.direction ^ 1)) continue;
      const [dx, dy] = directions[index], x = current.x + dx * 20, y = current.y + dy * 20;
      if (x < -60 || x > 180 || y < -60 || y > 140) continue;
      const blocked = boxes.some(box => dx
        ? current.y > box.top && current.y < box.bottom &&
          Math.max(current.x, x) > box.left && Math.min(current.x, x) < box.right
        : current.x > box.left && current.x < box.right &&
          Math.max(current.y, y) > box.top && Math.min(current.y, y) < box.bottom);
      if (blocked) continue;
      queue.push({ x, y, direction: index,
        bends: current.bends + (current.direction >= 0 && Math.floor(current.direction / 2) !== Math.floor(index / 2) ? 1 : 0),
        length: current.length + 20 });
    }
  }
  return null;
};
for (let seed = 0; seed < 24; seed++) {
  const firstX = 20 + seed % 4 * 20, firstY = seed % 3 * 20 - 20;
  const secondX = 40 + seed * 3 % 4 * 20, secondY = 20 + seed * 5 % 3 * 20;
  const boxes = [
    { left: firstX, right: firstX + 20, top: firstY, bottom: firstY + 40 },
    { left: secondX, right: secondX + 20, top: secondY, bottom: secondY + 40 },
  ];
  const expected = referenceRouteCost(boxes);
  const actual = routeAroundObstacles({ x: 0, y: 0 }, { x: 120, y: 80 },
    { x: 0, y: 0 }, { x: 0, y: 0 }, 20, [], boxes, []);
  assert.deepEqual(actual && automaticRouteCost(actual), expected,
    `bounded router must match an independent exhaustive grid for obstacle layout ${seed}`);
}
let movingAutomatic = [{ x: 230, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 500 }, { x: 570, y: 500 }];
for (let repeat = 0; repeat < 30; repeat++) for (const end of [{ x: 570, y: 340 }, { x: 650, y: 340 }, { x: 490, y: 340 }, { x: 570, y: 500 }]) {
  movingAutomatic = routeAroundObstacles(movingAutomatic[0], end, { x: 1, y: 0 }, { x: -1, y: 0 }, 20, reanchorAutomaticRoute(movingAutomatic, movingAutomatic[0], end), [], [])!;
  assert.equal(automaticRouteCost(movingAutomatic).bends, 2, 'repeated moves do not accumulate corners');
  assert.ok(isOrthogonalAutomaticRoute(movingAutomatic));
}

const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
  const point = (t: number) => ({ x: t * Math.cos(angle * Math.PI / 180), y: t * Math.sin(angle * Math.PI / 180) });
  const inkRoutes = [
    { id: 'first', net: 'one', points: [point(0), point(100)] },
    { id: 'overlap', net: 'one', points: [point(50), point(150), point(75)] },
    { id: 'foreign', net: 'two', points: [point(0), point(100)] },
  ];
  const untouched = structuredClone(inkRoutes);
  const ink = uniqueWireInk(inkRoutes);
  assert(!ink.has('first') && !ink.has('foreign'), 'independent electrical nets keep separate visible geometry');
  const retained = ink.get('overlap')!;
  assert.equal(retained.length, 1, `${angle}°: partial overlap and reverse backtrack are painted once`);
  assert(close(retained[0][0], point(100)) && close(retained[0][1], point(150)), `${angle}°: exact uncovered stretch`);
  assert.deepEqual(inkRoutes, untouched, 'render minimization never changes manual geometry or topology');
}
const coincidentNodes: CircuitElement[] = [
  ['left', 0, 0], ['a', 100, 0], ['b', 100, 0], ['right', 200, 0],
].map(([id, x, y]) => ({ id: String(id), name: String(id), type: 'JUNCTION',
  x: Number(x), y: Number(y), rotation: 0, value: 0, valueStr: '', unit: '' }));
const coincidentWires: CircuitWire[] = [
  { id: 'one', fromCompId: 'left', fromPinId: '1', toCompId: 'a', toPinId: '1',
    routeMode: 'direct', manual: true, waypoints: [{ x: 40, y: 40 }] },
  { id: 'two', fromCompId: 'b', fromPinId: '1', toCompId: 'right', toPinId: '1',
    routeMode: 'direct', manual: true, waypoints: [{ x: 160, y: 40 }] },
];
const legacyNodes = mergeCoincidentJunctions(coincidentNodes, coincidentWires, 'explicit');
assert.equal(legacyNodes.elements, coincidentNodes, 'SCM 7 coincident junctions keep separate topology');
assert.notEqual(buildCircuitGraph(legacyNodes.elements, legacyNodes.wires).pinToNode.get('left_1'),
  buildCircuitGraph(legacyNodes.elements, legacyNodes.wires).pinToNode.get('right_1'));
const connectedNodes = mergeCoincidentJunctions(coincidentNodes, coincidentWires, 'connect');
assert.equal(connectedNodes.elements.length, 3, 'SCM 8 has one explicit marker per coincident point');
assert.equal(connectedNodes.wires[1].fromCompId, 'a');
assert.deepEqual(connectedNodes.wires[0].waypoints, coincidentWires[0].waypoints,
  'deduplication preserves manual routes');
assert.equal(buildCircuitGraph(connectedNodes.elements, connectedNodes.wires).pinToNode.get('left_1'),
  buildCircuitGraph(connectedNodes.elements, connectedNodes.wires).pinToNode.get('right_1'));
const savedNodes = parseYamlScm(exportToYamlScm(coincidentNodes, coincidentWires, SAMPLE_CIRCUITS[0].transient,
  undefined, undefined, 'current', 'connect'));
assert.equal(savedNodes.elements.length, 3, 'SCM 8 import merges repeated explicit nodes');
assert.deepEqual(savedNodes.wires.map(wire => wire.waypoints?.length), [1, 1]);
const savedLegacyNodes = parseYamlScm(exportToYamlScm(coincidentNodes, coincidentWires, SAMPLE_CIRCUITS[0].transient,
  undefined, undefined, 'current', 'explicit'));
assert.equal(savedLegacyNodes.elements.length, 4, 'SCM 7 import retains coincident nodes');
const blockingElements: CircuitElement[] = [80, 140].map((x, index) => ({
  id: `block_${index}`, name: `R${index + 1}`, type: 'R', x, y: 0,
  rotation: index ? 45 : 0, value: 1000, valueStr: '1к', unit: 'Ом',
}));
const blocks = blockingElements.map(element => componentObstacle(element)!);
const competingNet = [[{ x: 110, y: -60 }, { x: 110, y: 30 }]];
const safePath = routeAroundObstacles({ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 0 }, 20, [{ x: 0, y: 0 }, { x: 220, y: 0 }], blocks, competingNet);
assert(safePath && safePath.length >= 4, 'multiple obstacles and a foreign network require a detour');
assert.deepEqual(safePath[0], { x: 0, y: 0 });
assert.deepEqual(safePath.at(-1), { x: 220, y: 0 });
assert(safePath[1].x > safePath[0].x && safePath[1].y === safePath[0].y, 'route exits the source terminal outward');
assert(routeIsClear(safePath, blocks, competingNet), 'detour avoids all bodies and the other electrical network');
assert.equal(routeAroundObstacles({ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 0 }, 20, safePath, blocks, competingNet), safePath, 'valid existing geometry is not rebuilt');
const rotatedSource = { ...blockingElements[0], x: 0, y: 0, rotation: 45 };
const rotatedPin = getComponentPins(rotatedSource).find(pin => pin.id === '2')!;
const rotatedBox = componentObstacle(rotatedSource)!;
const rotatedStart = { x: rotatedPin.x, y: rotatedPin.y };
const outward = { x: rotatedStart.x + Math.SQRT1_2 * 20, y: rotatedStart.y + Math.SQRT1_2 * 20 };
assert(routeIsClear([rotatedStart, outward], [rotatedBox], []),
  '45° terminal lead is outside its rotated component body');
const groupBefore = [
  { ...blockingElements[0], id: 'group_a', name: 'RA', x: 0, y: 0, rotation: 0 },
  { ...blockingElements[0], id: 'group_b', name: 'RB', x: 160, y: 40, rotation: 90 },
];
const groupAfter = groupBefore.map(element => ({ ...element, rotation: 45 }));
const betweenGroup: CircuitWire = { id: 'group_route', fromCompId: 'group_a', fromPinId: '2',
  toCompId: 'group_b', toPinId: '1', manual: true, routeMode: 'direct',
  waypoints: [{ x: 50, y: 20 }] };
const terminalDelta = (before: CircuitElement, after: CircuitElement, pinId: string) => {
  const oldPin = getComponentPins(before).find(pin => pin.id === pinId)!;
  const newPin = getComponentPins(after).find(pin => pin.id === pinId)!;
  return { x: after.x + newPin.x - before.x - oldPin.x,
    y: after.y + newPin.y - before.y - oldPin.y };
};
const groupDeltas = [terminalDelta(groupBefore[0], groupAfter[0], '2'),
  terminalDelta(groupBefore[1], groupAfter[1], '1')];
const groupAnchored = reanchorManualWiresForChanges([betweenGroup], groupBefore.map((before, index) => ({
  before, after: groupAfter[index],
})))[0];
assert.deepEqual(groupAnchored.waypoints?.[0], {
  x: 50 + (groupDeltas[0].x + groupDeltas[1].x) / 2,
  y: 20 + (groupDeltas[0].y + groupDeltas[1].y) / 2,
}, 'one manual bend follows the midpoint of both rotated terminals exactly once');
assert.equal(buildCircuitGraph(groupAfter, [groupAnchored]).pinToNode.get('group_a_2'),
  buildCircuitGraph(groupAfter, [groupAnchored]).pinToNode.get('group_b_1'),
  'group rotation preserves the electrical endpoints');
const groupRestored = parseYamlScm(exportToYamlScm(groupAfter, [groupAnchored], SAMPLE_CIRCUITS[0].transient,
  undefined, undefined, 'current', 'connect'));
assert.deepEqual(groupRestored.wires[0].waypoints, groupAnchored.waypoints,
  'group rotation preserves the manual bend across SCM 8 save and load');
const multiBend = { ...betweenGroup, waypoints: [{ x: 50, y: 20 }, { x: 90, y: 60 }, { x: 130, y: 20 }] };
const multiAnchored = reanchorManualWiresForChanges([multiBend], groupBefore.map((before, index) => ({
  before, after: groupAfter[index],
})))[0];
assert.deepEqual(multiAnchored.waypoints?.[1], multiBend.waypoints?.[1],
  'group rotation keeps interior user bend fixed');
const denseBlocks = Array.from({ length: 90 }, (_, index) => ({
  ...blockingElements[0], id: `dense_${index}`, x: 50 + index % 10 * 40,
  y: -180 + Math.floor(index / 10) * 40,
})).map(element => componentObstacle(element)!);
const remoteBlocks = Array.from({ length: 500 }, (_, index) => ({
  ...blockingElements[0], id: `remote_${index}`, x: 5000 + index * 35, y: 5000 + index * 17,
})).map(element => componentObstacle(element)!);
const denseStart = Date.now();
const denseRoute = routeAroundObstacles({ x: 0, y: 0 }, { x: 450, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 0 }, 20, [{ x: 0, y: 0 }, { x: 450, y: 0 }],
  [...denseBlocks, ...remoteBlocks], [[{ x: 220, y: -240 }, { x: 220, y: -190 }]]);
assert(denseRoute && routeIsClear(denseRoute, [...denseBlocks, ...remoteBlocks],
  [[{ x: 220, y: -240 }, { x: 220, y: -190 }]]), 'dense route avoids 90 local and 500 remote bodies');
assert(Date.now() - denseStart < 10000, 'dense route search remains bounded');
const irregularBlocks = Array.from({ length: 130 }, (_, index) => ({
  left: 80 + index * 2.1, right: 90 + index * 2.1,
  top: -100 + index * 1.3, bottom: -80 + index * 1.3,
}));
const budgetStart = Date.now();
const budgetRoute = routeAroundObstacles({ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 0 }, 20, [{ x: 0, y: 0 }, { x: 500, y: 0 }], irregularBlocks, []);
assert.equal(budgetRoute, null,
  'a dense irregular layout beyond the visibility-grid budget refuses an unproven exterior detour');
assert(Date.now() - budgetStart < 1000, 'budget refusal is bounded independently of the Cartesian grid');
const enclosedRoute = [[{ x: 10, y: -200 }, { x: 10, y: 200 }]];
assert.equal(routeAroundObstacles({ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 0 }, 20, [{ x: 0, y: 0 }, { x: 500, y: 0 }], irregularBlocks, enclosedRoute), null,
  'budget refusal never bypasses a foreign network blocking the terminal lead');
assert.equal(routeAroundObstacles({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 0 }, 20, [{ x: 0, y: 0 }, { x: 200, y: 0 }],
  [{ left: 0, right: 15, top: -5, bottom: 5 }], []), null,
  'blocked terminal reports failure instead of returning an invalid baseline');
const shortLead = routeAroundObstacles({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 0 }, 20, [], [{ left: 5, right: 15, top: -5, bottom: 5 }], []);
assert.ok(shortLead && routeIsClear(shortLead, [{ left: 5, right: 15, top: -5, bottom: 5 }], []),
  'a safe short lead can turn before an obstacle; a full grid-length stub is not mandatory');
const reconnectElements: CircuitElement[] = ['A', 'B', 'C', 'D'].map((name, index) => ({
  id: name, name, type: 'JUNCTION', x: index * 100, y: 0, rotation: 0, value: 0, valueStr: '', unit: '',
}));
const reconnectWires: CircuitWire[] = [
  { id: 'ab', fromCompId: 'A', fromPinId: '1', toCompId: 'B', toPinId: '1', manual: true, waypoints: [{ x: 40, y: 20 }, { x: 60, y: 20 }] },
  { id: 'cd', fromCompId: 'C', fromPinId: '1', toCompId: 'D', toPinId: '1' },
];
const reconnectRoutes = reconnectWires.map(wire => ({ wire, points: wire.id === 'ab'
  ? [{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 60, y: 20 }, { x: 100, y: 0 }]
  : [{ x: 200, y: 0 }, { x: 300, y: 0 }] }));
const toPin = reconnectWireEndpoint(reconnectElements, reconnectWires, reconnectRoutes, 'ab', 'to', { kind: 'pin', compId: 'C', pinId: '1' });
assert.equal(toPin.wires[0].toCompId, 'C');
assert.deepEqual(toPin.wires[0].waypoints, reconnectWires[0].waypoints, 'manual bends survive reconnection');
let reconnectNodes = buildCircuitGraph(toPin.elements, toPin.wires).pinToNode;
assert.equal(reconnectNodes.get('A_1'), reconnectNodes.get('D_1'), 'target network joined');
assert.notEqual(reconnectNodes.get('B_1'), reconnectNodes.get('A_1'), 'old terminal separated');
const detached = reconnectWireEndpoint(reconnectElements, reconnectWires, reconnectRoutes, 'ab', 'to', { kind: 'free', point: { x: 120, y: 80 } });
assert.equal(detached.wires[0].disabled, true, 'free endpoint is visibly and electrically disconnected');
reconnectNodes = buildCircuitGraph(detached.elements, detached.wires).pinToNode;
assert.notEqual(reconnectNodes.get('A_1'), reconnectNodes.get('B_1'));
const toNetwork = reconnectWireEndpoint(reconnectElements, reconnectWires, reconnectRoutes, 'ab', 'to',
  { kind: 'wire', wireId: 'cd', segmentIndex: 0, point: { x: 240, y: 0 } });
assert.equal(toNetwork.elements.length, reconnectElements.length + 1, 'joining wire creates an explicit node');
assert.equal(toNetwork.wires.length, 3, 'target route splits into two preserved branches');
reconnectNodes = buildCircuitGraph(toNetwork.elements, toNetwork.wires).pinToNode;
assert.equal(reconnectNodes.get('A_1'), reconnectNodes.get('D_1'));
assert.equal(parseYamlScm(exportToYamlScm(toNetwork.elements, toNetwork.wires, SAMPLE_CIRCUITS[0].transient,
  undefined, undefined, 'current', 'explicit')).crossingMode, 'explicit', 'SCM 7 keeps explicit crossings');
const overlappingTargets = Array.from({ length: 40 }, (_, index) => ({
  ...blockingElements[0], id: `target_${index}`, name: `TARGET${index}`, x: 400, y: 200, rotation: 0,
}));
const reconnectStressElements = [...reconnectElements, ...overlappingTargets];
for (const target of overlappingTargets) {
  const result = reconnectWireEndpoint(reconnectStressElements, reconnectWires, reconnectRoutes, 'ab', 'to',
    { kind: 'pin', compId: target.id, pinId: '1' });
  const graph = buildCircuitGraph(result.elements, result.wires).pinToNode;
  assert.equal(graph.get('A_1'), graph.get(`${target.id}_1`), 'explicit target identity wins among coincident contacts');
  for (const other of overlappingTargets) if (other.id !== target.id) {
    assert.notEqual(graph.get('A_1'), graph.get(`${other.id}_1`), 'unselected coincident contacts remain disconnected');
  }
  assert.notEqual(graph.get('A_1'), graph.get('B_1'), 'old endpoint is detached on every reconnection');
  assert.deepEqual(result.wires[0].waypoints, reconnectWires[0].waypoints, 'reconnection stress preserves manual bends');
  for (const mode of ['explicit', 'connect'] as const) {
    const reloaded = parseYamlScm(exportToYamlScm(result.elements, result.wires, SAMPLE_CIRCUITS[0].transient,
      undefined, undefined, 'current', mode));
    const ids = new Map(reloaded.elements.map(element => [element.name, element.id]));
    const restoredGraph = buildCircuitGraph(reloaded.elements, reloaded.wires).pinToNode;
    assert.equal(restoredGraph.get(`${ids.get('A')}_1`), restoredGraph.get(`${ids.get(target.name)}_1`),
      `${mode}: reconnection target survives round-trip among overlapping contacts`);
  }
}
const key = (a: Point, b: Point) => [a, b]
  .map(point => `${point.x},${point.y}`).sort().join('|');

// One conductor crosses many initially separate networks. Removing the
// intersection must restore every original network, including after SCM reload.
const stressElements: CircuitElement[] = [];
const stressWires: CircuitWire[] = [];
const stressNode = (id: string, x: number, y: number) => {
  stressElements.push({ id, name: id, type: 'JUNCTION', x, y, rotation: 0,
    value: 0, valueStr: '', unit: '' });
};
stressNode('bus_start', 0, 0); stressNode('bus_end', 1620, 0);
stressWires.push({ id: 'stress_bus', fromCompId: 'bus_start', fromPinId: '1', toCompId: 'bus_end',
  toPinId: '1', routeMode: 'direct', manual: true });
for (let index = 0; index < 80; index++) {
  stressNode(`top_${index}`, 20 + index * 20, -40);
  stressNode(`bottom_${index}`, 20 + index * 20, 40);
  stressWires.push({ id: `vertical_${index}`, fromCompId: `top_${index}`, fromPinId: '1',
    toCompId: `bottom_${index}`, toPinId: '1', routeMode: 'direct', manual: true });
}
const stressRoutes = (elements: CircuitElement[], wires: CircuitWire[]) => {
  const positions = new Map(elements.map(element => [element.id, { x: element.x, y: element.y }]));
  return wires.map(wire => ({ wire, points: [positions.get(wire.fromCompId)!,
    ...(wire.waypoints ?? []), positions.get(wire.toCompId)!] }));
};
const stressTime = Date.now();
const denseConnected = normalizeCrossingTopology(stressElements, stressWires,
  stressRoutes(stressElements, stressWires), 'connect');
const stressGraph = buildCircuitGraph(denseConnected.elements, denseConnected.wires).pinToNode;
assert.equal(new Set(stressElements.map(element => stressGraph.get(`${element.id}_1`))).size, 1,
  '80 crossed networks become a single electrical net');
const stressSCM = parseYamlScm(exportToYamlScm(denseConnected.elements, denseConnected.wires,
  SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect'));
const stressBase = collapseAutomaticCrossings(stressSCM.elements, stressSCM.wires,
  stressRoutes(stressSCM.elements, stressSCM.wires));
const stressMovedElements = stressBase.elements.map(element => element.name.startsWith('bus_')
  ? { ...element, y: -80 } : element);
const stressSeparated = normalizeCrossingTopology(stressMovedElements, stressBase.wires,
  stressRoutes(stressMovedElements, stressBase.wires), 'connect');
const separatedGraph = buildCircuitGraph(stressSeparated.elements, stressSeparated.wires).pinToNode;
assert.equal(new Set(stressSeparated.elements.map(element => separatedGraph.get(`${element.id}_1`))).size, 81,
  'moving the bus away after SCM reload restores all 81 independent networks');
assert.equal(stressSeparated.elements.filter(element => element.autoCrossing).length, 0,
  'no obsolete crossing marker remains');
const stressLegacy = normalizeCrossingTopology(stressElements, stressWires,
  stressRoutes(stressElements, stressWires), 'explicit');
assert.equal(stressLegacy.elements, stressElements, 'SCM 7 does not reinterpret dense geometric crossings');
assert.equal(new Set(stressElements.map(element => buildCircuitGraph(stressLegacy.elements,
  stressLegacy.wires).pinToNode.get(`${element.id}_1`))).size, 81);
assert(Date.now() - stressTime < 10000, 'dense crossing normalization has a bounded regression budget');

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
const anchoredElements: CircuitElement[] = [
  ['west', -100, 0], ['east', 100, 0], ['north', 0, -100], ['south', 0, 100], ['spur', 0, -200],
].map(([id, x, y]) => ({ id: String(id), name: String(id), type: 'JUNCTION',
  x: Number(x), y: Number(y), rotation: 0, value: 0, valueStr: '', unit: '' }));
const anchoredWires: CircuitWire[] = [
  { id: 'horizontal-anchor', fromCompId: 'west', fromPinId: '1', toCompId: 'east', toPinId: '1', routeMode: 'direct' },
  { id: 'vertical-anchor', fromCompId: 'north', fromPinId: '1', toCompId: 'south', toPinId: '1', routeMode: 'direct' },
];
const derivedAnchor = materializeWireCrossings(anchoredElements, anchoredWires, [
  { wire: anchoredWires[0], points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
  { wire: anchoredWires[1], points: [{ x: 0, y: -100 }, { x: 0, y: 100 }] },
], anchoredWires[1].id);
const originalAuto = derivedAnchor.elements.find(element => element.autoCrossing)!;
const duplicateAuto: CircuitElement = { ...originalAuto, id: 'duplicate-auto', name: 'Nduplicate' };
const duplicatedFragments = derivedAnchor.wires.map((wire, index) => index !== 0 ? wire : {
  ...wire,
  toCompId: wire.toCompId === originalAuto.id ? duplicateAuto.id : wire.toCompId,
  fromCompId: wire.fromCompId === originalAuto.id ? duplicateAuto.id : wire.fromCompId,
});
const repairedAuto = mergeCoincidentAutomaticCrossings([...derivedAnchor.elements, duplicateAuto],
  duplicatedFragments, 'connect');
assert.equal(repairedAuto.elements.filter(element => element.autoCrossing).length, 1,
  'two coincident automatic markers become one without freezing route provenance');
assert.equal(repairedAuto.wires.filter(wire => wire.originWireId).length, derivedAnchor.wires.length);
assert(repairedAuto.wires.every(wire => wire.fromCompId !== duplicateAuto.id && wire.toCompId !== duplicateAuto.id));
assert.equal(buildCircuitGraph(repairedAuto.elements, repairedAuto.wires).pinToNode.get('west_1'),
  buildCircuitGraph(repairedAuto.elements, repairedAuto.wires).pinToNode.get('north_1'));
const repairedImport = parseYamlScm(exportToYamlScm([...derivedAnchor.elements, duplicateAuto],
  duplicatedFragments, sample.transient, undefined, undefined, 'current', 'connect'));
assert.equal(repairedImport.elements.filter(element => element.autoCrossing).length, 1,
  'SCM 8 import repairs duplicate derived markers while keeping one electrical net');
assert.equal(mergeCoincidentAutomaticCrossings([...derivedAnchor.elements, duplicateAuto],
  duplicatedFragments, 'explicit').elements.length, derivedAnchor.elements.length + 1,
  'SCM 7 keeps its original explicit crossing semantics');
const remoteElements = derivedAnchor.elements.map(element => ({ ...element,
  id: `remote_${element.id}`, name: `remote_${element.name}`, x: element.x + 500 }));
const remoteWires = derivedAnchor.wires.map(wire => ({ ...wire, id: `remote_${wire.id}`,
  fromCompId: `remote_${wire.fromCompId}`, toCompId: `remote_${wire.toCompId}`,
  originWireId: wire.originWireId ? `remote_${wire.originWireId}` : undefined,
  waypoints: wire.waypoints?.map(point => ({ x: point.x + 500, y: point.y })) }));
const isolatedCut = removeWiresPreservingTopology([...derivedAnchor.elements, ...remoteElements],
  [...derivedAnchor.wires, ...remoteWires], new Set([derivedAnchor.wires[0].id]));
assert.equal(isolatedCut.elements.filter(element => element.autoCrossing).length, 1,
  'cutting one crossing must not turn an unrelated automatic crossing into a permanent junction');
assert.equal(isolatedCut.wires.filter(wire => wire.originWireId).length, remoteWires.length,
  'an unrelated conductor family keeps provenance needed for future rerouting');
const autoAnchor = derivedAnchor.elements.find(element => element.autoCrossing)!;
const branch: CircuitWire = { id: 'user-branch', fromCompId: 'spur', fromPinId: '1',
  toCompId: autoAnchor.id, toPinId: '1', routeMode: 'direct' };
const anchoredState = { elements: derivedAnchor.elements,
  wires: [...derivedAnchor.wires, branch] };
const anchoredRoutes = anchoredState.wires.map(wire => {
  const point = (id: string) => {
    const element = anchoredState.elements.find(item => item.id === id)!;
    return { x: element.x, y: element.y };
  };
  return { wire, points: [point(wire.fromCompId), ...(wire.waypoints ?? []), point(wire.toCompId)] };
});
const stableAnchor = normalizeCrossingTopology(anchoredState.elements, anchoredState.wires, anchoredRoutes, 'connect');
assert(stableAnchor.elements.some(element => element.id === autoAnchor.id && !element.autoCrossing),
  'a user branch promotes its automatic target to a durable explicit node');
assert(stableAnchor.wires.every(wire => stableAnchor.elements.some(element => element.id === wire.fromCompId) &&
  stableAnchor.elements.some(element => element.id === wire.toCompId)), 'normalization never leaves dangling branch endpoints');
assert(!stableAnchor.wires.some(wire => wire.originWireId), 'anchored conductor families become independently editable');
const anchorGraph = buildCircuitGraph(stableAnchor.elements, stableAnchor.wires).pinToNode;
assert.equal(anchorGraph.get('spur_1'), anchorGraph.get('west_1'), 'the explicit branch remains electrically connected');
const anchoredReload = parseYamlScm(exportToYamlScm(anchoredState.elements, anchoredState.wires,
  sample.transient, undefined, undefined, 'current', 'connect'));
assert(anchoredReload.wires.every(wire => anchoredReload.elements.some(element => element.id === wire.fromCompId) &&
  anchoredReload.elements.some(element => element.id === wire.toCompId)), 'SCM 8 import repairs anchored crossing provenance');
const explicitAtCrossing: CircuitElement = { ...anchoredElements[4], id: 'user-junction', name: 'Nuser', x: 0, y: 0 };
const explicitAnchor = promoteAnchoredCrossings([...anchoredState.elements, explicitAtCrossing],
  anchoredState.wires, 'connect');
assert(explicitAnchor.elements.some(element => element.id === explicitAtCrossing.id), 'a user-named node survives automatic-node promotion');
assert(!explicitAnchor.elements.some(element => element.id === autoAnchor.id), 'coincident automatic marker is removed');
assert(explicitAnchor.wires.some(wire => wire.id === branch.id && wire.toCompId === explicitAtCrossing.id));
assert.equal(promoteAnchoredCrossings(anchoredState.elements, anchoredState.wires, 'explicit').elements,
  anchoredState.elements, 'SCM 7 does not reinterpret automatic metadata');
const overlap = materializeWireCrossings(crossingElements, crossingWires, [
  { wire: crossingWires[0], points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
  { wire: crossingWires[1], points: [{ x: -50, y: 0 }, { x: 150, y: 0 }] },
], 'vertical');
assert.equal(overlap.elements.filter(element => element.type === 'JUNCTION').length, 1, 'overlapping conductors create a junction');
assert.equal(buildCircuitGraph(overlap.elements, overlap.wires).pinToNode.get('cross_0_1'),
  buildCircuitGraph(overlap.elements, overlap.wires).pinToNode.get('cross_2_1'), 'overlapping conductors unite their nets');
const thirdWire = { id: 'diagonal', fromCompId: 'cross_4', fromPinId: '1', toCompId: 'cross_5', toPinId: '1', routeMode: 'direct' as const };
const threeElements = [...crossingElements, ...[4, 5].map(index => ({ ...crossingElements[0], id: `cross_${index}`, name: `R${index + 1}` }))];
const threeRouted = [
  { wire: crossingWires[0], points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
  { wire: crossingWires[1], points: [{ x: 0, y: -100 }, { x: 0, y: 100 }] },
  { wire: thirdWire, points: [{ x: -100, y: -100 }, { x: 100, y: 100 }] },
];
const tripleCross = normalizeCrossingTopology(threeElements, [...crossingWires, thirdWire], threeRouted, 'connect');
assert.equal(tripleCross.elements.filter(element => element.autoCrossing).length, 1,
  'three routes meeting at one position share a single visible junction');
assert.equal(buildCircuitGraph(tripleCross.elements, tripleCross.wires).pinToNode.get('cross_0_1'),
  buildCircuitGraph(tripleCross.elements, tripleCross.wires).pinToNode.get('cross_4_1'),
  'three conductors meeting at one location become one electrical net');
const tripleRoundTrip = parseYamlScm(exportToYamlScm(tripleCross.elements, tripleCross.wires, sample.transient,
  undefined, undefined, 'current', 'connect'));
assert.equal(tripleRoundTrip.elements.filter(element => element.autoCrossing).length, 1,
  'a shared three-wire junction survives SCM round-trip');
const cutFragment = tripleCross.wires.find(wire => wire.fromCompId === 'cross_4' || wire.toCompId === 'cross_4')!;
const cutWires = tripleCross.wires.filter(wire => wire.id !== cutFragment.id);
assert.notEqual(buildCircuitGraph(tripleCross.elements, cutWires).pinToNode.get('cross_4_1'),
  buildCircuitGraph(tripleCross.elements, cutWires).pinToNode.get('cross_0_1'),
  'removing one branch fragment disconnects only its removed endpoint');
const cutTopology = removeWiresPreservingTopology(tripleCross.elements, tripleCross.wires, new Set([cutFragment.id]));
assert.equal(cutTopology.wires.length, tripleCross.wires.length - 1);
assert(!cutTopology.elements.some(element => element.autoCrossing),
  'an explicitly cut automatic intersection becomes a stable editable junction');
assert(!cutTopology.wires.some(wire => wire.originWireId),
  'an incomplete wire family cannot block later intersection normalization');
assert.notEqual(buildCircuitGraph(cutTopology.elements, cutTopology.wires).pinToNode.get('cross_4_1'),
  buildCircuitGraph(cutTopology.elements, cutTopology.wires).pinToNode.get('cross_0_1'),
  'cutting a branch fragment splits the electrical network');
const cutRoundTrip = parseYamlScm(exportToYamlScm(cutTopology.elements, cutTopology.wires, sample.transient,
  undefined, undefined, 'current', 'connect'));
const cutNames = new Map(cutRoundTrip.elements.map(element => [element.name, element.id]));
const cutGraph = buildCircuitGraph(cutRoundTrip.elements, cutRoundTrip.wires).pinToNode;
assert.notEqual(cutGraph.get(`${cutNames.get('R5')}_1`), cutGraph.get(`${cutNames.get('R1')}_1`),
  'SCM reload does not resurrect the removed electrical branch');
assert(!cutRoundTrip.wires.some(wire => wire.originWireId), 'the cut remains independent after SCM reload');
const frozenIsolation = freezeCrossingProvenance(tripleCross.elements, tripleCross.wires, new Set([cutFragment.id]));
assert(!frozenIsolation.elements.some(element => element.autoCrossing) &&
  !frozenIsolation.wires.some(wire => wire.originWireId), 'an isolated fragment also freezes the split topology');
const multipleCrossings = normalizeCrossingTopology(threeElements, [...crossingWires, thirdWire], [
  { wire: crossingWires[0], points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
  { wire: crossingWires[1], points: [{ x: -50, y: -100 }, { x: -50, y: 100 }] },
  { wire: thirdWire, points: [{ x: 50, y: -100 }, { x: 50, y: 100 }] },
], 'connect');
assert.equal(multipleCrossings.elements.filter(element => element.autoCrossing).length, 2,
  'one conductor crossing two separate nets creates two distinct junctions');
const multiAnchor = multipleCrossings.elements.find(element => element.autoCrossing && element.x < 0)!;
const multiSpur: CircuitElement = { ...anchoredElements[4], id: 'multi-spur', name: 'multi-spur',
  x: multiAnchor.x, y: multiAnchor.y - 100 };
const multiBranch: CircuitWire = { id: 'multi-user-branch', fromCompId: multiSpur.id, fromPinId: '1',
  toCompId: multiAnchor.id, toPinId: '1', routeMode: 'direct' };
const multiPromoted = promoteAnchoredCrossings([...multipleCrossings.elements, multiSpur],
  [...multipleCrossings.wires, multiBranch], 'connect');
assert.equal(multiPromoted.elements.filter(element => element.autoCrossing).length, 0,
  'a user branch freezes every derived crossing in connected conductor families');
assert(!multiPromoted.wires.some(wire => wire.originWireId),
  'transitively anchored fragments cannot later collapse through a user branch');
assert.equal(buildCircuitGraph(multiPromoted.elements, multiPromoted.wires).pinToNode.get('multi-spur_1'),
  buildCircuitGraph(multiPromoted.elements, multiPromoted.wires).pinToNode.get('cross_5_1'),
  'all three crossing conductor families remain electrically joined');
const originalEnds = new Map<string, { x: number; y: number }>([
  ['cross_0', { x: -100, y: 0 }], ['cross_1', { x: 100, y: 0 }],
  ['cross_2', { x: -50, y: -100 }], ['cross_3', { x: -50, y: 100 }],
  ['cross_4', { x: 50, y: -100 }], ['cross_5', { x: 50, y: 100 }],
]);
const multiroutes = multipleCrossings.wires.map(wire => ({ wire, points: [
  originalEnds.get(wire.fromCompId) ?? multipleCrossings.elements.find(element => element.id === wire.fromCompId)!,
  ...(wire.waypoints ?? []),
  originalEnds.get(wire.toCompId) ?? multipleCrossings.elements.find(element => element.id === wire.toCompId)!,
] }));
const multipleCollapsed = collapseAutomaticCrossings(multipleCrossings.elements, multipleCrossings.wires, multiroutes);
assert.equal(multipleCollapsed.wires.length, 3, 'multi-crossing conductors reconstruct without losing endpoints');
const detouredRoutes = multipleCollapsed.routes.map(item => item.wire.id === crossingWires[0].id
  ? { ...item, points: [{ x: -100, y: 0 }, { x: -100, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 0 }] }
  : item);
const movedAwayFromNets = normalizeCrossingTopology(multipleCollapsed.elements, multipleCollapsed.wires, detouredRoutes, 'connect');
assert.equal(movedAwayFromNets.elements.filter(element => element.autoCrossing).length, 0,
  'dragging one conductor away from two networks removes both automatic junctions');
assert.notEqual(buildCircuitGraph(movedAwayFromNets.elements, movedAwayFromNets.wires).pinToNode.get('cross_0_1'),
  buildCircuitGraph(movedAwayFromNets.elements, movedAwayFromNets.wires).pinToNode.get('cross_2_1'),
  'both crossed electrical networks separate after the detour');
const returnedRoutes = movedAwayFromNets.wires.map(wire => ({ wire,
  points: wire.id === crossingWires[0].id
    ? [{ x: -100, y: 0 }, { x: -100, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 0 }]
    : multipleCollapsed.routes.find(item => item.wire.id === wire.id)!.points }));
const movedAcrossNets = normalizeCrossingTopology(movedAwayFromNets.elements, movedAwayFromNets.wires, returnedRoutes, 'connect');
assert.equal(movedAcrossNets.elements.filter(element => element.autoCrossing).length, 2,
  'dragging the conductor back across two networks recreates exactly two junctions');
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

const automaticInputs = editorWires.map(wire => ({ ...wire, manual: false, routeMode: 'orthogonal' as const, waypoints: undefined }));
const automaticCross = normalizeCrossingTopology(editorElements, automaticInputs,
  routedFor(editorElements, editorWires).map((route, index) => ({ ...route, wire: automaticInputs[index] })), 'connect');
assert.ok(automaticCross.wires.every(wire => wire.originRoute && !wire.originRoute.manual), 'split automatic branches retain original constraint provenance');
const crossNode = automaticCross.elements.find(element => element.autoCrossing)!;
const frozenCross = freezeCrossingProvenance(automaticCross.elements, automaticCross.wires,
  new Set(automaticCross.wires.filter(wire => wire.fromCompId === crossNode.id || wire.toCompId === crossNode.id).map(wire => wire.id)));
const movedCrossNode = frozenCross.elements.map(element => element.id === crossNode.id
  ? { ...element, x: element.x + 40, y: element.y + 40, autoCrossing: undefined, branchAnchor: true } : element);
const movedCrossRoutes = routeCircuitWires(movedCrossNode, frozenCross.wires, 20);
assert(movedCrossRoutes.every(route => !route.unrouted && isOrthogonalAutomaticRoute(route.points)),
  'moving an SCM 8 automatic X junction keeps all four branches orthogonal and routed');
assert.equal(new Set(editorElements.map(element => buildCircuitGraph(movedCrossNode, frozenCross.wires)
  .pinToNode.get(`${element.id}_${element.id === 'editor_0' || element.id === 'editor_2' ? '2' : '1'}`))).size, 1,
  'moving an automatic X junction preserves the electrical network');
const movedCrossSaved = parseYamlScm(exportToYamlScm(movedCrossNode, frozenCross.wires,
  SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect'));
assert.deepEqual(routeCircuitWires(movedCrossSaved.elements, movedCrossSaved.wires, 20)
  .map(route => route.points.map(({ x, y }) => ({ x, y }))),
  movedCrossRoutes.map(route => route.points.map(({ x, y }) => ({ x, y }))),
  'SCM 8 reopening preserves the moved X junction and all four routes');
const persistedCross = parseYamlScm(exportToYamlScm(automaticCross.elements, automaticCross.wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect'));
const automaticRestored = collapseAutomaticCrossings(persistedCross.elements, persistedCross.wires, routedFor(persistedCross.elements, persistedCross.wires));
assert.equal(automaticRestored.wires.length, 2);
assert.ok(automaticRestored.wires.every(wire => wire.manual === false && wire.routeMode === 'orthogonal' && !wire.waypoints?.length), 'SCM round trip + removal of intersection restores automatic routing, not pinned fragments');


const distantElements = editorElements.map(e => ({ ...e, id: e.id + '_far', name: e.name + '_far', x: e.x + 1000 }));
const distantWires = editorWires.map(w => ({ ...w, id: w.id + '_far', fromCompId: w.fromCompId + '_far', toCompId: w.toCompId + '_far', waypoints: w.waypoints?.map(p => ({x:p.x+1000,y:p.y})) }));
const bothElements = [...editorElements, ...distantElements], bothWires = [...editorWires, ...distantWires];
const twoCrossings = normalizeCrossingTopology(bothElements, bothWires, routedFor(bothElements, bothWires), 'connect');
assert.equal(twoCrossings.elements.filter(e=>e.autoCrossing).length, 2);
const damagedWires = twoCrossings.wires.filter((_,index)=>index!==0);
const recoveredGroups = collapseAutomaticCrossings(twoCrossings.elements, damagedWires, routedFor(twoCrossings.elements, damagedWires));
assert.equal(recoveredGroups.elements.filter(e=>e.autoCrossing).length, 0, 'incomplete origin freezes locally; the complete distant crossing is still collapsed');
assert.equal(recoveredGroups.elements.filter(e=>e.type==='JUNCTION').length, 1, 'only the damaged cluster remains as an explicit physical junction');
assert.ok(recoveredGroups.wires.some(w=>w.id==='h_far') && recoveredGroups.wires.some(w=>w.id==='v_far'), 'unrelated original conductors remain editable');
const repairedTopology = normalizeCrossingTopology(twoCrossings.elements, damagedWires, routedFor(twoCrossings.elements, damagedWires), 'connect');
const graphBeforeRepair=buildCircuitGraph(twoCrossings.elements,damagedWires), graphAfterRepair=buildCircuitGraph(repairedTopology.elements,repairedTopology.wires);
const physicalPins=bothElements.flatMap(e=>getComponentPins(e).map(p=>e.id+'_'+p.id));
for(const a of physicalPins)for(const b of physicalPins)assert.equal(graphBeforeRepair.pinToNode.get(a)===graphBeforeRepair.pinToNode.get(b),graphAfterRepair.pinToNode.get(a)===graphAfterRepair.pinToNode.get(b),'repair never guesses a deleted connection');

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
const legacyCut = removeWiresPreservingTopology(editorElements, editorWires, new Set(['v']));
assert.equal(legacyCut.elements, editorElements, 'cutting a legacy SCM wire never rewrites its components');
assert.deepEqual(legacyCut.wires.map(wire => wire.id), ['h'], 'legacy wire deletion leaves the other route intact');
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



for (const sample of SAMPLE_CIRCUITS) {
  const routed = routeCircuitWires(sample.elements, sample.wires, 20);
  assert.equal(routed.filter(route => route.unrouted).length, 0, sample.id + ': contacts reserved before routing prevent later branches being trapped');
  for (const route of routed.filter(route => !route.wire.manual && route.wire.routeMode !== 'direct')) {
    assert.ok(isOrthogonalAutomaticRoute(route.points), sample.id + ': no hidden 180-degree reversal');
    const graph = buildCircuitGraph(sample.elements, sample.wires);
    const node = graph.pinToNode.get(route.wire.fromCompId + '_' + route.wire.fromPinId);
    const foreignPins = sample.elements.flatMap(e => getComponentPins(e).filter(p => graph.pinToNode.get(e.id + '_' + p.id) !== node).map(p => [{x:e.x+p.x,y:e.y+p.y},{x:e.x+p.x,y:e.y+p.y}]));
    assert.ok(routeIsClear(route.points, [], foreignPins), sample.id + ': automatic route cannot cover a foreign terminal');
  }
}

// Automatic geometry is a snapshot, never a user constraint. Exercise real editor routing + SCM.
const snapshotElements: CircuitElement[] = [
  { id: 'snapshot-a', name: 'A', type: 'R', x: 200, y: 300, rotation: 0, value: 1000, valueStr: '1k', unit: 'Ohm' },
  { id: 'snapshot-b', name: 'B', type: 'R', x: 600, y: 500, rotation: 0, value: 1000, valueStr: '1k', unit: 'Ohm' },
];
const snapshotWire: CircuitWire = { id: 'snapshot', fromCompId: 'snapshot-a', fromPinId: '2', toCompId: 'snapshot-b', toPinId: '1' };
const initialSnapshot = routeCircuitWires(snapshotElements, [snapshotWire], 20)[0].points.map(({x,y}) => ({x,y}));
for (const mode of ['explicit', 'connect'] as const) {
  const text = exportToYamlScm(snapshotElements, [{ ...snapshotWire, autoRoute: initialSnapshot }], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', mode);
  const loaded = parseYamlScm(text);
  assert.deepEqual(loaded.wires[0].autoRoute, initialSnapshot, 'automatic snapshot round trips in mm');
  assert.deepEqual(routeCircuitWires(loaded.elements, loaded.wires, 20)[0].points.map(({x,y}) => ({x,y})), initialSnapshot);
  const moved = loaded.elements.map((e, i) => i === 1 ? { ...e, y: 340 } : e);
  const rerouted = routeCircuitWires(moved, loaded.wires, 20)[0];
  assert.equal(rerouted.unrouted, false);
  assert.equal(automaticRouteCost(rerouted.points).bends, 2, 'stored automatic corners do not become pinned after reopening');
  assert.equal(loaded.wires[0].manual, undefined);
}
assert.throws(() => exportToYamlScm(snapshotElements, [{ ...snapshotWire, autoRoute: [{x:230,y:300},{x:570,y:500}] }], SAMPLE_CIRCUITS[0].transient), /автомат|трасс/i, 'invalid diagonal automatic snapshots cannot be saved');

console.log('PASS: 1000 generated wire routes, 1000 spatial queries, direct-mode SCM, topology and round trip.');
