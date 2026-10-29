const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const scm = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const elements = [
        { id: 'V', name: 'V', type: 'V_AC', value: 1, valueStr: '1', unit: 'В', x: 200, y: 200, rotation: 0,
          secondaryValue: 10, modelParams: { sourceOffset: 2, sourcePhaseDeg: 0 } },
        { id: 'R', name: 'R', type: 'R', value: 10, valueStr: '10', unit: 'Ом', x: 500, y: 200, rotation: 0,
          passiveModel: 'nonlinear', modelParams: { cubicCoefficient: 0.5 } },
        { id: 'G', name: 'G', type: 'GND', value: 0, valueStr: '', unit: '', x: 500, y: 400, rotation: 0 },
      ];
      const wire = (id, a, ap, b, bp, points) => ({ id, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp,
        manual: true, waypoints: points.map(([x, y]) => ({ x, y })) });
      const wires = [wire('high', 'V', '1', 'R', '1', [[170, 120], [470, 120]]),
        wire('low', 'V', '2', 'G', '1', [[230, 340], [500, 340]]),
        wire('ground', 'R', '2', 'G', '1', [[530, 340], [500, 340]])];
      const transient = { tMax: 0.1, tMaxStr: '0.1', step: 0.1, stepStr: '0.1', eps: 0.001,
        signals: [{ id: 'current', plotIndex: 1, exprX: 't', exprY: 'I(R)', color: '#2563eb', enabled: true }] };
      const ac = { fMin: 10, fMax: 10.00001, points: 2, scaleType: 'linear',
        signals: [{ id: 'mag', plotIndex: 1, exprX: 'f', exprY: 'mag(I(R))', color: '#dc2626', enabled: true }] };
      return exportToYamlScm(elements, wires, transient, ac, undefined, 'current', 'connect');
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'nonlinear-browser.scm', mimeType: 'text/plain', buffer: Buffer.from(scm) });
    await page.waitForFunction(() => document.querySelectorAll('#schematic-world > [data-component-id]').length === 3);
    async function signal(firstExpected) {
      await page.getByRole('dialog', { name: 'Результаты расчёта' }).waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTitle('Экспортировать точки осциллограмм в CSV').click()]);
      const lines = (await fs.readFile(await download.path(), 'utf8')).trim().split(/\r?\n/);
      const first = lines[1].split(',').map(Number);
      assert.ok(Math.abs(first[1] - firstExpected) < 1e-7, `${first[1]} differs from independent nonlinear reference ${firstExpected}`);
      await page.getByRole('button', { name: 'Закрыть график' }).click();
    }
    await page.getByRole('button', { name: 'Переходный процесс' }).click();
    await signal(2 / 10 + 0.5 * 2 ** 3);
    await page.getByRole('button', { name: 'Частотные характеристики' }).click();
    await signal(1 / 10 + 3 * 0.5 * 2 ** 2);
    assert.deepEqual(errors, []);
    console.log('PASS: nonlinear resistor browser transient and AC graph CSV match independent I(U) and dI/dU references.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
