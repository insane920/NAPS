import type { ACSettings, CircuitElement, CircuitSimulationResults, CircuitWire } from '../types';
import { buildCircuitGraph, getCircuitPinIds } from './circuitSolver';
import { solveDenseSystem } from './linearTransient';
import { createMnaMatrix } from './mnaCore';
import { solveDCOperatingPoint } from './dcOperatingPoint';

type Complex = { re: number; im: number };
const zero = (): Complex => ({ re: 0, im: 0 });
const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const div = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) throw new Error('Деление на нулевой комплексный сигнал в выражении AC.');
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const mul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });

const passive = new Set(['GND', 'PORT', 'JUNCTION', 'TEXT']);
const supported = new Set(['R', 'C', 'L', 'V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'TR3', 'OPAMP', 'DIODE', 'SWITCH', 'THYRISTOR', ...passive]);

/** AC small-signal phasors use the peak amplitude of V_AC and a cosine reference. */
export function solveACAnalysis(elements: CircuitElement[], wires: CircuitWire[], settings: ACSettings): CircuitSimulationResults {
  const started = performance.now();
  if (!Number.isFinite(settings.fMin) || !Number.isFinite(settings.fMax) || settings.fMin <= 0 || settings.fMax <= settings.fMin) throw new Error('AC: задайте 0 < начальная частота < конечная частота.');
  if (!Number.isSafeInteger(settings.points) || settings.points < 2 || settings.points > 2000) throw new Error('AC: число точек должно быть от 2 до 2000.');
  if (!elements.some(e => e.type === 'GND')) throw new Error('Добавьте землю GND для задания нулевого потенциала.');
  const unsupported = [...new Set(elements.filter(e => !supported.has(e.type) && !e.isolation).map(e => e.type))];
  if (unsupported.length) throw new Error(`AC: малосигнальная модель отсутствует для ${unsupported.join(', ')}. График не построен.`);
  const byId = new Map(elements.map(e => [e.id, e]));
  if (byId.size !== elements.length) throw new Error('Идентификаторы элементов должны быть уникальными.');
  for (const w of wires) for (const [id, pin] of [[w.fromCompId, w.fromPinId], [w.toCompId, w.toPinId]]) {
    const e = byId.get(id);
    if (!e || !getCircuitPinIds(e.type).includes(pin)) throw new Error('Провод ссылается на отсутствующий элемент или вывод.');
  }
  const active = elements.filter(e => !passive.has(e.type) && !e.isolation);
  if (!active.length || !active.some(e => e.type === 'V_AC' && e.value !== 0)) throw new Error('AC: подключите источник V_AC с ненулевой амплитудой.');
  if (new Set(active.map(e => e.name.toUpperCase())).size !== active.length) throw new Error('Имена электрических компонентов должны быть уникальными.');
  for (const e of active) {
    if (!Number.isFinite(e.value) || (['R', 'L', 'C', 'TR3'].includes(e.type) && e.value <= 0)) throw new Error(`${e.name}: недопустимый номинал.`);
    if (['DIODE', 'THYRISTOR', 'SWITCH'].includes(e.type)) {
      const ron = e.modelParams?.onResistance ?? 0.01, roff = e.modelParams?.offResistance ?? 1e9;
      if (!Number.isFinite(ron) || ron <= 0 || !Number.isFinite(roff) || roff <= 0) throw new Error(`${e.name}: сопротивления открытого и закрытого состояния должны быть положительными.`);
    }
    if (e.type === 'OPAMP' && (!Number.isFinite(e.modelParams?.outputLimit ?? 15) || (e.modelParams?.outputLimit ?? 15) <= 0 || e.value <= 0)) throw new Error(`${e.name}: неверные параметры усилителя.`);
    if (e.type === 'TR3') {
      const ratio = e.modelParams?.turnsRatio ?? e.secondaryValue ?? 1;
      const coupling = e.modelParams?.couplingFactor ?? 0.999;
      if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(coupling) || coupling <= 0 || coupling >= 1) throw new Error(`${e.name}: коэффициент трансформации должен быть > 0, связь — от 0 до 1 (не включая 1).`);
    }
  }
  const graph = buildCircuitGraph(elements, wires);
  const operatingPoint = active.some(e => ['DIODE', 'SWITCH', 'THYRISTOR', 'OPAMP'].includes(e.type))
    ? solveDCOperatingPoint(elements, wires) : undefined;
  const pin = (e: CircuitElement, p: string) => graph.pinToNode.get(`${e.id}_${p}`)!;
  const used = [...new Set(active.flatMap(e => getCircuitPinIds(e.type).map(p => pin(e, p))))].filter(n => n !== 0);
  const nodeIndex = new Map(used.map((n, i) => [n, i]));
  const extras = active.flatMap(e => e.type === 'TR3' ? [`${e.id}:primary`, `${e.id}:secondary`] : e.type.startsWith('V_') || e.type === 'OPAMP' ? [e.id] : []);
  const extraIndex = new Map(extras.map((id, i) => [id, used.length + i]));
  const size = used.length + extras.length;
  if (size > 160) throw new Error('Схема слишком велика для текущего решателя (более 160 неизвестных).');
  const frequencies = Array.from({ length: settings.points }, (_, i) => settings.scaleType === 'log'
    ? settings.fMin * Math.pow(settings.fMax / settings.fMin, i / (settings.points - 1))
    : settings.fMin + (settings.fMax - settings.fMin) * i / (settings.points - 1));
  const nodeVoltages: Record<string, number[]> = { node_0: [] };
  const complexNodeVoltages: NonNullable<CircuitSimulationResults['complexNodeVoltages']> = { node_0: [] };
  for (const n of used) nodeVoltages[`node_${n}`] = [];
  for (const n of used) complexNodeVoltages[`node_${n}`] = [];
  const branchCurrents: Record<string, number[]> = {};
  const complexBranchCurrents: NonNullable<CircuitSimulationResults['complexBranchCurrents']> = {};
  for (const e of active) {
    branchCurrents[e.name] = []; complexBranchCurrents[e.name] = [];
    if (e.type === 'TR3') { branchCurrents[`${e.name}:secondary`] = []; complexBranchCurrents[`${e.name}:secondary`] = []; }
  }
  const signals: Record<string, number[]> = Object.fromEntries(settings.signals.filter(s => s.enabled).map(s => [s.exprY, []]));
  if (!Object.keys(signals).length) throw new Error('AC: выберите хотя бы один сигнал для графика.');
  const idx = (n: number) => n === 0 ? undefined : nodeIndex.get(n);
  const nodeName = (name: string) => graph.namedNodes.get(name.toUpperCase()) ?? (/^\d+$/.test(name) ? Number(name) : undefined);

  for (const f of frequencies) {
    const omega = 2 * Math.PI * f;
    const matrix = createMnaMatrix(2 * size);
    const addZ = (row: number | undefined, col: number | undefined, value: Complex) => {
      matrix.add(row, col, value.re);
      matrix.add(row === undefined ? undefined : row + size, col === undefined ? undefined : col + size, value.re);
      matrix.add(row === undefined ? undefined : row + size, col, value.im);
      matrix.add(row, col === undefined ? undefined : col + size, -value.im);
    };
    const admittance = (p: number | undefined, m: number | undefined, y: Complex) => {
      addZ(p, p, y); addZ(m, m, y);
      addZ(p, m, { re: -y.re, im: -y.im }); addZ(m, p, { re: -y.re, im: -y.im });
    };
    const voltage = (p: number | undefined, m: number | undefined, q: number, value: Complex) => {
      addZ(p, q, { re: 1, im: 0 }); addZ(m, q, { re: -1, im: 0 });
      addZ(q, p, { re: 1, im: 0 }); addZ(q, m, { re: -1, im: 0 });
      matrix.b[q] = value.re; matrix.b[q + size] = value.im;
    };
    for (const e of active) {
      const p = idx(pin(e, e.type === 'OPAMP' ? 'out' : '1'));
      const m = e.type === 'OPAMP' ? undefined : idx(pin(e, '2'));
      if (e.type === 'R') admittance(p, m, { re: 1 / e.value, im: 0 });
      else if (e.type === 'C') admittance(p, m, { re: 0, im: omega * e.value });
      else if (e.type === 'L') admittance(p, m, { re: 0, im: -1 / (omega * e.value) });
      else if (e.type === 'DIODE' || e.type === 'THYRISTOR' || e.type === 'SWITCH') {
        const on = operatingPoint?.states.get(e.id) === 1;
        const resistance = on ? e.modelParams?.onResistance ?? 0.01 : e.modelParams?.offResistance ?? 1e9;
        admittance(p, m, { re: 1 / resistance, im: 0 });
      }
      else if (e.type.startsWith('V_')) voltage(p, m, extraIndex.get(e.id)!, { re: e.type === 'V_AC' ? e.value : 0, im: 0 });
      else if (e.type === 'OPAMP') {
        const q = extraIndex.get(e.id)!;
        voltage(p, undefined, q, zero());
        if (!operatingPoint?.states.get(e.id)) {
          addZ(q, idx(pin(e, 'in_neg')), { re: e.value, im: 0 });
          addZ(q, idx(pin(e, 'in_pos')), { re: -e.value, im: 0 });
        }
      } else if (e.type === 'TR3') {
        const primary = extraIndex.get(`${e.id}:primary`)!;
        const secondary = extraIndex.get(`${e.id}:secondary`)!;
        const ratio = e.modelParams?.turnsRatio ?? e.secondaryValue ?? 1;
        const l1 = e.value, l2 = l1 * ratio * ratio;
        const mutual = (e.modelParams?.couplingFactor ?? 0.999) * Math.sqrt(l1 * l2);
        voltage(idx(pin(e, '1')), idx(pin(e, '2')), primary, zero());
        voltage(idx(pin(e, '3')), idx(pin(e, '4')), secondary, zero());
        addZ(primary, primary, { re: 0, im: -omega * l1 });
        addZ(primary, secondary, { re: 0, im: -omega * mutual });
        addZ(secondary, primary, { re: 0, im: -omega * mutual });
        addZ(secondary, secondary, { re: 0, im: -omega * l2 });
      }
    }
    let solution: number[];
    try { solution = solveDenseSystem(matrix.a, matrix.b); }
    catch (error) { throw new Error(`AC, f=${f} Гц: ${error instanceof Error ? error.message : 'система не решена'}`); }
    const complexAt = (index: number | undefined): Complex => index === undefined ? zero() : { re: solution[index], im: solution[index + size] };
    const nodeAt = (n: number): Complex => n === 0 ? zero() : complexAt(nodeIndex.get(n));
    const voltageOf = (e: CircuitElement) => sub(nodeAt(pin(e, e.type === 'OPAMP' ? 'out' : '1')), nodeAt(e.type === 'OPAMP' ? 0 : pin(e, '2')));
    const currentOf = (e: CircuitElement): Complex => {
      if (e.type === 'TR3') return complexAt(extraIndex.get(`${e.id}:primary`));
      if (extraIndex.has(e.id)) return complexAt(extraIndex.get(e.id));
      const u = voltageOf(e);
      if (e.type === 'R') return { re: u.re / e.value, im: u.im / e.value };
      if (e.type === 'C') return mul(u, { re: 0, im: omega * e.value });
      if (e.type === 'L') return mul(u, { re: 0, im: -1 / (omega * e.value) });
      if (e.type === 'DIODE' || e.type === 'THYRISTOR' || e.type === 'SWITCH') {
        const resistance = operatingPoint?.states.get(e.id) === 1 ? e.modelParams?.onResistance ?? 0.01 : e.modelParams?.offResistance ?? 1e9;
        return { re: u.re / resistance, im: u.im / resistance };
      }
      return zero();
    };
    nodeVoltages.node_0.push(0); complexNodeVoltages.node_0.push(zero());
    for (const n of used) { const v = nodeAt(n); nodeVoltages[`node_${n}`].push(Math.hypot(v.re, v.im)); complexNodeVoltages[`node_${n}`].push(v); }
    for (const e of active) {
      const i = currentOf(e); branchCurrents[e.name].push(Math.hypot(i.re, i.im)); complexBranchCurrents[e.name].push(i);
      if (e.type === 'TR3') {
        const secondary = complexAt(extraIndex.get(`${e.id}:secondary`));
        branchCurrents[`${e.name}:secondary`].push(Math.hypot(secondary.re, secondary.im));
        complexBranchCurrents[`${e.name}:secondary`].push(secondary);
      }
    }
    const atom = (text: string): Complex => {
      const match = text.trim().match(/^([UI])\(([^()]+)\)$/i);
      if (!match) throw new Error(`AC: неподдерживаемое выражение ${text}.`);
      const target = match[2].trim().toUpperCase();
      const e = active.find(item => item.name.toUpperCase() === target);
      if (match[1].toUpperCase() === 'I') {
        const secondary = active.find(item => item.type === 'TR3' && `${item.name}:secondary`.toUpperCase() === target);
        if (secondary) return complexAt(extraIndex.get(`${secondary.id}:secondary`));
        if (!e) throw new Error(`AC: не найден ток ${text}.`);
        return currentOf(e);
      }
      const n = nodeName(target);
      if (n !== undefined) {
        if (n !== 0 && !nodeIndex.has(n)) throw new Error(`AC: узел ${target} не входит в расчётную схему.`);
        return nodeAt(n);
      }
      if (e) return voltageOf(e);
      throw new Error(`AC: не найден сигнал ${text}.`);
    };
    for (const sig of settings.signals.filter(s => s.enabled)) {
      if (sig.exprX.trim().toLowerCase() !== 'f') throw new Error('AC: ось X должна быть f.');
      const expression = sig.exprY.trim();
      const wrapped = expression.match(/^(db|phs|mag|re|im)\((.+)\)$/i);
      const fn = wrapped?.[1].toLowerCase() ?? 'mag';
      const inside = wrapped?.[2] ?? expression;
      const slash = inside.indexOf('/');
      const value = slash < 0 ? atom(inside) : div(atom(inside.slice(0, slash)), atom(inside.slice(slash + 1)));
      const magnitude = Math.hypot(value.re, value.im);
      const result = fn === 'db' ? 20 * Math.log10(Math.max(magnitude, 1e-300))
        : fn === 'phs' ? Math.atan2(value.im, value.re) * 180 / Math.PI
        : fn === 're' ? value.re : fn === 'im' ? value.im : magnitude;
      if (!Number.isFinite(result)) throw new Error(`AC: сигнал ${expression} не определён при f=${f} Гц.`);
      signals[sig.exprY].push(result);
    }
  }
  for (const [name, n] of graph.namedNodes) if (nodeVoltages[`node_${n}`]) { nodeVoltages[name] = nodeVoltages[`node_${n}`]; complexNodeVoltages[name] = complexNodeVoltages[`node_${n}`]; }
  const stats: CircuitSimulationResults['summary']['stats'] = {};
  for (const sig of settings.signals.filter(s => s.enabled)) {
    const values = signals[sig.exprY];
    stats[sig.exprY] = { min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length,
      rms: Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length), unit: /^db\(/i.test(sig.exprY) ? 'дБ' : /^phs\(/i.test(sig.exprY) ? '°' : '' };
  }
  const durationMs = performance.now() - started;
  return { time: frequencies, frequency: frequencies, isAC: true, signals, nodeVoltages, branchCurrents, complexNodeVoltages, complexBranchCurrents, model: 'linear-mna',
    summary: { durationMs, calculationTimeMs: durationMs, pointsCount: frequencies.length, stats } };
}
