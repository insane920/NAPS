import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, Info, ChevronDown, ChevronUp, X } from 'lucide-react';
import { QMessageBoxData } from '../types';

interface QMessageBoxModalProps {
  dialog: QMessageBoxData;
  onClose: () => void;
}

export const QMessageBoxModal: React.FC<QMessageBoxModalProps> = ({ dialog, onClose }) => {
  const [showDetails, setShowDetails] = useState(false);

  if (!dialog.isOpen) return null;

  const getIcon = () => {
    switch (dialog.type) {
      case 'critical':
        return <AlertCircle className="w-9 h-9 text-red-600 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-9 h-9 text-amber-600 shrink-0" />;
      case 'information':
      default:
        return <Info className="w-9 h-9 text-blue-600 shrink-0" />;
    }
  };

  const getHeaderBg = () => {
    switch (dialog.type) {
      case 'critical':
        return 'bg-red-50 border-red-200 text-red-900';
      case 'warning':
        return 'bg-amber-50 border-amber-200 text-amber-900';
      case 'information':
      default:
        return 'bg-blue-50 border-blue-200 text-blue-900';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        id="qmessagebox-dialog"
        className="bg-white rounded-lg shadow-2xl border border-slate-300 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Window Header */}
        <div className={`px-4 py-2.5 border-b flex items-center justify-between ${getHeaderBg()}`}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500">
              QMessageBox::{dialog.type.toUpperCase()}
            </span>
            <span className="text-sm font-semibold text-slate-800">— {dialog.title}</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-0.5 rounded-sm transition-colors"
            title="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5">
          <div className="flex items-start gap-4">
            {getIcon()}
            <div className="space-y-1.5 flex-1">
              <h3 className="font-semibold text-slate-900 text-base leading-snug">
                {dialog.title}
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">
                {dialog.text}
              </p>
            </div>
          </div>

          {/* Optional Technical Details (Qt "Show Details..." feature) */}
          {dialog.detailedText && (
            <div className="mt-4 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
              >
                {showDetails ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" /> Скрыть технические подробности
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" /> Показать подробности (ГОСТ 19/34)
                  </>
                )}
              </button>

              {showDetails && (
                <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-700 whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {dialog.detailedText}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button
            id="qmessagebox-ok-btn"
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded shadow-xs transition-colors cursor-pointer"
            autoFocus
          >
            ОК
          </button>
        </div>
      </div>
    </div>
  );
};
