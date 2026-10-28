import assert from 'node:assert/strict';
import { readRecovery, writeRecovery, RECOVERY_KEY, PREVIOUS_RECOVERY_KEY } from '../src/utils/projectRecovery';
import { SAMPLE_CIRCUITS } from '../src/data/sampleCircuits';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import { solveCircuitTransient, solveCircuitAC, getCircuitPinIds, formatEngValue } from '../src/math/circuitSolver';
import { topologyTypes } from '../src/math/topologyTransient';
import { COMPONENT_CATALOG, PLACEMENT_CATALOG, terminalGroupForType, sourceVariantsForType, placementFamilyForType,
  VOLTAGE_SOURCE_VARIANTS, CURRENT_SOURCE_VARIANTS } from '../src/components/ComponentPalette';
import { renderComponentSymbol } from '../src/components/ComponentSymbol';
import { getComponentLabelLayout, getComponentValueLabel, arrangeNodeLabels } from '../src/utils/componentLabels';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildStoredWireRoute, canRouteReconnectedEnd, computeOrthogonalWirePoints, getComponentPins, isAllowedWireSegment, moveWireSegment, projectPointToWire, reanchorManualWires, snapManualWirePoint, splitWireRoute, wireGapDashArray } from '../src/components/SchematicEditor';
import { buildCircuitGraph } from '../src/math/circuitSolver';
import { nextComponentName } from '../src/utils/componentNames';
import { paperSize, parsePrintLayout, computePrintPlacement, SCHEMATIC_UNITS_PER_MM,
  readDefaultPrintLayout, saveDefaultPrintLayout, DEFAULT_LAYOUT_STORAGE_KEY, DEFAULT_PRINT_LAYOUT } from '../src/utils/printLayout';
import { titleBlockBounds, TITLE_BLOCK_HEIGHT_MM, TITLE_BLOCK_WIDTH_MM } from '../src/utils/eskdTitleBlock';
import { rasterPagePdf } from '../src/utils/rasterPdf';
import { DEFAULT_CHIP_PINS } from '../src/utils/chipPins';
import { hitTestEditorScene, pickEditorHit } from '../src/utils/editorHitTest';
import { parseEngValue, normalizeEngNotation } from '../src/math/circuitSolver';
import { DEFAULT_SHORTCUTS, canonicalShortcut, shortcutBindingsConflict, loadEditorShortcuts, isReservedEditorShortcut } from '../src/components/SchematicEditor';
import { swapElementTerminals } from '../src/utils/terminalSwap';

for (const type of ['R', 'C', 'L', 'V_DC', 'I_DC', 'V_AC', 'I_AC', 'V_PULSE', 'I_PULSE'] as const) for (let angle = 0; angle < 360; angle += 45) {
  const selected = { id: 'swap', type, name: 'SWAP', x: 200, y: 200, value: 1, valueStr: '1', unit: '', rotation: angle, initialCondition: .125 };
  const sensor = { id: 'sensor', type: 'VCVS' as const, name: 'SENSOR', x: 600, y: 400, value: 1, valueStr: '1', unit: '', rotation: 0, controlVoltage: { positive: { elementId: 'swap', pinId: '1' }, negative: { elementId: 'swap', pinId: '2' } } };
  const wire = { id: 'route', fromCompId: 'swap', fromPinId: '1', toCompId: 'swap', toPinId: '2', waypoints: [{ x: 100, y: 100 }, { x: 300, y: 100 }], manual: true };
  const swapped = swapElementTerminals([selected, sensor], [wire], selected.id);
  const pins = getComponentPins(selected), nextPins = getComponentPins(swapped.elements[0]);
  for (const [oldId, nextId] of [['1', swapped.wires[0].fromPinId], ['2', swapped.wires[0].toPinId]]) {
    const a = pins.find(pin => pin.id === oldId)!, b = nextPins.find(pin => pin.id === nextId)!;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `${type} ${angle}: swap keeps physical wire endpoint`);
  }
  assert.equal(swapped.elements[1].controlVoltage!.positive.pinId, '2', 'voltage probe follows physical terminal');
  assert.deepEqual(swapped.wires[0].waypoints, wire.waypoints);
  if (type === 'C' || type === 'L') assert.equal(swapped.elements[0].initialCondition, -.125, 'IC changes its reference direction');
}

for (const [action, shortcut] of Object.entries(DEFAULT_SHORTCUTS)) for (const [other, assigned] of Object.entries(DEFAULT_SHORTCUTS)) {
  if (action !== other) assert.equal(shortcutBindingsConflict(action, shortcut, other, assigned), false, `${action}/${other}: default conflict`);
}
assert.equal(canonicalShortcut('Shift+Alt+KeyN'), 'Alt+Shift+KeyN');
assert.equal(canonicalShortcut('Ctrl+Ctrl+KeyA'), '');
assert.equal(shortcutBindingsConflict('rotate', 'Alt+KeyR', 'component:R', 'Shift+Alt+KeyR'), true, '45° rotation extension is reserved');
for (const combo of ['Ctrl+KeyS', 'Ctrl+KeyW', 'Meta+KeyQ', 'Alt+F4', 'Ctrl+Shift+KeyR', 'Shift+ArrowUp']) assert.ok(isReservedEditorShortcut(combo), combo);
assert.equal(isReservedEditorShortcut('Ctrl+Alt+Digit1'), false);
const brokenShortcuts = { ...DEFAULT_SHORTCUTS, 'component:NPN': 'Shift+Digit0', 'component:PNP': 'Shift+Digit0', 'component:NMOS': 'Shift+Digit0', 'component:PMOS': 'Shift+Digit0' };
const fixedShortcuts = loadEditorShortcuts({ getItem: () => JSON.stringify(brokenShortcuts) });
assert.deepEqual(fixedShortcuts, DEFAULT_SHORTCUTS, 'old shortcuts for hidden models stay inactive without changing visible defaults');
for (const type of ['NPN', 'PNP', 'NMOS', 'PMOS', 'PORT', 'CHIP']) {
  assert.equal(DEFAULT_SHORTCUTS[`component:${type}`], undefined, `${type}: hidden model has no placement shortcut`);
}
for (const type of ['V_DC', 'V_AC', 'V_PULSE', 'VCVS', 'CCVS', 'I_DC', 'I_AC', 'I_PULSE', 'VCCS', 'CCCS', 'R', 'C', 'L']) {
  assert.ok(DEFAULT_SHORTCUTS[`component:${type}`], `${type}: visible two-terminal variant keeps a shortcut`);
}
assert.equal(loadEditorShortcuts({ getItem: () => JSON.stringify({ 'component:R': 'Ctrl+KeyW' }) })['component:R'], DEFAULT_SHORTCUTS['component:R']);

assert.equal(new Set(COMPONENT_CATALOG.map(item => item.type)).size, COMPONENT_CATALOG.length, 'catalog IDs must be unique');
assert.deepEqual(new Set(PLACEMENT_CATALOG.map(item => item.type)), new Set(['V_DC', 'I_DC', 'R', 'C', 'L']));
assert.equal(new Set([...VOLTAGE_SOURCE_VARIANTS, ...CURRENT_SOURCE_VARIANTS]).size, 10,
  'ten historical source type IDs map to exactly two disjoint placement families');
for (const type of VOLTAGE_SOURCE_VARIANTS) {
  assert.deepEqual(sourceVariantsForType(type), VOLTAGE_SOURCE_VARIANTS);
  assert.equal(placementFamilyForType(type), 'V_DC');
}
for (const type of CURRENT_SOURCE_VARIANTS) {
  assert.deepEqual(sourceVariantsForType(type), CURRENT_SOURCE_VARIANTS);
  assert.equal(placementFamilyForType(type), 'I_DC');
}
for (const type of ['R', 'C', 'L'] as const) {
  assert.equal(sourceVariantsForType(type), null);
  assert.equal(placementFamilyForType(type), type);
}
assert.equal(placementFamilyForType('PORT'), null, 'a hidden legacy port has no placement family');
const layoutStorage = new Map<string, string>();
const layoutStore = { getItem: (key: string) => layoutStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { layoutStorage.set(key, value); } };
assert.deepEqual(readDefaultPrintLayout(layoutStore), DEFAULT_PRINT_LAYOUT);
saveDefaultPrintLayout({ format: 'A3', orientation: 'portrait', gridMm: 2.5, presentation: 'eskd' }, layoutStore);
assert.deepEqual(readDefaultPrintLayout(layoutStore), { format: 'A3', orientation: 'portrait', gridMm: 2.5, presentation: 'eskd' });
layoutStorage.set(DEFAULT_LAYOUT_STORAGE_KEY, '{broken');
assert.deepEqual(readDefaultPrintLayout(layoutStore), DEFAULT_PRINT_LAYOUT, 'bad user preferences cannot break a new project');
for (const type of [...COMPONENT_CATALOG.map(item => item.type), 'PORT' as const]) {
  for (const mode of ['explicit', 'connect'] as const) {
    const original = { id: 'archive', type, name: 'ARCHIVE', x: -143, y: 287, rotation: 45, flipH: true, value: 1, valueStr: '1', unit: '' };
    const loaded = parseYamlScm(exportToYamlScm([original], [], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', mode)).elements[0];
    for (const key of ['type', 'name', 'x', 'y', 'rotation', 'flipH', 'value', 'valueStr'] as const) assert.equal(loaded[key], original[key], `${type}: hidden model ${key} survives SCM ${mode}`);
  }
}
for (const [prefixes, factor] of [
  [['p', 'п'], 1e-12], [['n', 'н'], 1e-9], [['u', 'µ', 'μ', 'мк', 'mk'], 1e-6],
  [['m', 'м'], 1e-3], [['k', 'к'], 1e3], [['M', 'М', 'meg'], 1e6], [['G', 'g', 'Г', 'г'], 1e9],
] as Array<[string[], number]>) for (const prefix of prefixes) for (const unit of ['', 'Ом', 'Ф', 'Гн', 'В', 'А', 'Гц']) {
  const raw = `2,5 ${prefix}${unit}`;
  assert.equal(parseEngValue(raw), 2.5 * factor, raw);
  assert.equal(parseEngValue(normalizeEngNotation(raw)), 2.5 * factor, `normalized ${raw}`);
}
for (const invalid of ['1кк', '2mm', '3watts', '1e', 'NaN', 'Infinity', '2foo', '1;alert(1)']) assert.ok(Number.isNaN(parseEngValue(invalid)), invalid);
const nodeLabels = arrangeNodeLabels([
  { node: 1, anchors: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
  { node: 2, anchors: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
], [{ x: -12, y: -12, width: 24, height: 24 }], [{ points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] }]);
assert.equal(nodeLabels.length, 2, 'one annotation per network, not per contact');
assert.ok(nodeLabels.every(label => !label.collision), 'free annotation positions avoid bodies and conductor');
assert.deepEqual(arrangeNodeLabels([{ node: 1, anchors: [{ x: 0, y: 0 }] }], [], []), arrangeNodeLabels([{ node: 1, anchors: [{ x: 0, y: 0 }] }], [], []), 'label placement is deterministic');

const overlappingHits = [
  { kind: 'wire' as const, id: 'wire-b', distancePx: 0 },
  { kind: 'wire' as const, id: 'wire-a', distancePx: 0 },
  { kind: 'pin' as const, id: 'pin-a', distancePx: 5 },
  { kind: 'junction' as const, id: 'junction-a', distancePx: 8 },
  { kind: 'waypoint' as const, id: 'waypoint-a', distancePx: 1 },
  { kind: 'wire-end' as const, id: 'end-a', distancePx: 1 },
  { kind: 'element' as const, id: 'body-a', distancePx: 0 },
  { kind: 'label' as const, id: 'label-a', distancePx: 0 },
];
assert.equal(pickEditorHit(overlappingHits, 'select')?.id, 'junction-a',
  'explicit junction wins over handles, body and wire independent of paint order');
assert.equal(pickEditorHit(overlappingHits.filter(hit => hit.kind !== 'junction'), 'select')?.id, 'end-a',
  'a selected wire endpoint wins over a coincident waypoint or wire segment');
assert.equal(pickEditorHit(overlappingHits, 'connect')?.id, 'pin-a',
  'connection tool prefers a terminal to a visual wire crossing');
assert.equal(pickEditorHit(overlappingHits.filter(hit => hit.kind === 'wire'), 'select')?.id, 'wire-a',
  'coincident wire hits have a stable ID tie-break independent of DOM order');
assert.equal(pickEditorHit([{ kind: 'element', id: 'body', distancePx: 0 }], 'connect'), null,
  'a symbol body is never an electrical endpoint');
const denseShapes = [
  { kind: 'wire' as const, id: 'wire', radiusPx: 8, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
  { kind: 'element' as const, id: 'element', left: 16, top: -4, right: 24, bottom: 4 },
  { kind: 'label' as const, id: 'label', left: 18, top: -3, right: 30, bottom: 2 },
  { kind: 'waypoint' as const, id: 'bend', x: 20, y: 0, radiusPx: 6 },
  { kind: 'wire-end' as const, id: 'end', x: 20, y: 0, radiusPx: 7 },
  { kind: 'pin' as const, id: 'pin', x: 20, y: 0, radiusPx: 12 },
  { kind: 'junction' as const, id: 'node', x: 20, y: 0, radiusPx: 9 },
];
assert.equal(hitTestEditorScene(denseShapes, { x: 20, y: 0 }, 2, 'select')?.id, 'node');
assert.equal(hitTestEditorScene(denseShapes.filter(hit => hit.kind !== 'junction'), { x: 20, y: 0 }, 2, 'select')?.id, 'end');
assert.equal(hitTestEditorScene(denseShapes, { x: 20, y: 0 }, 2, 'connect')?.id, 'node',
  'coincident electrical contacts resolve deterministically at their explicit junction');
assert.equal(hitTestEditorScene(denseShapes, { x: 35, y: 0 }, 2, 'select')?.id, 'wire');
assert.equal(hitTestEditorScene([{ kind: 'wire', id: 'diagonal', radiusPx: 8,
  points: [{ x: 0, y: 0 }, { x: 40, y: 40 }] }], { x: 20, y: 21 }, 2, 'select')?.segmentIndex, 0,
  '45-degree wire uses the same geometric hit test as horizontal and vertical segments');
assert.equal(hitTestEditorScene(denseShapes, { x: 20, y: 15 }, 2, 'select'), null,
  'hit radii scale with zoom rather than changing the electrical coordinates');

const recoveryData = new Map<string, string>();
const reconnectElements = [[100, 100], [500, 100], [300, 100]].map(([x, y], index) => ({
  id: `route-r${index}`, name: `R${index + 1}`, type: 'R' as const, x, y,
  rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом',
}));
const reconnectWire = { id: 'route-wire', fromCompId: 'route-r0', fromPinId: '2',
  toCompId: 'route-r1', toPinId: '1', routeMode: 'direct' as const,
  waypoints: [{ x: 300, y: 100 }], manual: true };
assert.equal(canRouteReconnectedEnd(reconnectElements, [reconnectWire], [], reconnectWire.id, 'connect', 20), false,
  'reconnection must reject a saved bend through a component body');
assert.equal(canRouteReconnectedEnd(reconnectElements,
  [{ ...reconnectWire, routeMode: 'orthogonal', waypoints: undefined, manual: false }], [], reconnectWire.id, 'connect', 20), true,
  'automatic reconnection can detour around a component');
let storageFailed = false;
const recoveryStorage = {
  getItem: (key: string) => recoveryData.get(key) ?? null,
  setItem: (key: string, value: string) => { if (storageFailed) throw new Error('Quota exceeded'); recoveryData.set(key, value); },
  removeItem: (key: string) => { recoveryData.delete(key); },
};
const recoveryContent = exportToYamlScm(SAMPLE_CIRCUITS[0].elements, SAMPLE_CIRCUITS[0].wires, SAMPLE_CIRCUITS[0].transient);
const described = { title: 'Усилитель: каскад 1', purpose: 'Проверка\nАЧХ', comment: 'Узел "Выход" • β=100' };
const describedScm = exportToYamlScm([], [], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect', described);
assert.deepEqual(parseYamlScm(describedScm).description, described, 'Document description survives SCM 8');
const withTitleBlock = { ...described, designation: 'NAPS-Э3-001', author: 'Шевчук',
  checker: 'Иванов', sheetNumber: '1', sheetCount: '2' };
assert.deepEqual(parseYamlScm(exportToYamlScm([], [], SAMPLE_CIRCUITS[0].transient, undefined, undefined,
  'current', 'connect', withTitleBlock)).description, withTitleBlock, 'title-block fields survive SCM 8');
assert.deepEqual(parseYamlScm(recoveryContent).description, { title: '', purpose: '', comment: '' }, 'Old SCM opens without document metadata');
assert.throws(() => exportToYamlScm([], [], SAMPLE_CIRCUITS[0].transient, undefined,
  { format: 'A4', orientation: 'landscape', gridMm: 1 }, 'legacy', 'explicit', described), /не поддерживает описание/);
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
for (const format of ['A0', 'A1', 'A2', 'A3', 'A4'] as const) for (const orientation of ['portrait', 'landscape'] as const) {
  const layout = { format, orientation, gridMm: 5 } as const;
  const block = titleBlockBounds(layout), page = paperSize(layout);
  const rotated = format === 'A4' && orientation === 'landscape';
  assert.equal(block.widthMm, rotated ? TITLE_BLOCK_HEIGHT_MM : TITLE_BLOCK_WIDTH_MM);
  assert.equal(block.heightMm, rotated ? TITLE_BLOCK_WIDTH_MM : TITLE_BLOCK_HEIGHT_MM);
  assert.equal(block.rotated, rotated);
  assert.equal(block.xMm + block.widthMm, page.widthMm - 5);
  assert.equal(block.yMm + block.heightMm, page.heightMm - 5);
  assert(block.xMm >= 20, `${format} ${orientation}: title block stays inside the binding margin`);
}
for (const [format, short, long] of [['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594]] as const) {
  assert.deepEqual(paperSize({ format, orientation: 'portrait', gridMm: 5 }),
    { widthMm: short, heightMm: long, width: short * SCHEMATIC_UNITS_PER_MM, height: long * SCHEMATIC_UNITS_PER_MM });
  assert.deepEqual(parseYamlScm(exportToYamlScm([], [], SAMPLE_CIRCUITS[0].transient, undefined,
    { format, orientation: 'landscape', gridMm: 5 })).printLayout,
    { format, orientation: 'landscape', gridMm: 5 }, `${format} survives SCM`);
}
assert.equal(20 / SCHEMATIC_UNITS_PER_MM, 5, 'One existing schematic grid cell is 5 mm');
assert.deepEqual(parsePrintLayout(), { format: 'A4', orientation: 'landscape', gridMm: 5 }, 'Legacy SCM defaults to A4');
assert.deepEqual(parseYamlScm(exportToYamlScm([], [], SAMPLE_CIRCUITS[0].transient, undefined, { format: 'A3', orientation: 'portrait', gridMm: 2.5 })).printLayout, { format: 'A3', orientation: 'portrait', gridMm: 2.5 });
assert.throws(() => parsePrintLayout('A5', 'portrait'), /Формат листа/);
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
const rotatedBlockFit = computePrintPlacement({ x: 0, y: 0, width: 240 * SCHEMATIC_UNITS_PER_MM,
  height: 100 * SCHEMATIC_UNITS_PER_MM }, a4Layout, 20, 'fit', 1, true, 0, 65);
assert(rotatedBlockFit.fits && rotatedBlockFit.scale < 1, 'A4 landscape reserves the title-block column');
assert(rotatedBlockFit.translateX + 240 * SCHEMATIC_UNITS_PER_MM * rotatedBlockFit.scale <=
  rotatedBlockFit.width - 65 * SCHEMATIC_UNITS_PER_MM + 1e-6, 'drawing does not overlap the rotated title block');
const paperPdf = await rasterPagePdf(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 3508, 2480, 297, 210);
const pdfText = await paperPdf.text();
assert.ok(pdfText.startsWith('%PDF-1.4'));
assert.match(pdfText, /\/MediaBox \[0 0 841\.889[0-9]* 595\.275[0-9]*\]/);
assert.match(pdfText, /\/Width 3508 \/Height 2480/);
for (const [format, orientation, widthPt, heightPt] of [
  ['A4', 'portrait', 595.275, 841.889],
  ['A3', 'landscape', 1190.551, 841.889],
  ['A3', 'portrait', 841.889, 1190.551],
  ['A2', 'portrait', 1190.551, 1683.779],
  ['A1', 'portrait', 1683.779, 2383.937],
  ['A0', 'portrait', 2383.937, 3370.393],
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
const fineRoute = computeOrthogonalWirePoints({ x: 0, y: 0 }, { x: 120, y: 80 }, { x: 1, y: 0 }, { x: -1, y: 0 }, undefined, undefined, 0, 10);
const coarseRoute = computeOrthogonalWirePoints({ x: 0, y: 0 }, { x: 120, y: 80 }, { x: 1, y: 0 }, { x: -1, y: 0 }, undefined, undefined, 0, 40);
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
assert.ok(!PLACEMENT_CATALOG.some(component => component.type === 'PORT'),
  'archived ports stay out of the five-family placement catalog');
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
