import React, { useMemo, useState } from 'react';
import type { CircuitElement, CircuitWire, CircuitSimulationResults, TransientSettings } from '../types';
import { buildCalculationReport, calculationReportHtml, numberText as n } from '../math/calculationReport';

interface Props { elements: CircuitElement[]; wires: CircuitWire[]; results: CircuitSimulationResults; settings: TransientSettings; }
export function CalculationDetails({ elements, wires, results, settings }: Props) {
  const [index, setIndex] = useState(Math.min(1, results.time.length - 1));
  const [saveError, setSaveError] = useState('');
  const report = useMemo(() => buildCalculationReport(elements, wires, settings, results, index), [elements, wires, settings, results, index]);
  const changeIndex = (value: number) => setIndex(Math.max(0, Math.min(results.time.length - 1, Math.trunc(Number.isFinite(value) ? value : 0))));
  const download = () => {
    try {
      const blob = new Blob([calculationReportHtml(report, results)], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'NAPS-Математический-расчёт.html'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setSaveError('');
    } catch { setSaveError('Не удалось сохранить отчёт.'); }
  };
  return <section className="calculation-details" aria-label="Математический расчёт">
    <header className="calculation-controls">
      <div><h2>Математический расчёт</h2><p>Формулы и подстановка для любой точки графика</p></div>
      <button type="button" onClick={download}>Скачать расчёт HTML</button>
      <div className="calculation-point">
        <label>Точка k <input aria-label="Номер точки расчёта" type="number" min={0} max={results.time.length - 1} value={index} onChange={e => changeIndex(e.target.valueAsNumber)} /></label>
        <input aria-label="Выбрать точку графика" type="range" min={0} max={results.time.length - 1} step={1} value={index} onChange={e => changeIndex(Number(e.target.value))} />
        <strong>t = {n(results.time[index])} с</strong>
      </div>
      {saveError && <p role="alert">{saveError}</p>}
    </header>
    <div className="calculation-content">
      <h3>{report.title}</h3>
      {report.notes.map((note, i) => <p key={i}>{note}</p>)}
      <details><summary>Исходные данные и номиналы ({elements.length} элементов)</summary><div className="calculation-table"><table><thead><tr><th>Параметр</th><th>Значение</th></tr></thead><tbody>{report.parameters.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.value}</td></tr>)}</tbody></table></div></details>
      <h3>Уравнения и числовая подстановка</h3>
      <div className="calculation-table"><table><thead><tr><th>Величина</th><th>Формула</th><th>Подстановка в СИ</th><th>Результат</th></tr></thead><tbody>{report.steps.map((step, i) => <tr key={i}><th scope="row">{step.name}</th><td>{step.formula}</td><td className="math-number">{step.substitution}</td><td className="math-number">{n(step.value)} {step.unit}</td></tr>)}</tbody></table></div>
      <h3>Связь расчёта с сигналами графика</h3>
      <div className="calculation-table"><table><thead><tr><th>Сигнал</th><th>Выражение</th><th>y[k−1]</th><th>y[k]</th><th>y[k+1]</th></tr></thead><tbody>{report.signals.map(s => <tr key={s.name}><th scope="row">{s.name}, {s.unit}</th><td>{s.formula}</td><td className="math-number">{index ? n(results.signals[s.name][index - 1]) : '—'}</td><td className="math-number">{n(s.value)}</td><td className="math-number">{n(results.signals[s.name][index + 1])}</td></tr>)}</tbody></table></div>
      <h3>Среднее, действующее значение и экстремумы</h3>
      <p className="math-number">{report.statisticsFormula}</p>
      <div className="calculation-table"><table><thead><tr><th>Сигнал</th><th>Среднее</th><th>RMS</th><th>min</th><th>max</th></tr></thead><tbody>{report.statistics.map(s => <tr key={s.name}><th scope="row">{s.name}, {s.unit}</th><td>{n(s.mean)}</td><td>{n(s.rms)}</td><td>{n(s.min)}</td><td>{n(s.max)}</td></tr>)}</tbody></table></div>
      <p>HTML-файл содержит этот разбор и все точки графиков с полной числовой точностью. Его можно открыть в браузере и распечатать или сохранить в PDF.</p>
    </div>
  </section>;
}
