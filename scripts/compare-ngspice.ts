import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { solveCircuitTransient } from '../src/math/circuitSolver';
import type { CircuitElement, CircuitWire, TransientSettings } from '../src/types';

// Matched Level-1 MOS models: W/L=1, KP=1 mA/V², |VTO|=2 V, LAMBDA=0.
// No body bias, parasitic capacitances or junction conduction in these cases.
const directory = path.resolve('.work/ngspice-reference');
mkdirSync(directory, { recursive: true });
const executable = process.env.NAPS_NGSPICE_PATH || 'ngspice';
const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
const available = !probe.error && probe.status === 0;
const reports: object[] = [];
let failed = false;
for (const type of ['NMOS', 'PMOS'] as const) for (const [region, vd, vg] of [['cutoff', 5, 1], ['linear', 0.5, 3], ['saturation', 5, 3]] as const) {
  const sign = type === 'PMOS' ? -1 : 1;
  const make = (name: string, kind: CircuitElement['type'], value = 0): CircuitElement => ({ id: name, name, type: kind, value, valueStr: String(value), unit: '', x: 0, y: 0, rotation: 0 });
  const elements = [make('VD', 'V_DC', sign * vd), make('VG', 'V_DC', sign * vg), { ...make('M1', type), modelParams: { thresholdVoltage: 2, transconductance: 0.001, channelLengthModulation: 0 } }, make('G', 'GND')];
  const connections = [['VD', '1', 'M1', '1'], ['VG', '1', 'M1', 'gate'], ['M1', '2', 'G', '1'], ['VD', '2', 'G', '1'], ['VG', '2', 'G', '1']];
  const wires: CircuitWire[] = connections.map(([fromCompId, fromPinId, toCompId, toPinId], i) => ({ id: String(i), fromCompId, fromPinId, toCompId, toPinId }));
  const settings: TransientSettings = { tMax: 0.001, step: 0.001, tMaxStr: '1m', stepStr: '1m', eps: 0.001, signals: [{ id: 'id', exprX: 't', exprY: 'I(M1)', plotIndex: 1, color: '#000', enabled: true }] };
  const naps = solveCircuitTransient(elements, wires, settings).signals['I(M1)'][0];
  const overdrive = Math.max(0, vg - 2);
  const analytical = sign * (vd < overdrive ? 0.001 * (overdrive * vd - vd * vd / 2) : 0.0005 * overdrive ** 2);
  if (Math.abs(naps - analytical) > 1e-10) throw new Error(`${type}/${region}: NAPS disagrees with the analytical current`);
  const file = `${type.toLowerCase()}-${region}.cir`;
  writeFileSync(path.join(directory, file), `NAPS matched ${type} ${region}\nVD d 0 ${sign * vd}\nVG g 0 ${sign * vg}\nM1 d g 0 0 model1 W=1u L=1u\n.model model1 ${type} (LEVEL=1 VTO=${sign * 2} KP=0.001 LAMBDA=0)\n.control\nop\nprint i(vd)\nquit\n.endc\n.end\n`);
  if (!available) { reports.push({ type, region, naps, analytical, status: 'NGSPICE_NOT_AVAILABLE' }); continue; }
  const run = spawnSync(executable, ['-b', file], { cwd: directory, encoding: 'utf8', timeout: 30000, windowsHide: true });
  const log = `${run.stdout || ''}\n${run.stderr || ''}`;
  writeFileSync(path.join(directory, `${file}.log`), log);
  const match = log.match(/i\(vd\)\s*=\s*([-+\d.eE]+)/i);
  const spice = match ? -Number(match[1]) : NaN;
  const absolute = Math.abs(naps - spice);
  const pass = !run.error && run.status === 0 && Number.isFinite(spice) && absolute <= 1e-9 + 1e-4 * Math.abs(spice);
  failed ||= !pass;
  reports.push({ type, region, naps, analytical, ngspice: Number.isFinite(spice) ? spice : null, absolute: Number.isFinite(absolute) ? absolute : null, status: pass ? 'PASS' : 'FAIL' });
}
writeFileSync(path.join(directory, 'results.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
if (!available) { console.error('ngspice не найден. Контрольные netlist подготовлены; внешнее сравнение НЕ выполнено. Укажите NAPS_NGSPICE_PATH.'); process.exitCode = 2; }
else if (failed) process.exitCode = 1;
