/** Shared modified-nodal-analysis matrix used by transient and AC models. */
export interface MnaMatrix {
  a: number[][];
  b: number[];
  add(i: number | undefined, j: number | undefined, value: number): void;
  current(p: number | undefined, m: number | undefined, value: number): void;
  conductance(p: number | undefined, m: number | undefined, value: number, offset?: number): void;
  voltage(p: number | undefined, m: number | undefined, branch: number, value: number): void;
}

export function createMnaMatrix(size: number): MnaMatrix {
  if (!Number.isInteger(size) || size < 0 || size > 320) throw new Error('Схема слишком велика для плотного матричного решателя.');
  const a = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const b = new Array<number>(size).fill(0);
  const add = (i: number | undefined, j: number | undefined, value: number) => {
    if (i !== undefined && j !== undefined) a[i][j] += value;
  };
  const current = (p: number | undefined, m: number | undefined, value: number) => {
    if (p !== undefined) b[p] -= value;
    if (m !== undefined) b[m] += value;
  };
  const conductance = (p: number | undefined, m: number | undefined, value: number, offset = 0) => {
    add(p, p, value); add(m, m, value); add(p, m, -value); add(m, p, -value);
    if (offset) current(p, m, offset);
  };
  const voltage = (p: number | undefined, m: number | undefined, branch: number, value: number) => {
    add(p, branch, 1); add(m, branch, -1); add(branch, p, 1); add(branch, m, -1);
    b[branch] = value;
  };
  return { a, b, add, current, conductance, voltage };
}
