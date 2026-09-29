import type { CircuitElement } from '../types';

/** Choose a name above the highest occupied suffix, including manually named elements. */
export function nextComponentName(elements: CircuitElement[], prefix: string, start = 1): string {
  const upperPrefix = prefix.toLocaleUpperCase();
  let highest = start - 1;
  for (const element of elements) {
    const name = element.name.toLocaleUpperCase();
    if (!name.startsWith(upperPrefix)) continue;
    const suffix = name.slice(upperPrefix.length);
    if (/^[1-9]\d*$/.test(suffix)) highest = Math.max(highest, Number(suffix));
  }
  return `${prefix}${highest + 1}`;
}
