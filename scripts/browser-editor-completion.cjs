const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const { version } = require('../package.json');

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
    assert.match(await page.locator('.brand').innerText(), new RegExp(`Версия ${version.replaceAll('.', '\\.')}`));
    await page.getByRole('button', { name: 'Библиотека...' }).click();
    await page.getByRole('button', { name: 'Многополюсники' }).click();
    assert.equal(await page.locator('.component-card').filter({ hasText: 'JK-триггер' }).count(), 1, 'five-pin JK is available in the library');
    await page.getByTitle('Закрыть библиотеку').click();

    const canvas = page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last();
    const bounds = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Резистор' }).first().click();
    await page.mouse.click(bounds.x + 320, bounds.y + 220);
    const components = page.locator('#schematic-world > g[transform^="translate"]');
    assert.equal(await components.count(), 1);
    const center = await components.first().evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint(); point.x = 0; point.y = 0;
      const screen = point.matrixTransform(group.getScreenCTM());
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(center.x, center.y);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    assert.equal(await components.count(), 2, 'Ctrl+C/V creates one copy');
    const copy = components.last();
    const beforeMove = await copy.getAttribute('transform');
    await page.keyboard.press('ArrowRight');
    const afterMove = await copy.getAttribute('transform');
    assert.notEqual(afterMove, beforeMove, 'arrow key moves selected element on the grid');

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Параметры: Сопротивление' });
    await dialog.waitFor();
    await dialog.locator('#element-value').fill('2к');
    await dialog.getByRole('button', { name: 'OK' }).click();
    assert.equal(await copy.locator('[data-label-kind="value"]').textContent(), '2к', 'the edited nominal immediately updates the schematic');
    await page.keyboard.press('Control+z');
    assert.equal(await copy.locator('[data-label-kind="value"]').textContent(), '1к', 'undo restores the old model value');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await copy.locator('[data-label-kind="value"]').textContent(), '2к', 'Ctrl+Shift+Z repeats the change');

    const copyCenter = await copy.evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint(); point.x = 0; point.y = 0;
      const screen = point.matrixTransform(group.getScreenCTM());
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(copyCenter.x, copyCenter.y);
    const rotation = () => copy.locator(':scope > g[transform^="rotate"]').getAttribute('transform');
    const angles = [];
    for (let turn = 0; turn < 4; turn++) { await page.keyboard.press('r'); angles.push(await rotation()); }
    assert.deepEqual(angles.map(value => Number(value.match(/rotate\((\d+)/)[1])), [90, 180, 270, 0], 'R cycles through all cardinal orientations');
    await page.keyboard.press('Shift+r');
    assert.match(await rotation(), /rotate\(45\)/, 'Shift+R rotates by 45 degrees');
    assert.deepEqual(errors, []);
    console.log('PASS: version, JK library, Ctrl+C/V, arrow movement, Enter properties, editable nominal, undo/redo and 45°/90° rotation.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
