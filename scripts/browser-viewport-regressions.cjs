const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [100, 300].map((x, i) => ({ id: `R${i+1}`, name: `R${i+1}`, type: 'R', x, y: 100, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' }));
      const wires = [{ id: 'long-route', fromCompId: 'R1', fromPinId: '2', toCompId: 'R2', toPinId: '1', waypoints: [{ x: 140, y: 100 }, { x: 140, y: 6000 }, { x: 260, y: 6000 }, { x: 260, y: 100 }] }];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient);
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'long-route.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.getByTitle('Показать схему целиком').click();
    const extent = await page.locator('#schematic-world').evaluate(world => {
      const box = world.getBoundingClientRect();
      const canvas = world.ownerSVGElement.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, canvas: { top: canvas.top, bottom: canvas.bottom, left: canvas.left, right: canvas.right } };
    });
    assert.ok(extent.top >= extent.canvas.top && extent.bottom <= extent.canvas.bottom && extent.left >= extent.canvas.left && extent.right <= extent.canvas.right, 'fit view includes the entire routed wire');
    const getZoom = async () => Number((await page.locator('#schematic-world').getAttribute('transform')).match(/scale\(([^)]+)\)/)[1]);
    const before = await getZoom();
    await page.getByTitle('Уменьшить масштаб').click();
    assert.ok(await getZoom() < before, 'zoom-out must decrease an already small fit zoom');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ы', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }))),
    ]);
    assert.match(await fs.readFile(await download.path(), 'utf8'), /MajorVersion: 7/);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'щ', code: 'KeyO', ctrlKey: true, bubbles: true, cancelable: true }))),
    ]);
    assert.ok(chooser);
    assert.deepEqual(errors, []);
    console.log('PASS: full wire bounds, zoom-out below 40%, Russian-layout save/open shortcuts.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
