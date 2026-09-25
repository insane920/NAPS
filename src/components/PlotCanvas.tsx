import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Move,
  Grid,
  Download,
  FileImage,
  Crosshair,
  Layers,
  Sparkles,
  Maximize2
} from 'lucide-react';
import { DataPoint, InterpolationMethod, CalculationResult } from '../types';
import { generatePlotCurve } from '../math/spline';

interface PlotCanvasProps {
  points: DataPoint[];
  method: InterpolationMethod;
  polynomialDegree?: number;
  result: CalculationResult | null;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  precision: number;
  onSelectTargetX: (xVal: number) => void;
}

export const PlotCanvas: React.FC<PlotCanvasProps> = ({
  points,
  method,
  polynomialDegree = 2,
  result,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  precision,
  onSelectTargetX,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [dimensions, setDimensions] = useState({ width: 700, height: 480 });
  const [showGrid, setShowGrid] = useState(true);
  const [activeTool, setActiveTool] = useState<'pointer' | 'pan'>('pointer');
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Custom View Transform (User Pan & Zoom offsets)
  const [viewTransform, setViewTransform] = useState({
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  // Hovered point state
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; screenX: number; screenY: number; isTarget?: boolean } | null>(null);

  // ResizeObserver for fluid responsiveness
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 50 && height > 50) {
          setDimensions({
            width: Math.floor(width),
            height: Math.floor(height),
          });
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Sorted data points
  const sortedPoints = useMemo(() => {
    return [...points]
      .filter(p => !isNaN(p.x) && !isNaN(p.y) && isFinite(p.x) && isFinite(p.y))
      .sort((a, b) => a.x - b.x);
  }, [points]);

  // Curve points
  const curvePoints = useMemo(() => {
    if (sortedPoints.length < 2) return [];
    return generatePlotCurve(
      sortedPoints,
      method,
      350,
      result?.targetX,
      polynomialDegree
    );
  }, [sortedPoints, method, result?.targetX, polynomialDegree]);

  // Determine base data bounds
  const baseBounds = useMemo(() => {
    if (sortedPoints.length === 0) {
      return { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    }

    let minX = sortedPoints[0].x;
    let maxX = sortedPoints[sortedPoints.length - 1].x;
    let minY = Math.min(...sortedPoints.map(p => p.y));
    let maxY = Math.max(...sortedPoints.map(p => p.y));

    // Factor in curve points
    for (const cp of curvePoints) {
      if (cp.y < minY) minY = cp.y;
      if (cp.y > maxY) maxY = cp.y;
    }

    // Factor in target point
    if (result && result.targetY !== null) {
      if (result.targetX < minX) minX = result.targetX;
      if (result.targetX > maxX) maxX = result.targetX;
      if (result.targetY < minY) minY = result.targetY;
      if (result.targetY > maxY) maxY = result.targetY;
    }

    // Add 12% margin around bounds
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    return {
      minX: minX - spanX * 0.12,
      maxX: maxX + spanX * 0.12,
      minY: Math.max(0, minY - spanY * 0.12), // semiconductor frequencies are positive
      maxY: maxY + spanY * 0.15,
    };
  }, [sortedPoints, curvePoints, result]);

  // Margin layout for axes
  const margin = { top: 35, right: 35, bottom: 65, left: 75 };
  const plotWidth = Math.max(dimensions.width - margin.left - margin.right, 100);
  const plotHeight = Math.max(dimensions.height - margin.top - margin.bottom, 100);

  // Scaled bounds factoring in pan & zoom
  const currentBounds = useMemo(() => {
    const spanX = (baseBounds.maxX - baseBounds.minX) / viewTransform.zoom;
    const spanY = (baseBounds.maxY - baseBounds.minY) / viewTransform.zoom;

    const centerX = (baseBounds.minX + baseBounds.maxX) / 2 - (viewTransform.panX / plotWidth) * spanX;
    const centerY = (baseBounds.minY + baseBounds.maxY) / 2 + (viewTransform.panY / plotHeight) * spanY;

    return {
      minX: centerX - spanX / 2,
      maxX: centerX + spanX / 2,
      minY: centerY - spanY / 2,
      maxY: centerY + spanY / 2,
    };
  }, [baseBounds, viewTransform, plotWidth, plotHeight]);

  // Coordinate transforms
  const dataToScreenX = useCallback(
    (x: number) => {
      const { minX, maxX } = currentBounds;
      return margin.left + ((x - minX) / (maxX - minX)) * plotWidth;
    },
    [currentBounds, margin.left, plotWidth]
  );

  const dataToScreenY = useCallback(
    (y: number) => {
      const { minY, maxY } = currentBounds;
      return margin.top + plotHeight - ((y - minY) / (maxY - minY)) * plotHeight;
    },
    [currentBounds, margin.top, plotHeight]
  );

  const screenToDataX = useCallback(
    (screenX: number) => {
      const { minX, maxX } = currentBounds;
      const xPlot = screenX - margin.left;
      return minX + (xPlot / plotWidth) * (maxX - minX);
    },
    [currentBounds, margin.left, plotWidth]
  );

  // Generate SVG path for the smooth curve
  const curvePathD = useMemo(() => {
    if (curvePoints.length < 2) return '';
    const first = curvePoints[0];
    let d = `M ${dataToScreenX(first.x).toFixed(1)} ${dataToScreenY(first.y).toFixed(1)}`;
    for (let i = 1; i < curvePoints.length; i++) {
      const pt = curvePoints[i];
      d += ` L ${dataToScreenX(pt.x).toFixed(1)} ${dataToScreenY(pt.y).toFixed(1)}`;
    }
    return d;
  }, [curvePoints, dataToScreenX, dataToScreenY]);

  // Compute Grid ticks
  const xTicks = useMemo(() => {
    const { minX, maxX } = currentBounds;
    const span = maxX - minX;
    if (span <= 0) return [];
    const count = Math.max(Math.floor(plotWidth / 80), 4);
    const step = span / count;
    const ticks: number[] = [];
    for (let i = 0; i <= count; i++) {
      ticks.push(minX + i * step);
    }
    return ticks;
  }, [currentBounds, plotWidth]);

  const yTicks = useMemo(() => {
    const { minY, maxY } = currentBounds;
    const span = maxY - minY;
    if (span <= 0) return [];
    const count = Math.max(Math.floor(plotHeight / 50), 4);
    const step = span / count;
    const ticks: number[] = [];
    for (let i = 0; i <= count; i++) {
      ticks.push(minY + i * step);
    }
    return ticks;
  }, [currentBounds, plotHeight]);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === 'pan' || e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;

    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setViewTransform(prev => ({
        ...prev,
        panX: prev.panX + dx,
        panY: prev.panY + dy,
      }));
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // Check hover proximity to discrete points
    const mouseX = e.clientX - svgRect.left;
    const mouseY = e.clientY - svgRect.top;

    // Check target point first
    if (result && result.targetY !== null) {
      const tx = dataToScreenX(result.targetX);
      const ty = dataToScreenY(result.targetY);
      const dist = Math.hypot(mouseX - tx, mouseY - ty);
      if (dist < 14) {
        setHoveredPoint({
          x: result.targetX,
          y: result.targetY,
          screenX: tx,
          screenY: ty,
          isTarget: true,
        });
        return;
      }
    }

    // Check discrete data points
    let found = false;
    for (const p of sortedPoints) {
      const px = dataToScreenX(p.x);
      const py = dataToScreenY(p.y);
      const dist = Math.hypot(mouseX - px, mouseY - py);
      if (dist < 12) {
        setHoveredPoint({
          x: p.x,
          y: p.y,
          screenX: px,
          screenY: py,
          isTarget: false,
        });
        found = true;
        break;
      }
    }

    if (!found) {
      setHoveredPoint(null);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Zoom with mouse wheel
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setViewTransform(prev => ({
      ...prev,
      zoom: Math.min(Math.max(prev.zoom * zoomFactor, 0.2), 20),
    }));
  };

  // Click on plot to select X_target
  const handlePlotClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning || activeTool === 'pan' || e.shiftKey) return;
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;

    const clickX = e.clientX - svgRect.left;
    if (clickX >= margin.left && clickX <= margin.left + plotWidth) {
      const chosenX = screenToDataX(clickX);
      onSelectTargetX(Number(chosenX.toFixed(2)));
    }
  };

  // Toolbar actions
  const handleZoomIn = () => {
    setViewTransform(prev => ({ ...prev, zoom: prev.zoom * 1.25 }));
  };

  const handleZoomOut = () => {
    setViewTransform(prev => ({ ...prev, zoom: Math.max(prev.zoom * 0.8, 0.2) }));
  };

  const handleResetView = () => {
    setViewTransform({ zoom: 1, panX: 0, panY: 0 });
  };

  // Export to SVG
  const handleExportSVG = () => {
    if (!svgRef.current) return;
    const svgContent = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fastmin_calc_${method}_${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export to PNG (high resolution rasterization)
  const handleExportPNG = () => {
    if (!svgRef.current) return;
    const svgElement = svgRef.current;
    const svgContent = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const scale = 2; // 2x high resolution
    canvas.width = dimensions.width * scale;
    canvas.height = dimensions.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);
      ctx.drawImage(img, 0, 0, dimensions.width, dimensions.height);

      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = `fastmin_calc_${method}_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  // Target point coordinates on screen
  const targetScreenX = result && result.targetY !== null ? dataToScreenX(result.targetX) : null;
  const targetScreenY = result && result.targetY !== null ? dataToScreenY(result.targetY) : null;

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
      {/* Matplotlib Style Engineering Toolbar */}
      <div className="px-3 py-2 bg-slate-100/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        {/* Left tools: Mode & Navigation */}
        <div className="flex items-center gap-1">
          <span className="text-2xs font-mono font-semibold text-slate-500 mr-1 uppercase">
            Matplotlib Toolbar
          </span>

          <button
            id="toolbar-pointer-btn"
            type="button"
            onClick={() => setActiveTool('pointer')}
            className={`p-1.5 rounded border text-xs flex items-center gap-1 transition-colors cursor-pointer ${
              activeTool === 'pointer'
                ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
            title="Указатель / Выбор точки кликом на оси X"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-2xs">Выбор X</span>
          </button>

          <button
            id="toolbar-pan-btn"
            type="button"
            onClick={() => setActiveTool('pan')}
            className={`p-1.5 rounded border text-xs flex items-center gap-1 transition-colors cursor-pointer ${
              activeTool === 'pan'
                ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
            title="Панорамирование (Pan / Drag)"
          >
            <Move className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-2xs">Панорама</span>
          </button>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1.5 bg-white hover:bg-slate-50 border border-slate-300 rounded text-slate-700 transition-colors cursor-pointer"
            title="Увеличить масштаб (Zoom In)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1.5 bg-white hover:bg-slate-50 border border-slate-300 rounded text-slate-700 transition-colors cursor-pointer"
            title="Уменьшить масштаб (Zoom Out)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleResetView}
            className="p-1.5 bg-white hover:bg-slate-50 border border-slate-300 rounded text-slate-700 transition-colors cursor-pointer"
            title="Сброс вида к исходным границам данных (Reset View / Home)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1.5 rounded border text-xs transition-colors cursor-pointer ${
              showGrid
                ? 'bg-slate-200 text-slate-800 border-slate-400 font-medium'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
            title="Переключить координатную сетку"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right tools: Legend and Export */}
        <div className="flex items-center gap-1.5">
          <span className="hidden md:inline-flex items-center gap-1 text-2xs text-slate-500 font-mono">
            Масштаб: {(viewTransform.zoom * 100).toFixed(0)}%
          </span>

          <div className="h-4 w-px bg-slate-300 mx-1 hidden sm:block" />

          <button
            id="export-png-btn"
            type="button"
            onClick={handleExportPNG}
            className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-medium rounded flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
            title="Сохранить график в формате PNG (растровый ГОСТ)"
          >
            <FileImage className="w-3.5 h-3.5 text-blue-600" />
            <span>.PNG</span>
          </button>

          <button
            id="export-svg-btn"
            type="button"
            onClick={handleExportSVG}
            className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-medium rounded flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
            title="Сохранить график в векторном формате SVG для отчета ВКР"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>.SVG</span>
          </button>
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div
        ref={containerRef}
        className="flex-1 w-full min-h-[380px] relative bg-white select-none overflow-hidden"
      >
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onClick={handlePlotClick}
          className={`w-full h-full block ${activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
        >
          <defs>
            {/* Target marker gradient */}
            <radialGradient id="targetGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="1" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.8" />
            </radialGradient>
            <filter id="shadowFilter" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="1" dy="2" stdDeviation="2" floodColor="#000000" floodOpacity="0.15" />
            </filter>
          </defs>

          {/* Plot Background Area */}
          <rect
            x={margin.left}
            y={margin.top}
            width={plotWidth}
            height={plotHeight}
            fill="#ffffff"
            stroke="#cbd5e1"
            strokeWidth="1.2"
          />

          {/* Coordinate Grid (Major and Minor) */}
          {showGrid && (
            <g className="grid-lines">
              {/* Vertical Grid Lines */}
              {xTicks.map((tick, i) => {
                const x = dataToScreenX(tick);
                if (x < margin.left || x > margin.left + plotWidth) return null;
                return (
                  <line
                    key={`grid-x-${i}`}
                    x1={x}
                    y1={margin.top}
                    x2={x}
                    y2={margin.top + plotHeight}
                    stroke="#f1f5f9"
                    strokeWidth="1"
                    strokeDasharray={i % 2 === 0 ? undefined : '2,2'}
                  />
                );
              })}

              {/* Horizontal Grid Lines */}
              {yTicks.map((tick, i) => {
                const y = dataToScreenY(tick);
                if (y < margin.top || y > margin.top + plotHeight) return null;
                return (
                  <line
                    key={`grid-y-${i}`}
                    x1={margin.left}
                    y1={y}
                    x2={margin.left + plotWidth}
                    y2={y}
                    stroke="#f1f5f9"
                    strokeWidth="1"
                    strokeDasharray={i % 2 === 0 ? undefined : '2,2'}
                  />
                );
              })}
            </g>
          )}

          {/* Extrapolation region highlight if applicable */}
          {sortedPoints.length >= 2 && (
            <g className="extrapolation-zones">
              {/* Left extrapolation zone */}
              {dataToScreenX(sortedPoints[0].x) > margin.left && (
                <rect
                  x={margin.left}
                  y={margin.top}
                  width={Math.max(0, dataToScreenX(sortedPoints[0].x) - margin.left)}
                  height={plotHeight}
                  fill="#fffbeb"
                  opacity="0.4"
                />
              )}
              {/* Right extrapolation zone */}
              {dataToScreenX(sortedPoints[sortedPoints.length - 1].x) < margin.left + plotWidth && (
                <rect
                  x={dataToScreenX(sortedPoints[sortedPoints.length - 1].x)}
                  y={margin.top}
                  width={Math.max(0, margin.left + plotWidth - dataToScreenX(sortedPoints[sortedPoints.length - 1].x))}
                  height={plotHeight}
                  fill="#fffbeb"
                  opacity="0.4"
                />
              )}
            </g>
          )}

          {/* Interpolated Smooth Curve */}
          {curvePathD && (
            <path
              d={curvePathD}
              fill="none"
              stroke={
                method === 'cubic-spline'
                  ? '#4f46e5'
                  : method === 'least-squares'
                  ? '#0d9488'
                  : '#0284c7'
              }
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Linear Segments dashed visual comparison if cubic spline is active */}
          {method === 'cubic-spline' && sortedPoints.length >= 2 && (
            <g className="linear-segments-ref" opacity="0.3">
              {sortedPoints.map((p, i) => {
                if (i === 0) return null;
                const prev = sortedPoints[i - 1];
                return (
                  <line
                    key={`linear-ref-${i}`}
                    x1={dataToScreenX(prev.x)}
                    y1={dataToScreenY(prev.y)}
                    x2={dataToScreenX(p.x)}
                    y2={dataToScreenY(p.y)}
                    stroke="#94a3b8"
                    strokeWidth="1.2"
                    strokeDasharray="3,3"
                  />
                );
              })}
            </g>
          )}

          {/* Target Working Point Projections (Section 3.3: пунктирные линии проекции) */}
          {targetScreenX !== null && targetScreenY !== null && (
            <g className="target-point-projections" filter="url(#shadowFilter)">
              {/* Vertical projection line to X-axis */}
              <line
                x1={targetScreenX}
                y1={targetScreenY}
                x2={targetScreenX}
                y2={margin.top + plotHeight}
                stroke="#10b981"
                strokeWidth="1.8"
                strokeDasharray="4,3"
              />
              {/* Horizontal projection line to Y-axis */}
              <line
                x1={targetScreenX}
                y1={targetScreenY}
                x2={margin.left}
                y2={targetScreenY}
                stroke="#10b981"
                strokeWidth="1.8"
                strokeDasharray="4,3"
              />

              {/* X-axis projection label badge */}
              <g transform={`translate(${targetScreenX}, ${margin.top + plotHeight})`}>
                <polygon points="-5,0 5,0 0,-6" fill="#10b981" />
                <rect
                  x="-32"
                  y="4"
                  width="64"
                  height="18"
                  rx="3"
                  fill="#065f46"
                />
                <text
                  x="0"
                  y="16"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="10"
                  fontFamily="'Fira Code', monospace"
                  fontWeight="600"
                >
                  {result?.targetX.toFixed(precision)}
                </text>
              </g>

              {/* Y-axis projection label badge */}
              <g transform={`translate(${margin.left}, ${targetScreenY})`}>
                <polygon points="0,-5 0,5 -6,0" fill="#10b981" />
                <rect
                  x="-62"
                  y="-9"
                  width="56"
                  height="18"
                  rx="3"
                  fill="#065f46"
                />
                <text
                  x="-34"
                  y="3.5"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="10"
                  fontFamily="'Fira Code', monospace"
                  fontWeight="600"
                >
                  {result?.targetY?.toFixed(precision)}
                </text>
              </g>

              {/* Target Point Marker */}
              <circle
                cx={targetScreenX}
                cy={targetScreenY}
                r="7"
                fill="url(#targetGlow)"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <circle
                cx={targetScreenX}
                cy={targetScreenY}
                r="2.5"
                fill="#ffffff"
              />
            </g>
          )}

          {/* Discrete Experimental Points (Section 3.3: контрастные маркеры) */}
          <g className="data-points">
            {sortedPoints.map((p, i) => {
              const cx = dataToScreenX(p.x);
              const cy = dataToScreenY(p.y);
              const isOutOfBounds =
                cx < margin.left ||
                cx > margin.left + plotWidth ||
                cy < margin.top ||
                cy > margin.top + plotHeight;

              if (isOutOfBounds) return null;

              return (
                <g key={`data-pt-${i}`} className="cursor-pointer transition-transform">
                  {/* Outer halo */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r="5.5"
                    fill="#1e293b"
                    stroke="#ffffff"
                    strokeWidth="1.8"
                    className="hover:scale-125 transition-transform"
                  />
                  {/* Inner center dot */}
                  <circle cx={cx} cy={cy} r="2" fill="#38bdf8" />
                </g>
              );
            })}
          </g>

          {/* X Axis & Ticks */}
          <g className="x-axis">
            <line
              x1={margin.left}
              y1={margin.top + plotHeight}
              x2={margin.left + plotWidth}
              y2={margin.top + plotHeight}
              stroke="#64748b"
              strokeWidth="1.5"
            />
            {xTicks.map((tick, i) => {
              const x = dataToScreenX(tick);
              if (x < margin.left - 2 || x > margin.left + plotWidth + 2) return null;
              return (
                <g key={`tick-x-${i}`} transform={`translate(${x}, ${margin.top + plotHeight})`}>
                  <line y2="5" stroke="#64748b" strokeWidth="1.2" />
                  <text
                    y="18"
                    textAnchor="middle"
                    fontSize="11"
                    fontFamily="'Fira Code', monospace"
                    fill="#475569"
                  >
                    {tick.toFixed(1)}
                  </text>
                </g>
              );
            })}
            {/* X-axis title */}
            <text
              x={margin.left + plotWidth / 2}
              y={dimensions.height - 18}
              textAnchor="middle"
              fontSize="12"
              fontWeight="600"
              fill="#334155"
            >
              {xLabel} [{xUnit}] →
            </text>
          </g>

          {/* Y Axis & Ticks */}
          <g className="y-axis">
            <line
              x1={margin.left}
              y1={margin.top}
              x2={margin.left}
              y2={margin.top + plotHeight}
              stroke="#64748b"
              strokeWidth="1.5"
            />
            {yTicks.map((tick, i) => {
              const y = dataToScreenY(tick);
              if (y < margin.top - 2 || y > margin.top + plotHeight + 2) return null;
              return (
                <g key={`tick-y-${i}`} transform={`translate(${margin.left}, ${y})`}>
                  <line x2="-5" stroke="#64748b" strokeWidth="1.2" />
                  <text
                    x="-9"
                    y="3.5"
                    textAnchor="end"
                    fontSize="11"
                    fontFamily="'Fira Code', monospace"
                    fill="#475569"
                  >
                    {tick.toFixed(1)}
                  </text>
                </g>
              );
            })}
            {/* Y-axis title (rotated) */}
            <text
              transform={`translate(22, ${margin.top + plotHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize="12"
              fontWeight="600"
              fill="#334155"
            >
              ↑ {yLabel} [{yUnit}]
            </text>
          </g>

          {/* Interactive Legend Box inside Chart */}
          <g
            transform={`translate(${margin.left + plotWidth - 210}, ${margin.top + 12})`}
            filter="url(#shadowFilter)"
          >
            <rect
              width="200"
              height="74"
              rx="4"
              fill="#ffffff"
              fillOpacity="0.95"
              stroke="#cbd5e1"
              strokeWidth="1"
            />
            {/* Legend Line: Curve */}
            <line
              x1="12"
              y1="18"
              x2="38"
              y2="18"
              stroke={
                method === 'cubic-spline'
                  ? '#4f46e5'
                  : method === 'least-squares'
                  ? '#0d9488'
                  : '#0284c7'
              }
              strokeWidth="2.5"
            />
            <text x="46" y="22" fontSize="11" fill="#1e293b" fontWeight="500">
              {method === 'cubic-spline'
                ? 'Сплайн S(x) (SciPy)'
                : method === 'least-squares'
                ? `МНК P_${polynomialDegree}(x) (NumPy)`
                : 'Кусочно-линейная F(x)'}
            </text>

            {/* Legend Marker: Experimental Points */}
            <circle cx="25" cy="38" r="4.5" fill="#1e293b" stroke="#ffffff" strokeWidth="1.5" />
            <circle cx="25" cy="38" r="1.5" fill="#38bdf8" />
            <text x="46" y="42" fontSize="11" fill="#1e293b">
              Эксперимент ({sortedPoints.length} т.)
            </text>

            {/* Legend Marker: Target Point */}
            <circle cx="25" cy="58" r="5" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
            <text x="46" y="62" fontSize="11" fill="#047857" fontWeight="600">
              Рабочая точка (Xцел, Yрасч)
            </text>
          </g>
        </svg>

        {/* Hover Tooltip */}
        {hoveredPoint && (
          <div
            className="absolute pointer-events-none z-20 px-2.5 py-1.5 bg-slate-900/95 text-white rounded-md text-xs font-mono shadow-lg border border-slate-700"
            style={{
              left: `${Math.min(hoveredPoint.screenX + 12, dimensions.width - 150)}px`,
              top: `${Math.max(hoveredPoint.screenY - 45, 10)}px`,
            }}
          >
            <div className="font-semibold text-2xs uppercase tracking-wider text-slate-400 mb-0.5">
              {hoveredPoint.isTarget ? '★ Целевая расчетная точка' : 'Опорная точка кривой'}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-300">X = {hoveredPoint.x.toFixed(precision)}</span>
              <span className="text-emerald-400 font-bold">Y = {hoveredPoint.y.toFixed(precision)}</span>
            </div>
          </div>
        )}

        {/* Bottom hint banner */}
        <div className="absolute bottom-1 right-2 text-3xs font-mono text-slate-600 pointer-events-none">
          Клик по полю графика задает Xцел • Колесико мыши: масштаб
        </div>
      </div>
    </div>
  );
};
