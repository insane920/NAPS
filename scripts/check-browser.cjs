const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.NAPS_TEST_PORT || 3130);
const url = `http://127.0.0.1:${port}/`;
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const cases = ['browser-wiring.cjs', 'browser-editor.cjs', 'browser-calculation.cjs'];

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
      env: { ...process.env, NAPS_TEST_URL: url },
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
