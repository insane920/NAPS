import React, { useState } from 'react';
import {
  Calculator,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Hash,
  Info,
  Layers,
  Copy,
  Check,
  Binary,
  TrendingUp,
  Activity
} from 'lucide-react';
import { CalculationResult, InterpolationMethod } from '../types';

interface ControlPanelProps {
  method: InterpolationMethod;
  onMethodChange: (m: InterpolationMethod) => void;
  polynomialDegree: number;
  onPolynomialDegreeChange: (deg: number) => void;
  validPointCount: number;
  targetXInput: string;
  onTargetXChange: (val: string) => void;
  precision: number;
  onPrecisionChange: (p: number) => void;
  result: CalculationResult | null;
  onCalculate: () => void;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  xMin: number;
  xMax: number;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  method,
  onMethodChange,
  polynomialDegree,
  onPolynomialDegreeChange,
  validPointCount,
  targetXInput,
  onTargetXChange,
  precision,
  onPrecisionChange,
  result,
  onCalculate,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  xMin,
  xMax,
}) => {
  const [copiedFormula, setCopiedFormula] = useState(false);
  const currentNumX = Number(targetXInput.replace(',', '.'));
  const isValidNum = !isNaN(currentNumX) && isFinite(currentNumX) && targetXInput.trim() !== '';

  const maxAllowedDegree = Math.max(1, Math.min(validPointCount - 1, 5));

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onTargetXChange(e.target.value);
  };

  const stepAdjust = (delta: number) => {
    const base = isValidNum ? currentNumX : (xMin + xMax) / 2;
    const nextVal = Number((base + delta).toFixed(2));
    onTargetXChange(String(nextVal));
  };

  const handleCopyFormula = (formulaText: string) => {
    navigator.clipboard.writeText(formulaText);
    setCopiedFormula(true);
    setTimeout(() => setCopiedFormula(false), 2000);
  };

  // Slider bounds (extend by 20% to allow testing extrapolation easily)
  const span = Math.max(xMax - xMin, 10);
  const sliderMin = Number((xMin - span * 0.25).toFixed(1));
  const sliderMax = Number((xMax + span * 0.25).toFixed(1));
  const sliderStep = Number((span / 200).toFixed(2)) || 0.1;

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-4 space-y-4">
      {/* Method Selection */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-600" />
            Метод аппроксимации / интерполяции
          </span>
          <span className="text-2xs font-mono text-slate-600">ГОСТ 19 / NumPy</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            id="method-spline-btn"
            type="button"
            onClick={() => onMethodChange('cubic-spline')}
            className={`px-3 py-2 text-xs font-medium rounded-md border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
              method === 'cubic-spline'
                ? 'bg-indigo-50/90 border-indigo-500 text-indigo-950 ring-1 ring-indigo-500 shadow-2xs'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="font-semibold flex items-center justify-between">
              Кубический сплайн
              {method === 'cubic-spline' && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />}
            </span>
            <span className="text-3xs text-slate-600 leading-tight">
              Cubic Spline (C² непрерывность)
            </span>
          </button>

          <button
            id="method-linear-btn"
            type="button"
            onClick={() => onMethodChange('linear')}
            className={`px-3 py-2 text-xs font-medium rounded-md border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
              method === 'linear'
                ? 'bg-indigo-50/90 border-indigo-500 text-indigo-950 ring-1 ring-indigo-500 shadow-2xs'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="font-semibold flex items-center justify-between">
              Кусочно-линейная
              {method === 'linear' && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />}
            </span>
            <span className="text-3xs text-slate-600 leading-tight">
              Отрезки между точками
            </span>
          </button>

          <button
            id="method-ls-btn"
            type="button"
            onClick={() => onMethodChange('least-squares')}
            className={`px-3 py-2 text-xs font-medium rounded-md border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
              method === 'least-squares'
                ? 'bg-indigo-50/90 border-indigo-500 text-indigo-950 ring-1 ring-indigo-500 shadow-2xs'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="font-semibold flex items-center justify-between">
              МНК полином (NumPy)
              {method === 'least-squares' && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />}
            </span>
            <span className="text-3xs text-slate-600 leading-tight">
              Полином наим. квадратов
            </span>
          </button>
        </div>
      </div>

      {/* Degree Selection for Least Squares */}
      {method === 'least-squares' && (
        <div className="bg-indigo-50/60 border border-indigo-200/70 rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-indigo-950 flex items-center gap-1.5">
              <Binary className="w-3.5 h-3.5 text-indigo-600" />
              Степень аппроксимирующего полинома:
            </label>
            <span className="text-2xs font-mono text-indigo-700">
              Макс. {maxAllowedDegree} (N={validPointCount})
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5].map(deg => {
              const isDisabled = deg > maxAllowedDegree;
              const isSelected = polynomialDegree === deg;
              const degreeLabels: Record<number, string> = {
                1: '1 (Линейный)',
                2: '2 (Квадрат)',
                3: '3 (Кубический)',
                4: '4 (4-я степ.)',
                5: '5 (5-я степ.)',
              };

              return (
                <button
                  key={deg}
                  id={`poly-deg-btn-${deg}`}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onPolynomialDegreeChange(deg)}
                  className={`px-2.5 py-1 text-xs font-mono rounded border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 border-indigo-700 text-white font-semibold shadow-2xs'
                      : isDisabled
                      ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-50 hover:border-indigo-300'
                  }`}
                  title={
                    isDisabled
                      ? `Требуется минимум ${deg + 1} опорных точек в таблице`
                      : `Степень ${deg}`
                  }
                >
                  {degreeLabels[deg] || `${deg}-я`}
                </button>
              );
            })}
          </div>

          <p className="text-3xs text-indigo-800/80 leading-tight">
            Оптимизация параметров по критерию минимума суммы квадратов отклонений: ∑(y_i - P(x_i))² → min (NumPy <code className="font-mono bg-indigo-100/70 px-1 rounded">np.polyfit</code>).
          </p>
        </div>
      )}

      {/* Target Point X_цел input */}
      <div className="pt-2 border-t border-slate-100 space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="target-x-input"
            className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5"
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-600" />
            Целевая точка X<sub>цел</sub> ({xLabel})
          </label>
          <span className="text-xs font-mono text-slate-600">
            [{xMin.toFixed(1)} ... {xMax.toFixed(1)}] {xUnit}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              id="target-x-input"
              type="text"
              value={targetXInput}
              onChange={e => onTargetXChange(e.target.value.replace(',', '.'))}
              onKeyDown={e => e.key === 'Enter' && onCalculate()}
              placeholder={`например, ${((xMin + xMax) / 2).toFixed(1)}`}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-md font-mono text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-hidden text-slate-900"
            />
            <span className="absolute right-2.5 top-2 text-xs font-mono text-slate-600">
              {xUnit}
            </span>
          </div>

          {/* Micro step adjustments */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepAdjust(-span * 0.05)}
              className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-xs font-mono text-slate-700 cursor-pointer"
              title="Уменьшить X"
            >
              -
            </button>
            <button
              type="button"
              onClick={() => stepAdjust(span * 0.05)}
              className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-xs font-mono text-slate-700 cursor-pointer"
              title="Увеличить X"
            >
              +
            </button>
          </div>

          {/* Calculate Button */}
          <button
            id="calculate-btn"
            type="button"
            onClick={onCalculate}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-medium text-xs rounded-md shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>Рассчитать</span>
          </button>
        </div>

        {/* Quick Slider for real-time exploratory parameter scanning */}
        {isValidNum && (
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-3xs font-mono text-slate-600">
              <span>{sliderMin} (Экстрапол. L)</span>
              <span>Текущее: {currentNumX}</span>
              <span>{sliderMax} (Экстрапол. R)</span>
            </div>
            <input
              id="target-x-slider"
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={sliderStep}
              value={currentNumX}
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
        )}
      </div>

      {/* Precision and Options */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          <Hash className="w-3.5 h-3.5 text-slate-400" />
          <span>Точность округления (знаков после запятой):</span>
        </label>
        <select
          id="precision-select"
          value={precision}
          onChange={e => onPrecisionChange(Number(e.target.value))}
          className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs font-mono text-slate-700 cursor-pointer focus:outline-hidden"
        >
          <option value={1}>1 знак (0.1)</option>
          <option value={2}>2 знака (0.01)</option>
          <option value={3}>3 знака (0.001) [ГОСТ ТЗ]</option>
          <option value={4}>4 знака (0.0001)</option>
          <option value={5}>5 знаков (0.00001)</option>
          <option value={6}>6 знаков</option>
        </select>
      </div>

      {/* Result Display Block (Section 3.4 of ТЗ) */}
      <div className="pt-2 border-t border-slate-100">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2 flex items-center justify-between">
          <span>Результат вычисления (Y<sub>расч</sub>)</span>
          {result && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-semibold ${
                result.isExtrapolated
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
              }`}
            >
              {result.isExtrapolated ? (
                <>
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  Режим экстраполяции
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Интерполяция в диапазоне
                </>
              )}
            </span>
          )}
        </div>

        {result && result.targetY !== null ? (
          <div className="bg-slate-900 text-white rounded-lg p-3.5 space-y-3 shadow-xs">
            <div className="flex items-baseline justify-between border-b border-slate-800 pb-2">
              <div>
                <span className="text-slate-400 text-xs font-mono">
                  {yLabel} F<sub>as min</sub>:
                </span>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span
                    id="calculated-y-value"
                    className="text-2xl font-bold font-mono text-emerald-400 tracking-tight"
                  >
                    {result.targetY.toFixed(precision)}
                  </span>
                  <span className="text-slate-300 font-mono text-sm">{yUnit}</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-slate-400 text-3xs font-mono block">при X<sub>цел</sub></span>
                <span className="text-sm font-mono text-slate-200">
                  {result.targetX.toFixed(precision)} {xUnit}
                </span>
              </div>
            </div>

            {/* Extrapolation Alert Details */}
            {result.isExtrapolated && (
              <div className="bg-amber-950/80 border border-amber-500/40 rounded p-2 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-tight space-y-0.5">
                  <p className="font-semibold text-amber-300">
                    Внимание: Выход за границы таблицы [X<sub>min</sub>={result.xMin}, X<sub>max</sub>={result.xMax}]
                  </p>
                  <p className="text-3xs text-amber-200/80">
                    {result.method === 'least-squares'
                      ? 'Значение вычислено по полиномиальной кривой МНК за пределами экспериментальных данных.'
                      : `Расчет произведен по касательной краевого сегмента (${result.extrapolationType === 'left' ? 'левая экстраполяция' : 'правая экстраполяция'}). Точность снижена.`}
                  </p>
                </div>
              </div>
            )}

            {/* Polynomial Coefficients Display (Specifically requested) */}
            {result.method === 'least-squares' && result.polynomialCoefficients && (
              <div className="bg-slate-950/80 p-2.5 rounded border border-indigo-900/50 space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                    <Binary className="w-3.5 h-3.5 text-indigo-400" />
                    Коэффициенты полинома (NumPy polyfit, deg={result.polynomialDegree}):
                  </span>
                  {result.polynomialFormula && (
                    <button
                      type="button"
                      onClick={() => handleCopyFormula(result.polynomialFormula!)}
                      className="text-3xs font-mono text-slate-400 hover:text-white flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer"
                      title="Скопировать формулу"
                    >
                      {copiedFormula ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedFormula ? 'Скопировано' : 'Копировать'}</span>
                    </button>
                  )}
                </div>

                {/* Polynomial Formula */}
                {result.polynomialFormula && (
                  <div className="text-2xs font-mono text-emerald-300 bg-slate-900 px-2 py-1.5 rounded border border-slate-800 break-all">
                    {result.polynomialFormula}
                  </div>
                )}

                {/* Individual Coefficients Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {result.polynomialCoefficients.map((coeff, idx) => {
                    const power = (result.polynomialDegree || 0) - idx;
                    const absVal = Math.abs(coeff);
                    const formatted =
                      absVal >= 1e4 || (absVal > 0 && absVal < 1e-3)
                        ? coeff.toExponential(4)
                        : coeff.toFixed(precision + 1);

                    return (
                      <div
                        key={idx}
                        className="bg-slate-900/90 px-2 py-1 rounded border border-slate-800 flex flex-col"
                      >
                        <div className="text-3xs font-mono text-slate-400 flex items-center justify-between">
                          <span>
                            {power === 0 ? 'c₀ (своб. член)' : power === 1 ? 'c₁ (при X)' : `c_${power} (при X^${power})`}
                          </span>
                        </div>
                        <span className="text-xs font-mono font-medium text-amber-300 truncate" title={String(coeff)}>
                          {formatted}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Quality Metrics: R^2, RMSE, Derivative */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-3xs font-mono text-slate-300">
                  <div className="flex items-center gap-2">
                    {result.rSquared !== undefined && (
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-emerald-400" />
                        <span>R² = </span>
                        <strong className="text-emerald-400 font-semibold">
                          {result.rSquared.toFixed(4)}
                        </strong>
                      </span>
                    )}
                    {result.rmse !== undefined && (
                      <span className="text-slate-400">
                        RMSE = {result.rmse.toFixed(3)}
                      </span>
                    )}
                  </div>
                  {result.slope !== undefined && (
                    <span className="text-indigo-300 flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      <span>dY/dX = {result.slope.toFixed(precision)}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Segment Formula for Spline / Linear */}
            {result.method !== 'least-squares' && result.segmentFormula && (
              <div className="text-2xs font-mono text-slate-300 bg-slate-950/70 p-2 rounded border border-slate-800 space-y-1">
                <div className="text-slate-400 flex items-center justify-between">
                  <span>Уравнение сегмента #{result.segmentIndex !== undefined ? result.segmentIndex + 1 : 1}:</span>
                  {result.slope !== undefined && (
                    <span className="text-indigo-300">
                      Производная dY/dX = {result.slope.toFixed(precision)}
                    </span>
                  )}
                </div>
                <div className="text-emerald-300 break-all">{result.segmentFormula}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-400 flex flex-col items-center gap-1">
            <Info className="w-5 h-5 text-slate-300" />
            <span>Задайте точку X<sub>цел</sub> и нажмите «Рассчитать»</span>
          </div>
        )}
      </div>
    </div>
  );
};

