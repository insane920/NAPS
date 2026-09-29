import React, { useState } from 'react';
import type { CircuitElement, CircuitSimulationResults } from '../types';

interface Props { elements: CircuitElement[]; results: CircuitSimulationResults }
const num = (value: number) => Number(value.toPrecision(8)).toString();
const complex = (value?: { re: number; im: number }) => value ? `${num(value.re)} ${value.im < 0 ? '−' : '+'} j${num(Math.abs(value.im))}` : '—';

export function ACCalculationDetails({ elements, results }: Props) {
  const [index, setIndex] = useState(0);
  const f = results.frequency?.[index] ?? 0;
  const omega = 2 * Math.PI * f;
  const model = (e: CircuitElement) => {
    if (e.type === 'R') return `Y = 1/R = ${num(1 / e.value)} См`;
    if (e.type === 'C') return `Y = jωC = j${num(omega * e.value)} См`;
    if (e.type === 'L') return `Y = 1/(jωL) = −j${num(1 / (omega * e.value))} См`;
    if (e.type === 'TR3') {
      const ratio = e.modelParams?.turnsRatio ?? e.secondaryValue ?? 1;
      const k = e.modelParams?.couplingFactor ?? 0.999;
      return `L1=${num(e.value)} Гн; L2=L1·(N2/N1)²=${num(e.value * ratio * ratio)} Гн; M=k√(L1L2)=${num(k * e.value * ratio)} Гн`;
    }
    if (e.type === 'DIODE' || e.type === 'SWITCH' || e.type === 'THYRISTOR') return 'Малосигнальная проводимость 1/Ron или 1/Roff определяется DC-рабочей точкой.';
    if (e.type === 'OPAMP') return 'Выходное AC-напряжение равно K·(V+−V−), если рабочая точка не насыщена.';
    if (e.type === 'V_AC') return `AC-фазор источника: ${num(e.value)} + j0 В (амплитуда, косинусная опора)`;
    if (e.type === 'V_DC' || e.type === 'V_PULSE') return 'Малосигнальное AC-напряжение источника равно 0.';
    return 'Узловой расчёт по электрическим соединениям.';
  };
  const nodes = Object.entries(results.complexNodeVoltages ?? {}).filter(([name]) => /^node_/.test(name));
  const currents = Object.entries(results.complexBranchCurrents ?? {});
  return <section className="calculation-details" aria-label="Математический расчёт АЧХ и ФЧХ">
    <header className="calculation-controls"><div><h2>Частотный расчёт</h2><p>Комплексная матрица узлового анализа и значения выбранной точки</p></div>
      <div className="calculation-point"><label>Точка k <input aria-label="Номер точки частотного анализа" type="number" min={0} max={results.time.length - 1} value={index} onChange={e => setIndex(Math.max(0, Math.min(results.time.length - 1, e.target.valueAsNumber || 0)))} /></label>
        <input aria-label="Выбрать частоту" type="range" min={0} max={results.time.length - 1} value={index} onChange={e => setIndex(Number(e.target.value))} /><strong>f = {num(f)} Гц; ω = {num(omega)} рад/с</strong></div>
    </header>
    <div className="calculation-content"><p>Решается комплексная система MNA: A(jω)·x=b. Напряжения и токи ниже взяты непосредственно из решённого фазора. Для отношения H=Uвыход/Uвход: АЧХ = 20log₁₀|H| дБ, ФЧХ = arg(H)·180/π градусов.</p>
      <h3>Уравнения компонентов</h3><div className="calculation-table"><table><thead><tr><th>Компонент</th><th>Модель при выбранной частоте</th><th>Комплексный ток, А</th></tr></thead><tbody>{elements.filter(e => !['GND', 'PORT', 'JUNCTION', 'TEXT'].includes(e.type) && !e.isolation).flatMap(e => [
        <tr key={e.id}><th scope="row">{e.name}</th><td>{model(e)}</td><td className="math-number">{complex(results.complexBranchCurrents?.[e.name]?.[index])}</td></tr>,
        ...(e.type === 'TR3' ? [<tr key={`${e.id}:secondary`}><th scope="row">{e.name}:secondary</th><td>Ток обмотки 3 → 4</td><td className="math-number">{complex(results.complexBranchCurrents?.[`${e.name}:secondary`]?.[index])}</td></tr>] : []),
      ])}</tbody></table></div>
      <h3>Комплексные потенциалы</h3><div className="calculation-table"><table><thead><tr><th>Узел</th><th>Re + jIm, В</th><th>Модуль, В</th><th>Фаза, °</th></tr></thead><tbody>{nodes.map(([name, series]) => { const v = series[index]; return <tr key={name}><th scope="row">{name}</th><td className="math-number">{complex(v)}</td><td>{num(Math.hypot(v.re, v.im))}</td><td>{num(Math.atan2(v.im, v.re) * 180 / Math.PI)}</td></tr>; })}</tbody></table></div>
      <h3>Значения графиков</h3><div className="calculation-table"><table><thead><tr><th>Выражение</th><th>Результат</th></tr></thead><tbody>{Object.entries(results.signals).map(([name, series]) => <tr key={name}><th scope="row">{name}</th><td className="math-number">{num(series[index])} {results.summary.stats[name]?.unit}</td></tr>)}</tbody></table></div>
    </div>
  </section>;
}
