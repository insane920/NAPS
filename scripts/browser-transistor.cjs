const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const legacy = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      return exportToYamlScm([{ id: 'old-npn', type: 'NPN', name: 'VT1', x: 260, y: 180,
        rotation: 0, value: 100, valueStr: '100', unit: '' }], [], SAMPLE_CIRCUITS[0].transient);
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'old-transistor.scm', mimeType: 'text/plain', buffer: Buffer.from(legacy) });
    await page.getByText('old-transistor', { exact: true }).waitFor();
    const component = page.locator('#schematic-world > g[transform^="translate"]').first();
    assert.ok(await component.count(), 'NPN is placed from the three-terminal category');
    const center = await component.evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint();
      const result = point.matrixTransform(group.getScreenCTM());
      return { x: result.x, y: result.y };
    });
    await page.mouse.dblclick(center.x, center.y);
    assert.ok(await page.getByText('Параметры: Биполярный транзистор NPN').count());
    await page.locator('#transistor-model').selectOption('small-signal');
    await page.locator('#model-betaForward').fill('125');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить' }).click()]);
    const scm = await fs.readFile(await download.path(), 'utf8');
    assert.match(scm, /Type: "?NPN"?/);
    assert.match(scm, /TransistorModel: "?small-signal"?/);
    assert.match(scm, /Model_betaForward: "?125"?/);
    assert.deepEqual(errors, []);
    console.log('PASS: hidden legacy transistor loads, remains editable, and saves its model parameters.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
