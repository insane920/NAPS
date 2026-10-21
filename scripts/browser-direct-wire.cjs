const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const resistor = (id, x, y) => ({ id, type: 'R', name: id, x, y, rotation: 0, value: 100, valueStr: '100', unit: 'Ом' });
      return exportToYamlScm([resistor('R1', 200, 200), resistor('R2', 500, 300)], [], SAMPLE_CIRCUITS[0].transient);
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'direct-base.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.getByRole('button', { name: 'Прямой', exact: true }).click();
    const components = page.locator('#schematic-world > g[transform^="translate"]');
    const pin = (component, terminal) => components.nth(component).locator('circle[fill="transparent"].cursor-pointer').nth(terminal);
    const center = locator => locator.evaluate(circle => {
      const point = circle.ownerSVGElement.createSVGPoint();
      point.x = Number(circle.getAttribute('cx'));
      point.y = Number(circle.getAttribute('cy'));
      const result = point.matrixTransform(circle.getScreenCTM());
      return { x: result.x, y: result.y };
    });
    const from = await center(pin(0, 1));
    const to = await center(pin(1, 0));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    const wirePaths = page.locator('#schematic-world path[stroke="transparent"]');
    assert.equal(await wirePaths.count(), 1);
    const original = await wirePaths.first().getAttribute('d');
    assert.equal(original, 'M 230 200 L 470 300', 'the direct wire is one segment at an arbitrary angle');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить' }).click()]);
    const scm = await fs.readFile(await download.path(), 'utf8');
    assert.match(scm, /RouteMode: direct/, 'SCM preserves direct mode');
    await page.locator('input[type="file"]').setInputFiles({ name: 'direct-roundtrip.scm', mimeType: 'text/plain', buffer: Buffer.from(scm) });
    await page.waitForTimeout(50);
    assert.equal(await wirePaths.first().getAttribute('d'), original, 'loading SCM preserves the exact straight route');
    const componentCenter = await components.first().evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint();
      return point.matrixTransform(group.getScreenCTM()).x;
    });
    await page.mouse.click(componentCenter, from.y);
    await page.keyboard.press('ArrowRight');
    const moved = await wirePaths.first().getAttribute('d');
    assert.match(moved, /^M 250 200 L 470 300$/, 'moving a connected element preserves the single straight segment');
    await page.keyboard.press('Control+z');
    assert.equal(await wirePaths.first().getAttribute('d'), original, 'undo restores the exact direct route');
    await page.keyboard.press('Control+y');
    assert.equal(await wirePaths.first().getAttribute('d'), moved, 'redo restores the moved direct route');
    const midpoint = await page.locator('#schematic-world').evaluate(world => {
      const point = world.ownerSVGElement.createSVGPoint();
      point.x = 360; point.y = 250;
      const result = point.matrixTransform(world.getScreenCTM());
      return { x: result.x, y: result.y };
    });
    await page.mouse.move(midpoint.x, midpoint.y);
    await page.mouse.down();
    await page.mouse.move(midpoint.x, midpoint.y + 60, { steps: 6 });
    await page.mouse.up();
    const edited = await wirePaths.first().getAttribute('d');
    assert.match(edited, /^M 250 200 L .* L .* L 470 300$/, 'free-angle segment drag preserves both terminal endpoints');
    await page.keyboard.press('Control+z');
    assert.equal(await wirePaths.first().getAttribute('d'), moved, 'undo removes the free-angle segment edit');
    assert.deepEqual(errors, []);
    console.log('PASS: arbitrary-angle direct wire, SCM, connected movement, segment edit and Undo/Redo.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
