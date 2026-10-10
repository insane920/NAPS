import type { CircuitElement } from '../types';

export function validateSourceModel(element: CircuitElement) {
  if (!['V_AC', 'I_AC', 'V_PULSE', 'I_PULSE'].includes(element.type)) return;
  const frequency = element.secondaryValue ?? 50;
  if (!Number.isFinite(frequency) || frequency <= 0) throw new Error(`${element.name}: частота должна быть положительной.`);
  const params = element.modelParams;
  if (element.type === 'V_AC' || element.type === 'I_AC') {
    if (!Number.isFinite(params?.sourceOffset ?? 0) || !Number.isFinite(params?.sourcePhaseDeg ?? 0)) throw new Error(`${element.name}: неверное смещение или фаза.`);
    return;
  }
  const duty = element.initialCondition ?? 0.5;
  const low = params?.pulseLow ?? 0, high = params?.pulseHigh ?? element.value;
  const delay = params?.pulseDelay ?? 0, rise = params?.pulseRise ?? 0, fall = params?.pulseFall ?? 0;
  if (![low, high, delay, rise, fall].every(Number.isFinite) || high <= low || delay < 0 || rise < 0 || fall < 0) {
    throw new Error(`${element.name}: для импульса требуется максимум выше минимума и неотрицательные задержка/фронты.`);
  }
  if (!Number.isFinite(duty) || duty < 0 || duty > 1 || rise + fall > duty / frequency) {
    throw new Error(`${element.name}: фронты импульса не помещаются во время высокого уровня.`);
  }
}
