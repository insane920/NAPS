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
} from '../types';
import { SAMPLE_CIRCUITS, SampleCircuit } from '../data/sampleCircuits';
import { buildCircuitGraph, normalizeEngNotation } from '../math/circuitSolver';
import { ComponentPalette, COMPONENT_CATALOG, TERMINAL_GROUPS, terminalGroupForType, TerminalGroup } from './ComponentPalette';

interface SchematicEditorProps {
  elements: CircuitElement[];
  wires: CircuitWire[];
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
  onHoverStatus?: (text: string | null) => void;
}

const GRID_SIZE = 20;
type EditorShortcut = 'rotate' | 'add';
const DEFAULT_SHORTCUTS: Record<EditorShortcut, string> = { rotate: 'KeyR', add: 'KeyA' };
const SHORTCUT_LABELS: Record<EditorShortcut, string> = { rotate: 'Поворот', add: 'Добавить элемент' };

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
  if (pts.length <= 2) return pts;
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
  trackOffset = 0
): Point[] {
  const x1 = Math.round(p1.x);
  const y1 = Math.round(p1.y);
  const x2 = Math.round(p2.x);
  const y2 = Math.round(p2.y);

  // Точки совпадают
  if (x1 === x2 && y1 === y2) {
    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  }

  // Строго горизонтальная линия
  if (y1 === y2) {
    if (trackOffset) {
      const direction1 = Math.sign(p1PinRel?.x || x2 - x1) || 1;
      const direction2 = Math.sign(p2PinRel?.x || x1 - x2) || -1;
      const stub1 = x1 + direction1 * GRID_SIZE;
      const stub2 = x2 + direction2 * GRID_SIZE;
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
      const stub1 = y1 + direction1 * GRID_SIZE;
      const stub2 = y2 + direction2 * GRID_SIZE;
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
    const midY = Math.round(((y1 + y2) / 2) / GRID_SIZE) * GRID_SIZE + trackOffset;
    return simplifyPoints([
      { x: x1, y: y1 },
      { x: x1, y: midY },
      { x: x2, y: midY },
      { x: x2, y: y2 },
    ]);
  }

  // Оба пина горизонтальные (стандарт для большинства электронных элементов)
  const midX = Math.round(((x1 + x2) / 2) / GRID_SIZE) * GRID_SIZE + trackOffset;
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

/** Keep saved manual segments while reconnecting moved or rotated terminal pins. */
export function buildStoredWireRoute(
  start: Point,
  end: Point,
  waypoints: Point[],
  startPin?: Point,
  endPin?: Point,
  startType?: string,
  endType?: string
): Point[] {
  if (!waypoints.length) return isAllowedWireSegment(start, end)
    ? [start, end]
    : computeOrthogonalWirePoints(start, end, startPin, endPin, startType, endType);
  const route = [start];
  for (const next of [...waypoints, end]) {
    const previous = route[route.length - 1];
    if (samePoint(previous, next)) continue;
    const connector = isAllowedWireSegment(previous, next)
      ? [previous, next]
      : computeOrthogonalWirePoints(previous, next);
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
    const p = transform(0, -20);
    return [{ id: '1', name: 'GND', x: p.x, y: p.y }];
  }
  if (el.type === 'PORT') {
    const p = transform(-30, 0);
    return [{ id: '1', name: el.portName || el.name, x: p.x, y: p.y }];
  }
  if (el.type === 'OPAMP' || el.type === 'COMPARATOR') {
    const pNeg = transform(-35, -15);
    const pPos = transform(-35, 15);
    const pOut = transform(35, 0);
    return [
      { id: 'in_neg', name: '-', label: '-', x: pNeg.x, y: pNeg.y },
      { id: 'in_pos', name: '+', label: '+', x: pPos.x, y: pPos.y },
      { id: 'out', name: 'OUT', label: 'OUT', x: pOut.x, y: pOut.y },
    ];
  }
  if (el.type === 'SWITCH' || el.type === 'THYRISTOR') {
    const p1 = transform(-30, 0);
    const p2 = transform(30, 0);
    const pGate = transform(0, 25);
    return [
      { id: '1', name: 'A', x: p1.x, y: p1.y },
      { id: '2', name: 'K', x: p2.x, y: p2.y },
      { id: 'gate', name: 'G', label: 'G', x: pGate.x, y: pGate.y },
    ];
  }
  if (el.type === 'NOT') {
    const p1 = transform(-30, 0);
    const p2 = transform(30, 0);
    return [
      { id: '1', name: 'IN', x: p1.x, y: p1.y },
      { id: '2', name: 'OUT', x: p2.x, y: p2.y },
    ];
  }
  if (el.type === 'AND' || el.type === 'OR' || el.type === 'XOR') {
    const p1 = transform(-30, -10);
    const p2 = transform(-30, 10);
    const pOut = transform(30, 0);
    return [
      { id: '1', name: 'X1', x: p1.x, y: p1.y },
      { id: '2', name: 'X2', x: p2.x, y: p2.y },
      { id: '3', name: 'Y', x: pOut.x, y: pOut.y },
    ];
  }
  if (el.type === 'RS_FF' || el.type === 'D_FF' || el.type === 'JK_FF') {
    const p1 = transform(-30, -12);
    const p2 = transform(-30, 12);
    const p3 = transform(30, -12);
    const p4 = transform(30, 12);
    return [
      { id: '1', name: 'S', x: p1.x, y: p1.y },
      { id: '2', name: 'R', x: p2.x, y: p2.y },
      { id: '3', name: 'Q', x: p3.x, y: p3.y },
      { id: '4', name: '/Q', x: p4.x, y: p4.y },
    ];
  }
  if (el.type === 'TR3') {
    const p1 = transform(-30, -15);
    const p2 = transform(-30, 15);
    const p3 = transform(30, -15);
    const p4 = transform(30, 15);
    return [
      { id: '1', name: 'P1', x: p1.x, y: p1.y },
      { id: '2', name: 'P2', x: p2.x, y: p2.y },
      { id: '3', name: 'S1', x: p3.x, y: p3.y },
      { id: '4', name: 'S2', x: p4.x, y: p4.y },
    ];
  }
  if (el.type === 'TEXT') {
    return [];
  }

  // 2-выводные элементы (R, L, C, DIODE, V_DC, V_AC, V_PULSE, I_DC)
  const p1 = transform(-30, 0);
  const p2 = transform(30, 0);
  return [
    { id: '1', name: '1', x: p1.x, y: p1.y },
    { id: '2', name: '2', x: p2.x, y: p2.y },
  ];
}

export function SchematicEditor({
  elements,
  wires,
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
  onHoverStatus,
}: SchematicEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState<EditorShortcut | null>(null);
  const [editorShortcuts, setEditorShortcuts] = useState<Record<EditorShortcut, string>>(() => {
    try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem('naps_editor_shortcuts') || '{}') }; }
    catch { return DEFAULT_SHORTCUTS; }
  });
  useEffect(() => { localStorage.setItem('naps_editor_shortcuts', JSON.stringify(editorShortcuts)); }, [editorShortcuts]);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [copiedElement, setCopiedElement] = useState<CircuitElement | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [hoveredJunctionId, setHoveredJunctionId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [showNodeNumbers, setShowNodeNumbers] = useState<boolean>(false);
  const [showElementNames, setShowElementNames] = useState<boolean>(true);
  const [showElementValues, setShowElementValues] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 50, y: 30 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Панель библиотеки элементов и активный инструмент
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<'select' | 'wire'>('select');
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
      const options = COMPONENT_CATALOG.filter(item => terminalGroupForType(item.type) === paletteDragGroup);
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
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const wireSegmentDrag = useRef<{ wireId: string; segmentIndex: number; points: Point[]; started: boolean } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    setSelectedId(null);
    setContextMenu(null);
    setReplacingId(null);
    setHoveredJunctionId(null);
    setSelectedWireId(null);
    setWiringFrom(null);
    setWiringCursor(null);
    setWiringWaypoints([]);
    setHoveredPin(null);
    setHoveredWirePoint(null);
    setDraggingElemId(null);
    setPendingComponentType(null);
    setActiveTool('select');
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
      if (wirePointerDown.current) {
        wirePointerDown.current = false;
        if (event.type === 'blur') {
          wiringFromRef.current = null;
          setWiringFrom(null);
          setWiringCursor(null);
          setWiringWaypoints([]);
        }
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
    if (!bounds || !bounds.width || !bounds.height || !elements.length) return;
    const minX = Math.min(...elements.map(element => element.x)) - 80;
    const maxX = Math.max(...elements.map(element => element.x)) + 80;
    const minY = Math.min(...elements.map(element => element.y)) - 80;
    const maxY = Math.max(...elements.map(element => element.y)) + 80;
    const nextZoom = Math.max(0.2, Math.min(1.5, (bounds.width - 48) / (maxX - minX), (bounds.height - 48) / (maxY - minY)));
    setZoom(nextZoom);
    setPan({ x: (bounds.width - (minX + maxX) * nextZoom) / 2, y: (bounds.height - (minY + maxY) * nextZoom) / 2 });
  }, [elements]);
  useEffect(() => {
    // Fit initial and replacement projects; dragging preserves the user's viewport.
    if (fittedProject.current === fitRevision) return;
    fittedProject.current = fitRevision;
    fitToView();
  }, [fitRevision, fitToView]);

  // Граф узлов для нумерации
  const circuitGraph = useMemo(() => buildCircuitGraph(elements, wires), [elements, wires]);

  // Снэп к сетке
  const snapToGrid = (val: number) => Math.round(val / GRID_SIZE) * GRID_SIZE;

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
    [pan, zoom]
  );

  // Клавиатурные сокращения по руководству (стр. 4: R, F, V, ESC, Delete)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (shortcutSettingsOpen) return;
      if (isPaletteOpen) {
        if (e.key === 'Escape') setIsPaletteOpen(false);
        return;
      }
      if (!shortcutsEnabled || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape') {
        setWiringFrom(null);
        wiringFromRef.current = null;
        setWiringCursor(null);
        setWiringWaypoints([]);
        setPendingComponentType(null);
        setSelectedId(null);
        setSelectedWireId(null);
      } else if (e.code === editorShortcuts.add) {
        e.preventDefault(); setIsPaletteOpen(true);
      } else if (e.code === editorShortcuts.rotate && selectedId) {
        // Поворот по R (стр. 4)
        e.preventDefault();
        onElementsChange(
          elements.map((el) =>
            el.id === selectedId ? { ...el, rotation: ((el.rotation || 0) + (e.shiftKey ? 45 : 90)) % 360 } : el
          )
        );
      } else if ((e.key === 'f' || e.key === 'а' || e.key === 'F') && selectedId) {
        // Отразить слева направо (стр. 4)
        e.preventDefault();
        onElementsChange(
          elements.map((el) => (el.id === selectedId ? { ...el, flipH: !el.flipH } : el))
        );
      } else if ((e.key === 'v' || e.key === 'м' || e.key === 'V') && selectedId) {
        // Отразить сверху вниз (стр. 4)
        e.preventDefault();
        onElementsChange(
          elements.map((el) => (el.id === selectedId ? { ...el, flipV: !el.flipV } : el))
        );
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          onElementsChange(elements.filter((el) => el.id !== selectedId));
          onWiresChange(
            wires.filter((w) => w.fromCompId !== selectedId && w.toCompId !== selectedId)
          );
          setSelectedId(null);
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
    }, [selectedId, selectedWireId, elements, wires, onElementsChange, onWiresChange, onRunSimulation, shortcutsEnabled, isPaletteOpen, shortcutSettingsOpen, editorShortcuts]);

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
      portName = existingSameType.length === 0 ? 'OUT' : `P${count}`;
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
      defaultValueStr = 'k=1';
      defaultUnit = '';
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
    } else {
      onElementsChange([...elements, newElem]);
    }
    setSelectedId(newElem.id);
    setPendingComponentType(null);
  };

  // Координаты всех выводов компонентов схемы
  const pinPositions = useMemo(() => {
    const map = new Map<
      string,
      { x: number; y: number; name: string; label?: string; relX: number; relY: number; elType: string }
    >();
    for (const el of elements) {
      const pins = getComponentPins(el);
      for (const p of pins) {
        map.set(`${el.id}_${p.id}`, {
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

  // Геометрия всех проводов с ортогональной трассировкой (под прямым углом)
  const wireGeometries = useMemo(() => {
    const occupied: Array<{ node: number | undefined; points: Point[] }> = [];
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
      const foreignRoutes = occupied.filter(route => route.node !== node).map(route => route.points);

      let pts: Point[];
      if (wire.manual || wire.waypoints?.length) {
        pts = buildStoredWireRoute(
          p1, p2, wire.waypoints ?? [],
          { x: p1.relX, y: p1.relY },
          { x: p2.relX, y: p2.relY },
          p1.elType, p2.elType
        );
      } else {
        const offsets = [0, GRID_SIZE, -GRID_SIZE, GRID_SIZE * 2, -GRID_SIZE * 2, GRID_SIZE * 3, -GRID_SIZE * 3];
        const candidates = offsets.map(offset => computeOrthogonalWirePoints(
          p1,
          p2,
          { x: p1.relX, y: p1.relY },
          { x: p2.relX, y: p2.relY },
          p1.elType,
          p2.elType,
          offset
        ));
        pts = candidates.reduce((best, candidate) =>
          overlappingLength(candidate, foreignRoutes) < overlappingLength(best, foreignRoutes) ? candidate : best
        );
      }

      occupied.push({ node, points: pts });
      geometries.push({ wire, p1, p2, points: pts, pathD: pointsToSvgPath(pts) });
    }
    return geometries;
  }, [wires, pinPositions, circuitGraph]);

  // Разделение провода и создание подвижного узла (JUNCTION)
  const handleWirePointClick = (wireId: string, px: number, py: number) => {
    if (activeTool !== 'wire' || pendingComponentType || !(wiringFromRef.current ?? wiringFrom)) return;
    const targetWire = wires.find((w) => w.id === wireId);
    const geometry = wireGeometries.find(item => item.wire.id === wireId);
    if (!targetWire || !geometry) return;
    const projected = projectPointToWire(geometry.points, { x: px, y: py });
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
          waypoints: wiringWaypoints.length ? [...wiringWaypoints] : undefined,
          manual: wiringWaypoints.length > 0,
        }]);
      }
      wiringFromRef.current = null;
      setWiringFrom(null); setWiringCursor(null); setWiringWaypoints([]);
      setHoveredWirePoint(null); wirePointerDown.current = false;
      return;
    }
    const split = splitWireRoute(geometry.points, projected.segmentIndex, point);

    // Создаем новый узел соединения (JUNCTION по ГОСТ 2.702)
    const junctionCount = elements.filter((el) => el.type === 'JUNCTION').length + 1;
    const junctionId = `junction_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newJunction: CircuitElement = {
      id: junctionId,
      type: 'JUNCTION',
      name: `N${junctionCount}`,
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
      waypoints: split.first.slice(1, -1),
      manual: true,
    };
    const wireB: CircuitWire = {
      id: `wire_${Date.now()}_b_${Math.random().toString(36).slice(2, 6)}`,
      fromCompId: junctionId,
      fromPinId: '1',
      toCompId: targetWire.toCompId,
      toPinId: targetWire.toPinId,
      waypoints: split.second.slice(1, -1),
      manual: true,
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
        waypoints: wiringWaypoints.length ? [...wiringWaypoints] : undefined,
        manual: wiringWaypoints.length > 0,
      };
      onElementsChange([...elements, newJunction]);
      onWiresChange([...remainingWires, wireA, wireB, wireC]);
      wiringFromRef.current = null;
      setWiringFrom(null);
      setWiringCursor(null);
      setWiringWaypoints([]);
      wirePointerDown.current = false;
      setSelectedId(junctionId);
      setSelectedWireId(null);
      setHoveredWirePoint(null);
      setHoveredPin(null);
    } else {
      onElementsChange([...elements, newJunction]);
      onWiresChange([...remainingWires, wireA, wireB]);
      setSelectedId(junctionId);
      setSelectedWireId(null);
      setHoveredWirePoint(null);
      setHoveredPin(null);
      if (activeTool === 'wire') {
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
    const source = wiringFromRef.current ?? wiringFrom;
    if (activeTool !== 'wire' || !source) return;
    const previous = wiringWaypoints.at(-1) ?? source;
    const next = snapManualWirePoint(previous, cursor);
    if (samePoint(previous, next)) return;
    setWiringWaypoints(current => [...current, next]);
    setWiringCursor(next);
  };

  // Клик по канвасу
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      // Правая кнопка мыши - отмена по мануалу стр. 4
      e.preventDefault();
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

    if (activeTool === 'wire' && wiringFrom) {
      appendManualWaypoint({ x: pos.rawX, y: pos.rawY });
      return;
    }

    setSelectedId(null);
    setSelectedWireId(null);
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
    setMouseWorldPos({ x: pos.x, y: pos.y });

    if (wireSegmentDrag.current) {
      if (!(e.buttons & 1)) return;
      const drag = wireSegmentDrag.current;
      const a = drag.points[drag.segmentIndex], b = drag.points[drag.segmentIndex + 1];
      const horizontal = Math.abs(a.y - b.y) < ROUTE_EPSILON;
      const vertical = Math.abs(a.x - b.x) < ROUTE_EPSILON;
      const coordinate = horizontal ? snapToGrid(pos.rawY) : vertical ? snapToGrid(pos.rawX)
        : snapToGrid(((pos.rawX - a.x) - Math.sign((b.y - a.y) / (b.x - a.x)) * (pos.rawY - a.y)) / 2);
      if (coordinate === (horizontal ? a.y : vertical ? a.x : 0) && !drag.started) return;
      if (!drag.started) { onBeginContinuousEdit?.(); drag.started = true; }
      const route = moveWireSegment(drag.points, drag.segmentIndex, coordinate);
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
      onElementsChange(
        elements.map((el) => (el.id === draggingElemId ? { ...el, x: targetX, y: targetY } : el))
      );
      return;
    }

    if (pendingComponentType) {
      setHoveredPin(null);
      setHoveredWirePoint(null);
      return;
    }

    if (activeTool !== 'wire') {
      setHoveredPin(null);
      setHoveredWirePoint(null);
      return;
    }

    // 1. Поиск ближайшего вывода (Магнитный захват с увеличенным радиусом 28px для надежной фиксации)
    let foundPin: { compId: string; pinId: string; x: number; y: number; name: string } | null = null;
    let minPinDist = 12 / zoom;
    for (const el of elements) {
      const pins = getComponentPins(el);
      for (const p of pins) {
        const absX = el.x + p.x;
        const absY = el.y + p.y;
        const dist = Math.hypot(pos.rawX - absX, pos.rawY - absY);
        if (dist <= minPinDist) {
          minPinDist = dist;
          foundPin = { compId: el.id, pinId: p.id, x: absX, y: absY, name: `${el.name}.${p.name}` };
        }
      }
    }
    setHoveredPin(foundPin);

    // 2. Если пин не найден — проверяем наведение на сегменты существующих проводов
    let foundWirePoint: { wireId: string; x: number; y: number } | null = null;
    if (!foundPin) {
      let minWireDist = 8 / zoom;
      for (const wg of wireGeometries) {
        const hit = projectPointToWire(wg.points, { x: pos.rawX, y: pos.rawY });
        if (hit && hit.distance <= minWireDist) {
          minWireDist = hit.distance;
          foundWirePoint = { wireId: wg.wire.id, ...hit.point };
        }
      }
    }
    setHoveredWirePoint(foundWirePoint);

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
        setWiringCursor(snapManualWirePoint(wiringWaypoints.at(-1) ?? wiringFrom, { x: pos.rawX, y: pos.rawY }));
      }
    }
  };

  const handleCanvasMouseUp = (event?: React.MouseEvent) => {
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
      if (event && activeTool === 'wire' && (wiringFromRef.current ?? wiringFrom)) {
        const pos = screenToWorld(event.clientX, event.clientY);
        appendManualWaypoint({ x: pos.rawX, y: pos.rawY });
      }
    }
    setIsPanning(false);
    setDraggingElemId(null);
  };

  // Нажатие на вывод элемента (Pin)
  const handlePinClick = (e: React.MouseEvent, compId: string, pinId: string, px: number, py: number) => {
    if (activeTool !== 'wire' || pendingComponentType || e.button !== 0) return;
    e.stopPropagation();

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
          waypoints: wiringWaypoints.length ? [...wiringWaypoints] : undefined,
          manual: wiringWaypoints.length > 0,
        };
        onWiresChange([...wires, newWire]);
      }

      setWiringFrom(null);
      wiringFromRef.current = null;
      setWiringCursor(null);
      setWiringWaypoints([]);
      wirePointerDown.current = false;
    }
  };

  const handlePinMouseUp = (e: React.MouseEvent, compId: string, pinId: string, px: number, py: number) => {
    if (activeTool !== 'wire' || !wirePointerDown.current) return;
    e.stopPropagation();
    wirePointerDown.current = false;
    const source = wiringFromRef.current ?? wiringFrom;
    if (source?.compId === compId && source.pinId === pinId) return;
    handlePinClick(e, compId, pinId, px, py);
  };

  // Нажатие на элемент
  const handleElementMouseDown = (e: React.MouseEvent, el: CircuitElement) => {
    if (e.button === 1 || e.shiftKey) return;
    e.stopPropagation();
    if (e.button === 2) {
      // Правая кнопка мыши — отмена проводки и инструмента
      setWiringFrom(null);
      setWiringCursor(null);
      setPendingComponentType(null);
      return;
    }

    const pos = screenToWorld(e.clientX, e.clientY);

    if (pendingComponentType) return;
    if (el.type === 'JUNCTION' && activeTool === 'wire') {
      handlePinClick(e, el.id, '1', el.x, el.y);
      return;
    }
    if (activeTool === 'select') {
      setSelectedId(el.id);
      setSelectedWireId(null);
      onSelectElement(el);
      setWiringFrom(null);
      setWiringCursor(null);
      onBeginContinuousEdit?.();
      setDraggingElemId(el.id);
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
    setSelectedWireId(null);
    onSelectElement(el);

  };

  // Двойной щелчок по элементу: открытие окна параметров (стр. 4: "двойной щелчок мышью - появится окно параметров")
  const handleElementDoubleClick = (e: React.MouseEvent, el: CircuitElement) => {
    e.stopPropagation();
    if (activeTool !== 'select' || pendingComponentType) return;
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
      const name = `${source.name}_копия`;
      const copy = { ...source, id: `elem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, x: snapToGrid(el.x + 40), y: snapToGrid(el.y + 40) };
      onElementsChange([...elements, copy]);
      setSelectedId(copy.id);
    }
    if (action === 'delete') {
      onElementsChange(elements.filter(item => item.id !== id));
      onWiresChange(wires.filter(w => w.fromCompId !== id && w.toCompId !== id));
      setSelectedId(null);
    }
    if (['cw', 'ccw', 'cw45', 'ccw45'].includes(action)) {
      const delta = action === 'cw' ? 90 : action === 'ccw' ? 270 : action === 'cw45' ? 45 : 315;
      onElementsChange(elements.map(item => item.id === id ? { ...item, rotation: ((item.rotation || 0) + delta) % 360 } : item));
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

  const downloadSchematicPng = () => {
    const source = svgRef.current;
    if (!source || !elements.length) return;
    const padding = 90;
    const minX = Math.min(...elements.map(el => el.x)) - padding;
    const minY = Math.min(...elements.map(el => el.y)) - padding;
    const maxX = Math.max(...elements.map(el => el.x)) + padding;
    const maxY = Math.max(...elements.map(el => el.y)) + padding;
    const width = Math.max(320, maxX - minX);
    const height = Math.max(220, maxY - minY);
    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    clone.querySelectorAll('[data-export-hide="true"]').forEach(node => node.remove());
    clone.querySelector('#schematic-screen-background')?.remove();
    clone.querySelector('#schematic-world')?.removeAttribute('transform');
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', String(minX)); background.setAttribute('y', String(minY));
    background.setAttribute('width', String(width)); background.setAttribute('height', String(height));
    background.setAttribute('fill', '#ffffff');
    const world = clone.querySelector('#schematic-world');
    clone.insertBefore(background, world || clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone).replaceAll('#dc2626', '#1e293b').replaceAll('#2563eb', '#1e293b');
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
      const context = canvas.getContext('2d');
      if (!context) { URL.revokeObjectURL(url); return; }
      context.scale(scale, scale); context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (blob) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'схема.png'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  };

  return (
    <div className="schematic-editor flex flex-col h-full bg-slate-100 select-none border border-slate-300 rounded overflow-hidden text-slate-800">
      {/* Верхняя панель инструментов редактора. */}
      <div className="schematic-toolbar border-b border-slate-300 flex flex-wrap items-center justify-between shrink-0 z-20">
        {/* Кнопки инструментов и быстрый выбор компонентов */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Быстрый выбор по числу выводов. Колесо перебирает элементы группы. */}
          <div className="flex items-center gap-0.5 bg-white border border-slate-300 rounded p-0.5 shadow-2xs">
            {TERMINAL_GROUPS.map(group => {
              const options = COMPONENT_CATALOG.filter(item => terminalGroupForType(item.type) === group.id);
              const type = quickTypes[group.id] ?? options[0]?.type;
              const definition = COMPONENT_CATALOG.find(item => item.type === type);
              return <div key={group.id} className={`flex items-center gap-0.5 rounded border p-0.5 ${paletteDragGroup === group.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`} title={`${group.label}: удерживайте ЛКМ и перенесите на схему; колесо меняет элемент`}>
                <span className="px-1 text-[10px] font-bold text-slate-500">{group.id === 'two' ? '2-пол.' : group.id === 'three' ? '3-пол.' : group.id === 'four' ? '4-пол.' : 'много'}</span>
                <button type="button" disabled={!type} onMouseDown={event => { if (event.button !== 0 || !type) return; event.preventDefault(); setPaletteDragGroup(group.id); setPendingComponentType(type); setActiveTool('select'); setWiringFrom(null); setWiringCursor(null); }} className="flex h-8 min-w-20 items-center gap-1 rounded bg-slate-50 px-1.5 text-[10px] font-semibold text-slate-700 hover:bg-blue-100 disabled:opacity-40">
                  {type && <ComponentSymbol type={type} className="quick-component-symbol" />}<span className="max-w-16 truncate">{definition?.name ?? 'Нет элементов'}</span>
                </button>
                <select aria-label={`${group.label}: выбрать элемент`} value={type || ''} disabled={!options.length} onChange={e => { const selected = e.target.value as ComponentType; setQuickTypes(current => ({ ...current, [group.id]: selected })); setPendingComponentType(selected); setPaletteDragGroup(null); }} className="w-6 bg-white text-xs text-slate-700" title={`Открыть список: ${group.label}`}>
                  {options.length ? options.map(item => <option key={item.type} value={item.type}>{item.name}</option>) : <option value="">Нет элементов</option>}
                </select>
              </div>;
            })}
            <button type="button" onClick={() => { setPendingComponentType('GND'); setActiveTool('select'); }} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" title="Поставить опорный потенциал 0 В">⏚ 0 В</button>

            {/* Кнопка открытия полной библиотеки компонентов */}
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              className="px-2 py-1 rounded text-2xs font-semibold flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer ml-0.5 transition-colors"
              title="Открыть полную библиотеку компонентов (ОУ, логика, триггеры, трансформаторы и т.д.)"
            >
              <Layers className="w-3 h-3 text-blue-600" />
              <span>Библиотека...</span>
            </button>
            <button type="button" onClick={() => setShortcutSettingsOpen(true)} className="px-2 py-1 rounded text-2xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100" title="Настроить горячие клавиши">Клавиши</button>
          </div>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          <button
            type="button"
            aria-pressed={activeTool === 'wire'}
            onClick={() => {
              setActiveTool(current => current === 'wire' ? 'select' : 'wire');
              setWiringFrom(null);
              wiringFromRef.current = null;
              setWiringCursor(null);
              setWiringWaypoints([]);
              setHoveredPin(null);
              setHoveredWirePoint(null);
              setPendingComponentType(null);
            }}
            className={`rounded border px-2.5 py-1 text-xs font-semibold ${activeTool === 'wire' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
            title="Включить проводку; повторное нажатие возвращает выбор"
          >
            {activeTool === 'wire' ? 'Проводка · вкл' : 'Проводка'}
          </button>

          {/* Повернуть (R) */}
          <button
            type="button"
            disabled={!selectedId}
            onClick={() => {
              if (selectedId) {
                onElementsChange(
                  elements.map((el) =>
                    el.id === selectedId
                      ? { ...el, rotation: ((el.rotation || 0) + 90) % 360 }
                      : el
                  )
                );
              }
            }}
            className="p-1 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white text-slate-700 border border-slate-300 rounded text-xs shadow-2xs cursor-pointer"
            title="Повернуть выбранный элемент (R)"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={!selectedId} onClick={() => selectedId && onElementsChange(elements.map(el => el.id === selectedId ? { ...el, rotation: ((el.rotation || 0) + 45) % 360 } : el))} className="px-2 py-1 bg-white hover:bg-slate-100 disabled:opacity-40 text-blue-700 border border-blue-300 rounded text-xs font-bold shadow-2xs" title="Повернуть выбранный элемент на 45° (Shift+R)">45°</button>

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
                onElementsChange(elements.filter((el) => el.id !== selectedId));
                onWiresChange(
                  wires.filter((w) => w.fromCompId !== selectedId && w.toCompId !== selectedId)
                );
                setSelectedId(null);
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

          <div className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 p-1 shadow-2xs" aria-label="Отображение схемы">
            <span className="px-1 text-[10px] font-bold uppercase tracking-wide text-blue-700">Вид</span>
            {[
              { label: 'Обозначения', short: 'R1', value: showElementNames, toggle: () => setShowElementNames(value => !value) },
              { label: 'Номиналы', short: '1к', value: showElementValues, toggle: () => setShowElementValues(value => !value) },
              { label: 'Номера узлов', short: '#', value: showNodeNumbers, toggle: () => setShowNodeNumbers(value => !value) },
              { label: 'Сетка 20 px', short: 'Сетка', value: showGrid, toggle: () => setShowGrid(value => !value) },
            ].map(item => <button key={item.label} type="button" aria-pressed={item.value} onClick={item.toggle} className={`rounded border px-2 py-1 text-xs font-semibold ${item.value ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-500'}`} title={`${item.value ? 'Скрыть' : 'Показать'}: ${item.label}`}>{item.short}</button>)}
          </div>

          {/* Загрузка готовых схем из руководства */}
          <div className="relative group">
            <button
              type="button"
              className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
              title="Открыть готовую схему NAPS"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden md:inline">Примеры...</span>
            </button>
            <div className="hidden group-hover:block group-focus-within:block absolute left-0 top-full bg-white border border-slate-300 shadow-lg rounded py-1 z-50 w-72 text-xs">
              <div className="px-3 py-1 text-3xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                Примеры схем NAPS:
              </div>
              {SAMPLE_CIRCUITS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => onLoadSample(sc)}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex flex-col cursor-pointer border-b border-slate-100 last:border-none"
                >
                  <span className="font-semibold text-slate-800">{sc.name}</span>
                  <span className="text-3xs text-slate-500 truncate">{sc.pageRef} • {sc.category}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Очистить поле */}
          <button
            type="button"
            onClick={() => {
              if (confirm('Создать новую пустую схему?')) {
                onElementsChange([]);
                onWiresChange([]);
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
        <div className="flex items-center gap-2">
          {/* Масштабирование */}
          <div className="flex items-center gap-0.5 bg-white border border-slate-300 rounded p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
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

          <button type="button" disabled={!elements.length} onClick={downloadSchematicPng} className="px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40" title="Скачать схему как PNG без сетки и служебных отметок"><ImageDown className="w-3.5 h-3.5" /><span className="hidden lg:inline">PNG</span></button>

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
            <span>Кликните на схему для размещения компонента</span>
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
          <div role="dialog" aria-modal="true" aria-label="Горячие клавиши" className="w-80 rounded-xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><strong>Горячие клавиши</strong><button type="button" onClick={() => { setShortcutSettingsOpen(false); setRecordingShortcut(null); }} aria-label="Закрыть">×</button></div>
            {(Object.keys(DEFAULT_SHORTCUTS) as EditorShortcut[]).map(action => <div key={action} className="flex items-center justify-between gap-3 border-t border-slate-100 py-2 text-sm"><span>{SHORTCUT_LABELS[action]}</span><button type="button" onClick={() => setRecordingShortcut(action)} onKeyDown={e => {
              if (recordingShortcut !== action) return;
              e.preventDefault(); e.stopPropagation();
              if (e.code === 'Escape') { setRecordingShortcut(null); return; }
              if (e.ctrlKey || e.metaKey || e.altKey || ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(e.code)) return;
              const previous = editorShortcuts[action];
              setEditorShortcuts(current => {
                const updated = { ...current, [action]: e.code };
                const conflict = (Object.keys(updated) as EditorShortcut[]).find(key => key !== action && current[key] === e.code);
                if (conflict) updated[conflict] = previous;
                return updated;
              });
              setRecordingShortcut(null);
            }} className="min-w-20 rounded border border-slate-300 px-2 py-1 text-center font-mono text-xs hover:bg-blue-50">{recordingShortcut === action ? 'Нажмите…' : editorShortcuts[action].replace(/^Key/, '')}</button></div>)}
            <div className="mt-3 flex justify-between"><button type="button" onClick={() => setEditorShortcuts(DEFAULT_SHORTCUTS)} className="text-xs text-blue-700">Сбросить</button><span className="text-xs text-slate-500">Shift + поворот: 45°</span></div>
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
            <div role="dialog" aria-modal="true" aria-label="Библиотека компонентов" className="library-dialog bg-white shadow-2xl overflow-hidden flex flex-col">
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
                    if (t) setActiveTool('select');
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
              width={GRID_SIZE * zoom}
              height={GRID_SIZE * zoom}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${pan.x}, ${pan.y})`}
            >
              {zoom >= 0.65 && <path
                d={`M ${GRID_SIZE * zoom / 2} 0 V ${GRID_SIZE * zoom} M 0 ${GRID_SIZE * zoom / 2} H ${GRID_SIZE * zoom}`}
                fill="none"
                stroke="#e4eaf2"
                strokeWidth={0.7}
              />}
              <path
                d={`M 0 0 H ${GRID_SIZE * zoom} M 0 0 V ${GRID_SIZE * zoom}`}
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
            {/* ПРОВОДА СХЕМЫ (WIRES) С ОРТОГОНАЛЬНОЙ ТРАССИРОВКОЙ И T-ОТВЕТВЛЕНИЯМИ */}
            {wireGeometries.map((wg) => {
              const { wire, pathD } = wg;
              const isSelected = selectedWireId === wire.id;
              const isHovered = hoveredWirePoint?.wireId === wire.id;

              return (
                <g
                  key={wire.id}
                  onMouseDown={(e) => {
                    if (e.button === 1 || e.shiftKey) return;
                    e.stopPropagation();
                    if (e.button === 2) { setWiringFrom(null); setWiringCursor(null); return; }
                    if (e.button !== 0 || pendingComponentType) return;
                    if (activeTool === 'wire' && wiringFrom) {
                      const pos = screenToWorld(e.clientX, e.clientY);
                      const hit = projectPointToWire(wg.points, { x: pos.rawX, y: pos.rawY });
                      if (hit) handleWirePointClick(wire.id, hit.point.x, hit.point.y);
                      return;
                    }
                    if (activeTool === 'select') {
                      const pos = screenToWorld(e.clientX, e.clientY);
                      const hit = projectPointToWire(wg.points, { x: pos.rawX, y: pos.rawY });
                      if (hit) wireSegmentDrag.current = { wireId: wire.id, segmentIndex: hit.segmentIndex, points: wg.points, started: false };
                    }
                    setSelectedWireId(wire.id);
                    setSelectedId(null);
                  }}
                  onMouseUp={(e) => {
                    if (activeTool !== 'wire' || !wirePointerDown.current || !wiringFrom) return;
                    e.stopPropagation();
                    wirePointerDown.current = false;
                    const pos = screenToWorld(e.clientX, e.clientY);
                    const hit = projectPointToWire(wg.points, { x: pos.rawX, y: pos.rawY });
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
                  {/* Подсветка сегмента провода при наведении */}
                  {isHovered && !isSelected && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={3.5}
                      strokeOpacity={0.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {/* Видимый провод схемы под прямыми углами */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isSelected ? '#2563eb' : '#1e293b'}
                    strokeWidth={isSelected ? 2.5 : 1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

            {/* Предпросмотр ручных точек и автоматически ортогонального последнего участка. */}
            {wiringFrom && wiringCursor && (() => {
              const fromPin = pinPositions.get(`${wiringFrom.compId}_${wiringFrom.pinId}`);
              const targetIsPinOrWire = !!hoveredPin || !!hoveredWirePoint;
              const tailStart = wiringWaypoints.at(-1) ?? wiringFrom;
              const previewEnd = targetIsPinOrWire ? wiringCursor : snapManualWirePoint(tailStart, wiringCursor);
              const pts = wiringWaypoints.length
                ? buildStoredWireRoute(wiringFrom, previewEnd, wiringWaypoints)
                : targetIsPinOrWire
                  ? computeOrthogonalWirePoints(
                    wiringFrom, previewEnd,
                    fromPin ? { x: fromPin.relX, y: fromPin.relY } : undefined,
                    undefined, fromPin?.elType, undefined
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
            {elements.map((el) => {
              const isSelected = selectedId === el.id;
              const pins = getComponentPins(el);

              return (
                <g
                  key={el.id}
                  transform={`translate(${el.x}, ${el.y})`}
                  onMouseDown={(e) => handleElementMouseDown(e, el)}
                  onMouseEnter={() => onHoverStatus?.(`${el.name} · ${COMPONENT_CATALOG.find(item => item.type === el.type)?.name ?? el.type}${el.valueStr ? ` · ${normalizeEngNotation(el.valueStr)}${el.unit ? ` ${el.unit}` : ''}` : ''} · выводов: ${getComponentPins(el).length}${el.isolation ? ` · ${el.isolation === 'open' ? 'разрыв' : 'замыкание'}` : ''}`)}
                  onMouseLeave={() => onHoverStatus?.(null)}
                  onMouseUp={(e) => {
                    if (el.type === 'JUNCTION' && activeTool === 'wire') handlePinMouseUp(e, el.id, '1', el.x, el.y);
                  }}
                  onDoubleClick={(e) => handleElementDoubleClick(e, el)}
                  onWheel={(e) => {
                    if (activeTool !== 'select' || pendingComponentType || el.type === 'JUNCTION') return;
                    e.preventDefault(); e.stopPropagation();
                    if (e.buttons & 1) {
                      const step = e.shiftKey ? 45 : 90;
                      onElementsChange(elements.map(item => item.id === el.id ? { ...item, rotation: ((item.rotation || 0) + (e.deltaY > 0 ? step : 360 - step)) % 360 } : item));
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
                    opacity={el.isolation ? 0.5 : 1}
                  >
                    {el.type === 'JUNCTION'
                      ? <g onMouseEnter={() => setHoveredJunctionId(el.id)} onMouseLeave={() => setHoveredJunctionId(null)}>
                          <circle r={10} fill="transparent" />
                          <circle r={3.5} fill={isSelected ? '#dc2626' : '#1e293b'} pointerEvents="none" />
                          {(hoveredJunctionId === el.id || isSelected) && <circle data-export-hide="true" r={6} fill="none" stroke="#2563eb" strokeWidth={1.5} pointerEvents="none" />}
                        </g>
                      : renderComponentSymbol(el, isSelected)}
                    {el.type !== 'TEXT' && el.type !== 'JUNCTION' && (showElementNames || showElementValues) && <g className="pointer-events-none select-none" style={{ fontFamily: 'GOST type A, GOST 2.304, Arial Narrow, sans-serif' }}>
                      {showElementNames && <text x={-38} y={-12} textAnchor="end" fontSize={11} fontWeight="bold" fill="#1e293b">{el.name}</text>}
                      {showElementValues && el.valueStr && <text x={showElementNames ? 38 : -38} y={-12} textAnchor={showElementNames ? 'start' : 'end'} fontSize={10} fill="#3730a3">{normalizeEngNotation(el.valueStr)}</text>}
                      {el.isolation && <text x={0} y={-31} textAnchor="middle" fontSize={9} fill="#b91c1c" fontWeight="bold">{el.isolation === 'open' ? 'РАЗРЫВ' : 'КЗ'}</text>}
                    </g>}
                  </g>

                  {/* Выводы элемента (Pins с магнитным притягиванием и подсветкой) — только для стандартных компонентов */}
                  {el.type !== 'JUNCTION' &&
                    pins.map((pin) => {
                      const absPx = el.x + pin.x;
                      const absPy = el.y + pin.y;
                      const pinKey = `${el.id}_${pin.id}`;
                      const nodeNum = circuitGraph.pinToNode.get(pinKey);
                      const isWiringSource = wiringFrom?.compId === el.id && wiringFrom?.pinId === pin.id;
                      const isHovered = hoveredPin?.compId === el.id && hoveredPin?.pinId === pin.id;

                      return (
                        <g key={pin.id} pointerEvents={activeTool === 'wire' ? 'auto' : 'none'}>
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
                              x={pin.x + (pin.x < 0 ? 6 : -6)}
                              y={pin.y + (pin.y < 0 ? 8 : -4)}
                              textAnchor={pin.x < 0 ? 'start' : 'end'}
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

                  {/* Ореол и подсказка соединения для узла (JUNCTION) во время проводки */}
                  {el.type === 'JUNCTION' && hoveredPin?.compId === el.id && (
                    <g pointerEvents="none">
                      <circle
                        cx={0}
                        cy={0}
                        r={10}
                        fill="#10b981"
                        fillOpacity={0.25}
                        stroke="#059669"
                        strokeWidth={1.5}
                      />
                      {wiringFrom && wiringFrom.compId !== el.id && (
                        <g transform="translate(8, -18)">
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
                    </g>
                  )}
                </g>
              );
            })}
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
        {showGrid && <div className="pointer-events-none absolute bottom-2 right-2 rounded border border-slate-200 bg-white/90 px-2 py-1 font-mono text-[10px] text-slate-500 shadow-sm">Сетка: {GRID_SIZE} px · выводы: {GRID_SIZE / 2} px</div>}
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
    </div>
  </div>
  );
}

/**
 * Отрисовка графических символов элементов по ГОСТ 2.728 / IEEE (стр. 4-5 мануала)
 */
