/**
 * Polynomial Least Squares Approximation (МНК - Метод наименьших квадратов)
 * Replicates NumPy np.polyfit(x, y, deg) and np.polyval behavior.
 */

export interface PolynomialFitResult {
  degree: number;
  /**
   * Coefficients in descending order matching NumPy np.polyfit:
   * [c_d, c_{d-1}, ..., c_1, c_0] such that
   * P(x) = c_d * x^d + c_{d-1} * x^{d-1} + ... + c_1 * x + c_0
   */
  coefficientsDescending: number[];
  /**
   * Coefficients in ascending order:
   * [a_0, a_1, ..., a_d] such that P(x) = sum(a_k * x^k)
   */
  coefficientsAscending: number[];
  rSquared: number;
  rmse: number;
  formula: string;
  evaluate: (x: number) => { y: number; slope: number };
}

/**
 * Solves a linear system M * c = B using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Deep copy matrix and vector
  const M = A.map(row => [...row]);
  const rhs = [...b];

  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    let maxVal = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxVal) {
        maxVal = Math.abs(M[k][i]);
        maxRow = k;
      }
    }

    // Swap rows if necessary
    if (maxRow !== i) {
      const tempRow = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tempRow;

      const tempVal = rhs[i];
      rhs[i] = rhs[maxRow];
      rhs[maxRow] = tempVal;
    }

    if (Math.abs(M[i][i]) < 1e-18) {
      // Degenerate or singular matrix
      continue;
    }

    // Elimination
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      M[k][i] = 0;
      for (let j = i + 1; j < n; j++) {
        M[k][j] -= factor * M[i][j];
      }
      rhs[k] -= factor * rhs[i];
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = Math.abs(M[i][i]) > 1e-18 ? sum / M[i][i] : 0;
  }

  return x;
}

/**
 * Binomial coefficient C(n, k) = n! / (k! * (n-k)!)
 */
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  for (let i = 1; i <= k; i++) {
    c = (c * (n - (k - i))) / i;
  }
  return c;
}

/**
 * Fits a polynomial of degree `degree` using Least Squares (NumPy polyfit equivalent).
 * Uses centering and scaling (u = (x - mean)/std) internally for high numerical condition stability,
 * then maps back to original variable x.
 */
export function fitPolynomialLeastSquares(
  points: Array<{ x: number; y: number }>,
  requestedDegree: number = 2,
  precision: number = 4
): PolynomialFitResult {
  const n = points.length;
  // Maximum possible degree is n - 1
  const degree = Math.max(1, Math.min(requestedDegree, n - 1));
  const m = degree + 1; // number of coefficients

  const x = points.map(p => p.x);
  const y = points.map(p => p.y);

  // Mean and standard deviation for normalization
  const meanX = x.reduce((acc, v) => acc + v, 0) / n;
  let varX = x.reduce((acc, v) => acc + Math.pow(v - meanX, 2), 0) / n;
  const stdX = varX > 1e-12 ? Math.sqrt(varX) : 1;

  // Normalized coordinates u_i = (x_i - meanX) / stdX
  const u = x.map(v => (v - meanX) / stdX);

  // Build normal equations in u: (V^T * V) * alpha = V^T * y
  // where V_ij = u_i^j, j = 0..degree
  const M: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const B: number[] = new Array(m).fill(0);

  // Precompute power sums of u
  const uPowerSums: number[] = new Array(2 * degree + 1).fill(0);
  for (let p = 0; p <= 2 * degree; p++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += Math.pow(u[i], p);
    }
    uPowerSums[p] = sum;
  }

  for (let j = 0; j < m; j++) {
    for (let k = 0; k < m; k++) {
      M[j][k] = uPowerSums[j + k];
    }
    let sumYu = 0;
    for (let i = 0; i < n; i++) {
      sumYu += y[i] * Math.pow(u[i], j);
    }
    B[j] = sumYu;
  }

  // Solve for alpha (ascending coefficients in u: Q(u) = sum_{k=0}^d alpha_k * u^k)
  const alpha = solveLinearSystem(M, B);

  // Convert alpha (in u) to a (in x):
  // u = (x - meanX) / stdX
  // u^k = sum_{j=0}^k C(k, j) * x^j * (-meanX)^(k-j) / (stdX^k)
  // P(x) = sum_{j=0}^d a_j * x^j
  const aAscending: number[] = new Array(m).fill(0);
  for (let k = 0; k < m; k++) {
    const alphaK = alpha[k];
    const denom = Math.pow(stdX, k);
    for (let j = 0; j <= k; j++) {
      const term = alphaK * binomial(k, j) * Math.pow(-meanX, k - j) / denom;
      aAscending[j] += term;
    }
  }

  // Descending coefficients matching NumPy np.polyfit: [c_d, c_{d-1}, ..., c_0]
  const coefficientsDescending = [...aAscending].reverse();

  // Evaluate function
  const evaluate = (targetX: number) => {
    let yVal = 0;
    let slope = 0;

    // Horner's scheme or direct powers
    for (let j = 0; j < m; j++) {
      const pwr = Math.pow(targetX, j);
      yVal += aAscending[j] * pwr;
      if (j >= 1) {
        slope += j * aAscending[j] * Math.pow(targetX, j - 1);
      }
    }

    return { y: yVal, slope };
  };

  // Goodness of fit (R^2, RMSE)
  let ssRes = 0;
  let ssTot = 0;
  const meanY = y.reduce((acc, v) => acc + v, 0) / n;

  for (let i = 0; i < n; i++) {
    const yPred = evaluate(x[i]).y;
    ssRes += Math.pow(y[i] - yPred, 2);
    ssTot += Math.pow(y[i] - meanY, 2);
  }

  const rSquared = ssTot > 1e-12 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 1;
  const rmse = Math.sqrt(ssRes / n);

  // Format mathematical formula string: P(X) = c_d*X^d + ... + c_0
  const terms: string[] = [];
  for (let i = 0; i < coefficientsDescending.length; i++) {
    const coeff = coefficientsDescending[i];
    const power = degree - i;

    // Skip practically zero coefficients unless it's the constant term and the only term
    if (Math.abs(coeff) < 1e-14 && terms.length > 0) continue;

    const absCoeff = Math.abs(coeff);
    const sign = i === 0 ? (coeff < 0 ? '-' : '') : (coeff < 0 ? ' - ' : ' + ');

    // Choose formatting based on magnitude
    let coeffStr: string;
    if (absCoeff >= 1e4 || (absCoeff > 0 && absCoeff < 1e-3)) {
      coeffStr = absCoeff.toExponential(3);
    } else {
      coeffStr = absCoeff.toFixed(precision);
    }

    if (power === 0) {
      terms.push(`${sign}${coeffStr}`);
    } else if (power === 1) {
      terms.push(`${sign}${coeffStr}·X`);
    } else {
      terms.push(`${sign}${coeffStr}·X^${power}`);
    }
  }

  const formula = terms.length > 0 ? `P_${degree}(X) = ${terms.join('')}` : `P_${degree}(X) = 0`;

  return {
    degree,
    coefficientsDescending,
    coefficientsAscending: aAscending,
    rSquared,
    rmse,
    formula,
    evaluate,
  };
}
