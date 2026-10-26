/** Visible ink is separate from editable routes and electrical endpoints.
 * Shared stretches of one electrical net are painted once. Each conductor
 * keeps its original hit target, manual bends and serialized geometry. */
export interface InkPoint { x: number; y: number }
export interface InkRoute { id: string; net: string; points: InkPoint[] }
type Interval = [number, number];
const EPS = 1e-6;

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
