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
    await page.getByRole('textbox', { name: 'Литера' }).fill('О1');
    await page.getByRole('textbox', { name: 'Масса' }).fill('2 кг');
    await page.getByRole('textbox', { name: 'Копировал' }).fill('Петров П. П.');
    await page.getByRole('textbox', { name: 'Разработал' }).fill('Шевчук В. Р.');
    await page.getByRole('textbox', { name: 'Технический контроль' }).fill('Иванов И. И.');
    await page.getByRole('button', { name: 'Сохранить описание' }).click();
    await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] textarea')?.value.includes('Document:'), null, { timeout: 5000 });
    const yaml = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
    assert.match(yaml, /Document:\n  Title: "Фильтр RC"\n  Purpose: "Контроль АЧХ"\n  Comment: "Проверить с преподавателем"/);
    assert.match(yaml, /Designation: "NAPS-Э3-001"/);
    assert.match(yaml, /Letter: "О1"/);
    assert.match(yaml, /Mass: "2 кг"/);
    assert.match(yaml, /Copier: "Петров П\. П\."/);
    assert.match(yaml, /Author: "Шевчук В\. Р\."/);
    assert.match(yaml, /TechnicalController: "Иванов И\. И\."/);
    await page.getByRole('dialog', { name: 'Редактор кода схемы' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
    const undone = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
    assert.doesNotMatch(undone, /Document:/);
    await page.getByRole('dialog', { name: 'Редактор кода схемы' }).getByRole('button').first().click();
    await page.locator('input[type=file]').setInputFiles({ name: 'title-block.scm', mimeType: 'text/plain', buffer: Buffer.from(yaml) });
    await page.getByRole('button', { name: 'Описание' }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Технический контроль' }).inputValue(), 'Иванов И. И.');
    assert.equal(await page.getByRole('textbox', { name: 'Литера' }).inputValue(), 'О1');
    assert.equal(await page.getByRole('textbox', { name: 'Масса' }).inputValue(), '2 кг');
    assert.equal(await page.getByRole('textbox', { name: 'Копировал' }).inputValue(), 'Петров П. П.');
    await page.getByRole('button', { name: 'Отмена' }).click();
    await page.getByRole('combobox', { name: 'Ориентация документа' }).selectOption('portrait');
    await page.getByRole('button', { name: 'Экспорт ▾' }).click();
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    await page.waitForFunction(() => document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc')?.includes('data-eskd-title-block="true"'));
    const printedFields = await page.getByTitle('Предварительный просмотр листа').evaluate(frame => {
      const doc = new DOMParser().parseFromString(frame.getAttribute('srcdoc'), 'text/html');
      return { controller: doc.querySelector('[data-eskd-field="technical-controller"]')?.textContent,
        firstLetter: doc.querySelector('[data-eskd-field="letter-1"]')?.textContent,
        secondLetter: doc.querySelector('[data-eskd-field="letter-2"]')?.textContent,
        mass: doc.querySelector('[data-eskd-field="mass"]')?.textContent,
        copier: doc.querySelector('[data-eskd-field="copier"]')?.textContent,
        paperFormat: doc.querySelector('[data-eskd-field="paper-format"]')?.textContent,
        letterColumnsMm: ['letter-1', 'letter-2'].map(field => Number(doc.querySelector(`[data-eskd-field="${field}"]`)?.getAttribute('x')) / 4),
        massColumnMm: Number(doc.querySelector('[data-eskd-field="mass"]')?.getAttribute('x')) / 4 };
    });
    assert.deepEqual(printedFields, { controller: 'Иванов И. И.', firstLetter: 'О', secondLetter: '1', mass: '2 кг',
      copier: 'Копировал: Петров П. П.', paperFormat: 'Формат A4',
      letterColumnsMm: [136, 141], massColumnMm: 152 });
    await page.frameLocator('iframe[title="Предварительный просмотр листа"]').locator('[data-eskd-title-block]')
      .screenshot({ path: '.work/print-filled-title-block.png' });
    console.log('PASS: title block fields, SCM round-trip, Undo and PDF preview.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
