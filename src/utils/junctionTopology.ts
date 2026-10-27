import type { CircuitElement, CircuitWire, WireCrossingMode } from '../types';

/** Repair coincident derived markers without freezing their source conductors.
 * SCM 8 treats a shared geometric crossing as one electrical junction.
 */
export function mergeCoincidentAutomaticCrossings(
  elements: CircuitElement[], wires: CircuitWire[], mode: WireCrossingMode,
): { elements: CircuitElement[]; wires: CircuitWire[] } {
  if (mode !== 'connect') return { elements, wires };
  const retained: CircuitElement[] = [];
  const aliases = new Map<string, string>();
  const buckets = new Map<string, CircuitElement[]>();
  const bucket = (x: number, y: number) => `${x}:${y}`;
  const quantize = (coordinate: number) => Math.floor(coordinate / 0.001);
  for (const element of elements) {
    if (element.type !== 'JUNCTION' || !element.autoCrossing) { retained.push(element); continue; }
    const ix = quantize(element.x), iy = quantize(element.y);
    let canonical: CircuitElement | undefined;
    for (let dx = -1; dx <= 1 && !canonical; dx++) for (let dy = -1; dy <= 1 && !canonical; dy++) {
      canonical = buckets.get(bucket(ix + dx, iy + dy))?.find(previous =>
        Math.abs(previous.x - element.x) < 0.001 && Math.abs(previous.y - element.y) < 0.001);
    }
    if (canonical) aliases.set(element.id, canonical.id);
    else { retained.push(element); const key = bucket(ix, iy);
      buckets.set(key, [...(buckets.get(key) ?? []), element]); }
  }
  if (!aliases.size) return { elements, wires };
  return { elements: retained, wires: wires.map(wire => ({ ...wire,
    fromCompId: aliases.get(wire.fromCompId) ?? wire.fromCompId,
    toCompId: aliases.get(wire.toCompId) ?? wire.toCompId,
  })) };
}

/** In SCM 8 coincident explicit junctions denote one electrical point. SCM 7 is untouched. */
export function mergeCoincidentJunctions(
  elements: CircuitElement[], wires: CircuitWire[], mode: WireCrossingMode,
): { elements: CircuitElement[]; wires: CircuitWire[] } {
  if (mode !== 'connect') return { elements, wires };
  const retained: CircuitElement[] = [];
  const aliases = new Map<string, string>();
  const buckets = new Map<string, CircuitElement[]>();
  const bucket = (x: number, y: number) => `${x}:${y}`;
  const quantize = (coordinate: number) => Math.floor(coordinate / 0.001);
  for (const element of elements) {
    // Keep automatic nodes intact until their wire provenance is collapsed.
    if (element.type !== 'JUNCTION' || element.autoCrossing) {
      retained.push(element);
      continue;
    }
    const ix = quantize(element.x), iy = quantize(element.y);
    let canonical: CircuitElement | undefined;
    for (let dx = -1; dx <= 1 && !canonical; dx++) for (let dy = -1; dy <= 1 && !canonical; dy++) {
      canonical = buckets.get(bucket(ix + dx, iy + dy))?.find(previous =>
        Math.abs(previous.x - element.x) < 0.001 && Math.abs(previous.y - element.y) < 0.001);
    }
    if (canonical) aliases.set(element.id, canonical.id);
    else {
      retained.push(element);
      const key = bucket(ix, iy);
      buckets.set(key, [...(buckets.get(key) ?? []), element]);
    }
  }
  if (!aliases.size) return { elements, wires };
  return { elements: retained, wires: wires.map(wire => {
    const fromCompId = aliases.get(wire.fromCompId) ?? wire.fromCompId;
    const toCompId = aliases.get(wire.toCompId) ?? wire.toCompId;
    return fromCompId === wire.fromCompId && toCompId === wire.toCompId ? wire
      : { ...wire, fromCompId, toCompId };
  }) };
}

/** A user branch turns a derived crossing into an explicit, durable junction.
 * Freeze whole intersecting conductor families so later route normalization
 * cannot remove the target of that branch or leave a dangling wire end.
 */
export function promoteAnchoredCrossings(
  elements: CircuitElement[], wires: CircuitWire[], mode: WireCrossingMode,
): { elements: CircuitElement[]; wires: CircuitWire[] } {
  if (mode !== 'connect') return { elements, wires };
  const automatic = new Set(elements.filter(element => element.type === 'JUNCTION' && element.autoCrossing)
    .map(element => element.id));
  if (!automatic.size) return { elements, wires };
  const explicit = elements.filter(element => element.type === 'JUNCTION' && !element.autoCrossing);
  const promoted = new Set(elements.filter(element => automatic.has(element.id) && explicit.some(other =>
    Math.abs(other.x - element.x) < 0.001 && Math.abs(other.y - element.y) < 0.001)).map(element => element.id));
  for (const wire of wires) {
    if (wire.originWireId) continue;
    if (automatic.has(wire.fromCompId)) promoted.add(wire.fromCompId);
    if (automatic.has(wire.toCompId)) promoted.add(wire.toCompId);
  }
  if (!promoted.size) return { elements, wires };
  const origins = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const wire of wires) {
      if (!wire.originWireId) continue;
      if ((promoted.has(wire.fromCompId) || promoted.has(wire.toCompId)) && !origins.has(wire.originWireId)) {
        origins.add(wire.originWireId);
        changed = true;
      }
      if (origins.has(wire.originWireId)) for (const id of [wire.fromCompId, wire.toCompId]) {
        if (automatic.has(id) && !promoted.has(id)) { promoted.add(id); changed = true; }
      }
    }
  }
  const aliases = new Map(elements.filter(element => promoted.has(element.id)).flatMap(element => {
    const target = explicit.find(other => Math.abs(other.x - element.x) < 0.001 &&
      Math.abs(other.y - element.y) < 0.001);
    return target ? [[element.id, target.id] as const] : [];
  }));
  return {
    elements: elements.filter(element => !aliases.has(element.id))
      .map(element => promoted.has(element.id) ? { ...element, autoCrossing: undefined } : element),
    wires: wires.map(wire => ({
      ...wire,
      fromCompId: aliases.get(wire.fromCompId) ?? wire.fromCompId,
      toCompId: aliases.get(wire.toCompId) ?? wire.toCompId,
      originWireId: wire.originWireId && origins.has(wire.originWireId) ? undefined : wire.originWireId,
      originRoute: wire.originWireId && origins.has(wire.originWireId) ? undefined : wire.originRoute,
    })),
  };
}
