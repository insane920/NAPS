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
    const canvas = page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last();
    const bounds = await canvas.boundingBox();
    await page.getByRole('combobox', { name: 'Шаг сетки в миллиметрах' }).selectOption('0.5');
    await page.getByRole('button', { name: 'Резистор', exact: true }).first().click();
    await page.mouse.click(bounds.x + 50 + 134, bounds.y + 30 + 122);
    const component = page.locator('[data-component-id]').first();
    assert.equal(await component.getAttribute('transform'), 'translate(134, 122)', 'changing grid updates pointer snapping immediately');
    await page.getByRole('combobox', { name: 'Шаг сетки в миллиметрах' }).selectOption('10');
    assert.equal(await component.getAttribute('transform'), 'translate(134, 122)', 'grid change never moves existing components');
    const cursor = { x: bounds.x + 650, y: bounds.y + 420 };
    const underCursor = () => page.locator('#schematic-world').evaluate((world, cursor) => {
      const point = world.ownerSVGElement.createSVGPoint();
      point.x = cursor.x; point.y = cursor.y;
      const p = point.matrixTransform(world.getScreenCTM().inverse());
      return { x: p.x, y: p.y };
    }, cursor);
    const original = await underCursor();
    await page.mouse.move(cursor.x, cursor.y);
    for (let repeat = 0; repeat < 5; repeat++) {
      await page.mouse.wheel(0, -180);
      await page.waitForTimeout(30);
      await page.mouse.wheel(0, 180);
      await page.waitForTimeout(30);
    }
    const after = await underCursor();
    assert(Math.hypot(original.x - after.x, original.y - after.y) < 0.001, 'wheel zoom keeps the world point under the cursor');
    assert.equal(await component.getAttribute('transform'), 'translate(134, 122)', 'zoom never alters model geometry');
    const downloadText = async name => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()]);
      return { text: await fs.readFile(await download.path(), 'utf8'), name: download.suggestedFilename() };
    };
    const current = await downloadText('Сохранить');
    assert.match(current.text, /MajorVersion: 7/);
    assert.match(current.text, /X: 33\.5\n/);
    assert.match(current.name, /-scm7\.scm$/);
    const legacy = await downloadText('Копия 0.6.0');
    assert.match(legacy.text, /MajorVersion: 6/);
    assert.match(legacy.text, /X: 134\n/);
    assert.match(legacy.name, /-0\.6\.0\.scm$/);
    for (const saved of [legacy, current]) {
      await page.locator('input[type="file"]').setInputFiles({ name: saved.name, mimeType: 'text/plain', buffer: Buffer.from(saved.text) });
      await page.waitForTimeout(50);
      assert.equal(await component.getAttribute('transform'), 'translate(134, 122)', 'both SCM versions preserve geometry');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: 0.5 mm grid, current snapping, cursor-anchored zoom, physical SCM and legacy copy.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
