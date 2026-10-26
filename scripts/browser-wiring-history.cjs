const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const element = (id, x) => ({ id, type: 'R', name: id, x, y: 200, rotation: 0, value: 100, valueStr: '100', unit: 'Ом' });
      return exportToYamlScm(
        [element('R1', 200), element('R2', 500)],
        [{ id: 'W1', fromCompId: 'R1', fromPinId: '2', toCompId: 'R2', toPinId: '1' }],
        SAMPLE_CIRCUITS[0].transient,
      );
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'history.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    const components = page.locator('#schematic-world > g[transform^="translate"]');
    const wirePaths = page.locator('#schematic-world path[stroke="transparent"]');
    await wirePaths.first().waitFor({ state: 'attached' });
    const originalPath = await wirePaths.first().getAttribute('d');
    const center = await components.first().evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint();
      const result = point.matrixTransform(group.getScreenCTM());
      return { x: result.x, y: result.y };
    });
    await page.mouse.click(center.x, center.y);
    for (let index = 0; index < 50; index++) {
      // Move away from R2: moving through its body is now correctly rejected.
      // This case exercises history; blocked moves have a separate regression.
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(5);
    }
    assert.equal(await components.first().getAttribute('transform'), 'translate(-800, 200)', '50 moves keep the connected element on the grid');
    const movedPath = await wirePaths.first().getAttribute('d');
    assert.notEqual(movedPath, originalPath, 'wire follows the moved terminal');
    assert.equal(await wirePaths.count(), 1, 'rapid history leaves no duplicate wire');
    for (let index = 0; index < 50; index++) await page.keyboard.press('Control+z');
    assert.equal(await components.first().getAttribute('transform'), 'translate(200, 200)', '50 undos restore the original element');
    assert.equal(await wirePaths.first().getAttribute('d'), originalPath, '50 undos restore the original route');
    for (let index = 0; index < 50; index++) await page.keyboard.press('Control+y');
    assert.equal(await components.first().getAttribute('transform'), 'translate(-800, 200)', '50 redos restore the moved element');
    assert.equal(await wirePaths.first().getAttribute('d'), movedPath, '50 redos restore the same route');
    const coincidentFixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const element = id => ({ id, type: 'R', name: id, x: 300, y: 200, rotation: 0, value: 100, valueStr: '100', unit: 'Ом' });
      return exportToYamlScm(
        [element('R1'), element('R2')],
        [{ id: 'W1', fromCompId: 'R1', fromPinId: '1', toCompId: 'R2', toPinId: '1' }],
        SAMPLE_CIRCUITS[0].transient,
      );
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'coincident.scm', mimeType: 'text/plain', buffer: Buffer.from(coincidentFixture) });
    await page.locator('#schematic-world > g:has(> path[stroke="transparent"][d="M 270 200"]) > circle[r="6"]').waitFor({ state: 'attached' });
    assert.equal(await wirePaths.count(), 1, 'coincident terminal connection remains a single logical wire');
    const coincidentPin = components.first().locator('circle[fill="transparent"].cursor-pointer').first();
    const pinScreen = await coincidentPin.evaluate(circle => {
      const point = circle.ownerSVGElement.createSVGPoint();
      point.x = Number(circle.getAttribute('cx'));
      point.y = Number(circle.getAttribute('cy'));
      const result = point.matrixTransform(circle.getScreenCTM());
      return { x: result.x, y: result.y };
    });
    await page.mouse.click(pinScreen.x, pinScreen.y);
    const chooser = page.getByRole('dialog', { name: 'Выбор совпадающего контакта' });
    await chooser.waitFor();
    assert.equal(await chooser.getByRole('button').count(), 3, 'both coincident pins and Cancel are offered');
    await chooser.getByRole('button', { name: 'Отмена' }).click();
    assert.equal(await wirePaths.count(), 1, 'canceling an ambiguous pick creates no extra connection');
    assert.deepEqual(errors, [], 'history must not cause browser errors');
    console.log('PASS: 50 connected-element moves, 50 undos and 50 redos preserve one electrical wire; coincident terminals show an explicit marker.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
