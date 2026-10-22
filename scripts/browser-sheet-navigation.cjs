const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH
    ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    for (const viewport of [{ width: 800, height: 600 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Резистор', exact: true }).first().click();
      const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
      await page.mouse.click(canvas.x + 220, canvas.y + 180);
      await page.keyboard.press('Escape');
      const component = page.locator('[data-component-id]').first();
      const worldPosition = await component.getAttribute('transform');
      for (const format of ['A0', 'A1', 'A2', 'A3', 'A4']) {
        await page.getByRole('combobox', { name: 'Формат документа' }).selectOption(format);
        await page.getByTitle('Вписать лист в окно').click();
        const percent = Number((await page.locator('[aria-label="Масштаб просмотра"] output').innerText()).replace('%', ''));
        assert(percent > 0 && percent <= 250, `${format}: fit yields finite zoom`);
        const horizontal = page.getByLabel('Горизонтальная прокрутка схемы');
        const vertical = page.getByLabel('Вертикальная прокрутка схемы');
        const before = await component.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f }));
        await horizontal.evaluate(element => {
          element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); element.scrollLeft += 75;
        });
        await vertical.evaluate(element => {
          element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); element.scrollTop += 60;
        });
        await page.waitForTimeout(30);
        const after = await component.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f }));
        assert(Math.abs(after.x - before.x + 75) < 2 && Math.abs(after.y - before.y + 60) < 2,
          `${format}: scrollbars pan without coordinate jumps (${JSON.stringify({ before, after })})`);
        assert.equal(await component.getAttribute('transform'), worldPosition,
          `${format}: viewport actions preserve component coordinates`);
        await page.getByTitle('По ширине листа').click();
        assert.equal(await component.getAttribute('transform'), worldPosition);
      }
      await page.close();
    }
    console.log('PASS: A0–A4 sheet navigation and physical coordinates at 800×600, 1440×900 and 1920×1080.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
