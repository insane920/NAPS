import type { CircuitElement } from '../types';
import { evaluatePassiveExpression, validatePassiveExpression } from './passiveExpression';

/** Constitutive relations I(U), Q(U), Ψ(I) and their local derivatives. */
export function passiveLaw(element: CircuitElement, argument: number): { value: number; derivative: number } {
  if (!Number.isFinite(argument)) throw new Error(`${element.name}: нелинейная модель получила неконечный аргумент.`);
  const base = element.type === 'R' ? 1 / element.value : element.value;
  const definition = element.passiveModel === 'nonlinear' ? element.passiveLawDefinition : undefined;
  let result: { value: number; derivative: number };
  if (definition?.kind === 'table') {
    result = interpolatedLaw(definition.points, argument);
  } else if (definition?.kind === 'inverseTable') {
    result = inverseInterpolatedLaw(definition.points, argument);
  } else if (definition?.kind === 'saturation') {
    const { limitingInductance, saturationCurrent } = definition;
    const t = Math.tanh(argument / saturationCurrent);
    result = {
      value: limitingInductance * argument + (base - limitingInductance) * saturationCurrent * t,
      derivative: limitingInductance + (base - limitingInductance) * (1 - t * t),
    };
  } else if (definition?.kind === 'expression') {
    try {
      result = evaluatePassiveExpression(definition.expression, argument, base,
        definition.argumentScale, definition.outputScale);
    } catch (error) {
      throw new Error(`${element.name}: ${error instanceof Error ? error.message : 'ошибка пользовательской формулы.'}`);
    }
  } else {
    // Default for legacy SCM files: original cubic constitutive law.
    const k = element.passiveModel === 'nonlinear' ? element.modelParams?.cubicCoefficient ?? 0 : 0;
    result = { value: base * argument + k * argument ** 3, derivative: base + 3 * k * argument ** 2 };
  }
  if (!Number.isFinite(result.value) || !Number.isFinite(result.derivative) || result.derivative <= 0) {
    throw new Error(`${element.name}: модель вышла за численный диапазон или потеряла положительную дифференциальную характеристику.`);
  }
  return result;
}

/** Invert the user-provided U(I) curve without replacing its derivative by a fitted I(U). */
function inverseInterpolatedLaw(points: Array<{ argument: number; value: number }>, voltage: number): { value: number; derivative: number } {
  const first = points[0], last = points[points.length - 1];
  if (voltage <= first.value || voltage >= last.value) {
    const edge = voltage <= first.value ? first : last;
    const slope = interpolatedLaw(points, edge.argument).derivative;
    return { value: edge.argument + (voltage - edge.value) / slope, derivative: 1 / slope };
  }
  let lo = first.argument, hi = last.argument;
  for (let iteration = 0; iteration < 54; iteration++) {
    const middle = (lo + hi) / 2;
    if (interpolatedLaw(points, middle).value < voltage) lo = middle;
    else hi = middle;
  }
  const current = (lo + hi) / 2;
  return { value: current, derivative: 1 / interpolatedLaw(points, current).derivative };
}

/** Monotone Hermite interpolation; the derivative comes from the same polynomial. */
function interpolatedLaw(points: Array<{ argument: number; value: number }>, argument: number): { value: number; derivative: number } {
  const count = points.length;
  const widths = Array.from({ length: count - 1 }, (_, i) => points[i + 1].argument - points[i].argument);
  const secants = widths.map((width, i) => (points[i + 1].value - points[i].value) / width);
  const slopes = [secants[0]];
  for (let i = 1; i < count - 1; i++) {
    const leftWeight = 2 * widths[i] + widths[i - 1];
    const rightWeight = widths[i] + 2 * widths[i - 1];
    slopes.push((leftWeight + rightWeight) / (leftWeight / secants[i - 1] + rightWeight / secants[i]));
  }
  slopes.push(secants[count - 2]);
  if (argument <= points[0].argument) return { value: points[0].value + slopes[0] * (argument - points[0].argument), derivative: slopes[0] };
  if (argument >= points[count - 1].argument) return { value: points[count - 1].value + slopes[count - 1] * (argument - points[count - 1].argument), derivative: slopes[count - 1] };
  let i = 0;
  while (i < count - 2 && argument > points[i + 1].argument) i++;
  const h = widths[i];
  const t = (argument - points[i].argument) / h;
  const y0 = points[i].value;
  const y1 = points[i + 1].value;
  const m0 = slopes[i];
  const m1 = slopes[i + 1];
  const a = 2 * y0 - 2 * y1 + h * (m0 + m1);
  const b = -3 * y0 + 3 * y1 - h * (2 * m0 + m1);
  return {
    value: ((a * t + b) * t + h * m0) * t + y0,
    derivative: (3 * a * t * t + 2 * b * t + h * m0) / h,
  };
}

export function validatePassiveModel(element: CircuitElement): void {
  if (!['R', 'C', 'L'].includes(element.type)) return;
  if (!Number.isFinite(element.value) || element.value <= 0) throw new Error(`${element.name}: номинал должен быть положительным.`);
  if (element.passiveModel !== undefined && element.passiveModel !== 'linear' && element.passiveModel !== 'nonlinear') {
    throw new Error(`${element.name}: неизвестная модель пассивного элемента.`);
  }
  const definition = element.passiveLawDefinition;
  if (definition && element.passiveModel !== 'nonlinear') throw new Error(`${element.name}: зависимость допустима только в нелинейной модели.`);
  if (element.passiveModel !== 'nonlinear') return;
  if (!definition) {
    const coefficient = element.modelParams?.cubicCoefficient;
    if (!Number.isFinite(coefficient) || coefficient === undefined || coefficient <= 0) {
      throw new Error(`${element.name}: коэффициент кубического члена должен быть положительным конечным числом.`);
    }
  } else if (definition.kind === 'table' || definition.kind === 'inverseTable') {
    if (definition.kind === 'inverseTable' && element.type !== 'R') {
      throw new Error(`${element.name}: U(I) допустима только для резистора.`);
    }
    const { points } = definition;
    if (!Array.isArray(points) || points.length < 3 || points.length > 128 ||
      !points.every(point => point && Number.isFinite(point.argument) && Number.isFinite(point.value)) ||
      !points.some(point => point.argument === 0 && point.value === 0) ||
      !points.slice(1).every((point, i) => point.argument > points[i].argument && point.value > points[i].value)) {
      throw new Error(`${element.name}: таблица зависимости должна содержать 3–128 строго возрастающих пар и точку 0; 0.`);
    }
    for (const point of points) passiveLaw(element, point.argument);
  } else if (definition.kind === 'saturation') {
    if (element.type !== 'L' || !Number.isFinite(definition.limitingInductance) ||
      definition.limitingInductance <= 0 || definition.limitingInductance >= element.value ||
      !Number.isFinite(definition.saturationCurrent) || definition.saturationCurrent <= 0) {
      throw new Error(`${element.name}: насыщение требует 0 < Lнас < L0 и Iнас > 0.`);
    }
  } else if (definition.kind === 'expression') {
    if (typeof definition.expression !== 'string' ||
      !Number.isFinite(definition.argumentScale) || definition.argumentScale <= 0 ||
      !Number.isFinite(definition.outputScale) || definition.outputScale <= 0) {
      throw new Error(`${element.name}: формула требует положительные конечные масштабы x0 и y0.`);
    }
    validatePassiveExpression(definition.expression);
    const origin = passiveLaw(element, 0);
    if (Math.abs(origin.value) > 1e-9 * Math.max(1, definition.outputScale)) {
      throw new Error(`${element.name}: зависимость должна проходить через точку (0; 0).`);
    }
    for (let index = -10; index <= 10; index++) passiveLaw(element, index * definition.argumentScale / 2);
  } else {
    throw new Error(`${element.name}: неизвестная зависимость пассивного элемента.`);
  }
}
