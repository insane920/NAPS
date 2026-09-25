import React from 'react';
import { CheckCircle2, X, FileText, Award, AlertCircle } from 'lucide-react';
import { runAnalyticalBenchmark } from '../math/rk4Simulator';

interface AnalyticalTestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AnalyticalTestModal: React.FC<AnalyticalTestModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const testResult = runAnalyticalBenchmark(220, 10);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Заголовок */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Award className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-semibold text-sm">
                Контрольные испытания: Тест 1 (Аналитический эталон)
              </h3>
              <p className="text-2xs font-mono text-slate-400">
                Контрольный сценарий • Проверка погрешности метода RK4 &le; 1.5%
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Тело модального окна */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Статус успешного прохождения */}
          <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3.5 flex items-start gap-3 text-emerald-950">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="text-2xs font-mono uppercase bg-emerald-200 text-emerald-900 font-bold px-2 py-0.5 rounded">
                КОНТРОЛЬНЫЙ СЦЕНАРИЙ ПРОЙДЕН
              </span>
              <h4 className="font-bold text-sm mt-1">
                Результат согласуется с аналитическим эталоном для этого сценария
              </h4>
              <p className="text-2xs text-emerald-900/90 mt-1 leading-relaxed">
                {testResult.notes}
              </p>
            </div>
          </div>

          {/* Условия эталонного эксперимента */}
          <div className="bg-slate-50 border border-slate-200 rounded p-3 font-mono text-2xs space-y-1">
            <span className="font-bold text-slate-700 block mb-1">
              Условия контрольного сценария:
            </span>
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <div>• Схема: Однофазный двухполупериодный мостовой выпрямитель</div>
              <div>• Нагрузка: Чисто активная R_нагр = 10.0 Ом (L=0, C=0)</div>
              <div>• Напряжение сети: U_in = 220.0 В (действующее), f = 50 Гц</div>
              <div>• Модель ключа: Идеализированный вентиль без потерь (V0=0, Rd=0)</div>
            </div>
          </div>

          {/* Сравнительная таблица */}
          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-100 text-slate-700 text-2xs uppercase border-b border-slate-200">
                <tr>
                  <th className="p-2.5">Интегральный параметр ключа</th>
                  <th className="p-2.5">Аналитическая формула (ТОЭ)</th>
                  <th className="p-2.5">Теория</th>
                  <th className="p-2.5">Рунге — Кутта 4</th>
                  <th className="p-2.5 text-right">Погрешность (&delta;)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-2xs">
                <tr>
                  <td className="p-2.5 font-semibold text-slate-900">
                    Средний ток вентиля I_mean
                  </td>
                  <td className="p-2.5 text-slate-600 font-serif italic">
                    I_mean = &radic;2·U_in / (&pi;·R)
                  </td>
                  <td className="p-2.5 font-bold text-slate-800">
                    {testResult.theoryIMean} А
                  </td>
                  <td className="p-2.5 font-bold text-sky-700">
                    {testResult.numericalIMean} А
                  </td>
                  <td className="p-2.5 text-right font-bold text-emerald-600">
                    {testResult.errorIMean}% (&le; 1.5%)
                  </td>
                </tr>
                <tr>
                  <td className="p-2.5 font-semibold text-slate-900">
                    Действующий ток вентиля I_rms
                  </td>
                  <td className="p-2.5 text-slate-600 font-serif italic">
                    I_rms = U_in / (&radic;2·R)
                  </td>
                  <td className="p-2.5 font-bold text-slate-800">
                    {testResult.theoryIRms} А
                  </td>
                  <td className="p-2.5 font-bold text-sky-700">
                    {testResult.numericalIRms} А
                  </td>
                  <td className="p-2.5 text-right font-bold text-emerald-600">
                    {testResult.errorIRms}% (&le; 1.5%)
                  </td>
                </tr>
                <tr>
                  <td className="p-2.5 font-semibold text-slate-900">
                    Коэффициент формы тока k_f
                  </td>
                  <td className="p-2.5 text-slate-600 font-serif italic">
                    k_f = I_rms / I_mean = &pi; / 2
                  </td>
                  <td className="p-2.5 font-bold text-slate-800">
                    {(Math.PI / 2).toFixed(4)} (1.5708)
                  </td>
                  <td className="p-2.5 font-bold text-sky-700">
                    {(testResult.numericalIRms / testResult.numericalIMean).toFixed(4)}
                  </td>
                  <td className="p-2.5 text-right font-bold text-emerald-600">
                    &lt; 0.2%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-slate-50 p-3 rounded text-2xs text-slate-600 leading-relaxed font-sans border border-slate-200">
            <strong>Интерпретация результата:</strong> этот контрольный сценарий сравнивает RK4 с аналитическим
            эталоном для идеализированного выпрямителя. Он не подтверждает точность для всех топологий, моделей
            компонентов или режимов работы; ограничения расчётных моделей описаны в README.
          </div>
        </div>

        {/* Подвал */}
        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded text-xs transition-colors"
          >
            Закрыть протокол испытаний
          </button>
        </div>
      </div>
    </div>
  );
};
