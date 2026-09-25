import { DataPoint, InterpolationMethod, SplineSegment, CalculationResult } from '../types';
import { fitPolynomialLeastSquares } from './leastSquares';

export interface ValidationCheckResult {
  isValid: boolean;
  errorCode?: 'TOO_FEW_POINTS' | 'DUPLICATE_X' | 'INVALID_TARGET_X' | 'NAN_POINTS';
  errorMessage?: string;
  detailedMessage?: string;
  sortedPoints: Array<{ x: number; y: number }>;
}

/**
 * Validates and sorts points by ascending X argument.
 * Checks for duplicates (x_i == x_{i+1}) and minimal point counts.
 */
export function validatePoints(
  rawPoints: Array<{ x: number; y: number }>,
  method: InterpolationMethod,
  targetXStr: string,
  polynomialDegree: number = 2
): ValidationCheckResult {
  // Validate target X input
  const cleanTargetXStr = targetXStr.trim().replace(',', '.');
  const targetX = Number(cleanTargetXStr);
  if (cleanTargetXStr === '' || isNaN(targetX)) {
    return {
      isValid: false,
      errorCode: 'INVALID_TARGET_X',
      errorMessage: 'Некорректное целевое значение Xцел',
      detailedMessage: `Поле целевого аргумента пустое или содержит недопустимые символы: "${targetXStr}". Введите действительное число.`,
      sortedPoints: [],
    };
  }

  // Filter valid numerical points
  const validPoints = rawPoints.filter(p => !isNaN(p.x) && !isNaN(p.y) && isFinite(p.x) && isFinite(p.y));

  // Check minimum points
  let minRequired = 2;
  if (method === 'cubic-spline') {
    minRequired = 3;
  } else if (method === 'least-squares') {
    minRequired = polynomialDegree + 1;
  }

  if (validPoints.length < minRequired) {
    let methodDesc = 'Кусочно-линейная интерполяция';
    if (method === 'cubic-spline') methodDesc = 'Кубический сплайн';
    else if (method === 'least-squares') methodDesc = `МНК полином ${polynomialDegree}-й степени (NumPy)`;

    return {
      isValid: false,
      errorCode: 'TOO_FEW_POINTS',
      errorMessage: 'Недостаточное количество точек',
      detailedMessage: `Для метода «${methodDesc}» требуется минимум ${minRequired} точки. Текущее количество валидных точек: ${validPoints.length}.${
        method === 'least-squares' ? ' Уменьшите степень полинома или добавьте строки в таблицу.' : ''
      }`,
      sortedPoints: [],
    };
  }

  // Sort strictly by X ascending
  const sorted = [...validPoints].sort((a, b) => a.x - b.x);

  // Check for duplicate X values (violation of single-valued function)
  const EPSILON = 1e-12;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (Math.abs(sorted[i + 1].x - sorted[i].x) < EPSILON) {
      return {
        isValid: false,
        errorCode: 'DUPLICATE_X',
        errorMessage: 'Дублирование аргумента X',
        detailedMessage: `Обнаружены точки с одинаковым значением аргумента X = ${sorted[i].x} (точки #${i + 1} и #${i + 2}). Нарушено условие однозначности функции y = F(x). Измените или удалите дублирующую точку.`,
        sortedPoints: sorted,
      };
    }
  }

  return {
    isValid: true,
    sortedPoints: sorted,
  };
}

/**
 * Natural Cubic Spline coefficients calculation
 * S_i(x) = a_i + b_i*(x - x_i) + c_i*(x - x_i)^2 + d_i*(x - x_i)^3 for x in [x_i, x_{i+1}]
 * Using standard Thomas algorithm for solving tridiagonal system.
 */
export function buildCubicSpline(points: Array<{ x: number; y: number }>): {
  segments: SplineSegment[];
  evaluate: (x: number) => { y: number; segmentIndex: number; slope: number };
} {
  const n = points.length - 1; // number of segments
  const x = points.map(p => p.x);
  const y = points.map(p => p.y);

  const h: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    h[i] = x[i + 1] - x[i];
  }

  // Natural boundary conditions: S''(x_0) = 0 and S''(x_n) = 0
  // Solve system for c_i (where second derivative M_i = 2 * c_i)
  const alpha: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    alpha[i] = (3 / h[i]) * (y[i + 1] - y[i]) - (3 / h[i - 1]) * (y[i] - y[i - 1]);
  }

  const l: number[] = new Array(n + 1).fill(0);
  const mu: number[] = new Array(n + 1).fill(0);
  const z: number[] = new Array(n + 1).fill(0);

  l[0] = 1;
  mu[0] = 0;
  z[0] = 0;

  for (let i = 1; i < n; i++) {
    l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }

  l[n] = 1;
  z[n] = 0;

  const c: number[] = new Array(n + 1).fill(0);
  const b: number[] = new Array(n).fill(0);
  const d: number[] = new Array(n).fill(0);
  const a: number[] = new Array(n).fill(0);

  for (let j = n - 1; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (y[j + 1] - y[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    a[j] = y[j];
  }

  const segments: SplineSegment[] = [];
  for (let i = 0; i < n; i++) {
    segments.push({
      i,
      x0: x[i],
      x1: x[i + 1],
      a: a[i],
      b: b[i],
      c: c[i],
      d: d[i],
    });
  }

  const evaluate = (targetX: number) => {
    // Determine segment
    let idx = 0;
    if (targetX < x[0]) {
      // Left extrapolation: linear tangent continuation from point 0
      const slope0 = b[0];
      const y0 = y[0] + slope0 * (targetX - x[0]);
      return { y: y0, segmentIndex: 0, slope: slope0 };
    } else if (targetX > x[n]) {
      // Right extrapolation: linear tangent continuation from point n
      // S'_{n-1}(x_n) = b_{n-1} + 2*c_{n-1}*h_{n-1} + 3*d_{n-1}*h_{n-1}^2
      const hn1 = h[n - 1];
      const slopeN = b[n - 1] + 2 * c[n - 1] * hn1 + 3 * d[n - 1] * hn1 * hn1;
      const yn = y[n] + slopeN * (targetX - x[n]);
      return { y: yn, segmentIndex: n - 1, slope: slopeN };
    } else {
      // Find segment
      for (let i = 0; i < n; i++) {
        if (targetX <= x[i + 1] || i === n - 1) {
          idx = i;
          break;
        }
      }
      const dx = targetX - x[idx];
      const val = a[idx] + b[idx] * dx + c[idx] * dx * dx + d[idx] * dx * dx * dx;
      const slope = b[idx] + 2 * c[idx] * dx + 3 * d[idx] * dx * dx;
      return { y: val, segmentIndex: idx, slope };
    }
  };

  return { segments, evaluate };
}

/**
 * Piecewise linear interpolation
 */
export function evaluateLinear(
  points: Array<{ x: number; y: number }>,
  targetX: number
): { y: number; segmentIndex: number; slope: number } {
  const n = points.length;
  if (targetX <= points[0].x) {
    const slope = (points[1].y - points[0].y) / (points[1].x - points[0].x);
    const y = points[0].y + slope * (targetX - points[0].x);
    return { y, segmentIndex: 0, slope };
  }
  if (targetX >= points[n - 1].x) {
    const slope = (points[n - 1].y - points[n - 2].y) / (points[n - 1].x - points[n - 2].x);
    const y = points[n - 1].y + slope * (targetX - points[n - 1].x);
    return { y, segmentIndex: n - 2, slope };
  }

  for (let i = 0; i < n - 1; i++) {
    if (targetX >= points[i].x && targetX <= points[i + 1].x) {
      const slope = (points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x);
      const y = points[i].y + slope * (targetX - points[i].x);
      return { y, segmentIndex: i, slope };
    }
  }

  const slope = (points[n - 1].y - points[n - 2].y) / (points[n - 1].x - points[n - 2].x);
  return { y: points[n - 1].y, segmentIndex: n - 2, slope };
}

/**
 * Executes calculation with full validation and metadata
 */
export function calculateFasMin(
  points: Array<{ x: number; y: number }>,
  method: InterpolationMethod,
  targetX: number,
  precision: number = 3,
  polynomialDegree: number = 2
): CalculationResult {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const xMin = sorted[0].x;
  const xMax = sorted[sorted.length - 1].x;
  const yValues = sorted.map(p => p.y);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);

  const isExtrapolated = targetX < xMin || targetX > xMax;
  const extrapolationType: 'none' | 'left' | 'right' =
    targetX < xMin ? 'left' : targetX > xMax ? 'right' : 'none';

  let calculatedY: number;
  let segIdx: number | undefined;
  let currentSlope: number;
  let segmentFormula = '';
  let polyDegree: number | undefined;
  let polyCoeffs: number[] | undefined;
  let rSquared: number | undefined;
  let rmse: number | undefined;
  let polyFormula: string | undefined;

  if (method === 'cubic-spline') {
    const spline = buildCubicSpline(sorted);
    const res = spline.evaluate(targetX);
    calculatedY = res.y;
    segIdx = res.segmentIndex;
    currentSlope = res.slope;

    const seg = spline.segments[segIdx];
    if (seg) {
      const aStr = seg.a.toFixed(precision);
      const bStr = (seg.b >= 0 ? '+ ' : '- ') + Math.abs(seg.b).toFixed(precision);
      const cStr = (seg.c >= 0 ? '+ ' : '- ') + Math.abs(seg.c).toFixed(precision);
      const dStr = (seg.d >= 0 ? '+ ' : '- ') + Math.abs(seg.d).toFixed(precision);
      segmentFormula = `S_${segIdx}(X) = ${aStr} ${bStr}·(X - ${seg.x0}) ${cStr}·(X - ${seg.x0})² ${dStr}·(X - ${seg.x0})³`;
    }
  } else if (method === 'least-squares') {
    const fit = fitPolynomialLeastSquares(sorted, polynomialDegree, precision);
    const res = fit.evaluate(targetX);
    calculatedY = res.y;
    currentSlope = res.slope;
    segmentFormula = fit.formula;
    polyDegree = fit.degree;
    polyCoeffs = fit.coefficientsDescending;
    rSquared = fit.rSquared;
    rmse = fit.rmse;
    polyFormula = fit.formula;
  } else {
    const res = evaluateLinear(sorted, targetX);
    calculatedY = res.y;
    segIdx = res.segmentIndex;
    currentSlope = res.slope;

    const p0 = sorted[segIdx];
    const slopeStr = (currentSlope >= 0 ? '+ ' : '- ') + Math.abs(currentSlope).toFixed(precision);
    segmentFormula = `Y = ${p0.y.toFixed(precision)} ${slopeStr}·(X - ${p0.x})`;
  }

  return {
    targetX,
    targetY: Number(calculatedY.toFixed(precision)),
    method,
    isExtrapolated,
    extrapolationType,
    segmentIndex: segIdx,
    segmentFormula,
    slope: currentSlope,
    status: isExtrapolated ? 'warning' : 'success',
    xMin,
    xMax,
    yMin,
    yMax,
    polynomialDegree: polyDegree,
    polynomialCoefficients: polyCoeffs,
    rSquared,
    rmse,
    polynomialFormula: polyFormula,
  };
}

/**
 * Generates curve points for plotting
 */
export function generatePlotCurve(
  points: Array<{ x: number; y: number }>,
  method: InterpolationMethod,
  sampleCount: number = 300,
  targetX?: number,
  polynomialDegree: number = 2
): Array<{ x: number; y: number }> {
  if (points.length < 2) return [];

  const sorted = [...points].sort((a, b) => a.x - b.x);
  let minX = sorted[0].x;
  let maxX = sorted[sorted.length - 1].x;

  // If targetX is extrapolated, extend curve to cover targetX with 10% margin
  if (targetX !== undefined && isFinite(targetX)) {
    if (targetX < minX) {
      const span = maxX - minX;
      minX = targetX - Math.max(span * 0.1, 1);
    } else if (targetX > maxX) {
      const span = maxX - minX;
      maxX = targetX + Math.max(span * 0.1, 1);
    }
  }

  const dx = (maxX - minX) / (sampleCount - 1);
  const result: Array<{ x: number; y: number }> = [];

  if (method === 'cubic-spline' && sorted.length >= 3) {
    const spline = buildCubicSpline(sorted);
    for (let i = 0; i < sampleCount; i++) {
      const currX = minX + i * dx;
      const res = spline.evaluate(currX);
      result.push({ x: currX, y: res.y });
    }
  } else if (method === 'least-squares' && sorted.length >= 2) {
    const fit = fitPolynomialLeastSquares(sorted, polynomialDegree);
    for (let i = 0; i < sampleCount; i++) {
      const currX = minX + i * dx;
      const res = fit.evaluate(currX);
      result.push({ x: currX, y: res.y });
    }
  } else {
    for (let i = 0; i < sampleCount; i++) {
      const currX = minX + i * dx;
      const res = evaluateLinear(sorted, currX);
      result.push({ x: currX, y: res.y });
    }
  }

  return result;
}
