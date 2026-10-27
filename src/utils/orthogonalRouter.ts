import type { CircuitElement } from '../types';
import { SYMBOL_METRICS } from '../components/symbolMetrics';

export interface RoutePoint { x: number; y: number }
export interface RouteBox {
  left: number; top: number; right: number; bottom: number;
  centerX?: number; centerY?: number; halfWidth?: number; halfHeight?: number; angle?: number;
}
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
  const paddedWidth = halfWidth + clearance, paddedHeight = halfHeight + clearance;
  const x = Math.abs(Math.cos(angle)) * paddedWidth + Math.abs(Math.sin(angle)) * paddedHeight;
  const y = Math.abs(Math.sin(angle)) * paddedWidth + Math.abs(Math.cos(angle)) * paddedHeight;
  return { left: element.x - x, top: element.y - y, right: element.x + x, bottom: element.y + y,
    centerX: element.x, centerY: element.y, halfWidth: paddedWidth, halfHeight: paddedHeight, angle };
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

function firstSharedHit(a: RoutePoint, b: RoutePoint, routes: RoutePoint[][]): RoutePoint | null {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  if (length2 < EPS * EPS) return null;
  let best = Infinity;
  for (const route of routes) for (let i = 1; i < route.length; i++) {
    const c = route[i - 1], d = route[i];
    if (!segmentsMeet(a, b, c, d)) continue;
    const sx = d.x - c.x, sy = d.y - c.y, denominator = dx * sy - dy * sx;
    const t = Math.abs(denominator) > EPS ? ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator
      : Math.max(0, Math.min(((c.x - a.x) * dx + (c.y - a.y) * dy) / length2, ((d.x - a.x) * dx + (d.y - a.y) * dy) / length2));
    best = Math.min(best, Math.max(0, Math.min(1, t)));
  }
  return Number.isFinite(best) ? { x: a.x + dx * best, y: a.y + dy * best } : null;
}
function liesOnShared(point: RoutePoint, routes: RoutePoint[][]): boolean {
  return routes.some(route => route.slice(1).some((b, i) => onSegment(route[i], b, point)));
}
function sharedSegment(a: RoutePoint, b: RoutePoint, routes: RoutePoint[][]): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  if (length2 < EPS * EPS) return true;
  const intervals: Array<[number, number]> = [];
  for (const route of routes) for (let i = 1; i < route.length; i++) {
    const c = route[i - 1], d = route[i];
    if (Math.abs(orientation(a, b, c)) > EPS || Math.abs(orientation(a, b, d)) > EPS) continue;
    const t1 = ((c.x - a.x) * dx + (c.y - a.y) * dy) / length2, t2 = ((d.x - a.x) * dx + (d.y - a.y) * dy) / length2;
    intervals.push([Math.max(0, Math.min(t1, t2)), Math.min(1, Math.max(t1, t2))]);
  }
  let covered = 0;
  for (const [low, high] of intervals.sort((a, b) => a[0] - b[0])) {
    if (high < covered - EPS) continue;
    if (low > covered + EPS) return false;
    covered = Math.max(covered, high);
    if (covered >= 1 - EPS) return true;
  }
  return false;
}

/** After joining an existing tree, follow its conductors instead of leaving and closing a loop. */
export function followsSharedNetwork(points: RoutePoint[], shared: RoutePoint[][]): boolean {
  if (!shared.length) return true;
  if (!liesOnShared(points.at(-1)!, shared) && liesOnShared(points[0], shared)) return followsSharedNetwork([...points].reverse(), shared);
  let joined = liesOnShared(points[0], shared);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (joined) { if (!sharedSegment(a, b, shared)) return false; }
    else {
      const hit = firstSharedHit(a, b, shared);
      if (hit) { joined = true; if (!sharedSegment(hit, b, shared)) return false; }
    }
  }
  return !joined || liesOnShared(points.at(-1)!, shared);
}
function hitsAxisBox(a: RoutePoint, b: RoutePoint, box: RouteBox): boolean {
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
function hitsBox(a: RoutePoint, b: RoutePoint, box: RouteBox): boolean {
  if (box.centerX === undefined || box.centerY === undefined || box.halfWidth === undefined ||
      box.halfHeight === undefined || !box.angle) return hitsAxisBox(a, b, box);
  const cosine = Math.cos(box.angle), sine = Math.sin(box.angle);
  const local = (point: RoutePoint) => {
    const x = point.x - box.centerX!, y = point.y - box.centerY!;
    return { x: x * cosine + y * sine, y: -x * sine + y * cosine };
  };
  return hitsAxisBox(local(a), local(b), {
    left: -box.halfWidth, right: box.halfWidth, top: -box.halfHeight, bottom: box.halfHeight,
  });
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

export function automaticRouteCost(points: RoutePoint[]): { bends: number; length: number } {
  return { bends: Math.max(0, points.length - 2), length: points.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0) };
}
function outward(a: RoutePoint, b: RoutePoint, direction: RoutePoint): boolean {
  if (Math.hypot(direction.x, direction.y) < EPS) return true;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) > EPS && Math.abs(dy) > EPS) return false;
  if (Math.abs(dx) > EPS) return Math.abs(direction.x) + EPS >= Math.abs(direction.y) && dx * direction.x > EPS;
  return Math.abs(direction.y) + EPS >= Math.abs(direction.x) && dy * direction.y > EPS;
}
export function isOrthogonalAutomaticRoute(points: RoutePoint[]): boolean {
  if (!Array.isArray(points) || !points.length || !points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) || !points.slice(1).every((p, i) =>
    Math.hypot(p.x - points[i].x, p.y - points[i].y) > EPS && (Math.abs(p.x - points[i].x) <= EPS || Math.abs(p.y - points[i].y) <= EPS))) return false;
  for (let i = 1; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (segmentsMeet(points[i - 1], points[i], points[j - 1], points[j])) return false;
  }
  return true;
}

/** Adapt only terminal-adjacent segments. Automatic bends never become manual constraints. */
export function reanchorAutomaticRoute(previous: RoutePoint[], start: RoutePoint, end: RoutePoint): RoutePoint[] {
  if (previous.length < 2) return [start, end];
  const points = previous.map(point => ({ ...point }));
  const firstHorizontal = Math.abs(points[0].y - points[1].y) < EPS;
  const lastHorizontal = Math.abs(points.at(-1)!.y - points.at(-2)!.y) < EPS;
  if (points.length === 3) points[1] = firstHorizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
  else if (points.length > 3) {
    points[1] = firstHorizontal ? { x: points[1].x, y: start.y } : { x: start.x, y: points[1].y };
    points[points.length - 2] = lastHorizontal ? { x: points.at(-2)!.x, y: end.y } : { x: end.x, y: points.at(-2)!.y };
  }
  points[0] = start; points[points.length - 1] = end;
  return simplify(points);
}

/** Bounded visibility-grid search. No geometry is saved: only explicit user bends belong in SCM. */
export function routeAroundObstacles(start: RoutePoint, end: RoutePoint, startDirection: RoutePoint,
  endDirection: RoutePoint, grid: number, baseline: RoutePoint[], obstacles: RouteBox[], foreign: RoutePoint[][], shared: RoutePoint[][] = []): RoutePoint[] | null {
  const step = Math.max(1, grid);
  if (![start.x, start.y, end.x, end.y, grid].every(Number.isFinite) || grid <= 0) return null;
  if (Math.hypot(start.x - end.x, start.y - end.y) <= EPS) return [{ ...start }];
  if (shared.length && !liesOnShared(end, shared)) {
    if (liesOnShared(start, shared)) {
      const reversed = routeAroundObstacles(end, start, endDirection, startDirection, grid, [...baseline].reverse(), obstacles, foreign, shared);
      return reversed ? [...reversed].reverse() : null;
    }
    foreign = [...foreign, ...shared]; shared = [];
  }
  const valid = (points: RoutePoint[]) => isOrthogonalAutomaticRoute(points)
    && Math.hypot(points[0].x - start.x, points[0].y - start.y) < EPS
    && Math.hypot(points.at(-1)!.x - end.x, points.at(-1)!.y - end.y) < EPS
    && outward(points[0], points[1], startDirection) && outward(points.at(-1)!, points.at(-2)!, endDirection)
    && routeIsClear(points, obstacles, foreign) && followsSharedNetwork(points, shared);
  const choose = (candidates: RoutePoint[][]) => {
    const selected = candidates.map(simplify).filter(valid).reduce<RoutePoint[] | null>((best, points) => {
    if (!best) return points;
    const a = automaticRouteCost(points), b = automaticRouteCost(best);
    return a.bends < b.bends || a.bends === b.bends && a.length < b.length - EPS ? points : best;
    }, null);
    return selected && selected.length === baseline.length && selected.every((point, index) => Math.hypot(point.x - baseline[index].x, point.y - baseline[index].y) < EPS) ? baseline : selected;
  };
  const manhattan = Math.abs(start.x - end.x) + Math.abs(start.y - end.y);
  if (!Number.isFinite(manhattan)) return null;
  const simple = [baseline, [start, end], [start, { x: end.x, y: start.y }, end], [start, { x: start.x, y: end.y }, end]];
  const middleX = Math.round((start.x + end.x) / (2 * step)) * step;
  const middleY = Math.round((start.y + end.y) / (2 * step)) * step;
  simple.push([start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end],
    [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end]);
  let bestSimple = choose(simple);
  if (bestSimple && (automaticRouteCost(bestSimple).bends < 2 || automaticRouteCost(bestSimple).bends === 2 && automaticRouteCost(bestSimple).length <= manhattan + EPS)) return bestSimple;
  const from = start, to = end;
  // Only geometry near these endpoints can constrain this bounded search. Far-away
  // components must not make the Cartesian visibility grid grow quadratically.
  const reach = Math.max(200, Math.abs(start.x - end.x) + Math.abs(start.y - end.y));
  const region = { left: Math.min(start.x, end.x) - reach, right: Math.max(start.x, end.x) + reach,
    top: Math.min(start.y, end.y) - reach, bottom: Math.max(start.y, end.y) + reach };
  const nearbyBoxes = obstacles.filter(box => box.right >= region.left && box.left <= region.right &&
    box.bottom >= region.top && box.top <= region.bottom);
  const nearbyRoutes = foreign.filter(route => route.some((point, index) => index > 0 &&
    Math.max(point.x, route[index - 1].x) >= region.left && Math.min(point.x, route[index - 1].x) <= region.right &&
    Math.max(point.y, route[index - 1].y) >= region.top && Math.min(point.y, route[index - 1].y) <= region.bottom));
  const xs = [from.x, to.x, from.x - step, from.x + step, to.x - step, to.x + step, middleX],
    ys = [from.y, to.y, from.y - step, from.y + step, to.y - step, to.y + step, middleY];
  for (const box of nearbyBoxes) {
    xs.push(box.left, box.right, box.left - step, box.right + step);
    ys.push(box.top, box.bottom, box.top - step, box.bottom + step);
  }
  for (const route of nearbyRoutes) for (const point of route) {
    xs.push(point.x - step, point.x + step, point.x - 2, point.x + 2);
    ys.push(point.y - step, point.y + step, point.y - 2, point.y + 2);
  }
  for (const route of shared) for (const point of route) { xs.push(point.x); ys.push(point.y); }
  const xValues = ordered(xs), yValues = ordered(ys);
  simple.push(...xValues.map(x => [start, { x, y: start.y }, { x, y: end.y }, end]),
    ...yValues.map(y => [start, { x: start.x, y }, { x: end.x, y }, end]));
  bestSimple = choose(simple);
  if (bestSimple && automaticRouteCost(bestSimple).bends <= 2) return bestSimple;
  if (xValues.length * yValues.length > 30000) {
    // A convenient exterior detour is not necessarily the fewest-bend route.
    // Reject this edit rather than silently replacing it with unproven geometry.
    return null;
  }
  const width = xValues.length, height = yValues.length;
  const startX = xValues.findIndex(x => Math.abs(x - from.x) <= EPS);
  const startY = yValues.findIndex(y => Math.abs(y - from.y) <= EPS);
  const endX = xValues.findIndex(x => Math.abs(x - to.x) <= EPS);
  const endY = yValues.findIndex(y => Math.abs(y - to.y) <= EPS);
  if ([startX, startY, endX, endY].some(value => value < 0)) return null;
  const at = (x: number, y: number): RoutePoint => ({ x: xValues[x], y: yValues[y] });
  const index = (x: number, y: number, axis: number, joined = false) => (y * width + x) * 10 + axis + (joined ? 5 : 0);
  const startId = index(startX, startY, 0, liesOnShared(start, shared)), targetCell = endY * width + endX;
  const cost = new Float64Array(width * height * 10).fill(Infinity);
  const bends = new Int32Array(cost.length).fill(2147483647);
  const parent = new Int32Array(cost.length).fill(-1);
  const visited = new Uint8Array(cost.length);
  type Entry = { id: number; turns: number; priority: number };
  const queue: Entry[] = [];
  const compare = (a: Entry, b: Entry) => a.turns - b.turns || a.priority - b.priority || a.id - b.id;
  const push = (id: number, turns: number, priority: number) => {
    const entry = { id, turns, priority };
    queue.push(entry); let child = queue.length - 1;
    while (child > 0) { const up = (child - 1) >> 1; if (compare(queue[up], entry) <= 0) break;
      queue[child] = queue[up]; child = up; } queue[child] = entry;
  };
  const pop = () => {
    const top = queue[0], last = queue.pop()!;
    if (queue.length) { let root = 0; while (root * 2 + 1 < queue.length) {
      let child = root * 2 + 1; if (child + 1 < queue.length && compare(queue[child + 1], queue[child]) < 0) child++;
      if (compare(queue[child], last) >= 0) break; queue[root] = queue[child]; root = child;
    } queue[root] = last; } return top;
  };
  const heuristic = (x: number, y: number) => Math.abs(xValues[x] - to.x) + Math.abs(yValues[y] - to.y);
  cost[startId] = 0; bends[startId] = 0; push(startId, 0, heuristic(startX, startY));
  let winner = -1, iterations = 0;
  while (queue.length && iterations++ < 90000) {
    const current = pop(); if (visited[current.id]) continue; visited[current.id] = 1;
    const axis = current.id % 5, joined = current.id % 10 >= 5, cell = Math.floor(current.id / 10), x = cell % width, y = Math.floor(cell / width);
    if (cell === targetCell) { winner = current.id; break; }
    for (const [dx, dy, nextAxis] of [[1, 0, 1], [-1, 0, 2], [0, 1, 3], [0, -1, 4]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const a = at(x, y), b = at(nx, ny);
      // A 180-degree reversal is not a zero-cost straight continuation.
      if (axis && Math.ceil(axis / 2) === Math.ceil(nextAxis / 2) && axis !== nextAxis) continue;
      if (current.id === startId && !outward(a, b, startDirection)) continue;
      if (ny * width + nx === targetCell && !outward(b, a, endDirection)) continue;
      if (!routeIsClear([a, b], nearbyBoxes, nearbyRoutes)) continue;
      let nextJoined = joined;
      if (joined) { if (!sharedSegment(a, b, shared)) continue; }
      else {
        const hit = firstSharedHit(a, b, shared);
        if (hit) { nextJoined = true; if (!sharedSegment(hit, b, shared)) continue; }
      }
      const nextId = index(nx, ny, nextAxis, nextJoined), length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const nextBends = bends[current.id] + (axis && Math.ceil(axis / 2) !== Math.ceil(nextAxis / 2) ? 1 : 0);
      const nextCost = cost[current.id] + length;
      if (nextBends > bends[nextId] || nextBends === bends[nextId] && nextCost >= cost[nextId] - EPS) continue;
      bends[nextId] = nextBends; cost[nextId] = nextCost; parent[nextId] = current.id;
      push(nextId, nextBends, nextCost + heuristic(nx, ny));
    }
  }
  if (winner < 0) return null;
  const middle: RoutePoint[] = [];
  for (let cursor = winner; cursor >= 0; cursor = parent[cursor]) {
    const cell = Math.floor(cursor / 10); middle.push(at(cell % width, Math.floor(cell / width)));
  }
  const result = simplify([start, ...middle.reverse(), end]);
  return valid(result) ? choose([baseline, result]) : null;
}
