import React from 'react';
import type { CircuitElement, ComponentType } from '../types';
import { SYMBOL_METRICS } from './symbolMetrics';
import { chipPins } from '../utils/chipPins';

export function renderComponentSymbol(el: CircuitElement, selected = false, showEmbeddedLabel = true, elementColor = '#1d4ed8') {
  const stroke = selected ? '#dc2626' : elementColor;
  const strokeW = SYMBOL_METRICS.normalStroke;

  switch (el.type) {
    case 'JUNCTION':
      return <circle cx={0} cy={0} r={4.5} fill={stroke} />;

    case 'R':
      // Резистор (прямоугольник с выводами по ГОСТ)
      return (
        <g>
          <line x1={-30} y1={0} x2={-20} y2={0} stroke={stroke} strokeWidth={strokeW} />
          <rect
            x={-20}
            y={-8}
            width={40}
            height={16}
            fill="#ffffff"
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <line x1={20} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
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
      // Управляемый размыкающий контакт; управляющий вывод остаётся электрически отдельным.
      return (
        <g>
          <path d="M -30 0 H -12 M 12 0 H 30 M -12 0 L 8 -10" fill="none" stroke={stroke} strokeWidth={strokeW} />
          <circle cx={-12} cy={0} r={2} fill={stroke} />
          <circle cx={12} cy={0} r={2} fill="white" stroke={stroke} strokeWidth={strokeW} />
          <path d="M 0 25 V 12 M 0 9 V 4" fill="none" stroke={stroke} strokeWidth={strokeW} strokeDasharray="3 2" />
        </g>
      );

    case 'NPN':
    case 'PNP':
      return <g fill="none" stroke={stroke} strokeWidth={strokeW}>
        <path d="M -30 0 H -11 L -3 -5 M 30 0 H 11 L 3 5 M 0 25 V 8 M -11 -7 L 11 7" />
        <path d={el.type === 'NPN' ? 'M 5 6 L 11 0 L 3 0' : 'M 5 6 L -1 8 L 4 12'} fill={stroke} stroke="none" />
        <circle cx={0} cy={0} r={14} />
      </g>;

    case 'NMOS':
    case 'PMOS':
      return <g fill="none" stroke={stroke} strokeWidth={strokeW}>
        <path d="M -30 0 H -13 M 13 0 H 30 M -13 -9 V 9 M 13 -9 V 9 M -13 0 H 13 M 0 25 V 12 M -9 11 H 9" />
        {el.type === 'PMOS' && <circle cx={0} cy={10} r={2.4} fill="white" />}
        <circle cx={0} cy={0} r={15} />
      </g>;

    case 'NOT':
      // Прямоугольный функциональный символ с указателем инверсии на выходе.
      return (
        <g>
          <path d="M -30 0 H -15 M 19 0 H 30" fill="none" stroke={stroke} strokeWidth={strokeW} />
          <rect x={-15} y={-16} width={30} height={32} fill="white" stroke={stroke} strokeWidth={strokeW} />
          <text x={0} y={4} textAnchor="middle" fill={stroke} fontSize={11} fontWeight="bold">1</text>
          <circle cx={17} cy={0} r={2.5} fill="white" stroke={stroke} strokeWidth={strokeW} />
        </g>
      );

    case 'AND':
      // Единый прямоугольный функциональный символ цифровой техники.
      return (
        <g>
          <line x1={-30} y1={-10} x2={-15} y2={-10} stroke={stroke} strokeWidth={strokeW} />
          <line x1={-30} y1={10} x2={-15} y2={10} stroke={stroke} strokeWidth={strokeW} />
          <rect x={-15} y={-16} width={30} height={32} fill="white" stroke={stroke} strokeWidth={strokeW} />
          <text x={0} y={4} textAnchor="middle" fill={stroke} fontSize={11} fontWeight="bold">&amp;</text>
          <line x1={15} y1={0} x2={30} y2={0} stroke={stroke} strokeWidth={strokeW} />
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
            stroke={stroke}
            strokeWidth={1.5}
          />
          {showEmbeddedLabel && <text
            x={-2}
            y={3}
            textAnchor="middle"
            className="font-mono font-bold select-none"
            fill={stroke}
            style={{ fontSize: '9px' }}
          >
            {el.portName || el.name}
          </text>}
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
    case 'I_AC':
    case 'I_PULSE':
      return <g fill="none" stroke={stroke} strokeWidth={strokeW}><path d="M -30 0 H -14 M 14 0 H 30" /><circle r={14} fill="white" />{el.type === 'I_DC' ? <path d="M -8 0 H 8 M 3 -5 L 8 0 L 3 5" /> : el.type === 'I_AC' ? <path d="M -8 0 Q -4 -7 0 0 Q 4 7 8 0" /> : <path d="M -8 4 H -4 V -4 H 4 V 4 H 8" />}</g>;

    case 'VCVS':
    case 'VCCS':
    case 'CCVS':
    case 'CCCS': {
      const voltageOutput = el.type === 'VCVS' || el.type === 'CCVS';
      const voltageControl = el.type === 'VCVS' || el.type === 'VCCS';
      return <g fill="none" stroke={stroke} strokeWidth={strokeW}>
        <path d="M -30 0 H -14 M 14 0 H 30" />
        {voltageControl && <path d="M 0 -30 V -14 M 0 14 V 30" />}
        <path d="M 0 -14 L 14 0 L 0 14 L -14 0 Z" fill="white" />
        {voltageOutput ? <path d="M -8 0 H -2 M -5 -3 V 3 M 3 0 H 9" /> : <path d="M -8 0 H 8 M 3 -4 L 8 0 L 3 4" />}
      </g>;
    }

    case 'CHIP': {
      const pins = chipPins(el);
      const left = pins.filter(pin => pin.side === 'left');
      const right = pins.filter(pin => pin.side === 'right');
      const rows = Math.max(left.length, right.length, 2);
      const top = -Math.max(rows - 1, 1) * 10 - 12;
      const height = -2 * top;
      return <g stroke={stroke} strokeWidth={strokeW} fill="none">
        <rect x={-25} y={top} width={50} height={height} fill="white" />
        {([['left', left], ['right', right]] as const).flatMap(([side, group]) => group.map((pin, index) => {
          const y = (index - (group.length - 1) / 2) * 20;
          return <g key={pin.id}>
            <path d={side === 'left' ? `M -40 ${y} H -25` : `M 25 ${y} H 40`} />
            <text x={side === 'left' ? -22 : 22} y={y + 3} textAnchor={side === 'left' ? 'start' : 'end'} fontSize={7} fill={stroke} stroke="none">{pin.label || pin.number}</text>
          </g>;
        }))}
        <text x={0} y={4} textAnchor="middle" fontSize={10} fontWeight="bold" fill={stroke} stroke="none">{el.name || 'DD'}</text>
      </g>;
    }

    case 'COMPARATOR':
      return <g stroke={stroke} strokeWidth={strokeW}>
        <path d="M -35 -15 H -20 M -35 15 H -20 M 22 0 H 35" fill="none" />
        <path d="M -20 -24 L 22 0 L -20 24 Z" fill="white" />
        <text x={-13} y={-11} textAnchor="middle" fill={stroke} stroke="none" fontSize={11} fontWeight="bold">−</text>
        <text x={-13} y={19} textAnchor="middle" fill={stroke} stroke="none" fontSize={11} fontWeight="bold">+</text>
      </g>;

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
            stroke={stroke}
            strokeWidth={1}
            strokeDasharray="2 2"
            rx={2}
          />
          <text
            x={-42}
            y={4}
            className="font-mono text-3xs select-none"
            fill={stroke}
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
  return <svg viewBox={type === 'TEXT' ? '-60 -34 180 68' : type === 'CHIP' ? '-45 -55 90 110' : '-44 -34 88 68'} className={className} aria-hidden="true" focusable="false">{renderComponentSymbol({ id: 'preview', type, name: type === 'PORT' ? 'OUT' : '', x: 0, y: 0, rotation: 0, value: 0, valueStr: '', unit: '', textDirective: 'Текст' })}</svg>;
}
