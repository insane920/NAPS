import { solveCircuitAC, solveCircuitTransient } from './circuitSolver';
import type { ACSettings, CircuitElement, CircuitWire, TransientSettings } from '../types';

self.onmessage = (event: MessageEvent<{
  mode?: 'transient';
  elements: CircuitElement[];
  wires: CircuitWire[];
  settings: TransientSettings;
} | {
  mode: 'ac';
  elements: CircuitElement[];
  wires: CircuitWire[];
  settings: ACSettings;
}>) => {
  const started = performance.now();
  try {
    const data = event.data;
    let results;
    if (data.mode === 'ac') results = solveCircuitAC(data.elements, data.wires, data.settings);
    else {
      if (!Number.isFinite(data.settings.tMax) || data.settings.tMax <= 0 ||
          !Number.isFinite(data.settings.step) || data.settings.step <= 0) {
        throw new Error('Время и шаг расчёта должны быть положительными числами.');
      }
      results = solveCircuitTransient(data.elements, data.wires, data.settings);
    }
    self.postMessage({ results, elapsed: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Не удалось выполнить расчёт.' });
  }
};
