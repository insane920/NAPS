/** Bounds of a non-electrical note in schematic world units. */
export function textBlockBounds(value: string): { left: number; top: number; width: number; height: number; lines: string[] } {
  const lines = (value || 'Текст схемы').split(/\r?\n/);
  return {
    left: -50,
    top: -14,
    width: Math.max(80, ...lines.map(line => line.length * 5.6 + 16)),
    height: Math.max(28, lines.length * 13 + 15),
    lines,
  };
}
