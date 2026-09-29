import React, { useState } from 'react';
import { TransientSettings, TransientSignalConfig, CircuitElement } from '../types';
import { parseEngValue } from '../math/circuitSolver';
import { useModalFocus } from '../hooks/useModalFocus';

interface TransientSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: TransientSettings;
  onSave: (settings: TransientSettings) => void;
  elements: CircuitElement[];
}

export function TransientSetupModal(props: TransientSetupModalProps) {
  return props.isOpen ? <TransientSetupContent {...props} /> : null;
}

function TransientSetupContent({
  isOpen,
  onClose,
  settings,
  onSave,
  elements,
}: TransientSetupModalProps) {
  const [tMaxStr, setTMaxStr] = useState(settings.tMaxStr || '5m');
  const [stepStr, setStepStr] = useState(settings.stepStr || '10u');
  const [epsStr, setEpsStr] = useState(String(settings.eps || '0.001'));
  const [signals, setSignals] = useState<TransientSignalConfig[]>(settings.signals);
  const [error, setError] = useState('');
  const dialogRef = useModalFocus<HTMLDivElement>(isOpen, 'input[type="text"]');

  // Список доступных сигналов из схемы
  const availableSignals = [
    ...elements.filter(e => e.type === 'PORT').map(e => `U(${e.portName || e.name})`),
    ...elements.filter(e => !['GND', 'PORT', 'JUNCTION', 'TEXT'].includes(e.type)).map(e => `U(${e.name})`),
    ...elements.filter(e => !['GND', 'PORT', 'JUNCTION', 'TEXT'].includes(e.type)).map(e => `I(${e.name})`),
  ];

  const handleRowChange = (index: number, field: keyof TransientSignalConfig, value: any) => {
    setSignals((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddSignalRow = () => {
    if (signals.length >= 7) return;
    const newRow: TransientSignalConfig = {
      id: `sig_${Date.now()}`,
      plotIndex: 1,
      exprX: 't',
      exprY: availableSignals[0] ?? '',
      color: '#dc2626',
      enabled: true,
    };
    setSignals([...signals, newRow]);
  };

  const handleRemoveRow = (index: number) => {
    setSignals(signals.filter((_, idx) => idx !== index));
  };

  const handleSave = () => {
    const parsedTmax = parseEngValue(tMaxStr);

    let parsedStep = 0;
    if (stepStr.toLowerCase().includes('tmax')) {
      const match = stepStr.trim().match(/^tmax\s*\/\s*(\d+(?:\.\d+)?)$/i);
      parsedStep = match ? parsedTmax / Number(match[1]) : NaN;
    } else {
      parsedStep = parseEngValue(stepStr);
    }
    const parsedEps = parseEngValue(epsStr);
    if (![parsedTmax, parsedStep, parsedEps].every(Number.isFinite) || parsedTmax <= 0 || parsedStep <= 0 || parsedEps <= 0 || parsedEps >= 1) {
      setError('Время и шаг должны быть положительными, EPS — больше 0 и меньше 1. Формат шага: число или tmax/500.');
      return;
    }

    onSave({
      ...settings,
      tMax: parsedTmax,
      tMaxStr,
      step: parsedStep,
      stepStr,
      eps: parsedEps,
      signals,
    });
    onClose();
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Параметры переходного процесса" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-2xs">
        {/* Окно настроек переходного процесса. */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-2xl text-slate-800 text-xs font-sans overflow-hidden">
        {/* Заголовок окна */}
        <div className="bg-slate-50 border-b border-slate-200 text-slate-800 px-5 py-3 flex items-center justify-between text-sm font-semibold select-none">
          <span>Переходный процесс (NAPS)</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть параметры расчёта"
            className="w-7 h-7 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center rounded-md text-xs"
          >
            ✕
          </button>
        </div>

        <div className="p-4 bg-white flex flex-col gap-4">
          {error && <p role="alert" className="text-red-700">{error}</p>}
          {/* Блок «Параметры расчета» (стр. 19) */}
          <fieldset className="border border-slate-300 rounded p-3 bg-slate-50/60">
            <legend className="px-1 text-slate-700 font-semibold">Параметры расчета</legend>
            <div className="grid grid-cols-12 gap-3 items-center">
              <label className="col-span-4 text-right font-medium text-slate-700">
                Конечное время (tmax):
              </label>
              <div className="col-span-6 flex items-center gap-1">
                <input
                  type="text"
                  value={tMaxStr}
                  onChange={(e) => setTMaxStr(e.target.value)}
                  className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                  placeholder="1m, 5m, 20m"
                />
                <span className="text-slate-600 font-mono">с</span>
              </div>
              <div className="col-span-2 text-3xs text-slate-500 font-mono">
                {Number.isFinite(parseEngValue(tMaxStr)) ? parseEngValue(tMaxStr).toExponential(2) : '—'} s
              </div>

              <label className="col-span-4 text-right font-medium text-slate-700">
                Шаг расчета:
              </label>
              <div className="col-span-6 flex items-center gap-1">
                <input
                  type="text"
                  value={stepStr}
                  onChange={(e) => setStepStr(e.target.value)}
                  className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                  placeholder="tmax/500, 10u, 1u"
                />
                <span className="text-slate-600 font-mono">с</span>
              </div>
              <div className="col-span-2 text-3xs text-slate-500 font-mono">
                dt
              </div>

              <label className="col-span-4 text-right font-medium text-slate-700">
                Погрешность (EPS):
              </label>
              <div className="col-span-6 flex items-center gap-1">
                <input
                  type="text"
                  value={epsStr}
                  onChange={(e) => setEpsStr(e.target.value)}
                  className="w-full border border-slate-400 px-2 py-1 rounded bg-white text-slate-900 font-mono text-xs focus:border-blue-600 focus:outline-none"
                  placeholder="1m (0.001)"
                />
              </div>
              <div className="col-span-2 text-3xs text-slate-500 font-mono">
                точность
              </div>
            </div>
          </fieldset>

          {/* Таблица выражений сигналов (стр. 19: №, График, Выражение по оси X, Выражение по оси Y) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-slate-700">
                Выражения сигналов для вывода на графики:
              </span>
              <button
                type="button"
                onClick={handleAddSignalRow}
                disabled={signals.length >= 7}
                className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-3xs font-medium cursor-pointer"
              >
                + Добавить строку (макс 7)
              </button>
            </div>

            <div className="border border-slate-300 rounded overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead className="bg-slate-100 border-b border-slate-300 text-slate-600 text-3xs font-sans font-bold">
                  <tr>
                    <th className="py-1 px-2 text-center w-8">№</th>
                    <th className="py-1 px-2 text-center w-20">График</th>
                    <th className="py-1 px-2 text-left w-24">Ось X</th>
                    <th className="py-1 px-2 text-left">Выражение по оси Y</th>
                    <th className="py-1 px-2 text-center w-12">Цвет</th>
                    <th className="py-1 px-2 text-center w-10">Вкл</th>
                    <th className="py-1 px-2 text-center w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {signals.map((sig, idx) => (
                    <tr key={sig.id} className="hover:bg-slate-50">
                      <td className="py-1 px-2 text-center text-slate-500 font-bold">{idx + 1}</td>
                      <td className="py-1 px-2 text-center">
                        <select
                          value={sig.plotIndex}
                          onChange={(e) =>
                            handleRowChange(idx, 'plotIndex', Number(e.target.value) as 1 | 2)
                          }
                          className="border border-slate-300 rounded px-1 py-0.5 text-xs bg-white text-slate-800"
                        >
                          <option value={1}>График 1</option>
                          <option value={2}>График 2</option>
                        </select>
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="text"
                          value={sig.exprX}
                          onChange={(e) => handleRowChange(idx, 'exprX', e.target.value)}
                          className="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-slate-50 text-slate-700"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={sig.exprY}
                            onChange={(e) => handleRowChange(idx, 'exprY', e.target.value)}
                            className="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white font-mono"
                            placeholder="U(OUT), U(IN), I(R1)"
                          />
                        </div>
                      </td>
                      <td className="py-1 px-2 text-center">
                        <input
                          type="color"
                          value={sig.color}
                          onChange={(e) => handleRowChange(idx, 'color', e.target.value)}
                          className="w-6 h-5 p-0 border border-slate-300 rounded cursor-pointer"
                        />
                      </td>
                      <td className="py-1 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={sig.enabled}
                          onChange={(e) => handleRowChange(idx, 'enabled', e.target.checked)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="py-1 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(idx)}
                          className="text-slate-400 hover:text-rose-600 font-bold cursor-pointer"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Быстрые подсказки доступных выражений */}
            <div className="mt-2 text-3xs text-slate-500 flex flex-wrap items-center gap-1">
              <span>Доступные сигналы в схеме:</span>
              {availableSignals.length === 0 && <span>Добавьте элементы на схему</span>}
              {availableSignals.slice(0, 8).map((sig) => (
                <button
                  key={sig}
                  type="button"
                  onClick={() => {
                    const row = signals[0];
                    if (row) handleRowChange(0, 'exprY', sig);
                  }}
                  className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded font-mono text-slate-700 cursor-pointer"
                >
                  {sig}
                </button>
              ))}
            </div>
          </div>

          {/* Нижние кнопки */}
          <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold"
            >
              OK
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-medium"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => alert('NAPS — переходный процесс:\nВ выражениях можно использовать U(имя_элемента), I(элемент), P(элемент).')}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-medium"
            >
              Справка
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
