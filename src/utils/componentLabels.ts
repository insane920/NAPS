import { SpatialIndex } from './spatialIndex';
export interface ComponentLabelPoint {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface ComponentLabelLayout {
  name: ComponentLabelPoint;
  value: ComponentLabelPoint;
  isolation: ComponentLabelPoint;
}

interface ComponentLabelOptions {
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  showName?: boolean;
}

/** Positions labels with the component while keeping the text itself upright. */
export function getComponentLabelLayout({
  rotation = 0,
  flipH = false,
  flipV = false,
  showName = true,
}: ComponentLabelOptions): ComponentLabelLayout {
  const normalized = ((rotation % 360) + 360) % 360;
  const radians = normalized * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const transform = (x: number, y: number): ComponentLabelPoint => {
    const localX = flipH ? -x : x;
    const localY = flipV ? -y : y;
    const transformedX = localX * cos - localY * sin;
    const transformedY = localX * sin + localY * cos;
    return {
      x: Math.round(transformedX * 10) / 10,
      y: Math.round(transformedY * 10) / 10,
      anchor: transformedX > 20 ? 'start' : transformedX < -20 ? 'end' : 'middle',
    };
  };

  return {
    name: transform(0, -36),
    value: transform(0, showName ? 38 : -36),
    isolation: transform(0, showName ? -52 : 52),
  };
}

interface LabelBox { x: number; y: number; width: number; height: number }
export function labelBounds(point: ComponentLabelPoint, text: string, x = 0, y = 0): LabelBox {
  const width = Math.max(8, text.length * 7.5);
  return { x: x + point.x - (point.anchor === 'middle' ? width / 2 : point.anchor === 'end' ? width : 0) - 3,
    y: y + point.y - 12, width: width + 6, height: 17 };
}
const overlaps = (a: LabelBox, b: LabelBox) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function crosses(box: LabelBox, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  let low = 0, high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.x, box.x + box.width], [a.y, b.y - a.y, box.y, box.y + box.height]]) {
    if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return false; }
    else { const t1 = (min - start) / delta, t2 = (max - start) / delta; low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2)); if (low > high) return false; }
  }
  return true;
}

/** Move only labels, leaving model coordinates and electrical connections untouched. */
export function arrangeComponentLabels(
  elements: CircuitElement[], routes: Array<{ points: Array<{ x: number; y: number }> }>,
  bodies: LabelBox[], showName: boolean, showValue: boolean,
): Map<string, ComponentLabelLayout> {
  const occupied: LabelBox[] = [];
  const layouts = new Map<string, ComponentLabelLayout>();
  const bodyIndex = new SpatialIndex(bodies.map(box => ({ minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height, value: box })));
  const segmentIndex = new SpatialIndex(routes.flatMap(route => route.points.slice(1).map((b, i) => {
    const a = route.points[i];
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y), value: { a, b } };
  })));
  for (const element of elements) {
    const layout = getComponentLabelLayout({ ...element, showName });
    if (element.type === 'TEXT' || element.type === 'JUNCTION') { layouts.set(element.id, layout); continue; }
    const labels = [showName ? ['name', element.name] : null, showValue ? ['value', getComponentValueLabel(element)] : null,
      element.isolation === 'short' ? ['isolation', 'КЗ'] : null].filter(Boolean) as Array<[keyof ComponentLabelLayout, string]>;
    const radius = 150 + Math.max(0, ...labels.map(([, text]) => text.length * 7.5));
    const nearbyBodies = bodyIndex.query(element.x, element.y, radius);
    const nearbySegments = segmentIndex.query(element.x, element.y, radius);
    const nearbyLabels = occupied.filter(box => overlaps(box, { x: element.x - radius, y: element.y - radius, width: radius * 2, height: radius * 2 }));
    for (const [kind, text] of labels) {
      if (!text) continue;
      const original = layout[kind];
      let best = original, bestScore = Infinity;
      // Keep preferred orientation first; search nearby clear lanes if a wire or neighbour intervenes.
      search: for (const dx of [0, -16, 16, -32, 32, -48, 48, -64, 64]) for (const dy of [0, -16, 16, -32, 32, -48, 48, -64, 64]) {
        const point = { ...original, x: original.x + dx, y: original.y + dy };
        const box = labelBounds(point, text, element.x, element.y);
        const collisions = nearbyBodies.filter(body => overlaps(box, body)).length + nearbyLabels.filter(other => overlaps(box, other)).length;
        let lines = 0;
        for (const { a, b } of nearbySegments) if (crosses(box, a, b)) lines++;
        const score = collisions * 100000 + lines * 10000 + Math.hypot(dx, dy);
        if (score < bestScore) { best = point; bestScore = score; }
        if (score === 0) break search;
      }
      layout[kind] = best;
      occupied.push(labelBounds(best, text, element.x, element.y));
      nearbyLabels.push(occupied[occupied.length - 1]);
    }
    layouts.set(element.id, layout);
  }
  return layouts;
}
import type { CircuitElement } from '../types';
import { normalizeEngNotation } from '../math/circuitSolver';


/** A schematic value describes a model parameter, never repeats the symbol's type name. */
export function getComponentValueLabel(element: CircuitElement): string {
  const parameter = (value: number) => normalizeEngNotation(String(value));
  switch (element.type) {
    case 'DIODE':
      if (element.diodeModel === 'ideal') return 'идеальный';
    case 'THYRISTOR':
      return `${parameter(element.modelParams?.forwardVoltage ?? (element.value > 0 ? element.value : 0.7))}В`;
    case 'SWITCH':
      return `Rвкл=${parameter(element.modelParams?.onResistance ?? 0.01)}Ω`;
    case 'NPN': case 'PNP':
      return `${element.type} · β=${parameter(element.modelParams?.betaForward ?? 100)}`;
    case 'NMOS': case 'PMOS':
      return `${element.type} · Vth=${parameter(element.modelParams?.thresholdVoltage ?? 2)}В`;
    case 'COMPARATOR':
      return `Uпор=${parameter(element.modelParams?.logicThreshold ?? 2.5)}В`;
    case 'TR3':
      return `L1=${normalizeEngNotation(element.valueStr || String(element.value)).replace(/\s*(Гн|H)\s*$/iu, '')}Гн · n=${parameter(element.modelParams?.turnsRatio ?? element.secondaryValue ?? 1)}`;
    case 'NOT': case 'AND': case 'OR': case 'XOR':
    case 'RS_FF': case 'D_FF': case 'JK_FF':
    case 'PORT': case 'GND': case 'JUNCTION': case 'TEXT': case 'CHIP':
      return '';
    default:
      return element.valueStr ? normalizeEngNotation(element.valueStr) : '';
  }
}
