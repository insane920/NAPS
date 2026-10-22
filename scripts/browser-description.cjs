const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Описание' }).click();
    await page.getByRole('textbox', { name: 'Название схемы' }).fill('Фильтр RC');
    await page.getByRole('textbox', { name: 'Назначение' }).fill('Контроль АЧХ');
    await page.getByRole('textbox', { name: 'Комментарий' }).fill('Проверить с преподавателем');
    await page.getByRole('button', { name: 'Сохранить описание' }).click();
    await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
    const yaml = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
    assert.match(yaml, /Document:\n  Title: "Фильтр RC"\n  Purpose: "Контроль АЧХ"\n  Comment: "Проверить с преподавателем"/);
    await page.getByRole('dialog', { name: 'Редактор кода схемы' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
    const undone = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
    assert.doesNotMatch(undone, /Document:/);
    console.log('PASS: document description edits, SCM output and Undo.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
