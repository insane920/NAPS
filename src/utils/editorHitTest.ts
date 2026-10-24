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
  let best: T | null = null;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.distancePx) || candidate.distancePx < 0 || priorities[candidate.kind] >= 9) continue;
    if (!best || priorities[candidate.kind] < priorities[best.kind] ||
      (priorities[candidate.kind] === priorities[best.kind] &&
        (candidate.distancePx < best.distancePx ||
          (candidate.distancePx === best.distancePx && candidate.id.localeCompare(best.id) < 0)))) best = candidate;
  }
  return best;
}
