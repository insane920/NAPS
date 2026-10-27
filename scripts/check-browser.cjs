const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.NAPS_TEST_PORT || 3130);
const url = `http://127.0.0.1:${port}/`;
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const cases = ['browser-pin-contacts.cjs', 'browser-wiring.cjs', 'browser-wiring-history.cjs', 'browser-direct-wire.cjs', 'browser-geometry.cjs', 'browser-viewport-regressions.cjs', 'browser-editor.cjs', 'browser-editor-completion.cjs', 'browser-calculation.cjs', 'browser-ac.cjs', 'browser-regressions.cjs', 'browser-transistor.cjs'];

cases.push('browser-recovery.cjs');
cases.push('browser-label-layout.cjs');
cases.push('browser-group-selection.cjs');
cases.push('browser-new-crossings.cjs');
cases.push('browser-description.cjs');
cases.push('browser-reconnect.cjs');
cases.push('browser-appearance.cjs');
cases.push('browser-view-preferences.cjs');
cases.push('browser-shortcut-variants.cjs');
cases.push('browser-terminal-swap.cjs');
cases.push('browser-p0-routing.cjs');
cases.push('browser-source-variants.cjs');
cases.push('browser-controlled-references.cjs');
cases.push('browser-model-roundtrip.cjs');
cases.push('browser-obstacle-routing.cjs');
cases.push('browser-sheet-navigation.cjs');
cases.push('browser-junction-selection.cjs');
cases.push('browser-hit-testing.cjs');
cases.push('browser-text-blocks.cjs');
cases.push('browser-coincident-junctions.cjs');
cases.push('browser-anchored-crossing.cjs');
cases.push('browser-manual-waypoint.cjs');
cases.push('browser-connected-transforms.cjs');
cases.push('browser-branch-integrity.cjs');
if (process.env.NAPS_BROWSER_CASE) {
  const selected = process.env.NAPS_BROWSER_CASE;
  if (!cases.includes(selected)) throw new Error(`Unknown browser case: ${selected}`);
  cases.splice(0, cases.length, selected);
}
mkdirSync(path.join(root, '.work'), { recursive: true });

const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-4000); });
}

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Vite did not start at ${url}:\n${serverOutput}`);
}

function runCase(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        NAPS_TEST_URL: url,
        ...(process.env.CI && !process.env.NAPS_CHROME_PATH ? { NAPS_CHROME_PATH: chromium.executablePath() } : {}),
      },
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${file} exited with code ${code}`)));
  });
}

(async () => {
  try {
    await waitForServer();
    for (const file of cases) {
      console.log(`\nRunning ${file}...`);
      await runCase(file);
    }
    console.log('\nPASS: wiring, editor, calculation and export browser scenarios.');
  } finally {
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
