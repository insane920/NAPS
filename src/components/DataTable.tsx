import React, { useState } from 'react';
import { Plus, Trash2, ArrowDownUp, ClipboardPaste, RotateCcw, AlertTriangle, Check } from 'lucide-react';
import { DataPoint, InterpolationMethod } from '../types';

interface DataTableProps {
  points: DataPoint[];
  method: InterpolationMethod;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  onPointsChange: (points: DataPoint[]) => void;
  onSortPoints: () => void;
  onClear: () => void;
  onShowAlert: (title: string, text: string, type?: 'critical' | 'warning' | 'information') => void;
}

export const DataTable: React.FC<DataTableProps> = ({
  points,
  method,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  onPointsChange,
  onSortPoints,
  onClear,
  onShowAlert,
}) => {
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const minRequired = method === 'cubic-spline' ? 3 : 2;
  const isPointCountSufficient = points.length >= minRequired;

  // Check if sorted
  const isSorted = points.every((p, i) => i === 0 || p.x >= points[i - 1].x);

  // Check duplicates
  const hasDuplicates = points.some((p, i) =>
    points.some((other, j) => i !== j && Math.abs(p.x - other.x) < 1e-12)
  );

  const handlePointChange = (id: string, field: 'x' | 'y', rawVal: string) => {
    // Auto-replace comma with period
    const normalized = rawVal.replace(',', '.');

    // Filter invalid characters: allow digits, one dot, leading minus
    if (normalized !== '' && normalized !== '-' && !/^-?\d*\.?\d*$/.test(normalized)) {
      return; // reject illegal character
    }

    const updated = points.map(p => {
      if (p.id !== id) return p;
      const num = Number(normalized);
      const isValidNum = normalized !== '' && normalized !== '-' && !isNaN(num);

      if (field === 'x') {
        return {
          ...p,
          xRaw: normalized,
          x: isValidNum ? num : p.x,
        };
      } else {
        return {
          ...p,
          yRaw: normalized,
          y: isValidNum ? num : p.y,
        };
      }
    });

    onPointsChange(updated);
  };

  const handleAddRow = () => {
    // Generate a default point based on last row or default
    let nextX = 10;
    let nextY = 10;
    if (points.length > 0) {
      const last = points[points.length - 1];
      const prev = points.length > 1 ? points[points.length - 2] : null;
      const step = prev ? Math.max(last.x - prev.x, 1) : 10;
      nextX = Number((last.x + step).toFixed(2));
      nextY = Number((last.y * 0.85).toFixed(2));
    }

    const newPoint: DataPoint = {
      id: 'pt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      x: nextX,
      y: nextY,
      xRaw: String(nextX),
      yRaw: String(nextY),
    };

    onPointsChange([...points, newPoint]);
  };

  const handleDeleteRow = (id: string) => {
    if (points.length <= 1) {
      onShowAlert('Предупреждение таблицы', 'В таблице должна оставаться хотя бы одна строка.', 'warning');
      return;
    }
    onPointsChange(points.filter(p => p.id !== id));
  };

  const handleBatchPaste = () => {
    if (!pasteText.trim()) {
      setPasteModalOpen(false);
      return;
    }

    const lines = pasteText.trim().split(/\r?\n/);
    const parsedPoints: DataPoint[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // split by tab, semicolon, comma, or space
      const parts = line.split(/[\t;, ]+/).map(s => s.replace(',', '.').trim());
      if (parts.length >= 2) {
        const xNum = Number(parts[0]);
        const yNum = Number(parts[1]);
        if (!isNaN(xNum) && !isNaN(yNum) && isFinite(xNum) && isFinite(yNum)) {
          parsedPoints.push({
            id: 'pt_pasted_' + i + '_' + Date.now(),
            x: xNum,
            y: yNum,
            xRaw: String(xNum),
            yRaw: String(yNum),
          });
        }
      }
    }

    if (parsedPoints.length === 0) {
      onShowAlert('Ошибка импорта данных', 'Не удалось распознать пары координат (X, Y) из вставленного текста. Убедитесь, что данные разделены пробелами, табуляцией или точкой с запятой.', 'critical');
      return;
    }

    // Sort by X
    parsedPoints.sort((a, b) => a.x - b.x);
    onPointsChange(parsedPoints);
    setPasteModalOpen(false);
    setPasteText('');
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
      {/* Table Toolbar */}
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Опорные точки (Таблица)
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              isPointCountSufficient
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {points.length} {points.length === 1 ? 'точка' : points.length < 5 ? 'точки' : 'точек'}
            {!isPointCountSufficient && ` (мин. ${minRequired})`}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            id="sort-points-btn"
            type="button"
            onClick={onSortPoints}
            className={`px-2 py-1 text-xs font-medium rounded border flex items-center gap-1 transition-colors cursor-pointer ${
              isSorted
                ? 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                : 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
            }`}
            title="Автоматическая сортировка точек по возрастанию аргумента X"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            <span>{isSorted ? 'X упорядочен' : 'Сортировать по X'}</span>
          </button>

          <button
            id="paste-data-btn"
            type="button"
            onClick={() => setPasteModalOpen(true)}
            className="px-2 py-1 text-xs font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 flex items-center gap-1 transition-colors cursor-pointer"
            title="Вставить координаты из буфера обмена (Excel, TSV, CSV)"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-slate-600" />
            <span>Вставка</span>
          </button>

          <button
            id="clear-points-btn"
            type="button"
            onClick={onClear}
            className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100 transition-colors"
            title="Очистить таблицу"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Duplicates Warning if present */}
      {hasDuplicates && (
        <div className="bg-red-50 border-b border-red-200 px-3 py-2 flex items-center gap-2 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>
            Внимание: обнаружены дубликаты X! Функция неоднозначна. Скорректируйте аргументы.
          </span>
        </div>
      )}

      {/* Interactive Table Grid */}
      <div className="flex-1 overflow-y-auto max-h-[340px]">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-100/80 sticky top-0 border-b border-slate-200 z-10">
            <tr>
              <th className="py-2 px-2.5 font-semibold text-slate-600 w-10 text-center">№</th>
              <th className="py-2 px-3 font-semibold text-slate-700">
                {xLabel} <span className="text-slate-600 font-normal">[{xUnit}]</span>
              </th>
              <th className="py-2 px-3 font-semibold text-slate-700">
                {yLabel} <span className="text-slate-600 font-normal">[{yUnit}]</span>
              </th>
              <th className="py-2 px-2 font-semibold text-slate-600 w-12 text-center">Удалить</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {points.map((pt, idx) => {
              const hasSameX = points.some(
                (other, otherIdx) => otherIdx !== idx && Math.abs(other.x - pt.x) < 1e-12
              );

              return (
                <tr
                  key={pt.id}
                  className={`hover:bg-slate-50/80 transition-colors ${
                    hasSameX ? 'bg-red-50/50' : ''
                  }`}
                >
                  <td className="py-1.5 px-2.5 text-center text-slate-600 font-sans font-medium">
                    {idx + 1}
                  </td>
                  <td className="py-1 px-2">
                    <div className="relative">
                      <input
                        type="text"
                        value={pt.xRaw !== undefined ? pt.xRaw : pt.x}
                        onChange={e => handlePointChange(pt.id, 'x', e.target.value)}
                        placeholder="0.0"
                        className={`w-full px-2 py-1 bg-white border rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-hidden ${
                          hasSameX
                            ? 'border-red-400 bg-red-50/30 text-red-900'
                            : 'border-slate-300 text-slate-900'
                        }`}
                      />
                    </div>
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="text"
                      value={pt.yRaw !== undefined ? pt.yRaw : pt.y}
                      onChange={e => handlePointChange(pt.id, 'y', e.target.value)}
                      placeholder="0.0"
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-hidden text-slate-900"
                    />
                  </td>
                  <td className="py-1 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleDeleteRow(pt.id)}
                      className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                      title={`Удалить точку #${idx + 1}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Row Button Footer */}
      <div className="p-2 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
        <button
          id="add-point-row-btn"
          type="button"
          onClick={handleAddRow}
          className="w-full py-1.5 px-3 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-medium rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
        >
          <Plus className="w-3.5 h-3.5 text-indigo-600" />
          <span>Добавить строку (Точку)</span>
        </button>
      </div>

      {/* Paste Modal */}
      {pasteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-4 space-y-3">
            <h3 className="font-semibold text-slate-900 text-sm">
              Импорт массива точек из буфера (Excel, CSV, TSV)
            </h3>
            <p className="text-xs text-slate-500">
              Вставьте строки с двумя числами (X и Y), разделенными пробелом, запятой или табуляцией:
            </p>
            <textarea
              rows={6}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="10.0   24.8&#10;20.0   21.2&#10;30.0   17.5"
              className="w-full p-2 border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPasteModalOpen(false)}
                className="px-3 py-1 text-xs text-slate-600 hover:text-slate-800 rounded border border-slate-200"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleBatchPaste}
                className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded shadow-xs"
              >
                Загрузить в таблицу
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
