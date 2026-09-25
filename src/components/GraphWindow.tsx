import React, { useState, useRef, useMemo, useEffect, useId } from 'react';
import { nearestSample, plotSampleIndices, timeAtPlotFraction } from '../math/plotGeometry';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Download,
  Copy,
  HelpCircle,
  Activity,
  Sliders,
  FileText,
  X,
} from 'lucide-react';
import { CircuitSimulationResults, TransientSettings, CircuitElement, CircuitWire } from '../types';
import { CalculationDetails } from './CalculationDetails';
import { formatEngValue } from '../math/circuitSolver';

interface GraphWindowProps {
  results: CircuitSimulationResults | null;
  settings: TransientSettings;
  onOpenTransientSettings: () => void;
  onClose?: () => void;
  elements?: CircuitElement[];
  wires?: CircuitWire[];
}

export function GraphWindow({
  results,
  settings,
  onOpenTransientSettings,
  onClose,
  elements,
  wires,
}: GraphWindowProps) {
  const [mathOpen, setMathOpen] = useState(false);
  useEffect(() => {
    setMathOpen(false);
  }, [results, elements, wires, settings]);
  const isACMode = results?.isAC || false;
  const isSweepMode = Boolean(results?.sweepInfo);

  const [logX, setLogX] = useState<boolean>(isACMode);
  const [logY, setLogY] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [zoomFactor, setZoomFactor] = useState<number>(1);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const canLogY = !!results && Object.values(results.signals).length > 0 && Object.values(results.signals).every(values => values.length > 0 && values.every(value => Number.isFinite(value) && value > 0));

  const containerRef = useRef<HTMLDivElement>(null);

  // Разделение сигналов на График 1 и График 2 (стр. 21 мануала)
  const plot1Signals = useMemo(() => {
    if (!results) return [];
    if (isACMode) {
      return [
        {
          id: 'ac_db',
          plotIndex: 1,
          exprX: 'f',
          exprY: 'db(U(2))',
          color: '#2563eb',
          enabled: true,
        },
      ];
    }
    if (isSweepMode) {
      const keys = Object.keys(results.signals);
      const palette = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2'];
      return keys.map((k, idx) => ({
        id: `sweep_${idx}`,
        plotIndex: 1,
        exprX: 't',
        exprY: k,
        color: palette[idx % palette.length],
        enabled: true,
      }));
    }
    const filtered = settings.signals.filter((s) => s.enabled && s.plotIndex === 1);
    if (filtered.length === 0 && results.signals) {
      const keys = Object.keys(results.signals);
      return keys.slice(0, 2).map((k, idx) => ({
        id: `auto_${idx}`,
        plotIndex: 1,
        exprX: 't',
        exprY: k,
        color: idx === 0 ? '#2563eb' : '#10b981',
        enabled: true,
      }));
    }
    return filtered;
  }, [settings.signals, results, isACMode, isSweepMode]);

  const plot2Signals = useMemo(() => {
    if (!results) return [];
    if (isACMode) {
      return [
        {
          id: 'ac_phs',
          plotIndex: 2,
          exprX: 'f',
          exprY: 'phs(U(2))',
          color: '#dc2626',
          enabled: true,
        },
      ];
    }
    if (isSweepMode) return [];
    return settings.signals.filter((s) => s.enabled && s.plotIndex === 2);
  }, [settings.signals, results, isACMode, isSweepMode]);

  // Экспорт данных в CSV
  const handleExportCSV = () => {
    if (!results) return;
    const sigKeys = Object.keys(results.signals);
    let csv = `Time (s),${sigKeys.join(',')}\n`;
    for (let i = 0; i < results.time.length; i++) {
      const row = [results.time[i], ...sigKeys.map((k) => results.signals[k][i] ?? 0)];
      csv += row.join(',') + '\n';
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'naps_transient_signals.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  // Копирование сводки в буфер
  const handleCopySummary = () => {
    if (!results) return;
    let txt = `NAPS — РАСЧЕТ ПЕРЕХОДНОГО ПРОЦЕССА\n`;
    txt += `Конечное время: ${settings.tMaxStr}, Шаг: ${settings.stepStr}\n\n`;
    for (const [sig, stat] of Object.entries(results.summary.stats)) {
      txt += `${sig}: Mean = ${stat.mean.toPrecision(4)} ${stat.unit}, RMS = ${stat.rms.toPrecision(4)} ${stat.unit}, Max = ${stat.max.toPrecision(4)} ${stat.unit}\n`;
    }
    navigator.clipboard.writeText(txt);
    alert('Сводка расчетов скопирована в буфер обмена.');
  };

  if (!results) {
    return (
      <div className="flex-1 bg-white border border-slate-300 rounded flex flex-col items-center justify-center p-8 text-center text-slate-500 relative">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
            title="Закрыть окно графиков"
          >
            <X className="w-4 h-4" />
            <span>Закрыть</span>
          </button>
        )}
        <Activity className="w-10 h-10 text-slate-400 mb-2 animate-pulse" />
        <h3 className="font-bold text-sm text-slate-700">Окно графиков пусто</h3>
        <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
          Нажмите кнопку «Построить график» в тулбаре для запуска расчета переходного процесса.
        </p>
        <button
          type="button"
          onClick={onOpenTransientSettings}
          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-xs font-semibold text-slate-700 cursor-pointer shadow-2xs"
        >
          Настройки сигналов и шага...
        </button>
      </div>
    );
  }

  const timeArr = results.time;
  const tMax = timeArr[timeArr.length - 1] || 0.005;

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-[#f4f5f7] border border-slate-300 rounded overflow-hidden select-none text-slate-800"
    >
      {/* Панель инструментов окна графиков. */}
      <div className="bg-[#e9ecef] border-b border-slate-300 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-xs text-slate-700 mr-2 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-blue-600" />
            Окно графиков NAPS
          </span>

          {/* Кнопка сохранения / экспорта */}
          <button
            type="button"
            onClick={handleExportCSV}
            className="p-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded shadow-2xs cursor-pointer"
            title="Экспортировать точки осциллограмм в CSV"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopySummary}
            className="p-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded shadow-2xs cursor-pointer"
            title="Копировать расчетные параметры в буфер"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          {/* Масштабирование графиков */}
          <button
            type="button"
            onClick={() => setZoomFactor((z) => Math.min(5, z * 1.25))}
            className="p-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded shadow-2xs cursor-pointer"
            title="Увеличить масштаб"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomFactor((z) => Math.max(0.5, z / 1.25))}
            className="p-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded shadow-2xs cursor-pointer"
            title="Уменьшить масштаб"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomFactor(1)}
            className="p-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded shadow-2xs cursor-pointer"
            title="Сбросить масштаб (100%)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          {/* Сетка */}
          <button
            type="button"
            onClick={() => setShowGrid(!showGrid)}
            className={`px-2 py-0.5 border rounded text-2xs font-mono font-semibold cursor-pointer ${
              showGrid
                ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                : 'bg-white border-slate-300 text-slate-600'
            }`}
            title="Включить / выключить сетку"
          >
            Сетка
          </button>

          {/* Кнопки log X / log Y по руководству (стр. 21) */}
          <button
            type="button"
            onClick={() => setLogX(!logX)}
            disabled={!isACMode}
            className={`px-2 py-0.5 border rounded text-2xs font-mono font-semibold cursor-pointer ${
              logX
                ? 'bg-amber-100 border-amber-400 text-amber-900'
                : 'bg-white border-slate-300 text-slate-600'
            }`}
            title="Логарифмический масштаб по оси X (стр. 21 мануала)"
          >
            log X
          </button>
          <button
            type="button"
            onClick={() => setLogY(!logY)}
            disabled={!canLogY}
            className={`px-2 py-0.5 border rounded text-2xs font-mono font-semibold cursor-pointer ${
              logY
                ? 'bg-amber-100 border-amber-400 text-amber-900'
                : 'bg-white border-slate-300 text-slate-600'
            }`}
            title={canLogY ? 'Логарифмический масштаб Y' : 'Логарифм Y доступен только для строго положительных сигналов'}
          >
            log Y
          </button>
        </div>

        <div className="flex items-center gap-2">
          {elements && wires && <button type="button" aria-pressed={mathOpen} onClick={() => setMathOpen(value => !value)} className="px-3 py-1 bg-blue-700 hover:bg-blue-800 text-white rounded text-xs font-semibold cursor-pointer">{mathOpen ? 'К графикам' : 'Математический расчёт'}</button>}
          {/* Настройка выражений */}
          <button
            type="button"
            onClick={onOpenTransientSettings}
            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-600" />
            <span>Сигналы...</span>
          </button>

          {/* Кнопка закрытия окна графиков */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
              title="Закрыть окно графиков и вернуться к схеме"
            >
              <X className="w-4 h-4" />
              <span>Закрыть график</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. ПОЛЕ САМИХ ГРАФИКОВ (1 или 2 связанных по времени подокна) */}
      {results.model !== 'linear-mna' && !mathOpen && <div role="note" className="px-4 py-2 bg-amber-50 text-amber-950 border-y border-amber-200 text-xs">Учебная модель: {results.derivation?.method ?? 'упрощённый расчёт'}. Она применима только к исходной топологии примера; это не расчёт произвольной схемы по всем соединениям. Формулы и допущения — в «Математическом расчёте».</div>}
      {mathOpen && elements && wires && <CalculationDetails key={results.summary.durationMs} elements={elements} wires={wires} results={results} settings={settings} />}
      <div className={`${mathOpen ? 'hidden' : 'flex'} flex-1 p-3 flex-col gap-3 overflow-y-auto bg-white`}>
        {/* ГРАФИК 1 */}
        {plot1Signals.length > 0 && (
          <div className="flex-1 min-h-[220px] flex flex-col border border-slate-300 rounded p-2 bg-[#ffffff]">
            <div className="flex items-center justify-between text-2xs font-mono mb-1 pb-1 border-b border-slate-200">
              <span className="font-bold text-slate-700">График 1</span>
              {/* Легенда кривых */}
              <div className="flex items-center gap-3">
                {plot1Signals.map((sig) => {
                  const stat = results.summary.stats[sig.exprY];
                  return (
                    <span key={sig.id} className="flex items-center gap-1.5">
                      <span
                        className="w-3 h-0.5 inline-block"
                        style={{ backgroundColor: sig.color }}
                      />
                      <span className="font-bold" style={{ color: sig.color }}>
                        {sig.exprY}
                      </span>
                      {stat && (
                        <span className="text-3xs text-slate-500">
                          (max: {formatEngValue(stat.max, stat.unit)})
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            <SinglePlotCanvas
              signals={plot1Signals}
              results={results}
              showGrid={showGrid}
              logX={logX}
              logY={logY && canLogY}
              zoomFactor={zoomFactor}
              hoverTime={hoverTime}
              onHoverTimeChange={setHoverTime}
              isAC={isACMode}
            />
          </div>
        )}

        {/* ГРАФИК 2 (если есть назначенные сигналы) */}
        {plot2Signals.length > 0 && (
          <div className="flex-1 min-h-[220px] flex flex-col border border-slate-300 rounded p-2 bg-[#ffffff]">
            <div className="flex items-center justify-between text-2xs font-mono mb-1 pb-1 border-b border-slate-200">
              <span className="font-bold text-slate-700">График 2</span>
              {/* Легенда кривых */}
              <div className="flex items-center gap-3">
                {plot2Signals.map((sig) => {
                  const stat = results.summary.stats[sig.exprY];
                  return (
                    <span key={sig.id} className="flex items-center gap-1.5">
                      <span
                        className="w-3 h-0.5 inline-block"
                        style={{ backgroundColor: sig.color }}
                      />
                      <span className="font-bold" style={{ color: sig.color }}>
                        {sig.exprY}
                      </span>
                      {stat && (
                        <span className="text-3xs text-slate-500">
                          (rms: {formatEngValue(stat.rms, stat.unit)})
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            <SinglePlotCanvas
              signals={plot2Signals}
              results={results}
              showGrid={showGrid}
              logX={logX}
              logY={logY && canLogY}
              zoomFactor={zoomFactor}
              hoverTime={hoverTime}
              onHoverTimeChange={setHoverTime}
              isAC={isACMode}
            />
          </div>
        )}
      </div>

      {/* Статус-бар окна графиков. */}
      <div className="bg-[#e9ecef] border-t border-slate-300 px-3 py-1 flex flex-wrap items-center justify-between text-3xs font-mono text-slate-600 shrink-0">
        <div className="flex items-center gap-3">
          <span>
            Время расчета:{' '}
            <strong>{Math.round(results.summary.durationMs)} мс</strong>
          </span>
          <span>•</span>
          <span>
            Число точек:{' '}
            <strong>{results.summary.pointsCount}</strong>
          </span>
          <span>•</span>
          <span>
            Интервал {isACMode ? 'f' : 't'}:{' '}
            <strong>
              {formatEngValue(timeArr[0] || 0, isACMode ? 'Гц' : 'с')} ..{' '}
              {formatEngValue(tMax, isACMode ? 'Гц' : 'с')}
            </strong>
          </span>
        </div>

        {hoverTime !== null && (
          <div className="flex items-center gap-2 text-blue-900 font-bold bg-blue-50 px-2 py-0.5 border border-blue-200 rounded">
            <span>
              Курсор {isACMode ? 'f' : 't'} = {formatEngValue(hoverTime, isACMode ? 'Гц' : 'с')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Отрисовка отдельного графика кривых на SVG
 */
interface SinglePlotCanvasProps {
  signals: any[];
  results: CircuitSimulationResults;
  showGrid: boolean;
  logX: boolean;
  logY: boolean;
  zoomFactor: number;
  hoverTime: number | null;
  onHoverTimeChange: (t: number | null) => void;
  isAC?: boolean;
}

function SinglePlotCanvas({
  signals,
  results,
  showGrid,
  logX,
  logY,
  zoomFactor,
  hoverTime,
  onHoverTimeChange,
  isAC = false,
}: SinglePlotCanvasProps) {
  const clipId = useId().replaceAll(':', '');
  const timeArr = results.time;
  const tMin = timeArr[0] || (isAC ? 10 : 0);
  const tMax = timeArr[timeArr.length - 1] || 0.005;

  // Определение диапазона по Y
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const sig of signals) {
    const arr = results.signals[sig.exprY] || [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }

  if (yMin === Infinity) yMin = 0;
  if (yMax === -Infinity) yMax = 1;
  if (Math.abs(yMax - yMin) < 1e-9) {
    if (logY && yMin > 0) { yMax *= 1.1; yMin *= 0.9; }
    else { const padding = Math.max(Math.abs(yMax) * 0.1, 1e-12); yMax += padding; yMin -= padding; }
  }

  const logarithmicY = logY && yMin > 0;
  const scaleMin = logarithmicY ? Math.log10(yMin) : yMin;
  const scaleMax = logarithmicY ? Math.log10(yMax) : yMax;
  // Padding in the displayed coordinate system.
  const ySpan = scaleMax - scaleMin;
  const plotYMin = scaleMin - ySpan * 0.08;
  const plotYMax = scaleMax + ySpan * 0.08;

  // Размеры SVG канваса
  const width = 640;
  const height = 180;
  const padL = 50;
  const padR = 20;
  const padT = 15;
  const padB = 30;

  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Преобразование координат
  const getX = (t: number) => {
    if (logX && isAC && tMin > 0) {
      const frac =
        (Math.log10(Math.max(tMin, t)) - Math.log10(tMin)) /
        (Math.log10(tMax) - Math.log10(tMin));
      return padL + Math.max(0, Math.min(1, frac)) * chartW * zoomFactor;
    }
    const span = Math.max(1e-12, tMax - (isAC ? tMin : 0));
    const frac = (t - (isAC ? tMin : 0)) / span;
    return padL + frac * chartW * zoomFactor;
  };

  const getY = (val: number) => {
    const frac = ((logarithmicY ? Math.log10(val) : val) - plotYMin) / (plotYMax - plotYMin);
    return padT + chartH * (1 - frac);
  };

  // Определение делений сетки
  const numGridLines = 6;
  const gridTimes = [];
  for (let i = 0; i <= numGridLines; i++) {
    if (logX && isAC && tMin > 0) {
      const logVal =
        Math.log10(tMin) + (i / numGridLines) * (Math.log10(tMax) - Math.log10(tMin));
      gridTimes.push(Math.pow(10, logVal));
    } else {
      const start = isAC ? tMin : 0;
      gridTimes.push(start + (i / numGridLines) * (tMax - start));
    }
  }

  const numYLines = 5;
  const gridYVals = [];
  for (let i = 0; i <= numYLines; i++) {
    const scaled = plotYMin + (i / numYLines) * (plotYMax - plotYMin);
    gridYVals.push(logarithmicY ? Math.pow(10, scaled) : scaled);
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    if (point.x < padL || point.x > padL + chartW || point.y < padT || point.y > padT + chartH) { onHoverTimeChange(null); return; }
    const fraction = (point.x - padL) / (chartW * zoomFactor);
    const value = timeAtPlotFraction(fraction, isAC ? tMin : 0, tMax, logX && !!isAC);
    onHoverTimeChange(timeArr[nearestSample(timeArr, value)]);
  };

  return (
    <div className="flex-1 w-full overflow-x-auto select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full min-w-[500px] block"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => onHoverTimeChange(null)}
      >
        <defs><clipPath id={clipId}><rect x={padL} y={padT} width={chartW} height={chartH} /></clipPath></defs>
        {/* Фоновая область графика */}
        <rect
          x={padL}
          y={padT}
          width={chartW}
          height={chartH}
          fill="#ffffff"
          stroke="#cbd5e1"
          strokeWidth={1}
        />

        {/* Сетка по оси X и Y (пунктир) */}
        {showGrid && (
          <g>
            {gridTimes.map((gt, idx) => {
              const x = getX(gt);
              if (x > padL + chartW) return null;
              return (
                <g key={`gx_${idx}`}>
                  <line
                    x1={x}
                    y1={padT}
                    x2={x}
                    y2={padT + chartH}
                    stroke="#e2e8f0"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={x}
                    y={padT + chartH + 16}
                    textAnchor="middle"
                    className="font-mono text-3xs fill-slate-500"
                    style={{ fontSize: '9px' }}
                  >
                    {formatEngValue(gt, isAC ? 'Гц' : 'с')}
                  </text>
                </g>
              );
            })}

            {gridYVals.map((gy, idx) => {
              const y = getY(gy);
              return (
                <g key={`gy_${idx}`}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={padL + chartW}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padL - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="font-mono text-3xs fill-slate-500"
                    style={{ fontSize: '9px' }}
                  >
                    {formatEngValue(gy)}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* Нулевая линия по Y, если 0 входит в диапазон */}
        {!logarithmicY && plotYMin <= 0 && plotYMax >= 0 && (
          <line
            x1={padL}
            y1={getY(0)}
            x2={padL + chartW}
            y2={getY(0)}
            stroke="#94a3b8"
            strokeWidth={1.2}
          />
        )}

        {/* Сигнальные кривые */}
        {signals.map((sig) => {
          const arr = results.signals[sig.exprY] || [];
          if (arr.length === 0) return null;

          let pathD = '';
          for (const i of plotSampleIndices(arr)) {
            const x = getX(timeArr[i]);
            const y = getY(arr[i]);
            if (i === 0) pathD += `M ${x} ${y}`;
            else pathD += ` L ${x} ${y}`;
          }

          return (
            <path
              key={sig.id}
              d={pathD}
              fill="none"
              stroke={sig.color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              clipPath={`url(#${clipId})`}
            />
          );
        })}

        {/* Визир измерительного курсора */}
        {hoverTime !== null && (
          <g clipPath={`url(#${clipId})`}>
            <line
              x1={getX(hoverTime)}
              y1={padT}
              x2={getX(hoverTime)}
              y2={padT + chartH}
              stroke="#2563eb"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            {/* Точки значений на кривых */}
            {signals.map((sig) => {
              const arr = results.signals[sig.exprY] || [];
              const idx = nearestSample(timeArr, hoverTime);
              const val = arr[idx] ?? 0;
              const cx = getX(hoverTime);
              const cy = getY(val);

              return (
                <circle
                  key={`dot_${sig.id}`}
                  cx={cx}
                  cy={cy}
                  r={3.5}
                  fill={sig.color}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
