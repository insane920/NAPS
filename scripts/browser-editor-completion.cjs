const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
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
    assert.equal(await page.locator('.component-card').count(), 5, 'focused library exposes five two-terminal families');
    assert.equal(await page.locator('.component-card').filter({ hasText: 'JK-триггер' }).count(), 0, 'advanced models are hidden from placement');
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
    await page.mouse.move(copyCenter.x, copyCenter.y);
    await page.mouse.down();
    await page.mouse.wheel(0, 80);
    assert.match(await rotation(), /rotate\(135\)/, 'holding the left button and scrolling rotates by 90 degrees');
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 80);
    await page.keyboard.up('Shift');
    await page.mouse.up();
    assert.match(await rotation(), /rotate\(180\)/, 'Shift with held left button and wheel rotates by 45 degrees');
    await page.keyboard.press('Enter');
    await dialog.locator('#passive-model').selectOption('nonlinear');
    await dialog.locator('#model-cubicCoefficient').fill('0.001');
    await dialog.getByRole('button', { name: 'OK' }).click();
    const [saved] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const savedScm = await fs.readFile(await saved.path(), 'utf8');
    assert.match(savedScm, /PassiveModel: "nonlinear"/);
    assert.match(savedScm, /Model_cubicCoefficient: "0\.001"/);
    await page.keyboard.press('Control+z');
    await page.mouse.click(copyCenter.x, copyCenter.y);
    await page.keyboard.press('Enter');
    assert.equal(await dialog.locator('#passive-model').inputValue(), 'linear', 'undo restores the linear model');
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await page.mouse.click(copyCenter.x, copyCenter.y);
    await page.keyboard.press('Control+y');
    await page.mouse.click(copyCenter.x, copyCenter.y);
    await page.keyboard.press('Enter');
    assert.equal(await dialog.locator('#passive-model').inputValue(), 'nonlinear', 'redo restores the nonlinear model');
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await page.getByRole('button', { name: 'Резистор' }).first().click();
    const placementModel = page.getByLabel('Вариант размещаемого элемента');
    await placementModel.selectOption('linear');
    await page.mouse.move(bounds.x + 520, bounds.y + 320);
    await page.mouse.wheel(0, 80);
    assert.equal(await placementModel.inputValue(), 'nonlinear', 'wheel selects the nonlinear variant before placement');
    await page.mouse.click(bounds.x + 520, bounds.y + 320);
    await page.mouse.click(bounds.x + 630, bounds.y + 320);
    const [variantScm] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const variantText = await fs.readFile(await variantScm.path(), 'utf8');
    assert.ok((variantText.match(/PassiveModel: "nonlinear"/g) || []).length >= 3, 'repeated placement keeps the chosen nonlinear model');
    await page.keyboard.press('Escape');
    await copy.dblclick();
    await dialog.locator('#passive-law').selectOption('table');
    await dialog.locator('#passive-table').fill('-2; -0.002\n0; 0\n2; 0.002');
    await dialog.getByRole('button', { name: 'OK' }).click();
    const [tableDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const tableScm = await fs.readFile(await tableDownload.path(), 'utf8');
    assert.match(tableScm, /PassiveLawDefinition:.*table/, 'custom law is saved in SCM');
    await page.locator('input[type="file"]').setInputFiles({ name: 'table-model.scm', mimeType: 'text/plain', buffer: Buffer.from(tableScm) });
    await page.keyboard.press('Escape');
    await copy.dblclick();
    assert.equal(await dialog.locator('#passive-law').inputValue(), 'table', 'custom model survives SCM reload');
    assert.match(await dialog.locator('#passive-table').inputValue(), /-2; -0\.002/, 'table points survive SCM reload');
    await dialog.locator('#passive-law').selectOption('inverseTable');
    await dialog.locator('#passive-table').fill('-0.002; -2\n0; 0\n0.002; 2');
    await dialog.getByRole('button', { name: 'OK' }).click();
    const [inverseDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    assert.match(await fs.readFile(await inverseDownload.path(), 'utf8'), /PassiveLawDefinition:.*inverseTable/, 'U(I) law is saved in SCM');
    await copy.dblclick();
    await dialog.locator('#passive-law').selectOption('expression');
    await dialog.locator('#passive-expression').fill('n*x + x');
    await dialog.getByRole('button', { name: 'OK' }).click();
    assert.match(await dialog.innerText(), /размерност/, 'dimensionally invalid formula is rejected before saving');
    await dialog.locator('#passive-expression').fill('n*x + y0*tanh(x/x0)');
    await dialog.locator('#passive-argument-scale').fill('2');
    await dialog.locator('#passive-output-scale').fill('0.001');
    await dialog.getByRole('button', { name: 'OK' }).click();
    const [expressionDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const expressionScm = await fs.readFile(await expressionDownload.path(), 'utf8');
    assert.match(expressionScm, /PassiveLawDefinition:.*expression/, 'dimension-checked formula is saved in SCM');
    await page.locator('input[type="file"]').setInputFiles({ name: 'formula-model.scm', mimeType: 'text/plain', buffer: Buffer.from(expressionScm) });
    await page.keyboard.press('Escape');
    await copy.dblclick();
    assert.equal(await dialog.locator('#passive-law').inputValue(), 'expression');
    assert.equal(await dialog.locator('#passive-expression').inputValue(), 'n*x + y0*tanh(x/x0)');
    assert.equal(await dialog.locator('#passive-argument-scale').inputValue(), '2');
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    assert.deepEqual(errors, []);
    console.log('PASS: focused library, editing, rotation and nonlinear cubic/table/formula model placement/save/undo/redo.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
