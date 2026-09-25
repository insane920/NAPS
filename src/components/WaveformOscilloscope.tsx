import React, { useState, useRef } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Grid,
  Download,
  FileSpreadsheet,
  Layers,
  Crosshair,
} from 'lucide-react';
import { SimulationPoint, SimulationResult } from '../types';

interface WaveformOscilloscopeProps {
  result: SimulationResult | null;
  displayCycles: number;
}

export const WaveformOscilloscope: React.FC<WaveformOscilloscopeProps> = ({
  result,
  displayCycles,
}) => {
  const [showIKey, setShowIKey] = useState(true);
  const [showUKey, setShowUKey] = useState(true);
  const [showILoad, setShowILoad] = useState(true);
  const [showULoad, setShowULoad] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);

  // Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hoverPoint, setHoverPoint] = useState<SimulationPoint | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!result || result.points.length === 0) {
    return (
      <div className="flex-1 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-center p-8 text-slate-500 font-mono text-sm">
        Нет данных для отображения осциллограмм. Нажмите «Запустить расчет».
      </div>
    );
  }

  const points = result.points;
  const maxT = points[points.length - 1].t;

  // Рассчитываем динамические пределы по осям тока и напряжения
  let maxI = 1;
  let maxU = 10;
  let minU = 0;

  for (const pt of points) {
    if (showIKey && pt.iKey > maxI) maxI = pt.iKey;
    if (showILoad && pt.iLoad > maxI) maxI = pt.iLoad;
    if (showUKey) {
      if (pt.uKey > maxU) maxU = pt.uKey;
      if (pt.uKey < minU) minU = pt.uKey;
    }
    if (showULoad) {
      if (pt.uLoad > maxU) maxU = pt.uLoad;
      if (pt.uLoad < minU) minU = pt.uLoad;
    }
  }

  maxI = Math.max(2, maxI * 1.15);
  maxU = Math.max(20, maxU * 1.15);
  minU = Math.min(-10, minU * 1.15);

  // Геометрия SVG
  const width = 800;
  const height = 360;
  const padLeft = 60;
  const padRight = 60;
  const padTop = 30;
  const padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Функции трансформации координат
  const scaleX = (t: number) => padLeft + (t / maxT) * plotW * zoomLevel;
  // Ток отображается в верхней/средней половине или делит диапазон [0, maxI]
  const scaleYI = (current: number) => padTop + plotH - (Math.max(0, current) / maxI) * plotH;
  // Напряжение отображается в диапазоне [minU, maxU]
  const scaleYU = (voltage: number) => {
    const range = maxU - minU;
    return padTop + plotH - ((voltage - minU) / range) * plotH;
  };

  // Построение путей SVG
  let pathIKey = '';
  let pathUKey = '';
  let pathILoad = '';
  let pathULoad = '';

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const x = scaleX(pt.t);
    const yIK = scaleYI(pt.iKey);
    const yUK = scaleYU(pt.uKey);
    const yIL = scaleYI(pt.iLoad);
    const yUL = scaleYU(pt.uLoad);

    if (i === 0) {
      pathIKey = `M ${x.toFixed(1)} ${yIK.toFixed(1)}`;
      pathUKey = `M ${x.toFixed(1)} ${yUK.toFixed(1)}`;
      pathILoad = `M ${x.toFixed(1)} ${yIL.toFixed(1)}`;
      pathULoad = `M ${x.toFixed(1)} ${yUL.toFixed(1)}`;
    } else {
      pathIKey += ` L ${x.toFixed(1)} ${yIK.toFixed(1)}`;
      pathUKey += ` L ${x.toFixed(1)} ${yUK.toFixed(1)}`;
      pathILoad += ` L ${x.toFixed(1)} ${yIL.toFixed(1)}`;
      pathULoad += ` L ${x.toFixed(1)} ${yUL.toFixed(1)}`;
    }
  }

  // Обработка курсора (Crosshair)
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;

    if (svgX >= padLeft && svgX <= padLeft + plotW) {
      const relX = svgX - padLeft;
      const targetT = (relX / (plotW * zoomLevel)) * maxT;

      // Поиск ближайшей точки
      let closestPt = points[0];
      let minDiff = Math.abs(points[0].t - targetT);
      for (let i = 1; i < points.length; i++) {
        const diff = Math.abs(points[i].t - targetT);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = points[i];
        }
      }
      setHoverPoint(closestPt);
      setHoverX(svgX);
    } else {
      setHoverPoint(null);
      setHoverX(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverPoint(null);
    setHoverX(null);
  };

  // Экспорт в CSV
  const handleExportCSV = () => {
    let csv = 't_ms,i_key_A,u_key_V,i_load_A,u_load_V,gate\n';
    for (const p of points) {
      csv += `${(p.t * 1000).toFixed(4)},${p.iKey.toFixed(4)},${p.uKey.toFixed(2)},${p.iLoad.toFixed(4)},${p.uLoad.toFixed(2)},${p.gate}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `naps_oscillogram_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Экспорт SVG
  const handleExportSVG = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `naps_waveforms_${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      {/* Верхняя инструментальная панель осциллографа */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Кнопки переключения каналов */}
        <div className="flex flex-wrap items-center gap-2 font-mono">
          <span className="text-slate-400 font-semibold text-2xs uppercase tracking-wider mr-1">
            Каналы осциллографа:
          </span>

          <button
            onClick={() => setShowIKey(!showIKey)}
            className={`px-2.5 py-1 rounded text-2xs font-semibold flex items-center gap-1.5 transition-all ${
              showIKey
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/50 shadow-sm'
                : 'bg-slate-800 text-slate-500 border border-slate-700/50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-sky-400"></span>
            CH1: i_key (ток ключа)
          </button>

          <button
            onClick={() => setShowUKey(!showUKey)}
            className={`px-2.5 py-1 rounded text-2xs font-semibold flex items-center gap-1.5 transition-all ${
              showUKey
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-sm'
                : 'bg-slate-800 text-slate-500 border border-slate-700/50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            CH2: u_key (напряжение ключа)
          </button>

          <button
            onClick={() => setShowILoad(!showILoad)}
            className={`px-2.5 py-1 rounded text-2xs font-semibold flex items-center gap-1.5 transition-all ${
              showILoad
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-sm'
                : 'bg-slate-800 text-slate-500 border border-slate-700/50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            CH3: i_load (ток нагрузки)
          </button>

          <button
            onClick={() => setShowULoad(!showULoad)}
            className={`px-2.5 py-1 rounded text-2xs font-semibold flex items-center gap-1.5 transition-all ${
              showULoad
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50 shadow-sm'
                : 'bg-slate-800 text-slate-500 border border-slate-700/50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-purple-400"></span>
            CH4: u_load (напряжение нагрузки)
          </button>
        </div>

        {/* Управление масштабом и экспортом */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGrid(!showGrid)}
            title="Переключить координатную сетку"
            className={`p-1.5 rounded transition-colors ${
              showGrid ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Grid className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowMarkers(!showMarkers)}
            title="Показать/скрыть уровни I_mean, I_rms, U_max"
            className={`p-1.5 rounded transition-colors ${
              showMarkers ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-800"></div>

          <button
            onClick={() => setZoomLevel(prev => Math.min(4, prev + 0.25))}
            title="Увеличить развертку по времени"
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            onClick={() => setZoomLevel(prev => Math.max(0.5, prev - 0.25))}
            title="Уменьшить развертку по времени"
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <button
            onClick={() => setZoomLevel(1)}
            title="Сброс масштаба (1x)"
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-800"></div>

          <button
            onClick={handleExportCSV}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-2xs font-mono font-medium rounded flex items-center gap-1 transition-colors"
            title="Экспорт массива осциллограмм в CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            CSV
          </button>

          <button
            onClick={handleExportSVG}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-2xs font-mono font-medium rounded flex items-center gap-1 transition-colors"
            title="Экспорт векторного графика в SVG"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            SVG
          </button>
        </div>
      </div>

      {/* Экран осциллографа */}
      <div
        ref={containerRef}
        className="flex-1 w-full relative select-none overflow-x-auto overflow-y-hidden bg-[#070b14] flex flex-col justify-center min-h-[340px]"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Сетка осциллографа */}
          {showGrid && (
            <g stroke="#1e293b" strokeWidth="0.75" strokeDasharray="3 3">
              {/* Горизонтальные линии */}
              {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => (
                <line
                  key={`h-${idx}`}
                  x1={padLeft}
                  y1={padTop + frac * plotH}
                  x2={padLeft + plotW}
                  y2={padTop + frac * plotH}
                />
              ))}
              {/* Вертикальные деления времени */}
              {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((frac, idx) => (
                <line
                  key={`v-${idx}`}
                  x1={padLeft + frac * plotW}
                  y1={padTop}
                  x2={padLeft + frac * plotW}
                  y2={padTop + plotH}
                />
              ))}
            </g>
          )}

          {/* Оси */}
          <line
            x1={padLeft}
            y1={padTop + plotH}
            x2={padLeft + plotW}
            y2={padTop + plotH}
            stroke="#475569"
            strokeWidth="1.5"
          />
          <line
            x1={padLeft}
            y1={padTop}
            x2={padLeft}
            y2={padTop + plotH}
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
          <line
            x1={padLeft + plotW}
            y1={padTop}
            x2={padLeft + plotW}
            y2={padTop + plotH}
            stroke="#fbbf24"
            strokeWidth="1.5"
          />

          {/* Нулевая линия напряжения */}
          {minU < 0 && (
            <line
              x1={padLeft}
              y1={scaleYU(0)}
              x2={padLeft + plotW}
              y2={scaleYU(0)}
              stroke="#64748b"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
          )}

          {/* Метки оси токов (Слева - Синяя шкала А) */}
          <text x={padLeft - 10} y={padTop + 10} textAnchor="end" fill="#38bdf8" fontSize="10" fontFamily="monospace">
            {maxI.toFixed(1)} А
          </text>
          <text x={padLeft - 10} y={padTop + plotH / 2} textAnchor="end" fill="#38bdf8" fontSize="10" fontFamily="monospace">
            {(maxI / 2).toFixed(1)} А
          </text>
          <text x={padLeft - 10} y={padTop + plotH} textAnchor="end" fill="#38bdf8" fontSize="10" fontFamily="monospace">
            0.0 А
          </text>

          {/* Метки оси напряжений (Справа - Янтарная шкала В) */}
          <text x={padLeft + plotW + 10} y={padTop + 10} textAnchor="start" fill="#fbbf24" fontSize="10" fontFamily="monospace">
            {maxU.toFixed(0)} В
          </text>
          <text x={padLeft + plotW + 10} y={scaleYU(0)} textAnchor="start" fill="#fbbf24" fontSize="10" fontFamily="monospace">
            0 В
          </text>
          {minU < 0 && (
            <text x={padLeft + plotW + 10} y={padTop + plotH} textAnchor="start" fill="#fbbf24" fontSize="10" fontFamily="monospace">
              {minU.toFixed(0)} В
            </text>
          )}

          {/* Метки времени по оси X */}
          <text x={padLeft} y={padTop + plotH + 18} fill="#94a3b8" fontSize="10" fontFamily="monospace">
            0.0 мс
          </text>
          <text x={padLeft + plotW / 2} y={padTop + plotH + 18} textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">
            {((maxT * 1000) / 2).toFixed(2)} мс
          </text>
          <text x={padLeft + plotW} y={padTop + plotH + 18} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="monospace">
            {(maxT * 1000).toFixed(2)} мс ({displayCycles} T)
          </text>

          {/* Горизонтальные уровни I_mean и I_rms ключа */}
          {showMarkers && showIKey && (
            <>
              <line
                x1={padLeft}
                y1={scaleYI(result.iMean)}
                x2={padLeft + plotW}
                y2={scaleYI(result.iMean)}
                stroke="#38bdf8"
                strokeWidth="1.2"
                strokeDasharray="5 3"
                opacity="0.85"
              />
              <text x={padLeft + 10} y={scaleYI(result.iMean) - 4} fill="#38bdf8" fontSize="9" fontFamily="monospace" fontWeight="bold">
                I_mean = {result.iMean} А
              </text>

              <line
                x1={padLeft}
                y1={scaleYI(result.iRms)}
                x2={padLeft + plotW}
                y2={scaleYI(result.iRms)}
                stroke="#0284c7"
                strokeWidth="1.2"
                strokeDasharray="2 2"
                opacity="0.85"
              />
              <text x={padLeft + 120} y={scaleYI(result.iRms) - 4} fill="#0284c7" fontSize="9" fontFamily="monospace">
                I_rms = {result.iRms} А
              </text>
            </>
          )}

          {/* Кривые каналов */}
          {showULoad && (
            <path
              d={pathULoad}
              fill="none"
              stroke="#c084fc"
              strokeWidth="1.6"
              opacity="0.8"
            />
          )}

          {showUKey && (
            <path
              d={pathUKey}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.8"
              opacity="0.9"
            />
          )}

          {showILoad && (
            <path
              d={pathILoad}
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
              opacity="0.85"
            />
          )}

          {showIKey && (
            <path
              d={pathIKey}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.5"
              filter="drop-shadow(0 0 3px rgba(56, 189, 248, 0.4))"
            />
          )}

          {/* Интерактивный визир курсора (Crosshair) */}
          {hoverX !== null && hoverPoint && (
            <g>
              <line
                x1={hoverX}
                y1={padTop}
                x2={hoverX}
                y2={padTop + plotH}
                stroke="#f8fafc"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.8"
              />

              {/* Маркерные точки на кривых в точке курсора */}
              {showIKey && (
                <circle cx={hoverX} cy={scaleYI(hoverPoint.iKey)} r="4.5" fill="#38bdf8" stroke="#fff" strokeWidth="1.5" />
              )}
              {showUKey && (
                <circle cx={hoverX} cy={scaleYU(hoverPoint.uKey)} r="4.5" fill="#fbbf24" stroke="#fff" strokeWidth="1.5" />
              )}
              {showILoad && (
                <circle cx={hoverX} cy={scaleYI(hoverPoint.iLoad)} r="4" fill="#34d399" stroke="#fff" strokeWidth="1.5" />
              )}
            </g>
          )}
        </svg>

        {/* Панель текущих мгновенных значений под курсором */}
        <div className="bg-slate-900/90 border-t border-slate-800 px-4 py-1.5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-1 text-slate-400">
            <Crosshair className="w-3.5 h-3.5 text-slate-300" />
            <span>Курсор:</span>
            {hoverPoint ? (
              <span className="text-white font-semibold">
                t = {(hoverPoint.t * 1000).toFixed(3)} мс
              </span>
            ) : (
              <span className="text-slate-500 italic">Наведите курсор на график</span>
            )}
          </div>

          {hoverPoint && (
            <div className="flex items-center gap-4">
              <span className="text-sky-400 font-semibold">
                i_key = {hoverPoint.iKey.toFixed(2)} А
              </span>
              <span className="text-amber-400 font-semibold">
                u_key = {hoverPoint.uKey.toFixed(1)} В
              </span>
              <span className="text-emerald-400 font-semibold">
                i_нагр = {hoverPoint.iLoad.toFixed(2)} А
              </span>
              <span className="text-purple-400 font-semibold">
                u_нагр = {hoverPoint.uLoad.toFixed(1)} В
              </span>
              <span className="text-slate-400">
                Затвор: <strong className={hoverPoint.gate ? 'text-emerald-400' : 'text-slate-500'}>{hoverPoint.gate ? 'ВКЛ' : 'ВЫКЛ'}</strong>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
