import React, { useState } from 'react';
import { ComponentSymbol } from './ComponentSymbol';
import {
  ComponentType,
} from '../types';
import {
  Layers,
  Cpu,
  Zap,
  Radio,
  Share2,
  Search,
  Check,
  Plus,
} from 'lucide-react';

export interface ComponentDefinition {
  type: ComponentType;
  name: string;
  code: string;
  category: 'passive' | 'semiconductor' | 'source' | 'logic' | 'nodes';
  description: string;
  defaultVal: string;
}

export type TerminalGroup = 'two' | 'three' | 'four' | 'multi';
export const TERMINAL_GROUPS: { id: TerminalGroup; label: string }[] = [
  { id: 'two', label: 'Двухполюсники' },
  { id: 'three', label: 'Трёхполюсники' },
  { id: 'four', label: 'Четырёхполюсники' },
  { id: 'multi', label: 'Многополюсники' },
];
export function terminalGroupForType(type: ComponentType): TerminalGroup | null {
  if (['R', 'C', 'L', 'DIODE', 'V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'NOT'].includes(type)) return 'two';
  if (['THYRISTOR', 'SWITCH', 'OPAMP', 'COMPARATOR', 'AND', 'OR', 'XOR'].includes(type)) return 'three';
  if (['RS_FF', 'D_FF', 'TR3'].includes(type)) return 'four';
  if (type === 'JK_FF') return 'multi';
  return null;
}

export const COMPONENT_CATALOG: ComponentDefinition[] = [
  // 1. Пассивные RLC
  {
    type: 'R',
    name: 'Резистор',
    code: 'R',
    category: 'passive',
    description: 'Линейное активное сопротивление (Ом)',
    defaultVal: '1к',
  },
  {
    type: 'C',
    name: 'Конденсатор',
    code: 'C',
    category: 'passive',
    description: 'Емкостной элемент (Ф)',
    defaultVal: '1мк',
  },
  {
    type: 'L',
    name: 'Индуктивность',
    code: 'L',
    category: 'passive',
    description: 'Индуктивный элемент / дроссель (Гн)',
    defaultVal: '10м',
  },
  {
    type: 'TR3',
    name: 'Трансформатор',
    code: 'Tr',
    category: 'passive',
    description: 'Двухобмоточный трансформатор, L1 / N2:N1 / k',
    defaultVal: '1 Гн',
  },

  // 2. Полупроводники и вентильные ключи
  {
    type: 'DIODE',
    name: 'Диод',
    code: 'VD',
    category: 'semiconductor',
    description: 'Полупроводниковый диод (ГОСТ 2.730)',
    defaultVal: '0.7 В',
  },
  {
    type: 'THYRISTOR',
    name: 'Тиристор',
    code: 'VS',
    category: 'semiconductor',
    description: 'Однонаправленный ключ с затвором G',
    defaultVal: 'Тиристор',
  },
  {
    type: 'SWITCH',
    name: 'Вентильный ключ',
    code: 'SW',
    category: 'semiconductor',
    description: 'Управляемый вентиль VCK (транзистор/IGBT)',
    defaultVal: '20 кГц',
  },
  {
    type: 'OPAMP',
    name: 'Опер. усилитель',
    code: 'ОУ',
    category: 'semiconductor',
    description: 'Операционный усилитель с инв. и неинв. входами',
    defaultVal: 'K = 10⁶',
  },
  {
    type: 'COMPARATOR',
    name: 'Компаратор',
    code: 'COMP',
    category: 'semiconductor',
    description: 'Быстродействующий пороговый компаратор',
    defaultVal: 'K = 10⁵',
  },

  // 3. Источники питания и сигналов
  {
    type: 'V_DC',
    name: 'Источник DC',
    code: 'U_dc',
    category: 'source',
    description: 'Источник постоянного напряжения (В)',
    defaultVal: '12 В',
  },
  {
    type: 'V_AC',
    name: 'Источник AC ~',
    code: 'U_sin',
    category: 'source',
    description: 'Генератор синусоидального напряжения (50 Гц)',
    defaultVal: '220 В ~',
  },
  {
    type: 'V_PULSE',
    name: 'Импульсный ШИМ',
    code: 'Pulse',
    category: 'source',
    description: 'Генератор прямоугольных импульсов / ШИМ',
    defaultVal: '5 В, 1 кГц',
  },
  {
    type: 'I_DC',
    name: 'Источник тока',
    code: 'I_dc',
    category: 'source',
    description: 'Источник постоянного тока (А)',
    defaultVal: '1 А',
  },

  // 4. Логика и управление
  {
    type: 'NOT',
    name: 'Инвертор НЕ',
    code: 'NOT',
    category: 'logic',
    description: 'Логический инвертор НЕ (¬)',
    defaultVal: 'НЕ',
  },
  {
    type: 'AND',
    name: 'Элемент И',
    code: '&',
    category: 'logic',
    description: 'Логический элемент 2И (&)',
    defaultVal: '2-И',
  },
  {
    type: 'OR',
    name: 'Элемент ИЛИ',
    code: '≥1',
    category: 'logic',
    description: 'Логический элемент 2ИЛИ (≥1)',
    defaultVal: '2-ИЛИ',
  },
  {
    type: 'XOR',
    name: 'Искл. ИЛИ',
    code: '=1',
    category: 'logic',
    description: 'Логический элемент XOR (=1)',
    defaultVal: 'XOR',
  },
  {
    type: 'D_FF',
    name: 'D-триггер',
    code: 'D-FF',
    category: 'logic',
    description: 'Синхронный триггер данных',
    defaultVal: 'D-тип',
  },
  {
    type: 'RS_FF',
    name: 'RS-триггер',
    code: 'RS-FF',
    category: 'logic',
    description: 'Асинхронный RS-триггер',
    defaultVal: 'RS-тип',
  },

  // 5. Узлы, земля и метки
  {
    type: 'JUNCTION',
    name: 'Точка соединения (Узел)',
    code: '•',
    category: 'nodes',
    description: 'Узел электрического соединения проводников (ГОСТ 2.702)',
    defaultVal: 'Узел',
  },
  {
    type: 'GND',
    name: 'Земля (GND)',
    code: '⏚',
    category: 'nodes',
    description: 'Опорный потенциал схемы (0 Вольт)',
    defaultVal: '0 В',
  },
  {
    type: 'TEXT',
    name: 'Текстовая надпись',
    code: '[T]',
    category: 'nodes',
    description: 'Поясняющий комментарий или директива',
    defaultVal: 'Текст',
  },
];

export const SUBTYPE_TABS = [
  { id: 'all', label: 'Все', icon: Layers },
  { id: 'two', label: 'Двухполюсники', icon: Radio },
  { id: 'three', label: 'Трёхполюсники', icon: Cpu },
  { id: 'four', label: 'Четырёхполюсники', icon: Zap },
  { id: 'multi', label: 'Многополюсники', icon: Share2 },
] as const;

export type SubtypeCategory = typeof SUBTYPE_TABS[number]['id'];

interface ComponentPaletteProps {
  selectedType: ComponentType | null;
  onSelectType: (type: ComponentType | null) => void;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
}

export function ComponentPalette({ selectedType, onSelectType, className = '' }: ComponentPaletteProps) {
  const [category, setCategory] = useState<SubtypeCategory>('all');
  const [query, setQuery] = useState('');
  const [focusedType, setFocusedType] = useState<ComponentType>(selectedType || 'R');
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const matchesQuery = (item: ComponentDefinition) =>
    `${item.name} ${item.code} ${item.type} ${item.description}`.toLocaleLowerCase('ru').includes(normalizedQuery);
  const selectable = COMPONENT_CATALOG.filter(item => terminalGroupForType(item.type));
  const items = selectable.filter(item => (category === 'all' || terminalGroupForType(item.type) === category) && matchesQuery(item));
  const focused = items.find(item => item.type === focusedType) || items[0];
  const activeCategory = SUBTYPE_TABS.find(tab => tab.id === category)!;
  return (
    <div className={`component-library ${className}`}>
      <div className="library-search">
        <Search size={18} aria-hidden="true" />
        <input autoFocus aria-label="Поиск компонентов" placeholder="Название, обозначение или назначение…" value={query} onChange={event => setQuery(event.target.value)} />
        {query && <button onClick={() => setQuery('')} aria-label="Очистить поиск">×</button>}
        <span>{selectable.length} элементов</span>
      </div>
      <div className="library-body">
        <nav className="library-categories" aria-label="Категории компонентов">
          <span className="library-eyebrow">КАТЕГОРИИ</span>
          {SUBTYPE_TABS.map(tab => {
            const Icon = tab.icon;
            const count = selectable.filter(item => (tab.id === 'all' || terminalGroupForType(item.type) === tab.id) && matchesQuery(item)).length;
            return <button key={tab.id} aria-pressed={category === tab.id} onClick={() => setCategory(tab.id)}>
              <Icon size={16} /><span>{tab.label === 'Все' ? 'Все компоненты' : tab.label}</span><small>{count}</small>
            </button>;
          })}
          <div className="library-tip"><Layers size={20} /><p>Обозначения в библиотеке совпадают с элементами на схеме.</p></div>
        </nav>
        <section className="library-results" aria-label="Компоненты">
          <div className="library-section-heading"><h3>{normalizedQuery ? 'Результаты поиска' : activeCategory.label === 'Все' ? 'Все компоненты' : activeCategory.label}</h3><span role="status">Найдено: {items.length}</span></div>
          {items.length ? <div className="component-grid">
            {items.map(item => <button key={item.type} className="component-card" aria-label={`${item.name} (${item.code})`} aria-pressed={focused?.type === item.type}
              onClick={() => setFocusedType(item.type)} onDoubleClick={() => onSelectType(item.type)} title={item.description}>
              <span className="component-card-code">{item.code}</span>
              {focused?.type === item.type && <Check size={14} className="component-card-check" />}
              <span className="component-thumbnail"><ComponentSymbol type={item.type} /></span>
              <strong>{item.name}</strong><small>{item.defaultVal}</small>
            </button>)}
          </div> : <div className="library-empty"><Search size={32} /><h3>Компоненты не найдены</h3><p>Попробуйте другое название или выберите все категории.</p><button onClick={() => { setQuery(''); setCategory('all'); }}>Сбросить фильтры</button></div>}
        </section>
      </div>
      <footer className="library-detail">
        {focused ? <><div className="library-detail-symbol"><ComponentSymbol type={focused.type} /></div><div className="library-detail-text"><strong>{focused.name}</strong><p>{focused.description}</p><small>Выберите компонент и укажите место на схеме</small></div><button className="primary-action library-insert" onClick={() => onSelectType(focused.type)}><Plus size={16} />На схему</button></> : <span>Измените условия поиска, чтобы выбрать компонент.</span>}
      </footer>
    </div>
  );
}
