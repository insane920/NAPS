import { CircuitElement, CircuitWire, TransientSettings, ACSettings, type WireCrossingMode } from '../types';
import { getCircuitPinIds, parseEngValue } from '../math/circuitSolver';
import { DEFAULT_PRINT_LAYOUT, parsePrintLayout, SCHEMATIC_UNITS_PER_MM, type PrintLayout } from './printLayout';
import { validateChipPins } from './chipPins';
import { validatePassiveModel } from '../math/passiveModel';
import { mergeCoincidentJunctions } from './junctionTopology';

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
  RouteMode?: 'direct';
  Waypoints?: Array<{ x: number; y: number }>;
  Manual?: boolean;
  Disabled?: boolean;
  OriginWireId?: string;
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

export interface CircuitDescription {
  title: string;
  purpose: string;
  comment: string;
  designation?: string;
  organization?: string;
  author?: string;
  checker?: string;
  normController?: string;
  approver?: string;
  issueDate?: string;
  sheetNumber?: string;
  sheetCount?: string;
}

export const EMPTY_CIRCUIT_DESCRIPTION: CircuitDescription = { title: '', purpose: '', comment: '' };

/**
 * Преобразование внутренней модели элементов САПР в структуру YAML проекта .scm
 */
export function exportToYamlScm(
  elements: CircuitElement[],
  wires: CircuitWire[],
  transient: TransientSettings,
  ac?: ACSettings,
  printLayout: PrintLayout = DEFAULT_PRINT_LAYOUT,
  format: 'current' | 'legacy' = 'current',
  crossingMode: WireCrossingMode = 'explicit',
  description: CircuitDescription = EMPTY_CIRCUIT_DESCRIPTION
): string {
  if (format === 'legacy' && wires.some(wire => wire.routeMode === 'direct')) {
    throw new Error('SCM 0.6.0 не поддерживает произвольные углы проводов. Сохраните проект в новом формате; совместимая копия не создана, чтобы не изменить маршрут.');
  }
  if (format === 'legacy' && printLayout.gridMm === 0.5) {
    throw new Error('SCM 0.6.0 не поддерживает шаг сетки 0,5 мм. Выберите шаг от 1 мм для совместимой копии; координаты компонентов при этом не меняются.');
  }
  if (format === 'legacy' && Object.values(description).some(value => value?.trim())) {
    throw new Error('SCM 0.6.0 не поддерживает описание схемы. Сохраните проект в текущем формате, чтобы не потерять текст.');
  }
  const unitsPerStoredUnit = format === 'current' ? SCHEMATIC_UNITS_PER_MM : 1;
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
      params['Duty'] = `${(el.initialCondition ?? 0.5) * 100}%`;
    } else if (el.type === 'I_DC' || el.type === 'I_AC' || el.type === 'I_PULSE') {
      params['I'] = el.valueStr || `${el.value}`;
      if (el.type !== 'I_DC') params['f'] = el.secondaryStr || `${el.secondaryValue || 50} Гц`;
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
    if (format === 'current' && crossingMode === 'connect' && el.autoCrossing) params['AutoCrossing'] = 'true';
    if (el.controlSource) params['ControlSource'] = el.controlSource;
    if (el.type === 'DIODE' && el.diodeModel) params['DiodeModel'] = el.diodeModel;
    if (el.transistorModel) params['TransistorModel'] = el.transistorModel;
    if (['R', 'C', 'L'].includes(el.type) && el.passiveModel) params['PassiveModel'] = el.passiveModel;
    if (['R', 'C', 'L'].includes(el.type) && el.passiveLawDefinition) {
      validatePassiveModel(el);
      params['PassiveLawDefinition'] = JSON.stringify(el.passiveLawDefinition);
    }
    if (el.type === 'CHIP' && el.chipPins) { validateChipPins(el.chipPins); params['ChipPins'] = JSON.stringify(el.chipPins); }
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
      X: el.x / unitsPerStoredUnit,
      Y: el.y / unitsPerStoredUnit,
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
        !getCircuitPinIds(from.type, from).includes(w.fromPinId) ||
        !getCircuitPinIds(to.type, to).includes(w.toPinId)) {
      throw new Error(`Провод ${w.id}: указан отсутствующий элемент или вывод. Схема не сохранена.`);
    }
    scmWires.push({
      From: { ID: fromId, Pin: isNaN(Number(w.fromPinId)) ? w.fromPinId : Number(w.fromPinId) },
      To: { ID: toId, Pin: isNaN(Number(w.toPinId)) ? w.toPinId : Number(w.toPinId) },
      RouteMode: w.routeMode === 'direct' ? 'direct' : undefined,
      Waypoints: w.waypoints?.map(point => ({ x: point.x / unitsPerStoredUnit, y: point.y / unitsPerStoredUnit })),
      Manual: w.manual,
      Disabled: w.disabled,
      OriginWireId: format === 'current' && crossingMode === 'connect' ? w.originWireId : undefined,
    });
  }

  // Сборка текста в чистом YAML
  let yaml = format === 'current'
    ? `scm:\n  MajorVersion: ${crossingMode === 'connect' ? 8 : 7}\n  MinorVersion: 0\n\nGeometry:\n  Version: 1\n  Unit: mm\n${crossingMode === 'connect' ? '\nTopology:\n  Crossings: connect\n' : ''}`
    : 'scm:\n  MajorVersion: 6\n  MinorVersion: 0\n';
  yaml += `\nPage:\n  Format: ${printLayout.format}\n  Orientation: ${printLayout.orientation}\n  GridMm: ${printLayout.gridMm}\n`;
  if (format === 'current' && Object.values(description).some(value => value?.trim())) {
    yaml += `\nDocument:\n  Title: ${JSON.stringify(description.title)}\n  Purpose: ${JSON.stringify(description.purpose)}\n  Comment: ${JSON.stringify(description.comment)}\n`;
    for (const [key, field] of [['Designation', 'designation'], ['Organization', 'organization'], ['Author', 'author'],
      ['Checker', 'checker'], ['NormController', 'normController'], ['Approver', 'approver'],
      ['IssueDate', 'issueDate'], ['SheetNumber', 'sheetNumber'], ['SheetCount', 'sheetCount']] as const) {
      if (description[field]) yaml += `  ${key}: ${JSON.stringify(description[field])}\n`;
    }
  }
  yaml += '\nObjects:\n';
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
    if (w.RouteMode) yaml += `    RouteMode: ${w.RouteMode}\n`;
    if (w.Manual) yaml += `    Manual: true\n`;
    if (w.Disabled) yaml += `    Disabled: true\n`;
    if (w.OriginWireId) yaml += `    OriginWireId: ${JSON.stringify(w.OriginWireId)}\n`;
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
    case 'NPN': case 'PNP': case 'NMOS': case 'PMOS': return type;
    case 'V_DC': return 'DC_Voltage';
    case 'V_AC': return 'AC_Voltage';
    case 'V_PULSE': return 'Pulse_Generator';
    case 'I_DC': return 'DC_Current';
    case 'I_AC': return 'AC_Current';
    case 'I_PULSE': return 'Pulse_Current';
    case 'VCVS': return 'VCVS';
    case 'VCCS': return 'VCCS';
    case 'CCVS': return 'CCVS';
    case 'CCCS': return 'CCCS';
    case 'CHIP': return 'Microchip';
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
  if (t === 'vcvs' || t === 'vccs' || t === 'ccvs' || t === 'cccs') return t.toUpperCase() as CircuitElement['type'];
  if (t === 'npn' || t === 'pnp' || t === 'nmos' || t === 'pmos') return t.toUpperCase() as CircuitElement['type'];
  if (t === 'microchip' || t === 'chip') return 'CHIP';
  if (t.includes('diode') || t === 'vd') return 'DIODE';
  if (t.includes('thyristor') || t === 'vs') return 'THYRISTOR';
  if (t.includes('switch') || t.includes('vck')) return 'SWITCH';
  if (t.includes('dc_voltage') || t === 'v_dc' || t === 'udc') return 'V_DC';
  if (t.includes('ac_voltage') || t === 'v_ac' || t === 'uac') return 'V_AC';
  if (t === 'ac_current' || t === 'i_ac') return 'I_AC';
  if (t === 'pulse_current' || t === 'i_pulse') return 'I_PULSE';
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
  crossingMode: WireCrossingMode;
  transient: TransientSettings;
  ac?: ACSettings;
  printLayout: PrintLayout;
  description: CircuitDescription;
} {
  const lines = yamlText.split('\n');
  const elements: CircuitElement[] = [];
  const wires: CircuitWire[] = [];

  let currentSection: 'none' | 'geometry' | 'topology' | 'page' | 'document' | 'objects' | 'wires' | 'transient' | 'ac' = 'none';
  let majorVersion = 6;
  let crossings: string | undefined;
  let geometryVersion: number | undefined;
  let geometryUnit: string | undefined;
  let pageFormat: string | undefined;
  let pageOrientation: string | undefined;
  let gridMm: number | undefined;
  const description: CircuitDescription = { ...EMPTY_CIRCUIT_DESCRIPTION };
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

    if (trimmed.startsWith('MajorVersion:')) { majorVersion = finiteScmNumber(trimmed.slice(13), 'MajorVersion'); continue; }
    if (trimmed === 'Geometry:') { currentSection = 'geometry'; continue; }
    if (trimmed === 'Topology:') { currentSection = 'topology'; continue; }

    if (trimmed === 'Page:') { currentSection = 'page'; continue; }
    if (trimmed === 'Document:') { currentSection = 'document'; continue; }
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

    if (currentSection === 'geometry') {
      if (trimmed.startsWith('Version:')) geometryVersion = finiteScmNumber(trimmed.slice(8), 'Geometry Version');
      else if (trimmed.startsWith('Unit:')) geometryUnit = readScalar(trimmed.slice(5));
    } else if (currentSection === 'topology') {
      if (trimmed.startsWith('Crossings:')) crossings = readScalar(trimmed.slice(10));
    } else if (currentSection === 'page') {
      if (trimmed.startsWith('Format:')) pageFormat = readScalar(trimmed.slice(7));
      else if (trimmed.startsWith('Orientation:')) pageOrientation = readScalar(trimmed.slice(12));
      else if (trimmed.startsWith('GridMm:')) gridMm = finiteScmNumber(trimmed.slice(7), 'GridMm');
    } else if (currentSection === 'document') {
      for (const [key, field] of [['Title', 'title'], ['Purpose', 'purpose'], ['Comment', 'comment'],
        ['Designation', 'designation'], ['Organization', 'organization'], ['Author', 'author'],
        ['Checker', 'checker'], ['NormController', 'normController'], ['Approver', 'approver'],
        ['IssueDate', 'issueDate'], ['SheetNumber', 'sheetNumber'], ['SheetCount', 'sheetCount']] as const) {
        if (trimmed.startsWith(`${key}:`)) description[field] = readScalar(trimmed.slice(key.length + 1));
      }
    } else if (currentSection === 'objects') {
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
      if (trimmed.startsWith('RouteMode:') && wires.length) {
        const mode = trimmed.slice('RouteMode:'.length).trim();
        if (mode !== 'direct') throw new Error('Некорректный режим трассировки провода.');
        wires[wires.length - 1].routeMode = 'direct';
        continue;
      }
      if (trimmed === 'Disabled: true' && wires.length) { wires[wires.length - 1].disabled = true; continue; }
      if (trimmed.startsWith('OriginWireId:') && wires.length) {
        const origin = readScalar(trimmed.slice('OriginWireId:'.length));
        if (!origin || origin.length > 160) throw new Error('Некорректный исходный ID провода.');
        wires[wires.length - 1].originWireId = origin;
        continue;
      }
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
            !getCircuitPinIds(fromElement.type, fromElement).includes(fromPin) ||
            !getCircuitPinIds(toElement.type, toElement).includes(toPin)) {
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
  if (!Number.isInteger(majorVersion) || majorVersion < 1 || majorVersion > 8) throw new Error('Неподдерживаемая версия SCM. Исходный файл не изменён.');
  if (majorVersion === 8 && crossings !== 'connect') throw new Error('SCM 8 требует Topology Crossings: connect.');
  if (majorVersion < 8 && crossings !== undefined) throw new Error('Режим пересечений требует SCM 8.');
  if (majorVersion < 8 && (elements.some(element => element.autoCrossing) || wires.some(wire => wire.originWireId))) {
    throw new Error('Метаданные автоматических пересечений требуют SCM 8.');
  }
  if (majorVersion >= 7) {
    if (geometryVersion !== 1 || geometryUnit !== 'mm') throw new Error('SCM 7/8 требует Geometry Version: 1 и Unit: mm.');
    // One import boundary: physical millimetres become legacy SVG drawing units.
    // Re-export divides by the same fixed factor; monitor DPI and zoom never participate.
    for (const element of elements) { element.x *= SCHEMATIC_UNITS_PER_MM; element.y *= SCHEMATIC_UNITS_PER_MM; }
    for (const wire of wires) if (wire.waypoints) wire.waypoints = wire.waypoints.map(point => ({ x: point.x * SCHEMATIC_UNITS_PER_MM, y: point.y * SCHEMATIC_UNITS_PER_MM }));
    if (elements.some(element => !Number.isFinite(element.x) || !Number.isFinite(element.y)) ||
        wires.some(wire => wire.waypoints?.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) {
      throw new Error('Координаты SCM выходят за допустимый числовой диапазон.');
    }
  } else if (geometryVersion !== undefined || geometryUnit !== undefined) {
    throw new Error('Геометрия в миллиметрах требует SCM 7. Исходный файл не изменён.');
  }
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
  const junctions = mergeCoincidentJunctions(elements, wires, majorVersion === 8 ? 'connect' : 'explicit');
  return {
    elements: junctions.elements,
    wires: junctions.wires,
    crossingMode: majorVersion === 8 ? 'connect' : 'explicit',
    printLayout: parsePrintLayout(pageFormat, pageOrientation, gridMm),
    description,
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
  } else if (params['I']) {
    valStr = params['I'];
    val = parseEngValue(valStr);
    unit = 'А';
  }

  const value = params['Value'] !== undefined ? finiteScmNumber(params['Value'], `Value элемента ${raw.ID}`) : val;
  const secondaryValue = params['SecondaryValue'] !== undefined
    ? finiteScmNumber(params['SecondaryValue'], `SecondaryValue элемента ${raw.ID}`)
    : params['f'] ? parseEngValue(params['f']) : undefined;
  const initialCondition = params['IC'] !== undefined ? finiteScmNumber(params['IC'], `IC элемента ${raw.ID}`) : undefined;
  const modelParams: NonNullable<CircuitElement['modelParams']> = {};
  for (const key of ['cubicCoefficient', 'forwardVoltage', 'onResistance', 'offResistance', 'gateThreshold', 'holdingCurrent', 'outputLimit', 'turnsRatio', 'couplingFactor', 'logicHigh', 'logicLow', 'logicThreshold', 'outputResistance', 'propagationDelay', 'hysteresis', 'sourceOffset', 'sourcePhaseDeg', 'pulseLow', 'pulseHigh', 'pulseDelay', 'pulseRise', 'pulseFall', 'saturationCurrent', 'betaForward', 'betaReverse', 'thermalVoltage', 'thresholdVoltage', 'transconductance', 'channelLengthModulation', 'biasControlVoltage', 'biasOutputVoltage'] as const) {
    const stored = params[`Model_${key}`];
    if (stored !== undefined) modelParams[key] = finiteScmNumber(stored, `${key} элемента ${raw.ID}`);
  }
  if (!Number.isFinite(value) || (secondaryValue !== undefined && !Number.isFinite(secondaryValue))) {
    throw new Error(`Элемент ${raw.ID}: некорректное числовое значение.`);
  }
  let storedChipPins: CircuitElement['chipPins'];
  if (type === 'CHIP' && params['ChipPins']) {
    try { storedChipPins = JSON.parse(params['ChipPins']); validateChipPins(storedChipPins!); }
    catch { throw new Error(`Микросхема ${raw.ID}: некорректная конфигурация выводов.`); }
  }
  if (['R', 'L', 'C'].includes(type) && value <= 0) throw new Error(`Элемент ${raw.ID}: номинал должен быть больше нуля.`);
  if (params['PassiveModel'] && (!['R', 'L', 'C'].includes(type) || !['linear', 'nonlinear'].includes(params['PassiveModel']))) {
    throw new Error(`Элемент ${raw.ID}: неизвестная модель пассивного элемента.`);
  }
  let passiveLawDefinition: CircuitElement['passiveLawDefinition'];
  if (params['PassiveLawDefinition'] !== undefined) {
    try { passiveLawDefinition = JSON.parse(params['PassiveLawDefinition']) as CircuitElement['passiveLawDefinition']; }
    catch { throw new Error(`Элемент ${raw.ID}: повреждена нелинейная зависимость.`); }
  }
  validatePassiveModel({ name: raw.Name || `E${raw.ID}`, type, value,
    passiveModel: params['PassiveModel'] as CircuitElement['passiveModel'], passiveLawDefinition,
    modelParams } as CircuitElement);
  const visibleValue = params['ValueText'] ?? valStr;
  if (['R', 'L', 'C', 'V_DC', 'V_AC', 'I_DC', 'I_AC', 'I_PULSE'].includes(type) && visibleValue) {
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
    controlSource: params['ControlSource'] || undefined,
    diodeModel: type === 'DIODE' && params['DiodeModel'] === 'ideal' ? 'ideal' : undefined,
    transistorModel: params['TransistorModel'] === 'small-signal' ? 'small-signal' : ['NPN', 'PNP', 'NMOS', 'PMOS'].includes(type) ? 'nonlinear' : undefined,
    passiveModel: ['R', 'C', 'L'].includes(type) && params['PassiveModel'] ? params['PassiveModel'] as 'linear' | 'nonlinear' : undefined,
    passiveLawDefinition,
    chipPins: storedChipPins,
    modelParams: Object.keys(modelParams).length ? modelParams : undefined,
    portName: params['Label'] || (type === 'PORT' ? raw.Name : undefined),
    textDirective: params['Directive'],
    autoCrossing: type === 'JUNCTION' && params['AutoCrossing'] === 'true' ? true : undefined,
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
