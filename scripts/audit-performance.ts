import { performance } from 'node:perf_hooks';
import { buildCircuitGraph, solveCircuitTransient } from '../src/math/circuitSolver';
import { exportToYamlScm, parseYamlScm } from '../src/utils/yamlScm';
import type { CircuitElement, CircuitWire, TransientSettings } from '../src/types';

const transient: TransientSettings = {
  tMax: 0.001, tMaxStr: '1m', step: 0.001, stepStr: '1m', eps: 0.001,
  signals: [{ id: '1', plotIndex: 1, exprX: 't', exprY: 'I(V1)', color: '#2563eb', enabled: true }],
};
function circuit(count: number): { elements: CircuitElement[]; wires: CircuitWire[] } {
  const make = (name: string, type: CircuitElement['type'], value: number, x: number): CircuitElement => ({
    id: name, name, type, value, valueStr: String(value), unit: '', x, y: 100, rotation: 0,
  });
  const elements = [make('V1', 'V_DC', 12, 0), ...Array.from({ length: count - 2 }, (_, i) => make(`R${i + 1}`, 'R', 1000, (i + 1) * 40)), make('G', 'GND', 0, (count - 1) * 40)];
  const wires: CircuitWire[] = [];
  const connect = (fromCompId: string, fromPinId: string, toCompId: string, toPinId: string) => wires.push({ id: `w${wires.length}`, fromCompId, fromPinId, toCompId, toPinId });
  connect('V1', '1', 'R1', '1');
  for (let i = 1; i < count - 2; i++) connect(`R${i}`, '2', `R${i + 1}`, '1');
  connect(`R${count - 2}`, '2', 'G', '1');
  connect('V1', '2', 'G', '1');
  return { elements, wires };
}
const measure = <T>(run: () => T): [T, number] => {
  const start = performance.now();
  const value = run();
  return [value, performance.now() - start];
};
for (const count of [10, 50, 100, 500, 1000]) {
  const input = circuit(count);
  const [scm, saveMs] = measure(() => exportToYamlScm(input.elements, input.wires, transient));
  const [loaded, openMs] = measure(() => parseYamlScm(scm));
  const [graph, editGraphMs] = measure(() => buildCircuitGraph(loaded.elements.map((e, i) => i === 1 ? { ...e, x: e.x + 20 } : e), loaded.wires));
  let calculationMs: number | null = null;
  let calculationStatus = 'ok';
  const calculationStart = performance.now();
  try {
    solveCircuitTransient(loaded.elements, loaded.wires, loaded.transient);
  } catch (error) {
    calculationStatus = error instanceof Error ? error.message : String(error);
  }
  calculationMs = performance.now() - calculationStart;
  console.log(JSON.stringify({ elements: count, wires: loaded.wires.length, nodes: graph.nodeCount, scmBytes: Buffer.byteLength(scm), saveMs, openMs, editGraphMs, calculationMs, calculationStatus }));
}
