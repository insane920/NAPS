import React, { useState, useEffect } from 'react';
import { CircuitElement } from '../types';
import { parseEngValue, normalizeEngNotation } from '../math/circuitSolver';
import { useModalFocus } from '../hooks/useModalFocus';
import { chipPins, validateChipPins } from '../utils/chipPins';
import { validateSourceModel } from '../math/sourceModel';
import { transistorTypes, validateTransistor } from '../math/transistorModel';
import { validatePassiveModel } from '../math/passiveModel';

interface ElementPropertiesModalProps {
  element: CircuitElement | null;
  existingNames: string[];
  controlSources: string[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: CircuitElement) => void;
}

export function ElementPropertiesModal(props: ElementPropertiesModalProps) {
  return props.isOpen && props.element ? <ElementPropertiesContent {...props} element={props.element} /> : null;
}

function ElementPropertiesContent({
  element,
  isOpen,
  onClose,
  onSave,
  existingNames,
  controlSources,
}: ElementPropertiesModalProps & { element: CircuitElement }) {

  const modelFields: Array<{ key: keyof NonNullable<CircuitElement['modelParams']>; label: string; unit: string; defaultValue: number }> =
    ['R', 'C', 'L'].includes(element.type) ? [
      { key: 'cubicCoefficient', label: 'Кубический коэффициент',
        unit: element.type === 'R' ? 'А/В³' : element.type === 'C' ? 'Кл/В³' : 'Вб/А³',
        defaultValue: element.type === 'C' ? 1e-6 : 1e-3 },
    ] : element.type === 'DIODE' || element.type === 'THYRISTOR' ? [
      { key: 'forwardVoltage', label: 'Порог открытия', unit: 'В', defaultValue: element.value > 0 ? element.value : 0.7 },
      { key: 'onResistance', label: 'Сопротивление открытого', unit: 'Ом', defaultValue: 0.01 },
      { key: 'offResistance', label: 'Сопротивление закрытого', unit: 'Ом', defaultValue: 1e9 },
      ...(element.type === 'THYRISTOR' ? [
        { key: 'gateThreshold' as const, label: 'Порог затвора', unit: 'В', defaultValue: 2.5 },
        { key: 'holdingCurrent' as const, label: 'Ток удержания', unit: 'А', defaultValue: 0.01 },
      ] : []),
    ] : element.type === 'NPN' || element.type === 'PNP' ? [
      { key: 'saturationCurrent', label: 'Ток насыщения Is', unit: 'А', defaultValue: 1e-15 },
      { key: 'betaForward', label: 'Усиление βF', unit: '', defaultValue: 100 },
      { key: 'betaReverse', label: 'Усиление βR', unit: '', defaultValue: 1 },
      { key: 'thermalVoltage', label: 'Тепловое напряжение', unit: 'В', defaultValue: 0.02585 },
      { key: 'biasControlVoltage', label: 'Vbe для линейной', unit: 'В', defaultValue: 0.7 },
      { key: 'biasOutputVoltage', label: 'Vce для линейной', unit: 'В', defaultValue: 5 },
    ] : element.type === 'NMOS' || element.type === 'PMOS' ? [
      { key: 'thresholdVoltage', label: 'Порог Vth', unit: 'В', defaultValue: 2 },
      { key: 'transconductance', label: 'Параметр K', unit: 'А/В²', defaultValue: 0.001 },
      { key: 'channelLengthModulation', label: 'Модуляция λ', unit: '1/В', defaultValue: 0.02 },
      { key: 'biasControlVoltage', label: 'Vgs для линейной', unit: 'В', defaultValue: 3 },
      { key: 'biasOutputVoltage', label: 'Vds для линейной', unit: 'В', defaultValue: 5 },
    ] : element.type === 'SWITCH' ? [
      { key: 'onResistance', label: 'Сопротивление открытого', unit: 'Ом', defaultValue: 0.01 },
      { key: 'offResistance', label: 'Сопротивление закрытого', unit: 'Ом', defaultValue: 1e9 },
      { key: 'gateThreshold', label: 'Порог затвора', unit: 'В', defaultValue: 2.5 },
    ] : element.type === 'OPAMP' ? [
      { key: 'outputLimit', label: 'Предел выхода ±', unit: 'В', defaultValue: 15 },
    ] : element.type === 'TR3' ? [
      { key: 'turnsRatio', label: 'Витки N2/N1', unit: '', defaultValue: element.secondaryValue ?? 1 },
      { key: 'couplingFactor', label: 'Связь k', unit: '', defaultValue: 0.999 },
    ] : ['V_AC', 'I_AC'].includes(element.type) ? [
      { key: 'sourceOffset', label: 'Постоянная составляющая', unit: element.type === 'V_AC' ? 'В' : 'А', defaultValue: 0 },
      { key: 'sourcePhaseDeg', label: 'Начальная фаза', unit: '°', defaultValue: 0 },
    ] : ['V_PULSE', 'I_PULSE'].includes(element.type) ? [
      { key: 'pulseLow', label: 'Минимум', unit: element.type === 'V_PULSE' ? 'В' : 'А', defaultValue: 0 },
      { key: 'pulseHigh', label: 'Максимум', unit: element.type === 'V_PULSE' ? 'В' : 'А', defaultValue: element.value },
      { key: 'pulseDelay', label: 'Начальная задержка', unit: 'с', defaultValue: 0 },
      { key: 'pulseRise', label: 'Время нарастания', unit: 'с', defaultValue: 0 },
      { key: 'pulseFall', label: 'Время спада', unit: 'с', defaultValue: 0 },
    ] : ['NOT', 'AND', 'OR', 'XOR', 'COMPARATOR', 'RS_FF', 'D_FF', 'JK_FF'].includes(element.type) ? [
      { key: 'logicHigh', label: 'Высокий уровень', unit: 'В', defaultValue: 5 },
      { key: 'logicLow', label: 'Низкий уровень', unit: 'В', defaultValue: 0 },
      { key: 'logicThreshold', label: 'Порог входа', unit: 'В', defaultValue: 2.5 },
      { key: 'outputResistance', label: 'Сопротивление выхода', unit: 'Ом', defaultValue: 10 },
      { key: 'propagationDelay', label: 'Задержка', unit: 'с', defaultValue: 0 },
      { key: 'hysteresis', label: 'Гистерезис', unit: 'В', defaultValue: 0 },
    ] : [];
  const modelDefaults = () => Object.fromEntries(modelFields.map(field => [field.key, String(element.modelParams?.[field.key] ?? field.defaultValue)]));

  const [name, setName] = useState(element.name);
  const [valStr, setValStr] = useState(normalizeEngNotation(element.valueStr || String(element.value)));
  const [secValStr, setSecValStr] = useState(
    element.secondaryStr || (element.secondaryValue !== undefined ? String(element.secondaryValue) : '')
  );
  const [icStr, setIcStr] = useState(String(element.initialCondition ?? 0));
  const [portName, setPortName] = useState(element.portName || element.name);
  const [directiveStr, setDirectiveStr] = useState(element.textDirective || '');
  const [controlSource, setControlSource] = useState(element.controlSource || '');
  const [diodeModel, setDiodeModel] = useState(element.diodeModel || 'pwl');
  const [transistorModel, setTransistorModel] = useState(element.transistorModel || 'nonlinear');
  const [passiveModel, setPassiveModel] = useState(element.passiveModel || 'linear');
  const [passiveLawKind, setPassiveLawKind] = useState<'cubic' | 'table' | 'inverseTable' | 'saturation' | 'expression' | 'inverseExpression'>(element.passiveLawDefinition?.kind ?? 'cubic');
  const [passiveTable, setPassiveTable] = useState(() => element.passiveLawDefinition?.kind === 'table' || element.passiveLawDefinition?.kind === 'inverseTable'
    ? element.passiveLawDefinition.points.map(point => `${point.argument}; ${point.value}`).join('\n') : '');
  const [limitingInductance, setLimitingInductance] = useState(() => element.passiveLawDefinition?.kind === 'saturation' ? String(element.passiveLawDefinition.limitingInductance) : String(element.value / 5));
  const [saturationCurrent, setSaturationCurrent] = useState(() => element.passiveLawDefinition?.kind === 'saturation' ? String(element.passiveLawDefinition.saturationCurrent) : '1');
  const [passiveExpression, setPassiveExpression] = useState(() => element.passiveLawDefinition?.kind === 'expression' || element.passiveLawDefinition?.kind === 'inverseExpression'
    ? element.passiveLawDefinition.expression : 'n*x + y0*tanh(x/x0)');
  const [argumentScale, setArgumentScale] = useState(() => element.passiveLawDefinition?.kind === 'expression' || element.passiveLawDefinition?.kind === 'inverseExpression'
    ? String(element.passiveLawDefinition.argumentScale) : '1');
  const [outputScale, setOutputScale] = useState(() => element.passiveLawDefinition?.kind === 'expression' || element.passiveLawDefinition?.kind === 'inverseExpression'
    ? String(element.passiveLawDefinition.outputScale) : String((element.type === 'R' ? 1 / element.value : element.value) / 5));
  const [editableChipPins, setEditableChipPins] = useState(() => chipPins(element).map(pin => ({ ...pin })));
  const [validationError, setValidationError] = useState('');
  const [modelInputs, setModelInputs] = useState<Record<string, string>>(modelDefaults);
  const dialogRef = useModalFocus<HTMLDivElement>(isOpen, '#element-name');

  useEffect(() => {
    setName(element.name);
    setValStr(normalizeEngNotation(element.valueStr || String(element.value)));
    setSecValStr(
      element.secondaryStr ||
        (element.secondaryValue !== undefined ? String(element.secondaryValue) : '')
    );
    setIcStr(String(element.initialCondition ?? 0));
    setPortName(element.portName || element.name);
    setDirectiveStr(element.textDirective || '');
    setControlSource(element.controlSource || '');
    setDiodeModel(element.diodeModel || 'pwl');
    setTransistorModel(element.transistorModel || 'nonlinear');
    setPassiveModel(element.passiveModel || 'linear');
    setPassiveLawKind(element.passiveLawDefinition?.kind ?? 'cubic');
    setPassiveTable(element.passiveLawDefinition?.kind === 'table' || element.passiveLawDefinition?.kind === 'inverseTable'
      ? element.passiveLawDefinition.points.map(point => `${point.argument}; ${point.value}`).join('\n') : '');
    setLimitingInductance(element.passiveLawDefinition?.kind === 'saturation' ? String(element.passiveLawDefinition.limitingInductance) : String(element.value / 5));
    setSaturationCurrent(element.passiveLawDefinition?.kind === 'saturation' ? String(element.passiveLawDefinition.saturationCurrent) : '1');
    setPassiveExpression(element.passiveLawDefinition?.kind === 'expression' || element.passiveLawDefinition?.kind === 'inverseExpression'
      ? element.passiveLawDefinition.expression : 'n*x + y0*tanh(x/x0)');
    setArgumentScale(element.passiveLawDefinition?.kind === 'expression' || element.passiveLawDefinition?.kind === 'inverseExpression'
      ? String(element.passiveLawDefinition.argumentScale) : '1');
    setOutputScale(element.passiveLawDefinition?.kind === 'expression' || element.passiveLawDefinition?.kind === 'inverseExpression'
      ? String(element.passiveLawDefinition.outputScale) : String((element.type === 'R' ? 1 / element.value : element.value) / 5));
    setEditableChipPins(chipPins(element).map(pin => ({ ...pin })));
    setValidationError('');
    setModelInputs(modelDefaults());
  }, [element]);

  // Заголовок окна параметров.
  const getModalTitle = () => {
    switch (element.type) {
      case 'R':
        return 'Параметры: Сопротивление';
      case 'L':
        return 'Параметры: Индуктивность';
      case 'C':
        return 'Параметры: Емкость';
      case 'DIODE':
        return 'Параметры: Диод';
      case 'THYRISTOR':
        return 'Параметры: Тиристор';
      case 'SWITCH':
        return 'Параметры: Ключ';
      case 'NPN': case 'PNP': return `Параметры: Биполярный транзистор ${element.type}`;
      case 'NMOS': case 'PMOS': return `Параметры: Полевой транзистор ${element.type}`;
      case 'V_DC':
      case 'V_AC':
      case 'V_PULSE':
        return 'Параметры: Источник напряжения';
      case 'I_DC':
      case 'I_AC':
      case 'I_PULSE':
        return 'Параметры: Источник тока';
      case 'VCVS': return 'Параметры: ИНУН (VCVS)';
      case 'VCCS': return 'Параметры: ИТУН (VCCS)';
      case 'CCVS': return 'Параметры: ИНУТ (CCVS)';
      case 'CCCS': return 'Параметры: ИТУТ (CCCS)';
      case 'CHIP': return 'Параметры: Микросхема';
      case 'OPAMP':
        return 'Параметры: Операционный усилитель';
      case 'TR3':
        return 'Параметры: Двухобмоточный трансформатор';
      case 'COMPARATOR':
        return 'Параметры: Компаратор';
      case 'NOT': case 'AND': case 'OR': case 'XOR':
        return 'Параметры: Логический элемент';
      case 'RS_FF': case 'D_FF': case 'JK_FF':
        return 'Параметры: Триггер';
      case 'PORT':
        return 'Параметры: Элемент «Порт»';
      case 'GND':
        return 'Параметры: Земля (GND)';
      case 'JUNCTION':
        return 'Параметры: Точка соединения (Узел)';
      case 'TEXT':
        return 'Параметры: Текстовая директива';
      default:
        return 'Параметры элемента';
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const nextName = name.trim();
    if (existingNames.some(other => other.trim().toLocaleUpperCase() === nextName.toLocaleUpperCase())) {
      setValidationError('Идентификатор уже используется другим элементом.');
      return;
    }
    const parsedInput = parseEngValue(valStr);
    // Legacy specialised symbols can use a descriptive, non-numeric label.
    // Preserve their numeric model value only while that label is unchanged.
    const oldLabel = normalizeEngNotation(element.valueStr || String(element.value));
    const parsedVal = !Number.isFinite(parsedInput) && normalizeEngNotation(valStr) === oldLabel
      ? element.value : parsedInput;
    const parsedSec = secValStr ? parseEngValue(secValStr) : undefined;
    const parsedIc = parseEngValue(icStr);
    if (!Number.isFinite(parsedVal) || (parsedSec !== undefined && !Number.isFinite(parsedSec)) || !Number.isFinite(parsedIc)) {
      setValidationError('Укажите число с допустимой инженерной приставкой. Лишние символы недопустимы.');
      return;
    }
    if ((element.type === 'CCVS' || element.type === 'CCCS') && !controlSources.includes(controlSource)) {
      setValidationError('Выберите существующий независимый источник напряжения для управления.');
      return;
    }
    if (element.type === 'CHIP') {
      try { validateChipPins(editableChipPins); }
      catch (error) { setValidationError(error instanceof Error ? error.message : 'Неверные выводы микросхемы.'); return; }
    }
    if (['R', 'L', 'C', 'TR3'].includes(element.type) && parsedVal <= 0) {
      setValidationError('Номинал сопротивления, индуктивности или ёмкости должен быть больше нуля.');
      return;
    }
    if (['V_AC', 'V_PULSE', 'I_AC', 'I_PULSE'].includes(element.type) && parsedSec !== undefined && parsedSec <= 0) {
      setValidationError('Частота должна быть больше нуля.');
      return;
    }
    if (['V_PULSE', 'I_PULSE'].includes(element.type) && (parsedIc < 0 || parsedIc > 1)) {
      setValidationError('Коэффициент заполнения должен быть от 0 до 1.');
      return;
    }
    const modelParams: NonNullable<CircuitElement['modelParams']> = {};
    for (const field of modelFields) {
      if (field.key === 'cubicCoefficient' && (passiveModel !== 'nonlinear' || passiveLawKind !== 'cubic')) continue;
      const value = parseEngValue(modelInputs[field.key]);
      const allowsZero = ['forwardVoltage', 'holdingCurrent', 'propagationDelay', 'hysteresis', 'pulseDelay', 'pulseRise', 'pulseFall', 'channelLengthModulation'].includes(field.key);
      const allowsNegative = ['gateThreshold', 'logicHigh', 'logicLow', 'logicThreshold', 'sourceOffset', 'sourcePhaseDeg', 'pulseLow', 'pulseHigh'].includes(field.key);
      if (!Number.isFinite(value) || (!allowsNegative && (allowsZero ? value < 0 : value <= 0))) {
        setValidationError(`${field.label}: укажите ${allowsNegative ? 'конечное' : allowsZero ? 'неотрицательное' : 'положительное'} число.`);
        return;
      }
      if (field.key === 'couplingFactor' && value >= 1) {
        setValidationError('Связь k должна быть меньше 1, чтобы матрица оставалась невырожденной.');
        return;
      }
      modelParams[field.key] = value;
    }
    if (modelParams.logicHigh !== undefined && modelParams.logicLow !== undefined && modelParams.logicHigh <= modelParams.logicLow) {
      setValidationError('Высокий уровень должен быть больше низкого.'); return;
    }
    if (['RS_FF', 'D_FF', 'JK_FF'].includes(element.type) && parsedIc !== 0 && parsedIc !== 1) {
      setValidationError('Начальное состояние Q должно быть 0 или 1.'); return;
    }
    setValidationError('');

    let passiveLawDefinition: CircuitElement['passiveLawDefinition'];
    if (passiveModel === 'nonlinear' && ['R', 'C', 'L'].includes(element.type)) {
      if (passiveLawKind === 'table' || passiveLawKind === 'inverseTable') {
        const rows = passiveTable.trim().split(/\r?\n/);
        const points = rows.map(row => {
          const cells = row.split(';').map(cell => cell.trim());
          return cells.length === 2 ? { argument: parseEngValue(cells[0]), value: parseEngValue(cells[1]) }
            : { argument: NaN, value: NaN };
        });
        passiveLawDefinition = { kind: passiveLawKind, points };
      } else if (passiveLawKind === 'saturation') {
        passiveLawDefinition = { kind: 'saturation', limitingInductance: parseEngValue(limitingInductance), saturationCurrent: parseEngValue(saturationCurrent) };
      } else if (passiveLawKind === 'expression' || passiveLawKind === 'inverseExpression') {
        passiveLawDefinition = { kind: passiveLawKind, expression: passiveExpression.trim(),
          argumentScale: parseEngValue(argumentScale), outputScale: parseEngValue(outputScale) };
      }
    }
    const updated: CircuitElement = {
      ...element,
      name: nextName || element.name,
      value: parsedVal,
      valueStr: normalizeEngNotation(valStr),
      secondaryValue: parsedSec,
      secondaryStr: normalizeEngNotation(secValStr),
      initialCondition: parsedIc,
      controlSource: element.type === 'CCVS' || element.type === 'CCCS' ? controlSource : undefined,
      diodeModel: element.type === 'DIODE' ? diodeModel : undefined,
      transistorModel: transistorTypes.has(element.type) ? transistorModel : undefined,
      passiveModel: ['R', 'C', 'L'].includes(element.type) ? passiveModel : undefined,
      passiveLawDefinition,
      chipPins: element.type === 'CHIP' ? editableChipPins.map(pin => ({ ...pin, number: pin.number.trim(), label: pin.label.trim() })) : undefined,
      modelParams: modelFields.length ? modelParams : element.modelParams,
      portName: element.type === 'PORT' ? (portName.trim() || name.trim()) : undefined,
      textDirective: element.type === 'TEXT' ? directiveStr.trim() : undefined,
    };
    try { validateSourceModel(updated); validateTransistor(updated); validatePassiveModel(updated); }
    catch (error) { setValidationError(error instanceof Error ? error.message : 'Неверные параметры источника.'); return; }

    onSave(updated);
    onClose();
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={getModalTitle()} className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-2xs">
      {/* Окно параметров элемента. */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-lg text-slate-800 text-sm font-sans overflow-hidden">
        {/* Заголовок окна */}
        <div className="bg-slate-50 border-b border-slate-200 text-slate-800 px-5 py-3 flex items-center justify-between font-semibold select-none">
          <span>{getModalTitle()}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть свойства"
            className="w-7 h-7 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center rounded-md text-xs"
          >
            ✕
          </button>
        </div>

        {/* Тело формы */}
        <form onSubmit={handleSave} className="p-5 bg-white flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
          {validationError && <p role="alert" className="text-rose-700 text-xs">{validationError}</p>}
          {/* Идентификатор (стр. 6: "Идентификатор: L_res") */}
          <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
            <label htmlFor="element-name" title="Уникальное обозначение элемента на схеме, например R1" className="text-right font-medium text-slate-700">
              Идентификатор:
            </label>
            <div className="col-span-2">
              <input
                id="element-name"
                title="Уникальное обозначение элемента на схеме, например R1"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Параметры для PORT */}
          {element.type === 'PORT' && (
            <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
              <label htmlFor="element-port" className="text-right font-medium text-slate-700">
                Имя порта:
              </label>
              <div className="col-span-2">
                <input
                  id="element-port"
                  type="text"
                  value={portName}
                  onChange={(e) => setPortName(e.target.value.toUpperCase())}
                  placeholder="IN, OUT, CLOCK_OUT"
                  className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                  required
                />
              </div>
            </div>
          )}

          {/* Основное значение номинала с размерностью */}
          {element.type !== 'PORT' && element.type !== 'GND' && element.type !== 'JUNCTION' && element.type !== 'TEXT' && element.type !== 'CHIP' && !['DIODE', 'THYRISTOR', 'SWITCH', 'NPN', 'PNP', 'NMOS', 'PMOS', 'NOT', 'AND', 'OR', 'XOR', 'RS_FF', 'D_FF', 'JK_FF', 'COMPARATOR'].includes(element.type) && (
            <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
              <label htmlFor="element-value" title="Номинал без пробелов: 1к, 10м, 2.2мк. Латинские и русские приставки равнозначны." className="text-right font-medium text-slate-700">
                {element.type === 'R'
                  ? 'Сопротивление (R):'
                  : element.type === 'L'
                  ? 'Индуктивность (L):'
                  : element.type === 'C'
                  ? 'Емкость (C):'
                  : element.type === 'OPAMP'
                  ? 'Коэф. усиления (K):'
                  : element.type === 'TR3'
                  ? 'Индуктивность L1:'
                  : element.type === 'VCCS' ? 'Крутизна (g):'
                  : element.type === 'CCVS' ? 'Транссопротивление (Rm):'
                  : element.type === 'VCVS' || element.type === 'CCCS' ? 'Коэффициент (K):'
                  : 'Номинал / Напряжение:'}
              </label>
              <div>
                <input
                  id="element-value"
                  title="Номинал без пробелов: 1к, 10м, 2.2мк. Латинские и русские приставки равнозначны."
                  type="text"
                  value={valStr}
                  onChange={(e) => setValStr(e.target.value)}
                  placeholder="1к"
                  className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                  required
                />
              </div>
              <div className="text-slate-600 font-mono">
                {element.unit || '—'}
              </div>
            </div>
          )}

          {transistorTypes.has(element.type) && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
            <label htmlFor="transistor-model" className="text-right font-medium text-slate-700">Модель:</label>
            <select id="transistor-model" value={transistorModel} onChange={event => setTransistorModel(event.target.value as 'nonlinear' | 'small-signal')} className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 text-xs"><option value="nonlinear">Нелинейная I–V</option><option value="small-signal">Линейная около заданной точки</option></select>
          </div>}
          {['R', 'C', 'L'].includes(element.type) && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
            <label htmlFor="passive-model" className="text-right font-medium text-slate-700">Модель:</label>
            <select id="passive-model" value={passiveModel} onChange={event => setPassiveModel(event.target.value as 'linear' | 'nonlinear')} className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 text-xs">
              <option value="linear">Линейная</option><option value="nonlinear">Нелинейная</option>
            </select>
          </div>}
          {passiveModel === 'nonlinear' && ['R', 'C', 'L'].includes(element.type) && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
            <label htmlFor="passive-law" className="text-right font-medium text-slate-700">Зависимость:</label>
            <select id="passive-law" value={passiveLawKind} onChange={event => {
              const kind = event.target.value as typeof passiveLawKind;
              if (kind === 'inverseExpression' && passiveLawKind !== kind) {
                setPassiveExpression('n*x + y0*tanh(x/x0)'); setArgumentScale('0.001'); setOutputScale('1');
              } else if (passiveLawKind === 'inverseExpression' && kind === 'expression') {
                setPassiveExpression('n*x + y0*tanh(x/x0)'); setArgumentScale('1');
                setOutputScale(String((element.type === 'R' ? 1 / element.value : element.value) / 5));
              }
              setPassiveLawKind(kind);
            }} className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 text-xs">
              <option value="cubic">Кубическая</option><option value="table">Таблица точек</option><option value="expression">Формула</option>
              {element.type === 'R' && <><option value="inverseTable">Таблица U(I)</option><option value="inverseExpression">Формула U(I)</option></>}
              {element.type === 'L' && <option value="saturation">Насыщение сердечника</option>}
            </select>
          </div>}
          {passiveModel === 'nonlinear' && passiveLawKind === 'cubic' && ['R', 'C', 'L'].includes(element.type) && <p className="rounded bg-blue-50 p-2 text-xs text-blue-900">{element.type === 'R' ? 'I = U/R + kU³' : element.type === 'C' ? 'Q = CU + kU³; I = dQ/dt' : 'Ψ = LI + kI³; U = dΨ/dt'}. Коэффициент k задаётся ниже.</p>}
          {passiveModel === 'nonlinear' && (passiveLawKind === 'expression' || passiveLawKind === 'inverseExpression') && ['R', 'C', 'L'].includes(element.type) && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] gap-3 items-center">
            <label htmlFor="passive-expression" className="text-right font-medium text-slate-700">Формула:</label>
            <div><input id="passive-expression" value={passiveExpression} onChange={event => setPassiveExpression(event.target.value)} className="w-full rounded border border-slate-400 p-1 font-mono text-xs" />
              <p className="text-xs text-slate-600">{passiveLawKind === 'inverseExpression' ? 'U(I)' : element.type === 'R' ? 'I(U)' : element.type === 'C' ? 'Q(U)' : 'Ψ(I)'} в СИ. x — вход, n — {passiveLawKind === 'inverseExpression' ? 'R' : element.type === 'R' ? '1/R' : element.type === 'C' ? 'C' : 'L'}, x0 и y0 — масштабы. Доступны + - * /, степень ^ от 0 до 12, sin, cos, tanh, exp, log. Пример: n*x + y0*tanh(x/x0).</p></div><span />
            <label htmlFor="passive-argument-scale" className="text-right font-medium text-slate-700">Масштаб x0:</label>
            <input id="passive-argument-scale" value={argumentScale} onChange={event => setArgumentScale(event.target.value)} className="rounded border border-slate-400 p-1 font-mono text-xs" /><span>{element.type === 'L' || passiveLawKind === 'inverseExpression' ? 'А' : 'В'}</span>
            <label htmlFor="passive-output-scale" className="text-right font-medium text-slate-700">Масштаб y0:</label>
            <input id="passive-output-scale" value={outputScale} onChange={event => setOutputScale(event.target.value)} className="rounded border border-slate-400 p-1 font-mono text-xs" /><span>{passiveLawKind === 'inverseExpression' ? 'В' : element.type === 'R' ? 'А' : element.type === 'C' ? 'Кл' : 'Вб'}</span>
          </div>}
          {passiveModel === 'nonlinear' && (passiveLawKind === 'table' || passiveLawKind === 'inverseTable') && ['R', 'C', 'L'].includes(element.type) && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] gap-3">
            <label htmlFor="passive-table" className="text-right font-medium text-slate-700">Точки зависимости:</label>
            <div><textarea id="passive-table" value={passiveTable} onChange={event => setPassiveTable(event.target.value)} rows={5} placeholder={'-1; -0.1\n0; 0\n1; 0.1'} className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs" />
              <p className="text-xs text-slate-600">По одной паре X; Y на строку. {passiveLawKind === 'inverseTable' ? 'I (А); U (В)' : element.type === 'R' ? 'U (В); I (А)' : element.type === 'C' ? 'U (В); Q (Кл)' : 'I (А); Ψ (Вб)'}. Точки строго возрастают и включают 0; 0.</p></div>
          </div>}
          {passiveModel === 'nonlinear' && passiveLawKind === 'saturation' && element.type === 'L' && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] gap-3 items-center">
            <label htmlFor="limiting-inductance" className="text-right font-medium text-slate-700">L при насыщении:</label><input id="limiting-inductance" value={limitingInductance} onChange={event => setLimitingInductance(event.target.value)} className="border border-slate-400 px-2 py-1 rounded font-mono text-xs" /><span>Гн</span>
            <label htmlFor="saturation-current" className="text-right font-medium text-slate-700">Ток насыщения:</label><input id="saturation-current" value={saturationCurrent} onChange={event => setSaturationCurrent(event.target.value)} className="border border-slate-400 px-2 py-1 rounded font-mono text-xs" /><span>А</span>
          </div>}
          {modelFields.filter(field => (field.key !== 'cubicCoefficient' || (passiveModel === 'nonlinear' && passiveLawKind === 'cubic')) && (!(element.type === 'DIODE' && diodeModel === 'ideal') || !['forwardVoltage', 'onResistance', 'offResistance'].includes(field.key))).map(field => (
            <div key={field.key} className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
              <label htmlFor={`model-${field.key}`} className="text-right font-medium text-slate-700">{field.label}:</label>
              <input
                id={`model-${field.key}`}
                type="text"
                value={modelInputs[field.key] ?? ''}
                onChange={event => setModelInputs(previous => ({ ...previous, [field.key]: event.target.value }))}
                className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
              />
              <span className="text-slate-600 font-mono">{field.unit}</span>
            </div>
          ))}
          {element.type === 'DIODE' && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
            <label htmlFor="diode-model" className="text-right font-medium text-slate-700">Модель диода:</label>
            <select id="diode-model" value={diodeModel} onChange={event => setDiodeModel(event.target.value as 'ideal' | 'pwl')} className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 text-xs"><option value="pwl">Кусочно-линейная</option><option value="ideal">Идеальная (0 В / разрыв)</option></select>
          </div>}
          {element.type === 'CHIP' && <div className="flex flex-col gap-2 rounded border border-slate-200 p-3">
            <label htmlFor="chip-pin-count" className="font-semibold">Количество выводов (2–32)</label>
            <input id="chip-pin-count" type="number" min={2} max={32} value={editableChipPins.length} onChange={event => {
              const count = Number(event.target.value);
              if (!Number.isInteger(count) || count < 2 || count > 32) return;
              setEditableChipPins(previous => {
                if (count < previous.length) return previous.slice(0, count);
                const next = [...previous];
                let index = Math.max(0, ...previous.map(pin => Number(pin.id.slice(1)) || 0));
                while (next.length < count) { index++; next.push({ id: `p${index}`, number: String(index), label: '', side: next.length % 2 ? 'right' : 'left' }); }
                return next;
              });
            }} className="w-24 rounded border border-slate-400 p-1" />
            <p className="text-xs text-slate-500">Корпус хранит выводы и соединения. Без расчётной модели микросхема не участвует в симуляции.</p>
            {editableChipPins.map((pin, index) => <div key={pin.id} className="grid grid-cols-[2rem_4rem_1fr_6rem] gap-2 items-center">
              <span className="font-mono text-xs">{pin.id}</span>
              <input aria-label={`Номер вывода ${index + 1}`} value={pin.number} onChange={event => setEditableChipPins(previous => previous.map(item => item.id === pin.id ? { ...item, number: event.target.value } : item))} className="min-w-0 rounded border border-slate-300 p-1 text-xs" />
              <input aria-label={`Имя вывода ${index + 1}`} value={pin.label} onChange={event => setEditableChipPins(previous => previous.map(item => item.id === pin.id ? { ...item, label: event.target.value } : item))} className="min-w-0 rounded border border-slate-300 p-1 text-xs" placeholder="Имя сигнала" />
              <select aria-label={`Сторона вывода ${index + 1}`} value={pin.side} onChange={event => setEditableChipPins(previous => previous.map(item => item.id === pin.id ? { ...item, side: event.target.value as 'left' | 'right' } : item))} className="rounded border border-slate-300 p-1 text-xs"><option value="left">Слева</option><option value="right">Справа</option></select>
            </div>)}
          </div>}
          {(element.type === 'CCVS' || element.type === 'CCCS') && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
            <label htmlFor="control-source" className="text-right font-medium text-slate-700">Управляющая ветвь:</label>
            <select id="control-source" value={controlSource} onChange={event => setControlSource(event.target.value)} className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 text-xs">
              <option value="">Выберите источник напряжения</option>
              {controlSources.map(source => <option key={source} value={source}>I({source}), вывод 1 → 2</option>)}
            </select>
            <span className="text-slate-600 font-mono">А</span>
          </div>}

          {/* Дополнительные параметры источников (Частота, скважность) */}
          {(['V_AC', 'V_PULSE', 'I_AC', 'I_PULSE'].includes(element.type)) && (
            <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
              <label htmlFor="element-frequency" className="text-right font-medium text-slate-700">
                Частота (f):
              </label>
              <div>
                <input
                  id="element-frequency"
                  title="Частота: 50, 1к или 20к. Единица измерения указана справа."
                  type="text"
                  value={secValStr}
                  onChange={(e) => setSecValStr(e.target.value)}
                  placeholder="50, 1k, 20k"
                  className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="text-slate-600 font-mono">
                Гц
              </div>
            </div>
          )}
          {(['V_PULSE', 'I_PULSE'].includes(element.type)) && <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
            <label htmlFor="source-duty" className="text-right font-medium text-slate-700">Коэф. заполнения:</label>
            <input id="source-duty" type="text" value={icStr} onChange={event => setIcStr(event.target.value)} className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none" />
            <span className="text-slate-600 font-mono">0…1</span>
          </div>}

          {/* Начальные условия (IC) по стр. 6 */}
          {(element.type === 'L' || element.type === 'C' || ['RS_FF', 'D_FF', 'JK_FF'].includes(element.type)) && (
            <div className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3">
              <label htmlFor="element-initial" className="text-right font-medium text-slate-700">
                Начальные условия (IC):
              </label>
              <div>
                <input
                  id="element-initial"
                  title="Начальное значение тока или напряжения; допустимы инженерные приставки."
                  type="text"
                  value={icStr}
                  onChange={(e) => setIcStr(e.target.value)}
                  placeholder="0"
                  className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="text-slate-600 font-mono">
                {element.type === 'L' ? 'А' : element.type === 'C' ? 'В' : 'Q'}
              </div>
            </div>
          )}

          {/* Директива для TEXT */}
          {element.type === 'TEXT' && (
            <div className="flex flex-col gap-1">
              <label className="font-medium text-slate-700">
                Директива NAPS (.define, .param, .set):
              </label>
              <textarea
                value={directiveStr}
                onChange={(e) => setDirectiveStr(e.target.value)}
                rows={4}
                className="w-full border border-slate-400 p-2 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                placeholder=".define Rbase = 1k;&#10;.parameter f0 = 1k;"
              />
            </div>
          )}

          {/* Нижняя панель действий. */}
          <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold cursor-pointer"
            >
              OK
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-medium cursor-pointer"
            >
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
