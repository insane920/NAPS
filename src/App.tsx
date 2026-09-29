import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Save, FileCode2, CircleHelp, X, LoaderCircle, Undo2, Redo2, Activity, SlidersHorizontal } from 'lucide-react';
import { SchematicEditor } from './components/SchematicEditor';
import { ElementPropertiesModal } from './components/ElementPropertiesModal';
import { TransientSetupModal } from './components/TransientSetupModal';
import { ACSetupModal } from './components/ACSetupModal';
import { SAMPLE_CIRCUITS, type SampleCircuit } from './data/sampleCircuits';
import { exportToYamlScm, parseYamlScm } from './utils/yamlScm';
import type { ACSettings, CircuitElement, CircuitWire, CircuitSimulationResults, TransientSettings } from './types';
import { useModalFocus } from './hooks/useModalFocus';
import { NapsLogo } from './components/NapsLogo';

const GraphWindow = lazy(() => import('./components/GraphWindow').then(m => ({ default: m.GraphWindow })));
const ScmYamlModal = lazy(() => import('./components/ScmYamlModal').then(m => ({ default: m.ScmYamlModal })));

interface HistorySnapshot {
  elements: CircuitElement[];
  wires: CircuitWire[];
  settings: TransientSettings;
  ac: ACSettings;
  name: string;
  dirty: boolean;
}

const cloneSnapshot = (snapshot: HistorySnapshot): HistorySnapshot => structuredClone(snapshot);
const newProjectSettings: TransientSettings = { ...SAMPLE_CIRCUITS[0].transient, signals: [] };
const newACSettings: ACSettings = { fMin: 10, fMinStr: '10', fMax: 100000, fMaxStr: '100k', points: 101, scaleType: 'log', signals: [] };

export default function App() {
  const [elements, setElements] = useState<CircuitElement[]>([]);
  const [wires, setWires] = useState<CircuitWire[]>([]);
  const [settings, setSettings] = useState(newProjectSettings);
  const [ac, setAc] = useState(newACSettings);
  const [name, setName] = useState('Новая схема');
  const [dirty, setDirty] = useState(false);
  const [results, setResults] = useState<CircuitSimulationResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Добавьте компоненты из библиотеки');
  const [hoverStatus, setHoverStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [acSettingsOpen, setAcSettingsOpen] = useState(false);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const graphDialogRef = useModalFocus<HTMLDivElement>(graphOpen && !settingsOpen && !acSettingsOpen);
  const helpDialogRef = useModalFocus<HTMLDivElement>(helpOpen);
  const [selected, setSelected] = useState<CircuitElement | null>(null);
  const [viewRevision, setViewRevision] = useState(0);
  const [fitRevision, setFitRevision] = useState(0);
  const worker = useRef<Worker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const currentSnapshot = useRef<HistorySnapshot>({ elements: [], wires: [], settings: newProjectSettings, ac: newACSettings, name: 'Новая схема', dirty: false });
  const undoStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  const historyGroupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyGroupOpen = useRef(false);
  const continuousHistoryGroup = useRef(false);
  const [, setHistoryVersion] = useState(0);

  const stopCalculation = useCallback(() => {
    worker.current?.terminate(); worker.current = null; setBusy(false);
  }, []);
  const markChanged = useCallback(() => {
    revision.current += 1; stopCalculation(); setDirty(true); setResults(null);
    setStatus('Схема изменена • требуется расчёт');
  }, [stopCalculation]);
  const closeHistoryGroup = useCallback(() => {
    if (historyGroupTimer.current) clearTimeout(historyGroupTimer.current);
    historyGroupTimer.current = null; historyGroupOpen.current = false; continuousHistoryGroup.current = false;
  }, []);
  const beginHistoryChange = useCallback(() => {
    if (!historyGroupOpen.current) {
      undoStack.current.push(cloneSnapshot(currentSnapshot.current));
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      historyGroupOpen.current = true;
      setHistoryVersion(value => value + 1);
    }
    if (!continuousHistoryGroup.current) {
      if (historyGroupTimer.current) clearTimeout(historyGroupTimer.current);
      historyGroupTimer.current = setTimeout(() => { historyGroupTimer.current = null; historyGroupOpen.current = false; }, 0);
    }
  }, []);
  const beginContinuousHistory = useCallback(() => {
    continuousHistoryGroup.current = true; beginHistoryChange();
  }, [beginHistoryChange]);
  const endContinuousHistory = useCallback(() => {
    continuousHistoryGroup.current = false; closeHistoryGroup();
  }, [closeHistoryGroup]);
  const changeElements = useCallback((value: CircuitElement[]) => {
    beginHistoryChange(); currentSnapshot.current = { ...currentSnapshot.current, elements: value, dirty: true };
    setElements(value); markChanged();
  }, [beginHistoryChange, markChanged]);
  const changeWires = useCallback((value: CircuitWire[]) => {
    beginHistoryChange(); currentSnapshot.current = { ...currentSnapshot.current, wires: value, dirty: true };
    setWires(value); markChanged();
  }, [beginHistoryChange, markChanged]);
  const changeSettings = useCallback((value: TransientSettings) => {
    beginHistoryChange(); currentSnapshot.current = { ...currentSnapshot.current, settings: value, dirty: true };
    setSettings(value); markChanged(); setSettingsOpen(false); setGraphOpen(false);
  }, [beginHistoryChange, markChanged]);
  const restoreSnapshot = useCallback((snapshot: HistorySnapshot, message: string) => {
    closeHistoryGroup(); stopCalculation(); revision.current += 1;
    const restored = cloneSnapshot(snapshot); currentSnapshot.current = restored;
    setElements(restored.elements); setWires(restored.wires); setSettings(restored.settings); setAc(restored.ac); setName(restored.name); setDirty(restored.dirty);
    setResults(null); setGraphOpen(false); setSelected(null); setError(null); setViewRevision(value => value + 1);
    setStatus(message); setHistoryVersion(value => value + 1);
  }, [closeHistoryGroup, stopCalculation]);
  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    const previous = undoStack.current.pop()!;
    redoStack.current.push(cloneSnapshot(currentSnapshot.current));
    restoreSnapshot(previous, 'Действие отменено');
  }, [restoreSnapshot]);
  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(cloneSnapshot(currentSnapshot.current));
    restoreSnapshot(next, 'Действие повторено');
  }, [restoreSnapshot]);
  useEffect(() => () => { worker.current?.terminate(); if (historyGroupTimer.current) clearTimeout(historyGroupTimer.current); }, []);
  useEffect(() => { document.title = `${dirty ? '• ' : ''}${name} — NAPS`; }, [dirty, name]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const runSimulation = useCallback(() => {
    if (!elements.length) { setError('Добавьте элементы на схему перед расчётом.'); return; }
    let calculationSettings = settings;
    if (!settings.signals.some(signal => signal.enabled)) {
      const first = elements.find(element => !['GND', 'PORT', 'JUNCTION', 'TEXT'].includes(element.type) && !element.isolation);
      if (first) {
        calculationSettings = { ...settings, signals: [{ id: 'sig_default', plotIndex: 1, exprX: 't', exprY: `U(${first.name})`, color: '#2563eb', enabled: true }] };
        currentSnapshot.current = { ...currentSnapshot.current, settings: calculationSettings };
        setSettings(calculationSettings);
      }
    }
    stopCalculation(); setError(null); setBusy(true); setStatus('Выполняется расчёт…');
    try {
      const task = new Worker(new URL('./math/simulation.worker.ts', import.meta.url), { type: 'module' });
      worker.current = task;
      task.onmessage = ({ data }) => {
        if (worker.current !== task) return;
        stopCalculation();
        if (data.error) { setError(data.error); setStatus('Ошибка расчёта'); }
        else {
          setResults(data.results); setStatus(`Расчёт выполнен за ${data.elapsed} мс`); setGraphOpen(true);
        }
      };
      task.onerror = () => {
        if (worker.current !== task) return;
        stopCalculation(); setError('Не удалось запустить расчёт. Повторите попытку.'); setStatus('Ошибка расчёта');
      };
      task.postMessage({ elements, wires, settings: calculationSettings });
    } catch (cause) {
      stopCalculation(); setError(cause instanceof Error ? cause.message : 'Ошибка запуска расчёта.'); setStatus('Ошибка расчёта');
    }
  }, [elements, wires, settings, stopCalculation]);

  const runAC = useCallback(() => {
    if (!elements.length) { setError('Добавьте элементы на схему перед расчётом.'); return; }
    let calculationSettings = ac;
    if (!ac.signals.some(s => s.enabled)) {
      const output = elements.find(e => e.type === 'PORT' && /out/i.test(e.portName || e.name))
        ?? elements.find(e => e.type === 'PORT');
      const input = elements.find(e => e.type === 'PORT' && /in/i.test(e.portName || e.name));
      const expr = output ? `U(${output.portName || output.name})` : elements.find(e => e.type === 'R') ? `U(${elements.find(e => e.type === 'R')!.name})` : '';
      if (!expr) { setAcSettingsOpen(true); return; }
      const argument = input ? `${expr}/U(${input.portName || input.name})` : expr;
      calculationSettings = { ...ac, signals: [
        { id: 'ac_db', plotIndex: 1, exprX: 'f', exprY: `db(${argument})`, color: '#2563eb', enabled: true },
        { id: 'ac_phase', plotIndex: 2, exprX: 'f', exprY: `phs(${argument})`, color: '#dc2626', enabled: true },
      ] };
      setAc(calculationSettings);
      currentSnapshot.current = { ...currentSnapshot.current, ac: calculationSettings };
    }
    stopCalculation(); setError(null); setBusy(true); setStatus('Выполняется частотный анализ…');
    try {
      const task = new Worker(new URL('./math/simulation.worker.ts', import.meta.url), { type: 'module' });
      worker.current = task;
      task.onmessage = ({ data }) => {
        if (worker.current !== task) return;
        stopCalculation();
        if (data.error) { setError(data.error); setStatus('Ошибка частотного анализа'); }
        else { setResults(data.results); setStatus(`Частотный анализ выполнен за ${data.elapsed} мс`); setGraphOpen(true); }
      };
      task.onerror = () => { if (worker.current === task) { stopCalculation(); setError('Не удалось запустить частотный анализ.'); } };
      task.postMessage({ mode: 'ac', elements, wires, settings: calculationSettings });
    } catch (cause) { stopCalculation(); setError(cause instanceof Error ? cause.message : 'Ошибка запуска частотного анализа.'); }
  }, [ac, elements, wires, stopCalculation]);

  const replaceProject = (data: { elements: CircuitElement[]; wires: CircuitWire[]; transient: TransientSettings; ac?: ACSettings }, title: string, edited = false) => {
    closeHistoryGroup(); undoStack.current = []; redoStack.current = [];
    currentSnapshot.current = cloneSnapshot({ elements: data.elements, wires: data.wires, settings: data.transient, ac: data.ac ?? newACSettings, name: title, dirty: edited });
    setHistoryVersion(value => value + 1);
    setViewRevision(value => value + 1);
    setFitRevision(value => value + 1);
    markChanged(); setElements(data.elements); setWires(data.wires); setSettings(data.transient); setAc(data.ac ?? newACSettings);
    setName(title); setDirty(edited); setError(null); setGraphOpen(false); setStatus('Схема готова к расчёту');
  };
  const clearProject = () => {
    closeHistoryGroup(); beginHistoryChange();
    const emptySettings = { ...newProjectSettings, signals: [] };
    currentSnapshot.current = { elements: [], wires: [], settings: emptySettings, ac: newACSettings, name: 'Новая схема', dirty: true };
    markChanged(); setElements([]); setWires([]); setSettings(emptySettings); setAc(newACSettings); setName('Новая схема');
    setSelected(null); setError(null); setGraphOpen(false); setViewRevision(value => value + 1);
  };
  const confirmReplace = () => !dirty || window.confirm('В схеме есть несохранённые изменения. Заменить её?');
  const loadSample = (value: SampleCircuit) => { if (confirmReplace()) replaceProject(value, value.name); };
  const importCircuit = (content: string, title: string) => {
    if (!/^scm\s*:/m.test(content) || !/^Objects\s*:/m.test(content)) throw new Error('Файл не содержит проект NAPS в формате .scm.');
    replaceProject(parseYamlScm(content), title.replace(/\.scm$/i, ''));
  };
  const openCircuit = async () => {
    if (!confirmReplace()) return;
    try {
      if (window.desktop) {
        const file = await window.desktop.openCircuit();
        if (file) importCircuit(file.content, file.name);
      } else fileInput.current?.click();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть файл.'); }
  };
  const saveCircuit = async () => {
    const savedRevision = revision.current;
    try {
      const content = exportToYamlScm(elements, wires, settings, ac);
      const fileName = `${name.replace(/[<>:"/\\|?*]/g, '_')}.scm`;
      if (window.desktop) {
        const savedName = await window.desktop.saveCircuit(content, fileName);
        if (!savedName) return;
        if (revision.current === savedRevision) {
          setName(savedName.replace(/\.scm$/i, '')); setDirty(false);
          currentSnapshot.current = { ...currentSnapshot.current, dirty: false };
        }
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url; link.download = fileName; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setStatus(window.desktop ? 'Файл сохранён' : 'Файл передан для скачивания');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить файл.'); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingText = target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
      const command = event.ctrlKey || event.metaKey;
      const physicalKey = event.code;
      if (command && !editingText && physicalKey === 'KeyZ') { event.preventDefault(); event.stopPropagation(); event.shiftKey ? redo() : undo(); }
      else if (command && !editingText && physicalKey === 'KeyY') { event.preventDefault(); event.stopPropagation(); redo(); }
      else if (command && event.key.toLowerCase() === 's') { event.preventDefault(); void saveCircuit(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void openCircuit(); }
      else if (event.key === 'Escape') { setHelpOpen(false); setGraphOpen(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openCircuit, redo, saveCircuit, undo]);
  const modalOpen = graphOpen || settingsOpen || acSettingsOpen || yamlOpen || helpOpen || !!selected;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand" aria-label="NAPS — Numerical, Analytical, PWL, Simulation"><NapsLogo className="brand-logo" /><span className="brand-tagline">Numerical · Analytical · PWL · Simulation</span></div>
        <div className="project-name" title={name}>{dirty && <span className="unsaved-dot" title="Есть несохранённые изменения" />}<span>{name}</span><small>СХЕМА</small></div>
        <nav className="file-actions" aria-label="Действия с проектом">
          <button onClick={undo} disabled={!undoStack.current.length} title="Отменить (Ctrl+Z)" aria-label="Отменить"><Undo2 size={16} /></button>
          <button onClick={redo} disabled={!redoStack.current.length} title="Повторить (Ctrl+Y)" aria-label="Повторить"><Redo2 size={16} /></button>
          <button onClick={openCircuit} title="Открыть схему (Ctrl+O)"><FolderOpen size={16} /><span>Открыть</span></button>
          <button onClick={saveCircuit} title="Сохранить схему (Ctrl+S)"><Save size={16} /><span>Сохранить</span></button>
          <button onClick={runAC} title="Рассчитать АЧХ и ФЧХ"><Activity size={16} /><span>АЧХ/ФЧХ</span></button>
          <button onClick={() => setAcSettingsOpen(true)} title="Параметры частотного анализа" aria-label="Параметры частотного анализа"><SlidersHorizontal size={16} /></button>
          <button onClick={() => setYamlOpen(true)} title="Редактор файла схемы" aria-label="Редактор файла схемы"><FileCode2 size={17} /></button>
          <button onClick={() => setHelpOpen(true)} title="Помощь" aria-label="Помощь"><CircleHelp size={17} /></button>
        </nav>
        <input ref={fileInput} className="hidden" type="file" accept=".scm" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          try { importCircuit(await file.text(), file.name); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка чтения файла.'); }
        }} />
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Закрыть сообщение"><X size={16} /></button></div>}
      <main className="workspace">
        <SchematicEditor elements={elements} wires={wires} onElementsChange={changeElements} onWiresChange={changeWires}
          onBeginContinuousEdit={beginContinuousHistory} onEndContinuousEdit={endContinuousHistory}
          onSelectElement={() => {}} onOpenProperties={setSelected} onRunSimulation={runSimulation}
          onOpenTransientSettings={() => setSettingsOpen(true)} onLoadSample={loadSample} onClearProject={clearProject}
          onBuildPlot={runSimulation} isGraphOpen={graphOpen} isSimulating={busy} shortcutsEnabled={!modalOpen} viewRevision={viewRevision} fitRevision={fitRevision} onHoverStatus={setHoverStatus} />
      </main>
      <footer className="status-bar">
        <span className="status-message" role="status">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <span className="status-dot" />}{hoverStatus || status}</span>
        {busy && <button onClick={() => { stopCalculation(); setStatus('Расчёт отменён'); }}>Отменить</button>}
        <span className="status-count">Элементы: {elements.length}<span>Соединения: {wires.length}</span></span>
        <span className="status-hint">Двойной щелчок — свойства · F9 — расчёт</span>
      </footer>
      {graphOpen && <div ref={graphDialogRef} className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Результаты расчёта"><div className="graph-dialog"><Suspense fallback={<div className="loading-panel">Загрузка графиков…</div>}><GraphWindow results={results} settings={settings} acSettings={ac} elements={elements} wires={wires} onOpenTransientSettings={() => results?.isAC ? setAcSettingsOpen(true) : setSettingsOpen(true)} onClose={() => setGraphOpen(false)} /></Suspense></div></div>}
      <ElementPropertiesModal element={selected} existingNames={elements.filter(element => element.id !== selected?.id).map(element => element.name)} isOpen={!!selected} onClose={() => setSelected(null)} onSave={value => {
        changeElements(elements.map(element => element.id === value.id ? value : element)); setSelected(null);
      }} />
      <TransientSetupModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} elements={elements} onSave={value => {
        changeSettings(value);
      }} />
      <ACSetupModal isOpen={acSettingsOpen} onClose={() => setAcSettingsOpen(false)} settings={ac} elements={elements} onSave={value => {
        beginHistoryChange(); currentSnapshot.current = { ...currentSnapshot.current, ac: value, dirty: true };
        setAc(value); markChanged(); setGraphOpen(false);
      }} />
      {yamlOpen && <Suspense fallback={<div className="modal-backdrop"><div className="loading-panel">Загрузка редактора…</div></div>}><ScmYamlModal isOpen onClose={() => setYamlOpen(false)} elements={elements} wires={wires} transient={settings} ac={ac} onApplyYaml={data => {
        replaceProject(data, name, true); setYamlOpen(false);
      }} /></Suspense>}
      {helpOpen && <div ref={helpDialogRef} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="help-title"><section className="help-dialog"><header><h2 id="help-title">Работа со схемой</h2><button onClick={() => setHelpOpen(false)} aria-label="Закрыть помощь"><X size={20} /></button></header><p>Элементы сгруппированы по числу полюсов. Удерживайте ЛКМ на миниатюре и перенесите её на схему; во время переноса колесо меняет элемент внутри группы. Стрелка справа открывает полный список.</p><p>Для соединения включите «Проводка», нажмите вывод и затем конечный вывод. Кликами по пустому полю можно задать ручной маршрут, в том числе под 45°. Клик по существующему проводу создаёт видимый узел; простое пересечение линии не соединяет.</p><dl><dt>Выбрать и переместить элемент</dt><dd>Перетащите его за корпус</dd><dt>Изменить форму провода</dt><dd>Перетащите участок провода в режиме выбора</dd><dt>Исключить элемент из расчёта</dt><dd>Выделите двухвыводный элемент и выберите «Разрыв» или «Замыкание»</dd><dt>Свойства элемента</dt><dd>Двойной щелчок или меню по правому клику</dd><dt>Повернуть элемент</dt><dd>Кнопки 90° и 45°, R или Shift+R</dd><dt>Перебрать переносимый элемент</dt><dd>Колесо при удержании ЛКМ</dd><dt>Настроить клавиши</dt><dd>Кнопка «Клавиши» на панели схемы; выберите элемент, нажмите «Назначить» и задайте клавишу или сочетание, затем щёлкните по схеме для размещения</dd><dt>Удалить выбранное</dt><dd>Delete</dd><dt>Отменить / повторить действие</dt><dd>Ctrl+Z / Ctrl+Y</dd><dt>Отменить действие</dt><dd>Esc</dd><dt>Рассчитать и показать график</dt><dd>F9</dd><dt>Открыть / сохранить</dt><dd>Ctrl+O / Ctrl+S</dd></dl><p>Начать можно с готовой схемы в меню «Примеры». Время расчёта и сигналы настраиваются кнопкой с шестерёнкой.</p><button className="primary-action" onClick={() => setHelpOpen(false)}>Понятно</button></section></div>}
    </div>
  );
}

