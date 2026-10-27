/** Visible ink is separate from editable routes and electrical endpoints.
 * Shared stretches of one electrical net are painted once. Each conductor
 * keeps its original hit target, manual bends and serialized geometry. */
import { SpatialIndex, type SpatialEntry } from './spatialIndex';

export interface InkPoint { x: number; y: number }
export interface InkRoute { id: string; net: string; points: InkPoint[] }
type Interval = [number, number];
const EPS = 1e-6;

/** Mark real branches of an existing electrical net even when the editable
 * junction lies farther along a shared conductor. This changes no endpoints. */
export function derivedBranchMarkers(routes: InkRoute[], explicit: InkPoint[]): InkPoint[] {
  type Segment = { a: InkPoint; b: InkPoint; net: string };
  const entries: SpatialEntry<Segment>[] = [];
  const candidates = new Map<string, { point: InkPoint; net: string }>();
  const key = (point: InkPoint) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
  const explicitKeys = new Set(explicit.map(key));
  for (const route of routes) {
    for (const point of route.points) candidates.set(`${route.net}|${key(point)}`, { point, net: route.net });
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= EPS) continue;
      entries.push({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y), value: { a, b, net: route.net } });
    }
  }
  const index = new SpatialIndex(entries);
  const result: InkPoint[] = [];
  for (const { point, net } of candidates.values()) {
    if (explicitKeys.has(key(point))) continue;
    const rays = new Set<string>();
    let otherNetAtPoint = false;
    for (const { a, b, net: segmentNet } of index.query(point.x, point.y, EPS)) {
      const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
      if (Math.abs(cross) > EPS || point.x < Math.min(a.x, b.x) - EPS || point.x > Math.max(a.x, b.x) + EPS ||
        point.y < Math.min(a.y, b.y) - EPS || point.y > Math.max(a.y, b.y) + EPS) continue;
      if (segmentNet !== net) { otherNetAtPoint = true; continue; }
      for (const end of [a, b]) {
        const dx = end.x - point.x, dy = end.y - point.y, length = Math.hypot(dx, dy);
        if (length > EPS) rays.add(`${(dx / length).toFixed(6)},${(dy / length).toFixed(6)}`);
      }
    }
    if (rays.size >= 3 && !otherNetAtPoint) result.push(point);
  }
  return result;
}

export function uniqueWireInk(routes: InkRoute[]): Map<string, Array<[InkPoint, InkPoint]>> {
  const covered = new Map<string, Interval[]>();
  const result = new Map<string, Array<[InkPoint, InkPoint]>>();
  for (const route of routes) {
    const ink: Array<[InkPoint, InkPoint]> = [];
    let modified = false;
    for (let index = 1; index < route.points.length; index++) {
      const a = route.points[index - 1], b = route.points[index];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= EPS) { modified = true; continue; }
      const sign = b.x < a.x - EPS || Math.abs(b.x - a.x) <= EPS && b.y < a.y ? -1 : 1;
      const ux = sign * (b.x - a.x) / length, uy = sign * (b.y - a.y) / length;
      const normal = -uy * a.x + ux * a.y;
      const key = `${route.net}|${Number(ux.toFixed(9))},${Number(uy.toFixed(9))},${Number(normal.toFixed(6))}`;
      const start = a.x * ux + a.y * uy, end = b.x * ux + b.y * uy;
      const low = Math.min(start, end), high = Math.max(start, end);
      const previous = covered.get(key) ?? [];
      let cursor = low;
      const remaining: Interval[] = [];
      for (const [left, right] of previous) {
        if (right <= cursor + EPS) continue;
        if (left >= high - EPS) break;
        if (left > cursor + EPS) remaining.push([cursor, Math.min(left, high)]);
        cursor = Math.max(cursor, right);
        if (cursor >= high - EPS) break;
      }
      if (cursor < high - EPS) remaining.push([cursor, high]);
      if (remaining.length !== 1 || remaining[0][0] > low + EPS || remaining[0][1] < high - EPS) modified = true;
      const pointAt = (coordinate: number): InkPoint => {
        const t = (coordinate - start) / (end - start);
        return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      };
      for (const [left, right] of start <= end ? remaining : remaining.reverse()) {
        ink.push(start <= end ? [pointAt(left), pointAt(right)] : [pointAt(right), pointAt(left)]);
      }
      const merged: Interval[] = [];
      for (const interval of [...previous, [low, high] as Interval].sort((first, second) => first[0] - second[0])) {
        const last = merged.at(-1);
        if (last && interval[0] <= last[1] + EPS) last[1] = Math.max(last[1], interval[1]);
        else merged.push([...interval]);
      }
      covered.set(key, merged);
    }
    // Leave ordinary paths untouched, including their exact SVG coordinates.
    if (modified) result.set(route.id, ink);
  }
  return result;
}
