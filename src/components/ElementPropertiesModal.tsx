import React, { useState, useEffect } from 'react';
import { CircuitElement } from '../types';
import { parseEngValue, normalizeEngNotation } from '../math/circuitSolver';
import { useModalFocus } from '../hooks/useModalFocus';

interface ElementPropertiesModalProps {
  element: CircuitElement | null;
  existingNames: string[];
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
}: ElementPropertiesModalProps & { element: CircuitElement }) {

  const modelFields: Array<{ key: keyof NonNullable<CircuitElement['modelParams']>; label: string; unit: string; defaultValue: number }> =
    element.type === 'DIODE' || element.type === 'THYRISTOR' ? [
      { key: 'forwardVoltage', label: 'Порог открытия', unit: 'В', defaultValue: element.value > 0 ? element.value : 0.7 },
      { key: 'onResistance', label: 'Сопротивление открытого', unit: 'Ом', defaultValue: 0.01 },
      { key: 'offResistance', label: 'Сопротивление закрытого', unit: 'Ом', defaultValue: 1e9 },
      ...(element.type === 'THYRISTOR' ? [
        { key: 'gateThreshold' as const, label: 'Порог затвора', unit: 'В', defaultValue: 2.5 },
        { key: 'holdingCurrent' as const, label: 'Ток удержания', unit: 'А', defaultValue: 0.01 },
      ] : []),
    ] : element.type === 'SWITCH' ? [
      { key: 'onResistance', label: 'Сопротивление открытого', unit: 'Ом', defaultValue: 0.01 },
      { key: 'offResistance', label: 'Сопротивление закрытого', unit: 'Ом', defaultValue: 1e9 },
      { key: 'gateThreshold', label: 'Порог затвора', unit: 'В', defaultValue: 2.5 },
    ] : element.type === 'OPAMP' ? [
      { key: 'outputLimit', label: 'Предел выхода ±', unit: 'В', defaultValue: 15 },
    ] : element.type === 'TR3' ? [
      { key: 'turnsRatio', label: 'Витки N2/N1', unit: '', defaultValue: element.secondaryValue ?? 1 },
      { key: 'couplingFactor', label: 'Связь k', unit: '', defaultValue: 0.999 },
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
      case 'V_DC':
      case 'V_AC':
      case 'V_PULSE':
        return 'Параметры: Источник напряжения';
      case 'I_DC':
        return 'Параметры: Источник тока';
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
    if (['R', 'L', 'C', 'TR3'].includes(element.type) && parsedVal <= 0) {
      setValidationError('Номинал сопротивления, индуктивности или ёмкости должен быть больше нуля.');
      return;
    }
    if (['V_AC', 'V_PULSE'].includes(element.type) && parsedSec !== undefined && parsedSec <= 0) {
      setValidationError('Частота должна быть больше нуля.');
      return;
    }
    const modelParams: NonNullable<CircuitElement['modelParams']> = {};
    for (const field of modelFields) {
      const value = parseEngValue(modelInputs[field.key]);
      const allowsZero = ['forwardVoltage', 'holdingCurrent', 'propagationDelay', 'hysteresis'].includes(field.key);
      const allowsNegative = ['gateThreshold', 'logicHigh', 'logicLow', 'logicThreshold'].includes(field.key);
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

    const updated: CircuitElement = {
      ...element,
      name: nextName || element.name,
      value: parsedVal,
      valueStr: normalizeEngNotation(valStr),
      secondaryValue: parsedSec,
      secondaryStr: normalizeEngNotation(secValStr),
      initialCondition: parsedIc,
      modelParams: modelFields.length ? modelParams : element.modelParams,
      portName: element.type === 'PORT' ? (portName.trim() || name.trim()) : undefined,
      textDirective: element.type === 'TEXT' ? directiveStr.trim() : undefined,
    };

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
        <form onSubmit={handleSave} className="p-5 bg-white flex flex-col gap-4">
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
          {element.type !== 'PORT' && element.type !== 'GND' && element.type !== 'TEXT' && !['DIODE', 'THYRISTOR', 'SWITCH', 'NOT', 'AND', 'OR', 'XOR', 'RS_FF', 'D_FF', 'JK_FF', 'COMPARATOR'].includes(element.type) && (
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

          {modelFields.map(field => (
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

          {/* Дополнительные параметры источников (Частота, скважность) */}
          {(element.type === 'V_AC' || element.type === 'V_PULSE') && (
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
