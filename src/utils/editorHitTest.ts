/** Screen-space hit priority shared by selection and electrical connection tools.
 * SVG paint order must not decide which overlapping electrical object is used.
 */
export type EditorHitKind = 'junction' | 'pin' | 'wire-end' | 'waypoint' | 'label' | 'element' | 'wire';
export type EditorHitContext = 'select' | 'connect';

export interface EditorHitCandidate {
  kind: EditorHitKind;
  id: string;
  distancePx: number;
}

export type EditorHitShape =
  | { kind: 'junction' | 'pin' | 'wire-end' | 'waypoint'; id: string; x: number; y: number; radiusPx: number }
  | { kind: 'element' | 'label'; id: string; left: number; top: number; right: number; bottom: number;
      centerX?: number; centerY?: number; angle?: number }
  | { kind: 'wire'; id: string; points: ReadonlyArray<{ x: number; y: number }>; radiusPx: number };

export interface EditorSceneHit extends EditorHitCandidate {
  segmentIndex?: number;
  point?: { x: number; y: number };
}

/** Hit-test the scene in world units with radii measured in screen pixels. */
export function hitTestEditorScene(
  shapes: readonly EditorHitShape[], pointer: { x: number; y: number }, zoom: number,
  context: EditorHitContext,
): EditorSceneHit | null {
  if (!(zoom > 0) || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;
  const hits: EditorSceneHit[] = [];
  for (const shape of shapes) {
    if ('radiusPx' in shape && shape.kind !== 'wire') {
      const distancePx = Math.hypot(pointer.x - shape.x, pointer.y - shape.y) * zoom;
      if (distancePx <= shape.radiusPx) hits.push({ kind: shape.kind, id: shape.id, distancePx });
    } else if (shape.kind === 'wire') {
      for (let index = 1; index < shape.points.length; index++) {
        const a = shape.points[index - 1], b = shape.points[index];
        const dx = b.x - a.x, dy = b.y - a.y;
        const length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1,
          ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) / length2)) : 0;
        const point = { x: a.x + t * dx, y: a.y + t * dy };
        const distancePx = Math.hypot(pointer.x - point.x, pointer.y - point.y) * zoom;
        if (distancePx <= shape.radiusPx) hits.push({ kind: 'wire', id: shape.id,
          distancePx, segmentIndex: index - 1, point });
      }
    } else {
      const centerX = shape.centerX ?? (shape.left + shape.right) / 2;
      const centerY = shape.centerY ?? (shape.top + shape.bottom) / 2;
      const angle = shape.angle ?? 0;
      const dx = pointer.x - centerX, dy = pointer.y - centerY;
      const x = centerX + dx * Math.cos(angle) + dy * Math.sin(angle);
      const y = centerY - dx * Math.sin(angle) + dy * Math.cos(angle);
      if (x >= shape.left && x <= shape.right && y >= shape.top && y <= shape.bottom)
        hits.push({ kind: shape.kind, id: shape.id, distancePx: 0 });
    }
  }
  return pickEditorHit(hits, context);
}

const selectPriority: Record<EditorHitKind, number> = {
  junction: 0, 'wire-end': 1, waypoint: 2, pin: 3, label: 4, element: 5, wire: 6,
};
const connectPriority: Record<EditorHitKind, number> = {
  junction: 0, pin: 0, 'wire-end': 1, waypoint: 2, wire: 3, label: 9, element: 9,
};

export function pickEditorHit<T extends EditorHitCandidate>(
  candidates: readonly T[], context: EditorHitContext,
): T | null {
  const priorities = context === 'connect' ? connectPriority : selectPriority;
  // Fractional SVG transforms can put two geometrically coincident strokes a
  // few subpixels apart. Treat those distances as equal before the stable ID tie.
  const distanceTiePx = 1;
  let best: T | null = null;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.distancePx) || candidate.distancePx < 0 || priorities[candidate.kind] >= 9) continue;
    if (!best || priorities[candidate.kind] < priorities[best.kind] ||
      (priorities[candidate.kind] === priorities[best.kind] &&
        (candidate.distancePx < best.distancePx - distanceTiePx ||
          (Math.abs(candidate.distancePx - best.distancePx) <= distanceTiePx && candidate.id.localeCompare(best.id) < 0)))) best = candidate;
  }
  return best;
}
