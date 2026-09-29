import type { CircuitElement } from '../types';

export type Logic = 0 | 1 | 'X';
export interface DigitalModel { high: number; low: number; threshold: number; resistance: number; delay: number; hysteresis: number }
export interface DigitalEvent { elementId: string; time: number; value: Logic }
export const digitalTypes = new Set(['NOT', 'AND', 'OR', 'XOR', 'COMPARATOR', 'RS_FF', 'D_FF', 'JK_FF']);

export function digitalModel(e: CircuitElement): DigitalModel {
  const p = e.modelParams;
  const model = { high: p?.logicHigh ?? 5, low: p?.logicLow ?? 0, threshold: p?.logicThreshold ?? 2.5,
    resistance: p?.outputResistance ?? 10, delay: p?.propagationDelay ?? 0, hysteresis: p?.hysteresis ?? 0 };
  if (![model.high, model.low, model.threshold, model.resistance, model.delay, model.hysteresis].every(Number.isFinite)
      || model.high <= model.low || model.resistance <= 0 || model.delay < 0 || model.hysteresis < 0) {
    throw new Error(`${e.name}: неверные уровни, сопротивление, задержка или гистерезис цифровой модели.`);
  }
  return model;
}

export function digitalOutputPins(type: CircuitElement['type']): string[] {
  if (type === 'COMPARATOR') return ['out'];
  if (type === 'NOT') return ['2'];
  if (type === 'AND' || type === 'OR' || type === 'XOR') return ['3'];
  if (type === 'RS_FF' || type === 'D_FF' || type === 'JK_FF') return ['3', '4'];
  return [];
}

export function inputLogic(voltage: number, model: DigitalModel): Logic {
  if (!Number.isFinite(voltage)) return 'X';
  if (voltage < model.threshold - model.hysteresis / 2) return 0;
  if (voltage > model.threshold + model.hysteresis / 2) return 1;
  if (model.hysteresis === 0) return voltage >= model.threshold ? 1 : 0;
  return 'X';
}

/** Desired Q value; complementary /Q is derived from Q. */
export function evaluateDigital(e: CircuitElement, voltage: (pin: string) => number, previous: Logic,
  previousClock: Logic, model: DigitalModel): Logic {
  if (e.type === 'COMPARATOR') {
    const delta = voltage('in_pos') - voltage('in_neg');
    if (!Number.isFinite(delta)) return 'X';
    if (delta > model.hysteresis / 2) return 1;
    if (delta < -model.hysteresis / 2) return 0;
    return previous;
  }
  const read = (pin: string) => inputLogic(voltage(pin), model);
  const a = read('1');
  const b = e.type === 'NOT' ? 0 : read('2');
  if (e.type === 'NOT') return a === 'X' ? 'X' : a === 0 ? 1 : 0;
  if (e.type === 'AND') return a === 0 || b === 0 ? 0 : a === 'X' || b === 'X' ? 'X' : 1;
  if (e.type === 'OR') return a === 1 || b === 1 ? 1 : a === 'X' || b === 'X' ? 'X' : 0;
  if (e.type === 'XOR') return a === 'X' || b === 'X' ? 'X' : a === b ? 0 : 1;
  if (e.type === 'RS_FF') {
    if (a === 1 && b === 1) return 'X';
    if (a === 1 && b === 0) return 1;
    if (a === 0 && b === 1) return 0;
    if (a === 'X' || b === 'X') return 'X';
    return previous;
  }
  const clock = e.type === 'D_FF' ? b : read('clk');
  if (clock === 'X') return 'X';
  if (previousClock !== 0 || clock !== 1) return previous;
  if (e.type === 'D_FF') return a;
  if (e.type === 'JK_FF') {
    if (a === 'X' || b === 'X') return 'X';
    if (a === 0 && b === 0) return previous;
    if (a === 1 && b === 0) return 1;
    if (a === 0 && b === 1) return 0;
    return previous === 'X' ? 'X' : previous === 0 ? 1 : 0;
  }
  return previous;
}
