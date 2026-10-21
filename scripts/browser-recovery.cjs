const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    await page.getByRole('button', { name: 'Резистор', exact: true }).first().click();
    await page.mouse.click(canvas.x + 300, canvas.y + 200);
    const transform = await page.locator('[data-component-id]').first().getAttribute('transform');
    await page.waitForFunction(() => localStorage.getItem('naps.recovery.v1'));
    const saved = await page.evaluate(() => localStorage.getItem('naps.recovery.v1'));
    page.on('dialog', dialog => dialog.accept());
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Восстановить схему' }).waitFor();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => localStorage.getItem('naps.recovery.v1')), saved, 'startup must not overwrite the offered copy with an empty project');
    await page.getByRole('button', { name: 'Восстановить схему' }).click();
    assert.equal(await page.locator('[data-component-id]').first().getAttribute('transform'), transform);
    assert.equal(await page.locator('.unsaved-dot').count(), 1, 'restored copy remains unsaved until written to file');
    await page.waitForTimeout(1000);
    await page.evaluate(() => localStorage.setItem('naps.recovery.v1', '{corrupt'));
    // Close without pagehide overwriting the deliberately damaged slot.
    const second = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const data = saved;
    await second.addInitScript(({ data }) => {
      localStorage.setItem('naps.recovery.v1', '{corrupt');
      localStorage.setItem('naps.recovery.v1.previous', data);
    }, { data });
    await second.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    await second.getByRole('button', { name: 'Восстановить схему' }).click();
    assert.equal(await second.locator('[data-component-id]').first().getAttribute('transform'), transform);
    console.log('PASS: recovery after reload, preserved geometry, unsaved status, corrupt-latest fallback.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
