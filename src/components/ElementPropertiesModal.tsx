import React, { useState, useEffect } from 'react';
import { CircuitElement } from '../types';
import { parseEngValue, normalizeEngNotation } from '../math/circuitSolver';

interface ElementPropertiesModalProps {
  element: CircuitElement | null;
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
}: ElementPropertiesModalProps & { element: CircuitElement }) {

  const [name, setName] = useState(element.name);
  const [valStr, setValStr] = useState(normalizeEngNotation(element.valueStr || String(element.value)));
  const [secValStr, setSecValStr] = useState(
    element.secondaryStr || (element.secondaryValue !== undefined ? String(element.secondaryValue) : '')
  );
  const [icStr, setIcStr] = useState(String(element.initialCondition ?? 0));
  const [portName, setPortName] = useState(element.portName || element.name);
  const [directiveStr, setDirectiveStr] = useState(element.textDirective || '');

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

    const parsedVal = parseEngValue(valStr);
    const parsedSec = secValStr ? parseEngValue(secValStr) : undefined;
    const parsedIc = parseEngValue(icStr);

    const updated: CircuitElement = {
      ...element,
      name: name.trim() || element.name,
      value: parsedVal,
      valueStr: normalizeEngNotation(valStr),
      secondaryValue: parsedSec,
      secondaryStr: normalizeEngNotation(secValStr),
      initialCondition: parsedIc,
      portName: element.type === 'PORT' ? (portName.trim() || name.trim()) : undefined,
      textDirective: element.type === 'TEXT' ? directiveStr.trim() : undefined,
    };

    onSave(updated);
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={getModalTitle()} className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-2xs">
      {/* Окно параметров элемента. */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-lg text-slate-800 text-sm font-sans overflow-hidden">
        {/* Заголовок окна */}
        <div className="bg-gradient-to-r from-[#0055ea] to-[#2680eb] text-white px-5 py-3 flex items-center justify-between font-bold select-none">
          <span>{getModalTitle()}</span>
          <button
            type="button"
            onClick={onClose}
            className="w-5 h-5 bg-[#d9534f] hover:bg-[#c9302c] text-white flex items-center justify-center rounded text-2xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Тело формы */}
        <form onSubmit={handleSave} className="p-5 bg-white flex flex-col gap-4">
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
          {element.type !== 'PORT' && element.type !== 'GND' && element.type !== 'TEXT' && (
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

          {/* Дополнительные параметры источников (Частота, скважность) */}
          {(element.type === 'V_AC' || element.type === 'V_PULSE' || element.type === 'SWITCH') && (
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
          {(element.type === 'L' || element.type === 'C') && (
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
                {element.type === 'L' ? 'А' : 'В'}
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
