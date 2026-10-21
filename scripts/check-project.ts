import assert from 'node:assert/strict';
import { readRecovery, writeRecovery, RECOVERY_KEY, PREVIOUS_RECOVERY_KEY } from '../src/utils/projectRecovery';
import { SAMPLE_CIRCUITS } from '../src/data/sampleCircuits';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import { solveCircuitTransient, solveCircuitAC, getCircuitPinIds, formatEngValue } from '../src/math/circuitSolver';
import { topologyTypes } from '../src/math/topologyTransient';
import { COMPONENT_CATALOG, terminalGroupForType } from '../src/components/ComponentPalette';
import { renderComponentSymbol } from '../src/components/ComponentSymbol';
import { getComponentLabelLayout, getComponentValueLabel } from '../src/utils/componentLabels';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildStoredWireRoute, computeOrthogonalWirePoints, getComponentPins, isAllowedWireSegment, moveWireSegment, projectPointToWire, reanchorManualWires, snapManualWirePoint, splitWireRoute, wireGapDashArray } from '../src/components/SchematicEditor';
import { buildCircuitGraph } from '../src/math/circuitSolver';
import { nextComponentName } from '../src/utils/componentNames';
import { paperSize, parsePrintLayout, computePrintPlacement, SCHEMATIC_UNITS_PER_MM } from '../src/utils/printLayout';
import { rasterPagePdf } from '../src/utils/rasterPdf';
import { DEFAULT_CHIP_PINS } from '../src/utils/chipPins';

const recoveryData = new Map<string, string>();
let storageFailed = false;
const recoveryStorage = {
  getItem: (key: string) => recoveryData.get(key) ?? null,
  setItem: (key: string, value: string) => { if (storageFailed) throw new Error('Quota exceeded'); recoveryData.set(key, value); },
  removeItem: (key: string) => { recoveryData.delete(key); },
};
const recoveryContent = exportToYamlScm(SAMPLE_CIRCUITS[0].elements, SAMPLE_CIRCUITS[0].wires, SAMPLE_CIRCUITS[0].transient);
writeRecovery(recoveryStorage, { version: 1, name: 'First', content: recoveryContent, savedAt: 1 });
writeRecovery(recoveryStorage, { version: 1, name: 'Second', content: recoveryContent, savedAt: 2 });
assert.equal(readRecovery(recoveryStorage)?.name, 'Second');
assert.ok(recoveryData.has(PREVIOUS_RECOVERY_KEY));
recoveryData.set(RECOVERY_KEY, '{broken');
assert.equal(readRecovery(recoveryStorage)?.name, 'First', 'corrupt latest copy falls back to previous valid SCM');
storageFailed = true;
assert.throws(() => writeRecovery(recoveryStorage, { version: 1, name: 'Failed', content: recoveryContent, savedAt: 3 }));
assert.equal(readRecovery(recoveryStorage)?.name, 'First', 'quota failure preserves the last valid recovery');
storageFailed = false;
assert.throws(() => writeRecovery(recoveryStorage, { version: 1, name: 'Bad', content: 'invalid', savedAt: 4 }));
assert.equal(readRecovery(recoveryStorage)?.name, 'First');

assert.deepEqual(paperSize({ format: 'A4', orientation: 'landscape', gridMm: 5 }), { widthMm: 297, heightMm: 210, width: 1188, height: 840 });
assert.deepEqual(paperSize({ format: 'A3', orientation: 'portrait', gridMm: 5 }), { widthMm: 297, heightMm: 420, width: 1188, height: 1680 });
assert.equal(20 / SCHEMATIC_UNITS_PER_MM, 5, 'One existing schematic grid cell is 5 mm');
assert.deepEqual(parsePrintLayout(), { format: 'A4', orientation: 'landscape', gridMm: 5 }, 'Legacy SCM defaults to A4');
assert.deepEqual(parseYamlScm(exportToYamlScm([], [], SAMPLE_CIRCUITS[0].transient, undefined, { format: 'A3', orientation: 'portrait', gridMm: 2.5 })).printLayout, { format: 'A3', orientation: 'portrait', gridMm: 2.5 });
assert.throws(() => parsePrintLayout('A2', 'portrait'), /Формат листа/);
for (const step of [1, 2, 2.5, 5, 10]) {
  assert.equal(parsePrintLayout('A4', 'landscape', step).gridMm, step);
}
const hundredMm = { x: -120, y: 80, width: 100 * SCHEMATIC_UNITS_PER_MM, height: 4 };
const a4Layout = { format: 'A4', orientation: 'landscape', gridMm: 5 } as const;
const oneToOne = computePrintPlacement(hundredMm, a4Layout, 5, 'actual');
const oneToTwo = computePrintPlacement(hundredMm, a4Layout, 5, 'actual', 0.5);
const twoToOne = computePrintPlacement(hundredMm, a4Layout, 5, 'actual', 2);
assert.equal(twoToOne.scale, 2, '2:1 paper scale doubles physical schematic dimensions');
assert.equal(oneToOne.scale * hundredMm.width / SCHEMATIC_UNITS_PER_MM, 100);
assert.equal(oneToTwo.scale * hundredMm.width / SCHEMATIC_UNITS_PER_MM, 50);
assert.ok(oneToOne.fits && oneToTwo.fits);
const wideScheme = { x: -1000, y: -500, width: 2400, height: 1600 };
assert.equal(computePrintPlacement(wideScheme, a4Layout, 5, 'actual').fits, false, '1:1 never silently shrinks oversized schematics');
const fitted = computePrintPlacement(wideScheme, a4Layout, 5, 'fit');
assert.ok(fitted.fits);
assert.ok(wideScheme.width * fitted.scale <= fitted.width - 10 * SCHEMATIC_UNITS_PER_MM);
assert.ok(wideScheme.height * fitted.scale <= fitted.height - 10 * SCHEMATIC_UNITS_PER_MM);
const paperPdf = await rasterPagePdf(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 3508, 2480, 297, 210);
const pdfText = await paperPdf.text();
assert.ok(pdfText.startsWith('%PDF-1.4'));
assert.match(pdfText, /\/MediaBox \[0 0 841\.889[0-9]* 595\.275[0-9]*\]/);
assert.match(pdfText, /\/Width 3508 \/Height 2480/);
for (const [format, orientation, widthPt, heightPt] of [
  ['A4', 'portrait', 595.275, 841.889],
  ['A3', 'landscape', 1190.551, 841.889],
  ['A3', 'portrait', 841.889, 1190.551],
] as const) {
  const sheet = paperSize({ format, orientation, gridMm: 5 });
  const pdf = await rasterPagePdf(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 100, 100, sheet.widthMm, sheet.heightMm);
  assert.ok((await pdf.text()).includes(`/MediaBox [0 0 ${widthPt}`), `${format} ${orientation}: physical PDF width`);
  assert.ok((await pdf.text()).includes(`${heightPt}`), `${format} ${orientation}: physical PDF height`);
}
const customChip = { id: 'CHIP1', type: 'CHIP' as const, name: 'DD1', x: 80, y: 80, rotation: 90, value: 0, valueStr: '', unit: '', chipPins: DEFAULT_CHIP_PINS.slice(0, 4).map((pin, index) => ({ ...pin, label: `A${index}`, number: String(index + 11) })) };
const chipCircuit = [customChip, { id: 'R1', type: 'R' as const, name: 'R1', x: 160, y: 80, rotation: 0, value: 100, valueStr: '100', unit: 'Ом' }];
const chipWire = [{ id: 'chip-wire', fromCompId: 'CHIP1', fromPinId: 'p1', toCompId: 'R1', toPinId: '1' }];
const chipSaved = parseYamlScm(exportToYamlScm(chipCircuit, chipWire, SAMPLE_CIRCUITS[0].transient));
assert.deepEqual(chipSaved.elements[0].chipPins, customChip.chipPins);
assert.equal(chipSaved.wires[0].fromPinId, 'p1');
assert.deepEqual(getComponentPins(chipSaved.elements[0]).map(pin => pin.id), customChip.chipPins.map(pin => pin.id));
assert.throws(() => solveCircuitTransient(chipSaved.elements, chipSaved.wires, chipSaved.transient), /нет расчётной модели/i);

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
  if (parsed.elements.some(e => !topologyTypes.has(e.type))) {
    assert.throws(() => solveCircuitTransient(parsed.elements, parsed.wires, parsed.transient), /нет расчётной модели/);
  } else if (sample.id === 'buck-converter') {
    // Its control pin is not connected in the bundled drawing.
    assert.throws(() => solveCircuitTransient(parsed.elements, parsed.wires, parsed.transient), /подключите управляющий вывод gate/);
  } else {
    const results = solveCircuitTransient(parsed.elements, parsed.wires, parsed.transient);
    assert.ok(results.time.length > 0 && results.time.every(Number.isFinite), `${sample.id}: time series`);
    for (const [name, values] of Object.entries(results.signals)) {
      assert.equal(values.length, results.time.length, `${sample.id}: signal ${name} length`);
      assert.ok(values.every(Number.isFinite), `${sample.id}: signal ${name} values`);
    }
  }
}
assert.throws(() => solveCircuitAC([], [], { fMin: 10, fMax: 1000, points: 20, scaleType: 'log', signals: [] }), /землю/);
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
const fineRoute = computeOrthogonalWirePoints({ x: 0, y: 0 }, { x: 120, y: 80 }, undefined, undefined, undefined, undefined, 0, 10);
const coarseRoute = computeOrthogonalWirePoints({ x: 0, y: 0 }, { x: 120, y: 80 }, undefined, undefined, undefined, undefined, 0, 40);
assert.equal(fineRoute[1].x, 60, '2.5 mm grid controls automatic wire bends');
assert.equal(coarseRoute[1].x, 80, '10 mm grid controls automatic wire bends');
assert.deepEqual(projectPointToWire([{ x: 0, y: 0 }, { x: 120, y: 0 }], { x: 55, y: 2 }, 10)?.point, { x: 60, y: 0 }, 'Junction snaps to selected 2.5 mm grid');
assert.deepEqual(projectPointToWire([{ x: 0, y: 0 }, { x: 120, y: 0 }], { x: 55, y: 2 }, 40)?.point, { x: 40, y: 0 }, 'Junction snaps to selected 10 mm grid');
const rotatedStart = { x: 21.213, y: 21.213 };
const exactTerminalRoute = computeOrthogonalWirePoints(rotatedStart, { x: 120.5, y: 80.5 }, undefined, undefined, undefined, undefined, 0, 10);
assert.deepEqual(exactTerminalRoute[0], rotatedStart, '45-degree terminal must not be rounded away from its visible position');
assert.deepEqual(exactTerminalRoute.at(-1), { x: 120.5, y: 80.5 });
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
const anchorBefore = { id: 'A', type: 'R' as const, name: 'R1', x: 0, y: 0, rotation: 0, value: 1, valueStr: '1', unit: 'Ом' };
const sourcePins = getComponentPins({ ...anchorBefore, type: 'V_DC' });
assert.deepEqual(sourcePins.map(pin => [pin.id, pin.name, pin.label]), [['1', '+', '+'], ['2', '−', '−']], 'Source polarity must distinguish positive square and negative circle terminals');
const anchorAfter = { ...anchorBefore, x: 40, y: 20, rotation: 90 };
const anchoredWire = { id: 'w', fromCompId: 'A', fromPinId: '2', toCompId: 'B', toPinId: '1', manual: true, waypoints: [{ x: 60, y: 0 }, { x: 100, y: 0 }] };
const reanchored = reanchorManualWires([anchoredWire], anchorBefore, anchorAfter)[0];
assert.deepEqual(reanchored.waypoints?.[0], { x: 70, y: 50 }, 'manual route start follows the same terminal after move and rotation');
assert.deepEqual(reanchored.waypoints?.[1], anchoredWire.waypoints[1], 'middle route stays at its edited location');
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
assert.equal(wireGapDashArray([{ x: 0, y: 0 }, { x: 100, y: 0 }]), '44 12 44 101', 'Broken route has a visible middle gap');
const brokenWire = { ...crossingWires[0], disabled: true };
const brokenGraph = buildCircuitGraph(crossingElements, [brokenWire]);
assert.notEqual(brokenGraph.pinToNode.get('A_2'), brokenGraph.pinToNode.get('B_1'), 'Broken visible wire must not merge electrical nodes');
const restoredGraph = buildCircuitGraph(crossingElements, [crossingWires[0]]);
assert.equal(restoredGraph.pinToNode.get('A_2'), restoredGraph.pinToNode.get('B_1'), 'Restored wire joins endpoints again');
assert.equal(parseYamlScm(exportToYamlScm(crossingElements, [brokenWire], connectedSample.transient)).wires[0].disabled, true, 'Broken wire survives SCM');
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

const labels0 = getComponentLabelLayout({ rotation: 0, showName: true });
const labels90 = getComponentLabelLayout({ rotation: 90, showName: true });
const labels180 = getComponentLabelLayout({ rotation: 180, showName: true });
const labels270 = getComponentLabelLayout({ rotation: 270, showName: true });
assert.ok(labels0.name.y < 0 && labels0.value.y > 0, 'at 0 degrees name and value avoid horizontal conductors');
assert.ok(labels90.name.x > 0 && labels90.value.x < 0, 'at 90 degrees labels avoid vertical conductors');
assert.ok(labels180.name.y > 0 && labels180.value.y < 0, 'at 180 degrees name and value swap sides');
assert.ok(labels270.name.x < 0 && labels270.value.x > 0, 'at 270 degrees labels avoid vertical conductors');
for (const angle of [0, 45, 90, 180, 270]) {
  const layout = getComponentLabelLayout({ rotation: angle, showName: true });
  assert.ok(Math.hypot(layout.name.x, layout.name.y) > 30 && Math.hypot(layout.value.x, layout.value.y) > 30, `${angle}° labels remain outside the body`);
}
assert.deepEqual(getComponentLabelLayout({ rotation: 0, showName: false }).value, labels0.name, 'value takes the name position when the name is hidden');
assert.equal(getComponentValueLabel({ ...anchorBefore, type: 'DIODE', value: 0, valueStr: 'Диод', modelParams: { forwardVoltage: 0.62 } }), '0.62В', 'diode model edit updates its visible parameter');
assert.equal(getComponentValueLabel({ ...anchorBefore, type: 'AND', valueStr: '&' }), '', 'logic function is not repeated as a nominal');
assert.equal(getComponentValueLabel({ ...anchorBefore, type: 'TR3', value: 1, valueStr: '1 Гн', secondaryValue: 2 }), 'L1=1Гн · n=2', 'transformer label states its electrical parameters once');
const angledPins = getComponentPins(angled[0]);
assert.ok(angledPins.some(pin => Math.abs(pin.x) > 1 && Math.abs(pin.y) > 1), '45-degree pin geometry must rotate on both axes');
const auditedTypes = [...COMPONENT_CATALOG.map(component => component.type), 'PORT' as const];
for (const type of auditedTypes) {
  const markup = renderToStaticMarkup(renderComponentSymbol({ id: 'test', type, name: 'test', x: 0, y: 0, rotation: 0, value: 0, valueStr: '', unit: '' }));
  assert.ok(markup.length > 0, `${type}: symbol`);
  assert.ok(!markup.includes('r="10"'), `${type}: fallback symbol must not be used`);
}
for (const component of COMPONENT_CATALOG) {
  const group = terminalGroupForType(component.type);
  if (!group) continue;
  const pins = getComponentPins({ id: 'group-test', type: component.type, name: 'test', x: 0, y: 0, rotation: 0, value: 0, valueStr: '', unit: '' });
  assert.deepEqual(pins.map(pin => pin.id), getCircuitPinIds(component.type), `${component.type}: editor and electrical pin IDs agree`);
  assert.equal(group, pins.length === 2 ? 'two' : pins.length === 3 ? 'three' : pins.length === 4 ? 'four' : 'multi', `${component.type}: terminal group`);
}
for (const type of auditedTypes) {
  const element = { id: `audit_${type}`, type, name: `AUDIT_${type}`, x: 100, y: 120,
    rotation: 45, flipH: true, flipV: false, value: 1, valueStr: '1', unit: '',
    portName: type === 'PORT' ? 'AUDIT_PORT' : undefined,
    textDirective: type === 'TEXT' ? '.define TEST = 1;' : undefined };
  const expectedPins = getCircuitPinIds(type);
  for (const rotation of [0, 45, 90, 180, 270]) {
    const pins = getComponentPins({ ...element, rotation });
    assert.deepEqual(pins.map(pin => pin.id), expectedPins, `${type}: terminals at ${rotation}°`);
    assert.ok(pins.every(pin => Number.isFinite(pin.x) && Number.isFinite(pin.y)), `${type}: finite rotated terminals`);
    assert.ok(pins.every(pin => Math.hypot(pin.x, pin.y) <= (type === 'CHIP' ? 60 : 40)), `${type}: terminal stays inside shared symbol scale`);
  }
  const restored = parseYamlScm(exportToYamlScm([element], [], connectedSample.transient)).elements[0];
  assert.equal(restored.type, type, `${type}: SCM symbol type`);
  assert.deepEqual(getComponentPins(restored).map(pin => pin.id), expectedPins, `${type}: SCM terminals`);
  assert.equal(restored.name, element.name, `${type}: SCM designation`);
  assert.equal(restored.rotation, element.rotation, `${type}: SCM rotation`);
  assert.equal(restored.value, element.value, `${type}: SCM value`);
}
const validScm = exportToYamlScm(connectedSample.elements, connectedSample.wires, connectedSample.transient);
assert.throws(() => parseYamlScm(validScm.replace(/To:\s+\{ ID: \d+, Pin: (?:"[^"]+"|\d+) \}/, 'To: { ID: 999, Pin: "1" }')), /Провод 1.*не найден/);
assert.throws(() => parseYamlScm(validScm.replace(/To:\s+\{ ID: \d+, Pin: (?:"[^"]+"|\d+) \}/, 'To: { ID: 2, Pin: "missing" }')), /Провод 1.*не найден/);
assert.throws(() => parseYamlScm(validScm.replace('  - ID: 2', '  - ID: 1')), /повторяющийся ID/);
assert.throws(() => parseYamlScm(validScm.replace(/    Name: "[^"]+"/, `    Name: "${connectedSample.elements[1].name}"`)), /Повторяющийся/);
assert.throws(() => parseYamlScm(validScm.replace(/    X: [^\n]+/, '    X: wrong')), /X элемента/);
assert.throws(() => parseYamlScm(validScm.replace(/    Rot: [^\n]+/, '    Rot: NaN')), /Rot элемента/);
assert.throws(() => parseYamlScm(validScm.replace(/      Value: "[^"]+"/, '      Value: "Infinity"')), /Value элемента/);
assert.throws(() => parseYamlScm(validScm.replace(/      ValueText: "[^"]+"/, '      ValueText: "1кк"')), /видимый номинал/);
assert.throws(() => parseYamlScm(validScm.replace(/    EndTime: "[^"]+"/, '    EndTime: "1garbage"')), /EndTime/);
const blankSignals = parseYamlScm(exportToYamlScm(connectedSample.elements, connectedSample.wires, { ...connectedSample.transient, signals: [] }));
assert.deepEqual(blankSignals.transient.signals, [], 'An empty signal list must stay empty after SCM reload');
assert.equal(nextComponentName([
  { ...connectedSample.elements[0], name: 'R1' },
  { ...connectedSample.elements[1], name: 'R3' },
], 'R'), 'R4', 'Deleting R2 must not reuse an occupied suffix');
assert.equal(nextComponentName([{ ...connectedSample.elements[0], name: 'U3' }], 'U'), 'U4', 'Different voltage source types share a name prefix');
assert.throws(() => exportToYamlScm(connectedSample.elements, [...connectedSample.wires, { id: 'broken', fromCompId: 'missing', fromPinId: '1', toCompId: connectedSample.elements[0].id, toPinId: '1' }], connectedSample.transient), /Схема не сохранена/);
assert.equal(terminalGroupForType('GND'), null, 'Reference potential is not a component group');
assert.equal(terminalGroupForType('JUNCTION'), null, 'Wire junction is not a component group');
console.log(`PASS: ${SAMPLE_CIRCUITS.length} sample file round-trips, supported simulations and explicit diagnostics; ${auditedTypes.length} component symbols.`);
