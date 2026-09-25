import { isLinearCircuit, linearTypes, solveLinearTransient, pulseIsHigh } from './linearTransient';
import { SAMPLE_CIRCUITS } from '../data/sampleCircuits';
import {
  CircuitElement,
  CircuitWire,
  TransientSettings,
  CircuitSimulationResults,
  ComponentType,
} from '../types';

/**
 * Парсер чисел в инженерной нотации:
 * p (п) -> 1e-12, n (н) -> 1e-9, u (мк) -> 1e-6, m (м) -> 1e-3,
 * k (к) -> 1e3, M (М) -> 1e6, G (Г) -> 1e9
 */
export function parseEngValue(str: string | number): number {
  if (typeof str === 'number') return isNaN(str) ? 0 : str;
  if (!str) return 0;
  const s = str.trim().replace(',', '.');

  // Регулярное выражение для чисел с инженерными суффиксами
  const match = s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Zа-яА-ЯµμΩ]*)/);
  if (!match) {
    const directNum = parseFloat(s);
    return isNaN(directNum) ? 0 : directNum;
  }

  const base = parseFloat(match[1]);
  if (isNaN(base)) return 0;

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
      return base;
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
  if (type === 'RS_FF' || type === 'D_FF' || type === 'JK_FF' || type === 'TR3') return ['1', '2', '3', '4'];
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

/** Legacy nonlinear equations describe only the topology of the bundled examples. */
export function matchesSpecializedExample(elements: CircuitElement[], wires: CircuitWire[]): boolean {
  const electrical = elements.filter(e => e.type !== 'JUNCTION' && e.type !== 'TEXT');
  if (electrical.some(e => e.isolation) || new Set(electrical.map(e => e.name)).size !== electrical.length) return false;
  const actualByName = new Map(electrical.map(e => [e.name, e]));
  const actualGraph = buildCircuitGraph(elements, wires).pinToNode;
  for (const sample of SAMPLE_CIRCUITS.filter(s => !s.elements.every(e => linearTypes.has(e.type)))) {
    const reference = sample.elements.filter(e => e.type !== 'JUNCTION' && e.type !== 'TEXT');
    if (reference.length !== electrical.length) continue;
    if (!reference.every(e => actualByName.get(e.name)?.type === e.type &&
      (actualByName.get(e.name)?.portName ?? '') === (e.portName ?? ''))) continue;
    const referenceGraph = buildCircuitGraph(sample.elements, sample.wires).pinToNode;
    const pins = reference.flatMap(e => getCircuitPinIds(e.type).map(pin => ({ name: e.name, referenceKey: `${e.id}_${pin}`, actualKey: `${actualByName.get(e.name)!.id}_${pin}` })));
    if (pins.some(pin => referenceGraph.get(pin.referenceKey) === undefined || actualGraph.get(pin.actualKey) === undefined)) continue;
    if (pins.some(pin => (referenceGraph.get(pin.referenceKey) === 0) !== (actualGraph.get(pin.actualKey) === 0))) continue;
    if (pins.every((pin, i) => pins.slice(i + 1).every(other =>
      (referenceGraph.get(pin.referenceKey) === referenceGraph.get(other.referenceKey)) ===
      (actualGraph.get(pin.actualKey) === actualGraph.get(other.actualKey))))) return true;
  }
  return false;
}

/**
 * Численный расчет переходного процесса схемы
 */
export function solveCircuitTransient(
  elements: CircuitElement[],
  wires: CircuitWire[],
  settings: TransientSettings
): CircuitSimulationResults {
  if (isLinearCircuit(elements)) return solveLinearTransient(elements, wires, settings);
  if (!matchesSpecializedExample(elements, wires)) {
    throw new Error('Для такой нелинейной схемы расчёт по её соединениям пока не реализован. Доступны линейные цепи и учебные модели схем из меню «Примеры» с исходной топологией.');
  }
  const startTime = performance.now();
  const graph = buildCircuitGraph(elements, wires);

  // Параметры времени
  const tMax = Math.max(1e-6, settings.tMax);
  const dt = Math.max(1e-7, Math.min(tMax / 50, settings.step || tMax / 500));
  const numSteps = Math.min(2500, Math.max(100, Math.round(tMax / dt)));
  const actualDt = tMax / numSteps;

  const timeArr: number[] = new Array(numSteps);
  for (let i = 0; i < numSteps; i++) {
    timeArr[i] = i * actualDt;
  }

  // Обнаружение компонентов в схеме
  const activeElements = elements.filter(e => !e.isolation);
  const sources = activeElements.filter(
    (e) => e.type === 'V_DC' || e.type === 'V_AC' || e.type === 'V_PULSE'
  );
  const currentSources = activeElements.filter((e) => e.type === 'I_DC');
  const resistors = activeElements.filter((e) => e.type === 'R');
  const capacitors = activeElements.filter((e) => e.type === 'C');
  const inductors = activeElements.filter((e) => e.type === 'L');
  const diodes = activeElements.filter((e) => e.type === 'DIODE');
  const thyristors = activeElements.filter((e) => e.type === 'THYRISTOR');
  const switches = activeElements.filter((e) => e.type === 'SWITCH');
  const opamps = activeElements.filter((e) => e.type === 'OPAMP');
  const comparators = activeElements.filter((e) => e.type === 'COMPARATOR');

  // Состояние реактивных элементов
  const capVoltages: Record<string, number> = {};
  for (const c of capacitors) {
    capVoltages[c.id] = c.initialCondition || 0;
  }
  const indCurrents: Record<string, number> = {};
  for (const ind of inductors) {
    indCurrents[ind.id] = ind.initialCondition || 0;
  }

  // Массивы для записи сигналов во времени
  const nodeVoltages: Record<string, number[]> = {};
  for (const [name] of graph.namedNodes) {
    nodeVoltages[name] = new Array(numSteps).fill(0);
  }
  for (let n = 0; n < graph.nodeCount; n++) {
    nodeVoltages[`node_${n}`] = new Array(numSteps).fill(0);
  }

  const branchCurrents: Record<string, number[]> = {};
  const elemVoltages: Record<string, number[]> = {};
  for (const el of elements) {
    branchCurrents[el.name] = new Array(numSteps).fill(0);
    elemVoltages[el.name] = new Array(numSteps).fill(0);
  }

  // Вспомогательная функция вычисления мгновенного напряжения источника
  function getSourceVoltage(src: CircuitElement, t: number): number {
    const v0 = src.value || 0;
    const f = src.secondaryValue || 50;
    if (src.type === 'V_DC') {
      return v0;
    } else if (src.type === 'V_AC') {
      return v0 * Math.sin(2 * Math.PI * f * t);
    } else if (src.type === 'V_PULSE') {
      const period = 1 / Math.max(1, f);
      const phase = (t % period) / period;
      const duty = src.initialCondition !== undefined && src.initialCondition > 0
        ? src.initialCondition
        : 0.5;
      return pulseIsHigh(t, period, duty) ? v0 : 0;
    }
    return 0;
  }

  // Определение специальной топологии для высокоточного расчета (RC, RLC, OpAmp, Rectifier, Buck)
  const isBuckConverter = elements.some(
    (e) => e.type === 'SWITCH' || (e.type === 'V_PULSE' && inductors.length > 0 && diodes.length > 0)
  );
  const isOpAmpCircuit = opamps.length > 0;
  const isRectifier = diodes.length >= 2 && sources.some((s) => s.type === 'V_AC');

  const derivation: NonNullable<CircuitSimulationResults['derivation']> = {
    method: isRectifier ? 'Выпрямитель: заряд и экспоненциальный разряд' : isBuckConverter ? 'Понижающий преобразователь: явный метод Эйлера' : isOpAmpCircuit ? 'Инвертирующий усилитель с ограничением выхода' : 'Агрегированная модель цепи',
    notes: [
      'Это разбор фактического алгоритма построения графика. Модель выбирается по составу компонентов; все соединения схемы в ней не учитываются.',
      'Состояние обновляется на шаг h перед записью точки с меткой t[k]. Первая записанная точка уже содержит одно обновление начальных условий.',
      'Нулевой ряд без уравнения означает отсутствие расчёта величины в этой модели, а не доказанный нулевой ток или потенциал.',
    ], steps: [], signalSources: {},
  };
  const fmt = (v: number) => Number.isFinite(v) ? String(Number(v.toPrecision(10))) : String(v);

  // Моделирование каждого шага времени
  for (let k = 0; k < numSteps; k++) {
    const t = timeArr[k];
    const rows: import('../types').CalculationStep[] = [];
    derivation.steps.push(rows);
    const explain = (name: string, formula: string, substitution: string, value: number, unit: string) => rows.push({ name, formula, substitution, value, unit });

    // Оценка входных источников
    let vInVal = 0;
    if (sources.length > 0) {
      vInVal = getSourceVoltage(sources[0], t);
      const src = sources[0], f = src.secondaryValue || 50;
      const duty = src.initialCondition !== undefined && src.initialCondition > 0 ? src.initialCondition : 0.5;
      explain(`u_in (${src.name})`, src.type === 'V_AC' ? 'u_in = A sin(2πft)' : src.type === 'V_PULSE' ? 'u_in = A при frac(t/T) < D; иначе 0, T=1/max(1,f)' : 'u_in = U_DC', src.type === 'V_AC' ? `${fmt(src.value)} × sin(2π × ${fmt(f)} × ${fmt(t)})` : src.type === 'V_PULSE' ? `A=${fmt(src.value)}, f=${fmt(f)}, D=${fmt(duty)}, t=${fmt(t)}` : fmt(src.value), vInVal, 'В');
    }

    if (isRectifier) {
      // Модель выпрямителя с нагрузкой R-L-C
      const rVal = resistors.length > 0 ? resistors[0].value : 10;
      const lVal = inductors.length > 0 ? inductors[0].value : 0.01;
      const cVal = capacitors.length > 0 ? capacitors[0].value : 100e-6;

      const uRectRaw = Math.abs(vInVal) - 1.4; // падение на 2 диодах
      const uRect = Math.max(0, uRectRaw);

      // Дифференциальное уравнение сглаживания
      const cId = capacitors[0]?.id || 'c0';
      const prevUc = capVoltages[cId] || 0;
      const tau = rVal * Math.max(1e-6, cVal);
      let nextUc = prevUc;
      if (uRect > prevUc) {
        // заряд емкости
        nextUc = prevUc + (uRect - prevUc) * Math.min(1, actualDt / (0.0001));
      } else {
        // разряд на сопротивление нагрузки
        nextUc = prevUc * Math.exp(-actualDt / tau);
      }
      capVoltages[cId] = nextUc;

      const iLoad = nextUc / Math.max(0.1, rVal);
      const iKey = vInVal > 0.7 ? iLoad : 0;
      explain('u_rect', 'u_rect = max(0, |u_in| − 2 × 0.7)', `max(0, |${fmt(vInVal)}| − 1.4)`, uRect, 'В');
      explain('τ', 'τ = R × max(10⁻⁶, C)', `${fmt(rVal)} × max(10⁻⁶, ${fmt(cVal)})`, tau, 'с');
      explain('u_C', uRect > prevUc ? 'u_C = u_C,prev + (u_rect − u_C,prev) min(1, h/10⁻⁴)' : 'u_C = u_C,prev exp(−h/τ)', uRect > prevUc ? `${fmt(prevUc)} + (${fmt(uRect)} − ${fmt(prevUc)}) × min(1, ${fmt(actualDt)}/0.0001)` : `${fmt(prevUc)} × exp(−${fmt(actualDt)}/${fmt(tau)})`, nextUc, 'В');
      explain('i_load', 'i_load = u_C / max(0.1, R)', `${fmt(nextUc)} / max(0.1, ${fmt(rVal)})`, iLoad, 'А');
      explain('i_diode', 'i_diode = i_load при u_in > 0.7; иначе 0', `${fmt(vInVal)} > 0.7 ? ${fmt(iLoad)} : 0`, iKey, 'А');

      // Запись
      if (nodeVoltages['IN']) nodeVoltages['IN'][k] = vInVal;
      if (nodeVoltages['OUT']) nodeVoltages['OUT'][k] = nextUc;
      if (sources[0]) elemVoltages[sources[0].name][k] = vInVal;
      if (resistors[0]) {
        elemVoltages[resistors[0].name][k] = nextUc;
        branchCurrents[resistors[0].name][k] = iLoad;
      }
      if (diodes[0]) {
        elemVoltages[diodes[0].name][k] = vInVal > 0 ? 0.7 : -vInVal;
        branchCurrents[diodes[0].name][k] = iKey;
      }
    } else if (isBuckConverter) {
      // Импульсный понижающий преобразователь (Buck) со сглаживанием LC
      const uInDc = sources.find((s) => s.type === 'V_DC')?.value || 100;
      const pulseSrc = sources.find((s) => s.type === 'V_PULSE');
      const swFreq = pulseSrc?.secondaryValue || pulseSrc?.value || 100000;
      const period = 1 / Math.max(10, swFreq);
      const duty = 0.5;
      const isSwitchOn = pulseIsHigh(t, period, duty);

      const rLoad = elements.find((e) => e.name === 'R3')?.value || resistors[resistors.length - 1]?.value || 10;
      const rEsr = elements.find((e) => e.name === 'R1')?.value || 0.01;
      const lVal = inductors[0]?.value || 100e-6;
      const cVal = capacitors[0]?.value || 100e-6;

      const lId = inductors[0]?.id || 'l0';
      const cId = capacitors[0]?.id || 'c0';
      let iL = indCurrents[lId] || 0;
      let uC = capVoltages[cId] || 0;

      // Узел 4 (полумост): коммутируется между U1 (100В) и 0В
      const vNodeSw = isSwitchOn ? uInDc : 0;
      const vGate1 = isSwitchOn ? 10 : 0;
      const vGate2 = !isSwitchOn ? 10 : 0;

      // Явный метод Эйлера для дросселя и конденсатора
      // L * diL/dt = vNodeSw - uC - iL * rEsr
      // C * duC/dt = iL - uC / rLoad
      const diL = ((vNodeSw - uC - iL * rEsr) / lVal) * actualDt;
      const duC = ((iL - uC / rLoad) / cVal) * actualDt;
      explain('u_sw', 'u_sw = U_DC при frac(t/T) < 0.5; иначе 0', `U_DC=${fmt(uInDc)}, T=${fmt(period)}, t=${fmt(t)}, D=0.5`, vNodeSw, 'В');
      explain('Δi_L', 'Δi_L = (u_sw − u_C,prev − i_L,prev R_esr) h / L', `(${fmt(vNodeSw)} − ${fmt(uC)} − ${fmt(iL)} × ${fmt(rEsr)}) × ${fmt(actualDt)} / ${fmt(lVal)}`, diL, 'А');
      explain('Δu_C', 'Δu_C = (i_L,prev − u_C,prev/R_load) h / C', `(${fmt(iL)} − ${fmt(uC)}/${fmt(rLoad)}) × ${fmt(actualDt)} / ${fmt(cVal)}`, duC, 'В');
      explain('i_L', 'i_L = max(0, i_L,prev + Δi_L)', `max(0, ${fmt(iL)} + ${fmt(diL)})`, Math.max(0, iL + diL), 'А');
      explain('u_C', 'u_C = max(0, u_C,prev + Δu_C)', `max(0, ${fmt(uC)} + ${fmt(duC)})`, Math.max(0, uC + duC), 'В');

      iL = Math.max(0, iL + diL); // сглаженный ток дросселя
      uC = Math.max(0, uC + duC);

      indCurrents[lId] = iL;
      capVoltages[cId] = uC;

      // Привязка узловых потенциалов к номерам узлов со скриншота [5], [6], [4], [1], [2], [3], [7]
      const vNode5 = uInDc;
      const vNode6 = vGate1;
      const vNode7 = vGate2;
      const vNode4 = vNodeSw;
      const vNode1 = vNode4 - iL * rEsr;
      const vNode2 = uC;
      const vNode3 = iL * 0.01;
      explain('i_load', 'i_load = u_C/R_load', `${fmt(uC)}/${fmt(rLoad)}`, uC / rLoad, 'А');
      explain('u_esr', 'u_esr = i_L R_esr', `${fmt(iL)} × ${fmt(rEsr)}`, iL * rEsr, 'В');
      explain('u_sense', 'u_sense = i_L × 0.01', `${fmt(iL)} × 0.01`, vNode3, 'В');
      explain('u_L', 'u_L = u_sw − i_L R_esr − u_C', `${fmt(vNodeSw)} − ${fmt(iL)} × ${fmt(rEsr)} − ${fmt(uC)}`, vNode1 - vNode2, 'В');

      // Запись по числовым номерам узлов
      nodeVoltages['5'] = nodeVoltages['5'] || new Array(numSteps).fill(0);
      nodeVoltages['6'] = nodeVoltages['6'] || new Array(numSteps).fill(0);
      nodeVoltages['7'] = nodeVoltages['7'] || new Array(numSteps).fill(0);
      nodeVoltages['4'] = nodeVoltages['4'] || new Array(numSteps).fill(0);
      nodeVoltages['1'] = nodeVoltages['1'] || new Array(numSteps).fill(0);
      nodeVoltages['2'] = nodeVoltages['2'] || new Array(numSteps).fill(0);
      nodeVoltages['3'] = nodeVoltages['3'] || new Array(numSteps).fill(0);

      nodeVoltages['5'][k] = vNode5;
      nodeVoltages['6'][k] = vNode6;
      nodeVoltages['7'][k] = vNode7;
      nodeVoltages['4'][k] = vNode4;
      nodeVoltages['1'][k] = vNode1;
      nodeVoltages['2'][k] = vNode2;
      nodeVoltages['3'][k] = vNode3;

      if (nodeVoltages['IN']) nodeVoltages['IN'][k] = uInDc;
      if (nodeVoltages['OUT']) nodeVoltages['OUT'][k] = uC;
      if (nodeVoltages['SW']) nodeVoltages['SW'][k] = vNodeSw;

      // Ветви
      if (inductors[0]) {
        elemVoltages[inductors[0].name][k] = vNode1 - vNode2;
        branchCurrents[inductors[0].name][k] = iL;
      }
      for (const r of resistors) {
        if (r.name === 'R1') {
          elemVoltages[r.name][k] = iL * rEsr;
          branchCurrents[r.name][k] = iL;
        } else if (r.name === 'R2') {
          elemVoltages[r.name][k] = vNode3;
          branchCurrents[r.name][k] = iL;
        } else if (r.name === 'R3') {
          elemVoltages[r.name][k] = uC;
          branchCurrents[r.name][k] = uC / rLoad;
        } else {
          elemVoltages[r.name][k] = uC;
          branchCurrents[r.name][k] = uC / rLoad;
        }
      }
      for (const sw of switches) {
        if (sw.name === 'VCK1') {
          branchCurrents[sw.name][k] = isSwitchOn ? iL : 0;
          elemVoltages[sw.name][k] = isSwitchOn ? 0 : uInDc;
        } else if (sw.name === 'VCK2') {
          branchCurrents[sw.name][k] = !isSwitchOn ? iL : 0;
          elemVoltages[sw.name][k] = !isSwitchOn ? 0 : vNode4;
        }
      }
    } else if (isOpAmpCircuit) {
      // Операционный усилитель (инвертирующий / неинвертирующий)
      const rIn = resistors[0]?.value || 1000;
      const rFb = resistors[1]?.value || 10000;
      const gain = -rFb / rIn; // инвертирующий
      const vOut = Math.max(-15, Math.min(15, vInVal * gain));
      explain('K', 'K = −R_fb/R_in', `−${fmt(rFb)}/${fmt(rIn)}`, gain, '');
      explain('u_out', 'u_out = max(−15, min(15, K u_in))', `max(−15, min(15, ${fmt(gain)} × ${fmt(vInVal)}))`, vOut, 'В');
      explain('i_in', 'i_in = u_in/R_in', `${fmt(vInVal)}/${fmt(rIn)}`, vInVal / rIn, 'А');
      explain('i_fb', 'i_fb = −u_out/R_fb', `−${fmt(vOut)}/${fmt(rFb)}`, -vOut / rFb, 'А');
      explain('i_op', 'i_op = u_out/R_fb', `${fmt(vOut)}/${fmt(rFb)}`, vOut / (rFb || 1000), 'А');

      if (nodeVoltages['IN']) nodeVoltages['IN'][k] = vInVal;
      if (nodeVoltages['OUT']) nodeVoltages['OUT'][k] = vOut;

      if (resistors[0]) {
        elemVoltages[resistors[0].name][k] = vInVal;
        branchCurrents[resistors[0].name][k] = vInVal / rIn;
      }
      if (resistors[1]) {
        elemVoltages[resistors[1].name][k] = -vOut;
        branchCurrents[resistors[1].name][k] = -vOut / rFb;
      }
      if (opamps[0]) {
        elemVoltages[opamps[0].name][k] = vOut;
        branchCurrents[opamps[0].name][k] = vOut / (rFb || 1000);
      }
    } else {
      // Универсальный решатель цепи (RC / RLC / резистивный делитель)
      const rTotal = resistors.reduce((sum, r) => sum + r.value, 0) || 1000;
      const cTotal = capacitors.reduce((sum, c) => sum + c.value, 0) || 1e-6;
      const lTotal = inductors.reduce((sum, l) => sum + l.value, 0) || 0;

      if (capacitors.length > 0 && inductors.length > 0) {
        // RLC колебательный контур
        const lId = inductors[0].id;
        const cId = capacitors[0].id;
        let iL = indCurrents[lId] || 0;
        let uC = capVoltages[cId] || 0;

        const diL = ((vInVal - uC - iL * rTotal) / lTotal) * actualDt;
        const duC = (iL / cTotal) * actualDt;
        explain('Δi_L', 'Δi_L = (u_in − u_C,prev − i_L,prev RΣ) h/LΣ', `(${fmt(vInVal)} − ${fmt(uC)} − ${fmt(iL)} × ${fmt(rTotal)}) × ${fmt(actualDt)}/${fmt(lTotal)}`, diL, 'А');
        explain('Δu_C', 'Δu_C = i_L,prev h/CΣ', `${fmt(iL)} × ${fmt(actualDt)}/${fmt(cTotal)}`, duC, 'В');
        explain('i_L', 'i_L = i_L,prev + Δi_L', `${fmt(iL)} + ${fmt(diL)}`, iL + diL, 'А');
        explain('u_C', 'u_C = u_C,prev + Δu_C', `${fmt(uC)} + ${fmt(duC)}`, uC + duC, 'В');

        iL += diL;
        uC += duC;
        indCurrents[lId] = iL;
        capVoltages[cId] = uC;

        if (nodeVoltages['IN']) nodeVoltages['IN'][k] = vInVal;
        if (nodeVoltages['OUT']) nodeVoltages['OUT'][k] = uC;
        if (resistors[0]) branchCurrents[resistors[0].name][k] = iL;
        if (capacitors[0]) elemVoltages[capacitors[0].name][k] = uC;
        if (inductors[0]) elemVoltages[inductors[0].name][k] = vInVal - uC - iL * rTotal;
      } else if (capacitors.length > 0) {
        // RC ФНЧ
        const cId = capacitors[0].id;
        const prevUc = capVoltages[cId] || 0;
        const tau = Math.max(1e-8, rTotal * cTotal);
        const nextUc = prevUc + (vInVal - prevUc) * (1 - Math.exp(-actualDt / tau));
        capVoltages[cId] = nextUc;

        const iR = (vInVal - nextUc) / rTotal;
        explain('τ', 'τ = max(10⁻⁸, RΣ CΣ)', `max(10⁻⁸, ${fmt(rTotal)} × ${fmt(cTotal)})`, tau, 'с');
        explain('u_C', 'u_C = u_C,prev + (u_in − u_C,prev)(1 − exp(−h/τ))', `${fmt(prevUc)} + (${fmt(vInVal)} − ${fmt(prevUc)}) × (1 − exp(−${fmt(actualDt)}/${fmt(tau)}))`, nextUc, 'В');
        explain('i_R', 'i_R = (u_in − u_C)/RΣ', `(${fmt(vInVal)} − ${fmt(nextUc)})/${fmt(rTotal)}`, iR, 'А');
        if (nodeVoltages['IN']) nodeVoltages['IN'][k] = vInVal;
        if (nodeVoltages['OUT']) nodeVoltages['OUT'][k] = nextUc;
        if (resistors[0]) {
          elemVoltages[resistors[0].name][k] = vInVal - nextUc;
          branchCurrents[resistors[0].name][k] = iR;
        }
        if (capacitors[0]) {
          elemVoltages[capacitors[0].name][k] = nextUc;
          branchCurrents[capacitors[0].name][k] = iR;
        }
      } else {
        // Резистивный делитель
        const iTotal = vInVal / rTotal;
        explain('i_total', 'i_total = u_in/RΣ', `${fmt(vInVal)}/${fmt(rTotal)}`, iTotal, 'А');
        let currentV = vInVal;
        for (const r of resistors) {
          const vDrop = iTotal * r.value;
          explain(`U(${r.name})`, 'u_R = i_total R', `${fmt(iTotal)} × ${fmt(r.value)}`, vDrop, 'В');
          elemVoltages[r.name][k] = vDrop;
          branchCurrents[r.name][k] = iTotal;
          currentV -= vDrop;
        }
        if (nodeVoltages['IN']) nodeVoltages['IN'][k] = vInVal;
        if (nodeVoltages['OUT']) nodeVoltages['OUT'][k] = resistors[0]?.value ? vInVal * 0.5 : 0;
      }
    }

    // Если нет специального именованного порта, привяжем общие узлы
    if (!nodeVoltages['IN'] && sources[0]) {
      nodeVoltages['IN'] = elemVoltages[sources[0].name] || [];
    }
    if (!nodeVoltages['OUT']) {
      const outCandidate =
        elemVoltages[capacitors[0]?.name] ||
        elemVoltages[resistors[resistors.length - 1]?.name] ||
        nodeVoltages['IN'] ||
        [];
      nodeVoltages['OUT'] = outCandidate;
    }
  }

  // Расчёт выражений сигналов.
  const origins: Record<string, string> = {};
  const outU = (e: CircuitElement | undefined, formula: string) => { if (e) origins[`U:${e.name}`] = formula; };
  const outI = (e: CircuitElement | undefined, formula: string) => { if (e) origins[`I:${e.name}`] = formula; };
  const outNode = (name: string, formula: string) => { if (nodeVoltages[name]) origins[`N:${name}`] = formula; };
  if (isRectifier) {
    outNode('IN', 'u_in'); outNode('OUT', 'u_C'); outU(sources[0], 'u_in');
    outU(resistors[0], 'u_C'); outI(resistors[0], 'i_load');
    outU(diodes[0], '0.7 В при u_in > 0; иначе −u_in'); outI(diodes[0], 'i_diode');
  } else if (isBuckConverter) {
    for (const [key, formula] of Object.entries({ '1': 'u_sw − u_esr', '2': 'u_C', '3': 'u_sense', '4': 'u_sw', '5': 'U_DC', '6': '10 В при ключе ON; иначе 0', '7': '0 при ключе ON; иначе 10 В', IN: 'U_DC', OUT: 'u_C', SW: 'u_sw' })) outNode(key, formula);
    outU(inductors[0], 'u_L'); outI(inductors[0], 'i_L');
    for (const r of resistors) { outU(r, r.name === 'R1' ? 'u_esr' : r.name === 'R2' ? 'u_sense' : 'u_C'); outI(r, r.name === 'R1' || r.name === 'R2' ? 'i_L' : 'i_load'); }
    for (const sw of switches) {
      if (sw.name === 'VCK1') { outI(sw, 'i_L при ключе ON; иначе 0'); outU(sw, '0 при ключе ON; иначе U_DC'); }
      if (sw.name === 'VCK2') { outI(sw, '0 при ключе ON; иначе i_L'); outU(sw, 'u_sw при ключе ON; иначе 0'); }
    }
    derivation.notes.push('В этой модели D=0.5; R_sense=0.01 Ом. Числовые сигналы U(1)…U(7) назначены алгоритмом и не являются номерами топологических узлов редактора. Ограничение max(0, …) обнуляет отрицательные состояния.');
  } else if (isOpAmpCircuit) {
    outNode('IN', 'u_in'); outNode('OUT', 'u_out');
    outU(resistors[0], 'u_in'); outI(resistors[0], 'i_in');
    outU(resistors[1], '−u_out'); outI(resistors[1], 'i_fb'); outU(opamps[0], 'u_out'); outI(opamps[0], 'i_op');
    derivation.notes.push('Модель использует первый резистор как R_in, второй как R_fb; насыщение выхода задано ±15 В.');
  } else if (capacitors.length && inductors.length) {
    outNode('IN', 'u_in'); outNode('OUT', 'u_C'); outI(resistors[0], 'i_L'); outU(capacitors[0], 'u_C'); outU(inductors[0], 'u_in − u_C − i_L RΣ');
  } else if (capacitors.length) {
    outNode('IN', 'u_in'); outNode('OUT', 'u_C'); outU(resistors[0], 'u_in − u_C'); outI(resistors[0], 'i_R'); outU(capacitors[0], 'u_C'); outI(capacitors[0], 'i_R');
  } else {
    outNode('IN', 'u_in'); outNode('OUT', resistors[0]?.value ? '0.5 × u_in (фиксированное правило старой модели)' : '0');
    for (const r of resistors) { outU(r, `i_total × ${r.value}`); outI(r, 'i_total'); }
  }
  // Preserve actual alias resolution used by the legacy signal parser.
  if (!graph.namedNodes.has('IN') && sources[0]) origins['N:IN'] = origins[`U:${sources[0].name}`];
  if (!graph.namedNodes.has('OUT')) {
    const candidate = capacitors[0] ?? resistors[resistors.length - 1];
    origins['N:OUT'] = candidate ? origins[`U:${candidate.name}`] : origins['N:IN'];
  }
  const origin = (key: string) => origins[key] ?? 'Ряд инициализирован нулями: выбранная модель не вычисляет эту величину.';
  const signals: Record<string, number[]> = {};
  const stats: Record<string, { mean: number; rms: number; max: number; min: number; unit: string }> = {};

  for (const sig of settings.signals) {
    if (!sig.enabled) continue;
    const expr = sig.exprY.trim();
    derivation.signalSources[sig.exprY] = `Выражение ${expr}. Ряд без присвоения в выбранной модели остаётся нулевым.`;
    let values: number[] = new Array(numSteps).fill(0);

    // Парсинг выражений вида U(OUT), U(IN), I(R1), U(C1), P(R1)
    const matchU = expr.match(/^U\(([^)]+)\)$/i);
    const matchI = expr.match(/^I\(([^)]+)\)$/i);
    const matchP = expr.match(/^P\(([^)]+)\)$/i);

    if (matchU) {
      const target = matchU[1].trim();
      const upperTarget = target.toUpperCase();
      if (nodeVoltages[upperTarget]) {
        values = [...nodeVoltages[upperTarget]];
        derivation.signalSources[sig.exprY] = `y[k] = ${origin(`N:${upperTarget}`)}`;
      } else if (nodeVoltages[target]) {
        values = [...nodeVoltages[target]];
        derivation.signalSources[sig.exprY] = `y[k] = ${origin(`N:${target}`)}`;
      } else if (elemVoltages[target]) {
        values = [...elemVoltages[target]];
        derivation.signalSources[sig.exprY] = `y[k] = ${origin(`U:${target}`)}`;
      } else {
        // поиск по элементам
        const found = elements.find((e) => e.name.toLowerCase() === target.toLowerCase());
        if (found && elemVoltages[found.name]) {
          values = [...elemVoltages[found.name]];
          derivation.signalSources[sig.exprY] = `y[k] = ${origin(`U:${found.name}`)}`;
        }
      }
    } else if (matchI) {
      const target = matchI[1].trim();
      if (branchCurrents[target]) {
        values = [...branchCurrents[target]];
        derivation.signalSources[sig.exprY] = `y[k] = ${origin(`I:${target}`)}`;
      } else {
        const found = elements.find((e) => e.name.toLowerCase() === target.toLowerCase());
        if (found && branchCurrents[found.name]) {
          values = [...branchCurrents[found.name]];
          derivation.signalSources[sig.exprY] = `y[k] = ${origin(`I:${found.name}`)}`;
        }
      }
    } else if (matchP) {
      const target = matchP[1].trim();
      const u = elemVoltages[target] || nodeVoltages[target];
      const i = branchCurrents[target];
      if (u && i) {
        values = u.map((val, idx) => val * (i[idx] || 0));
        derivation.signalSources[sig.exprY] = `y[k] = (${origin(`U:${target}`)}) × (${origin(`I:${target}`)})`;
      }
    } else {
      // Прямое имя
      if (nodeVoltages[expr]) values = [...nodeVoltages[expr]];
      else if (branchCurrents[expr]) values = [...branchCurrents[expr]];
      else if (elemVoltages[expr]) values = [...elemVoltages[expr]];
    }

    signals[sig.exprY] = values;

    // Вычисление интегральных статистик за интервал (Раздел 3.5, 4.4 мануала)
    let sum = 0;
    let sumSq = 0;
    let maxVal = -Infinity;
    let minVal = Infinity;
    for (let j = 0; j < numSteps; j++) {
      const v = values[j] || 0;
      sum += v;
      sumSq += v * v;
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    }
    const mean = sum / numSteps;
    const rms = Math.sqrt(sumSq / numSteps);
    const unit = expr.startsWith('I(') ? 'А' : expr.startsWith('P(') ? 'Вт' : 'В';

    stats[sig.exprY] = {
      mean,
      rms,
      max: maxVal === -Infinity ? 0 : maxVal,
      min: minVal === Infinity ? 0 : minVal,
      unit,
    };
  }

  const durationMs = performance.now() - startTime;

  return {
    time: timeArr,
    signals,
    nodeVoltages,
    branchCurrents,
    elementVoltages: elemVoltages,
    derivation,
    summary: {
      durationMs,
      calculationTimeMs: durationMs,
      pointsCount: numSteps,
      stats,
    },
  };
}

/**
 * Frequency analysis is unavailable until it can solve the actual wired graph.
 * The former nominal-only Bode curve gave the same result for disconnected circuits.
 */
export function solveCircuitAC(
  _elements: CircuitElement[],
  _wires: CircuitWire[],
  _settings: {
    fMin: number;
    fMax: number;
    points: number;
    scaleType: 'log' | 'linear';
    signals: Array<{ id: string; plotIndex: 1 | 2; exprY: string; color: string; enabled: boolean }>;
  }
): CircuitSimulationResults {
  throw new Error('Частотный анализ по реальным соединениям пока не реализован. График АЧХ/ФЧХ не построен.');
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
