import { isLinearCircuit, solveLinearTransient } from './linearTransient';
import { solveTopologyTransient, topologyTypes } from './topologyTransient';
import { solveACAnalysis } from './acAnalysis';
import {
  CircuitElement,
  CircuitWire,
  TransientSettings,
  CircuitSimulationResults,
  ComponentType,
  ACSettings,
} from '../types';

/**
 * Парсер чисел в инженерной нотации:
 * p (п) -> 1e-12, n (н) -> 1e-9, u (мк) -> 1e-6, m (м) -> 1e-3,
 * k (к) -> 1e3, M (М) -> 1e6, G (Г) -> 1e9
 */
export function parseEngValue(str: string | number): number {
  if (typeof str === 'number') return Number.isFinite(str) ? str : NaN;
  const s = str.trim().replace(',', '.');
  // Consume the entire value. A partial match (such as "1кк") must never
  // display one nominal while the solver receives another one.
  const match = s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Zа-яА-ЯµμΩ]*)$/);
  if (!match) return NaN;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return NaN;

  const prefix = match[2].replace(/(?:Ом|Гц|Гн|Ф|В|А|с|Hz|Ohm|Ω|F|H|V|A|s)$/i, '');
  const suffix = prefix.toLowerCase();
  switch (suffix) {
    case 'p':
    case 'п':
      return base * 1e-12;
    case 'n':
    case 'н':
      return base * 1e-9;
    case 'u':
    case 'µ':
    case 'μ':
    case 'мк':
    case 'mk':
      return base * 1e-6;
    case 'k':
    case 'к':
      return base * 1e3;
    case 'meg':
      return base * 1e6;
    case 'm':
    case 'м':
      // Если латинская большая M (Mega) или строчная m (milli)
      if (prefix === 'M' || prefix === 'М') {
        return base * 1e6;
      }
      return base * 1e-3;
    case 'g':
    case 'г':
      return base * 1e9;
    default:
      return prefix ? NaN : base;
  }
}

/** Compact, unit-free spelling for the nominal field and schematic label. */
export function normalizeEngNotation(value: string): string {
  const text = value.trim().replace(/\s+/g, '').replace(',', '.');
  const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(.*)$/);
  if (!match) return text;
  const rawSuffix = match[2].replace(/(?:Ом|Гц|Гн|Ф|В|А|с|Ohm|Hz|Ω|F|H|V|A|s)$/i, '');
  const prefix = rawSuffix === 'M' || rawSuffix === 'М' ? 'М' : ({ k: 'к', к: 'к', m: 'м', м: 'м', u: 'мк', µ: 'мк', μ: 'мк', mk: 'мк', мк: 'мк', n: 'н', н: 'н', p: 'п', п: 'п', G: 'Г', g: 'Г', Г: 'Г', г: 'Г' } as Record<string, string>)[rawSuffix] ?? rawSuffix;
  return `${match[1]}${prefix}`;
}

/**
 * Форматирование числа в инженерную нотацию.
 */
export function formatEngValue(val: number, unit = ''): string {
  if (Math.abs(val) < 1e-14) return `0 ${unit}`.trim();
  const abs = Math.abs(val);

  let num = val;
  let prefix = '';

  if (abs >= 1e9) {
    num = val / 1e9;
    prefix = 'Г';
  } else if (abs >= 1e6) {
    num = val / 1e6;
    prefix = 'М';
  } else if (abs >= 1e3) {
    num = val / 1e3;
    prefix = 'к';
  } else if (abs >= 1) {
    num = val;
    prefix = '';
  } else if (abs >= 1e-3) {
    num = val * 1e3;
    prefix = 'м';
  } else if (abs >= 1e-6) {
    num = val * 1e6;
    prefix = 'мк';
  } else if (abs >= 1e-9) {
    num = val * 1e9;
    prefix = 'н';
  } else if (abs >= 1e-12) {
    num = val * 1e12;
    prefix = 'п';
  }

  // Округление до 3-4 значащих цифр
  const formatted = String(Number(num.toPrecision(3)));
  return `${formatted} ${prefix}${unit}`.trim();
}

/**
 * Определение топологических узлов схемы (Node Clustering)
 */
export interface CircuitGraph {
  pinToNode: Map<string, number>; // key: `${elemId}_${pinId}`
  groundNode: number;
  namedNodes: Map<string, number>; // portName -> node index
  nodeCount: number;
}

/** Pin IDs shared by the editor, SCM importer and electrical graph. */
export function getCircuitPinIds(type: ComponentType): string[] {
  if (type === 'TEXT') return [];
  if (type === 'GND' || type === 'PORT' || type === 'JUNCTION') return ['1'];
  if (type === 'OPAMP' || type === 'COMPARATOR') return ['in_neg', 'in_pos', 'out'];
  if (type === 'SWITCH' || type === 'THYRISTOR') return ['1', '2', 'gate'];
  if (type === 'AND' || type === 'OR' || type === 'XOR') return ['1', '2', '3'];
  if (type === 'JK_FF') return ['1', '2', '3', '4', 'clk'];
  if (type === 'RS_FF' || type === 'D_FF' || type === 'TR3') return ['1', '2', '3', '4'];
  return ['1', '2'];
}

export function buildCircuitGraph(
  elements: CircuitElement[],
  wires: CircuitWire[]
): CircuitGraph {
  // Инициализируем систему непересекающихся множеств (Disjoint Set Union)
  const parent = new Map<string, string>();

  function find(id: string): string {
    if (!parent.has(id)) {
      parent.set(id, id);
      return id;
    }
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  }

  function union(a: string, b: string) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  }

  // Все пины всех элементов
  for (const el of elements) {
    for (const pin of getCircuitPinIds(el.type)) find(`${el.id}_${pin}`);
    if (el.type === 'GND') union(`${el.id}_1`, '__GROUND__');
    if (el.type === 'PORT') union(`${el.id}_1`, `__PORT_${(el.portName || el.name || 'PORT').toUpperCase()}__`);
  }

  // Объединение по проводам
  for (const el of elements) {
    if (el.isolation === 'short') union(`${el.id}_1`, `${el.id}_2`);
  }
  for (const wire of wires) {
    const k1 = `${wire.fromCompId}_${wire.fromPinId}`;
    const k2 = `${wire.toCompId}_${wire.toPinId}`;
    union(k1, k2);
  }

  // Нумерация узлов. Земля всегда узел 0
  const rootToNode = new Map<string, number>();
  const groundRoot = find('__GROUND__');
  rootToNode.set(groundRoot, 0);

  let nextNodeIndex = 1;
  const pinToNode = new Map<string, number>();
  const namedNodes = new Map<string, number>();

  for (const [pinKey] of parent) {
    const r = find(pinKey);
    let nIdx = rootToNode.get(r);
    if (nIdx === undefined) {
      nIdx = nextNodeIndex++;
      rootToNode.set(r, nIdx);
    }
    pinToNode.set(pinKey, nIdx);
  }

  // Связка портов с именами
  for (const el of elements) {
    if (el.type === 'PORT') {
      const nIdx = pinToNode.get(`${el.id}_1`) ?? 0;
      const pName = (el.portName || el.name || 'PORT').toUpperCase();
      namedNodes.set(pName, nIdx);
    }
  }

  return {
    pinToNode,
    groundNode: 0,
    namedNodes,
    nodeCount: nextNodeIndex,
  };
}

/** Run only models that are assembled from the actual electrical graph. */
export function solveCircuitTransient(
  elements: CircuitElement[],
  wires: CircuitWire[],
  settings: TransientSettings,
): CircuitSimulationResults {
  if (isLinearCircuit(elements)) return solveLinearTransient(elements, wires, settings);
  if (elements.every(e => topologyTypes.has(e.type))) return solveTopologyTransient(elements, wires, settings);
  const unsupported = [...new Set(elements.filter(e => !topologyTypes.has(e.type)).map(e => e.type))];
  throw new Error(`Для этой схемы пока нет расчётной модели: ${unsupported.join(', ')}. Расчёт не запускается, чтобы не показывать неверные графики.`);
}

export function solveCircuitAC(
  elements: CircuitElement[],
  wires: CircuitWire[],
  settings: ACSettings
): CircuitSimulationResults {
  return solveACAnalysis(elements, wires, settings);
}
/**
 * ТЗ Разд. 3.2: Изменение параметра (Parameter Sweep)
 * Прогоняет расчет схемы при варьировании сопротивления, емкости, индуктивности или частоты
 */
export function solveCircuitSweep(
  elements: CircuitElement[],
  wires: CircuitWire[],
  transient: TransientSettings,
  sweepParam: {
    elementName: string;
    propertyName: string;
    startVal: number;
    endVal: number;
    steps: number;
    targetExpr: string;
  }
): CircuitSimulationResults {
  const steps = Math.min(10, Math.max(2, sweepParam.steps || 4));
  const stepVal = (sweepParam.endVal - sweepParam.startVal) / (steps - 1);
  const colors = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2'];

  const combinedSignals: Record<string, number[]> = {};
  const stats: Record<string, any> = {};
  const sweepValues: number[] = [];
  let baseResults: CircuitSimulationResults | null = null;

  for (let s = 0; s < steps; s++) {
    const curVal = sweepParam.startVal + s * stepVal;
    sweepValues.push(curVal);
    const modifiedElements = elements.map((el) => {
      if (el.name.toLowerCase() === sweepParam.elementName.toLowerCase()) {
        return {
          ...el,
          value: curVal,
          valueStr: formatEngValue(curVal, el.unit),
        };
      }
      return el;
    });

    const res = solveCircuitTransient(modifiedElements, wires, transient);
    if (!baseResults) baseResults = res;

    const label = `${sweepParam.targetExpr} [${sweepParam.elementName}=${formatEngValue(curVal)}]`;
    const origSignal = res.signals[sweepParam.targetExpr] || Object.values(res.signals)[0] || [];
    combinedSignals[label] = origSignal;

    stats[label] = {
      mean: curVal,
      rms: curVal,
      max: Math.max(...origSignal),
      min: Math.min(...origSignal),
      unit: 'В',
    };
  }

  return {
    time: baseResults ? baseResults.time : [],
    signals: combinedSignals,
    nodeVoltages: baseResults ? baseResults.nodeVoltages : {},
    branchCurrents: baseResults ? baseResults.branchCurrents : {},
    sweepInfo: {
      paramName: sweepParam.elementName,
      values: sweepValues,
    },
    summary: {
      durationMs: 120,
      calculationTimeMs: 120,
      pointsCount: baseResults ? baseResults.time.length : 100,
      stats,
    },
  };
}
