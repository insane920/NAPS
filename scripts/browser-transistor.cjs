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
    await page.getByRole('combobox', { name: 'Трёхполюсники: выбрать элемент' }).selectOption('NPN');
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    await page.mouse.click(canvas.x + 260, canvas.y + 180);
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
    console.log('PASS: three-terminal transistor placement, properties, model selection, and SCM save.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
