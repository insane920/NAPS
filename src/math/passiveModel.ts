import type { CircuitElement } from '../types';

/** Monotone cubic constitutive laws; old elements retain k=0 exactly. */
export function passiveLaw(element: CircuitElement, argument: number): { value: number; derivative: number } {
  if (!Number.isFinite(argument)) throw new Error(`${element.name}: нелинейная модель получила неконечный аргумент.`);
  const k = element.passiveModel === 'nonlinear' ? element.modelParams?.cubicCoefficient ?? 0 : 0;
  const base = element.type === 'R' ? 1 / element.value : element.value;
  const value = base * argument + k * argument ** 3;
  const derivative = base + 3 * k * argument ** 2;
  if (!Number.isFinite(value) || !Number.isFinite(derivative)) {
    throw new Error(`${element.name}: нелинейная модель вышла за численный диапазон. Уменьшите сигнал или коэффициент.`);
  }
  return { value, derivative };
}

export function validatePassiveModel(element: CircuitElement): void {
  if (!['R', 'C', 'L'].includes(element.type)) return;
  if (!Number.isFinite(element.value) || element.value <= 0) throw new Error(`${element.name}: номинал должен быть положительным.`);
  if (element.passiveModel !== undefined && element.passiveModel !== 'linear' && element.passiveModel !== 'nonlinear') {
    throw new Error(`${element.name}: неизвестная модель пассивного элемента.`);
  }
  if (element.passiveModel === 'nonlinear') {
    const coefficient = element.modelParams?.cubicCoefficient;
    if (!Number.isFinite(coefficient) || coefficient === undefined || coefficient <= 0) {
      throw new Error(`${element.name}: коэффициент кубического члена должен быть положительным конечным числом.`);
    }
  }
}
