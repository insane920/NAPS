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

/** Include switching edges in both linear and topology-based transient solvers. */
export function transientTimeGrid(tMax: number, step: number, sources: CircuitElement[]): number[] {
  const count = Math.ceil(tMax / step);
  if (!Number.isFinite(count) || count > 20000) throw new Error('Более 20 000 шагов. Увеличьте шаг или уменьшите интервал расчёта.');
  const time = Array.from({ length: count + 1 }, (_, k) => k * tMax / count);
  for (const source of sources.filter(e => e.type === 'V_PULSE' || e.type === 'I_PULSE')) {
    validateSourceModel(source);
    const period = 1 / (source.secondaryValue ?? 50), duty = source.initialCondition ?? 0.5;
    const delay = source.modelParams?.pulseDelay ?? 0;
    const rise = source.modelParams?.pulseRise ?? 0, fall = source.modelParams?.pulseFall ?? 0;
    const cycles = delay > tMax ? 0 : Math.floor((tMax - delay) / period) + 1;
    if (!Number.isSafeInteger(cycles) || cycles > 20000) {
      throw new Error('Более 20 000 периодов импульса. Уменьшите интервал расчёта или частоту.');
    }
    for (let n = 0; n < cycles; n++) {
      for (const edge of [delay + n * period, delay + n * period + rise, delay + n * period + duty * period - fall, delay + n * period + duty * period]) {
        if (edge > 0 && edge < tMax) time.push(edge);
      }
    }
  }
  time.sort((a, b) => a - b);
  for (let i = time.length - 1; i > 0; i--) if (time[i] - time[i - 1] <= 1e-13 * Math.max(1, time[i])) time.splice(i, 1);
  if (time.length > 20000) throw new Error('Более 20 000 точек с учётом фронтов импульсов.');
  return time;
}
