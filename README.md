# NAPS

**NAPS — Numerical, Analytical, PWL, Simulation.** Desktop CAD for editing electrical schematics, numerical and analytical simulation, piecewise-linear models, and explainable calculation output.

> The application is not an AI product and does not require an API key, cloud service, or backend to run.

## Highlights

- Interactive electrical-schematic editor with component palette, explicit wiring mode, 45-degree manual wire segments, rotation, selection, undo/redo, and example circuits.
- In Wiring mode, click a terminal, then click the canvas to set horizontal, vertical, or 45-degree waypoints before connecting to another terminal or an existing wire. Connecting to a wire inserts a visible junction; merely crossing a wire does not connect it.
- In Select mode, drag a wire segment to reshape its route without changing its electrical endpoints. A selected two-terminal component can be excluded from simulation as an open circuit or replaced by an ideal short; this state is saved in SCM.
- Import and export of the human-readable `.scm` format.
- Transient analysis by the actual wired graph: R/L/C circuits, independent sources, piecewise-linear diodes, voltage-controlled switches, latching thyristors, finite-gain op-amps, a two-winding transformer, logic gates, comparator, and RS/D/JK flip-flops. The engines share MNA stamping and use backward Euler for dynamic elements.
- AC sweep by the wired graph with complex MNA, DC operating-point linearisation for the supported piecewise-linear nonlinear devices, editable frequency settings, magnitude/phase plots, and complex-valued calculation details.
- Graphs, signal tables, CSV export, and a standalone HTML calculation report with equations and intermediate values.
- Background Web Workers so a simulation does not block the editor.
- Numerical regression checks for sample circuits, invalid inputs, signal handling, SCM round trips, and analytical RC/RLC references.
- Windows desktop packaging through Electron; development mode is also available through Vite.

## Screenshots

No screenshots are committed yet. Before publishing, capture the editor, a transient plot, and the calculation-report view; place them in `docs/screenshots/` and link them here with descriptive alt text. Do not use diagrams or generated images in place of product screenshots.

## Architecture and stack

| Area | Implementation |
| --- | --- |
| UI | React 19, TypeScript, Tailwind CSS, Lucide |
| Editor | SVG components, automatic orthogonal and manual 45-degree wire geometry, editable component properties |
| Simulation | TypeScript MNA solvers, backward Euler for C/L, active-set iteration for piecewise-linear devices |
| Responsiveness | Browser Web Workers for calculations and validation |
| Desktop | Electron with context isolation, sandboxed renderer, and limited SCM file IPC |
| Tooling | Vite, TypeScript, tsx checks, electron-builder |

## Run locally

Requirements: Windows for the packaged app and Node.js 22.12 or newer. Development and checks are JavaScript/TypeScript based.

```powershell
npm ci
npm run dev
```

To run the Electron application from source:

```powershell
npm run electron:start
```

## Verify and package

```powershell
npm run lint
npm run test
npm run test:browser
npm run build
npm run dist:win
```

`npm run dist:win` produces a Windows installer and portable executable in `release/`. Build outputs, dependencies, local environment files, and internal audit notes are intentionally excluded from version control. Continuous integration runs `npm ci`, linting, tests, and the Vite build on Node 22.

The Windows package keeps the Russian and US English Electron locale files. If the application is translated for other languages, update `build.electronLanguages` in `package.json` before packaging. The size breakdown and measurement limits are recorded in `SIZE_AUDIT_NAPS_2026-09-28.md`.

`npm run test` checks circuit topology, wire geometry, SCM round trips, solver edge cases, and agreement between results and displayed formulas. `npm run test:browser` runs editor, wiring, grid, graph, and export scenarios in an installed Google Chrome. It starts and stops its own Vite server on port 3130; set `NAPS_TEST_PORT` to use another port or `NAPS_CHROME_PATH` to point to a Chrome executable. `npm run test:all` runs both suites. Browser screenshots are written to the ignored `.work/` directory.

## Numerical-model scope

NAPS is an educational and engineering-development tool, not a certified circuit simulator.

- The linear solver supports R/L/C elements and independent sources. The topology solver additionally supports diode, voltage-controlled switch, thyristor, op-amp, transformer, logic gates, comparator and flip-flops in connected circuits. Both have practical limits of 20,000 time points and 160 electrical unknowns. A singular or non-convergent system reports an error instead of generating a graph.
- The diode uses a piecewise-linear forward branch `I=(U−Vf)/Ron` and reverse branch `I=U/Roff`; defaults are `Vf=0.7 V`, `Ron=0.01 Ω`, `Roff=1 GΩ`. The switch uses `Ron/Roff` according to `Vgate−V2 ≥ Vthreshold` (default `2.5 V`). The thyristor uses the diode branches with gate triggering and latches until current falls below the holding-current setting (default `0.01 A`). These parameters are editable in element properties and preserved in SCM.
- The op-amp has zero input current, gain `K` from its nominal field, and `Uout=clip(K·(V+−V−), −Ulimit, Ulimit)` relative to ground. The default limit is `15 V`; set it in element properties. These idealised models do not include temperature, reverse recovery, gate current, slew rate, supply rails or manufacturer device parameters.
- `TR3` has four terminals and is modelled as two magnetically coupled windings (1–2 and 3–4), not a three-winding device. Primary inductance, turns ratio and coupling coefficient are editable; the dot convention gives pins 1 and 3 the same polarity. The magnetic model omits winding resistance, saturation and core losses.
- Logic gates and RS/D/JK flip-flops use discrete states `0`, `1`, `X`, an event queue, configurable high/low levels, input threshold, output resistance and propagation delay. The comparator compares its analog `+` and `−` inputs with configurable hysteresis. Output levels are supplied by internal ideal rails because legacy SCM symbols have no power pins; output resistance still loads connected analog circuits. An `X` output becomes high-impedance and is marked in the calculation results. D and JK capture on a rising clock edge; JK uses a new `clk` pin while its legacy pins `1` (J), `2` (K), `3` (Q), `4` (/Q) keep their identities.
- AC sweep supports the linear components, transformer and small-signal linearisation of diode, switch, thyristor and finite-gain op-amp about a DC operating point. AC sources use their peak amplitude with a cosine reference. Digital switching, comparator and flip-flop frequency-domain transfer functions are not defined by these piecewise discrete models, so AC analysis explicitly rejects them. A singular DC operating point or invalid signal also produces an error rather than a plot. The phase plot uses the principal angle in degrees; it does not unwrap phase.
- The separate RK4 converter comparison screen remains a control scenario for an idealised rectifier. It is not used by the circuit editor's transient solver.
- The installed Fastmean 6.1 package available during development contains an executable, help and example SCM files but no source code for its calculation core. No Fastmean algorithm was copied. The implementation follows the published MNA/backward-Euler and piecewise-linear modelling approach and is checked against independent circuit equations; direct numerical comparison with Fastmean remains open.
- Validate decisions that affect hardware, safety, compliance, or production designs against an appropriate verified simulator, manufacturer data, and independent engineering review.

The linear transient solver is informed by the [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf).

## English summary

NAPS is a TypeScript/Electron project that combines an SVG circuit editor with numerical transient analysis. It demonstrates desktop application architecture, background computation, modelling trade-offs, file import/export, testable simulation code, and reproducible Windows packaging.

## License

The project is distributed under the MIT License; see [LICENSE](LICENSE).
