import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Download, Upload, AlertCircle, FileCode } from 'lucide-react';
import { exportToYamlScm, parseYamlScm } from '../utils/yamlScm';
import { CircuitElement, CircuitWire, TransientSettings, ACSettings } from '../types';

interface ScmYamlModalProps {
  isOpen: boolean;
  onClose: () => void;
  elements: CircuitElement[];
  wires: CircuitWire[];
  transient: TransientSettings;
  ac?: ACSettings;
  onApplyYaml: (data: {
    elements: CircuitElement[];
    wires: CircuitWire[];
    transient: TransientSettings;
  }) => void;
}

export function ScmYamlModal({
  isOpen,
  onClose,
  elements,
  wires,
  transient,
  ac,
  onApplyYaml,
}: ScmYamlModalProps) {
  const [yamlText, setYamlText] = useState('');
  const [copied, setCopied] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const generated = exportToYamlScm(elements, wires, transient, ac);
      setYamlText(generated);
      setParseError(null);
      setCopied(false);
    }
  }, [isOpen, elements, wires, transient, ac]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(yamlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([yamlText], { type: 'text/yaml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'NAPS-Circuit.scm';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleApply = () => {
    try {
      setParseError(null);
      const parsed = parseYamlScm(yamlText);
      if (parsed.elements.length === 0) {
        setParseError('Ошибка: в файле не обнаружено ни одного корректного объекта схемы');
        return;
      }
      onApplyYaml(parsed);
      onClose();
    } catch (err: any) {
      setParseError(`Ошибка парсинга YAML: ${err?.message || 'Неверный формат .scm файла'}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) {
        setYamlText(content);
        setParseError(null);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs font-sans">
      <div role="dialog" aria-modal="true" aria-label="Редактор кода схемы" className="bg-[#f0f2f5] border border-slate-400 rounded-md shadow-2xl w-full max-w-[1440px] h-[92vh] flex flex-col overflow-hidden">
        {/* Заголовок окна редактора SCM. */}
        <div className="bg-[#2c3e50] text-white px-4 py-2 flex items-center justify-between font-bold text-xs select-none">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-emerald-400" />
            <span>Проект схемы NAPS — Формат YAML (.scm)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Информационная панель */}
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2 flex flex-wrap gap-2 items-center justify-between text-xs text-slate-700 shrink-0">
          <div>
            Спецификация проекта: <strong>NAPS YAML Schema</strong>
          </div>
          <div className="flex items-center gap-2">
            <label className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded text-slate-700 cursor-pointer text-xs font-semibold flex items-center gap-1 shadow-2xs">
              <Upload className="w-3.5 h-3.5 text-blue-600" />
              <span>Загрузить файл .scm...</span>
              <input
                type="file"
                accept=".scm,.yaml,.yml,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={handleDownload}
              className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded text-slate-700 cursor-pointer text-xs font-semibold flex items-center gap-1 shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Скачать .scm</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded text-slate-700 cursor-pointer text-xs font-semibold flex items-center gap-1 shadow-2xs"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-600" />
                  <span>Копировать</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Поле редактирования YAML кода */}
        <div className="p-4 flex-1 overflow-hidden flex flex-col min-h-0 bg-white">
          {parseError && (
            <div className="mb-2 p-2 bg-rose-50 border border-rose-300 rounded text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}
          <textarea
            aria-label="Код схемы YAML"
            wrap="off"
            value={yamlText}
            onChange={(e) => {
              setYamlText(e.target.value);
              setParseError(null);
            }}
            spellCheck={false}
            style={{ fontFamily: 'Consolas, "Courier New", monospace' }}
            className="flex-1 min-h-0 w-full font-mono text-sm p-4 bg-slate-900 text-slate-100 rounded border border-slate-700 outline-hidden resize-none overflow-auto leading-relaxed"
          />
        </div>

        {/* Подвал с кнопками */}
        <div className="bg-[#e9ecef] border-t border-slate-300 px-4 py-2.5 flex items-center justify-between">
          <div className="text-3xs text-slate-500 font-mono">
            Объектов: {elements.length} | Соединений: {wires.length} | Шаг:{' '}
            {transient.stepStr || 'авто'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-4 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs font-semibold cursor-pointer shadow-xs"
            >
              Применить схему из YAML
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
