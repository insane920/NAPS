import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Save, FileCode2, CircleHelp, X, LoaderCircle, Undo2, Redo2, Activity, SlidersHorizontal, FileText } from 'lucide-react';
import { SchematicEditor, routeCircuitWires, hasUnmaterializedCrossings, normalizeCrossingTopology, validateCircuitGeometry } from './components/SchematicEditor';
import { ElementPropertiesModal } from './components/ElementPropertiesModal';
import { TransientSetupModal } from './components/TransientSetupModal';
import { ACSetupModal } from './components/ACSetupModal';
import { SAMPLE_CIRCUITS, type SampleCircuit } from './data/sampleCircuits';
import { exportToYamlScm, parseYamlScm, EMPTY_CIRCUIT_DESCRIPTION, type CircuitDescription } from './utils/yamlScm';
import type { ACSettings, CircuitElement, CircuitWire, CircuitSimulationResults, TransientSettings, WireCrossingMode } from './types';
import { useModalFocus } from './hooks/useModalFocus';
import { NapsLogo } from './components/NapsLogo';
import { bindCurrentControls, replaceElementPreservingControls } from './math/controlledSources';
import { version as appVersion } from '../package.json';
import { DEFAULT_PRINT_LAYOUT, SCHEMATIC_UNITS_PER_MM, type PrintLayout } from './utils/printLayout';
import { readRecovery, writeRecovery, discardRecovery, type RecoveryCopy } from './utils/projectRecovery';

const GraphWindow = lazy(() => import('./components/GraphWindow').then(m => ({ default: m.GraphWindow })));
const ScmYamlModal = lazy(() => import('./components/ScmYamlModal').then(m => ({ default: m.ScmYamlModal })));

interface HistorySnapshot {
  elements: CircuitElement[];
  wires: CircuitWire[];
  settings: TransientSettings;
  ac: ACSettings;
  printLayout: PrintLayout;
  description: CircuitDescription;
  crossingMode: WireCrossingMode;
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
  const [printLayout, setPrintLayout] = useState<PrintLayout>(DEFAULT_PRINT_LAYOUT);
  const [description, setDescription] = useState<CircuitDescription>(EMPTY_CIRCUIT_DESCRIPTION);
  const [crossingMode, setCrossingMode] = useState<WireCrossingMode>('connect');
  const [name, setName] = useState('Новая схема');
  const [dirty, setDirty] = useState(false);
  const [recoveryCopy, setRecoveryCopy] = useState<RecoveryCopy | null>(() => {
    try { return readRecovery(localStorage); } catch { return null; }
  });
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [results, setResults] = useState<CircuitSimulationResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Добавьте компоненты из библиотеки');
  const [hoverStatus, setHoverStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [acSettingsOpen, setAcSettingsOpen] = useState(false);
  const openAnalysisPanel = useCallback((mode: 'transient' | 'ac') => {
    setSettingsOpen(mode === 'transient');
    setAcSettingsOpen(mode === 'ac');
  }, []);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState<CircuitDescription>(EMPTY_CIRCUIT_DESCRIPTION);
  const graphDialogRef = useModalFocus<HTMLDivElement>(graphOpen && !settingsOpen && !acSettingsOpen);
  const helpDialogRef = useModalFocus<HTMLDivElement>(helpOpen);
  const descriptionDialogRef = useModalFocus<HTMLDivElement>(descriptionOpen, 'input');
  const [selected, setSelected] = useState<CircuitElement | null>(null);
  const [viewRevision, setViewRevision] = useState(0);
  const [fitRevision, setFitRevision] = useState(0);
  const worker = useRef<Worker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const currentSnapshot = useRef<HistorySnapshot>({ elements: [], wires: [], settings: newProjectSettings, ac: newACSettings, printLayout: DEFAULT_PRINT_LAYOUT, description: EMPTY_CIRCUIT_DESCRIPTION, crossingMode: 'connect', name: 'Новая схема', dirty: false });
  const undoStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  const historyGroupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyGroupOpen = useRef(false);
  const continuousHistoryGroup = useRef(false);
  const continuousRedoBackup = useRef<HistorySnapshot[] | null>(null);
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
    if (!continuousHistoryGroup.current) continuousRedoBackup.current = redoStack.current.slice();
    continuousHistoryGroup.current = true;
    if (historyGroupTimer.current) clearTimeout(historyGroupTimer.current);
    historyGroupTimer.current = null;
    beginHistoryChange();
  }, [beginHistoryChange]);
  const endContinuousHistory = useCallback(() => {
    continuousRedoBackup.current = null;
    continuousHistoryGroup.current = false; closeHistoryGroup();
  }, [closeHistoryGroup]);
  const changeElements = useCallback((value: CircuitElement[]) => {
    setHoverStatus(null);
    value = bindCurrentControls(value);
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
    setElements(restored.elements); setWires(restored.wires); setSettings(restored.settings); setAc(restored.ac); setPrintLayout(restored.printLayout); setDescription(restored.description); setCrossingMode(restored.crossingMode); setName(restored.name); setDirty(restored.dirty);
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
  const cancelContinuousHistory = useCallback(() => {
    if (!continuousHistoryGroup.current) return;
    const savedRedo = continuousRedoBackup.current;
    continuousRedoBackup.current = null;
    continuousHistoryGroup.current = false;
    const previous = undoStack.current.pop();
    if (savedRedo) redoStack.current = savedRedo;
    if (previous) restoreSnapshot(previous, 'Перемещение отменено');
    else closeHistoryGroup();
  }, [restoreSnapshot, closeHistoryGroup]);
  useEffect(() => () => { worker.current?.terminate(); if (historyGroupTimer.current) clearTimeout(historyGroupTimer.current); }, []);
  useEffect(() => { document.title = `${dirty ? '• ' : ''}${name} — NAPS ${appVersion}`; }, [dirty, name]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  useEffect(() => {
    // Preserve the offered recovery until the user has chosen what to do with it.
    if (!dirty || recoveryCopy) return;
    const persist = () => {
      try {
        const snapshot = currentSnapshot.current;
        writeRecovery(localStorage, { version: 1, name: snapshot.name, savedAt: Date.now(),
          content: exportToYamlScm(snapshot.elements, snapshot.wires, snapshot.settings, snapshot.ac, snapshot.printLayout, 'current', snapshot.crossingMode, snapshot.description) });
        setRecoveryError(null);
      } catch { setRecoveryError('Автосохранение недоступно. Сохраните схему в файл.'); }
    };
    const timer = window.setTimeout(persist, 800);
    const onHidden = () => { if (document.visibilityState === 'hidden') persist(); };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onHidden);
    return () => { window.clearTimeout(timer); window.removeEventListener('pagehide', persist); document.removeEventListener('visibilitychange', onHidden); };
  }, [elements, wires, settings, ac, printLayout, description, name, dirty, recoveryCopy]);

  const runSimulation = useCallback(() => {
    if (!elements.length) { setError('Добавьте элементы на схему перед расчётом.'); return; }
    try { validateCircuitGeometry(elements, wires, printLayout.gridMm * SCHEMATIC_UNITS_PER_MM, crossingMode); }
    catch (error) { setError(error instanceof Error ? error.message : 'Ошибка проводки.'); return; }
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
  }, [elements, wires, settings, stopCalculation, printLayout.gridMm, crossingMode]);

  const runAC = useCallback(() => {
    if (!elements.length) { setError('Добавьте элементы на схему перед расчётом.'); return; }
    try { validateCircuitGeometry(elements, wires, printLayout.gridMm * SCHEMATIC_UNITS_PER_MM, crossingMode); }
    catch (error) { setError(error instanceof Error ? error.message : 'Ошибка проводки.'); return; }
    let calculationSettings = ac;
    if (!ac.signals.some(s => s.enabled)) {
      const output = elements.find(e => e.type === 'PORT' && /out/i.test(e.portName || e.name))
        ?? elements.find(e => e.type === 'PORT');
      const input = elements.find(e => e.type === 'PORT' && /in/i.test(e.portName || e.name));
      const expr = output ? `U(${output.portName || output.name})` : elements.find(e => e.type === 'R') ? `U(${elements.find(e => e.type === 'R')!.name})` : '';
      if (!expr) { openAnalysisPanel('ac'); return; }
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
  }, [ac, elements, wires, stopCalculation, openAnalysisPanel, printLayout.gridMm, crossingMode]);

  const replaceProject = (data: { elements: CircuitElement[]; wires: CircuitWire[]; transient: TransientSettings; ac?: ACSettings; printLayout?: PrintLayout; description?: CircuitDescription; crossingMode?: WireCrossingMode }, title: string, edited = false) => {
    if (data.crossingMode === 'connect') {
      const routes = routeCircuitWires(data.elements, data.wires, (data.printLayout ?? DEFAULT_PRINT_LAYOUT).gridMm * SCHEMATIC_UNITS_PER_MM);
      if (routes.every(route => !route.unrouted) && hasUnmaterializedCrossings(data.elements, data.wires, routes)) {
        data = { ...data, ...normalizeCrossingTopology(data.elements, data.wires, routes, 'connect') };
        edited = true;
      }
    }
    setHoverStatus(null);
    data = { ...data, elements: bindCurrentControls(data.elements) };
    closeHistoryGroup(); undoStack.current = []; redoStack.current = [];
    setSelected(null);
    setSettingsOpen(false); setAcSettingsOpen(false);
    currentSnapshot.current = cloneSnapshot({ elements: data.elements, wires: data.wires, settings: data.transient, ac: data.ac ?? newACSettings, printLayout: data.printLayout ?? DEFAULT_PRINT_LAYOUT, description: data.description ?? EMPTY_CIRCUIT_DESCRIPTION, crossingMode: data.crossingMode ?? 'explicit', name: title, dirty: edited });
    setHistoryVersion(value => value + 1);
    setViewRevision(value => value + 1);
    setFitRevision(value => value + 1);
    markChanged(); setElements(data.elements); setWires(data.wires); setSettings(data.transient); setAc(data.ac ?? newACSettings); setPrintLayout(data.printLayout ?? DEFAULT_PRINT_LAYOUT); setDescription(data.description ?? EMPTY_CIRCUIT_DESCRIPTION); setCrossingMode(data.crossingMode ?? 'explicit');
    let geometryWarning: string | null = null;
    try { validateCircuitGeometry(data.elements, data.wires,
      (data.printLayout ?? DEFAULT_PRINT_LAYOUT).gridMm * SCHEMATIC_UNITS_PER_MM, data.crossingMode ?? 'explicit'); }
    catch (cause) { geometryWarning = cause instanceof Error ? cause.message : 'Ошибка геометрии проводов.'; }
    setName(title); setDirty(edited); setError(geometryWarning); setGraphOpen(false);
    setStatus(geometryWarning ? 'Схема открыта: требуется исправить проводку' : 'Схема готова к расчёту');
  };
  const clearProject = () => {
    setHoverStatus(null);
    setSettingsOpen(false); setAcSettingsOpen(false);
    closeHistoryGroup(); beginHistoryChange();
    const emptySettings = { ...newProjectSettings, signals: [] };
    currentSnapshot.current = { elements: [], wires: [], settings: emptySettings, ac: newACSettings, printLayout: DEFAULT_PRINT_LAYOUT, description: EMPTY_CIRCUIT_DESCRIPTION, crossingMode: 'connect', name: 'Новая схема', dirty: true };
    markChanged(); setElements([]); setWires([]); setSettings(emptySettings); setAc(newACSettings); setPrintLayout(DEFAULT_PRINT_LAYOUT); setDescription(EMPTY_CIRCUIT_DESCRIPTION); setCrossingMode('connect'); setName('Новая схема');
    setSelected(null); setError(null); setGraphOpen(false); setViewRevision(value => value + 1);
  };
  const confirmReplace = () => !dirty || window.confirm('В схеме есть несохранённые изменения. Заменить её?');
  const loadSample = (value: SampleCircuit) => { if (confirmReplace()) replaceProject({ ...value, description: { title: value.name, purpose: value.description, comment: '' } }, value.name); };
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
  const saveCircuit = async (format: 'current' | 'legacy' = 'current') => {
    const savedRevision = revision.current;
    try {
      const content = exportToYamlScm(elements, wires, settings, ac, printLayout, format, crossingMode, description);
      const baseName = name.replace(/-(scm7|scm8|0\.6\.0)$/i, '').replace(/[<>:"/\\|?*]/g, '_');
      const fileName = `${baseName}-${format === 'current' ? (crossingMode === 'connect' ? 'scm8' : 'scm7') : '0.6.0'}.scm`;
      if (window.desktop) {
        const savedName = await window.desktop.saveCircuit(content, fileName);
        if (!savedName) return;
        if (format === 'current' && revision.current === savedRevision) {
          setName(savedName.replace(/\.scm$/i, '')); setDirty(false);
          currentSnapshot.current = { ...currentSnapshot.current, name: savedName.replace(/\.scm$/i, ''), dirty: false };
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
      else if (command && physicalKey === 'KeyS') { event.preventDefault(); void saveCircuit(); }
      else if (command && physicalKey === 'KeyO') { event.preventDefault(); void openCircuit(); }
      else if (event.key === 'Escape') { setHelpOpen(false); setGraphOpen(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openCircuit, redo, saveCircuit, undo]);
  const modalOpen = graphOpen || settingsOpen || acSettingsOpen || yamlOpen || helpOpen || descriptionOpen || !!selected;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand" aria-label={`NAPS ${appVersion} — Numerical, Analytical, PWL, Simulation`}><NapsLogo className="brand-logo" /><span className="brand-tagline">Numerical · Analytical · PWL · Simulation<small className="block mt-1 font-semibold">Версия {appVersion}</small></span></div>
        <div className="project-name" title={name}>{dirty && <span className="unsaved-dot" title="Есть несохранённые изменения" />}<span>{name}</span><small>СХЕМА</small></div>
        <nav className="file-actions" aria-label="Действия с проектом">
          <button onClick={undo} disabled={!undoStack.current.length} title="Отменить (Ctrl+Z)" aria-label="Отменить"><Undo2 size={16} /></button>
          <button onClick={redo} disabled={!redoStack.current.length} title="Повторить (Ctrl+Y)" aria-label="Повторить"><Redo2 size={16} /></button>
          <button onClick={openCircuit} title="Открыть схему (Ctrl+O)"><FolderOpen size={16} /><span>Открыть</span></button>
          <button onClick={() => void saveCircuit()} title={`Сохранить SCM ${crossingMode === 'connect' ? '8' : '7'} с координатами в мм (Ctrl+S). Для старой версии используйте копию 0.6.0.`}><Save size={16} /><span>Сохранить</span></button>
          <button onClick={() => void saveCircuit('legacy')} title="Сохранить отдельную копию для NAPS 0.6.0. Произвольные углы и сетка 0,5 мм несовместимы."><span>Копия 0.6.0</span></button>
          <button onClick={runAC} title="Рассчитать АЧХ и ФЧХ"><Activity size={16} /><span>Частотные характеристики</span></button>
          <button onClick={() => openAnalysisPanel('ac')} title="Параметры частотного анализа" aria-label="Параметры частотного анализа"><SlidersHorizontal size={16} /></button>
          <button onClick={() => setYamlOpen(true)} title="Редактор файла схемы" aria-label="Редактор файла схемы"><FileCode2 size={17} /></button>
          <button onClick={() => { setDescriptionDraft({ ...description }); setDescriptionOpen(true); }} title="Название, назначение и комментарий схемы"><FileText size={16} /><span>Описание</span></button>
          <button onClick={() => setHelpOpen(true)} title="Помощь" aria-label="Помощь"><CircleHelp size={17} /></button>
        </nav>
        <input ref={fileInput} className="hidden" type="file" accept=".scm" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          try { importCircuit(await file.text(), file.name); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка чтения файла.'); }
        }} />
      </header>
      <div className="px-3 py-1 text-[11px] text-slate-500">Сохранение: SCM {crossingMode === 'connect' ? '8 (пересечения соединяются)' : '7 (узлы только явные)'}, координаты в мм. Для старых версий доступна «Копия 0.6.0».</div>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Закрыть сообщение"><X size={16} /></button></div>}
      {recoveryCopy && <div role="status" className="flex flex-wrap items-center gap-3 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <span>Есть резервная копия «{recoveryCopy.name}» от {new Date(recoveryCopy.savedAt).toLocaleString('ru-RU')}.</span>
        <button className="rounded border px-2 py-1" onClick={() => {
          if (!confirmReplace()) return;
          try { replaceProject(parseYamlScm(recoveryCopy.content), recoveryCopy.name, true); setRecoveryCopy(null); }
          catch { setRecoveryError('Резервную копию не удалось открыть.'); }
        }}>Восстановить схему</button>
        <button className="rounded border px-2 py-1" onClick={() => {
          try { discardRecovery(localStorage); setRecoveryCopy(null); }
          catch { setRecoveryError('Не удалось удалить резервную копию.'); }
        }}>Удалить резервную копию</button>
      </div>}
      {recoveryError && <div role="alert" className="bg-amber-50 px-3 py-2 text-sm text-amber-900">{recoveryError}</div>}
      <main className="workspace">
        <SchematicEditor elements={elements} wires={wires} printLayout={printLayout} description={description} onPrintLayoutChange={value => { beginHistoryChange(); currentSnapshot.current = { ...currentSnapshot.current, printLayout: value, dirty: true }; setPrintLayout(value); markChanged(); }} onElementsChange={changeElements} onWiresChange={changeWires}
          onBeginContinuousEdit={beginContinuousHistory} onEndContinuousEdit={endContinuousHistory} onCancelContinuousEdit={cancelContinuousHistory}
          onSelectElement={() => {}} onOpenProperties={setSelected} onRunSimulation={runSimulation}
          onOpenTransientSettings={() => openAnalysisPanel('transient')} onLoadSample={loadSample} onClearProject={clearProject} crossingMode={crossingMode}
          onBuildPlot={runSimulation} isGraphOpen={graphOpen} isSimulating={busy} shortcutsEnabled={!modalOpen} viewRevision={viewRevision} fitRevision={fitRevision} onHoverStatus={setHoverStatus} />
      </main>
      <footer className="status-bar">
        <span className="status-message" role="status">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <span className="status-dot" />}<span className="status-text" title={hoverStatus || status}>{hoverStatus || status}</span></span>
        {busy && <button onClick={() => { stopCalculation(); setStatus('Расчёт отменён'); }}>Отменить</button>}
        <span className="status-count">Элементы: {elements.length}<span>Соединения: {wires.length}</span></span>
        <span className="status-hint">Двойной щелчок — свойства · F9 — расчёт</span>
      </footer>
      {graphOpen && <div ref={graphDialogRef} className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Результаты расчёта"><div className="graph-dialog"><Suspense fallback={<div className="loading-panel">Загрузка графиков…</div>}><GraphWindow results={results} settings={settings} acSettings={ac} elements={elements} wires={wires} onOpenTransientSettings={() => openAnalysisPanel(results?.isAC ? 'ac' : 'transient')} onClose={() => setGraphOpen(false)} /></Suspense></div></div>}
      <ElementPropertiesModal circuitElements={elements} circuitWires={wires} element={selected} existingNames={elements.filter(element => element.id !== selected?.id).map(element => element.name)} controlSources={elements.filter(element => ['V_DC', 'V_AC', 'V_PULSE'].includes(element.type) && !element.isolation)} isOpen={!!selected} onClose={() => setSelected(null)} onSave={value => {
        beginContinuousHistory();
        changeElements(replaceElementPreservingControls(elements, value));
        if (value.type === 'CHIP') {
          const valid = new Set(value.chipPins?.map(pin => pin.id));
          changeWires(wires.filter(wire => (wire.fromCompId !== value.id || valid.has(wire.fromPinId)) && (wire.toCompId !== value.id || valid.has(wire.toPinId))));
        }
        endContinuousHistory(); setSelected(null);
      }} />
      <TransientSetupModal isOpen={settingsOpen} dock onClose={() => setSettingsOpen(false)} settings={settings} elements={elements} onSave={value => {
        changeSettings(value);
      }} />
      <ACSetupModal isOpen={acSettingsOpen} dock onClose={() => setAcSettingsOpen(false)} settings={ac} elements={elements} onSave={value => {
        beginHistoryChange(); currentSnapshot.current = { ...currentSnapshot.current, ac: value, dirty: true };
        setAc(value); markChanged(); setGraphOpen(false);
      }} />
      {yamlOpen && <Suspense fallback={<div className="modal-backdrop"><div className="loading-panel">Загрузка редактора…</div></div>}><ScmYamlModal isOpen onClose={() => setYamlOpen(false)} elements={elements} wires={wires} transient={settings} ac={ac} printLayout={printLayout} crossingMode={crossingMode} description={description} onApplyYaml={data => {
        replaceProject(data, name, true); setYamlOpen(false);
      }} /></Suspense>}
      {descriptionOpen && <div className="modal-backdrop" role="presentation"><section ref={descriptionDialogRef} className="help-dialog max-w-xl" role="dialog" aria-modal="true" aria-labelledby="description-title"><header><h2 id="description-title">Описание схемы</h2><button onClick={() => setDescriptionOpen(false)} aria-label="Закрыть описание"><X size={20} /></button></header>
        <div className="grid max-h-[75vh] gap-3 overflow-y-auto p-4 text-sm">
          <label className="grid gap-1">Название схемы<input className="rounded border border-slate-300 px-3 py-2" value={descriptionDraft.title} onChange={event => setDescriptionDraft({ ...descriptionDraft, title: event.target.value })} maxLength={200} /></label>
          <label className="grid gap-1">Назначение<textarea className="min-h-20 rounded border border-slate-300 px-3 py-2" value={descriptionDraft.purpose} onChange={event => setDescriptionDraft({ ...descriptionDraft, purpose: event.target.value })} maxLength={2000} /></label>
          <label className="grid gap-1">Комментарий<textarea className="min-h-28 rounded border border-slate-300 px-3 py-2" value={descriptionDraft.comment} onChange={event => setDescriptionDraft({ ...descriptionDraft, comment: event.target.value })} maxLength={5000} /></label>
          <strong className="border-t pt-3">Основная надпись для экспорта</strong>
          {([
            ['designation', 'Обозначение документа'], ['organization', 'Организация'], ['author', 'Разработал'],
            ['checker', 'Проверил'], ['normController', 'Нормоконтроль'], ['approver', 'Утвердил'],
            ['issueDate', 'Дата'], ['sheetNumber', 'Лист'], ['sheetCount', 'Листов'],
          ] as const).map(([field, label]) => <label key={field} className="grid gap-1">{label}
            <input className="rounded border border-slate-300 px-3 py-2" value={descriptionDraft[field] ?? ''}
              onChange={event => setDescriptionDraft({ ...descriptionDraft, [field]: event.target.value })} maxLength={120} />
          </label>)}
          <div className="flex justify-end gap-2"><button onClick={() => setDescriptionOpen(false)}>Отмена</button><button className="primary-action" onClick={() => { beginHistoryChange(); const next = { ...descriptionDraft }; currentSnapshot.current = { ...currentSnapshot.current, description: next, dirty: true }; setDescription(next); markChanged(); setDescriptionOpen(false); }}>Сохранить описание</button></div>
        </div>
      </section></div>}
      {helpOpen && <div ref={helpDialogRef} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="help-title"><section className="help-dialog"><header><h2 id="help-title">Работа со схемой</h2><button onClick={() => setHelpOpen(false)} aria-label="Закрыть помощь"><X size={20} /></button></header><p>В панели размещения доступны базовые двухполюсники. Удерживайте ЛКМ на миниатюре и перенесите её на схему; колесо меняет элемент. После размещения можно поставить ещё элементы того же типа. Esc или ПКМ завершает размещение. Старые схемы с другими компонентами продолжают открываться.</p><p>Наведите на вывод, нажмите ЛКМ и протяните провод к другому выводу. Отдельный режим проводки не требуется. Кликами по пустому полю можно задать ручной маршрут, в том числе под 45°. Клик по существующему проводу создаёт видимый узел. В новых проектах пересечение нового провода с другой сетью соединяет их; SCM 7 и более ранние файлы сохраняют прежний режим явных узлов.</p><dl><dt>Выбрать и переместить элемент</dt><dd>Перетащите его за корпус</dd><dt>Выделить группу</dt><dd>Рамка на пустом поле или Shift/Ctrl + щелчок по элементам</dd><dt>Изменить форму провода</dt><dd>Перетащите участок провода</dd><dt>Исключить элемент из расчёта</dt><dd>Выделите двухвыводный элемент и выберите «Разрыв» или «Замыкание»</dd><dt>Свойства элемента</dt><dd>Двойной щелчок, Enter или меню по правому клику</dd><dt>Повернуть элемент</dt><dd>Кнопки 90° и 45°, R или Shift+R</dd><dt>Копировать / вставить</dt><dd>Ctrl+C / Ctrl+V</dd><dt>Перебрать переносимый элемент</dt><dd>Колесо при удержании ЛКМ</dd><dt>Настроить клавиши</dt><dd>Кнопка «Клавиши» на панели схемы</dd><dt>Удалить выбранное</dt><dd>Delete</dd><dt>Отменить / повторить действие</dt><dd>Ctrl+Z / Ctrl+Y или Ctrl+Shift+Z</dd><dt>Отменить действие</dt><dd>Esc или правый клик по пустому полю</dd><dt>Рассчитать и показать график</dt><dd>F9</dd><dt>Открыть / сохранить</dt><dd>Ctrl+O / Ctrl+S</dd></dl><p>Начать можно с готовой схемы в меню «Примеры». Время расчёта и сигналы настраиваются кнопкой с шестерёнкой.</p><button className="primary-action" onClick={() => setHelpOpen(false)}>Понятно</button></section></div>}
    </div>
  );
}

