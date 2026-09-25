import React, { useState } from 'react';
import { X, Copy, Check, Printer, FileText } from 'lucide-react';
import { DataPoint, CalculationResult, InterpolationMethod } from '../types';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  points: DataPoint[];
  method: InterpolationMethod;
  polynomialDegree?: number;
  result: CalculationResult | null;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  precision: number;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  points,
  method,
  polynomialDegree = 2,
  result,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  precision,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const nowStr = new Date().toLocaleString('ru-RU');

  let methodTitle = 'Кусочно-линейная интерполяция';
  if (method === 'cubic-spline') {
    methodTitle = "Интерполяция кубическими сплайнами (Cubic Spline, естественные граничные условия S''(x)=0)";
  } else if (method === 'least-squares') {
    methodTitle = `Полиномиальная аппроксимация методом наименьших квадратов (МНК / NumPy np.polyfit, степень полинома: ${result?.polynomialDegree ?? polynomialDegree})`;
  }

  const polyCoeffsText =
    method === 'least-squares' && result?.polynomialCoefficients
      ? `\nКоэффициенты аппроксимирующего полинома (в порядке убывания степеней):\n` +
        result.polynomialCoefficients
          .map((c, idx) => {
            const power = (result.polynomialDegree || polynomialDegree) - idx;
            const termName = power === 0 ? 'c_0 (свободный член)' : power === 1 ? 'c_1 (при X)' : `c_${power} (при X^${power})`;
            return `   • ${termName.padEnd(24)} = ${c >= 0 ? '+' : ''}${c.toFixed(precision + 2)} (науч.: ${c.toExponential(4)})`;
          })
          .join('\n') +
        `\nКритерии качества аппроксимации:\n   • Коэффициент детерминации R²: ${result.rSquared !== undefined ? result.rSquared.toFixed(5) : '—'}\n   • Среднеквадратическая ошибка RMSE: ${result.rmse !== undefined ? result.rmse.toFixed(5) : '—'}`
      : '';

  const reportText = `ПРОТОКОЛ РАСЧЕТА ПАРАМЕТРОВ КОММУТАЦИОННОЙ УСТОЙЧИВОСТИ
(Определение функции Fas min полупроводниковых ключей)
Стандарт оформления: ГОСТ 19.401-2000 / ГОСТ 34.698-90
Дата и время формирования: ${nowStr}
Программный комплекс: Fastmin Calc v1.0.0

================================================================================
1. ИСХОДНЫЕ ДАННЫЕ (ТАБЛИЦА ЭКСПЕРИМЕНТАЛЬНОЙ КРИВОЙ)
Аргумент X: ${xLabel} [${xUnit}]
Функция Y:  ${yLabel} [${yUnit}]
Количество опорных точек: ${sorted.length}

№ п/п |   ${xLabel.padEnd(14)}   |   ${yLabel.padEnd(16)}
--------------------------------------------------------------------------------
${sorted
  .map(
    (p, i) =>
      `${String(i + 1).padStart(3)}   |  ${p.x.toFixed(precision).padStart(12)} ${xUnit}  |  ${p.y.toFixed(precision).padStart(14)} ${yUnit}`
  )
  .join('\n')}
--------------------------------------------------------------------------------
Диапазон определения: [${sorted[0]?.x} ... ${sorted[sorted.length - 1]?.x}] ${xUnit}

================================================================================
2. ПАРАМЕТРЫ ВЫЧИСЛИТЕЛЬНОГО ЯДРА
Метод аппроксимации: ${methodTitle}
Точность округления: ${precision} знаков после запятой
Целевое значение аргумента: X_цел = ${result?.targetX.toFixed(precision)} ${xUnit}

================================================================================
3. РЕЗУЛЬТАТЫ РАСЧЕТА
Расчетное значение функции: Y_расч = ${result?.targetY !== null && result?.targetY !== undefined ? result.targetY.toFixed(precision) : '—'} ${yUnit}
Режим расчета: ${result?.isExtrapolated ? `ВНИМАНИЕ: ЭКСТРАПОЛЯЦИЯ (${result.extrapolationType === 'left' ? 'левая' : 'правая'}) за пределы диапазона` : 'Интерполяция в рабочем диапазоне [Xmin, Xmax]'}
${result?.segmentIndex !== undefined ? `Рабочий интервал: Сегмент #${result.segmentIndex + 1}` : ''}
${result?.segmentFormula ? `Уравнение аппроксимирующей функции:\n${result.segmentFormula}` : ''}${polyCoeffsText}
${result?.slope !== undefined ? `Локальная скорость изменения (производная dY/dX): ${result.slope.toFixed(precision)} ${yUnit}/${xUnit}` : ''}

================================================================================
ЗАКЛЮЧЕНИЕ
Значение минимально допустимой частоты коммутации Fas min для заданного режима
составляет ${result?.targetY !== null && result?.targetY !== undefined ? result.targetY.toFixed(precision) : '—'} ${yUnit}.
Расчет проверен в соответствии с алгоритмами ГОСТ 19/34.
`;

  const handleCopy = () => {
    navigator.clipboard.writeText(reportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-300 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-semibold">
              Протокол расчета по ГОСТ 19 / 34 (Отчет для пояснительной записки ВКР)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-sm transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-100 px-5 py-2 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-600 font-medium">
            Текстовый отчет готов для копирования в раздел «Расчетная часть» диплома
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопировано!' : 'Копировать текст'}</span>
            </button>
            <button
              onClick={handlePrint}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Печать</span>
            </button>
          </div>
        </div>

        <div className="flex-1 p-5 bg-slate-50 overflow-y-auto">
          <pre className="font-mono text-xs text-slate-800 bg-white p-4 rounded border border-slate-200 shadow-2xs whitespace-pre-wrap leading-relaxed">
            {reportText}
          </pre>
        </div>

        <div className="px-5 py-2.5 bg-slate-100 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-medium cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
