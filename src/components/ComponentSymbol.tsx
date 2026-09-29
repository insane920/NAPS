import React from 'react';
import type { CircuitElement, ComponentType } from '../types';

export function renderComponentSymbol(el: CircuitElement, selected = false) {
  const stroke = selected ? '#dc2626' : '#1e293b';
  const strokeW = 1.75;

  switch (el.type) {
    case 'JUNCTION':
      return <circle cx={0} cy={0} r={4.5} fill={stroke} />;

    case 'R':
      // Резистор (прямоугольник с выводами по ГОСТ)
      return (
        <g>
          <line x1={-30} y1={0} x2={-18} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <rect
            x={-18}
            y={-7}
            width={36}
            height={14}
            fill="#ffffff"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <line x1={18} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'L':
      // Индуктивность (3 дуги)
      return (
        <g>
          <line x1={-30} y1={0} x2={-18} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <path
            d="M -18 0 A 6 6 0 0 1 -6 0 A 6 6 0 0 1 6 0 A 6 6 0 0 1 18 0"
            fill="none"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <line x1={18} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'C':
      // Конденсатор (две параллельные пластины)
      return (
        <g>
          <line x1={-30} y1={0} x2={-4} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-4} y1={-12} x2={-4} y2={12} stroke={stroke} strokeWidth={strokeW + 0.5} />
          <line x1={4} y1={-12} x2={4} y2={12} stroke={stroke} strokeWidth={strokeW + 0.5} />
          <line x1={4} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'DIODE':
      // Диод
      return (
        <g>
          <line x1={-30} y1={0} x2={-10} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <polygon
            points="-10,-10 -10,10 10,0"
            fill="#ffffff"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <line x1={10} y1={-11} x2={10} y2={11} stroke={stroke} strokeWidth={strokeW + 0.5} />
          <line x1={10} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'THYRISTOR':
      // Тиристор с выводом затвора
      return (
        <g>
          <line x1={-30} y1={0} x2={-10} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <polygon
            points="-10,-10 -10,10 10,0"
            fill="#ffffff"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <line x1={10} y1={-11} x2={10} y2={11} stroke={stroke} strokeWidth={strokeW + 0.5} />
          <line x1={10} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <line x1={0} y1={5} x2={0} y2={25} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'SWITCH':
      // Управляемый вентильный ключ VCK.
      return (
        <g>
          {/* Коллектор (вход) */}
          <line x1={-30} y1={0} x2={-10} y2={0} stroke={stroke} strokeWidth={strokeW} />
          {/* Вертикальная база ключа */}
          <line x1={-10} y1={-14} x2={-10} y2={14} stroke={stroke} strokeWidth={strokeW + 0.5} />
          {/* Зазор и эмиттер */}
          <line x1={-4} y1={-14} x2={-4} y2={14} stroke={stroke} strokeWidth={strokeW + 0.5} />
          <line x1={-4} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
          {/* Управляющий вывод (Gate) */}
          <line x1={-7} y1={14} x2={-7} y2={25} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-7} y1={25} x2={0} y2={25} stroke={stroke} strokeWidth={strokeW} />
          {/* Метка полярности + */}
          <text x={-22} y={-4} className="font-mono font-bold fill-slate-700" style={{ fontSize: '9px' }}>+</text>
        </g>
      );

    case 'NOT':
      // Логический инвертор НЕ.
      return (
        <g>
          <line x1={-30} y1={0} x2={-14} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <polygon
            points="-14,-14 -14,14 12,0"
            fill="#ffffff"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <circle cx={16} cy={0} r={3.5} fill="#ffffff" stroke={stroke} strokeWidth={strokeW} />
          <line x1={19.5} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'AND':
      // Логический элемент И (&)
      return (
        <g>
          <line x1={-30} y1={-10} x2={-15} y2={-10} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-30} y1={10} x2={-15} y2={10} stroke={stroke} strokeWidth={strokeW} />
          <path
            d="M -15,-16 L 0,-16 A 16 16 0 0 1 0,16 L -15,16 Z"
            fill="#ffffff"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <text x={-6} y={4} className="font-mono font-bold fill-slate-800" style={{ fontSize: '10px' }}>&</text>
          <line x1={16} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'OR':
      // Логический элемент ИЛИ (≥1)
      return (
        <g>
          <line x1={-30} y1={-10} x2={-15} y2={-10} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-30} y1={10} x2={-15} y2={10} stroke={stroke} strokeWidth={strokeW} />
          <rect x={-15} y={-16} width={30} height={32} fill="#ffffff" stroke={stroke} strokeWidth={strokeW} />
          <text x={0} y={4} textAnchor="middle" className="font-mono font-bold fill-slate-800" style={{ fontSize: '10px' }}>≥1</text>
          <line x1={15} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'XOR':
      // Логический элемент исключающее ИЛИ (=1)
      return (
        <g>
          <line x1={-30} y1={-10} x2={-15} y2={-10} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-30} y1={10} x2={-15} y2={10} stroke={stroke} strokeWidth={strokeW} />
          <rect x={-15} y={-16} width={30} height={32} fill="#ffffff" stroke={stroke} strokeWidth={strokeW} />
          <text x={0} y={4} textAnchor="middle" className="font-mono font-bold fill-slate-800" style={{ fontSize: '10px' }}>=1</text>
          <line x1={15} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'RS_FF':
    case 'D_FF':
    case 'JK_FF':
      // Триггеры
      return (
        <g>
          <line x1={-30} y1={-12} x2={-18} y2={-12} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-30} y1={12} x2={-18} y2={12} stroke={stroke} strokeWidth={strokeW} />
          {el.type === 'JK_FF' && <line x1={-30} y1={0} x2={-18} y2={0} stroke={stroke} strokeWidth={strokeW} />}
          <rect x={-18} y={-22} width={36} height={44} fill="#ffffff" stroke={stroke} strokeWidth={strokeW} />
          <text x={-12} y={-8} className="font-mono text-3xs font-bold fill-slate-700" style={{ fontSize: '8px' }}>
            {el.type === 'RS_FF' ? 'S' : el.type === 'D_FF' ? 'D' : 'J'}
          </text>
          <text x={-12} y={16} className="font-mono text-3xs font-bold fill-slate-700" style={{ fontSize: '8px' }}>
            {el.type === 'RS_FF' ? 'R' : el.type === 'D_FF' ? 'C' : 'K'}
          </text>
          {el.type === 'JK_FF' && <text x={-12} y={3} className="font-mono text-3xs font-bold fill-slate-700" style={{ fontSize: '7px' }}>C</text>}
          <text x={6} y={-8} className="font-mono text-3xs font-bold fill-slate-700" style={{ fontSize: '8px' }}>Q</text>
          <text x={4} y={16} className="font-mono text-3xs font-bold fill-slate-700" style={{ fontSize: '8px' }}>/Q</text>
          <line x1={18} y1={-12} x2={30} y2={-12} stroke={stroke} strokeWidth={strokeW} />
          <line x1={18} y1={12} x2={30} y2={12} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'TR3':
      // Двухобмоточный трансформатор (четыре вывода)
      return (
        <g>
          <line x1={-30} y1={-15} x2={-10} y2={-15} stroke={stroke} strokeWidth={strokeW} />
          <path d="M -10 -15 A 5 5 0 0 1 -10 -5 A 5 5 0 0 1 -10 5 A 5 5 0 0 1 -10 15" fill="none" stroke={stroke} strokeWidth={strokeW} />
          <line x1={-10} y1={15} x2={-30} y2={15} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-2} y1={-18} x2={-2} y2={18} stroke={stroke} strokeWidth={strokeW} />
          <line x1={2} y1={-18} x2={2} y2={18} stroke={stroke} strokeWidth={strokeW} />
          <line x1={30} y1={-15} x2={10} y2={-15} stroke={stroke} strokeWidth={strokeW} />
          <path d="M 10 -15 A 5 5 0 0 0 10 -5 A 5 5 0 0 0 10 5 A 5 5 0 0 0 10 15" fill="none" stroke={stroke} strokeWidth={strokeW} />
          <line x1={10} y1={15} x2={30} y2={15} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'GND':
      // Земля (стр. 11 мануала)
      return (
        <g>
          <line x1={0} y1={-20} x2={0} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-14} y1={0} x2={14} y2={0} stroke={stroke} strokeWidth={strokeW + 0.5} />
          <line x1={-9} y1={4} x2={9} y2={4} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-4} y1={8} x2={4} y2={8} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'PORT':
      // Элемент «Порт» (шестиугольник с именем, стр. 5 мануала)
      return (
        <g>
          <line x1={-30} y1={0} x2={-18} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <polygon
            points="-18,-9 10,-9 20,0 10,9 -18,9"
            fill="#eff6ff"
            stroke="#1d4ed8"
            strokeWidth={1.5}
          />
          <text
            x={-2}
            y={3}
            textAnchor="middle"
            className="font-mono font-bold fill-blue-800 select-none"
            style={{ fontSize: '9px' }}
          >
            {el.portName || el.name}
          </text>
        </g>
      );

    case 'V_DC':
      // Источник постоянного напряжения
      return (
        <g>
          <line x1={-30} y1={0} x2={-14} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <circle cx={0} cy={0} r={14} fill="#ffffff" stroke={stroke} strokeWidth={strokeW} />
          <text
            x={-6}
            y={4}
            className="font-mono font-bold fill-slate-800"
            style={{ fontSize: '11px' }}
          >
            +
          </text>
          <text
            x={4}
            y={4}
            className="font-mono font-bold fill-slate-800"
            style={{ fontSize: '11px' }}
          >
            -
          </text>
          <line x1={14} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'V_AC':
      // Синусоидальный источник переменного напряжения
      return (
        <g>
          <line x1={-30} y1={0} x2={-14} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <circle cx={0} cy={0} r={14} fill="#ffffff" stroke={stroke} strokeWidth={strokeW} />
          <path
            d="M -7 0 Q -3.5 -6 0 0 Q 3.5 6 7 0"
            fill="none"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <line x1={14} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'V_PULSE':
      // Импульсный источник
      return (
        <g>
          <line x1={-30} y1={0} x2={-14} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <circle cx={0} cy={0} r={14} fill="#ffffff" stroke={stroke} strokeWidth={strokeW} />
          <path
            d="M -8 4 L -4 4 L -4 -4 L 4 -4 L 4 4 L 8 4"
            fill="none"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <line x1={14} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'I_DC':
      return <g fill="none" stroke={stroke} strokeWidth={strokeW}><path d="M -30 0 H -14 M 14 0 H 30" /><circle r={14} fill="white" /><path d="M -8 0 H 8 M 3 -5 L 8 0 L 3 5" /></g>;

    case 'COMPARATOR':
      return <g stroke={stroke} strokeWidth={strokeW}><path d="M -35 -15 H -20 M -35 15 H -20 M 22 0 H 35" fill="none" /><path d="M -20 -24 L 22 0 L -20 24 Z" fill="white" /><path d="M -16 -15 H -10 M -16 15 H -10 M -13 12 V 18 M -5 5 V -5 H 5" fill="none" /></g>;

    case 'OPAMP':
      // Операционный усилитель (треугольник, стр. 4, 15, 22)
      return (
        <g>
          <line x1={-35} y1={-15} x2={-20} y2={-15} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-35} y1={15} x2={-20} y2={15} stroke={stroke} strokeWidth={strokeW} />
          <polygon
            points="-20,-24 -20,24 22,0"
            fill="#ffffff"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <text
            x={-15}
            y={-11}
            className="font-mono font-bold fill-slate-700"
            style={{ fontSize: '11px' }}
          >
            -
          </text>
          <text
            x={-16}
            y={19}
            className="font-mono font-bold fill-slate-700"
            style={{ fontSize: '11px' }}
          >
            +
          </text>
          <line x1={22} y1={0} x2={35} y2={0} stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'TEXT':
      // Текстовая директива (стр. 27)
      return (
        <g>
          <rect
            x={-50}
            y={-14}
            width={160}
            height={28}
            fill="#f8fafc"
            stroke="#cbd5e1"
            strokeWidth={1}
            strokeDasharray="2 2"
            rx={2}
          />
          <text
            x={-42}
            y={4}
            className="font-mono text-3xs fill-slate-600 select-none"
            style={{ fontSize: '9px' }}
          >
            {el.textDirective || '.define'}
          </text>
        </g>
      );

    default:
      return (
        <circle cx={0} cy={0} r={10} fill="#ffffff" stroke={stroke} strokeWidth={strokeW} />
      );
  }
}

export function ComponentSymbol({ type, className = '' }: { type: ComponentType; className?: string }) {
  return <svg viewBox={type === 'TEXT' ? '-60 -34 180 68' : '-44 -34 88 68'} className={className} aria-hidden="true" focusable="false">{renderComponentSymbol({ id: 'preview', type, name: type === 'PORT' ? 'OUT' : '', x: 0, y: 0, rotation: 0, value: 0, valueStr: '', unit: '', textDirective: 'Текст' })}</svg>;
}
