import { performance } from 'node:perf_hooks';
import { routeCircuitWires } from '../src/components/SchematicEditor';
import type { CircuitElement, CircuitWire } from '../src/types';

const count = Number(process.argv[2] ?? 50);
const elements: CircuitElement[] = [];
const wires: CircuitWire[] = [];
for (let index = 0; index < count; index++) {
  const y = index * 80;
  for (const [suffix, x] of [['a', 0], ['b', 200]] as const) {
    const id = `${suffix}${index}`;
    elements.push({ id, name: id, type: 'JUNCTION', x, y, rotation: 0, value: 0, valueStr: '', unit: '' });
  }
  wires.push({ id: `w${index}`, fromCompId: `a${index}`, fromPinId: '1', toCompId: `b${index}`, toPinId: '1' });
}
const cache = new Map<string, { x: number; y: number }[]>();
const initial = performance.now();
routeCircuitWires(elements, wires, 20, cache, 'connect');
const cold = performance.now() - initial;
const samples: number[] = [];
for (let step = 0; step < 10; step++) {
  const changed = elements.map(element => element.id === 'a0' ? { ...element, x: step * 20 } : element);
  const start = performance.now();
  routeCircuitWires(changed, wires, 20, cache, 'connect');
  samples.push(performance.now() - start);
}
console.log(JSON.stringify({ wires: count, coldMs: Math.round(cold), changedMs: samples.map(Math.round),
  medianMs: Math.round([...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]) }));
