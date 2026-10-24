import type { CircuitElement, CircuitWire, WireCrossingMode } from '../types';

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
