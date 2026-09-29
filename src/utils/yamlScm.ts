import { CircuitElement, CircuitWire, TransientSettings, ACSettings } from '../types';
import { getCircuitPinIds, parseEngValue } from '../math/circuitSolver';

/**
 * ТЗ Секция 5: Формат файла проекта YAML (.scm)
 * Сериализация и парсинг формата SCM, используемого NAPS.
 */

export interface YamlScmObject {
  ID: number;
  Type: string;
  Name: string;
  X: number;
  Y: number;
  Rot: number;
  FlipH?: boolean;
  FlipV?: boolean;
  Params: Record<string, string>;
}

export interface YamlScmWire {
  From: { ID: number; Pin: string | number };
  To: { ID: number; Pin: string | number };
  Waypoints?: Array<{ x: number; y: number }>;
  Manual?: boolean;
}

export interface YamlScmAnalysis {
  Transient?: {
    EndTime: string;
    TimeStep: string;
    EPS: string;
    ICTransfer?: boolean;
    Expressions: Array<{ Plot: number; X: string; Y: string; Color?: string }>;
  };
  AC?: {
    FMin: string;
    FMax: string;
    Points: number;
    Scale: string;
    Expressions: Array<{ Plot: number; X: string; Y: string; Color?: string }>;
  };
}

export interface YamlScmProject {
  scm: {
    MajorVersion: number;
    MinorVersion: number;
  };
  Objects: YamlScmObject[];
  Wires: YamlScmWire[];
  Analysis: YamlScmAnalysis;
}

/**
 * Преобразование внутренней модели элементов САПР в структуру YAML проекта .scm
 */
export function exportToYamlScm(
  elements: CircuitElement[],
  wires: CircuitWire[],
  transient: TransientSettings,
  ac?: ACSettings
): string {
  // Карта строковых ID в числовые индексы ID (1, 2, 3...)
  const idMap = new Map<string, number>();
  elements.forEach((el, idx) => {
    idMap.set(el.id, idx + 1);
  });

  const objects: YamlScmObject[] = elements.map((el, idx) => {
    const params: Record<string, string> = {};
    if (el.type === 'R') params['R'] = el.valueStr || `${el.value}`;
    else if (el.type === 'L') params['L'] = el.valueStr || `${el.value}`;
    else if (el.type === 'C') {
      params['C'] = el.valueStr || `${el.value}`;
      if (el.initialCondition !== undefined) params['IC'] = String(el.initialCondition);
    } else if (el.type === 'V_DC') params['U'] = el.valueStr || `${el.value}`;
    else if (el.type === 'V_AC') {
      params['U'] = el.valueStr || `${el.value}`;
      params['f'] = el.secondaryStr || `${el.secondaryValue || 50} Гц`;
    } else if (el.type === 'V_PULSE') {
      params['U'] = el.valueStr || `${el.value}`;
      params['f'] = el.secondaryStr || `${el.secondaryValue || 100000} Гц`;
      params['Duty'] = '50%';
    } else if (el.type === 'SWITCH') {
      params['Type'] = 'VCK';
      params['Ron'] = '10m';
    } else if (el.type === 'DIODE') params['V0'] = '0.7';
    else if (el.type === 'THYRISTOR') params['Alpha'] = '30';
    else if (el.type === 'PORT') params['Label'] = el.portName || el.name;
    else if (el.type === 'TEXT') params['Directive'] = el.textDirective || '';

    // Preserve numeric values independently of human-readable labels.
    params['Value'] = String(el.value);
    params['ValueText'] = el.valueStr;
    params['Unit'] = el.unit;
    if (el.isolation) params['Isolation'] = el.isolation;
    if (el.secondaryValue !== undefined) params['SecondaryValue'] = String(el.secondaryValue);
    if (el.secondaryStr !== undefined) params['SecondaryText'] = el.secondaryStr;
    if (el.initialCondition !== undefined) params['IC'] = String(el.initialCondition);
    for (const [key, value] of Object.entries(el.modelParams ?? {})) {
      if (value !== undefined) params[`Model_${key}`] = String(value);
    }

    return {
      ID: idx + 1,
      Type: mapTypeToYaml(el.type),
      Name: el.name,
      X: el.x,
      Y: el.y,
      Rot: (el.rotation || 0) / 90,
      FlipH: el.flipH,
      FlipV: el.flipV,
      Params: params,
    };
  });

  const scmWires: YamlScmWire[] = [];
  for (const w of wires) {
    const fromId = idMap.get(w.fromCompId);
    const toId = idMap.get(w.toCompId);
    const from = elements.find(el => el.id === w.fromCompId);
    const to = elements.find(el => el.id === w.toCompId);
    if (!fromId || !toId || !from || !to ||
        !getCircuitPinIds(from.type).includes(w.fromPinId) ||
        !getCircuitPinIds(to.type).includes(w.toPinId)) {
      throw new Error(`Провод ${w.id}: указан отсутствующий элемент или вывод. Схема не сохранена.`);
    }
    scmWires.push({
      From: { ID: fromId, Pin: isNaN(Number(w.fromPinId)) ? w.fromPinId : Number(w.fromPinId) },
      To: { ID: toId, Pin: isNaN(Number(w.toPinId)) ? w.toPinId : Number(w.toPinId) },
      Waypoints: w.waypoints,
      Manual: w.manual,
    });
  }

  // Сборка текста в чистом YAML
  let yaml = `scm:\n  MajorVersion: 6\n  MinorVersion: 0\n\nObjects:\n`;
  for (const obj of objects) {
    yaml += `  - ID: ${obj.ID}\n`;
    yaml += `    Type: "${obj.Type}"\n`;
    yaml += `    Name: ${JSON.stringify(obj.Name)}\n`;
    yaml += `    X: ${obj.X}\n`;
    yaml += `    Y: ${obj.Y}\n`;
    yaml += `    Rot: ${obj.Rot}\n`;
    if (obj.FlipH) yaml += `    FlipH: true\n`;
    if (obj.FlipV) yaml += `    FlipV: true\n`;
    yaml += `    Params:\n`;
    for (const [pk, pv] of Object.entries(obj.Params)) {
      yaml += `      ${pk}: ${JSON.stringify(pv)}\n`;
    }
  }

  yaml += `\nWires:\n`;
  for (const w of scmWires) {
    yaml += `  - From: { ID: ${w.From.ID}, Pin: ${JSON.stringify(w.From.Pin)} }\n`;
    yaml += `    To:   { ID: ${w.To.ID}, Pin: ${JSON.stringify(w.To.Pin)} }\n`;
    if (w.Waypoints) yaml += `    Waypoints: ${JSON.stringify(w.Waypoints)}\n`;
    if (w.Manual) yaml += `    Manual: true\n`;
  }

  yaml += `\nAnalysis:\n  Transient:\n`;
  yaml += `    EndTime: "${transient.tMaxStr}"\n`;
  yaml += `    TimeStep: "${transient.stepStr}"\n`;
  yaml += `    EPS: "${transient.eps || '1m'}"\n`;
  if (transient.initialConditionTransfer) {
    yaml += `    ICTransfer: true\n`;
  }
  yaml += `    Expressions:\n`;
  for (const sig of transient.signals) {
    yaml += `      - { Plot: ${sig.plotIndex}, X: ${JSON.stringify(sig.exprX)}, Y: ${JSON.stringify(sig.exprY)}, Color: ${JSON.stringify(sig.color)}, Enabled: ${sig.enabled} }\n`;
  }

  if (ac) {
    yaml += `  AC:\n`;
    yaml += `    FMin: "${ac.fMinStr || ac.fMin}"\n`;
    yaml += `    FMax: "${ac.fMaxStr || ac.fMax}"\n`;
    yaml += `    Points: ${ac.points}\n`;
    yaml += `    Scale: "${ac.scaleType}"\n`;
    yaml += `    Expressions:\n`;
    for (const sig of ac.signals) {
      yaml += `      - { Plot: ${sig.plotIndex}, X: ${JSON.stringify(sig.exprX)}, Y: ${JSON.stringify(sig.exprY)}, Color: ${JSON.stringify(sig.color)}, Enabled: ${sig.enabled} }\n`;
    }
  }

  return yaml;
}

function mapTypeToYaml(type: string): string {
  switch (type) {
    case 'R': return 'Resistor';
    case 'L': return 'Inductor';
    case 'C': return 'Capacitor';
    case 'DIODE': return 'Diode';
    case 'THYRISTOR': return 'Thyristor';
    case 'SWITCH': return 'Switch';
    case 'V_DC': return 'DC_Voltage';
    case 'V_AC': return 'AC_Voltage';
    case 'V_PULSE': return 'Pulse_Generator';
    case 'I_DC': return 'DC_Current';
    case 'OPAMP': return 'OpAmp';
    case 'COMPARATOR': return 'Comparator';
    case 'NOT': return 'NOT';
    case 'AND': return 'AND';
    case 'OR': return 'OR';
    case 'XOR': return 'XOR';
    case 'RS_FF': return 'RS_FlipFlop';
    case 'D_FF': return 'D_FlipFlop';
    case 'JK_FF': return 'JK_FlipFlop';
    case 'GND': return 'GND';
    case 'PORT': return 'Port';
    case 'TR3': return 'Transformer';
    case 'TEXT': return 'Directive';
    default: return type;
  }
}

function mapYamlToType(type: string): CircuitElement['type'] {
  const t = type.toLowerCase();
  if (t.includes('resistor') || t === 'r') return 'R';
  if (t.includes('inductor') || t === 'l') return 'L';
  if (t.includes('capacitor') || t === 'c') return 'C';
  if (t.includes('diode') || t === 'vd') return 'DIODE';
  if (t.includes('thyristor') || t === 'vs') return 'THYRISTOR';
  if (t.includes('switch') || t.includes('vck')) return 'SWITCH';
  if (t.includes('dc_voltage') || t === 'v_dc' || t === 'udc') return 'V_DC';
  if (t.includes('ac_voltage') || t === 'v_ac' || t === 'uac') return 'V_AC';
  if (t.includes('pulse') || t.includes('pwm') || t === 'v_pulse') return 'V_PULSE';
  if (t.includes('current') || t === 'i_dc') return 'I_DC';
  if (t.includes('opamp') || t.includes('оу')) return 'OPAMP';
  if (t.includes('comparator')) return 'COMPARATOR';
  if (t === 'not' || t.includes('инвертор')) return 'NOT';
  if (t === 'and') return 'AND';
  if (t === 'or') return 'OR';
  if (t === 'xor') return 'XOR';
  if (t === 'junction') return 'JUNCTION';
  if (t.includes('rs')) return 'RS_FF';
  if (t.includes('d_ff') || t === 'd_flipflop' || t === 'd') return 'D_FF';
  if (t.includes('jk')) return 'JK_FF';
  if (t === 'gnd' || t.includes('земля')) return 'GND';
  if (t === 'port') return 'PORT';
  if (t.includes('trans') || t === 'tr3') return 'TR3';
  if (t === 'directive' || t === 'text') return 'TEXT';
  throw new Error(`Неизвестный тип элемента SCM: ${type}.`);
}

function finiteScmNumber(value: string | number, label: string): number {
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    throw new Error(`${label}: ожидается конечное число.`);
  }
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`${label}: ожидается конечное число.`);
  return number;
}

/**
 * Простой парсер YAML .scm файлов без внешних тяжелых зависимостей
 */
export function parseYamlScm(yamlText: string): {
  elements: CircuitElement[];
  wires: CircuitWire[];
  transient: TransientSettings;
  ac?: ACSettings;
} {
  const lines = yamlText.split('\n');
  const elements: CircuitElement[] = [];
  const wires: CircuitWire[] = [];

  let currentSection: 'none' | 'objects' | 'wires' | 'transient' | 'ac' = 'none';
  let currentObj: Partial<YamlScmObject> | null = null;
  let pendingFrom: RegExpMatchArray | null = null;
  const numIdToElemId = new Map<number, string>();

  let tMaxStr = '10m';
  let stepStr = 'tmax/200';
  let epsStr = '1m';
  let initialConditionTransfer = false;
  let expressions: Array<{ Plot: number; X: string; Y: string; Color?: string; Enabled?: boolean }> = [];
  let hasAc = false;
  let fMinStr = '10', fMaxStr = '100k', acPoints = 101;
  let acScale: ACSettings['scaleType'] = 'log';
  const acExpressions: Array<{ Plot: number; X: string; Y: string; Color?: string; Enabled?: boolean }> = [];
  const readScalar = (text: string): string => {
    const value = text.trim();
    return value.startsWith('"') ? JSON.parse(value) : value;
  };

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === 'AC:') {
      hasAc = true;
      currentSection = 'ac';
      continue;
    }
    if (trimmed === 'Objects:') {
      currentSection = 'objects';
      continue;
    } else if (trimmed === 'Wires:') {
      if (currentObj && currentObj.ID) {
        commitCurrentObject(currentObj, elements, numIdToElemId);
        currentObj = null;
      }
      currentSection = 'wires';
      continue;
    } else if (trimmed === 'Analysis:' || trimmed === 'Transient:') {
      if (currentObj && currentObj.ID) {
        commitCurrentObject(currentObj, elements, numIdToElemId);
        currentObj = null;
      }
      currentSection = 'transient';
      continue;
    }

    if (currentSection === 'objects') {
      if (trimmed.startsWith('- ID:')) {
        if (currentObj && currentObj.ID) {
          commitCurrentObject(currentObj, elements, numIdToElemId);
        }
        currentObj = {
          ID: finiteScmNumber(trimmed.replace('- ID:', ''), 'ID элемента'),
          Params: {},
        };
      } else if (currentObj) {
        if (trimmed.startsWith('Type:')) {
          currentObj.Type = trimmed.replace('Type:', '').replace(/"/g, '').trim();
        } else if (trimmed.startsWith('Name:')) {
          currentObj.Name = readScalar(trimmed.slice('Name:'.length));
        } else if (trimmed.startsWith('X:')) {
          currentObj.X = finiteScmNumber(trimmed.slice(2), `X элемента ${currentObj.ID}`);
        } else if (trimmed.startsWith('Y:')) {
          currentObj.Y = finiteScmNumber(trimmed.slice(2), `Y элемента ${currentObj.ID}`);
        } else if (trimmed.startsWith('Rot:')) {
          currentObj.Rot = finiteScmNumber(trimmed.slice(4), `Rot элемента ${currentObj.ID}`);
        } else if (trimmed.startsWith('FlipH:')) {
          currentObj.FlipH = trimmed.includes('true');
        } else if (trimmed.startsWith('FlipV:')) {
          currentObj.FlipV = trimmed.includes('true');
        } else if (trimmed.includes(':') && !trimmed.startsWith('Params:')) {
          const separator = trimmed.indexOf(':');
          const pk = trimmed.slice(0, separator);
          const pv = trimmed.slice(separator + 1);
          if (pk && currentObj.Params) {
            currentObj.Params[pk.trim()] = readScalar(pv);
          }
        }
      }
    } else if (currentSection === 'wires') {
      if (trimmed === 'Manual: true' && wires.length) {
        wires[wires.length - 1].manual = true;
        continue;
      }
      if (trimmed.startsWith('Waypoints:') && wires.length) {
        const points = JSON.parse(trimmed.slice('Waypoints:'.length));
        if (!Array.isArray(points) || !points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('Некорректные точки провода.');
        wires[wires.length - 1].waypoints = points;
        continue;
      }
      // Пример: - From: { ID: 1, Pin: 2 }
      //           To:   { ID: 2, Pin: 1 }
      const fromMatch = trimmed.match(/From:\s*\{\s*ID:\s*(\d+),\s*Pin:\s*([^}]+)\s*\}/) || pendingFrom;
      if (trimmed.includes('From:') && pendingFrom) throw new Error(`Провод ${wires.length + 1}: отсутствует конечный вывод.`);
      pendingFrom = fromMatch;
      const toMatch = trimmed.match(/To:\s*\{\s*ID:\s*(\d+),\s*Pin:\s*([^}]+)\s*\}/);
      if (trimmed.includes('To:') && !fromMatch) throw new Error(`Провод ${wires.length + 1}: отсутствует начальный вывод.`);
      if (fromMatch && toMatch) {
        pendingFrom = null;
        const fromId = parseInt(fromMatch[1]);
        const fromPin = fromMatch[2].replace(/"/g, '').trim();
        const toId = parseInt(toMatch[1]);
        const toPin = toMatch[2].replace(/"/g, '').trim();

        const fromElemId = numIdToElemId.get(fromId);
        const toElemId = numIdToElemId.get(toId);
        const fromElement = elements.find(el => el.id === fromElemId);
        const toElement = elements.find(el => el.id === toElemId);
        if (!fromElement || !toElement ||
            !getCircuitPinIds(fromElement.type).includes(fromPin) ||
            !getCircuitPinIds(toElement.type).includes(toPin)) {
          throw new Error(`Провод ${wires.length + 1}: элемент или вывод не найден (${fromId}:${fromPin} → ${toId}:${toPin}).`);
        }
        wires.push({
          id: `w_${Date.now()}_${wires.length}`,
          fromCompId: fromElemId,
          fromPinId: fromPin,
          toCompId: toElemId,
          toPinId: toPin,
        });
      }
    } else if (currentSection === 'ac') {
      if (trimmed.startsWith('FMin:')) fMinStr = readScalar(trimmed.slice(5));
      else if (trimmed.startsWith('FMax:')) fMaxStr = readScalar(trimmed.slice(5));
      else if (trimmed.startsWith('Points:')) acPoints = finiteScmNumber(trimmed.slice(7), 'AC Points');
      else if (trimmed.startsWith('Scale:')) {
        const scale = readScalar(trimmed.slice(6));
        if (scale !== 'log' && scale !== 'linear') throw new Error('AC Scale: используйте log или linear.');
        acScale = scale;
      } else if (trimmed.includes('Plot:') && trimmed.includes('Y:')) {
        const match = trimmed.match(/Plot:\s*(\d+)/);
        const x = trimmed.match(/X:\s*"([^"]+)"/);
        const y = trimmed.match(/Y:\s*"([^"]+)"/);
        const color = trimmed.match(/Color:\s*"([^"]+)"/);
        if (y) acExpressions.push({ Plot: match ? Number(match[1]) : 1, X: x?.[1] || 'f', Y: y[1], Color: color?.[1], Enabled: !/Enabled:\s*false/.test(trimmed) });
      }
    } else if (currentSection === 'transient') {
      if (trimmed.startsWith('ICTransfer:')) initialConditionTransfer = trimmed.includes('true');
      if (trimmed.startsWith('EndTime:')) {
        tMaxStr = trimmed.replace('EndTime:', '').replace(/"/g, '').trim();
      } else if (trimmed.startsWith('TimeStep:')) {
        stepStr = trimmed.replace('TimeStep:', '').replace(/"/g, '').trim();
      } else if (trimmed.startsWith('EPS:')) {
        epsStr = trimmed.replace('EPS:', '').replace(/"/g, '').trim();
      } else if (trimmed.includes('Plot:') && trimmed.includes('Y:')) {
        const plotMatch = trimmed.match(/Plot:\s*(\d+)/);
        const xMatch = trimmed.match(/X:\s*"([^"]+)"/);
        const yMatch = trimmed.match(/Y:\s*"([^"]+)"/);
        const colorMatch = trimmed.match(/Color:\s*"([^"]+)"/);
        if (yMatch) {
          expressions.push({
            Plot: plotMatch ? parseInt(plotMatch[1]) : 1,
            X: xMatch ? xMatch[1] : 't',
            Y: yMatch[1],
            Color: colorMatch ? colorMatch[1] : '#2563eb',
            Enabled: !/Enabled:\s*false/.test(trimmed),
          });
        }
      }
    }
  }

  if (currentObj && currentObj.ID) {
    commitCurrentObject(currentObj, elements, numIdToElemId);
  }
  if (pendingFrom) throw new Error(`Провод ${wires.length + 1}: отсутствует конечный вывод.`);
  const names = new Set<string>();
  for (const element of elements) {
    const key = element.name.trim().toLocaleUpperCase();
    if (!key || names.has(key)) throw new Error(`Повторяющийся или пустой идентификатор элемента: ${element.name}.`);
    names.add(key);
  }

  // Расчет параметров transient
  const parsedTmax = parseEngValue(tMaxStr);
  if (!Number.isFinite(parsedTmax) || parsedTmax <= 0) throw new Error('EndTime: укажите положительное конечное время.');
  let parsedStep = 0;
  if (/tmax/i.test(stepStr)) {
    const match = stepStr.trim().match(/^tmax\s*\/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/i);
    if (!match) throw new Error('TimeStep: используйте число или tmax/N.');
    const divisor = finiteScmNumber(match[1], 'TimeStep');
    parsedStep = parsedTmax / divisor;
  } else {
    parsedStep = parseEngValue(stepStr);
  }
  if (!Number.isFinite(parsedStep) || parsedStep <= 0) throw new Error('TimeStep: шаг должен быть положительным.');
  const parsedEps = parseEngValue(epsStr);
  if (!Number.isFinite(parsedEps) || parsedEps <= 0 || parsedEps >= 1) throw new Error('EPS: укажите число больше 0 и меньше 1.');

  const signals = expressions.map((exp, idx) => ({
    id: `sig_${idx}`,
    plotIndex: (exp.Plot === 2 ? 2 : exp.Plot === 3 ? 3 : exp.Plot === 4 ? 4 : 1) as any,
    exprX: exp.X || 't',
    exprY: exp.Y,
    color: exp.Color || (idx === 0 ? '#2563eb' : idx === 1 ? '#dc2626' : '#16a34a'),
    enabled: exp.Enabled ?? true,
  }));

  const fMin = parseEngValue(fMinStr), fMax = parseEngValue(fMaxStr);
  if (hasAc && (!Number.isFinite(fMin) || !Number.isFinite(fMax) || fMin <= 0 || fMax <= fMin || !Number.isSafeInteger(acPoints) || acPoints < 2 || acPoints > 2000)) {
    throw new Error('AC: проверьте диапазон частот и число точек (2–2000).');
  }
  return {
    elements,
    wires,
    ac: hasAc ? { fMin, fMax, fMinStr, fMaxStr, points: acPoints, scaleType: acScale,
      signals: acExpressions.map((s, i) => ({ id: `ac_${i}`, plotIndex: s.Plot === 2 ? 2 : 1, exprX: s.X, exprY: s.Y, color: s.Color || '#2563eb', enabled: s.Enabled ?? true })) } : undefined,
    transient: {
      tMax: parsedTmax,
      tMaxStr,
      step: parsedStep,
      stepStr,
      eps: parsedEps,
      initialConditionTransfer,
      signals,
    },
  };
}

function commitCurrentObject(
  raw: Partial<YamlScmObject>,
  elements: CircuitElement[],
  numIdToElemId: Map<number, string>
) {
  if (!Number.isSafeInteger(raw.ID) || !raw.ID || raw.ID < 0 || numIdToElemId.has(raw.ID)) {
    throw new Error(`Некорректный или повторяющийся ID элемента: ${raw.ID}.`);
  }
  const elemId = `elem_${raw.ID}_${Date.now()}`;
  numIdToElemId.set(raw.ID!, elemId);

  const type = mapYamlToType(raw.Type || 'R');
  let val = 1000;
  let valStr = '1k';
  let unit = 'Ом';

  const params = raw.Params || {};
  if (params['R']) {
    valStr = params['R'];
    val = parseEngValue(valStr);
    unit = 'Ом';
  } else if (params['L']) {
    valStr = params['L'];
    val = parseEngValue(valStr);
    unit = 'Гн';
  } else if (params['C']) {
    valStr = params['C'];
    val = parseEngValue(valStr);
    unit = 'Ф';
  } else if (params['U']) {
    valStr = params['U'];
    val = parseEngValue(valStr);
    unit = 'В';
  }

  const value = params['Value'] !== undefined ? finiteScmNumber(params['Value'], `Value элемента ${raw.ID}`) : val;
  const secondaryValue = params['SecondaryValue'] !== undefined
    ? finiteScmNumber(params['SecondaryValue'], `SecondaryValue элемента ${raw.ID}`)
    : params['f'] ? parseEngValue(params['f']) : undefined;
  const initialCondition = params['IC'] !== undefined ? finiteScmNumber(params['IC'], `IC элемента ${raw.ID}`) : undefined;
  const modelParams: NonNullable<CircuitElement['modelParams']> = {};
  for (const key of ['forwardVoltage', 'onResistance', 'offResistance', 'gateThreshold', 'holdingCurrent', 'outputLimit', 'turnsRatio', 'couplingFactor', 'logicHigh', 'logicLow', 'logicThreshold', 'outputResistance', 'propagationDelay', 'hysteresis'] as const) {
    const stored = params[`Model_${key}`];
    if (stored !== undefined) modelParams[key] = finiteScmNumber(stored, `${key} элемента ${raw.ID}`);
  }
  if (!Number.isFinite(value) || (secondaryValue !== undefined && !Number.isFinite(secondaryValue))) {
    throw new Error(`Элемент ${raw.ID}: некорректное числовое значение.`);
  }
  if (['R', 'L', 'C'].includes(type) && value <= 0) throw new Error(`Элемент ${raw.ID}: номинал должен быть больше нуля.`);
  const visibleValue = params['ValueText'] ?? valStr;
  if (['R', 'L', 'C', 'V_DC', 'V_AC', 'I_DC'].includes(type) && visibleValue) {
    const labelValue = parseEngValue(visibleValue);
    if (!Number.isFinite(labelValue) || Math.abs(labelValue - value) > 1e-9 * Math.max(1, Math.abs(value))) {
      throw new Error(`Элемент ${raw.ID}: видимый номинал не соответствует числовому значению.`);
    }
  }

  elements.push({
    id: elemId,
    type,
    name: raw.Name || `E${raw.ID}`,
    x: raw.X ?? 100,
    y: raw.Y ?? 100,
    rotation: ((raw.Rot || 0) * 90) % 360,
    flipH: raw.FlipH,
    flipV: raw.FlipV,
    value,
    valueStr: visibleValue,
    unit: params['Unit'] ?? unit,
    isolation: params['Isolation'] === 'open' || params['Isolation'] === 'short' ? params['Isolation'] : undefined,
    secondaryValue,
    secondaryStr: params['SecondaryText'] ?? params['f'],
    initialCondition,
    modelParams: Object.keys(modelParams).length ? modelParams : undefined,
    portName: params['Label'] || (type === 'PORT' ? raw.Name : undefined),
    textDirective: params['Directive'],
  });
}

/**
 * Скачать текущую схему как файл project.scm
 */
export function downloadScmFile(
  elements: CircuitElement[],
  wires: CircuitWire[],
  transient: TransientSettings,
  filename: string = 'Untitled.scm'
) {
  const yamlContent = exportToYamlScm(elements, wires, transient);
  const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.scm') ? filename : `${filename}.scm`;
  a.click();
  URL.revokeObjectURL(url);
}
