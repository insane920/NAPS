/** Locate a real sample, including nonuniform/logarithmic grids. */
export function nearestSample(time: number[], value: number): number {
  let lo = 0, hi = time.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (time[mid] < value) lo = mid + 1; else hi = mid; }
  return lo > 0 && Math.abs(time[lo - 1] - value) <= Math.abs(time[lo] - value) ? lo - 1 : lo;
}

/** Keep min/max in every bucket and both endpoints; don't hide narrow pulses. */
export function plotSampleIndices(values: number[], buckets = 500): number[] {
  if (values.length <= buckets * 2) return values.map((_, i) => i);
  const keep = new Set([0, values.length - 1]);
  const size = Math.ceil(values.length / buckets);
  for (let first = 0; first < values.length; first += size) {
    let min = first, max = first;
    for (let i = first + 1; i < Math.min(values.length, first + size); i++) {
      if (values[i] < values[min]) min = i;
      if (values[i] > values[max]) max = i;
    }
    keep.add(first); keep.add(min); keep.add(max); keep.add(Math.min(values.length - 1, first + size - 1));
  }
  return [...keep].sort((a, b) => a - b);
}

export function timeAtPlotFraction(fraction: number, min: number, max: number, logarithmic: boolean): number {
  const f = Math.max(0, Math.min(1, fraction));
  return logarithmic && min > 0 ? Math.exp(Math.log(min) + f * Math.log(max / min)) : min + f * (max - min);
}
