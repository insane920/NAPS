const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH
    ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const scm = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const points = [['left', 100, 200], ['right', 500, 200], ['top', 300, 100], ['bottom', 300, 300]];
      const elements = points.map(([id, x, y]) => ({ id, type: 'JUNCTION', name: id, x, y,
        rotation: 0, value: 0, valueStr: '', unit: '' }));
      const wires = [
        { id: 'wire-a', fromCompId: 'left', fromPinId: '1', toCompId: 'right', toPinId: '1', routeMode: 'direct' },
        { id: 'wire-b', fromCompId: 'top', fromPinId: '1', toCompId: 'bottom', toPinId: '1', routeMode: 'direct' },
      ];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient,
        undefined, undefined, 'current', 'explicit');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'overlapping-wires.scm',
      mimeType: 'text/plain', buffer: Buffer.from(scm) });
    await page.getByText('overlapping-wires', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-id]').length === 2);
    const wireIds = await page.locator('[data-wire-id]').evaluateAll(items => items.map(item => item.getAttribute('data-wire-id')));
    assert.equal(wireIds.length, 2);
    const crossing = () => page.locator('#schematic-world').evaluate(group => {
      const point = new DOMPoint(300, 200).matrixTransform(group.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    for (const zoom of [50, 100, 200]) {
      await page.getByRole('slider', { name: 'Масштаб просмотра в процентах' }).fill(String(zoom));
      const point = await crossing();
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.locator(`[data-wire-id="${wireIds[0]}"] path[stroke="#2563eb"]`).count(), 1,
        `${zoom}%: stable geometric selection chooses the first wire despite the second being drawn on top`);
      assert.equal(await page.locator(`[data-wire-id="${wireIds[1]}"] path[stroke="#2563eb"]`).count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: overlapping wire segments use stable geometric priority at 50–200% zoom.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
