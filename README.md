# NAPS

**NAPS — Numerical, Analytical, PWL, Simulation.** Desktop CAD for editing electrical schematics, numerical and analytical simulation, piecewise-linear models, and explainable calculation output.

> The application is not an AI product and does not require an API key, cloud service, or backend to run.

## Highlights

- Interactive electrical-schematic editor with component palette, explicit wiring mode, 45-degree manual wire segments, rotation, selection, undo/redo, and example circuits.
- In Wiring mode, click a terminal, then click the canvas to set horizontal, vertical, or 45-degree waypoints before connecting to another terminal or an existing wire. Connecting to a wire inserts a visible junction; merely crossing a wire does not connect it.
- In Select mode, drag a wire segment to reshape its route without changing its electrical endpoints. A selected two-terminal component can be excluded from simulation as an open circuit or replaced by an ideal short; this state is saved in SCM.
- Import and export of the human-readable `.scm` format.
- Transient analysis for linear R/L/C circuits with independent sources, using modified nodal analysis (MNA) and backward Euler integration.
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
| Simulation | TypeScript MNA solver, backward Euler for linear transient circuits, RK4-based specialised scenarios |
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

`npm run test` checks circuit topology, wire geometry, SCM round trips, solver edge cases, and agreement between results and displayed formulas. `npm run test:browser` runs editor, wiring, grid, graph, and export scenarios in an installed Google Chrome. It starts and stops its own Vite server on port 3130; set `NAPS_TEST_PORT` to use another port or `NAPS_CHROME_PATH` to point to a Chrome executable. `npm run test:all` runs both suites. Browser screenshots are written to the ignored `.work/` directory.

## Numerical-model scope

NAPS is an educational and engineering-development tool, not a certified circuit simulator.

- The linear solver supports R/L/C elements and independent sources. It validates common invalid and degenerate circuits, but has practical limits of 20,000 time steps and 160 unknowns.
- Diodes, switches, operational amplifiers, and converter scenarios use simplified educational models. They run only when the named components and electrical node partition match a bundled example. Changing values or visual placement is supported, but changing electrical topology disables the calculation. Their output is not a universal physical solution.
- AC/Bode analysis is unavailable until it can use the actual wired circuit graph. The former nominal-only implementation ignored wires and has been disabled.
- The RK4 comparison screen is a control scenario for an idealised rectifier. A passing result does not certify every circuit, operating mode, or component model.
- Validate decisions that affect hardware, safety, compliance, or production designs against an appropriate verified simulator, manufacturer data, and independent engineering review.

The linear transient solver is informed by the [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf).

## English summary

NAPS is a TypeScript/Electron project that combines an SVG circuit editor with numerical transient analysis. It demonstrates desktop application architecture, background computation, modelling trade-offs, file import/export, testable simulation code, and reproducible Windows packaging.

## License

The project is distributed under the MIT License; see [LICENSE](LICENSE).
