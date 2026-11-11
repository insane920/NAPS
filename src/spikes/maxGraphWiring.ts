import '@maxgraph/core/css/common.css';
import { Graph, InternalEvent, UndoManager, UndoableEdit, type Cell } from '@maxgraph/core';
import { SAMPLE_CIRCUITS } from '../data/sampleCircuits';
import { importCircuitIntoMaxGraph } from './maxGraphCircuitAdapter';
import { installTerminalBendAnchors } from './maxGraphBendAnchors';
import { exportToYamlScm, parseYamlScm } from '../utils/yamlScm';
import { normalizeCrossingTopology } from '../components/SchematicEditor';
import { buildCircuitGraph } from '../math/circuitSolver';

const container = document.getElementById('canvas')!;
const status = document.getElementById('stats')!;
const graph = new Graph(container);
const junctionLayer = document.createElement('div');
junctionLayer.id = 'derived-junctions';
Object.assign(junctionLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '10' });
container.appendChild(junctionLayer);
const undoManager = new UndoManager();
let gestureEdits: UndoableEdit[] | null = null;
const recordUndo = (_sender: unknown, event: { getProperty(name: string): unknown }) => {
  const edit = event.getProperty('edit') as UndoableEdit;
  if (gestureEdits) gestureEdits.push(edit);
  else undoManager.undoableEditHappened(edit);
};
graph.getDataModel().addListener(InternalEvent.UNDO, recordUndo);
graph.getView().addListener(InternalEvent.UNDO, recordUndo);
graph.setConnectable(true);
graph.setConnectableEdges(true);
graph.setGridEnabled(true);
graph.setGridSize(20);
graph.setCellsResizable(false);
graph.setAllowDanglingEdges(false);
graph.setPortsEnabled(true);
installTerminalBendAnchors(graph);
// The editor starts in selection mode: the connection hotspot must not steal
// a drag from the middle of a component. Wire creation will be a separate tool.
const connectionHandler = graph.getPlugin('ConnectionHandler') as unknown as {
  setEnabled(enabled: boolean): void;
  addListener(name: string, listener: (sender: unknown, event: { getProperty(name: string): unknown }) => void): void;
} | undefined;
connectionHandler?.setEnabled(false);
type ToolMode = 'select' | 'wire';
let activeTool: ToolMode = 'select';
const setTool = (tool: ToolMode) => {
  activeTool = tool;
  connectionHandler?.setEnabled(tool === 'wire');
  graph.setCellsMovable(tool === 'select');
  for (const name of ['select', 'wire'] as const) {
    const button = document.getElementById(`tool-${name}`);
    if (button) button.setAttribute('aria-pressed', String(tool === name));
  }
};
document.getElementById('tool-select')?.addEventListener('click', () => setTool('select'));
document.getElementById('tool-wire')?.addEventListener('click', () => setTool('wire'));
document.getElementById('undo')?.addEventListener('click', () => undoManager.undo());
document.getElementById('redo')?.addEventListener('click', () => undoManager.redo());
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement) return;
  if (event.code === 'KeyZ') {
    event.preventDefault();
    if (event.shiftKey) undoManager.redo(); else undoManager.undo();
  } else if (event.code === 'KeyY') {
    event.preventDefault();
    undoManager.redo();
  }
});
setTool('select');

const count = Number(new URLSearchParams(location.search).get('wires') ?? 100);
const started = performance.now();
const sources = [];
graph.batchUpdate(() => {
  for (let index = 0; index < count; index++) {
    const y = 30 + index * 35;
    const source = graph.insertVertex({ id: `source-${index}`, value: `A${index}`, position: [80, y],
      size: [30, 20], style: { shape: 'rectangle', fillColor: '#ffffff', strokeColor: '#245ee0' } });
    const target = graph.insertVertex({ id: `target-${index}`, value: `B${index}`, position: [350, y],
      size: [30, 20], style: { shape: 'rectangle', fillColor: '#ffffff', strokeColor: '#245ee0' } });
    graph.insertEdge({ id: `wire-${index}`, source, target, style: { edgeStyle: 'orthogonalEdgeStyle',
      strokeColor: '#168348', rounded: false, endArrow: 'none' } });
    sources.push(source);
  }
});
const resistorA = graph.insertVertex({ id: 'component-a', value: 'R1', position: [600, 100], size: [60, 30],
  style: { shape: 'rectangle', fillColor: '#ffffff', strokeColor: '#245ee0' } });
const resistorB = graph.insertVertex({ id: 'component-b', value: 'R2', position: [900, 100], size: [60, 30],
  style: { shape: 'rectangle', fillColor: '#ffffff', strokeColor: '#245ee0' } });
const outputPin = graph.insertVertex({ parent: resistorA, id: 'component-a-pin-2', value: '', position: [1, 0.5],
  size: [1, 1], relative: true, style: { shape: 'ellipse', fillColor: '#245ee0', strokeColor: '#245ee0' } });
const inputPin = graph.insertVertex({ parent: resistorB, id: 'component-b-pin-1', value: '', position: [0, 0.5],
  size: [1, 1], relative: true, style: { shape: 'ellipse', fillColor: '#245ee0', strokeColor: '#245ee0' } });
const componentWire = graph.insertEdge({ id: 'component-wire', source: outputPin, target: inputPin,
  style: { edgeStyle: 'orthogonalEdgeStyle', strokeColor: '#168348', endArrow: 'none' } });
const sample = SAMPLE_CIRCUITS[0];
const importedCircuit = importCircuitIntoMaxGraph(graph, sample.elements, sample.wires);
const sampleScm = exportToYamlScm(sample.elements, sample.wires, sample.transient);
const sampleScm8 = exportToYamlScm(sample.elements, sample.wires, sample.transient,
  undefined, undefined, 'current', 'connect');
const resistors = sample.elements.filter(element => element.type === 'R').slice(0, 2);
const crossingElements = [
  { ...resistors[0], id: 'cross-r1', name: 'R1', x: 100, y: 220, rotation: 0 },
  { ...resistors[1], id: 'cross-r2', name: 'R2', x: 400, y: 220, rotation: 0 },
  { ...resistors[0], id: 'cross-r3', name: 'R3', x: 250, y: 100, rotation: 90 },
  { ...resistors[1], id: 'cross-r4', name: 'R4', x: 250, y: 340, rotation: 90 },
];
const crossingWires = [
  { id: 'cross-horizontal', fromCompId: 'cross-r1', fromPinId: '2', toCompId: 'cross-r2', toPinId: '1' },
  { id: 'cross-vertical', fromCompId: 'cross-r3', fromPinId: '2', toCompId: 'cross-r4', toPinId: '1' },
];
const crossingScm8 = exportToYamlScm(crossingElements, crossingWires,
  sample.transient, undefined, undefined, 'current', 'connect');
const crossingScm7 = exportToYamlScm(crossingElements, crossingWires,
  sample.transient, undefined, undefined, 'current', 'explicit');
let loadedCircuit: ReturnType<typeof importCircuitIntoMaxGraph> | undefined;
let loadedProject: ReturnType<typeof parseYamlScm> | undefined;
connectionHandler?.addListener(InternalEvent.CONNECT, (_sender, event) => {
  const branch = event.getProperty('cell') as Cell;
  const target = event.getProperty('terminal') as Cell | null;
  const mouse = event.getProperty('event') as MouseEvent | null;
  if (!target?.isEdge() || !loadedCircuit || !mouse) return;
  if (!loadedCircuit.materializeEdgeBranch(branch, target, mouse.clientX, mouse.clientY)) {
    graph.removeCells([branch]);
  }
});
let loadingScm = false;
let junctionRefresh: number | undefined;
const refreshDerivedJunctions = () => {
  junctionLayer.replaceChildren();
  if (!loadedProject || !loadedCircuit || loadedProject.crossingMode !== 'connect') return;
  const rawIds = new Set(loadedCircuit.exportGeometry().elements.map(element => element.id));
  const normalized = normalizeLoadedCrossings();
  for (const node of normalized.elements) {
    if (node.type !== 'JUNCTION' || !node.autoCrossing || rawIds.has(node.id)) continue;
    const point = loadedCircuit.toCanvasPoint(node);
    const marker = document.createElement('span');
    marker.className = 'derived-junction';
    marker.title = 'Нажмите, чтобы закрепить и переместить узел';
    Object.assign(marker.style, { position: 'absolute', left: `${point.x - 4}px`, top: `${point.y - 4}px`,
      width: '8px', height: '8px', borderRadius: '50%', background: '#166534',
      pointerEvents: 'auto', cursor: 'pointer' });
    marker.addEventListener('mousedown', event => {
      event.preventDefault(); event.stopPropagation();
      if (activeTool !== 'select' || !loadedCircuit) return;
      gestureEdits = [];
      const cell = loadedCircuit.materializeCrossing(node);
      if (cell) {
        graph.setSelectionCell(cell);
        status.textContent = 'Узел закреплён и доступен для перемещения';
        marker.remove();
        let lastX = event.clientX, lastY = event.clientY;
        const finish = (cancel: boolean) => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          window.removeEventListener('keydown', key, true);
          const edits = gestureEdits ?? [];
          gestureEdits = null;
          if (edits.length) {
            const combined = graph.getDataModel().createUndoableEdit();
            for (const edit of edits) for (const change of edit.changes) combined.add(change);
            if (cancel) combined.undo();
            else undoManager.undoableEditHappened(combined);
          }
          scheduleJunctionRefresh();
        };
        const move = (movement: MouseEvent) => {
          const dx = (movement.clientX - lastX) / graph.view.scale;
          const dy = (movement.clientY - lastY) / graph.view.scale;
          lastX = movement.clientX; lastY = movement.clientY;
          if (dx || dy) graph.moveCells([cell], dx, dy);
        };
        const up = () => finish(false);
        const key = (pressed: KeyboardEvent) => {
          if (pressed.key === 'Escape') { pressed.preventDefault(); pressed.stopPropagation(); finish(true); }
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        window.addEventListener('keydown', key, true);
        scheduleJunctionRefresh();
      } else {
        gestureEdits = null;
        status.textContent = 'Не удалось закрепить пересечение: проверьте положение проводов';
      }
    });
    junctionLayer.appendChild(marker);
  }
};
const scheduleJunctionRefresh = () => {
  if (loadingScm || gestureEdits !== null || !loadedProject) return;
  if (junctionRefresh !== undefined) cancelAnimationFrame(junctionRefresh);
  junctionRefresh = requestAnimationFrame(() => {
    junctionRefresh = undefined;
    try { refreshDerivedJunctions(); }
    catch (error) { status.textContent = `Ошибка проверки соединений: ${error instanceof Error ? error.message : String(error)}`; }
  });
};
graph.getDataModel().addListener(InternalEvent.CHANGE, scheduleJunctionRefresh);
for (const event of [InternalEvent.SCALE, InternalEvent.TRANSLATE, InternalEvent.SCALE_AND_TRANSLATE])
  graph.getView().addListener(event, scheduleJunctionRefresh);
const loadScmText = (content: string) => {
  // Validate the complete file before touching the visible scene.
  if (!/^\s*scm:\s*$/m.test(content)) throw new Error('Отсутствует заголовок SCM.');
  const parsed = parseYamlScm(content);
  const minX = Math.min(0, ...parsed.elements.map(element => element.x));
  loadingScm = true;
  try {
    graph.batchUpdate(() => {
      graph.removeCells(graph.getChildCells(graph.getDefaultParent(), true, true));
      loadedCircuit = importCircuitIntoMaxGraph(graph, parsed.elements, parsed.wires, 100 - minX);
    });
  } finally { loadingScm = false; }
  undoManager.clear();
  loadedProject = parsed;
  scheduleJunctionRefresh();
  status.textContent = `SCM открыт: ${parsed.elements.length} элементов, ${parsed.wires.length} проводов; пока без сохранения`;
  return parsed;
};
const serializeLoadedProject = () => {
  if (!loadedProject || !loadedCircuit) throw new Error('Сначала откройте SCM.');
  const geometry = loadedCircuit.exportGeometry();
  return exportToYamlScm(geometry.elements, geometry.wires, loadedProject.transient,
    loadedProject.ac, loadedProject.printLayout, 'current', loadedProject.crossingMode,
    loadedProject.description);
};
const normalizeLoadedCrossings = () => {
  if (!loadedProject || !loadedCircuit) throw new Error('Сначала откройте SCM.');
  const geometry = loadedCircuit.exportGeometry();
  return normalizeCrossingTopology(geometry.elements, geometry.wires,
    loadedCircuit.getVisibleRoutes(), loadedProject.crossingMode);
};
const analyzeLoadedTopology = () => {
  if (!loadedProject || !loadedCircuit) throw new Error('Сначала откройте SCM.');
  const raw = loadedCircuit.exportGeometry();
  const normalized = normalizeLoadedCrossings();
  const mapNetworks = (elements: typeof raw.elements, wires: typeof raw.wires) => {
    const graph = buildCircuitGraph(elements, wires);
    return Object.fromEntries(elements.flatMap(element => ['1', '2'].map(pin =>
      [`${element.name}.${pin}`, graph.pinToNode.get(`${element.id}_${pin}`)])));
  };
  return { raw: { ...raw, networks: mapNetworks(raw.elements, raw.wires) },
    normalized: { ...normalized, networks: mapNetworks(normalized.elements, normalized.wires) } };
};
const fileInput = document.getElementById('open-scm-input') as HTMLInputElement | null;
document.getElementById('open-scm')?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { loadScmText(await file.text()); }
  catch (error) { status.textContent = `Не удалось открыть SCM: ${error instanceof Error ? error.message : String(error)}`; }
  finally { fileInput.value = ''; }
});
const createdMs = performance.now() - started;
undoManager.clear();
const measurements: number[] = [];
const move = () => {
  const began = performance.now();
  graph.moveCells([sources[0]], 20, 0);
  const duration = performance.now() - began;
  measurements.push(duration);
  status.textContent = `${count} проводов; создание ${createdMs.toFixed(0)} мс; перенос ${duration.toFixed(1)} мс`;
  return duration;
};
status.textContent = `${count} проводов; создание ${createdMs.toFixed(0)} мс`;
Object.assign(window, { napsMaxGraphSpike: { graph, move, measurements, createdMs, count,
  component: { resistorA, resistorB, outputPin, inputPin, componentWire }, importedCircuit, sample,
  setTool, getTool: () => activeTool, sampleScm, sampleScm8, loadScmText, serializeLoadedProject,
  normalizeLoadedCrossings,
  analyzeLoadedTopology, crossingScm7, crossingScm8,
  undoManager,
  get loadedCircuit() { return loadedCircuit; }, get loadedProject() { return loadedProject; } } });
window.addEventListener('message', event => {
  if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'naps:load-wiring' && typeof event.data.content === 'string') {
    try {
      loadScmText(event.data.content);
      window.parent.postMessage({ type: 'naps:wiring-loaded' }, '*');
    } catch (error) {
      window.parent.postMessage({ type: 'naps:wiring-error', message: error instanceof Error ? error.message : String(error) }, '*');
    }
  } else if (event.data.type === 'naps:apply-wiring') {
    try {
      if (!loadedCircuit) throw new Error('Схема не загружена.');
      window.parent.postMessage({ type: 'naps:wiring-result', content: serializeLoadedProject(),
        geometry: loadedCircuit.exportGeometry(), routes: loadedCircuit.getVisibleRoutes() }, '*');
    } catch (error) {
      window.parent.postMessage({ type: 'naps:wiring-error', message: error instanceof Error ? error.message : String(error) }, '*');
    }
  }
});
