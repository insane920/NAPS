import assert from 'node:assert/strict';
import { solveCircuitAC, solveCircuitTransient } from '../src/math/circuitSolver';
import type { ACSettings, CircuitElement, CircuitWire, ComponentType, TransientSettings } from '../src/types';

const element = (name: string, type: ComponentType, value = 0, extra: Partial<CircuitElement> = {}): CircuitElement => ({
  id: name, name, type, value, valueStr: String(value), unit: '', x: 0, y: 0, rotation: 0, ...extra,
});
let serial = 0;
const wire = (a: string, ap: string, b: string, bp: string): CircuitWire => ({
  id: `audit-${++serial}`, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp,
});
const transient = (signals: string[]): TransientSettings => ({
  tMax: 0.01, tMaxStr: '10m', step: 0.001, stepStr: '1m', eps: 0.001,
  signals: signals.map((exprY, id) => ({ id: String(id), plotIndex: 1, exprX: 't', exprY, color: '#2563eb', enabled: true })),
});
const observations: Array<{ case: string; expected: number; actual: number; absolute: number; relative: number; unit: string }> = [];
function check(label: string, actual: number, expected: number, unit: string, tolerance = 1e-8) {
  const absolute = Math.abs(actual - expected);
  const relative = expected === 0 ? absolute : absolute / Math.abs(expected);
  observations.push({ case: label, expected, actual, absolute, relative, unit });
  assert.ok(absolute <= tolerance * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);
}

// Independent textbook references: 12 V across 1 kΩ + 2 kΩ gives 4 mA and 8 V on R2.
const divider = [element('V1', 'V_DC', 12), element('R1', 'R', 1000), element('R2', 'R', 2000), element('G', 'GND')];
const dividerWires = [wire('V1', '1', 'R1', '1'), wire('R1', '2', 'R2', '1'), wire('R2', '2', 'G', '1'), wire('V1', '2', 'G', '1')];
const div = solveCircuitTransient(divider, dividerWires, transient(['U(R2)', 'I(R1)', 'P(R1)', 'P(R2)', 'P(V1)']));
check('DC divider U(R2)', div.signals['U(R2)'][0], 8, 'V');
check('DC divider I(R1)', div.signals['I(R1)'][0], 0.004, 'A');
check('DC divider P(R1)', div.signals['P(R1)'][0], 0.016, 'W');
check('DC divider P(R2)', div.signals['P(R2)'][0], 0.032, 'W');
check('DC divider P(V1)', div.signals['P(V1)'][0], -0.048, 'W');
check('DC divider energy balance', div.signals['P(R1)'][0] + div.signals['P(R2)'][0] + div.signals['P(V1)'][0], 0, 'W');

// Two ideal voltage sources and one resistor: (10 - 4) V / 3 kΩ = 2 mA.
const opposed = [element('VA', 'V_DC', 10), element('VB', 'V_DC', 4), element('R', 'R', 3000), element('G', 'GND')];
const opposedWires = [wire('VA', '1', 'R', '1'), wire('R', '2', 'VB', '1'), wire('VA', '2', 'G', '1'), wire('VB', '2', 'G', '1')];
const sources = solveCircuitTransient(opposed, opposedWires, transient(['I(R)', 'I(VA)', 'I(VB)', 'P(R)', 'P(VA)', 'P(VB)']));
check('Two-source resistor current', sources.signals['I(R)'][0], 0.002, 'A');
check('Two-source KCL at 10 V node', sources.signals['I(R)'][0] + sources.signals['I(VA)'][0], 0, 'A');
check('Two-source energy balance', sources.signals['P(R)'][0] + sources.signals['P(VA)'][0] + sources.signals['P(VB)'][0], 0, 'W');

// 2 mA leaving a node through a current source drives a 1 kΩ parallel resistor to -2 V.
const current = [element('I1', 'I_DC', 0.002), element('R', 'R', 1000), element('G', 'GND')];
const currentWires = [wire('I1', '1', 'R', '1'), wire('I1', '2', 'G', '1'), wire('R', '2', 'G', '1')];
const currentResult = solveCircuitTransient(current, currentWires, transient(['U(R)', 'I(R)', 'P(I1)', 'P(R)']));
check('Current-source node voltage', currentResult.signals['U(R)'][0], -2, 'V');
check('Current-source KCL', currentResult.signals['I(R)'][0] + 0.002, 0, 'A');
check('Current-source energy balance', currentResult.signals['P(I1)'][0] + currentResult.signals['P(R)'][0], 0, 'W');

// Piecewise-linear diode: I = (V - Vf)/(R + Ron); ideal diode has Vf = Ron = 0.
const diode = [element('V1', 'V_DC', 5), element('D1', 'DIODE', 0.7, { modelParams: { forwardVoltage: 0.7, onResistance: 0.1, offResistance: 1e9 } }), element('R', 'R', 100), element('G', 'GND')];
const diodeWires = [wire('V1', '1', 'D1', '1'), wire('D1', '2', 'R', '1'), wire('R', '2', 'G', '1'), wire('V1', '2', 'G', '1')];
const pwl = solveCircuitTransient(diode, diodeWires, transient(['I(D1)', 'U(R)']));
check('PWL diode forward current', pwl.signals['I(D1)'][0], 4.3 / 100.1, 'A');
check('PWL diode load voltage', pwl.signals['U(R)'][0], 100 * 4.3 / 100.1, 'V');
const ideal = solveCircuitTransient(diode.map(e => e.id === 'D1' ? { ...e, diodeModel: 'ideal' as const } : e), diodeWires, transient(['I(D1)']));
check('Ideal diode forward current', ideal.signals['I(D1)'][0], 0.05, 'A');
const reverse = solveCircuitTransient(diode.map(e => e.id === 'D1' ? { ...e, diodeModel: 'ideal' as const } : e), [wire('V1', '1', 'D1', '2'), wire('D1', '1', 'R', '1'), ...diodeWires.slice(2)], transient(['I(D1)']));
check('Ideal diode reverse current', reverse.signals['I(D1)'][0], 0, 'A');

// Level-1 long-channel NMOS in saturation with λ=0: Id = k(Vgs-Vth)²/2.
const mos = [element('VD', 'V_DC', 5), element('VG', 'V_DC', 3), element('M1', 'NMOS', 0, { modelParams: { thresholdVoltage: 2, transconductance: 0.001, channelLengthModulation: 0 } }), element('G', 'GND')];
const mosWires = [wire('VD', '1', 'M1', '1'), wire('VG', '1', 'M1', 'gate'), wire('M1', '2', 'G', '1'), wire('VD', '2', 'G', '1'), wire('VG', '2', 'G', '1')];
const mosResult = solveCircuitTransient(mos, mosWires, transient(['I(M1)', 'P(M1)']));
check('NMOS saturation drain current', mosResult.signals['I(M1)'][0], 0.0005, 'A');
check('NMOS terminal power', mosResult.signals['P(M1)'][0], 0.0025, 'W');

// AC low-pass transfer at f=1/(2πRC) is 1/√2 at -45°, from complex impedance.
const fCorner = 1 / (2 * Math.PI * 1000 * 1e-6);
const rc = [element('VAC', 'V_AC', 1, { secondaryValue: fCorner }), element('R', 'R', 1000), element('C', 'C', 1e-6), element('G', 'GND'), element('OUT', 'PORT', 0, { portName: 'OUT' })];
const rcWires = [wire('VAC', '1', 'R', '1'), wire('R', '2', 'C', '1'), wire('R', '2', 'OUT', '1'), wire('C', '2', 'G', '1'), wire('VAC', '2', 'G', '1')];
const ac: ACSettings = { fMin: fCorner, fMax: fCorner * 10, fMinStr: String(fCorner), fMaxStr: String(fCorner * 10), points: 2, scaleType: 'log',
  signals: [
    { id: 'mag', plotIndex: 1, exprX: 'f', exprY: 'mag(U(OUT)/U(VAC))', color: '#2563eb', enabled: true },
    { id: 'phase', plotIndex: 1, exprX: 'f', exprY: 'phs(U(OUT)/U(VAC))', color: '#dc2626', enabled: true },
  ] };
const bode = solveCircuitAC(rc, rcWires, ac);
check('RC corner transfer magnitude', bode.signals['mag(U(OUT)/U(VAC))'][0], 1 / Math.sqrt(2), 'ratio');
check('RC corner transfer phase', bode.signals['phs(U(OUT)/U(VAC))'][0], -45, 'deg');

console.log(JSON.stringify(observations, null, 2));
console.log(`PASS: ${observations.length} independent reference observations, Kirchhoff and power balance.`);
