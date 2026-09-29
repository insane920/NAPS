import React, { useState } from 'react';
import type { ACSettings, CircuitElement } from '../types';
import { parseEngValue } from '../math/circuitSolver';
import { useModalFocus } from '../hooks/useModalFocus';

interface Props {
  isOpen: boolean;
  settings: ACSettings;
  elements: CircuitElement[];
  onClose: () => void;
  onSave: (settings: ACSettings) => void;
}

export function ACSetupModal(props: Props) { return props.isOpen ? <Content {...props} /> : null; }

function Content({ isOpen, settings, elements, onClose, onSave }: Props) {
  const [fMinStr, setFMinStr] = useState(settings.fMinStr || String(settings.fMin));
  const [fMaxStr, setFMaxStr] = useState(settings.fMaxStr || String(settings.fMax));
  const [points, setPoints] = useState(String(settings.points));
  const [scaleType, setScaleType] = useState(settings.scaleType);
  const [signals, setSignals] = useState(settings.signals);
  const [error, setError] = useState('');
  const ref = useModalFocus<HTMLDivElement>(isOpen, 'input');
  const ports = elements.filter(e => e.type === 'PORT').map(e => e.portName || e.name);
  const candidates = [...ports.map(p => `U(${p})`), ...elements.filter(e => !['GND', 'PORT', 'JUNCTION', 'TEXT'].includes(e.type)).map(e => `U(${e.name})`)];
  const add = () => setSignals(prev => [...prev, { id: `ac_${Date.now()}`, plotIndex: 1 as const, exprX: 'f', exprY: candidates[0] ? `db(${candidates[0]})` : '', color: '#2563eb', enabled: true }]);
  const save = () => {
    const fMin = parseEngValue(fMinStr), fMax = parseEngValue(fMaxStr), count = Number(points);
    if (!Number.isFinite(fMin) || !Number.isFinite(fMax) || fMin <= 0 || fMax <= fMin || !Number.isSafeInteger(count) || count < 2 || count > 2000) {
      setError('Укажите 0 < fmin < fmax и от 2 до 2000 точек.'); return;
    }
    if (!signals.some(s => s.enabled && s.exprY.trim())) { setError('Добавьте хотя бы один сигнал.'); return; }
    onSave({ fMin, fMax, fMinStr, fMaxStr, points: count, scaleType, signals });
    onClose();
  };
  return <div ref={ref} role="dialog" aria-modal="true" aria-label="Частотный анализ" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
    <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-2xl text-slate-800 text-xs overflow-hidden">
      <header className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-sm font-semibold"><span>Частотный анализ (АЧХ / ФЧХ)</span><button onClick={onClose} aria-label="Закрыть">✕</button></header>
      <div className="p-5 space-y-4">
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label>Начальная частота, Гц<input className="block w-full border rounded px-2 py-1 mt-1 font-mono" value={fMinStr} onChange={e => setFMinStr(e.target.value)} /></label>
          <label>Конечная частота, Гц<input className="block w-full border rounded px-2 py-1 mt-1 font-mono" value={fMaxStr} onChange={e => setFMaxStr(e.target.value)} /></label>
          <label>Число точек<input className="block w-full border rounded px-2 py-1 mt-1 font-mono" type="number" min="2" max="2000" value={points} onChange={e => setPoints(e.target.value)} /></label>
          <label>Шкала<select className="block w-full border rounded px-2 py-1 mt-1" value={scaleType} onChange={e => setScaleType(e.target.value as ACSettings['scaleType'])}><option value="log">Логарифмическая</option><option value="linear">Линейная</option></select></label>
        </div>
        <div><div className="flex justify-between items-center mb-2"><strong>Сигналы</strong><button className="border rounded px-2 py-1" onClick={add}>Добавить сигнал</button></div>
          <p className="text-slate-500 mb-2">Примеры: db(U(OUT)/U(IN)), phs(U(OUT)/U(IN)), mag(U(OUT)), I(R1).</p>
          <div className="space-y-2 max-h-56 overflow-auto">{signals.map((s, index) => <div key={s.id} className="flex items-center gap-2">
            <input aria-label={`Включить сигнал ${index + 1}`} type="checkbox" checked={s.enabled} onChange={e => setSignals(prev => prev.map((v, i) => i === index ? { ...v, enabled: e.target.checked } : v))} />
            <select aria-label="Номер графика" className="border rounded px-1 py-1" value={s.plotIndex} onChange={e => setSignals(prev => prev.map((v, i) => i === index ? { ...v, plotIndex: Number(e.target.value) as 1 | 2 } : v))}><option value={1}>АЧХ</option><option value={2}>ФЧХ</option></select>
            <input aria-label={`Выражение сигнала ${index + 1}`} className="flex-1 border rounded px-2 py-1 font-mono min-w-0" value={s.exprY} onChange={e => setSignals(prev => prev.map((v, i) => i === index ? { ...v, exprY: e.target.value } : v))} />
            <input aria-label="Цвет сигнала" type="color" value={s.color} onChange={e => setSignals(prev => prev.map((v, i) => i === index ? { ...v, color: e.target.value } : v))} />
            <button aria-label={`Удалить сигнал ${index + 1}`} onClick={() => setSignals(prev => prev.filter((_, i) => i !== index))}>✕</button>
          </div>)}</div>
        </div>
      </div>
      <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2"><button className="border rounded px-3 py-1" onClick={onClose}>Отмена</button><button className="bg-blue-700 text-white rounded px-3 py-1" onClick={save}>Сохранить параметры</button></footer>
    </div>
  </div>;
}
