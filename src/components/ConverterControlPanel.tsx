import React from 'react';
import {
  Play,
  Settings,
  BookmarkCheck,
  CheckCircle2,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { ConverterParameters, TopologyType } from '../types';
import { CONVERTER_TOPOLOGIES, PRESET_SCENARIOS } from '../data/converterPresets';

interface ConverterControlPanelProps {
  topology: TopologyType;
  onTopologyChange: (t: TopologyType) => void;
  params: ConverterParameters;
  onParamsChange: (params: ConverterParameters) => void;
  onCalculate: () => void;
  onRunAnalyticalTest: () => void;
  onApplyPreset: (scenarioId: string) => void;
}

export const ConverterControlPanel: React.FC<ConverterControlPanelProps> = ({
  topology,
  onTopologyChange,
  params,
  onParamsChange,
  onCalculate,
  onRunAnalyticalTest,
  onApplyPreset,
}) => {
  const currentTopoMeta = CONVERTER_TOPOLOGIES.find((t) => t.type === topology);

  const handleFieldChange = (field: keyof ConverterParameters, value: number | string) => {
    let numVal = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numVal)) numVal = 0;

    // Валидация диапазонов
    if (field === 'rLoad') numVal = Math.max(0.01, numVal);
    if (field === 'lLoad') numVal = Math.max(0, numVal);
    if (field === 'cLoad') numVal = Math.max(0, numVal);
    if (field === 'dutyCycle') numVal = Math.max(0.05, Math.min(0.95, numVal));
    if (field === 'alpha') numVal = Math.max(0, Math.min(180, numVal));

    onParamsChange({
      ...params,
      [field]: numVal,
    });
  };

  const isRectifier = topology === 'rectifier-1p' || topology === 'rectifier-3p';
  const isDCDC = topology === 'buck' || topology === 'boost' || topology === 'buck-boost';
  const isInverter = topology === 'inverter-1p';

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 flex flex-col gap-4">
      {/* Селектор топологии преобразователя (Раздел 3.1 ТЗ) */}
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-indigo-600" />
            Базовая топология преобразователя:
          </label>
          <span className="text-2xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            {currentTopoMeta?.category.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 font-mono text-xs">
          {CONVERTER_TOPOLOGIES.map((topo) => (
            <button
              key={topo.type}
              onClick={() => onTopologyChange(topo.type)}
              className={`p-2 rounded text-left border transition-all ${
                topology === topo.type
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm font-semibold'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              <div className="text-2xs opacity-80">{topo.shortTitle}</div>
              <div className="text-3xs truncate mt-0.5">
                {topo.type === 'rectifier-1p' ? '1Ф Мост' : topo.type === 'rectifier-3p' ? '3Ф Ларионов' : topo.title.split(' ')[0]}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Быстрая загрузка инженерных сценариев и эталонов */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2 rounded border border-slate-200/80 text-xs">
        <div className="flex items-center gap-1.5 text-slate-600">
          <BookmarkCheck className="w-4 h-4 text-indigo-500" />
          <span className="font-medium">Инженерный пресет:</span>
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <select
            onChange={(e) => {
              if (e.target.value) onApplyPreset(e.target.value);
            }}
            defaultValue=""
            className="w-full text-xs font-mono bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="" disabled>Выберите типовой режим...</option>
            {PRESET_SCENARIOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={onRunAnalyticalTest}
          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-2xs font-semibold rounded flex items-center gap-1 shadow-sm transition-colors"
          title="Запустить верификационный Тест 1 по разделу 5 ТЗ"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Тест 1 (Эталон)
        </button>
      </div>

      {/* Поля ввода параметров электрической цепи (Раздел 3.1 ТЗ) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
        {/* Входное напряжение U_in */}
        <div>
          <label className="block text-2xs text-slate-500 font-semibold mb-1">
            Входное напряжение U_in (В):
          </label>
          <input
            type="number"
            step="1"
            value={params.uIn}
            onChange={(e) => handleFieldChange('uIn', e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Частота сети / коммутации */}
        <div>
          <label className="block text-2xs text-slate-500 font-semibold mb-1">
            {isDCDC ? 'Частота ШИМ f_sw (Гц):' : 'Частота сети f (Гц):'}
          </label>
          <input
            type="number"
            step={isDCDC ? '1000' : '1'}
            value={isDCDC ? params.fSwitch : params.freq}
            onChange={(e) => handleFieldChange(isDCDC ? 'fSwitch' : 'freq', e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Сопротивление нагрузки R_load */}
        <div>
          <label className="block text-2xs text-slate-500 font-semibold mb-1">
            Нагрузка R_load (Ом):
          </label>
          <input
            type="number"
            step="0.1"
            value={params.rLoad}
            onChange={(e) => handleFieldChange('rLoad', e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Индуктивность нагрузки L_load (в мГн) */}
        <div>
          <label className="block text-2xs text-slate-500 font-semibold mb-1">
            Индуктивность L (мГн):
          </label>
          <input
            type="number"
            step="0.1"
            value={(params.lLoad * 1000).toFixed(2)}
            onChange={(e) => handleFieldChange('lLoad', parseFloat(e.target.value) / 1000)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Емкость фильтра C_load (в мкФ) */}
        <div>
          <label className="block text-2xs text-slate-500 font-semibold mb-1">
            Емкость фильтра C (мкФ):
          </label>
          <input
            type="number"
            step="10"
            value={(params.cLoad * 1e6).toFixed(0)}
            onChange={(e) => handleFieldChange('cLoad', parseFloat(e.target.value) * 1e-6)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Специфический параметр: alpha для выпрямителя / D для DC-DC / E для привода */}
        {isRectifier ? (
          <div>
            <label className="block text-2xs text-slate-500 font-semibold mb-1">
              Угол упр. &alpha; (град):
            </label>
            <input
              type="number"
              min="0"
              max="150"
              step="5"
              value={params.alpha}
              onChange={(e) => handleFieldChange('alpha', e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        ) : isDCDC ? (
          <div>
            <label className="block text-2xs text-slate-500 font-semibold mb-1">
              Скважность ШИМ D (0÷1):
            </label>
            <input
              type="number"
              min="0.05"
              max="0.95"
              step="0.05"
              value={params.dutyCycle}
              onChange={(e) => handleFieldChange('dutyCycle', e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        ) : (
          <div>
            <label className="block text-2xs text-slate-500 font-semibold mb-1">
              Частота ШИМ (кГц):
            </label>
            <input
              type="number"
              step="1"
              value={(params.fSwitch / 1000).toFixed(1)}
              onChange={(e) => handleFieldChange('fSwitch', parseFloat(e.target.value) * 1000)}
              className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Противо-ЭДС нагрузки E */}
        {isRectifier && (
          <div>
            <label className="block text-2xs text-slate-500 font-semibold mb-1">
              Противо-ЭДС E (В):
            </label>
            <input
              type="number"
              step="5"
              value={params.eEmf}
              onChange={(e) => handleFieldChange('eEmf', e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Температура окружающей среды T_a */}
        <div>
          <label className="block text-2xs text-slate-500 font-semibold mb-1">
            Среда T_a (°C):
          </label>
          <input
            type="number"
            step="5"
            value={params.tAmbient}
            onChange={(e) => handleFieldChange('tAmbient', e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 font-bold focus:bg-white focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Режим моделирования: установившийся / пуск */}
        <div>
          <label className="block text-2xs text-slate-500 font-semibold mb-1">
            Режим расчета:
          </label>
          <select
            value={params.simulationMode}
            onChange={(e) =>
              onParamsChange({
                ...params,
                simulationMode: e.target.value as 'steady-state' | 'transient',
              })
            }
            className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-slate-900 font-bold text-2xs"
          >
            <option value="steady-state">Установившийся (T)</option>
            <option value="transient">Пусковой переходный</option>
          </select>
        </div>
      </div>

      {/* Кнопка запуска расчета */}
      <button
        onClick={onCalculate}
        className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-semibold rounded-md shadow flex items-center justify-center gap-2 transition-all"
      >
        <Play className="w-4 h-4 fill-white" />
        Рассчитать электромагнитные процессы (Рунге — Кутта 4)
      </button>
    </div>
  );
};
