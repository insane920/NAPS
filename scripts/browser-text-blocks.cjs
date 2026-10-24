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
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    await page.getByRole('button', { name: 'Текст', exact: true }).click();
    await page.mouse.click(canvas.x + 250, canvas.y + 170);
    await page.mouse.click(canvas.x + 480, canvas.y + 260);
    await page.keyboard.press('Escape');
    const blocks = page.locator('#schematic-world > g[data-component-id]').filter({ hasText: 'Текст схемы' });
    assert.equal(await blocks.count(), 2, 'the annotation tool places multiple independent blocks');
    await blocks.first().dblclick();
    await page.getByRole('textbox', { name: 'Текст на схеме:' }).fill('Первый блок\nВторая строка');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    assert.equal(await page.locator('#schematic-world > g[data-component-id] tspan').filter({ hasText: 'Вторая строка' }).count(), 1);
    const first = page.locator('#schematic-world > g[data-component-id]').filter({ hasText: 'Первый блок' });
    const second = blocks.first();
    const firstBefore = await first.getAttribute('transform');
    const secondBefore = await second.getAttribute('transform');
    const point = await first.evaluate(group => {
      const position = new DOMPoint(-20, 0).matrixTransform(group.getScreenCTM());
      return { x: position.x, y: position.y };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 40, point.y + 20, { steps: 6 });
    await page.mouse.up();
    const firstMoved = await first.getAttribute('transform');
    assert.notEqual(firstMoved, firstBefore, 'first text block moves');
    assert.equal(await second.getAttribute('transform'), secondBefore, 'second text block stays in place');
    await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] textarea')?.value.includes('Objects:'), null, { timeout: 5000 });
    const scm = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
    assert.match(scm, /Первый блок/);
    assert.match(scm, /Вторая строка/);
    assert.match(scm, /Текст схемы/);
    await page.getByRole('dialog', { name: 'Редактор кода схемы' }).getByRole('button').first().click();
    await page.keyboard.press('Control+z');
    assert.equal(await first.getAttribute('transform'), firstBefore, 'one undo restores the moved annotation');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'text-blocks.scm',
      mimeType: 'text/plain', buffer: Buffer.from(scm) });
    await page.waitForFunction(() => document.title.includes('text-blocks'));
    const reopened = page.locator('#schematic-world > g[data-component-id]').filter({ hasText: 'Первый блок' });
    await reopened.waitFor();
    assert.equal(await reopened.getAttribute('transform'), firstMoved, 'SCM restores annotation position');
    assert.equal(await page.locator('#schematic-world > g[data-component-id]').filter({ hasText: 'Текст схемы' }).count(), 1,
      'SCM restores the second independent annotation');
    assert.deepEqual(errors, []);
    console.log('PASS: independent multi-line text blocks place, edit, move, save and undo.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
