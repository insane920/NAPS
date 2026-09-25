import type { CircuitElement, CircuitWire, CircuitSimulationResults, TransientSettings } from '../types';
import { buildCircuitGraph, type CircuitGraph } from './circuitSolver';

export const linearTypes = new Set(['R', 'L', 'C', 'V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'GND', 'PORT', 'JUNCTION', 'TEXT']);
export const isLinearCircuit = (elements: CircuitElement[]) => elements.every(e => linearTypes.has(e.type));
const passive = new Set(['GND', 'PORT', 'JUNCTION', 'TEXT']);
export const electricalElements = (elements: CircuitElement[]) => elements.filter(e => !passive.has(e.type) && !e.isolation);

// Snap machine-roundoff at periodic switching boundaries to the exact event.
export function pulseIsHigh(t: number, period: number, duty: number): boolean {
  const cycles = t / period, nearest = Math.round(cycles);
  const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(cycles));
  const phase = Math.abs(cycles - nearest) <= tolerance ? 0 : cycles - Math.floor(cycles);
  return phase < duty && Math.abs(phase - duty) > tolerance;
}

export function sourceValue(e: CircuitElement, t: number): number {
  if (e.type === 'V_AC') return e.value * Math.sin(2 * Math.PI * (e.secondaryValue ?? 50) * t);
  if (e.type === 'V_PULSE') {
    return pulseIsHigh(t, 1 / (e.secondaryValue ?? 50), e.initialCondition ?? 0.5) ? e.value : 0;
  }
  return e.value;
}

/** Shared assembly: the report displays exactly the system solved by the engine. */
export function assembleLinearSystem(branches: CircuitElement[], graph: CircuitGraph, initial: boolean, t: number, dt: number, previousU: Record<string, number>, previousI: Record<string, number>) {
  const node = (e: CircuitElement, pin: string) => graph.pinToNode.get(`${e.id}_${pin}`)!;
  const used = [...new Set(branches.flatMap(e => [node(e, '1'), node(e, '2')]))].filter(n => n !== 0);
  const index = new Map(used.map((n, i) => [n, i]));
  const extra = branches.filter(e => e.type.startsWith('V_') || (initial ? e.type === 'C' : e.type === 'L'));
  const size = used.length + extra.length;
  if (size > 160) throw new Error('Схема слишком велика для текущего решателя (более 160 неизвестных).');
  const a = Array.from({ length: size }, () => new Array(size).fill(0));
  const b = new Array(size).fill(0);
  const add = (i: number | undefined, j: number | undefined, v: number) => { if (i !== undefined && j !== undefined) a[i][j] += v; };
  const stampI = (p: number | undefined, m: number | undefined, value: number) => { if (p !== undefined) b[p] -= value; if (m !== undefined) b[m] += value; };
  for (const e of branches) {
    const p = index.get(node(e, '1')), m = index.get(node(e, '2'));
    let g = 0;
    if (e.type === 'R') g = 1 / e.value;
    if (e.type === 'C' && !initial) { g = e.value / dt; stampI(p, m, -g * previousU[e.name]); }
    if (g) { add(p, p, g); add(m, m, g); add(p, m, -g); add(m, p, -g); }
    if (e.type === 'I_DC') stampI(p, m, e.value);
    if (e.type === 'L' && initial) stampI(p, m, e.initialCondition ?? 0);
    const ei = extra.indexOf(e);
    if (ei >= 0) {
      const q = used.length + ei;
      add(p, q, 1); add(m, q, -1); add(q, p, 1); add(q, m, -1);
      if (e.type === 'L') { a[q][q] = -e.value / dt; b[q] = -e.value / dt * previousI[e.name]; }
      else b[q] = e.type === 'C' ? (e.initialCondition ?? 0) : sourceValue(e, t);
    }
  }
  return { a, b, used, extra, labels: [...used.map(n => `V(${n})`), ...extra.map(e => `I(${e.name})`)] };
}

// Dense Gaussian elimination with row scaling and partial pivoting.
function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  for (let i = 0; i < n; i++) {
    const scale = Math.max(...matrix[i].map(Math.abs));
    if (!scale) throw new Error('Схема вырождена: проверьте землю, неподключённые узлы и источники.');
    matrix[i] = matrix[i].map(v => v / scale); rhs[i] /= scale;
  }
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(matrix[i][k]) > Math.abs(matrix[pivot][k])) pivot = i;
    if (Math.abs(matrix[pivot][k]) < 1e-14) throw new Error('Система уравнений вырождена или плохо обусловлена. Проверьте соединения и начальные условия.');
    [matrix[k], matrix[pivot]] = [matrix[pivot], matrix[k]];
    [rhs[k], rhs[pivot]] = [rhs[pivot], rhs[k]];
    for (let i = k + 1; i < n; i++) {
      const factor = matrix[i][k] / matrix[k][k];
      for (let j = k; j < n; j++) matrix[i][j] -= factor * matrix[k][j];
      rhs[i] -= factor * rhs[k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let b = rhs[i];
    for (let j = i + 1; j < n; j++) b -= matrix[i][j] * x[j];
    x[i] = b / matrix[i][i];
  }
  if (!x.every(Number.isFinite)) throw new Error('Численная ошибка: получены бесконечные значения.');
  return x;
}

/** MNA, backward Euler. At t=0 capacitors impose U(IC), inductors impose I(IC).
 * Current sign: pin 1 → pin 2; voltage: U(pin 1) − U(pin 2).
 * Reference: https://ngspice.sourceforge.io/docs/ngspice-manual.pdf
 */
export function solveLinearTransient(elements: CircuitElement[], wires: CircuitWire[], settings: TransientSettings): CircuitSimulationResults {
  const started = performance.now();
  if (!isLinearCircuit(elements)) throw new Error('Для этой схемы линейный расчёт недоступен.');
  if (!Number.isFinite(settings.tMax) || !Number.isFinite(settings.step) || !(settings.tMax > 0) || !(settings.step > 0) || !Number.isFinite(settings.tMax / settings.step)) throw new Error('Укажите положительные конечное время и шаг.');
  const count = Math.ceil(settings.tMax / settings.step);
  if (count > 20000) throw new Error('Более 20 000 шагов. Увеличьте шаг или уменьшите интервал расчёта.');
  if (!elements.some(e => e.type === 'GND')) throw new Error('Добавьте землю GND для задания нулевого потенциала.');
  const branches = electricalElements(elements);
  const isolated = elements.filter(e => e.isolation && !passive.has(e.type));
  if (!branches.length) throw new Error('В схеме нет электрических компонентов.');
  const ids = new Set(elements.map(e => e.id));
  if (ids.size !== elements.length) throw new Error('Идентификаторы элементов должны быть уникальными.');
  const names = branches.map(e => e.name.toUpperCase());
  if (new Set(names).size !== names.length) throw new Error('Имена электрических компонентов должны быть уникальными.');
  for (const wire of wires) for (const [id, pin] of [[wire.fromCompId, wire.fromPinId], [wire.toCompId, wire.toPinId]]) {
    const e = elements.find(e => e.id === id);
    const pins = e && !passive.has(e.type) ? ['1', '2'] : e?.type === 'TEXT' ? [] : ['1'];
    if (!ids.has(id) || !pins.includes(pin)) throw new Error('Провод ссылается на отсутствующий элемент или вывод.');
  }
  for (const e of branches) {
    if (!Number.isFinite(e.value) || (['R', 'L', 'C'].includes(e.type) && e.value <= 0)) throw new Error(`${e.name}: недопустимый номинал.`);
    if (e.initialCondition !== undefined && !Number.isFinite(e.initialCondition)) throw new Error(`${e.name}: неверное начальное условие.`);
    if (['V_AC', 'V_PULSE'].includes(e.type) && (!Number.isFinite(e.secondaryValue ?? 50) || (e.secondaryValue ?? 50) <= 0)) throw new Error(`${e.name}: частота должна быть положительной.`);
    if (e.type === 'V_PULSE' && ((e.initialCondition ?? 0.5) < 0 || (e.initialCondition ?? 0.5) > 1)) throw new Error(`${e.name}: коэффициент заполнения должен быть от 0 до 1.`);
  }
  const graph = buildCircuitGraph(elements, wires);
  const node = (e: CircuitElement, pin: string) => graph.pinToNode.get(`${e.id}_${pin}`)!;
  const used = [...new Set(branches.flatMap(e => [node(e, '1'), node(e, '2')]))].filter(n => n !== 0);
  const index = new Map(used.map((n, i) => [n, i]));
  const time = Array.from({ length: count + 1 }, (_, k) => k * settings.tMax / count);
  const nodeVoltages: Record<string, number[]> = { node_0: [] };
  for (const n of used) nodeVoltages[`node_${n}`] = [];
  const branchCurrents: Record<string, number[]> = {};
  const voltages: Record<string, number[]> = {};
  for (const e of [...branches, ...isolated]) { branchCurrents[e.name] = []; voltages[e.name] = []; }
  for (let k = 0; k < time.length; k++) {
    const initial = k === 0;
    const dt = initial ? 0 : time[k] - time[k - 1];
    const previousU = Object.fromEntries(branches.map(e => [e.name, voltages[e.name][k - 1]]));
    const previousI = Object.fromEntries(branches.map(e => [e.name, branchCurrents[e.name][k - 1]]));
    const { a, b, extra } = assembleLinearSystem(branches, graph, initial, time[k], dt, previousU, previousI);
    const x = solve(a, b);
    const potential = (n: number) => n === 0 ? 0 : x[index.get(n)!];
    nodeVoltages.node_0.push(0);
    for (const n of used) nodeVoltages[`node_${n}`].push(potential(n));
    for (const e of branches) {
      const u = potential(node(e, '1')) - potential(node(e, '2'));
      const ei = extra.indexOf(e);
      const current = ei >= 0 ? x[used.length + ei] : e.type === 'R' ? u / e.value : e.type === 'I_DC' ? e.value : e.type === 'L' ? (e.initialCondition ?? 0) : e.value / dt * (u - voltages[e.name][k - 1]);
      voltages[e.name].push(u); branchCurrents[e.name].push(current);
    }
    for (const e of isolated) {
      const first = node(e, '1'), second = node(e, '2');
      const voltage = first === second ? 0 : index.has(first) || first === 0 ? (index.has(second) || second === 0 ? potential(first) - potential(second) : NaN) : NaN;
      voltages[e.name].push(voltage);
      branchCurrents[e.name].push(0);
    }
  }
  for (const [name, n] of graph.namedNodes) if (nodeVoltages[`node_${n}`]) nodeVoltages[name] = nodeVoltages[`node_${n}`];
  const signals: Record<string, number[]> = {};
  const stats: CircuitSimulationResults['summary']['stats'] = {};
  for (const sig of settings.signals.filter(s => s.enabled)) {
    if (sig.exprX.trim().toLowerCase() !== 't') throw new Error('Для переходного процесса ось X должна быть t.');
    const match = sig.exprY.trim().match(/^([UIP])\(([^)]+)\)$/i);
    if (!match) throw new Error(`Неподдерживаемое выражение: ${sig.exprY}. Используйте U(...), I(...) или P(...).`);
    const kind = match[1].toUpperCase(), target = match[2].trim().toUpperCase();
    const e = [...branches, ...isolated].find(e => e.name.toUpperCase() === target);
    const n = graph.namedNodes.get(target) ?? (/^\d+$/.test(target) ? Number(target) : undefined);
    let values = kind === 'U' ? (n !== undefined ? nodeVoltages[`node_${n}`] : e ? voltages[e.name] : undefined) : e ? branchCurrents[e.name] : undefined;
    if (kind === 'P' && e) values = voltages[e.name].map((u, k) => u * branchCurrents[e.name][k]);
    if (!values) throw new Error(`Не найден сигнал ${sig.exprY}. Проверьте имя компонента, порта или номер узла.`);
    if (values.some(value => !Number.isFinite(value))) throw new Error(`Потенциал изолированного элемента ${e?.name ?? target} не определён: вывод не связан с расчётной цепью.`);
    signals[sig.exprY] = values;
    // Time-weighted statistics of the piecewise-linear graph, including both endpoints.
    let integral = 0, squareIntegral = 0;
    for (let k = 1; k < time.length; k++) {
      const a = values[k - 1], b = values[k], h = time[k] - time[k - 1];
      integral += h * (a + b) / 2;
      squareIntegral += h * (a * a + a * b + b * b) / 3;
    }
    stats[sig.exprY] = { mean: integral / settings.tMax, rms: Math.sqrt(squareIntegral / settings.tMax), max: Math.max(...values), min: Math.min(...values), unit: kind === 'I' ? 'А' : kind === 'P' ? 'Вт' : 'В' };
  }
  const durationMs = performance.now() - started;
  return { time, signals, nodeVoltages, branchCurrents, model: 'linear-mna', summary: { durationMs, calculationTimeMs: durationMs, pointsCount: time.length, stats } };
}
