import type { CircuitElement } from '../types';

export const transistorTypes = new Set(['NPN', 'PNP', 'NMOS', 'PMOS']);
export type TransistorPin = '1' | '2' | 'gate';
export interface TransistorLinearization {
  /** Currents leaving collector/drain, emitter/source, and base/gate, in A. */
  currents: [number, number, number];
  /** Jacobian dI(row)/dV(column), ordered 1, 2, gate. */
  jacobian: number[][];
}

export function validateTransistor(e: CircuitElement): void {
  if (!transistorTypes.has(e.type)) return;
  const p = e.modelParams;
  const values = e.type === 'NPN' || e.type === 'PNP'
    ? [p?.saturationCurrent ?? 1e-15, p?.betaForward ?? 100, p?.betaReverse ?? 1, p?.thermalVoltage ?? 0.02585]
    : [p?.thresholdVoltage ?? 2, p?.transconductance ?? 0.001, p?.channelLengthModulation ?? 0.02];
  if (values.some(v => !Number.isFinite(v)) || values.some((v, i) => v <= 0 && !(i === 2 && (e.type === 'NMOS' || e.type === 'PMOS') && v === 0))) {
    throw new Error(`${e.name}: неверные параметры транзистора.`);
  }
  if (e.transistorModel === 'small-signal') {
    const bias = [p?.biasControlVoltage ?? (e.type === 'NPN' || e.type === 'PNP' ? 0.7 : 3), p?.biasOutputVoltage ?? 5];
    if (bias.some(v => !Number.isFinite(v))) throw new Error(`${e.name}: неверная точка линеаризации.`);
    if ((e.type === 'NMOS' || e.type === 'PMOS') && bias[0] <= (p?.thresholdVoltage ?? 2)) throw new Error(`${e.name}: малосигнальная модель MOS требует Vgs выше порога.`);
  }
}

/** Ebers-Moll BJT and Level-1 long-channel MOS DC I-V laws, without parasitic capacitances. */
export function transistorAt(e: CircuitElement, voltage: [number, number, number]): TransistorLinearization {
  const [v1, v2, vg] = voltage;
  const p = e.modelParams;
  const sign = e.type === 'PNP' || e.type === 'PMOS' ? -1 : 1;
  if (e.type === 'NPN' || e.type === 'PNP') {
    const is = p?.saturationCurrent ?? 1e-15, beta = p?.betaForward ?? 100, betaR = p?.betaReverse ?? 1, vt = p?.thermalVoltage ?? 0.02585;
    const aF = beta / (beta + 1), aR = betaR / (betaR + 1);
    const diode = (v: number) => {
      // Smooth exponential in the normal region; linear continuation prevents overflow during Newton steps.
      const x = v / vt, cap = 32;
      const exp = Math.exp(Math.min(x, cap));
      return x <= cap ? { i: is * Math.expm1(x), g: is * exp / vt } : { i: is * (exp * (1 + x - cap) - 1), g: is * exp / vt };
    };
    const forward = diode(sign * (vg - v2)), reverse = diode(sign * (vg - v1));
    const gf = forward.g, gr = reverse.g;
    return {
      currents: [sign * (aF * forward.i - reverse.i), sign * (-forward.i + aR * reverse.i), sign * ((1 - aF) * forward.i + (1 - aR) * reverse.i)],
      jacobian: [
        [gr, -aF * gf, aF * gf - gr],
        [-aR * gr, gf, -gf + aR * gr],
        [-(1 - aR) * gr, -(1 - aF) * gf, (1 - aF) * gf + (1 - aR) * gr],
      ],
    };
  }
  const threshold = p?.thresholdVoltage ?? 2, k = p?.transconductance ?? 0.001, lambda = p?.channelLengthModulation ?? 0.02;
  const u12 = sign * (v1 - v2);
  const drain = u12 >= 0 ? 0 : 1, source = u12 >= 0 ? 1 : 0;
  const voltages = [v1, v2];
  const vds = sign * (voltages[drain] - voltages[source]);
  const overdrive = sign * (vg - voltages[source]) - threshold;
  let id = 0, gm = 0, gd = 0;
  if (overdrive > 0) {
    const modulation = 1 + lambda * vds;
    if (vds < overdrive) {
      const core = k * (overdrive * vds - 0.5 * vds * vds);
      id = core * modulation;
      gm = k * vds * modulation;
      gd = k * (overdrive - vds) * modulation + core * lambda;
    } else {
      id = 0.5 * k * overdrive * overdrive * modulation;
      gm = k * overdrive * modulation;
      gd = 0.5 * k * overdrive * overdrive * lambda;
    }
  }
  const currents: [number, number, number] = [0, 0, 0];
  const jacobian = Array.from({ length: 3 }, () => [0, 0, 0]);
  currents[drain] = sign * id; currents[source] = -sign * id;
  jacobian[drain][drain] = gd; jacobian[drain][source] = -gd - gm; jacobian[drain][2] = gm;
  jacobian[source] = jacobian[drain].map(value => -value);
  return { currents, jacobian };
}

export function transistorBias(e: CircuitElement): [number, number, number] {
  const sign = e.type === 'PNP' || e.type === 'PMOS' ? -1 : 1;
  return [sign * (e.modelParams?.biasOutputVoltage ?? 5), 0, sign * (e.modelParams?.biasControlVoltage ?? (e.type === 'NPN' || e.type === 'PNP' ? 0.7 : 3))];
}

export function transistorCurrent(e: CircuitElement, voltages: [number, number, number]): TransistorLinearization {
  if (e.transistorModel !== 'small-signal') return transistorAt(e, voltages);
  const bias = transistorBias(e), base = transistorAt(e, bias);
  return {
    jacobian: base.jacobian,
    currents: base.currents.map((current, row) => current + base.jacobian[row].reduce((sum, derivative, col) => sum + derivative * (voltages[col] - bias[col]), 0)) as [number, number, number],
  };
}

/** Newton stamp: I(V) ≈ I(V0)+J(V−V0), all currents leave their respective terminals. */
export function stampTransistor(e: CircuitElement, voltages: [number, number, number], nodes: Array<number | undefined>, add: (row: number | undefined, column: number | undefined, value: number) => void, rhs: number[]): void {
  const model = transistorCurrent(e, voltages);
  for (let row = 0; row < 3; row++) {
    const index = nodes[row];
    if (index === undefined) continue;
    let offset = model.currents[row];
    for (let col = 0; col < 3; col++) {
      add(index, nodes[col], model.jacobian[row][col]);
      offset -= model.jacobian[row][col] * voltages[col];
    }
    rhs[index] -= offset;
  }
}
