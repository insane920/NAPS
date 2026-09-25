import type { CalculationStep, CircuitElement, CircuitSimulationResults, CircuitWire, TransientSettings } from '../types';
import { buildCircuitGraph } from './circuitSolver';
import { assembleLinearSystem, electricalElements } from './linearTransient';

export const numberText = (value: number | undefined) => value === undefined ? '—' : Number.isFinite(value) ? String(Number(value.toPrecision(10))) : String(value);
export interface CalculationReport {
  title: string;
  notes: string[];
  parameters: { name: string; value: string }[];
  steps: CalculationStep[];
  signals: { name: string; formula: string; value: number; unit: string }[];
  statistics: { name: string; mean: number; rms: number; min: number; max: number; unit: string }[];
  statisticsFormula: string;
}
const n = numberText;

/** Builds a readable derivation from the exact result used by the graph. No pass/fail judgement. */
export function buildCalculationReport(elements: CircuitElement[], wires: CircuitWire[], settings: TransientSettings, results: CircuitSimulationResults, sampleIndex: number): CalculationReport {
  const k = Math.max(0, Math.min(results.time.length - 1, Math.trunc(sampleIndex)));
  const t = results.time[k], h = k ? t - results.time[k - 1] : (results.time[1] ?? 0);
  const linear = results.model === 'linear-mna';
  const graph = buildCircuitGraph(elements, wires);
  const node = (e: CircuitElement, pin: string) => graph.pinToNode.get(`${e.id}_${pin}`);
  const potential = (nodeId: number | undefined, index = k) => results.nodeVoltages[`node_${nodeId}`]?.[index];
  const branches = electricalElements(elements);
  const report: CalculationReport = {
    title: linear ? 'Узловой расчёт линейной цепи' : results.derivation?.method ?? 'Расчёт графика',
    notes: linear ? [
      'Все числа в подстановках приведены в СИ: В, А, Ом, Ф, Гн, с. Для чтения показано 10 значащих цифр; расчёт выполняется с точностью JavaScript Number.',
      'U элемента = V(вывод 1) − V(вывод 2); положительный ток направлен от вывода 1 к выводу 2. V(0)=0 — земля.',
      'На каждом шаге решается система A·x=b: узловые потенциалы и токи идеальных источников/индуктивностей. Метод Гаусса с выбором главного элемента. Производные заменены обратной разностью (неявный Эйлер).',
      'В t=0: U_C(0)=IC_C и I_L(0)=IC_L; остальные величины определяются совместным решением уравнений. Провод идеален: соединённые выводы имеют один потенциал.',
    ] : [...(results.derivation?.notes ?? ['Подробная запись шагов для этого режима отсутствует.'])],
    parameters: [
      { name: 'Точка k (нумерация с нуля)', value: String(k) },
      { name: 'Время t[k]', value: `${n(t)} с` },
      { name: 'Фактический шаг h', value: `${n(h)} с` },
      { name: 'Заданный шаг', value: `${n(settings.step)} с` },
      { name: 'Интервал / число точек', value: `0 … ${n(results.time.at(-1))} с / ${results.time.length}` },
      ...elements.map(e => ({ name: `${e.name} (${e.type})`, value: ['GND', 'JUNCTION', 'PORT', 'TEXT'].includes(e.type) ? e.type === 'TEXT' ? e.textDirective || 'Текстовая аннотация' : `узел ${node(e, '1') ?? '—'}${e.portName ? `, порт ${e.portName}` : ''}` : `${n(e.value)} ${e.unit}; выводы: ${node(e, '1') ?? '—'} → ${node(e, '2') ?? '—'}${e.secondaryValue !== undefined ? `; второй параметр=${n(e.secondaryValue)}` : ''}${e.initialCondition !== undefined ? `; IC / D=${n(e.initialCondition)}` : ''}` })),
    ],
    steps: [], signals: [],
    statistics: Object.entries(results.summary.stats).map(([name, stat]) => ({ name, ...stat })),
    statisticsFormula: linear ? 'Для ломаной графика: T=t[N]−t[0]; mean = Σ h[k](y[k−1]+y[k])/(2T); RMS = √{Σ h[k](y[k−1]²+y[k−1]y[k]+y[k]²)/(3T)}. min и max — экстремумы всех записанных точек.' : 'Для дискретных отсчётов старой модели: mean = Σ y[k]/N; RMS = √(Σ y[k]²/N); min и max — экстремумы всех записанных точек.',
  };
  if (linear) {
    const add = (name: string, formula: string, substitution: string, value: number, unit: string) => report.steps.push({ name, formula, substitution, value, unit });
    const previousU = Object.fromEntries(branches.map(e => [e.name, k ? potential(node(e, '1'), k - 1)! - potential(node(e, '2'), k - 1)! : 0]));
    const previousI = Object.fromEntries(branches.map(e => [e.name, k ? results.branchCurrents[e.name][k - 1] : 0]));
    const system = assembleLinearSystem(branches, graph, k === 0, t, h, previousU, previousI);
    const x = [...system.used.map(id => potential(id)!), ...system.extra.map(e => results.branchCurrents[e.name][k])];
    system.a.forEach((row, i) => {
      const terms = row.flatMap((value, j) => value ? [{ value, j }] : []);
      add(`Система: строка ${i + 1}`, terms.map(({ value, j }) => `(${n(value)}) ${system.labels[j]}`).join(' + ') + ` = ${n(system.b[i])}`, terms.map(({ value, j }) => `(${n(value)}) × (${n(x[j])})`).join(' + '), system.b[i], i < system.used.length ? 'А (правая часть)' : 'В (правая часть)');
    });
    const nodeIds = [...new Set(branches.flatMap(e => [node(e, '1')!, node(e, '2')!]))].sort((a, b) => a - b);
    for (const id of nodeIds) {
      const incident = branches.flatMap(e => [
        ...(node(e, '1') === id ? [{ e, sign: 1 }] : []),
        ...(node(e, '2') === id ? [{ e, sign: -1 }] : []),
      ]);
      add(`Узел ${id}: закон Кирхгофа`, incident.map(({ e, sign }) => `${sign > 0 ? '+' : '−'} I(${e.name})`).join(' ') + ' = 0', incident.map(({ e, sign }) => `${sign > 0 ? '+' : '−'} (${n(results.branchCurrents[e.name][k])})`).join(' '), incident.reduce((sum, { e, sign }) => sum + sign * results.branchCurrents[e.name][k], 0), 'А (остаток суммы)');
      add(`V(${id})`, id ? 'Потенциал из совместного решения узловой системы' : 'V(0) = 0', id ? `A·x=b, координата V(${id})` : '0', potential(id)!, 'В');
    }
    for (const e of branches) {
      const p = node(e, '1'), m = node(e, '2');
      const u = potential(p)! - potential(m)!, i = results.branchCurrents[e.name][k];
      const prevU = k ? potential(p, k - 1)! - potential(m, k - 1)! : e.initialCondition ?? 0;
      const prevI = k ? results.branchCurrents[e.name][k - 1] : e.initialCondition ?? 0;
      add(`U(${e.name})`, `U(${e.name}) = V(${p}) − V(${m})`, `${n(potential(p))} − (${n(potential(m))})`, u, 'В');
      if (e.type === 'R') add(`I(${e.name})`, `I = (V(${p}) − V(${m}))/R`, `(${n(potential(p))} − (${n(potential(m))}))/${n(e.value)}`, i, 'А');
      else if (e.type === 'C') {
        if (!k) {
          add(`${e.name}: начальное условие`, 'U_C(0) = IC_C', n(e.initialCondition ?? 0), u, 'В');
          add(`I(${e.name})`, 'Начальный ток C определяется законом Кирхгофа совместно с остальными ветвями', 'Не вычисляется делением на нулевой шаг; неизвестная тока в A·x=b', i, 'А');
        } else add(`I(${e.name})`, 'i_C[k] = C (u_C[k] − u_C[k−1])/h', `${n(e.value)} × (${n(u)} − (${n(prevU)}))/${n(h)}`, i, 'А');
      } else if (e.type === 'L') {
        if (!k) add(`I(${e.name})`, 'i_L[0] = IC_L', n(e.initialCondition ?? 0), i, 'А');
        else {
          add(`I(${e.name})`, 'i_L[k] = i_L[k−1] + h u_L[k]/L', `${n(prevI)} + ${n(h)} × ${n(u)}/${n(e.value)}`, i, 'А');
          add(`${e.name}: уравнение ветви`, `V(${p}) − V(${m}) − (L/h) i_L[k] = −(L/h) i_L[k−1]`, `${n(u)} − (${n(e.value)}/${n(h)}) × (${n(i)})`, -e.value / h * prevI, 'В (правая часть)');
        }
      } else if (e.type === 'I_DC') add(`I(${e.name})`, 'i[k] = I_DC', n(e.value), i, 'А');
      else {
        const f = e.secondaryValue ?? 50, duty = e.initialCondition ?? 0.5;
        add(`${e.name}: источник`, e.type === 'V_AC' ? 'u(t) = A sin(2πft)' : e.type === 'V_PULSE' ? 'u(t) = A при frac(tf) < D; иначе 0' : 'u(t) = U_DC', e.type === 'V_AC' ? `${n(e.value)} × sin(2π × ${n(f)} × ${n(t)})` : e.type === 'V_PULSE' ? `A=${n(e.value)}, frac(${n(t)} × ${n(f)})=${n((t * f) % 1)}, D=${n(duty)}` : n(e.value), u, 'В');
        add(`I(${e.name})`, 'Ток идеального источника — неизвестная в узловой системе; определяется нагрузкой', `Из уравнений Кирхгофа узлов ${p} и ${m}`, i, 'А');
      }
      add(`P(${e.name})`, 'p[k] = u[k] i[k]', `${n(u)} × (${n(i)})`, u * i, 'Вт');
    }
  } else report.steps = [...(results.derivation?.steps[k] ?? [])];

  for (const [name, values] of Object.entries(results.signals)) {
    let formula = results.derivation?.signalSources[name] ?? 'Ряд записан расчётным движком';
    if (linear) {
      const match = name.match(/^([UIP])\(([^)]+)\)$/i);
      if (match) {
        const target = match[2].trim().toUpperCase(), kind = match[1].toUpperCase();
        const e = branches.find(e => e.name.toUpperCase() === target);
        const id = graph.namedNodes.get(target) ?? (/^\d+$/.test(target) ? Number(target) : undefined);
        formula = kind === 'U' ? id !== undefined ? `y[k] = V(${id}) = ${n(potential(id))} В` : e ? `y[k] = V(${node(e, '1')}) − V(${node(e, '2')}) = ${n(potential(node(e, '1')))} − (${n(potential(node(e, '2')))}) В` : formula : kind === 'I' ? `y[k] = I(${e?.name}); уравнение ветви приведено выше` : `y[k] = U(${e?.name}) × I(${e?.name}); подстановка приведена выше`;
      }
    }
    report.signals.push({ name, formula, value: values[k], unit: results.summary.stats[name]?.unit ?? '' });
    const stat = results.summary.stats[name];
    if (stat) {
      let sum = 0, squareSum = 0;
      if (linear) {
        for (let j = 1; j < values.length; j++) {
          const a = values[j - 1], b = values[j], dt = results.time[j] - results.time[j - 1];
          sum += dt * (a + b) / 2;
          squareSum += dt * (a * a + a * b + b * b) / 3;
        }
      } else {
        for (const v of values) { sum += v; squareSum += v * v; }
      }
      const denominator = linear ? results.time.at(-1)! - results.time[0] : values.length;
      report.steps.push({ name: `Среднее ${name}`, formula: linear ? 'mean = ∫y dt / T (интеграл ломаной)' : 'mean = Σy / N', substitution: `${n(sum)} / ${n(denominator)}`, value: stat.mean, unit: stat.unit });
      report.steps.push({ name: `RMS ${name}`, formula: linear ? 'RMS = √(∫y² dt / T) (интеграл квадрата ломаной)' : 'RMS = √(Σy² / N)', substitution: `√(${n(squareSum)} / ${n(denominator)})`, value: stat.rms, unit: stat.unit });
    }
  }
  return report;
}

const escapeHtml = (v: unknown) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function calculationReportHtml(report: CalculationReport, result: CircuitSimulationResults): string {
  const table = (headers: string[], rows: unknown[][]) => `<table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const keys = Object.keys(result.signals);
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Математический расчёт NAPS</title><style>body{font:15px system-ui;margin:32px;color:#172435}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:13px}td,th{border:1px solid #ccd3dd;padding:8px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eef3f9}h1,h2{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}@media print{body{margin:0;font-size:11px}table{font-size:9px}}</style><h1>${escapeHtml(report.title)}</h1><p>NAPS — математический разбор графика</p>${report.notes.map(note => `<p>${escapeHtml(note)}</p>`).join('')}<h2>Исходные данные</h2>${table(['Параметр', 'Значение'], report.parameters.map(p => [p.name, p.value]))}<h2>Уравнения и подстановка для выбранной точки</h2>${table(['Величина', 'Формула', 'Подстановка', 'Результат'], report.steps.map(s => [s.name, s.formula, s.substitution, `${n(s.value)} ${s.unit}`]))}<h2>Сигналы графика</h2>${table(['Сигнал', 'Связь с расчётом', 'Значение'], report.signals.map(s => [s.name, s.formula, `${n(s.value)} ${s.unit}`]))}<h2>Статистика</h2><p>${escapeHtml(report.statisticsFormula)}</p>${table(['Сигнал', 'Среднее', 'RMS', 'min', 'max', 'Единица'], report.statistics.map(s => [s.name, n(s.mean), n(s.rms), n(s.min), n(s.max), s.unit]))}<h2>Все точки графиков (полная числовая точность)</h2>${table(['k', 't, с', ...keys.map(key => `${key}, ${result.summary.stats[key]?.unit ?? ''}`)], result.time.map((t, k) => [k, t, ...keys.map(key => result.signals[key][k])]))}</html>`;
}
