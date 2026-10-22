// Packaged Windows smoke test. Override NAPS_ELECTRON_EXE to test another build.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const output = await fs.mkdtemp(path.resolve('.work/electron-stage1-'));
  const saved = path.join(output, 'roundtrip.scm');
  const app = await electron.launch({
    executablePath: process.env.NAPS_ELECTRON_EXE || path.resolve('release/win-unpacked/NAPS.exe'),
    args: [`--user-data-dir=${path.join(output, 'profile')}`], timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: 'Прямой', exact: true }).waitFor();
    const sandbox = await app.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
    });
    assert.deepEqual(sandbox, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    // Stub only OS file selection; exercise the real restricted IPC and disk persistence.
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, saved);
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    for (const [x, y] of [[250, 170], [550, 290]]) {
      await page.getByRole('button', { name: 'Резистор', exact: true }).first().click();
      await page.mouse.click(canvas.x + x, canvas.y + y);
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Прямой', exact: true }).click();
    const components = page.locator('[data-component-id]');
    const pin = (i, j) => components.nth(i).locator('circle[fill="transparent"].cursor-pointer').nth(j);
    const center = locator => locator.evaluate(circle => {
      const point = circle.ownerSVGElement.createSVGPoint();
      point.x = Number(circle.getAttribute('cx')); point.y = Number(circle.getAttribute('cy'));
      const result = point.matrixTransform(circle.getScreenCTM());
      return { x: result.x, y: result.y };
    });
    const from = await center(pin(0, 1)); const to = await center(pin(1, 0));
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    const wires = page.locator('#schematic-world path[stroke="transparent"]');
    if (await wires.count() !== 1) {
      await page.screenshot({ path: path.join(output, 'wiring-failure.png') });
      console.error('Packaged wiring did not complete', { from, to, componentCount: await components.count(), errors, output });
    }
    assert.equal(await wires.count(), 1);
    const route = await wires.first().getAttribute('d');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => !document.title.startsWith('*'));
    const scm = await fs.readFile(saved, 'utf8');
    assert.match(scm, /MajorVersion: 8/); assert.match(scm, /RouteMode: direct/);
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(await wires.first().getAttribute('d'), route);
    await page.screenshot({ path: path.join(output, 'packaged-wire.png') });
    assert.deepEqual(errors, []);
    console.log(`PASS: packaged Electron, sandbox, mouse wiring and native SCM save/open. Evidence: ${output}`);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
