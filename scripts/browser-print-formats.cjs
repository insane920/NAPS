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
    await page.getByRole('button', { name: 'Резистор', exact: true }).first().click();
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    await page.mouse.click(canvas.x + 260, canvas.y + 180);
    await page.keyboard.press('Escape');
    const original = await page.locator('[data-component-id]').first().getAttribute('transform');
    const sizes = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };
    for (const [format, dimensions] of Object.entries(sizes)) for (const orientation of ['portrait', 'landscape']) {
      await page.getByRole('combobox', { name: 'Формат документа' }).selectOption(format);
      await page.getByRole('combobox', { name: 'Ориентация документа' }).selectOption(orientation);
      await page.getByRole('button', { name: 'Экспорт ▾' }).click();
      await page.getByRole('menuitem', { name: 'Печать' }).click();
      const dialog = page.getByRole('dialog', { name: 'Настройки печати и экспорта' });
      const [short, long] = dimensions;
      const width = orientation === 'landscape' ? long : short;
      const height = orientation === 'landscape' ? short : long;
      await page.waitForFunction(({ width, height }) => {
        const content = document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc');
        return content?.includes(`width="${width}mm"`) && content.includes(`height="${height}mm"`);
      }, { width, height });
      const preview = await page.getByTitle('Предварительный просмотр листа').getAttribute('srcdoc');
      assert.match(preview, new RegExp(`@page\\{size:${width}mm ${height}mm;margin:0\\}`),
        `${format} ${orientation}: browser print page is a physical ${width} × ${height} mm`);
      assert.match(preview, /data-eskd-frame="true"/);
      assert.match(preview, /data-eskd-title-block="true"/);
      assert.equal(await dialog.getByRole('button', { name: 'Печать…' }).isDisabled(), false);
      assert.equal(await page.locator('[data-component-id]').first().getAttribute('transform'), original,
        'changing paper never moves the stored component');
      await dialog.getByRole('button', { name: 'Закрыть' }).click();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: print preview A0–A4 in both orientations retains physical sheet sizes, frame, title block and SCM geometry.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
