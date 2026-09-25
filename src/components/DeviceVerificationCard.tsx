import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Cpu,
  Thermometer,
  Zap,
  Info,
} from 'lucide-react';
import { DeviceVerification, PowerDevice, SimulationResult } from '../types';
import { POWER_DEVICES } from '../data/deviceDatabase';

interface DeviceVerificationCardProps {
  device: PowerDevice;
  onDeviceChange: (device: PowerDevice) => void;
  safetyFactor: number;
  onSafetyFactorChange: (val: number) => void;
  verification: DeviceVerification;
  result: SimulationResult | null;
}

export const DeviceVerificationCard: React.FC<DeviceVerificationCardProps> = ({
  device,
  onDeviceChange,
  safetyFactor,
  onSafetyFactorChange,
  verification,
  result,
}) => {
  const isDanger = verification.status === 'danger';
  const isWarning = verification.status === 'warning';
  const isOk = verification.status === 'ok';

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 flex flex-col gap-4">
      {/* Заголовок карточки с селектором прибора */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-600" />
          <h3 className="font-semibold text-slate-900 text-sm">
            Блок выбора и верификации силового прибора
          </h3>
        </div>

        {/* Выбор прибора из базы */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">Прибор:</label>
          <select
            value={device.id}
            onChange={(e) => {
              const found = POWER_DEVICES.find((d) => d.id === e.target.value);
              if (found) onDeviceChange(found);
            }}
            className="text-xs font-mono font-medium bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <optgroup label="Тиристоры (SCR)">
              {POWER_DEVICES.filter((d) => d.type === 'thyristor').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.iNom}A / {d.uNom}V
                </option>
              ))}
            </optgroup>
            <optgroup label="Силовые диоды (Diode)">
              {POWER_DEVICES.filter((d) => d.type === 'diode').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.iNom}A / {d.uNom}V
                </option>
              ))}
            </optgroup>
            <optgroup label="IGBT модули (Транзисторы)">
              {POWER_DEVICES.filter((d) => d.type === 'igbt').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.iNom}A / {d.uNom}V
                </option>
              ))}
            </optgroup>
            <optgroup label="MOSFET / SiC силовые ключи">
              {POWER_DEVICES.filter((d) => d.type === 'mosfet').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.iNom}A / {d.uNom}V
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {/* Паспортные данные прибора и регулятор коэффициента запаса */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-2xs font-mono bg-slate-50 p-2.5 rounded border border-slate-200/80">
        <div>
          <span className="text-slate-500 block">I_ном (ток):</span>
          <span className="text-slate-900 font-bold text-xs">{device.iNom} А</span>
        </div>
        <div>
          <span className="text-slate-500 block">U_ном (напряжение):</span>
          <span className="text-slate-900 font-bold text-xs">{device.uNom} В</span>
        </div>
        <div>
          <span className="text-slate-500 block">V0 / V_sat:</span>
          <span className="text-slate-900 font-bold text-xs">{device.v0.toFixed(2)} В</span>
        </div>
        <div>
          <span className="text-slate-500 block">T_j,max (предел):</span>
          <span className="text-slate-900 font-bold text-xs">{device.tjMax} °C</span>
        </div>
      </div>

      {/* Настройка коэффициента запаса k_зап (Раздел 3.3 ТЗ: k_зап = 1.2 ... 1.5) */}
      <div className="flex items-center justify-between gap-3 bg-indigo-50/50 p-2.5 rounded border border-indigo-100 text-xs">
        <div className="flex items-center gap-1.5">
          <Info className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="text-slate-700 font-medium">
            Коэффициент запаса по пределу надежности:
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono">
          <input
            type="range"
            min="1.1"
            max="2.0"
            step="0.05"
            value={safetyFactor}
            onChange={(e) => onSafetyFactorChange(parseFloat(e.target.value))}
            className="w-24 accent-indigo-600 cursor-pointer"
          />
          <span className="font-bold text-indigo-900 bg-white border border-indigo-200 px-2 py-0.5 rounded text-xs">
            k_зап = {safetyFactor.toFixed(2)}
          </span>
          <span className="text-2xs text-slate-400">(ГОСТ: 1.2÷1.5)</span>
        </div>
      </div>

      {/* ГЛАВНЫЙ СТАТУС ВЕРИФИКАЦИИ (Раздел 3.3 ТЗ) */}
      <div
        className={`p-3.5 rounded-lg border flex items-start gap-3 transition-all ${
          isOk
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
            : isWarning
            ? 'bg-amber-50 border-amber-300 text-amber-950'
            : 'bg-rose-50 border-rose-300 text-rose-950'
        }`}
      >
        {isOk && <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />}
        {isWarning && <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />}
        {isDanger && <ShieldAlert className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className={`text-xs uppercase font-bold px-2 py-0.5 rounded tracking-wide font-mono ${
                isOk
                  ? 'bg-emerald-200/70 text-emerald-900'
                  : isWarning
                  ? 'bg-amber-200/70 text-amber-900'
                  : 'bg-rose-200/70 text-rose-900'
              }`}
            >
              {verification.statusBadge}
            </span>
            <span className="text-2xs font-mono font-medium text-slate-600">
              {device.name}
            </span>
          </div>

          <p className="text-xs font-semibold">{verification.statusTitle}</p>

          <ul className="mt-2 space-y-1 text-2xs font-mono">
            {verification.details.map((det, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <span className="font-bold">•</span>
                <span>{det}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Таблица проверки ключевых пределов */}
      <div className="border border-slate-200 rounded overflow-hidden text-xs">
        <table className="w-full text-left font-mono">
          <thead className="bg-slate-100 text-slate-600 text-2xs uppercase border-b border-slate-200">
            <tr>
              <th className="p-2">Параметр режима</th>
              <th className="p-2">Расчет</th>
              <th className="p-2">Допустимо с k_зап</th>
              <th className="p-2">Предел прибора</th>
              <th className="p-2 text-center">Запас</th>
              <th className="p-2 text-right">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-2xs">
            {/* Ток ключа */}
            <tr className={verification.currentCheck.passed ? 'bg-white' : 'bg-rose-50/50'}>
              <td className="p-2 font-medium text-slate-800">{verification.currentCheck.label}</td>
              <td className="p-2 font-bold text-sky-700">
                {verification.currentCheck.actual} {verification.currentCheck.unit}
              </td>
              <td className="p-2 text-slate-600">
                &le; {verification.currentCheck.allowedWithMargin.toFixed(1)} {verification.currentCheck.unit}
              </td>
              <td className="p-2 text-slate-500">
                {verification.currentCheck.limit} {verification.currentCheck.unit}
              </td>
              <td className="p-2 text-center">
                <span className={verification.currentCheck.passed ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                  {verification.currentCheck.marginPercent > 0 ? `+${verification.currentCheck.marginPercent}%` : `${verification.currentCheck.marginPercent}%`}
                </span>
              </td>
              <td className="p-2 text-right">
                <span className={`px-1.5 py-0.5 rounded text-3xs font-bold ${verification.currentCheck.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  {verification.currentCheck.passed ? 'НОРМА' : 'ПЕРЕГРУЗКА'}
                </span>
              </td>
            </tr>

            {/* Пиковый импульсный ток */}
            <tr className={verification.peakCurrentCheck.passed ? 'bg-white' : 'bg-rose-50/50'}>
              <td className="p-2 font-medium text-slate-800">{verification.peakCurrentCheck.label}</td>
              <td className="p-2 font-bold text-sky-700">
                {verification.peakCurrentCheck.actual} {verification.peakCurrentCheck.unit}
              </td>
              <td className="p-2 text-slate-600">
                &le; {verification.peakCurrentCheck.allowedWithMargin.toFixed(1)} {verification.peakCurrentCheck.unit}
              </td>
              <td className="p-2 text-slate-500">
                {verification.peakCurrentCheck.limit} {verification.peakCurrentCheck.unit}
              </td>
              <td className="p-2 text-center">
                <span className={verification.peakCurrentCheck.passed ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                  {verification.peakCurrentCheck.marginPercent > 0 ? `+${verification.peakCurrentCheck.marginPercent}%` : `${verification.peakCurrentCheck.marginPercent}%`}
                </span>
              </td>
              <td className="p-2 text-right">
                <span className={`px-1.5 py-0.5 rounded text-3xs font-bold ${verification.peakCurrentCheck.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  {verification.peakCurrentCheck.passed ? 'НОРМА' : 'ПРЕВЫШЕНО'}
                </span>
              </td>
            </tr>

            {/* Блокирующее напряжение */}
            <tr className={verification.voltageCheck.passed ? 'bg-white' : 'bg-rose-50/50'}>
              <td className="p-2 font-medium text-slate-800">{verification.voltageCheck.label}</td>
              <td className="p-2 font-bold text-amber-700">
                {verification.voltageCheck.actual} {verification.voltageCheck.unit}
              </td>
              <td className="p-2 text-slate-600">
                &le; {verification.voltageCheck.allowedWithMargin.toFixed(1)} {verification.voltageCheck.unit}
              </td>
              <td className="p-2 text-slate-500">
                {verification.voltageCheck.limit} {verification.voltageCheck.unit}
              </td>
              <td className="p-2 text-center">
                <span className={verification.voltageCheck.passed ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                  {verification.voltageCheck.marginPercent > 0 ? `+${verification.voltageCheck.marginPercent}%` : `${verification.voltageCheck.marginPercent}%`}
                </span>
              </td>
              <td className="p-2 text-right">
                <span className={`px-1.5 py-0.5 rounded text-3xs font-bold ${verification.voltageCheck.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  {verification.voltageCheck.passed ? 'НОРМА' : 'ПРОБОЙ'}
                </span>
              </td>
            </tr>

            {/* Температура перехода Tj */}
            <tr className={verification.thermalCheck.passed ? 'bg-white' : 'bg-rose-50/50'}>
              <td className="p-2 font-medium text-slate-800 flex items-center gap-1">
                <Thermometer className="w-3.5 h-3.5 text-rose-500" />
                Температура кристалла T_j
              </td>
              <td className="p-2 font-bold text-rose-700">
                {verification.thermalCheck.actual} {verification.thermalCheck.unit}
              </td>
              <td className="p-2 text-slate-600">
                &le; {verification.thermalCheck.limit} {verification.thermalCheck.unit}
              </td>
              <td className="p-2 text-slate-500">
                {verification.thermalCheck.limit} {verification.thermalCheck.unit}
              </td>
              <td className="p-2 text-center">
                <span className={verification.thermalCheck.passed ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                  {verification.thermalCheck.marginDeg > 0 ? `+${verification.thermalCheck.marginDeg}°C` : `${verification.thermalCheck.marginDeg}°C`}
                </span>
              </td>
              <td className="p-2 text-right">
                <span className={`px-1.5 py-0.5 rounded text-3xs font-bold ${verification.thermalCheck.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  {verification.thermalCheck.passed ? 'ТЕПЛО OK' : 'ПЕРЕГРЕВ'}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Энергетические и тепловые потери (Раздел 3.2 ТЗ) */}
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded border border-slate-200 text-xs font-mono">
          <div>
            <span className="text-slate-500 text-2xs block">Стат. потери P_cond:</span>
            <span className="text-slate-800 font-bold">{result.pCond} Вт</span>
          </div>
          <div>
            <span className="text-slate-500 text-2xs block">Коммутац. P_sw:</span>
            <span className="text-slate-800 font-bold">{result.pSw} Вт</span>
          </div>
          <div>
            <span className="text-slate-500 text-2xs block">Суммарные P_loss:</span>
            <span className="text-rose-700 font-bold">{result.pLoss} Вт</span>
          </div>
          <div>
            <span className="text-slate-500 text-2xs block">Мощность нагрузки:</span>
            <span className="text-emerald-700 font-bold">{result.pLoad} Вт</span>
          </div>
        </div>
      )}
    </div>
  );
};
