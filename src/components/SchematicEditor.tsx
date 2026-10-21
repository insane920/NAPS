import { renderComponentSymbol, ComponentSymbol } from './ComponentSymbol';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  RotateCw,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FolderOpen,
  FilePlus,
  Play,
  Settings,
  HelpCircle,
  Code2,
  Hash,
  Move,
  Check,
  Zap,
  Activity,
  Layers,
  ImageDown,
  X,
} from 'lucide-react';
import {
  CircuitElement,
  CircuitWire,
  ComponentType,
  CircuitPin,
  WireCrossingMode,
} from '../types';
import { SAMPLE_CIRCUITS, SampleCircuit } from '../data/sampleCircuits';
import { buildCircuitGraph } from '../math/circuitSolver';
import { topologyTypes } from '../math/topologyTransient';
import { nextComponentName } from '../utils/componentNames';
import { getComponentLabelLayout, getComponentValueLabel, arrangeComponentLabels } from '../utils/componentLabels';
import { useModalFocus } from '../hooks/useModalFocus';
import { ComponentPalette, COMPONENT_CATALOG, PLACEMENT_CATALOG, TERMINAL_GROUPS, terminalGroupForType, TerminalGroup } from './ComponentPalette';
import { SYMBOL_METRICS } from './symbolMetrics';
import { SCHEMATIC_UNITS_PER_MM, computePrintPlacement, printScaleLabel, type PrintLayout, type PrintPlacement } from '../utils/printLayout';
import { SpatialIndex } from '../utils/spatialIndex';
import { rasterPagePdf } from '../utils/rasterPdf';
import { chipPins, DEFAULT_CHIP_PINS } from '../utils/chipPins';

interface SchematicEditorProps {
  elements: CircuitElement[];
  wires: CircuitWire[];
  printLayout: PrintLayout;
  crossingMode: WireCrossingMode;
  onPrintLayoutChange: (value: PrintLayout) => void;
  onElementsChange: (elements: CircuitElement[]) => void;
  onWiresChange: (wires: CircuitWire[]) => void;
  onBeginContinuousEdit?: () => void;
  onEndContinuousEdit?: () => void;
  onSelectElement: (element: CircuitElement) => void;
  onOpenProperties: (element: CircuitElement) => void;
  onRunSimulation: () => void;
  onBuildPlot?: () => void;
  isGraphOpen?: boolean;
  isSimulating?: boolean;
  shortcutsEnabled?: boolean;
  viewRevision?: number;
  fitRevision?: number;
  onOpenTransientSettings: () => void;
  onLoadSample: (sample: SampleCircuit) => void;
  onClearProject: () => void;
  onHoverStatus?: (text: string | null) => void;
}

const GRID_SIZE = 20;
type EditorShortcut = string;
const COMPONENT_SHORTCUT_CODES: Partial<Record<ComponentType, string>> = {
  R: 'Digit1', C: 'KeyC', L: 'KeyL', TR3: 'KeyT', DIODE: 'KeyD', THYRISTOR: 'KeyY',
  SWITCH: 'KeyS', OPAMP: 'KeyO', COMPARATOR: 'KeyG', V_DC: 'Digit2', V_AC: 'Digit3',
  V_PULSE: 'KeyP', I_DC: 'Digit4', I_AC: 'KeyI', I_PULSE: 'KeyH', NOT: 'KeyN', AND: 'KeyA', OR: 'KeyU', XOR: 'KeyX',
  VCVS: 'KeyE', VCCS: 'KeyB', CCVS: 'KeyV', CCCS: 'KeyM',
  CHIP: 'KeyK',
  RS_FF: 'KeyQ', D_FF: 'KeyF', JK_FF: 'KeyJ', GND: 'Digit0',
  JUNCTION: 'Digit5', TEXT: 'Digit6', PORT: 'Digit7',
};
const SHORTCUT_ACTIONS: EditorShortcut[] = [
  'rotate', 'add',
  ...COMPONENT_CATALOG.map(item => `component:${item.type}`),
  'component:PORT',
];
const DEFAULT_SHORTCUTS: Record<EditorShortcut, string> = Object.fromEntries([
  ['rotate', 'KeyR'], ['add', 'KeyA'],
  ...SHORTCUT_ACTIONS.filter(action => action.startsWith('component:')).map(action => {
    const type = action.slice('component:'.length) as ComponentType;
    return [action, `Shift+${COMPONENT_SHORTCUT_CODES[type] ?? 'Digit0'}`];
  }),
]) as Record<EditorShortcut, string>;

function shortcutFromEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string {
  return [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Meta' : '', event.code]
    .filter(Boolean).join('+');
}

function shortcutMatches(event: KeyboardEvent, shortcut: string, allowExtraShift = false): boolean {
  if (!shortcut) return false;
  const parts = shortcut.split('+');
  const code = parts.pop();
  const modifiers = new Set(parts);
  return event.code === code &&
    event.ctrlKey === modifiers.has('Ctrl') &&
    event.altKey === modifiers.has('Alt') &&
    (event.shiftKey === modifiers.has('Shift') || (allowExtraShift && event.shiftKey && !modifiers.has('Shift'))) &&
    event.metaKey === modifiers.has('Meta');
}

function shortcutWithShift(shortcut: string): string | null {
  if (!shortcut) return null;
  const parts = shortcut.split('+');
  const code = parts.pop()!;
  if (parts.includes('Shift')) return null;
  return [...['Ctrl', 'Alt', 'Shift', 'Meta'].filter(modifier => parts.includes(modifier) || modifier === 'Shift'), code].join('+');
}

function shortcutBindingsConflict(actionA: string, shortcutA: string, actionB: string, shortcutB: string): boolean {
  if (shortcutA === shortcutB) return true;
  return (actionA === 'rotate' && shortcutWithShift(shortcutA) === shortcutB) ||
    (actionB === 'rotate' && shortcutWithShift(shortcutB) === shortcutA);
}

function shortcutLabel(shortcut: string): string {
  if (!shortcut) return 'Не задано';
  return shortcut.split('+').map(part => part.startsWith('Key') ? part.slice(3) : part.startsWith('Digit') ? part.slice(5) : part).join(' + ');
}

function shortcutActionLabel(action: EditorShortcut): string {
  if (action === 'rotate') return 'Повернуть выбранный элемент';
  if (action === 'add') return 'Открыть библиотеку';
  const type = action.slice('component:'.length) as ComponentType;
  const item = COMPONENT_CATALOG.find(component => component.type === type);
  return type === 'PORT' ? 'Порт (совместимость SCM)' : `${item?.name ?? type} (${item?.code ?? type})`;
}

function loadEditorShortcuts(): Record<EditorShortcut, string> {
  try {
    const saved = JSON.parse(localStorage.getItem('naps_editor_shortcuts') || '{}') as Record<string, unknown>;
    return Object.fromEntries(SHORTCUT_ACTIONS.map(action => [
      action,
      typeof saved[action] === 'string' ? saved[action] as string : DEFAULT_SHORTCUTS[action],
    ]));
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export interface Point {
  x: number;
  y: number;
}

const ROUTE_EPSILON = 0.001;
const samePoint = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) < ROUTE_EPSILON && Math.abs(a.y - b.y) < ROUTE_EPSILON;

export function isAllowedWireSegment(a: Point, b: Point): boolean {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx < ROUTE_EPSILON || dy < ROUTE_EPSILON || Math.abs(dx - dy) < ROUTE_EPSILON;
}

/** Closest point on a visible segment; geometry never changes electrical connectivity. */
export function projectPointToWire(points: Point[], cursor: Point, grid = GRID_SIZE):
  { point: Point; segmentIndex: number; distance: number } | null {
  let closest: { point: Point; segmentIndex: number; distance: number } | null = null;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index], b = points[index + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < ROUTE_EPSILON) continue;
    const t = Math.max(0, Math.min(1, ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / lengthSquared));
    let point = { x: a.x + t * dx, y: a.y + t * dy };
    if (Math.abs(dy) < ROUTE_EPSILON) {
      point.x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), Math.round(point.x / grid) * grid));
      point.y = a.y;
    } else if (Math.abs(dx) < ROUTE_EPSILON) {
      point.x = a.x;
      point.y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), Math.round(point.y / grid) * grid));
    } else if (Math.abs(Math.abs(dx) - Math.abs(dy)) < ROUTE_EPSILON) {
      const snappedX = Math.round(point.x / grid) * grid;
      const clampedX = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), snappedX));
      point = { x: clampedX, y: a.y + (clampedX - a.x) * dy / dx };
    }
    const distance = Math.hypot(point.x - cursor.x, point.y - cursor.y);
    if (!closest || distance < closest.distance) closest = { point, segmentIndex: index, distance };
  }
  return closest;
}

/** User-directed 8-way waypoint. Automatic routes remain orthogonal. */
export function snapManualWirePoint(from: Point, cursor: Point, grid = GRID_SIZE): Point {
  const dx = cursor.x - from.x, dy = cursor.y - from.y;
  const candidates: Point[] = [
    { x: from.x + Math.round(dx / grid) * grid, y: from.y },
    { x: from.x, y: from.y + Math.round(dy / grid) * grid },
  ];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const distance = Math.max(0, Math.round((sx * dx + sy * dy) / (2 * grid))) * grid;
    candidates.push({ x: from.x + sx * distance, y: from.y + sy * distance });
  }
  return candidates.reduce((best, candidate) =>
    Math.hypot(candidate.x - cursor.x, candidate.y - cursor.y) <
    Math.hypot(best.x - cursor.x, best.y - cursor.y) ? candidate : best
  );
}

/**
 * Упрощение точек полилинии: удаление дубликатов и схлопывание коллинеарных промежуточных точек.
 */
export function simplifyPoints(pts: Point[]): Point[] {
  if (pts.length <= 1) return pts;
  const result: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = result[result.length - 1];
    const curr = pts[i];
    if (samePoint(curr, prev)) continue;
    if (i < pts.length - 1) {
      const next = pts[i + 1];
      const dx = next.x - prev.x, dy = next.y - prev.y;
      const cross = (curr.x - prev.x) * dy - (curr.y - prev.y) * dx;
      const along = (curr.x - prev.x) * dx + (curr.y - prev.y) * dy;
      if (Math.abs(cross) < ROUTE_EPSILON && along >= 0 && along <= dx * dx + dy * dy) continue;
    }
    result.push(curr);
  }
  return result;
}

export function splitWireRoute(points: Point[], segmentIndex: number, point: Point):
  { first: Point[]; second: Point[] } {
  return {
    first: simplifyPoints([...points.slice(0, segmentIndex + 1), point]),
    second: simplifyPoints([point, ...points.slice(segmentIndex + 1)]),
  };
}

type RoutedWire = { wire: CircuitWire; points: Point[] };

function crossingOfRoutes(first: Point[], second: Point[]): { point: Point; firstSegment: number; secondSegment: number } | null {
  for (let i = 0; i < first.length - 1; i++) for (let j = 0; j < second.length - 1; j++) {
    const a = first[i], b = first[i + 1], c = second[j], d = second[j + 1];
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < ROUTE_EPSILON) {
      // A newly routed wire can also overlap an old straight segment.
      // One explicit junction within the shared interval is sufficient to unite the nets.
      if (Math.abs((c.x - a.x) * ry - (c.y - a.y) * rx) >= ROUTE_EPSILON) continue;
      const horizontal = Math.abs(rx) >= Math.abs(ry);
      const coordinate = (point: Point) => horizontal ? point.x : point.y;
      const low = Math.max(Math.min(coordinate(a), coordinate(b)), Math.min(coordinate(c), coordinate(d)));
      const high = Math.min(Math.max(coordinate(a), coordinate(b)), Math.max(coordinate(c), coordinate(d)));
      if (high - low <= ROUTE_EPSILON) continue;
      const middle = (low + high) / 2;
      const ratio = (middle - coordinate(a)) / (coordinate(b) - coordinate(a));
      const point = { x: a.x + ratio * rx, y: a.y + ratio * ry };
      if (!samePoint(point, first[0]) && !samePoint(point, first.at(-1)!) &&
          !samePoint(point, second[0]) && !samePoint(point, second.at(-1)!)) {
        return { point, firstSegment: i, secondSegment: j };
      }
      continue;
    }
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
    if (t < -ROUTE_EPSILON || t > 1 + ROUTE_EPSILON || u < -ROUTE_EPSILON || u > 1 + ROUTE_EPSILON) continue;
    const point = { x: a.x + t * rx, y: a.y + t * ry };
    // Existing terminal connections and explicit junctions already have stable identities.
    if (samePoint(point, first[0]) || samePoint(point, first.at(-1)!) ||
        samePoint(point, second[0]) || samePoint(point, second.at(-1)!)) continue;
    return { point, firstSegment: i, secondSegment: j };
  }
  return null;
}

/** Split only a newly drawn wire and the routes it crosses. Old loaded routes are never reinterpreted. */
export function materializeWireCrossings(
  elements: CircuitElement[], wires: CircuitWire[], routed: RoutedWire[], newlyDrawnWireId: string,
): { elements: CircuitElement[]; wires: CircuitWire[] } {
  let nextElements = elements;
  let nextWires = wires;
  const routes = new Map(routed.map(item => [item.wire.id, item.points]));
  const active = new Set([newlyDrawnWireId]);
  for (let pass = 0; pass < 200; pass++) {
    const pinToNode = buildCircuitGraph(nextElements, nextWires).pinToNode;
    let crossing: { first: CircuitWire; second: CircuitWire; point: Point; firstSegment: number; secondSegment: number } | null = null;
    for (const first of nextWires) {
      if (!active.has(first.id) || first.disabled) continue;
      const firstRoute = routes.get(first.id);
      if (!firstRoute) continue;
      for (const second of nextWires) {
        if (second.id === first.id || active.has(second.id) || second.disabled) continue;
        if (pinToNode.get(`${first.fromCompId}_${first.fromPinId}`) ===
            pinToNode.get(`${second.fromCompId}_${second.fromPinId}`)) continue;
        const secondRoute = routes.get(second.id);
        if (!secondRoute) continue;
        const hit = crossingOfRoutes(firstRoute, secondRoute);
        if (hit) { crossing = { first, second, ...hit }; break; }
      }
      if (crossing) break;
    }
    if (!crossing) return { elements: nextElements, wires: nextWires };
    const { first, second, point, firstSegment, secondSegment } = crossing;
    const firstParts = splitWireRoute(routes.get(first.id)!, firstSegment, point);
    const secondParts = splitWireRoute(routes.get(second.id)!, secondSegment, point);
    const junctionId = `junction_cross_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    nextElements = [...nextElements, { id: junctionId, type: 'JUNCTION', name: nextComponentName(nextElements, 'N'),
      x: point.x, y: point.y, rotation: 0, value: 0, valueStr: '', unit: '' }];
    const split = (wire: CircuitWire, parts: { first: Point[]; second: Point[] }) => {
      const before: CircuitWire = { ...wire, id: `${wire.id}_a_${junctionId}`, toCompId: junctionId, toPinId: '1',
        routeMode: 'direct', manual: true, waypoints: parts.first.slice(1, -1) };
      const after: CircuitWire = { ...wire, id: `${wire.id}_b_${junctionId}`, fromCompId: junctionId, fromPinId: '1',
        routeMode: 'direct', manual: true, waypoints: parts.second.slice(1, -1) };
      routes.delete(wire.id);
      routes.set(before.id, parts.first);
      routes.set(after.id, parts.second);
      return [before, after];
    };
    const firstSplit = split(first, firstParts), secondSplit = split(second, secondParts);
    active.delete(first.id);
    firstSplit.forEach(wire => active.add(wire.id));
    nextWires = [...nextWires.filter(wire => wire.id !== first.id && wire.id !== second.id), ...firstSplit, ...secondSplit];
  }
  throw new Error('Слишком много пересечений: провод не добавлен. Упростите маршрут.');
}

/**
 * Строго ортогональная трассировка проводов под прямыми углами с привязкой к сетке 20px.
 * Обеспечивает стабильное, аккуратное поведение проводов без самопроизвольных зигзагов
 * при перемещении компонентов и узлов схемы.
 */
export function computeOrthogonalWirePoints(
  p1: Point,
  p2: Point,
  p1PinRel?: Point,
  p2PinRel?: Point,
  p1Type?: string,
  p2Type?: string,
  trackOffset = 0,
  grid = GRID_SIZE
): Point[] {
  // Preserve the exact terminal coordinates, including 45° rotations.
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;

  // Точки совпадают
  if (x1 === x2 && y1 === y2) {
    return [{ x: x1, y: y1 }];
  }

  // Строго горизонтальная линия
  if (y1 === y2) {
    if (trackOffset) {
      const direction1 = Math.sign(p1PinRel?.x || x2 - x1) || 1;
      const direction2 = Math.sign(p2PinRel?.x || x1 - x2) || -1;
      const shortSpan = Math.abs(x2 - x1) <= 2 * grid && direction1 !== direction2;
      const stub1 = x1 + (shortSpan ? -Math.sign(x2 - x1) : direction1) * grid;
      const stub2 = x2 + (shortSpan ? Math.sign(x2 - x1) : direction2) * grid;
      return simplifyPoints([
        { x: x1, y: y1 }, { x: stub1, y: y1 },
        { x: stub1, y: y1 + trackOffset }, { x: stub2, y: y1 + trackOffset },
        { x: stub2, y: y2 }, { x: x2, y: y2 },
      ]);
    }
    return [{ x: x1, y: y1 }, { x: x2, y: y1 }];
  }

  // Строго вертикальная линия
  if (x1 === x2) {
    if (trackOffset) {
      const direction1 = Math.sign(p1PinRel?.y || y2 - y1) || 1;
      const direction2 = Math.sign(p2PinRel?.y || y1 - y2) || -1;
      const shortSpan = Math.abs(y2 - y1) <= 2 * grid && direction1 !== direction2;
      const stub1 = y1 + (shortSpan ? -Math.sign(y2 - y1) : direction1) * grid;
      const stub2 = y2 + (shortSpan ? Math.sign(y2 - y1) : direction2) * grid;
      return simplifyPoints([
        { x: x1, y: y1 }, { x: x1, y: stub1 },
        { x: x1 + trackOffset, y: stub1 }, { x: x1 + trackOffset, y: stub2 },
        { x: x2, y: stub2 }, { x: x2, y: y2 },
      ]);
    }
    return [{ x: x1, y: y1 }, { x: x1, y: y2 }];
  }

  const isP1Junction = p1Type === 'JUNCTION';
  const isP2Junction = p2Type === 'JUNCTION';

  // Определение вертикальности пинов для правильного угла выхода
  const isP1Vertical = !isP1Junction && p1PinRel && Math.abs(p1PinRel.y) > Math.abs(p1PinRel.x);
  const isP2Vertical = !isP2Junction && p2PinRel && Math.abs(p2PinRel.y) > Math.abs(p2PinRel.x);

  // СЛУЧАЙ 1: Соединение с узлом (JUNCTION)
  // Узел всенаправленный, поэтому провод подходит к нему чистым L-углом (1 поворот 90°)
  if (isP1Junction && !isP2Junction) {
    if (isP2Vertical) {
      return simplifyPoints([
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
      ]);
    } else {
      return simplifyPoints([
        { x: x1, y: y1 },
        { x: x1, y: y2 },
        { x: x2, y: y2 },
      ]);
    }
  }

  if (!isP1Junction && isP2Junction) {
    if (isP1Vertical) {
      return simplifyPoints([
        { x: x1, y: y1 },
        { x: x1, y: y2 },
        { x: x2, y: y2 },
      ]);
    } else {
      return simplifyPoints([
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
      ]);
    }
  }

  if (isP1Junction && isP2Junction) {
    return simplifyPoints([
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
    ]);
  }

  // СЛУЧАЙ 2: Соединение между компонентами схемы
  if (isP1Vertical && !isP2Vertical) {
    return simplifyPoints([
      { x: x1, y: y1 },
      { x: x1, y: y2 },
      { x: x2, y: y2 },
    ]);
  }

  if (!isP1Vertical && isP2Vertical) {
    return simplifyPoints([
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
    ]);
  }

  if (isP1Vertical && isP2Vertical) {
    const midY = Math.round(((y1 + y2) / 2) / grid) * grid + trackOffset;
    return simplifyPoints([
      { x: x1, y: y1 },
      { x: x1, y: midY },
      { x: x2, y: midY },
      { x: x2, y: y2 },
    ]);
  }

  // Оба пина горизонтальные (стандарт для большинства электронных элементов)
  const midX = Math.round(((x1 + x2) / 2) / grid) * grid + trackOffset;
  return simplifyPoints([
    { x: x1, y: y1 },
    { x: midX, y: y1 },
    { x: midX, y: y2 },
    { x: x2, y: y2 },
  ]);
}

function overlappingLength(points: Point[], occupied: Point[][]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    for (const route of occupied) {
      for (let otherIndex = 1; otherIndex < route.length; otherIndex++) {
        const c = route[otherIndex - 1];
        const d = route[otherIndex];
        if (a.y === b.y && c.y === d.y && a.y === c.y) {
          total += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
        } else if (a.x === b.x && c.x === d.x && a.x === c.x) {
          total += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
        }
      }
    }
  }
  return total;
}

export function pointsToSvgPath(pts: Point[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

export function wireGapDashArray(pts: Point[]): string {
  const length = pts.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - pts[index].x, point.y - pts[index].y), 0);
  const gap = Math.min(12, length * 0.3);
  const half = Math.max(0, (length - gap) / 2);
  return `${half} ${gap} ${half} ${length + 1}`;
}

/** Keep saved manual segments while reconnecting moved or rotated terminal pins. */
export function buildStoredWireRoute(
  start: Point,
  end: Point,
  waypoints: Point[],
  startPin?: Point,
  endPin?: Point,
  startType?: string,
  endType?: string,
  grid = GRID_SIZE
): Point[] {
  if (!waypoints.length) return isAllowedWireSegment(start, end)
    ? [start, end]
    : computeOrthogonalWirePoints(start, end, startPin, endPin, startType, endType, 0, grid);
  const route = [start];
  for (const next of [...waypoints, end]) {
    const previous = route[route.length - 1];
    if (samePoint(previous, next)) continue;
    const connector = isAllowedWireSegment(previous, next)
      ? [previous, next]
      : computeOrthogonalWirePoints(previous, next, undefined, undefined, undefined, undefined, 0, grid);
    route.push(...connector.slice(1));
  }
  return simplifyPoints(route);
}

/** Move a segment while keeping both electrical endpoints fixed. Diagonals shift in parallel. */
export function moveWireSegment(points: Point[], segmentIndex: number, coordinate: number): Point[] {
  if (segmentIndex < 0 || segmentIndex >= points.length - 1) return points;
  const a = points[segmentIndex], b = points[segmentIndex + 1];
  const before = points.slice(0, segmentIndex);
  const after = points.slice(segmentIndex + 2);
  const moved = Math.abs(a.y - b.y) < ROUTE_EPSILON
    ? [{ x: a.x, y: a.y }, { x: a.x, y: coordinate }, { x: b.x, y: coordinate }, { x: b.x, y: b.y }]
    : Math.abs(a.x - b.x) < ROUTE_EPSILON
      ? [{ x: a.x, y: a.y }, { x: coordinate, y: a.y }, { x: coordinate, y: b.y }, { x: b.x, y: b.y }]
      : (() => {
        const slope = Math.sign((b.y - a.y) / (b.x - a.x));
        return [
          a,
          { x: a.x + coordinate, y: a.y - slope * coordinate },
          { x: b.x + coordinate, y: b.y - slope * coordinate },
          b,
        ];
      })();
  return simplifyPoints([...before, ...moved, ...after]);
}

/** Shift an arbitrary-angle segment parallel to itself without changing its terminal endpoints. */
export function moveFreeWireSegment(points: Point[], segmentIndex: number, offset: number): Point[] {
  if (segmentIndex < 0 || segmentIndex >= points.length - 1) return points;
  const a = points[segmentIndex], b = points[segmentIndex + 1];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < ROUTE_EPSILON || Math.abs(offset) < ROUTE_EPSILON) return points;
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  return simplifyPoints([
    ...points.slice(0, segmentIndex + 1),
    { x: a.x + nx * offset, y: a.y + ny * offset },
    { x: b.x + nx * offset, y: b.y + ny * offset },
    ...points.slice(segmentIndex + 1),
  ]);
}

export function getComponentPins(el: CircuitElement): CircuitPin[] {
  if (el.type === 'JUNCTION') {
    return [{ id: '1', name: '•', x: 0, y: 0 }];
  }

  const rot = (el.rotation || 0) % 360;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  function transform(rx: number, ry: number): { x: number; y: number } {
    let x = rx;
    let y = ry;
    if (el.flipH) x = -x;
    if (el.flipV) y = -y;
    return {
      x: Math.round((x * cos - y * sin) * 1000) / 1000,
      y: Math.round((x * sin + y * cos) * 1000) / 1000,
    };
  }

  if (el.type === 'GND') {
    const p = transform(0, -SYMBOL_METRICS.groundPinOffset);
    return [{ id: '1', name: 'GND', x: p.x, y: p.y }];
  }
  if (el.type === 'PORT') {
    const p = transform(-SYMBOL_METRICS.pinReach, 0);
    return [{ id: '1', name: el.portName || el.name, x: p.x, y: p.y }];
  }
  if (el.type === 'OPAMP' || el.type === 'COMPARATOR') {
    const pNeg = transform(-SYMBOL_METRICS.analogPinReach, -15);
    const pPos = transform(-SYMBOL_METRICS.analogPinReach, 15);
    const pOut = transform(SYMBOL_METRICS.analogPinReach, 0);
    return [
      { id: 'in_neg', name: '-', label: '-', x: pNeg.x, y: pNeg.y },
      { id: 'in_pos', name: '+', label: '+', x: pPos.x, y: pPos.y },
      { id: 'out', name: 'OUT', label: 'OUT', x: pOut.x, y: pOut.y },
    ];
  }
  if (el.type === 'SWITCH' || el.type === 'THYRISTOR' || ['NPN', 'PNP', 'NMOS', 'PMOS'].includes(el.type)) {
    const p1 = transform(-SYMBOL_METRICS.pinReach, 0);
    const p2 = transform(SYMBOL_METRICS.pinReach, 0);
    const pGate = transform(0, SYMBOL_METRICS.gateDrop);
    return [
      { id: '1', name: el.type === 'THYRISTOR' ? 'A' : el.type === 'NPN' || el.type === 'PNP' ? 'C' : el.type === 'NMOS' || el.type === 'PMOS' ? 'D' : 'IN', x: p1.x, y: p1.y },
      { id: '2', name: el.type === 'THYRISTOR' ? 'K' : el.type === 'NPN' || el.type === 'PNP' ? 'E' : el.type === 'NMOS' || el.type === 'PMOS' ? 'S' : 'OUT', x: p2.x, y: p2.y },
      { id: 'gate', name: el.type === 'NPN' || el.type === 'PNP' ? 'B' : 'G', label: el.type === 'NPN' || el.type === 'PNP' ? 'B' : 'G', x: pGate.x, y: pGate.y },
    ];
  }
  if (el.type === 'NOT') {
    const p1 = transform(-SYMBOL_METRICS.pinReach, 0);
    const p2 = transform(SYMBOL_METRICS.pinReach, 0);
    return [
      { id: '1', name: 'IN', x: p1.x, y: p1.y },
      { id: '2', name: 'OUT', x: p2.x, y: p2.y },
    ];
  }
  if (el.type === 'AND' || el.type === 'OR' || el.type === 'XOR') {
    const p1 = transform(-SYMBOL_METRICS.pinReach, -SYMBOL_METRICS.logicInputOffset);
    const p2 = transform(-SYMBOL_METRICS.pinReach, SYMBOL_METRICS.logicInputOffset);
    const pOut = transform(SYMBOL_METRICS.pinReach, 0);
    return [
      { id: '1', name: 'X1', x: p1.x, y: p1.y },
      { id: '2', name: 'X2', x: p2.x, y: p2.y },
      { id: '3', name: 'Y', x: pOut.x, y: pOut.y },
    ];
  }
  if (el.type === 'RS_FF' || el.type === 'D_FF' || el.type === 'JK_FF') {
    const p1 = transform(-SYMBOL_METRICS.pinReach, -SYMBOL_METRICS.flipFlopInputOffset);
    const p2 = transform(-SYMBOL_METRICS.pinReach, SYMBOL_METRICS.flipFlopInputOffset);
    const p3 = transform(SYMBOL_METRICS.pinReach, -SYMBOL_METRICS.flipFlopInputOffset);
    const p4 = transform(SYMBOL_METRICS.pinReach, SYMBOL_METRICS.flipFlopInputOffset);
    return [
      { id: '1', name: el.type === 'RS_FF' ? 'S' : el.type === 'D_FF' ? 'D' : 'J', x: p1.x, y: p1.y },
      { id: '2', name: el.type === 'RS_FF' ? 'R' : el.type === 'D_FF' ? 'CLK' : 'K', x: p2.x, y: p2.y },
      { id: '3', name: 'Q', x: p3.x, y: p3.y },
      { id: '4', name: '/Q', x: p4.x, y: p4.y },
      ...(el.type === 'JK_FF' ? [{ id: 'clk', name: 'CLK', ...transform(-SYMBOL_METRICS.pinReach, 0) }] : []),
    ];
  }
  if (el.type === 'TR3') {
    const p1 = transform(-SYMBOL_METRICS.pinReach, -SYMBOL_METRICS.transformerWindingOffset);
    const p2 = transform(-SYMBOL_METRICS.pinReach, SYMBOL_METRICS.transformerWindingOffset);
    const p3 = transform(SYMBOL_METRICS.pinReach, -SYMBOL_METRICS.transformerWindingOffset);
    const p4 = transform(SYMBOL_METRICS.pinReach, SYMBOL_METRICS.transformerWindingOffset);
    return [
      { id: '1', name: 'P1', x: p1.x, y: p1.y },
      { id: '2', name: 'P2', x: p2.x, y: p2.y },
      { id: '3', name: 'S1', x: p3.x, y: p3.y },
      { id: '4', name: 'S2', x: p4.x, y: p4.y },
    ];
  }
  if (el.type === 'VCVS' || el.type === 'VCCS') {
    const outputPos = transform(-SYMBOL_METRICS.pinReach, 0);
    const outputNeg = transform(SYMBOL_METRICS.pinReach, 0);
    const controlPos = transform(0, -SYMBOL_METRICS.pinReach);
    const controlNeg = transform(0, SYMBOL_METRICS.pinReach);
    return [
      { id: '1', name: '+', label: '+', ...outputPos },
      { id: '2', name: '−', label: '−', ...outputNeg },
      { id: 'ctrl_pos', name: 'U+', label: 'U+', ...controlPos },
      { id: 'ctrl_neg', name: 'U−', label: 'U−', ...controlNeg },
    ];
  }
  if (el.type === 'CHIP') {
    const pins = chipPins(el);
    return pins.map(pin => {
      const side = pins.filter(item => item.side === pin.side);
      const position = side.findIndex(item => item.id === pin.id);
      const p = transform(pin.side === 'left' ? -40 : 40, (position - (side.length - 1) / 2) * 20);
      return { id: pin.id, name: `${pin.number}${pin.label ? ` ${pin.label}` : ''}`, label: pin.number, ...p };
    });
  }
  if (el.type === 'TEXT') {
    return [];
  }

  // 2-выводные элементы (R, L, C, DIODE, V_DC, V_AC, V_PULSE, I_DC)
  const p1 = transform(-SYMBOL_METRICS.pinReach, 0);
  const p2 = transform(SYMBOL_METRICS.pinReach, 0);
  const polarizedSource = ['V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'I_AC', 'I_PULSE', 'CCVS', 'CCCS'].includes(el.type);
  const firstName = el.type === 'DIODE' ? 'A' : polarizedSource ? '+' : '1';
  const secondName = el.type === 'DIODE' ? 'K' : polarizedSource ? '−' : '2';
  return [
    { id: '1', name: firstName, label: polarizedSource ? '+' : undefined, x: p1.x, y: p1.y },
    { id: '2', name: secondName, label: polarizedSource ? '−' : undefined, x: p2.x, y: p2.y },
  ];
}

/** Move only the waypoint next to a moved terminal; the middle of a manual route stays put. */
export function reanchorManualWires(wires: CircuitWire[], before: CircuitElement, after: CircuitElement): CircuitWire[] {
  const oldPins = new Map(getComponentPins(before).map(pin => [pin.id, { x: before.x + pin.x, y: before.y + pin.y }]));
  const newPins = new Map(getComponentPins(after).map(pin => [pin.id, { x: after.x + pin.x, y: after.y + pin.y }]));
  return wires.map(wire => {
    if (!wire.waypoints?.length || (wire.fromCompId !== before.id && wire.toCompId !== before.id)) return wire;
    const waypoints = wire.waypoints.map(point => ({ ...point }));
    const shift = (pinId: string, index: number) => {
      const oldPin = oldPins.get(pinId), newPin = newPins.get(pinId);
      if (!oldPin || !newPin) return;
      waypoints[index].x += newPin.x - oldPin.x;
      waypoints[index].y += newPin.y - oldPin.y;
    };
    if (wire.fromCompId === before.id) shift(wire.fromPinId, 0);
    if (wire.toCompId === before.id) shift(wire.toPinId, waypoints.length - 1);
    return { ...wire, waypoints };
  });
}

/** Keep electrical endpoints fixed while translating the geometry of a selected group. */
export function moveSelectedElements(
  elements: CircuitElement[], wires: CircuitWire[], selectedIds: ReadonlySet<string>, dx: number, dy: number,
): { elements: CircuitElement[]; wires: CircuitWire[] } {
  const moved = elements.map(element => selectedIds.has(element.id)
    ? { ...element, x: element.x + dx, y: element.y + dy } : element);
  const movedWires = wires.map(wire => {
    if (!wire.waypoints?.length) return wire;
    const fromMoved = selectedIds.has(wire.fromCompId);
    const toMoved = selectedIds.has(wire.toCompId);
    if (!fromMoved && !toMoved) return wire;
    const waypoints = wire.waypoints.map(point => ({ ...point }));
    if (fromMoved && toMoved) {
      for (const point of waypoints) { point.x += dx; point.y += dy; }
    } else {
      const point = waypoints[fromMoved ? 0 : waypoints.length - 1];
      point.x += dx; point.y += dy;
    }
    return { ...wire, waypoints };
  });
  return { elements: moved, wires: movedWires };
}

export function SchematicEditor({
  elements,
  wires,
  printLayout,
  crossingMode,
  onPrintLayoutChange,
  onElementsChange,
  onWiresChange,
  onBeginContinuousEdit,
  onEndContinuousEdit,
  onSelectElement,
  onOpenProperties,
  onRunSimulation,
  onBuildPlot,
  isGraphOpen,
  isSimulating = false,
  shortcutsEnabled = true,
  viewRevision = 0,
  fitRevision = 0,
  onOpenTransientSettings,
  onLoadSample,
  onClearProject,
  onHoverStatus,
}: SchematicEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(null);
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState<EditorShortcut | null>(null);
  const [shortcutMessage, setShortcutMessage] = useState('Нажмите сочетание и затем щёлкните по схеме, чтобы разместить элемент.');
  const [editorShortcuts, setEditorShortcuts] = useState<Record<EditorShortcut, string>>(loadEditorShortcuts);
  useEffect(() => { localStorage.setItem('naps_editor_shortcuts', JSON.stringify(editorShortcuts)); }, [editorShortcuts]);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [wireContextMenu, setWireContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [overlapChoice, setOverlapChoice] = useState<{
    x: number; y: number;
    pins: Array<{ compId: string; pinId: string; x: number; y: number; name: string }>;
  } | null>(null);
  const [copiedElement, setCopiedElement] = useState<CircuitElement | null>(null);
  const [copiedGroup, setCopiedGroup] = useState<{ elements: CircuitElement[]; wires: CircuitWire[] } | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [wireMode, setWireMode] = useState<'orthogonal' | 'direct'>('orthogonal');
  const [exportTarget, setExportTarget] = useState<'png' | 'svg' | 'pdf' | 'print' | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'actual' | 'fit'>('actual');
  const [requestedPrintScale, setRequestedPrintScale] = useState(1);
  const [printMarginMm, setPrintMarginMm] = useState(5);
  const [centerPrint, setCenterPrint] = useState(true);
  const [exportPlan, setExportPlan] = useState<{ xml: string; html: string; placement: PrintPlacement } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const printPreviewRef = useRef<HTMLIFrameElement>(null);
  const [showNodeNumbers, setShowNodeNumbers] = useState<boolean>(false);
  const [showElementNames, setShowElementNames] = useState<boolean>(true);
  const [showElementValues, setShowElementValues] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const gridUnits = printLayout.gridMm * SCHEMATIC_UNITS_PER_MM;
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 50, y: 30 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Панель библиотеки элементов и активный инструмент
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const shortcutDialogRef = useModalFocus<HTMLDivElement>(shortcutSettingsOpen);
  const libraryDialogRef = useModalFocus<HTMLDivElement>(isPaletteOpen, '[aria-label="Поиск компонентов"]');
  const [hoveredPin, setHoveredPin] = useState<{
    compId: string;
    pinId: string;
    x: number;
    y: number;
    name: string;
  } | null>(null);
  const [hoveredWirePoint, setHoveredWirePoint] = useState<{
    wireId: string;
    x: number;
    y: number;
  } | null>(null);
  const [mouseWorldPos, setMouseWorldPos] = useState<{ x: number; y: number } | null>(null);

  // Режим размещения нового элемента
  const [pendingComponentType, setPendingComponentType] = useState<ComponentType | null>(null);
  const [quickTypes, setQuickTypes] = useState<Partial<Record<TerminalGroup, ComponentType>>>({ two: 'R', three: 'THYRISTOR', four: 'TR3' });
  const [paletteDragGroup, setPaletteDragGroup] = useState<TerminalGroup | null>(null);
  useEffect(() => {
    if (!paletteDragGroup) return;
    const cycleDraggedType = (event: WheelEvent) => {
      const options = PLACEMENT_CATALOG.filter(item => terminalGroupForType(item.type) === paletteDragGroup);
      if (!options.length) return;
      event.preventDefault();
      const current = quickTypes[paletteDragGroup] ?? options[0].type;
      const index = Math.max(0, options.findIndex(item => item.type === current));
      const next = options[(index + (event.deltaY > 0 ? 1 : options.length - 1)) % options.length].type;
      setQuickTypes(types => ({ ...types, [paletteDragGroup]: next }));
      setPendingComponentType(next);
    };
    const finishOutsideCanvas = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setPaletteDragGroup(null);
    };
    window.addEventListener('wheel', cycleDraggedType, { passive: false });
    window.addEventListener('mouseup', finishOutsideCanvas);
    return () => { window.removeEventListener('wheel', cycleDraggedType); window.removeEventListener('mouseup', finishOutsideCanvas); };
  }, [paletteDragGroup, quickTypes]);

  // Режим рисования провода
  const [wiringFrom, setWiringFrom] = useState<{
    compId: string;
    pinId: string;
    x: number;
    y: number;
  } | null>(null);
  const wiringFromRef = useRef<typeof wiringFrom>(null);
  const [wiringCursor, setWiringCursor] = useState<{ x: number; y: number } | null>(null);
  const [wiringWaypoints, setWiringWaypoints] = useState<Point[]>([]);
  const wirePointerDown = useRef(false);
  useEffect(() => { wiringFromRef.current = wiringFrom; }, [wiringFrom]);

  // Перетаскивание элемента
  const [draggingElemId, setDraggingElemId] = useState<string | null>(null);
  const groupDragIds = useRef<Set<string> | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const wireSegmentDrag = useRef<{ wireId: string; segmentIndex: number; points: Point[]; started: boolean } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const canvas = containerRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (pendingComponentType && !paletteDragGroup && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const group = terminalGroupForType(pendingComponentType);
        const variants = PLACEMENT_CATALOG.filter(item => group && terminalGroupForType(item.type) === group);
        if (variants.length > 1) {
          const current = variants.findIndex(item => item.type === pendingComponentType);
          const next = variants[(current + (event.deltaY > 0 ? 1 : variants.length - 1)) % variants.length].type;
          setPendingComponentType(next);
          setQuickTypes(types => group ? { ...types, [group]: next } : types);
        }
        return;
      }
      if (event.buttons || (event.target instanceof Element && event.target.closest('[data-component-id]') && !event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      const nextZoom = Math.max(Math.min(0.01, zoom), Math.min(2.5, zoom * Math.exp(-event.deltaY * 0.001)));
      setPan({ x: x - (x - pan.x) * nextZoom / zoom, y: y - (y - pan.y) * nextZoom / zoom });
      setZoom(nextZoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, pan, pendingComponentType, paletteDragGroup]);
  useEffect(() => {
    setSelectedId(null);
    setSelectedIds([]);
    setMarquee(null);
    groupDragIds.current = null;
    setContextMenu(null);
    setOverlapChoice(null);
    setReplacingId(null);
    setSelectedWireId(null);
    wiringFromRef.current = null;
    wirePointerDown.current = false;
    setWiringFrom(null);
    setWiringCursor(null);
    setWiringWaypoints([]);
    setHoveredPin(null);
    setHoveredWirePoint(null);
    setDraggingElemId(null);
    setPendingComponentType(null);
  }, [viewRevision]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [contextMenu]);
  useEffect(() => {
    const releaseDrag = (event: MouseEvent | FocusEvent) => {
      if (draggingElemId) onEndContinuousEdit?.();
      if (wireSegmentDrag.current?.started) onEndContinuousEdit?.();
      wireSegmentDrag.current = null;
      wirePointerDown.current = false;
      if (event.type === 'blur') {
        setOverlapChoice(null);
        wiringFromRef.current = null;
        setWiringFrom(null);
        setWiringCursor(null);
        setWiringWaypoints([]);
        setHoveredPin(null);
        setHoveredWirePoint(null);
      }
      setDraggingElemId(null); setIsPanning(false);
    };
    window.addEventListener('mouseup', releaseDrag);
    window.addEventListener('blur', releaseDrag);
    return () => { window.removeEventListener('mouseup', releaseDrag); window.removeEventListener('blur', releaseDrag); };
  }, [draggingElemId, onEndContinuousEdit]);
  const fittedProject = useRef<number | null>(null);
  const fitToView = useCallback(() => {
    const bounds = containerRef.current?.getBoundingClientRect();
    const world = svgRef.current?.querySelector<SVGGElement>('#schematic-world');
    if (!bounds || !world || bounds.width <= 48 || bounds.height <= 48 || !elements.length) return;
    // SVG bounds include symbols, labels and manual wire detours in world units.
    const drawing = world.getBBox();
    const minX = drawing.x - 8, maxX = drawing.x + drawing.width + 8;
    const minY = drawing.y - 8, maxY = drawing.y + drawing.height + 8;
    const nextZoom = Math.min(1.5, (bounds.width - 48) / (maxX - minX), (bounds.height - 48) / (maxY - minY));
    if (!Number.isFinite(nextZoom) || nextZoom <= 0) return;
    setZoom(nextZoom);
    setPan({ x: (bounds.width - (minX + maxX) * nextZoom) / 2, y: (bounds.height - (minY + maxY) * nextZoom) / 2 });
  }, [elements, wires]);
  useEffect(() => {
    // Fit initial and replacement projects; dragging preserves the user's viewport.
    if (fittedProject.current === fitRevision) return;
    fittedProject.current = fitRevision;
    fitToView();
  }, [fitRevision, fitToView]);

  // Граф узлов для нумерации
  const circuitGraph = useMemo(() => buildCircuitGraph(elements, wires), [elements, wires]);

  // Снэп к сетке
  const snapToGrid = (val: number) => Math.round(val / gridUnits) * gridUnits;
  const changeElementGeometry = useCallback((before: CircuitElement, after: CircuitElement) => {
    onElementsChange(elements.map(element => element.id === before.id ? after : element));
    if (wires.some(wire => wire.waypoints?.length && (wire.fromCompId === before.id || wire.toCompId === before.id))) {
      onWiresChange(reanchorManualWires(wires, before, after));
    }
  }, [elements, wires, onElementsChange, onWiresChange]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const transformSelection = (transform: (element: CircuitElement) => CircuitElement) => {
    if (!selectedSet.size) return;
    const changed = elements.map(element => selectedSet.has(element.id) ? transform(element) : element);
    let routes = wires;
    for (let index = 0; index < elements.length; index++) {
      if (changed[index] !== elements[index]) routes = reanchorManualWires(routes, elements[index], changed[index]);
    }
    onElementsChange(changed);
    if (routes !== wires) onWiresChange(routes);
  };
  const deleteSelection = () => {
    if (!selectedSet.size) return;
    onElementsChange(elements.filter(element => !selectedSet.has(element.id)));
    onWiresChange(wires.filter(wire => !selectedSet.has(wire.fromCompId) && !selectedSet.has(wire.toCompId)));
    setSelectedIds([]); setSelectedId(null);
  };

  // Преобразование координат экрана в координаты схемы
  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const rawX = (clientX - rect.left - pan.x) / zoom;
      const rawY = (clientY - rect.top - pan.y) / zoom;
      return {
        x: snapToGrid(rawX),
        y: snapToGrid(rawY),
        rawX,
        rawY,
      };
    },
    [pan, zoom, gridUnits]
  );

  // Горячие клавиши редактора и быстрый выбор элемента из библиотеки.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (shortcutSettingsOpen) return;
      if (isPaletteOpen) {
        if (e.key === 'Escape') setIsPaletteOpen(false);
        return;
      }
      if (!shortcutsEnabled || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target instanceof HTMLElement && e.target.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyC' && selectedSet.size) {
        e.preventDefault();
        if (selectedSet.size > 1) {
          setCopiedGroup({
            elements: elements.filter(element => selectedSet.has(element.id)),
            wires: wires.filter(wire => selectedSet.has(wire.fromCompId) && selectedSet.has(wire.toCompId)),
          });
          setCopiedElement(null);
        } else {
          setCopiedElement(elements.find(element => selectedSet.has(element.id)) ?? null);
          setCopiedGroup(null);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyV' && copiedGroup) {
        e.preventDefault();
        const ids = new Map<string, string>();
        const usedNames = new Set(elements.map(element => element.name.toLocaleUpperCase()));
        const copies = copiedGroup.elements.map(element => {
          const id = `elem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          ids.set(element.id, id);
          const base = `${element.name}_копия`;
          let name = base, suffix = 2;
          while (usedNames.has(name.toLocaleUpperCase())) name = `${base}${suffix++}`;
          usedNames.add(name.toLocaleUpperCase());
          return { ...element, id, name, x: snapToGrid(element.x + 40), y: snapToGrid(element.y + 40) };
        });
        const copiedWires = copiedGroup.wires.map(wire => ({ ...wire,
          id: `wire_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          fromCompId: ids.get(wire.fromCompId)!, toCompId: ids.get(wire.toCompId)!,
          waypoints: wire.waypoints?.map(point => ({ x: point.x + 40, y: point.y + 40 })),
        }));
        onElementsChange([...elements, ...copies]);
        onWiresChange([...wires, ...copiedWires]);
        setSelectedIds(copies.map(element => element.id));
        setSelectedId(copies.at(-1)?.id ?? null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyV' && copiedElement) {
        e.preventDefault();
        const baseName = `${copiedElement.name}_копия`;
        const name = elements.some(element => element.name.toLocaleUpperCase() === baseName.toLocaleUpperCase())
          ? nextComponentName(elements, baseName, 2) : baseName;
        const copy = { ...copiedElement, id: `elem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name, x: snapToGrid(copiedElement.x + 40), y: snapToGrid(copiedElement.y + 40) };
        onElementsChange([...elements, copy]);
        setSelectedId(copy.id);
        setSelectedIds([copy.id]);
        onSelectElement(copy);
        return;
      }

      const matchedAction = SHORTCUT_ACTIONS.find(action => shortcutMatches(e, editorShortcuts[action], action === 'rotate'));
      if (matchedAction) {
        e.preventDefault();
        if (matchedAction === 'add') {
          setIsPaletteOpen(true);
          return;
        }
        if (matchedAction === 'rotate') {
          transformSelection(element => ({ ...element, rotation: ((element.rotation || 0) + (e.shiftKey ? 45 : 90)) % 360 }));
          return;
        }
        const type = matchedAction.slice('component:'.length) as ComponentType;
        setWiringFrom(null); wiringFromRef.current = null;
        setWiringCursor(null); setWiringWaypoints([]);
        if (type !== 'GND') {
          const group = terminalGroupForType(type);
          if (group) setQuickTypes(current => ({ ...current, [group]: type }));
        }
        setPendingComponentType(type);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      if (e.key === 'Escape') {
        setOverlapChoice(null);
        setWiringFrom(null);
        wiringFromRef.current = null;
        setWiringCursor(null);
        setWiringWaypoints([]);
        setPendingComponentType(null);
        setSelectedId(null);
        setSelectedIds([]);
        setSelectedWireId(null);
      } else if (e.key === 'Enter' && selectedId) {
        const selected = elements.find(element => element.id === selectedId);
        if (selected) { e.preventDefault(); onOpenProperties(selected); }
      } else if (selectedSet.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -gridUnits : e.key === 'ArrowRight' ? gridUnits : 0;
        const dy = e.key === 'ArrowUp' ? -gridUnits : e.key === 'ArrowDown' ? gridUnits : 0;
        if (selectedSet.size > 1) {
          const moved = moveSelectedElements(elements, wires, selectedSet, dx, dy);
          onElementsChange(moved.elements); onWiresChange(moved.wires);
        } else transformSelection(element => ({ ...element, x: element.x + dx, y: element.y + dy }));
      } else if ((e.key === 'f' || e.key === 'а' || e.key === 'F') && selectedId) {
        // Отразить слева направо (стр. 4)
        e.preventDefault();
        const selected = elements.find(element => element.id === selectedId);
        if (selected) changeElementGeometry(selected, { ...selected, flipH: !selected.flipH });
      } else if ((e.key === 'v' || e.key === 'м' || e.key === 'V') && selectedId) {
        // Отразить сверху вниз (стр. 4)
        e.preventDefault();
        const selected = elements.find(element => element.id === selectedId);
        if (selected) changeElementGeometry(selected, { ...selected, flipV: !selected.flipV });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedSet.size) {
          e.preventDefault();
          deleteSelection();
        } else if (selectedWireId) {
          e.preventDefault();
          onWiresChange(wires.filter((w) => w.id !== selectedWireId));
          setSelectedWireId(null);
        }
      } else if (e.key === 'F9') {
        // F9 - Запуск моделирования
        e.preventDefault();
        onRunSimulation();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, selectedIds, selectedSet, selectedWireId, copiedElement, copiedGroup, elements, wires, onElementsChange, onWiresChange, changeElementGeometry, onOpenProperties, onSelectElement, onRunSimulation, shortcutsEnabled, isPaletteOpen, shortcutSettingsOpen, editorShortcuts]);

  // Добавление нового компонента на схему
  const handlePlaceNewComponent = (type: ComponentType, worldX: number, worldY: number, replaceId = replacingId) => {
    const existingSameType = elements.filter((e) => e.type === type);
    const count = existingSameType.length + 1;

    let defaultName = `${type}${count}`;
    let defaultValue = 1000;
    let defaultValueStr = '1к';
    let defaultUnit = 'Ом';
    let portName = '';

    if (type === 'R') {
      defaultName = `R${count}`;
      defaultValue = 1000;
      defaultValueStr = '1к';
      defaultUnit = 'Ом';
    } else if (type === 'L') {
      defaultName = `L${count}`;
      defaultValue = 10e-3;
      defaultValueStr = '10м';
      defaultUnit = 'Гн';
    } else if (type === 'C') {
      defaultName = `C${count}`;
      defaultValue = 1e-6;
      defaultValueStr = '1мк';
      defaultUnit = 'Ф';
    } else if (type === 'DIODE') {
      defaultName = `VD${count}`;
      defaultValue = 0;
      defaultValueStr = 'Диод';
      defaultUnit = '';
    } else if (type === 'THYRISTOR') {
      defaultName = `VS${count}`;
      defaultValue = 0;
      defaultValueStr = 'Тиристор';
      defaultUnit = '';
    } else if (type === 'SWITCH') {
      defaultName = `SW${count}`;
      defaultValue = 20000;
      defaultValueStr = '20к';
      defaultUnit = 'Гц';
    } else if (['NPN', 'PNP', 'NMOS', 'PMOS'].includes(type)) {
      defaultName = `VT${count}`;
      defaultValue = type === 'NPN' || type === 'PNP' ? 100 : 0.001;
      defaultValueStr = type === 'NPN' || type === 'PNP' ? '100' : '1м';
      defaultUnit = type === 'NPN' || type === 'PNP' ? 'β' : 'А/В²';
    } else if (type === 'V_DC') {
      defaultName = `U${count}`;
      defaultValue = 12;
      defaultValueStr = '12';
      defaultUnit = 'В';
    } else if (type === 'V_AC') {
      defaultName = `U${count}`;
      defaultValue = 220;
      defaultValueStr = '220';
      defaultUnit = 'В';
    } else if (type === 'V_PULSE') {
      defaultName = `U${count}`;
      defaultValue = 5;
      defaultValueStr = '5';
      defaultUnit = 'В';
    } else if (type === 'I_DC') {
      defaultName = `I${count}`;
      defaultValue = 1;
      defaultValueStr = '1';
      defaultUnit = 'А';
    } else if (type === 'I_AC' || type === 'I_PULSE') {
      defaultName = `I${count}`;
      defaultValue = 1;
      defaultValueStr = '1';
      defaultUnit = 'А';
    } else if (type === 'VCVS' || type === 'VCCS' || type === 'CCVS' || type === 'CCCS') {
      defaultName = `${type === 'VCVS' ? 'E' : type === 'VCCS' ? 'G' : type === 'CCVS' ? 'H' : 'F'}${count}`;
      defaultValue = 1;
      defaultValueStr = '1';
      defaultUnit = type === 'VCCS' ? 'См' : type === 'CCVS' ? 'Ом' : '';
    } else if (type === 'CHIP') {
      defaultName = `DD${count}`;
      defaultValue = 0;
      defaultValueStr = '';
      defaultUnit = '';
    } else if (type === 'OPAMP') {
      defaultName = `ОУ${count}`;
      defaultValue = 1e6;
      defaultValueStr = '1M';
      defaultUnit = 'В/В';
    } else if (type === 'COMPARATOR') {
      defaultName = `COMP${count}`;
      defaultValue = 1e5;
      defaultValueStr = '100k';
      defaultUnit = 'В/В';
    } else if (type === 'GND') {
      defaultName = `GND${count}`;
      defaultValue = 0;
      defaultValueStr = '';
      defaultUnit = '';
    } else if (type === 'PORT') {
      portName = elements.some(el => el.name.toLocaleUpperCase() === 'PORT_OUT')
        ? nextComponentName(elements, 'PORT_P').slice('PORT_'.length)
        : 'OUT';
      defaultName = `PORT_${portName}`;
      defaultValue = 0;
      defaultValueStr = '';
      defaultUnit = '';
    } else if (type === 'NOT') {
      defaultName = `NOT${count}`;
      defaultValue = 0;
      defaultValueStr = 'НЕ';
      defaultUnit = '';
    } else if (type === 'AND') {
      defaultName = `AND${count}`;
      defaultValue = 0;
      defaultValueStr = '&';
      defaultUnit = '';
    } else if (type === 'OR') {
      defaultName = `OR${count}`;
      defaultValue = 0;
      defaultValueStr = '≥1';
      defaultUnit = '';
    } else if (type === 'XOR') {
      defaultName = `XOR${count}`;
      defaultValue = 0;
      defaultValueStr = '=1';
      defaultUnit = '';
    } else if (type === 'RS_FF') {
      defaultName = `RS${count}`;
      defaultValue = 0;
      defaultValueStr = 'RS-FF';
      defaultUnit = '';
    } else if (type === 'D_FF') {
      defaultName = `D${count}`;
      defaultValue = 0;
      defaultValueStr = 'D-FF';
      defaultUnit = '';
    } else if (type === 'JK_FF') {
      defaultName = `JK${count}`;
      defaultValue = 0;
      defaultValueStr = 'JK-FF';
      defaultUnit = '';
    } else if (type === 'TR3') {
      defaultName = `TR${count}`;
      defaultValue = 1;
      defaultValueStr = '1';
      defaultUnit = 'Гн';
    } else if (type === 'JUNCTION') {
      defaultName = `N${count}`;
      defaultValue = 0;
      defaultValueStr = '';
      defaultUnit = '';
    } else if (type === 'TEXT') {
      defaultName = `TXT${count}`;
      defaultValue = 0;
      defaultValueStr = '';
      defaultUnit = '';
    }

    if (type !== 'PORT') defaultName = nextComponentName(elements, defaultName.replace(/\d+$/, ''));

    const newElem: CircuitElement = {
      id: `elem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      name: defaultName,
      x: worldX,
      y: worldY,
      rotation: 0,
      value: defaultValue,
      valueStr: defaultValueStr,
      unit: defaultUnit,
      secondaryValue: type === 'V_AC' || type === 'I_AC' ? 50 : type === 'V_PULSE' || type === 'I_PULSE' ? 1000 : undefined,
      secondaryStr: type === 'V_AC' || type === 'I_AC' ? '50' : type === 'V_PULSE' || type === 'I_PULSE' ? '1к' : undefined,
      initialCondition: type === 'V_PULSE' || type === 'I_PULSE' ? 0.5 : undefined,
      chipPins: type === 'CHIP' ? DEFAULT_CHIP_PINS.map(pin => ({ ...pin })) : undefined,
      transistorModel: ['NPN', 'PNP', 'NMOS', 'PMOS'].includes(type) ? 'nonlinear' : undefined,
      portName,
      textDirective: type === 'TEXT' ? '.define Rload = 100;' : undefined,
    };

    const replacing = elements.find(el => el.id === replaceId);
    if (replacing) {
      const replacement = { ...newElem, id: replacing.id, x: replacing.x, y: replacing.y, rotation: replacing.rotation, flipH: replacing.flipH, flipV: replacing.flipV };
      const validPins = new Set(getComponentPins(replacement).map(pin => pin.id));
      onElementsChange(elements.map(el => el.id === replacing.id ? replacement : el));
      onWiresChange(wires.filter(w =>
        (w.fromCompId !== replacing.id || validPins.has(w.fromPinId)) &&
        (w.toCompId !== replacing.id || validPins.has(w.toPinId))
      ));
      setReplacingId(null);
      setSelectedId(replacing.id);
      setSelectedIds([replacing.id]);
    } else {
      onElementsChange([...elements, newElem]);
    }
    setSelectedId(newElem.id);
    setSelectedIds([newElem.id]);
    if (replacing) setPendingComponentType(null);
  };

  // Координаты всех выводов компонентов схемы
  const pinPositions = useMemo(() => {
    const map = new Map<
      string,
      { compId: string; pinId: string; componentName: string; x: number; y: number; name: string; label?: string; relX: number; relY: number; elType: string }
    >();
    for (const el of elements) {
      const pins = getComponentPins(el);
      for (const p of pins) {
        map.set(`${el.id}_${p.id}`, {
          compId: el.id,
          pinId: p.id,
          componentName: el.name,
          x: el.x + p.x,
          y: el.y + p.y,
          name: p.name,
          label: p.label,
          relX: p.x,
          relY: p.y,
          elType: el.type,
        });
      }
    }
    return map;
  }, [elements]);
  const connectedPinKeys = useMemo(() => new Set(wires.filter(wire => !wire.disabled).flatMap(wire => [
    `${wire.fromCompId}_${wire.fromPinId}`, `${wire.toCompId}_${wire.toPinId}`,
  ])), [wires]);
  const pinSpatialIndex = useMemo(() => new SpatialIndex(Array.from(pinPositions.values()).map(pin => ({
    minX: pin.x, maxX: pin.x, minY: pin.y, maxY: pin.y, value: pin,
  }))), [pinPositions]);

  // Геометрия всех проводов с ортогональной трассировкой (под прямым углом)
  const wireGeometries = useMemo(() => {
    const occupiedByNode = new Map<number | undefined, Point[][]>();
    const geometries: Array<{
      wire: CircuitWire;
      p1: NonNullable<ReturnType<typeof pinPositions.get>>;
      p2: NonNullable<ReturnType<typeof pinPositions.get>>;
      points: Point[];
      pathD: string;
    }> = [];

    for (const wire of wires) {
      const p1 = pinPositions.get(`${wire.fromCompId}_${wire.fromPinId}`);
      const p2 = pinPositions.get(`${wire.toCompId}_${wire.toPinId}`);
      if (!p1 || !p2) continue;
      const node = circuitGraph.pinToNode.get(`${wire.fromCompId}_${wire.fromPinId}`);
      const foreignRoutes = Array.from(occupiedByNode.entries())
        .filter(([occupiedNode]) => occupiedNode !== node)
        .flatMap(([, routes]) => routes);

      let pts: Point[];
      if (wire.routeMode === 'direct') {
        pts = simplifyPoints([p1, ...(wire.waypoints ?? []), p2]);
      } else if (wire.manual || wire.waypoints?.length) {
        pts = buildStoredWireRoute(
          p1, p2, wire.waypoints ?? [],
          { x: p1.relX, y: p1.relY },
          { x: p2.relX, y: p2.relY },
          p1.elType, p2.elType, gridUnits
        );
      } else {
        const offsets = [0, gridUnits, -gridUnits, gridUnits * 2, -gridUnits * 2, gridUnits * 3, -gridUnits * 3];
        const candidates = offsets.map(offset => computeOrthogonalWirePoints(
          p1,
          p2,
          { x: p1.relX, y: p1.relY },
          { x: p2.relX, y: p2.relY },
          p1.elType,
          p2.elType,
          offset, gridUnits
        ));
        pts = candidates.reduce((best, candidate) =>
          overlappingLength(candidate, foreignRoutes) < overlappingLength(best, foreignRoutes) ? candidate : best
        );
      }

      const routes = occupiedByNode.get(node);
      if (routes) routes.push(pts);
      else occupiedByNode.set(node, [pts]);
      geometries.push({ wire, p1, p2, points: pts, pathD: pointsToSvgPath(pts) });
    }
    return geometries;
  }, [wires, pinPositions, circuitGraph, gridUnits]);
  const sceneLabels = useMemo(() => arrangeComponentLabels(elements, wireGeometries, elements.flatMap(element => {
    const pins = getComponentPins(element);
    const xs = [-20, 20, ...pins.map(pin => pin.x)], ys = [-20, 20, ...pins.map(pin => pin.y)];
    const minX = Math.min(...xs) - 14, minY = Math.min(...ys) - 14;
    if (element.type === 'CHIP' || element.type === 'TR3') return [{ x: element.x + minX, y: element.y + minY, width: Math.max(...xs) + 14 - minX, height: Math.max(...ys) + 14 - minY }];
    const radius = (element.rotation || 0) % 90 === 0 ? 24 : 32;
    return [{ x: element.x - radius, y: element.y - radius, width: radius * 2, height: radius * 2 },
      ...pins.map(pin => ({ x: element.x + pin.x - 9, y: element.y + pin.y - 12, width: 26, height: 22 }))];
  }), showElementNames, showElementValues), [elements, wireGeometries, showElementNames, showElementValues]);
  const wireSpatialIndex = useMemo(() => new SpatialIndex(wireGeometries.flatMap(geometry =>
    geometry.wire.disabled ? [] : geometry.points.slice(1).map((b, index) => {
      const a = geometry.points[index];
      return {
        minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y),
        value: { wireId: geometry.wire.id, a, b },
      };
    })
  )), [wireGeometries]);

  // Разделение провода и создание подвижного узла (JUNCTION)
  const handleWirePointClick = (wireId: string, px: number, py: number) => {
    if (pendingComponentType || !(wiringFromRef.current ?? wiringFrom)) return;
    const targetWire = wires.find((w) => w.id === wireId);
    const geometry = wireGeometries.find(item => item.wire.id === wireId);
    if (!targetWire || targetWire.disabled || !geometry) return;
    const projected = projectPointToWire(geometry.points, { x: px, y: py }, gridUnits);
    if (!projected) return;
    const point = projected.point;
    const wiringSource = wiringFromRef.current ?? wiringFrom;
    if (!wiringSource) return;

    // At a terminal there is no segment to split.
    const endpoint = samePoint(point, geometry.points[0])
      ? { compId: targetWire.fromCompId, pinId: targetWire.fromPinId }
      : samePoint(point, geometry.points.at(-1)!)
        ? { compId: targetWire.toCompId, pinId: targetWire.toPinId }
        : null;
    if (endpoint) {
      if ((endpoint.compId !== wiringSource.compId || endpoint.pinId !== wiringSource.pinId) &&
          !wires.some(w => (w.fromCompId === endpoint.compId && w.fromPinId === endpoint.pinId && w.toCompId === wiringSource.compId && w.toPinId === wiringSource.pinId) ||
            (w.toCompId === endpoint.compId && w.toPinId === endpoint.pinId && w.fromCompId === wiringSource.compId && w.fromPinId === wiringSource.pinId))) {
        onWiresChange([...wires, {
          id: `wire_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          fromCompId: wiringSource.compId, fromPinId: wiringSource.pinId,
          toCompId: endpoint.compId, toPinId: endpoint.pinId,
          routeMode: wireMode,
          waypoints: wireMode === 'orthogonal' && wiringWaypoints.length ? [...wiringWaypoints] : undefined,
          manual: wireMode === 'orthogonal' && wiringWaypoints.length > 0,
        }]);
      }
      wiringFromRef.current = null;
      setWiringFrom(null); setWiringCursor(null); setWiringWaypoints([]);
      setHoveredWirePoint(null); wirePointerDown.current = false;
      return;
    }
    const split = splitWireRoute(geometry.points, projected.segmentIndex, point);

    // Создаем новый узел соединения (JUNCTION по ГОСТ 2.702)
    const junctionId = `junction_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newJunction: CircuitElement = {
      id: junctionId,
      type: 'JUNCTION',
      name: nextComponentName(elements, 'N'),
      x: point.x,
      y: point.y,
      rotation: 0,
      value: 0,
      valueStr: '',
      unit: '',
    };

    // Заменяем исходный провод на 2 новых, сходящихся в этом узле
    const wireA: CircuitWire = {
      id: `wire_${Date.now()}_a_${Math.random().toString(36).slice(2, 6)}`,
      fromCompId: targetWire.fromCompId,
      fromPinId: targetWire.fromPinId,
      toCompId: junctionId,
      toPinId: '1',
      routeMode: targetWire.routeMode,
      waypoints: split.first.slice(1, -1),
      manual: targetWire.routeMode !== 'direct',
    };
    const wireB: CircuitWire = {
      id: `wire_${Date.now()}_b_${Math.random().toString(36).slice(2, 6)}`,
      fromCompId: junctionId,
      fromPinId: '1',
      toCompId: targetWire.toCompId,
      toPinId: targetWire.toPinId,
      routeMode: targetWire.routeMode,
      waypoints: split.second.slice(1, -1),
      manual: targetWire.routeMode !== 'direct',
    };

    const remainingWires = wires.filter((w) => w.id !== wireId);

    if (wiringSource) {
      // Подключение протягиваемого провода к новому узлу соединения
      const wireC: CircuitWire = {
        id: `wire_${Date.now()}_c_${Math.random().toString(36).slice(2, 6)}`,
        fromCompId: wiringSource.compId,
        fromPinId: wiringSource.pinId,
        toCompId: junctionId,
        toPinId: '1',
        routeMode: wireMode,
        waypoints: wireMode === 'orthogonal' && wiringWaypoints.length ? [...wiringWaypoints] : undefined,
        manual: wireMode === 'orthogonal' && wiringWaypoints.length > 0,
      };
      onElementsChange([...elements, newJunction]);
      onWiresChange([...remainingWires, wireA, wireB, wireC]);
      wiringFromRef.current = null;
      setWiringFrom(null);
      setWiringCursor(null);
      setWiringWaypoints([]);
      wirePointerDown.current = false;
      setSelectedId(junctionId);
      setSelectedIds([junctionId]);
      setSelectedWireId(null);
      setHoveredWirePoint(null);
      setHoveredPin(null);
    } else {
      onElementsChange([...elements, newJunction]);
      onWiresChange([...remainingWires, wireA, wireB]);
      setSelectedId(junctionId);
      setSelectedIds([junctionId]);
      setSelectedWireId(null);
      setHoveredWirePoint(null);
      setHoveredPin(null);
      if (wiringFromRef.current ?? wiringFrom) {
        // Начинаем вести новый провод от созданного узла
        setWiringFrom({ compId: junctionId, pinId: '1', x: px, y: py });
        setWiringCursor({ x: px, y: py });
      } else {
        // СРАЗУ В РЕЖИМ ПЕРЕМЕЩЕНИЯ ДЛЯ СОЗДАННОГО УЗЛА!
        // Зажатие мыши на проводе сразу двигает новую точку, а не начинает вести провод
        setDraggingElemId(junctionId);
        setDragOffset({ x: 0, y: 0 });
      }
    }
  };

  const appendManualWaypoint = (cursor: Point) => {
    if (wireMode === 'direct') return;
    const source = wiringFromRef.current ?? wiringFrom;
    if (!source) return;
    const previous = wiringWaypoints.at(-1) ?? source;
    const next = snapManualWirePoint(previous, cursor, gridUnits);
    if (samePoint(previous, next)) return;
    setWiringWaypoints(current => [...current, next]);
    setWiringCursor(next);
  };

  // Клик по канвасу
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      // Правая кнопка мыши - отмена по мануалу стр. 4
      e.preventDefault();
      wiringFromRef.current = null;
      wirePointerDown.current = false;
      setWiringFrom(null);
      setWiringCursor(null);
      setWiringWaypoints([]);
      setPendingComponentType(null);
      return;
    }

    if (e.button === 1 || e.shiftKey) {
      // Панорамирование
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    const pos = screenToWorld(e.clientX, e.clientY);

    // Если был выбран инструмент размещения
    if (pendingComponentType) {
      handlePlaceNewComponent(pendingComponentType, pos.x, pos.y);
      return;
    }

    if (wiringFrom) {
      if (wireMode === 'direct') return;
      appendManualWaypoint({ x: pos.rawX, y: pos.rawY });
      return;
    }

    setSelectedId(null);
    setSelectedIds([]);
    setSelectedWireId(null);
    if (e.button === 0) setMarquee({ start: { x: pos.rawX, y: pos.rawY }, end: { x: pos.rawX, y: pos.rawY } });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    const pos = screenToWorld(e.clientX, e.clientY);

    if (marquee) {
      setMarquee(current => current && { ...current, end: { x: pos.rawX, y: pos.rawY } });
      return;
    }

    if (wireSegmentDrag.current) {
      if (!(e.buttons & 1)) return;
      const drag = wireSegmentDrag.current;
      const a = drag.points[drag.segmentIndex], b = drag.points[drag.segmentIndex + 1];
      const horizontal = Math.abs(a.y - b.y) < ROUTE_EPSILON;
      const vertical = Math.abs(a.x - b.x) < ROUTE_EPSILON;
      const isDirect = wires.find(wire => wire.id === drag.wireId)?.routeMode === 'direct';
      const coordinate = horizontal ? snapToGrid(pos.rawY) : vertical ? snapToGrid(pos.rawX)
        : snapToGrid(((pos.rawX - a.x) - Math.sign((b.y - a.y) / (b.x - a.x)) * (pos.rawY - a.y)) / 2);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const freeOffset = length > ROUTE_EPSILON
        ? snapToGrid(((pos.rawX - a.x) * -(b.y - a.y) + (pos.rawY - a.y) * (b.x - a.x)) / length)
        : 0;
      if ((isDirect ? freeOffset === 0 : coordinate === (horizontal ? a.y : vertical ? a.x : 0)) && !drag.started) return;
      if (!drag.started) { onBeginContinuousEdit?.(); drag.started = true; }
      const route = isDirect
        ? moveFreeWireSegment(drag.points, drag.segmentIndex, freeOffset)
        : moveWireSegment(drag.points, drag.segmentIndex, coordinate);
      onWiresChange(wires.map(wire => wire.id === drag.wireId ? { ...wire, waypoints: route.slice(1, -1), manual: true } : wire));
      return;
    }

    // При активном перетаскивании элемента/точки — сразу обновляем координаты и выходим,
    // не пересчитывая hover, чтобы исключить любые конфликты и дерганья проводов
    if (draggingElemId) {
      if (e.buttons === 0) { setDraggingElemId(null); return; }
      setHoveredPin(null);
      setHoveredWirePoint(null);
      const targetX = snapToGrid(pos.rawX - dragOffset.x);
      const targetY = snapToGrid(pos.rawY - dragOffset.y);
      const dragged = elements.find(element => element.id === draggingElemId);
      if (dragged && (dragged.x !== targetX || dragged.y !== targetY)) {
        const group = groupDragIds.current;
        if (group && group.size > 1) {
          const dx = targetX - dragged.x, dy = targetY - dragged.y;
          const moved = moveSelectedElements(elements, wires, group, dx, dy);
          onElementsChange(moved.elements);
          onWiresChange(moved.wires);
        } else changeElementGeometry(dragged, { ...dragged, x: targetX, y: targetY });
      }
      return;
    }

    if (pendingComponentType) {
      setMouseWorldPos(current => current?.x === pos.x && current?.y === pos.y ? current : { x: pos.x, y: pos.y });
      setHoveredPin(null);
      setHoveredWirePoint(null);
      return;
    }

    // 1. Поиск ближайшего вывода (Магнитный захват с увеличенным радиусом 28px для надежной фиксации)
    let foundPin: { compId: string; pinId: string; x: number; y: number; name: string } | null = null;
    let minPinDist = 12 / zoom;
    for (const pin of pinSpatialIndex.query(pos.rawX, pos.rawY, minPinDist)) {
      const dist = Math.hypot(pos.rawX - pin.x, pos.rawY - pin.y);
      if (dist <= minPinDist) {
        minPinDist = dist;
        foundPin = { compId: pin.compId, pinId: pin.pinId, x: pin.x, y: pin.y, name: `${pin.componentName}.${pin.name}` };
      }
    }
    setHoveredPin(current => current?.compId === foundPin?.compId && current?.pinId === foundPin?.pinId ? current : foundPin);

    // 2. Если пин не найден — проверяем наведение на сегменты существующих проводов
    let foundWirePoint: { wireId: string; x: number; y: number } | null = null;
    if (wiringFrom && !foundPin) {
      let minWireDist = 8 / zoom;
      for (const segment of wireSpatialIndex.query(pos.rawX, pos.rawY, minWireDist)) {
        const hit = projectPointToWire([segment.a, segment.b], { x: pos.rawX, y: pos.rawY }, gridUnits);
        if (hit && hit.distance <= minWireDist) {
          minWireDist = hit.distance;
          foundWirePoint = { wireId: segment.wireId, ...hit.point };
        }
      }
    }
    setHoveredWirePoint(current => current?.wireId === foundWirePoint?.wireId &&
      current?.x === foundWirePoint?.x && current?.y === foundWirePoint?.y ? current : foundWirePoint);

    // 3. Обновление положения проводки при протягивании
    if (wiringFrom) {
      if (foundPin && (foundPin.compId !== wiringFrom.compId || foundPin.pinId !== wiringFrom.pinId)) {
        // Фиксация точно в точке вывода
        setWiringCursor({ x: foundPin.x, y: foundPin.y });
      } else if (foundWirePoint) {
        // Фиксация точно в точке на проводе
        setWiringCursor({ x: foundWirePoint.x, y: foundWirePoint.y });
      } else {
        // Плавное следование строго по сетке 20px
        setWiringCursor(wireMode === 'direct'
          ? { x: pos.rawX, y: pos.rawY }
          : snapManualWirePoint(wiringWaypoints.at(-1) ?? wiringFrom, { x: pos.rawX, y: pos.rawY }, gridUnits));
      }
    }
  };

  const handleCanvasMouseUp = (event?: React.MouseEvent) => {
    if (marquee) {
      const cursor = event ? screenToWorld(event.clientX, event.clientY) : null;
      const end = cursor ? { x: cursor.rawX, y: cursor.rawY } : marquee.end;
      const minX = Math.min(marquee.start.x, end.x);
      const maxX = Math.max(marquee.start.x, end.x);
      const minY = Math.min(marquee.start.y, end.y);
      const maxY = Math.max(marquee.start.y, end.y);
      if (Math.hypot(maxX - minX, maxY - minY) > 4 / zoom) {
        const ids = elements.filter(element => element.x >= minX && element.x <= maxX && element.y >= minY && element.y <= maxY).map(element => element.id);
        setSelectedIds(ids); setSelectedId(ids[0] ?? null);
      }
      setMarquee(null);
    }
    if (event && event.button === 0 && paletteDragGroup && pendingComponentType) {
      const pos = screenToWorld(event.clientX, event.clientY);
      handlePlaceNewComponent(pendingComponentType, pos.x, pos.y);
      setPaletteDragGroup(null);
    }
    if (draggingElemId) onEndContinuousEdit?.();
    if (wireSegmentDrag.current?.started) onEndContinuousEdit?.();
    wireSegmentDrag.current = null;
    if (wirePointerDown.current) {
      wirePointerDown.current = false;
      if (event && (wiringFromRef.current ?? wiringFrom)) {
        const pos = screenToWorld(event.clientX, event.clientY);
        appendManualWaypoint({ x: pos.rawX, y: pos.rawY });
      }
    }
    setIsPanning(false);
    setDraggingElemId(null);
    groupDragIds.current = null;
  };

  // Нажатие на вывод элемента (Pin)
  const connectPin = (compId: string, pinId: string, px: number, py: number) => {
    const wiringSource = wiringFromRef.current ?? wiringFrom;
    if (!wiringSource) {
      // Зажать кнопку на первом выводе и протянуть до цели.
      wirePointerDown.current = true;
      wiringFromRef.current = { compId, pinId, x: px, y: py };
      setWiringFrom({ compId, pinId, x: px, y: py });
      setWiringCursor({ x: px, y: py });
      setWiringWaypoints([]);
    } else {
      // Завершение соединения двух выводов (клик по целевому выводу)
      if (wiringSource.compId === compId && wiringSource.pinId === pinId) {
        // Кликнули в тот же самый вывод — отмена
        setWiringFrom(null);
        wiringFromRef.current = null;
        setWiringCursor(null);
        setWiringWaypoints([]);
        return;
      }

      // Проверка на дубликат провода
      const exists = wires.some(
        (w) =>
          (w.fromCompId === wiringSource.compId &&
            w.fromPinId === wiringSource.pinId &&
            w.toCompId === compId &&
            w.toPinId === pinId) ||
          (w.fromCompId === compId &&
            w.fromPinId === pinId &&
            w.toCompId === wiringSource.compId &&
            w.toPinId === wiringSource.pinId)
      );

      if (!exists) {
        const newWire: CircuitWire = {
          id: `wire_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          fromCompId: wiringSource.compId,
          fromPinId: wiringSource.pinId,
          toCompId: compId,
          toPinId: pinId,
          routeMode: wireMode,
          waypoints: wireMode === 'orthogonal' && wiringWaypoints.length ? [...wiringWaypoints] : undefined,
          manual: wireMode === 'orthogonal' && wiringWaypoints.length > 0,
        };
        if (crossingMode === 'connect') {
          const sourcePin = pinPositions.get(`${wiringSource.compId}_${wiringSource.pinId}`);
          const targetPin = pinPositions.get(`${compId}_${pinId}`);
          if (sourcePin && targetPin) {
            const connectedGraph = buildCircuitGraph(elements, [...wires, newWire]);
            const newNode = connectedGraph.pinToNode.get(`${newWire.fromCompId}_${newWire.fromPinId}`);
            const foreignRoutes = wireGeometries.filter(geometry =>
              connectedGraph.pinToNode.get(`${geometry.wire.fromCompId}_${geometry.wire.fromPinId}`) !== newNode)
              .map(geometry => geometry.points);
            const offsets = [0, gridUnits, -gridUnits, gridUnits * 2, -gridUnits * 2, gridUnits * 3, -gridUnits * 3];
            const route = newWire.routeMode === 'direct'
              ? simplifyPoints([sourcePin, ...(newWire.waypoints ?? []), targetPin])
              : newWire.manual
              ? buildStoredWireRoute(sourcePin, targetPin, newWire.waypoints ?? [],
                { x: sourcePin.relX, y: sourcePin.relY }, { x: targetPin.relX, y: targetPin.relY },
                sourcePin.elType, targetPin.elType, gridUnits)
              : offsets.map(offset => computeOrthogonalWirePoints(sourcePin, targetPin,
                { x: sourcePin.relX, y: sourcePin.relY }, { x: targetPin.relX, y: targetPin.relY },
                sourcePin.elType, targetPin.elType, offset, gridUnits))
                .reduce((best, candidate) => overlappingLength(candidate, foreignRoutes) < overlappingLength(best, foreignRoutes)
                  ? candidate : best);
            try {
              const connected = materializeWireCrossings(elements, [...wires, newWire],
                [...wireGeometries, { wire: newWire, points: route }], newWire.id);
              if (connected.elements !== elements) onElementsChange(connected.elements);
              onWiresChange(connected.wires);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : 'Не удалось создать провод.');
            }
          } else onWiresChange([...wires, newWire]);
        } else onWiresChange([...wires, newWire]);
      }

      setWiringFrom(null);
      wiringFromRef.current = null;
      setWiringCursor(null);
      setWiringWaypoints([]);
      wirePointerDown.current = false;
    }
  };
  const handlePinClick = (e: React.MouseEvent, compId: string, pinId: string, px: number, py: number) => {
    if (pendingComponentType || e.button !== 0) return;
    e.stopPropagation();
    const coincident = pinSpatialIndex.query(px, py, ROUTE_EPSILON).filter(pin =>
      Math.hypot(pin.x - px, pin.y - py) < ROUTE_EPSILON);
    if (coincident.length > 1) {
      wirePointerDown.current = false;
      setOverlapChoice({
        x: e.clientX, y: e.clientY,
        pins: coincident.map(pin => ({ compId: pin.compId, pinId: pin.pinId, x: pin.x, y: pin.y, name: `${pin.componentName}.${pin.name}` })),
      });
      return;
    }
    connectPin(compId, pinId, px, py);
  };

  const handlePinMouseUp = (e: React.MouseEvent, compId: string, pinId: string, px: number, py: number) => {
    if (!wirePointerDown.current) return;
    e.stopPropagation();
    wirePointerDown.current = false;
    const source = wiringFromRef.current ?? wiringFrom;
    if (source?.compId === compId && source.pinId === pinId) return;
    handlePinClick(e, compId, pinId, px, py);
  };

  // Нажатие на элемент
  const handleElementMouseDown = (e: React.MouseEvent, el: CircuitElement) => {
    if (e.button === 1) return;
    e.stopPropagation();
    if (e.button === 2) {
      // Правая кнопка мыши — отмена проводки и инструмента
      wiringFromRef.current = null;
      wirePointerDown.current = false;
      setWiringFrom(null);
      setWiringCursor(null);
      setPendingComponentType(null);
      return;
    }

    const pos = screenToWorld(e.clientX, e.clientY);

    if (pendingComponentType) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const next = selectedIds.includes(el.id) ? selectedIds.filter(id => id !== el.id) : [...selectedIds, el.id];
      setSelectedIds(next);
      setSelectedId(next.at(-1) ?? null);
      setSelectedWireId(null);
      return;
    }
    if (el.type === 'JUNCTION' && (wiringFromRef.current ?? wiringFrom)) {
      handlePinClick(e, el.id, '1', el.x, el.y);
      return;
    }
    if (!(wiringFromRef.current ?? wiringFrom)) {
      const ids = selectedIds.includes(el.id) ? selectedIds : [el.id];
      setSelectedIds(ids);
      setSelectedId(el.id);
      setSelectedWireId(null);
      onSelectElement(el);
      setWiringFrom(null);
      setWiringCursor(null);
      onBeginContinuousEdit?.();
      setDraggingElemId(el.id);
      groupDragIds.current = new Set(ids);
      setDragOffset({ x: pos.rawX - el.x, y: pos.rawY - el.y });
      return;
    }

    const pins = getComponentPins(el);

    // 1. Если кликнули возле подсвеченного вывода или в радиусе 24px от любого пина — СРАЗУ ПРОВОДКА!
    if (hoveredPin && hoveredPin.compId === el.id) {
      handlePinClick(e, hoveredPin.compId, hoveredPin.pinId, hoveredPin.x, hoveredPin.y);
      return;
    }

    for (const p of pins) {
      const absX = el.x + p.x;
      const absY = el.y + p.y;
      if (Math.hypot(pos.rawX - absX, pos.rawY - absY) <= 12 / zoom) {
        handlePinClick(e, el.id, p.id, absX, absY);
        return;
      }
    }

    // 2. Если сейчас активен режим проводки и кликнули по элементу рядом с выводом (радиус 36px) — завершаем проводку к нему
    if (wiringFrom) {
      let closestPin = pins[0];
      let minDist = Infinity;
      for (const p of pins) {
        const absX = el.x + p.x;
        const absY = el.y + p.y;
        const dist = Math.hypot(pos.rawX - absX, pos.rawY - absY);
        if (dist < minDist) {
          minDist = dist;
          closestPin = p;
        }
      }
      if (closestPin && minDist <= 12 / zoom) {
        handlePinClick(e, el.id, closestPin.id, el.x + closestPin.x, el.y + closestPin.y);
        return;
      }
    }

    // 3. Стандартный выбор и перетаскивание элемента
    setSelectedId(el.id);
    setSelectedIds([el.id]);
    setSelectedWireId(null);
    onSelectElement(el);

  };

  // Двойной щелчок по элементу: открытие окна параметров (стр. 4: "двойной щелчок мышью - появится окно параметров")
  const handleElementDoubleClick = (e: React.MouseEvent, el: CircuitElement) => {
    e.stopPropagation();
    if (wiringFrom || pendingComponentType) return;
    onOpenProperties(el);
  };

  const runElementAction = (id: string, action: string) => {
    const el = elements.find(item => item.id === id);
    setContextMenu(null);
    if (!el) return;
    const twoPins = getComponentPins(el).map(pin => pin.id);
    if (action === 'copy') setCopiedElement({ ...el });
    if (action === 'paste' && copiedElement) {
      const source = copiedElement;
      const baseName = `${source.name}_копия`;
      const name = elements.some(item => item.name.toLocaleUpperCase() === baseName.toLocaleUpperCase())
        ? nextComponentName(elements, baseName, 2) : baseName;
      const copy = { ...source, id: `elem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, x: snapToGrid(el.x + 40), y: snapToGrid(el.y + 40) };
      onElementsChange([...elements, copy]);
      setSelectedId(copy.id);
      setSelectedIds([copy.id]);
    }
    if (action === 'delete') {
      onElementsChange(elements.filter(item => item.id !== id));
      onWiresChange(wires.filter(w => w.fromCompId !== id && w.toCompId !== id));
      setSelectedId(null);
      setSelectedIds([]);
    }
    if (['cw', 'ccw', 'cw45', 'ccw45'].includes(action)) {
      const delta = action === 'cw' ? 90 : action === 'ccw' ? 270 : action === 'cw45' ? 45 : 315;
      changeElementGeometry(el, { ...el, rotation: ((el.rotation || 0) + delta) % 360 });
    }
    if (action === 'swap' && twoPins.length === 2) onWiresChange(wires.map(w => ({
      ...w,
      fromPinId: w.fromCompId === id ? (w.fromPinId === twoPins[0] ? twoPins[1] : w.fromPinId === twoPins[1] ? twoPins[0] : w.fromPinId) : w.fromPinId,
      toPinId: w.toCompId === id ? (w.toPinId === twoPins[0] ? twoPins[1] : w.toPinId === twoPins[1] ? twoPins[0] : w.toPinId) : w.toPinId,
    })));
    if (action === 'normal' || action === 'open' || action === 'short') onElementsChange(elements.map(item => item.id === id ? { ...item, isolation: action === 'normal' ? undefined : action as 'open' | 'short' } : item));
    if (action === 'properties') onOpenProperties(el);
    if (action === 'replace') { setReplacingId(id); setIsPaletteOpen(true); }
  };

  useEffect(() => {
    if (!exportTarget) return;
    try {
      const source = svgRef.current;
      if (!source) return;
      const clone = source.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll('[data-export-hide="true"]').forEach(node => node.remove());
      clone.querySelector('#schematic-screen-background')?.remove();
      const world = clone.querySelector('#schematic-world') as SVGGElement | null;
      if (!world) return;
      world.removeAttribute('transform');
      // Measure the same SVG nodes that are exported, including routed wires and labels.
      // A hidden DOM attachment gives Firefox/Chromium reliable text metrics.
      clone.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
      document.body.appendChild(clone);
      let box: DOMRect;
      try { box = world.getBBox(); } finally { clone.remove(); clone.removeAttribute('style'); }
      const padding = 2 * SCHEMATIC_UNITS_PER_MM;
      const bounds = elements.length || wires.length
        ? { x: box.x - padding, y: box.y - padding, width: Math.max(box.width, 1) + 2 * padding, height: Math.max(box.height, 1) + 2 * padding }
        : { x: 0, y: 0, width: 1, height: 1 };
      const placement = computePrintPlacement(bounds, printLayout, printMarginMm, printMode, requestedPrintScale, centerPrint);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', `${placement.widthMm}mm`);
      clone.setAttribute('height', `${placement.heightMm}mm`);
      clone.setAttribute('viewBox', `0 0 ${placement.width} ${placement.height}`);
      world.setAttribute('transform', `translate(${placement.translateX} ${placement.translateY}) scale(${placement.scale})`);
      const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      background.setAttribute('x', '0'); background.setAttribute('y', '0');
      background.setAttribute('width', String(placement.width)); background.setAttribute('height', String(placement.height));
      background.setAttribute('fill', '#ffffff');
      clone.insertBefore(background, world || clone.firstChild);
      const xml = new XMLSerializer().serializeToString(clone).replaceAll('#dc2626', '#1e293b').replaceAll('#2563eb', '#1e293b');
      const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>@page{size:${placement.widthMm}mm ${placement.heightMm}mm;margin:0}body{margin:0;background:#e2e8f0;display:flex;justify-content:center}svg{display:block;max-width:100%;height:auto;background:white;box-shadow:0 4px 24px #0002}@media print{body{display:block;background:white}svg{width:${placement.widthMm}mm!important;height:${placement.heightMm}mm!important;max-width:none;box-shadow:none}}</style></head><body>${xml}</body></html>`;
      setExportPlan({ xml, html, placement });
      setExportError(null);
    } catch (error) {
      setExportPlan(null);
      setExportError(error instanceof Error ? error.message : 'Не удалось подготовить лист.');
    }
  }, [exportTarget, printLayout, printMarginMm, printMode, requestedPrintScale, centerPrint, elements, wires, zoom, pan, showElementNames, showElementValues, showNodeNumbers]);

  const downloadSchematic = (format: 'png' | 'svg' | 'pdf' | 'print') => {
    if (!exportPlan || !exportPlan.placement.fits) return;
    if (format === 'print') { printPreviewRef.current?.contentWindow?.print(); return; }
    const { xml, placement } = exportPlan;
    const { width, height, widthMm, heightMm } = placement;
    const fileName = `схема-${printLayout.format}-${printLayout.orientation}`;
    if (format === 'svg') {
      const link = document.createElement('a');
      const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
      link.href = svgUrl; link.download = `${fileName}.svg`; link.click();
      setTimeout(() => URL.revokeObjectURL(svgUrl), 1000);
      return;
    }
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      const scale = 300 / 25.4 / SCHEMATIC_UNITS_PER_MM;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
      const context = canvas.getContext('2d');
      if (!context) { URL.revokeObjectURL(url); return; }
      context.scale(scale, scale); context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
      canvas.toBlob(async blob => {
        try {
          if (!blob) throw new Error('Не удалось сформировать лист.');
          const output = format === 'pdf' ? await rasterPagePdf(blob, canvas.width, canvas.height, widthMm, heightMm) : blob;
          const link = document.createElement('a');
          const outputUrl = URL.createObjectURL(output);
          link.href = outputUrl; link.download = format === 'pdf' ? `${fileName}.pdf` : `${fileName}-300dpi.png`; link.click();
          setTimeout(() => URL.revokeObjectURL(outputUrl), 1000);
        } catch (error) { window.alert(error instanceof Error ? error.message : 'Ошибка экспорта листа.'); }
        finally { URL.revokeObjectURL(url); }
      }, format === 'pdf' ? 'image/jpeg' : 'image/png', 0.96);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      window.alert('Не удалось преобразовать SVG в изображение. Сохраните лист в формате SVG или проверьте элементы схемы.');
    };
    image.src = url;
  };

  // The cached symbol layer must still dispatch with the latest hovered contact.
  const elementMouseDownRef = useRef(handleElementMouseDown);
  elementMouseDownRef.current = handleElementMouseDown;
  return (
    <div className="schematic-editor flex flex-col h-full bg-slate-100 select-none border border-slate-300 rounded overflow-hidden text-slate-800">
      {/* Верхняя панель инструментов редактора. */}
      <div className="schematic-toolbar border-b border-slate-300 flex flex-wrap items-center justify-between shrink-0 z-20">
        {/* Кнопки инструментов и быстрый выбор компонентов */}
        <div className="relative z-20 flex min-w-0 flex-1 basis-[760px] items-center gap-1.5 flex-wrap">
          {/* Быстрый выбор по числу выводов. Колесо перебирает элементы группы. */}
          <div className="flex max-w-full flex-wrap items-center gap-0.5 bg-white border border-slate-300 rounded p-0.5 shadow-2xs">
            {TERMINAL_GROUPS.filter(group => group.id === 'two').map(group => {
              const options = PLACEMENT_CATALOG.filter(item => terminalGroupForType(item.type) === group.id);
              const type = quickTypes[group.id] ?? options[0]?.type;
              const definition = COMPONENT_CATALOG.find(item => item.type === type);
              return <div key={group.id} className={`flex shrink-0 items-center gap-0.5 rounded border p-0.5 ${paletteDragGroup === group.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`} title={`${group.label}: удерживайте ЛКМ и перенесите на схему; колесо меняет элемент`}>
                <span className="px-1 text-[10px] font-bold text-slate-500">{group.id === 'two' ? '2-пол.' : group.id === 'three' ? '3-пол.' : group.id === 'four' ? '4-пол.' : 'много'}</span>
                <button type="button" disabled={!type} onMouseDown={event => { if (event.button !== 0 || !type) return; event.preventDefault(); setPaletteDragGroup(group.id); setPendingComponentType(type); wiringFromRef.current = null; setWiringFrom(null); setWiringCursor(null); setWiringWaypoints([]); }} className="flex h-8 min-w-20 items-center gap-1 rounded bg-slate-50 px-1.5 text-[10px] font-semibold text-slate-700 hover:bg-blue-100 disabled:opacity-40">
                  {type && <ComponentSymbol type={type} className="quick-component-symbol" />}<span className="max-w-16 truncate">{definition?.name ?? 'Нет элементов'}</span>
                </button>
                <select aria-label={`${group.label}: выбрать элемент`} value={type || ''} disabled={!options.length} onChange={e => { const selected = e.target.value as ComponentType; setQuickTypes(current => ({ ...current, [group.id]: selected })); setPendingComponentType(selected); setPaletteDragGroup(null); }} className="w-6 bg-white text-xs text-slate-700" title={`Открыть список: ${group.label}`}>
                  {options.length ? options.map(item => <option key={item.type} value={item.type}>{item.name}</option>) : <option value="">Нет элементов</option>}
                </select>
              </div>;
            })}
            <button type="button" onClick={() => { wiringFromRef.current = null; setWiringFrom(null); setWiringCursor(null); setWiringWaypoints([]); setPendingComponentType('GND'); }} className="shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" title="Поставить опорный потенциал 0 В">⏚ 0 В</button>

            {/* Кнопка открытия полной библиотеки компонентов */}
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              className="shrink-0 whitespace-nowrap px-2 py-1 rounded text-2xs font-semibold flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer ml-0.5 transition-colors"
              title="Открыть библиотеку двухполюсников"
            >
              <Layers className="w-3 h-3 text-blue-600" />
              <span>Библиотека...</span>
            </button>
            <button type="button" onClick={() => setShortcutSettingsOpen(true)} className="shrink-0 whitespace-nowrap px-2 py-1 rounded text-2xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100" title="Настроить горячие клавиши">Клавиши</button>
          </div>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          {/* Повернуть (R) */}
          <button
            type="button"
            disabled={!selectedId}
            onClick={() => {
              if (selectedId) {
                const selected = elements.find(element => element.id === selectedId);
                if (selected) transformSelection(element => ({ ...element, rotation: ((element.rotation || 0) + 90) % 360 }));
              }
            }}
            className="p-1 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white text-slate-700 border border-slate-300 rounded text-xs shadow-2xs cursor-pointer"
            title="Повернуть выбранный элемент (R)"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={!selectedId} onClick={() => transformSelection(element => ({ ...element, rotation: ((element.rotation || 0) + 45) % 360 }))} className="px-2 py-1 bg-white hover:bg-slate-100 disabled:opacity-40 text-blue-700 border border-blue-300 rounded text-xs font-bold shadow-2xs" title="Повернуть выбранный элемент на 45° (Shift+R)">45°</button>

          <label className="flex items-center gap-1 text-xs text-slate-600" title="Временно исключить двухвыводный элемент из расчёта">
            <span>В расчёте</span>
            <select
              aria-label="Режим элемента в расчёте"
              disabled={!selectedId || !elements.some(el => el.id === selectedId && getComponentPins(el).length === 2)}
              value={elements.find(el => el.id === selectedId)?.isolation ?? ''}
              onChange={event => onElementsChange(elements.map(el => el.id === selectedId ? { ...el, isolation: event.target.value === 'open' || event.target.value === 'short' ? event.target.value : undefined } : el))}
              className="px-1 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
            >
              <option value="">Да</option>
              <option value="open">Разрыв</option>
              <option value="short">Замыкание</option>
            </select>
          </label>

          {/* Удалить (Del) */}
          <button
            type="button"
            disabled={!selectedId && !selectedWireId}
            onClick={() => {
              if (selectedId) {
                deleteSelection();
              } else if (selectedWireId) {
                onWiresChange(wires.filter((w) => w.id !== selectedWireId));
                setSelectedWireId(null);
              }
            }}
            className="p-1 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white text-rose-700 border border-slate-300 rounded text-xs shadow-2xs cursor-pointer"
            title="Удалить выбранный элемент или провод (Delete)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={!selectedWireId} onClick={() => onWiresChange(wires.map(wire => wire.id === selectedWireId ? { ...wire, disabled: !wire.disabled } : wire))} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40" title="Разорвать или восстановить выбранный провод">{wires.find(wire => wire.id === selectedWireId)?.disabled ? 'Соединить' : 'Разорвать'}</button>
          <div role="group" aria-label="Режим прокладки провода" className="flex items-center rounded border border-slate-300 p-0.5">
            <button type="button" aria-pressed={wireMode === 'orthogonal'} onClick={() => { setWireMode('orthogonal'); setWiringWaypoints([]); }} className={`rounded px-2 py-1 text-xs ${wireMode === 'orthogonal' ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>Ортогональный</button>
            <button type="button" aria-pressed={wireMode === 'direct'} onClick={() => { setWireMode('direct'); setWiringWaypoints([]); }} className={`rounded px-2 py-1 text-xs ${wireMode === 'direct' ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>Прямой</button>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 p-1 shadow-2xs" aria-label="Отображение схемы">
            <span className="px-1 text-[10px] font-bold uppercase tracking-wide text-blue-700">Вид</span>
            {[
              { label: 'Обозначения', short: 'R1', value: showElementNames, toggle: () => setShowElementNames(value => !value) },
              { label: 'Номиналы', short: '1к', value: showElementValues, toggle: () => setShowElementValues(value => !value) },
              { label: 'Номера узлов', short: '#', value: showNodeNumbers, toggle: () => setShowNodeNumbers(value => !value) },
              { label: `Сетка ${printLayout.gridMm} мм`, short: 'Сетка', value: showGrid, toggle: () => setShowGrid(value => !value) },
            ].map(item => <button key={item.label} type="button" aria-pressed={item.value} onClick={item.toggle} className={`rounded border px-2 py-1 text-xs font-semibold ${item.value ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-500'}`} title={`${item.value ? 'Скрыть' : 'Показать'}: ${item.label}`}>{item.short}</button>)}
          </div>

          {/* Загрузка готовых схем из руководства */}
          <div className="relative" onMouseEnter={() => { setPendingComponentType(null); setPaletteDragGroup(null); setExamplesOpen(true); }} onMouseLeave={() => setExamplesOpen(false)}>
            <button
              type="button"
              onClick={() => { setPendingComponentType(null); setPaletteDragGroup(null); setExamplesOpen(true); }}
              aria-expanded={examplesOpen}
              className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
              title="Открыть готовую схему NAPS"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden md:inline">Примеры...</span>
            </button>
            <div className={`${examplesOpen ? 'block' : 'hidden'} absolute left-0 top-full bg-white border border-slate-300 shadow-lg rounded py-1 z-50 w-72 text-xs`}>
              <div className="px-3 py-1 text-3xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                Примеры схем NAPS:
              </div>
              {SAMPLE_CIRCUITS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => { setExamplesOpen(false); onLoadSample(sc); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex flex-col cursor-pointer border-b border-slate-100 last:border-none"
                >
                  <span className="font-semibold text-slate-800">{sc.name}</span>
                  <span className="text-3xs text-slate-500 truncate">{sc.pageRef} • {sc.category}{sc.elements.some(element => !topologyTypes.has(element.type)) ? ' • модель расчёта ещё не реализована' : sc.id === 'buck-converter' ? ' • требуется подключить затвор ключа' : ''}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Очистить поле */}
          <button
            type="button"
            onClick={() => {
              if (confirm('Создать новую пустую схему?')) {
                onClearProject();
              }
            }}
            className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
            title="Очистить схему"
          >
            <FilePlus className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden sm:inline">Очистить</span>
          </button>
        </div>

        {/* Правая часть тулбара: Масштаб и ВЫДЕЛЕННАЯ КНОПКА «Построить график» */}
        <div className="relative z-10 flex min-w-0 flex-1 basis-[620px] flex-wrap items-center justify-end gap-2">
          {/* Масштабирование */}
          <div className="flex items-center gap-0.5 bg-white border border-slate-300 rounded p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(Math.min(0.01, z), z / 1.25))}
              className="p-1 hover:bg-slate-100 rounded text-slate-700 cursor-pointer"
              title="Уменьшить масштаб"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-3xs font-mono px-1 font-semibold text-slate-600">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
              className="p-1 hover:bg-slate-100 rounded text-slate-700 cursor-pointer"
              title="Увеличить масштаб"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={fitToView}
              className="p-1 hover:bg-slate-100 rounded text-slate-700 cursor-pointer"
              title="Показать схему целиком"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>

          <div className="h-5 w-px bg-slate-300 mx-0.5" />

          <select aria-label="Шаг сетки в миллиметрах" value={printLayout.gridMm} onChange={event => onPrintLayoutChange({ ...printLayout, gridMm: Number(event.target.value) as PrintLayout['gridMm'] })} className="rounded border border-slate-300 bg-white px-1 py-1 text-xs" title="Шаг основной сетки в миллиметрах"><option value={0.5}>0,5 мм</option><option value={1}>1 мм</option><option value={2}>2 мм</option><option value={2.5}>2,5 мм</option><option value={5}>5 мм</option><option value={10}>10 мм</option></select>
          <div className="relative" onMouseLeave={() => setExportMenuOpen(false)}>
            <button type="button" aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => { setPendingComponentType(null); setExportMenuOpen(open => !open); }} className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100" title="Экспорт и печать"><ImageDown className="h-3.5 w-3.5" />Экспорт ▾</button>
            {exportMenuOpen && <div role="menu" aria-label="Формат экспорта" className="absolute right-0 top-full z-50 min-w-36 rounded border border-slate-300 bg-white py-1 shadow-lg">
              {([['svg', 'SVG'], ['pdf', 'PDF'], ['png', 'PNG'], ['print', 'Печать']] as const).map(([format, label]) =>
                <button key={format} type="button" role="menuitem" onClick={() => { setExportMenuOpen(false); setExportTarget(format); }} className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-blue-50">{label}</button>)}
            </div>}
          </div>

          {/* ВЫДЕЛЕННАЯ КНОПКА ПОСТРОЕНИЯ ГРАФИКА */}
          <button
            type="button"
            disabled={isSimulating}
            onClick={() => {
              if (onBuildPlot) onBuildPlot();
              else onRunSimulation();
            }}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            title="Построить график сигналов схемы"
          >
            <Activity className="w-4 h-4" />
            <span>{isSimulating ? 'Расчёт…' : 'Рассчитать схему'}</span>
          </button>

          {/* Настройки переходного процесса */}
          <button
            type="button"
            onClick={onOpenTransientSettings}
            className="p-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 rounded shadow-2xs cursor-pointer"
            title="Параметры расчета (t_max, шаг)"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. ЧИСТОЕ РАБОЧЕЕ ПОЛОТНО СХЕМЫ (CANVAS) НА ВЕСЬ ЭКРАН */}
      <div className="flex-1 w-full h-full min-h-0 overflow-hidden relative">
        {/* Информационные плашки режима добавления / проводки */}
        {pendingComponentType && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-blue-600 text-white px-4 py-1.5 rounded-full shadow-lg text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
            <span className="w-2 h-2 rounded-full bg-amber-300 animate-ping" />
            <span>Размещайте элементы кликами; колесо — вариант, Esc или ПКМ — выход</span>
            <button
              type="button"
              onClick={() => setPendingComponentType(null)}
              className="ml-2 hover:bg-blue-700 p-0.5 rounded cursor-pointer"
              title="Отмена"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {wiringFrom && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-slate-900 text-white px-4 py-1.5 rounded-full shadow-lg text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Проводка активна: выберите конечный контакт или существующий провод</span>
            <button
              type="button"
              onClick={() => {
                wiringFromRef.current = null;
                setWiringFrom(null);
                setWiringCursor(null);
                setWiringWaypoints([]);
              }}
              className="ml-2 hover:bg-slate-800 p-0.5 rounded cursor-pointer"
              title="Отмена проводки"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {shortcutSettingsOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50" onClick={e => { if (e.target === e.currentTarget) { setShortcutSettingsOpen(false); setRecordingShortcut(null); } }}>
          <div ref={shortcutDialogRef} role="dialog" aria-modal="true" aria-label="Горячие клавиши" className="flex max-h-[85vh] w-[min(46rem,calc(100vw-2rem))] flex-col rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-2 flex items-center justify-between"><strong className="text-lg">Горячие клавиши</strong><button type="button" onClick={() => { setShortcutSettingsOpen(false); setRecordingShortcut(null); }} aria-label="Закрыть">×</button></div>
            <p className="mb-3 text-xs text-slate-600">Для размещения нажмите сочетание, затем укажите точку на схеме. Можно использовать Ctrl, Alt и Shift. Настройки сохраняются на этом компьютере.</p>
            <div className="min-h-0 flex-1 overflow-y-auto rounded border border-slate-200 px-3">
              {SHORTCUT_ACTIONS.map(action => <div key={action} className="flex min-h-11 items-center justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
                <span className="min-w-0 truncate">{shortcutActionLabel(action)}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" aria-label={`Назначить: ${shortcutActionLabel(action)}`} onClick={() => { setShortcutMessage('Нажмите клавишу или сочетание. Esc отменяет назначение.'); setRecordingShortcut(action); }} onKeyDown={e => {
                    if (recordingShortcut !== action) return;
                    e.preventDefault(); e.stopPropagation();
                    if (e.code === 'Escape') { setRecordingShortcut(null); setShortcutMessage('Назначение отменено.'); return; }
                    if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
                    const combo = shortcutFromEvent(e);
                    const reserved = ['Delete', 'Backspace', 'F9', 'Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code) || ['Ctrl+KeyZ', 'Ctrl+Shift+KeyZ', 'Ctrl+KeyY', 'Ctrl+KeyS', 'Ctrl+KeyO', 'Ctrl+KeyC', 'Ctrl+KeyV', 'Meta+KeyZ', 'Meta+Shift+KeyZ', 'Meta+KeyY', 'Meta+KeyS', 'Meta+KeyO', 'Meta+KeyC', 'Meta+KeyV'].includes(combo);
                    if (reserved) { setShortcutMessage('Это сочетание уже используется командой редактора или окна. Выберите другое.'); return; }
                    const conflict = SHORTCUT_ACTIONS.find(key => key !== action && shortcutBindingsConflict(action, combo, key, editorShortcuts[key]));
                    if (conflict) { setShortcutMessage(`Уже назначено: ${shortcutActionLabel(conflict)}. Снимите старое назначение или выберите другую клавишу.`); return; }
                    setEditorShortcuts(current => ({ ...current, [action]: combo }));
                    setRecordingShortcut(null);
                    setShortcutMessage(`Назначено: ${shortcutActionLabel(action)} — ${shortcutLabel(combo)}.`);
                  }} className={`min-w-32 rounded border px-2 py-1 text-center font-mono text-xs ${recordingShortcut === action ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-300 hover:bg-blue-50'}`}>
                    {recordingShortcut === action ? 'Нажмите…' : shortcutLabel(editorShortcuts[action])}
                  </button>
                  <button type="button" aria-label={`Снять назначение: ${shortcutActionLabel(action)}`} title="Снять назначение" disabled={!editorShortcuts[action]} onClick={() => { setEditorShortcuts(current => ({ ...current, [action]: '' })); setRecordingShortcut(null); setShortcutMessage(`Назначение снято: ${shortcutActionLabel(action)}.`); }} className="h-7 w-7 rounded text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30">×</button>
                </div>
              </div>)}
            </div>
            <div role="status" className="mt-2 min-h-5 text-xs text-slate-600">{shortcutMessage}</div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><button type="button" onClick={() => { setEditorShortcuts({ ...DEFAULT_SHORTCUTS }); setRecordingShortcut(null); setShortcutMessage('Восстановлены назначения по умолчанию.'); }} className="text-xs font-semibold text-blue-700">Сбросить всё</button><span className="text-xs text-slate-500">R — поворот 90° · Shift + R — 45°</span></div>
          </div>
        </div>}
        {/* МОДАЛЬНОЕ ОКНО ПОЛНОЙ БИБЛИОТЕКИ ЭЛЕМЕНТОВ (НЕ СЖИМАЕТ И НЕ ПЕРЕКРЫВАЕТ СХЕМУ) */}
        {isPaletteOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
            onClick={(e) => {
              if (e.target === e.currentTarget) { setIsPaletteOpen(false); setReplacingId(null); }
            }}
          >
            <div ref={libraryDialogRef} role="dialog" aria-modal="true" aria-label="Библиотека компонентов" className="library-dialog bg-white shadow-2xl overflow-hidden flex flex-col">
              <div className="library-dialog-header flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span className="font-bold text-sm text-slate-800">
                    Библиотека компонентов NAPS
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => { setIsPaletteOpen(false); setReplacingId(null); }}
                  className="p-1 hover:bg-slate-200 text-slate-600 rounded cursor-pointer transition-colors"
                  title="Закрыть библиотеку"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                <ComponentPalette
                  selectedType={pendingComponentType}
                  onSelectType={(t) => {
                    if (!t) setReplacingId(null);
                    if (t && replacingId) {
                      const old = elements.find(el => el.id === replacingId);
                      if (old) handlePlaceNewComponent(t, old.x, old.y);
                      setIsPaletteOpen(false);
                      return;
                    }
                    setPendingComponentType(t);
                    setIsPaletteOpen(false);
                  }}
                  className="h-full border-none rounded-none shadow-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* ОСНОВНОЙ CANVAS СХЕМЫ */}
        <div
          ref={containerRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => handleCanvasMouseUp()}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          className="w-full h-full relative overflow-hidden bg-white cursor-crosshair select-none"
        >
        <svg
          ref={svgRef}
          className="w-full h-full block"
          style={{
            cursor: isPanning ? 'grabbing' : pendingComponentType ? 'copy' : wiringFrom || hoveredPin ? 'crosshair' : 'default',
          }}
        >
          <defs>
            {/* Клетчатая сетка: основная клетка 20, полуклетка для выводов 10. */}
            <pattern
              id="naps_grid"
              width={gridUnits * zoom}
              height={gridUnits * zoom}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${pan.x}, ${pan.y})`}
            >
              {zoom >= 0.65 && gridUnits > 10 && <path
                d={Array.from({ length: gridUnits / 10 - 1 }, (_, i) => { const p = (i + 1) * 10 * zoom; return `M ${p} 0 V ${gridUnits * zoom} M 0 ${p} H ${gridUnits * zoom}`; }).join(' ')}
                fill="none"
                stroke="#e4eaf2"
                strokeWidth={0.7}
              />}
              <path
                d={`M 0 0 H ${gridUnits * zoom} M 0 0 V ${gridUnits * zoom}`}
                fill="none"
                stroke="#b8c8dc"
                strokeWidth={0.9}
              />
            </pattern>
          </defs>

          {/* Фоновая сетка */}
          <rect id="schematic-screen-background" width="100%" height="100%" fill="#ffffff" />
          {showGrid && <rect data-export-hide="true" width="100%" height="100%" fill="url(#naps_grid)" pointerEvents="none" />}

          {/* Группа элементов схемы с масштабированием и панорамированием */}
          <g id="schematic-world" transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`} style={{ fontFamily: 'GOST type A, GOST 2.304, Arial Narrow, sans-serif' }}>
            {marquee && <rect data-export-hide="true" data-selection-marquee="true"
              x={Math.min(marquee.start.x, marquee.end.x)} y={Math.min(marquee.start.y, marquee.end.y)}
              width={Math.abs(marquee.end.x - marquee.start.x)} height={Math.abs(marquee.end.y - marquee.start.y)}
              fill="#2563eb" fillOpacity={0.1} stroke="#2563eb" strokeDasharray="4 3" pointerEvents="none" />}
            {/* ПРОВОДА СХЕМЫ (WIRES) С ОРТОГОНАЛЬНОЙ ТРАССИРОВКОЙ И T-ОТВЕТВЛЕНИЯМИ */}
            {useMemo(() => wireGeometries.map((wg) => {
              const { wire, pathD } = wg;
              const isSelected = selectedWireId === wire.id;
              const coincidentEndpoint = wg.points.length === 1 ? wg.points[0] : null;

              return (
                <g
                  key={wire.id}
                  onMouseDown={(e) => {
                    if (e.button === 1 || e.shiftKey) return;
                    e.stopPropagation();
                    if (e.button === 2) { wiringFromRef.current = null; wirePointerDown.current = false; setWiringFrom(null); setWiringCursor(null); setWiringWaypoints([]); return; }
                    if (e.button !== 0 || pendingComponentType) return;
                    if (wiringFrom) {
                      const pos = screenToWorld(e.clientX, e.clientY);
                      const hit = projectPointToWire(wg.points, { x: pos.rawX, y: pos.rawY }, gridUnits);
                      if (hit) handleWirePointClick(wire.id, hit.point.x, hit.point.y);
                      return;
                    }
                    if (!wiringFrom) {
                      const pos = screenToWorld(e.clientX, e.clientY);
                      const hit = projectPointToWire(wg.points, { x: pos.rawX, y: pos.rawY }, gridUnits);
                      if (hit) wireSegmentDrag.current = { wireId: wire.id, segmentIndex: hit.segmentIndex, points: wg.points, started: false };
                    }
                    setSelectedWireId(wire.id);
                    setSelectedId(null);
                    setSelectedIds([]);
                  }}
                  onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextMenu(null); setSelectedWireId(wire.id); setSelectedId(null); setSelectedIds([]); setWireContextMenu({ id: wire.id, x: event.clientX, y: event.clientY }); }}
                  onMouseUp={(e) => {
                    if (!wirePointerDown.current || !wiringFrom) return;
                    e.stopPropagation();
                    wirePointerDown.current = false;
                    const pos = screenToWorld(e.clientX, e.clientY);
                    const hit = projectPointToWire(wg.points, { x: pos.rawX, y: pos.rawY }, gridUnits);
                    if (hit) handleWirePointClick(wire.id, hit.point.x, hit.point.y);
                  }}
                >
                  {/* Широкая невидимая линия для легкого клика и захвата мышью */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    className="cursor-pointer"
                  />
                  {/* Видимый провод схемы под прямыми углами */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={wire.disabled ? '#94a3b8' : isSelected ? '#2563eb' : '#1e293b'}
                    strokeWidth={isSelected ? 2.5 : 1.75}
                    strokeDasharray={wire.disabled ? wireGapDashArray(wg.points) : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Keep an explicit connection between coincident pins visible, even without a line segment. */}
                  {coincidentEndpoint && (
                    <circle
                      cx={coincidentEndpoint.x}
                      cy={coincidentEndpoint.y}
                      r={6}
                      fill={wire.disabled ? '#ffffff' : isSelected ? '#2563eb' : '#1e293b'}
                      stroke={wire.disabled ? '#94a3b8' : '#ffffff'}
                      strokeWidth={1.5 / zoom}
                      className="cursor-pointer"
                    />
                  )}
                </g>
              );
            }), [wireGeometries, selectedWireId, zoom, wiringFrom, pendingComponentType, wires, elements, gridUnits, wiringWaypoints, wireMode, pan, onWiresChange, onElementsChange])}
            {hoveredWirePoint && (() => {
              const geometry = wireGeometries.find(item => item.wire.id === hoveredWirePoint.wireId);
              return geometry && !geometry.wire.disabled && selectedWireId !== geometry.wire.id
                ? <path data-export-hide="true" d={geometry.pathD} fill="none" stroke="#10b981" strokeWidth={3.5} strokeOpacity={0.4} pointerEvents="none" />
                : null;
            })()}

            {/* Предпросмотр ручных точек и автоматически ортогонального последнего участка. */}
            {wiringFrom && wiringCursor && (() => {
              const fromPin = pinPositions.get(`${wiringFrom.compId}_${wiringFrom.pinId}`);
              const targetIsPinOrWire = !!hoveredPin || !!hoveredWirePoint;
              const tailStart = wiringWaypoints.at(-1) ?? wiringFrom;
              const snappedEnd = wireMode === 'direct' || targetIsPinOrWire ? wiringCursor : snapManualWirePoint(tailStart, wiringCursor, gridUnits);
              const pinDirection = fromPin && Math.hypot(fromPin.relX, fromPin.relY) > 0
                ? { x: fromPin.relX / Math.hypot(fromPin.relX, fromPin.relY), y: fromPin.relY / Math.hypot(fromPin.relX, fromPin.relY) }
                : { x: 1, y: 0 };
              const previewEnd = samePoint(tailStart, snappedEnd)
                ? { x: tailStart.x + pinDirection.x * 14, y: tailStart.y + pinDirection.y * 14 }
                : snappedEnd;
              const pts = wireMode === 'direct' ? [wiringFrom, previewEnd] : wiringWaypoints.length
                ? buildStoredWireRoute(wiringFrom, previewEnd, wiringWaypoints, undefined, undefined, undefined, undefined, gridUnits)
                : targetIsPinOrWire
                  ? computeOrthogonalWirePoints(
                    wiringFrom, previewEnd,
                    fromPin ? { x: fromPin.relX, y: fromPin.relY } : undefined,
                    undefined, fromPin?.elType, undefined, 0, gridUnits
                  )
                  : [wiringFrom, previewEnd];
              return (
                <path
                  d={pointsToSvgPath(pts)}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              );
            })()}

            {/* Индикатор новой точки соединения (Узла) на проводе */}
            {wiringFrom && hoveredWirePoint && (
              <g transform={`translate(${hoveredWirePoint.x}, ${hoveredWirePoint.y})`} pointerEvents="none">
                <circle r={10} fill="#10b981" fillOpacity={0.25} stroke="#059669" strokeWidth={1.5} />
                <circle r={4.5} fill="#059669" stroke="#ffffff" strokeWidth={1.2} />
                <g transform="translate(12, -18)">
                  <rect width={155} height={18} rx={3} fill="#0f172a" fillOpacity={0.9} />
                  <text
                    x={77}
                    y={12}
                    textAnchor="middle"
                    fill="#ffffff"
                    style={{ fontSize: '9px', fontFamily: 'sans-serif', fontWeight: 600 }}
                  >
                    {wiringFrom ? '+ Соединить в новый узел' : '+ Создать узел соединения'}
                  </text>
                </g>
              </g>
            )}

            {/* ЭЛЕМЕНТЫ СХЕМЫ (COMPONENTS) */}
            {useMemo(() => elements.map((el) => {
              const isSelected = selectedIds.includes(el.id);
              const pins = getComponentPins(el);
              const valueLabel = getComponentValueLabel(el);
              const labelLayout = sceneLabels.get(el.id) ?? getComponentLabelLayout({
                rotation: el.rotation,
                flipH: el.flipH,
                flipV: el.flipV,
                showName: showElementNames,
              });

              return (
                <g
                  key={el.id}
                  data-component-id={el.id}
                  transform={`translate(${el.x}, ${el.y})`}
                  onMouseDown={(e) => elementMouseDownRef.current(e, el)}
                  onMouseEnter={() => onHoverStatus?.(`${el.name} · ${COMPONENT_CATALOG.find(item => item.type === el.type)?.name ?? el.type}${valueLabel ? ` · ${valueLabel}` : ''} · выводов: ${pins.length}${el.isolation ? ` · ${el.isolation === 'open' ? 'разрыв' : 'замыкание'}` : ''}`)}
                  onMouseLeave={() => onHoverStatus?.(null)}
                  onMouseUp={(e) => {
                    if (el.type === 'JUNCTION' && wiringFrom) handlePinMouseUp(e, el.id, '1', el.x, el.y);
                  }}
                  onDoubleClick={(e) => handleElementDoubleClick(e, el)}
                  onWheel={(e) => {
                    if (e.ctrlKey || e.metaKey) return;
                    if (wiringFrom || pendingComponentType || el.type === 'JUNCTION') return;
                    e.preventDefault(); e.stopPropagation();
                    if (e.buttons & 1) {
                      const step = e.shiftKey ? 45 : 90;
                      changeElementGeometry(el, { ...el, rotation: ((el.rotation || 0) + (e.deltaY > 0 ? step : 360 - step)) % 360 });
                    } else {
                      const category = terminalGroupForType(el.type);
                      const types = COMPONENT_CATALOG.filter(item => category && terminalGroupForType(item.type) === category).map(item => item.type);
                      const current = types.indexOf(el.type);
                      if (current < 0 || types.length < 2) return;
                      const next = types[(current + (e.deltaY > 0 ? 1 : types.length - 1)) % types.length];
                      handlePlaceNewComponent(next, el.x, el.y, el.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setSelectedId(el.id);
                    setSelectedIds([el.id]);
                    setSelectedWireId(null);
                    setContextMenu({ id: el.id, x: e.clientX, y: e.clientY });
                  }}
                  className="cursor-move"
                >
                  {/* Выбранный символ окрашивается без рамки. */}
                  {isSelected && el.type === 'JUNCTION' && (
                    <circle data-export-hide="true"
                      cx={0}
                      cy={0}
                      r={9}
                      fill="#3b82f6"
                      fillOpacity={0.25}
                      stroke="#2563eb"
                      strokeWidth={1.5}
                    />
                  )}
                  {el.type !== 'JUNCTION' && <rect x={-22} y={-20} width={44} height={40} fill="transparent" data-export-hide="true" />}

                  {/* Отрисовка символа компонента */}
                  <g
                    transform={`rotate(${el.rotation || 0}) scale(${el.flipH ? -1 : 1}, ${
                      el.flipV ? -1 : 1
                    })`}
                    opacity={el.isolation === 'open' ? 0.58 : el.isolation === 'short' ? 0.7 : 1}
                    style={el.isolation === 'open' ? { filter: 'grayscale(1)' } : undefined}
                  >
                    {el.type === 'JUNCTION'
                      ? <g className="group">
                          <circle r={10} fill="transparent" />
                          <circle r={3.5} fill={isSelected ? '#dc2626' : '#1e293b'} pointerEvents="none" />
                          <circle data-export-hide="true" r={6} fill="none" stroke="#2563eb" strokeWidth={1.5} pointerEvents="none" className={isSelected ? '' : 'opacity-0 group-hover:opacity-100'} />
                          <circle r={6 / zoom} fill="transparent" className="cursor-pointer"
                            onMouseDown={(e) => handlePinClick(e, el.id, '1', el.x, el.y)}
                            onMouseUp={(e) => handlePinMouseUp(e, el.id, '1', el.x, el.y)} />
                        </g>
                      : renderComponentSymbol(el, isSelected && !el.isolation, el.type !== 'PORT')}
                  </g>
                  {el.type === 'PORT' && <text x={0} y={3} textAnchor="middle" fontSize={9} fontWeight="bold" fill={isSelected ? '#dc2626' : '#1e293b'} className="pointer-events-none select-none">{el.portName || el.name}</text>}

                  {/* Подписи следуют ориентации элемента, но остаются горизонтальными и читаемыми. */}
                  {el.type !== 'TEXT' && el.type !== 'JUNCTION' && (showElementNames || showElementValues || el.isolation === 'short') && <g data-element-labels={el.id} className="pointer-events-none select-none" style={{ fontFamily: 'GOST type A, GOST 2.304, Arial Narrow, sans-serif', paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3.5, strokeLinejoin: 'round' }}>
                    {showElementNames && <text data-label-kind="name" x={labelLayout.name.x} y={labelLayout.name.y} textAnchor={labelLayout.name.anchor} fontSize={11} fontWeight="bold" textDecoration={el.type === 'VCCS' || el.type === 'CCCS' ? 'underline' : undefined} fill={el.isolation === 'open' ? '#94a3b8' : '#1e293b'}>{el.name}</text>}
                    {showElementValues && valueLabel && <text data-label-kind="value" x={labelLayout.value.x} y={labelLayout.value.y} textAnchor={labelLayout.value.anchor} fontSize={11} fill={el.isolation === 'open' ? '#94a3b8' : '#3730a3'}>{valueLabel}</text>}
                    {el.isolation === 'short' && <text data-label-kind="isolation" x={labelLayout.isolation.x} y={labelLayout.isolation.y} textAnchor={labelLayout.isolation.anchor} fontSize={9} fill="#b91c1c" fontWeight="bold">КЗ</text>}
                  </g>}

                  {/* Выводы элемента (Pins с магнитным притягиванием и подсветкой) — только для стандартных компонентов */}
                  {el.type !== 'JUNCTION' &&
                    pins.map((pin) => {
                      const absPx = el.x + pin.x;
                      const absPy = el.y + pin.y;
                      const pinKey = `${el.id}_${pin.id}`;
                      const nodeNum = circuitGraph.pinToNode.get(pinKey);
                      const isWiringSource = wiringFrom?.compId === el.id && wiringFrom?.pinId === pin.id;
                      const isHovered = false;
                      const isConnected = connectedPinKeys.has(pinKey);

                      return (
                        <g key={pin.id}>
                          {/* Ореол подсветки вывода */}
                          {(isHovered || isWiringSource) && (
                            <circle data-export-hide="true"
                              cx={pin.x}
                              cy={pin.y}
                              r={10}
                              fill={isWiringSource ? '#3b82f6' : '#10b981'}
                              fillOpacity={0.25}
                              stroke={isWiringSource ? '#2563eb' : '#059669'}
                              strokeWidth={1.5}
                            />
                          )}

                          {/* Постоянный маркер вывода в редакторе; на экспортной схеме он скрыт. */}
                          {pin.label === '+' ? <rect data-export-hide="true" x={pin.x - 3} y={pin.y - 3} width={6} height={6}
                            fill={isConnected ? '#334155' : '#ffffff'} stroke={isConnected ? '#334155' : '#64748b'} strokeWidth={1.25} pointerEvents="none" />
                            : <circle data-export-hide="true" cx={pin.x} cy={pin.y} r={3}
                              fill={isConnected ? '#334155' : '#ffffff'} stroke={isConnected ? '#334155' : '#64748b'} strokeWidth={1.25} pointerEvents="none" />}

                          {/* Широкая невидимая область клика (радиус 18px) для безошибочного захвата мышью */}
                          <circle
                            cx={pin.x}
                            cy={pin.y}
                            r={12 / zoom}
                            fill="transparent"
                            className="cursor-pointer"
                            onMouseDown={(e) => handlePinClick(e, el.id, pin.id, absPx, absPy)}
                            onMouseUp={(e) => handlePinMouseUp(e, el.id, pin.id, absPx, absPy)}
                          />

                          {/* Терминал для клика проводки */}
                          {(isHovered || isWiringSource) && (pin.label === '+' ? <rect
                            data-export-hide="true" x={pin.x - (isHovered ? 6 : 4)} y={pin.y - (isHovered ? 6 : 4)} width={(isHovered ? 6 : 4) * 2} height={(isHovered ? 6 : 4) * 2}
                            fill={isWiringSource ? '#2563eb' : '#10b981'} stroke="#ffffff" strokeWidth={1.5} className="cursor-pointer"
                            onMouseDown={(e) => handlePinClick(e, el.id, pin.id, absPx, absPy)} onMouseUp={(e) => handlePinMouseUp(e, el.id, pin.id, absPx, absPy)}
                          /> : <circle
                            data-export-hide="true" cx={pin.x} cy={pin.y} r={isHovered ? 6 : 4}
                            fill={isWiringSource ? '#2563eb' : '#10b981'} stroke="#ffffff" strokeWidth={1.5} className="cursor-pointer transition-all"
                            onMouseDown={(e) => handlePinClick(e, el.id, pin.id, absPx, absPy)} onMouseUp={(e) => handlePinMouseUp(e, el.id, pin.id, absPx, absPy)}
                          />)}

                          {/* Всплывающий бейдж при проводке */}
                          {isHovered && wiringFrom && !isWiringSource && (
                            <g transform={`translate(${pin.x + 8}, ${pin.y - 18})`} pointerEvents="none">
                              <rect width={70} height={16} rx={3} fill="#0f172a" fillOpacity={0.9} />
                              <text
                                x={35}
                                y={11}
                                textAnchor="middle"
                                fill="#ffffff"
                                style={{ fontSize: '9px', fontFamily: 'sans-serif', fontWeight: 600 }}
                              >
                                Соединить
                              </text>
                            </g>
                          )}

                          {/* Название вывода */}
                          {pin.label && (
                            <text
                              x={pin.x + (Math.abs(pin.y) > Math.abs(pin.x) ? 8 : pin.x > 0 ? 7 : -7)}
                              y={pin.y + (Math.abs(pin.y) > Math.abs(pin.x) ? 3 : -7)}
                              textAnchor={pin.x > 0 ? 'start' : pin.x < 0 ? 'end' : 'middle'}
                              className="font-mono text-3xs font-bold fill-slate-700 pointer-events-none select-none"
                              style={{ fontSize: '9px' }}
                            >
                              {pin.label}
                            </text>
                          )}

                          {/* Номер узла схемы (стр. 4: "Номера узлов") */}
                          {showNodeNumbers && nodeNum !== undefined && (
                            <text
                              x={pin.x + 8}
                              y={pin.y - 6}
                              className="font-mono text-3xs fill-slate-500 font-semibold select-none pointer-events-none"
                              style={{ fontSize: '9px' }}
                            >
                              [{nodeNum === 0 ? '0' : nodeNum}]
                            </text>
                          )}
                        </g>
                      );
                    })}

                </g>
              );
            }), [sceneLabels, elements, wires, selectedId, selectedIds, wiringFrom, pendingComponentType, zoom, showElementNames, showElementValues, showNodeNumbers, circuitGraph, connectedPinKeys, copiedElement, gridUnits, wireMode, pan, draggingElemId, dragOffset, wiringWaypoints, onHoverStatus, onWiresChange, onElementsChange, onOpenProperties, onBeginContinuousEdit, onEndContinuousEdit])}
            {hoveredPin && (wiringFrom?.compId !== hoveredPin.compId || wiringFrom.pinId !== hoveredPin.pinId) && (() => {
              const pin = pinPositions.get(`${hoveredPin.compId}_${hoveredPin.pinId}`);
              return pin && <g data-export-hide="true" transform={`translate(${pin.x}, ${pin.y})`} pointerEvents="none">
                <circle r={10} fill="#10b981" fillOpacity={0.25} stroke="#059669" strokeWidth={1.5} />
                {pin.label === '+' ? <rect x={-6} y={-6} width={12} height={12} fill="#10b981" stroke="#ffffff" strokeWidth={1.5} />
                  : <circle r={6} fill="#10b981" stroke="#ffffff" strokeWidth={1.5} />}
                {wiringFrom && <g transform="translate(8, -18)"><rect width={70} height={16} rx={3} fill="#0f172a" fillOpacity={0.9} /><text x={35} y={11} textAnchor="middle" fill="#ffffff" fontSize={9} fontWeight="bold">Соединить</text></g>}
              </g>;
            })()}
          </g>

          {/* Ghost-превью компонента при перемещении мыши */}
          {pendingComponentType && mouseWorldPos && (
            <g
              data-export-hide="true"
              transform={`translate(${mouseWorldPos.x * zoom + pan.x}, ${mouseWorldPos.y * zoom + pan.y}) scale(${zoom})`}
              opacity={0.65}
              pointerEvents="none"
            >
              {renderComponentSymbol({
                id: 'ghost',
                type: pendingComponentType,
                name: '',
                x: 0,
                y: 0,
                rotation: 0,
                value: 0,
                valueStr: '',
                unit: '',
              })}
              <circle cx={0} cy={0} r={4} fill="#2563eb" />
            </g>
          )}
        </svg>
        {showGrid && <div className="pointer-events-none absolute bottom-2 right-2 rounded border border-slate-200 bg-white/90 px-2 py-1 font-mono text-[10px] text-slate-500 shadow-sm">Сетка: {printLayout.gridMm} мм</div>}
      </div>
      {contextMenu && (() => {
        const el = elements.find(item => item.id === contextMenu.id);
        if (!el) return null;
        const twoPin = getComponentPins(el).length === 2;
        const items: { label: string; action: string; disabled?: boolean }[] = [
          { label: 'Копировать', action: 'copy' },
          { label: 'Вставить копию рядом', action: 'paste', disabled: !copiedElement },
          { label: 'Удалить', action: 'delete' },
          { label: 'Повернуть по часовой ↻', action: 'cw' },
          { label: 'Повернуть против часовой ↺', action: 'ccw' },
          { label: 'Повернуть на 45° ↻', action: 'cw45' },
          { label: 'Повернуть на 45° ↺', action: 'ccw45' },
          { label: 'Поменять элемент…', action: 'replace' },
          { label: 'Поменять выводы местами', action: 'swap', disabled: !twoPin },
          { label: 'Участвует в расчёте', action: 'normal', disabled: !twoPin },
          { label: 'Изолировать: разрыв', action: 'open', disabled: !twoPin },
          { label: 'Изолировать: замыкание', action: 'short', disabled: !twoPin },
          { label: 'Свойства элемента…', action: 'properties' },
        ];
        return <div role="menu" aria-label={`Действия с ${el.name}`} className="fixed z-[100] min-w-56 max-h-[80vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl text-sm" style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 240)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 420)) }} onContextMenu={e => e.preventDefault()}>
          {items.map(item => <button key={item.action} type="button" role="menuitem" disabled={item.disabled} onClick={() => runElementAction(el.id, item.action)} className="block w-full rounded px-3 py-1.5 text-left text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40 disabled:hover:bg-white">{item.label}</button>)}
        </div>;
      })()}
      {overlapChoice && <div role="dialog" aria-label="Выбор совпадающего контакта" className="fixed z-[105] min-w-48 rounded border border-blue-300 bg-white p-2 text-xs shadow-xl" style={{ left: Math.min(overlapChoice.x + 8, window.innerWidth - 210), top: Math.min(overlapChoice.y + 8, window.innerHeight - 140) }}>
        <div className="mb-1 font-semibold text-slate-700">Выберите контакт</div>
        {overlapChoice.pins.map(pin => <button key={`${pin.compId}_${pin.pinId}`} type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-blue-100" onClick={() => { setOverlapChoice(null); connectPin(pin.compId, pin.pinId, pin.x, pin.y); }}>{pin.name}</button>)}
        <button type="button" className="mt-1 text-slate-500 hover:text-slate-800" onClick={() => setOverlapChoice(null)}>Отмена</button>
      </div>}
      {wireContextMenu && (() => {
        const wire = wires.find(item => item.id === wireContextMenu.id);
        if (!wire) return null;
        return <div role="menu" aria-label="Действия с проводом" className="fixed z-[100] min-w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-xl text-sm" style={{ left: wireContextMenu.x, top: wireContextMenu.y }}>
          <button type="button" role="menuitem" className="block w-full rounded px-3 py-1.5 text-left hover:bg-blue-50" onClick={() => { onWiresChange(wires.map(item => item.id === wire.id ? { ...item, disabled: !item.disabled } : item)); setWireContextMenu(null); }}>{wire.disabled ? 'Восстановить соединение' : 'Разорвать соединение'}</button>
          <button type="button" role="menuitem" className="block w-full rounded px-3 py-1.5 text-left hover:bg-rose-50" onClick={() => { onWiresChange(wires.filter(item => item.id !== wire.id)); setWireContextMenu(null); setSelectedWireId(null); }}>Удалить провод</button>
        </div>;
      })()}
      {exportTarget && <div role="dialog" aria-modal="true" aria-label="Настройки печати и экспорта" className="fixed inset-0 z-[110] flex flex-col bg-slate-900/70 p-4">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 rounded-t bg-white px-4 py-3 text-sm text-slate-800">
          <strong>Печать и экспорт</strong>
          <label>Формат <select aria-label="Формат листа" value={printLayout.format} onChange={event => onPrintLayoutChange({ ...printLayout, format: event.target.value as PrintLayout['format'] })} className="rounded border border-slate-300 p-1"><option value="A4">A4</option><option value="A3">A3</option><option value="A2">A2</option><option value="A1">A1</option><option value="A0">A0</option></select></label>
          <label>Ориентация <select aria-label="Ориентация листа" value={printLayout.orientation} onChange={event => onPrintLayoutChange({ ...printLayout, orientation: event.target.value as PrintLayout['orientation'] })} className="rounded border border-slate-300 p-1"><option value="landscape">Альбомная</option><option value="portrait">Книжная</option></select></label>
          <label>Режим <select aria-label="Режим масштабирования печати" value={printMode} onChange={event => setPrintMode(event.target.value as 'actual' | 'fit')} className="rounded border border-slate-300 p-1"><option value="actual">Заданный масштаб</option><option value="fit">Вписать в страницу</option></select></label>
          {printMode === 'actual' && <label>Масштаб <select aria-label="Масштаб печати" value={requestedPrintScale} onChange={event => setRequestedPrintScale(Number(event.target.value))} className="rounded border border-slate-300 p-1"><option value={2}>2:1</option><option value={1}>1:1</option><option value={0.5}>1:2</option><option value={0.4}>1:2,5</option><option value={0.25}>1:4</option></select></label>}
          <label>Поля, мм <input aria-label="Поля страницы в миллиметрах" type="number" min="0" max="100" step="1" value={printMarginMm} onChange={event => setPrintMarginMm(Number(event.target.value))} className="w-14 rounded border border-slate-300 p-1" /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={centerPrint} onChange={event => setCenterPrint(event.target.checked)} />По центру</label>
          <div className="ml-auto flex gap-2"><button type="button" disabled={!exportPlan?.placement.fits} onClick={() => downloadSchematic(exportTarget)} className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-40">{exportTarget === 'print' ? 'Печать…' : `Скачать ${exportTarget.toUpperCase()}`}</button><button type="button" onClick={() => setExportTarget(null)} className="rounded border border-slate-300 px-3 py-1.5">Закрыть</button></div>
        </div>
        <div className="mx-auto w-full max-w-6xl bg-white px-4 py-1 text-xs text-slate-600">{exportPlan && <>Схема: {exportPlan.placement.contentWidthMm.toFixed(1)} × {exportPlan.placement.contentHeightMm.toFixed(1)} мм · фактический масштаб {printScaleLabel(exportPlan.placement.scale)} · лист {exportPlan.placement.widthMm} × {exportPlan.placement.heightMm} мм</>}{exportError && <span className="text-red-700">{exportError}</span>}{exportPlan && !exportPlan.placement.fits && <span className="ml-2 text-red-700">Схема не помещается: выберите А3, уменьшите масштаб или включите «Вписать в страницу». Автоматическое обрезание отключено.</span>}</div>
        <iframe ref={printPreviewRef} title="Предварительный просмотр листа" srcDoc={exportPlan?.html ?? ''} className="mx-auto min-h-0 w-full max-w-6xl flex-1 rounded-b bg-white" />
      </div>}
    </div>
  </div>
  );
}

/**
 * Отрисовка графических символов элементов по ГОСТ 2.728 / IEEE (стр. 4-5 мануала)
 */
