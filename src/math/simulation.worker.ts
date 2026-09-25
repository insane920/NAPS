import { solveCircuitTransient } from './circuitSolver';
import type { CircuitElement, CircuitWire, TransientSettings } from '../types';

self.onmessage = (event: MessageEvent<{
  elements: CircuitElement[];
  wires: CircuitWire[];
  settings: TransientSettings;
}>) => {
  const started = performance.now();
  try {
    const { elements, wires, settings } = event.data;
    if (!Number.isFinite(settings.tMax) || settings.tMax <= 0 ||
        !Number.isFinite(settings.step) || settings.step <= 0) {
      throw new Error('Время и шаг расчёта должны быть положительными числами.');
    }
    const results = solveCircuitTransient(elements, wires, settings);
    self.postMessage({ results, elapsed: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Не удалось выполнить расчёт.' });
  }
};
