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
    await page.getByRole('textbox', { name: 'Обозначение документа' }).fill('NAPS-Э3-001');
    await page.getByRole('textbox', { name: 'Разработал' }).fill('Шевчук В. Р.');
    await page.getByRole('button', { name: 'Сохранить описание' }).click();
    await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] textarea')?.value.includes('Document:'), null, { timeout: 5000 });
    const yaml = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
    assert.match(yaml, /Document:\n  Title: "Фильтр RC"\n  Purpose: "Контроль АЧХ"\n  Comment: "Проверить с преподавателем"/);
    assert.match(yaml, /Designation: "NAPS-Э3-001"/);
    assert.match(yaml, /Author: "Шевчук В\. Р\."/);
    await page.getByRole('dialog', { name: 'Редактор кода схемы' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
    const undone = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
    assert.doesNotMatch(undone, /Document:/);
    console.log('PASS: document description edits, SCM output and Undo.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
