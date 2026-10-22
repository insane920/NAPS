import type { CircuitElement } from '../types';
import { SYMBOL_METRICS } from '../components/symbolMetrics';

export interface RoutePoint { x: number; y: number }
export interface RouteBox { left: number; top: number; right: number; bottom: number }
const EPS = 1e-6;

/** A conservative body envelope, excluding terminal leads. All dimensions are schematic units. */
export function componentObstacle(element: CircuitElement, clearance = 4): RouteBox | null {
  if (element.type === 'JUNCTION' || element.type === 'GND' || element.type === 'TEXT' || element.type === 'PORT') return null;
  const halfWidth = ['CHIP', 'RS_FF', 'D_FF', 'JK_FF'].includes(element.type) ? 40
    : ['OPAMP', 'COMPARATOR', 'NPN', 'PNP', 'NMOS', 'PMOS', 'TR3'].includes(element.type) ? 25
      : SYMBOL_METRICS.bodyHalfWidth;
  const halfHeight = ['CHIP', 'RS_FF', 'D_FF', 'JK_FF'].includes(element.type) ? 28
    : ['OPAMP', 'COMPARATOR', 'NPN', 'PNP', 'NMOS', 'PMOS', 'TR3'].includes(element.type) ? 23
      : element.type === 'R' ? SYMBOL_METRICS.passiveHalfHeight : SYMBOL_METRICS.sourceRadius;
  const angle = (element.rotation || 0) * Math.PI / 180;
  const x = Math.abs(Math.cos(angle)) * halfWidth + Math.abs(Math.sin(angle)) * halfHeight + clearance;
  const y = Math.abs(Math.sin(angle)) * halfWidth + Math.abs(Math.cos(angle)) * halfHeight + clearance;
  return { left: element.x - x, top: element.y - y, right: element.x + x, bottom: element.y + y };
}

function inside(point: RoutePoint, box: RouteBox): boolean {
  return point.x > box.left + EPS && point.x < box.right - EPS && point.y > box.top + EPS && point.y < box.bottom - EPS;
}
function orientation(a: RoutePoint, b: RoutePoint, c: RoutePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function between(a: number, b: number, c: number) { return c >= Math.min(a, b) - EPS && c <= Math.max(a, b) + EPS; }
function onSegment(a: RoutePoint, b: RoutePoint, p: RoutePoint) {
  return Math.abs(orientation(a, b, p)) <= EPS && between(a.x, b.x, p.x) && between(a.y, b.y, p.y);
}
function segmentsMeet(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (Math.abs(abC) <= EPS && onSegment(a, b, c)) return true;
  if (Math.abs(abD) <= EPS && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) <= EPS && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) <= EPS && onSegment(c, d, b)) return true;
  return abC * abD < 0 && cdA * cdB < 0;
}
function hitsBox(a: RoutePoint, b: RoutePoint, box: RouteBox): boolean {
  if (inside(a, box) || inside(b, box)) return true;
  if (Math.abs(a.y - b.y) <= EPS) return a.y > box.top + EPS && a.y < box.bottom - EPS &&
    Math.max(a.x, b.x) > box.left + EPS && Math.min(a.x, b.x) < box.right - EPS;
  if (Math.abs(a.x - b.x) <= EPS) return a.x > box.left + EPS && a.x < box.right - EPS &&
    Math.max(a.y, b.y) > box.top + EPS && Math.min(a.y, b.y) < box.bottom - EPS;
  // Short diagonal terminal stubs are checked against every rectangle edge.
  const corners = [{ x: box.left, y: box.top }, { x: box.right, y: box.top },
    { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }];
  return corners.some((corner, index) => segmentsMeet(a, b, corner, corners[(index + 1) % 4]));
}

export function routeIsClear(points: RoutePoint[], obstacles: RouteBox[], foreign: RoutePoint[][]): boolean {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    if (obstacles.some(box => hitsBox(a, b, box))) return false;
    for (const route of foreign) for (let other = 1; other < route.length; other++) {
      if (segmentsMeet(a, b, route[other - 1], route[other])) return false;
    }
  }
  return true;
}

function ordered(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map(value => Number(value.toFixed(6))))].sort((a, b) => a - b);
}
function simplify(points: RoutePoint[]): RoutePoint[] {
  const result: RoutePoint[] = [];
  for (const point of points) {
    if (result.length && Math.hypot(point.x - result.at(-1)!.x, point.y - result.at(-1)!.y) <= EPS) continue;
    while (result.length > 1 && Math.abs(orientation(result.at(-2)!, result.at(-1)!, point)) <= EPS) result.pop();
    result.push(point);
  }
  return result;
}

/** Bounded visibility-grid search. No geometry is saved: only explicit user bends belong in SCM. */
export function routeAroundObstacles(start: RoutePoint, end: RoutePoint, startDirection: RoutePoint,
  endDirection: RoutePoint, grid: number, baseline: RoutePoint[], obstacles: RouteBox[], foreign: RoutePoint[][]): RoutePoint[] | null {
  if (routeIsClear(baseline, obstacles, foreign)) return baseline;
  const step = Math.max(1, grid);
  const lead = (point: RoutePoint, direction: RoutePoint): RoutePoint => {
    const length = Math.hypot(direction.x, direction.y);
    return length < EPS ? point : { x: point.x + direction.x / length * step, y: point.y + direction.y / length * step };
  };
  const from = lead(start, startDirection), to = lead(end, endDirection);
  if (!routeIsClear([start, from], obstacles, foreign) || !routeIsClear([to, end], obstacles, foreign)) return null;
  const xs = [from.x, to.x], ys = [from.y, to.y];
  for (const box of obstacles) {
    xs.push(box.left - step, box.right + step);
    ys.push(box.top - step, box.bottom + step);
  }
  for (const route of foreign) for (const point of route) {
    xs.push(point.x - step, point.x + step);
    ys.push(point.y - step, point.y + step);
  }
  const xValues = ordered(xs), yValues = ordered(ys);
  if (xValues.length * yValues.length > 30000) return null;
  const width = xValues.length, height = yValues.length;
  const startX = xValues.findIndex(x => Math.abs(x - from.x) <= EPS);
  const startY = yValues.findIndex(y => Math.abs(y - from.y) <= EPS);
  const endX = xValues.findIndex(x => Math.abs(x - to.x) <= EPS);
  const endY = yValues.findIndex(y => Math.abs(y - to.y) <= EPS);
  if ([startX, startY, endX, endY].some(value => value < 0)) return null;
  const at = (x: number, y: number): RoutePoint => ({ x: xValues[x], y: yValues[y] });
  const index = (x: number, y: number, axis: number) => (y * width + x) * 3 + axis;
  const startId = index(startX, startY, 0), targetCell = endY * width + endX;
  const cost = new Float64Array(width * height * 3).fill(Infinity);
  const parent = new Int32Array(cost.length).fill(-1);
  const visited = new Uint8Array(cost.length);
  const queue: Array<{ id: number; priority: number }> = [];
  const push = (id: number, priority: number) => {
    queue.push({ id, priority }); let child = queue.length - 1;
    while (child > 0) { const up = (child - 1) >> 1; if (queue[up].priority <= priority) break;
      queue[child] = queue[up]; child = up; } queue[child] = { id, priority };
  };
  const pop = () => {
    const top = queue[0], last = queue.pop()!;
    if (queue.length) { let root = 0; while (root * 2 + 1 < queue.length) {
      let child = root * 2 + 1; if (child + 1 < queue.length && queue[child + 1].priority < queue[child].priority) child++;
      if (queue[child].priority >= last.priority) break; queue[root] = queue[child]; root = child;
    } queue[root] = last; } return top;
  };
  const heuristic = (x: number, y: number) => Math.abs(xValues[x] - to.x) + Math.abs(yValues[y] - to.y);
  cost[startId] = 0; push(startId, heuristic(startX, startY));
  let winner = -1, iterations = 0;
  while (queue.length && iterations++ < 90000) {
    const current = pop(); if (visited[current.id]) continue; visited[current.id] = 1;
    const axis = current.id % 3, cell = Math.floor(current.id / 3), x = cell % width, y = Math.floor(cell / width);
    if (cell === targetCell) { winner = current.id; break; }
    for (const [dx, dy, nextAxis] of [[1, 0, 1], [-1, 0, 1], [0, 1, 2], [0, -1, 2]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const a = at(x, y), b = at(nx, ny);
      if (!routeIsClear([a, b], obstacles, foreign)) continue;
      const nextId = index(nx, ny, nextAxis), length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const nextCost = cost[current.id] + length + (axis && axis !== nextAxis ? step * 0.4 : 0);
      if (nextCost >= cost[nextId] - EPS) continue;
      cost[nextId] = nextCost; parent[nextId] = current.id;
      push(nextId, nextCost + heuristic(nx, ny));
    }
  }
  if (winner < 0) return null;
  const middle: RoutePoint[] = [];
  for (let cursor = winner; cursor >= 0; cursor = parent[cursor]) {
    const cell = Math.floor(cursor / 3); middle.push(at(cell % width, Math.floor(cell / width)));
  }
  const result = simplify([start, ...middle.reverse(), end]);
  return routeIsClear(result, obstacles, foreign) ? result : null;
}
