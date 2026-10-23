const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Общие настройки' }).click();
    await page.getByRole('dialog', { name: 'Общие настройки редактора' }).getByLabel('Цвет: Элементы').fill('#123abc');
    await page.getByRole('button', { name: 'Готово' }).click();
    await page.getByRole('button', { name: 'Резистор', exact: true }).first().click();
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    await page.mouse.click(canvas.x + 260, canvas.y + 200);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-component-id] line').first().getAttribute('stroke'), '#123abc');
    await page.getByRole('slider', { name: 'Масштаб просмотра в процентах' }).fill('75');
    assert.equal(await page.getByText('3.00 px/мм').count(), 1);
    await page.getByRole('combobox', { name: 'Формат документа' }).selectOption('A3');
    await page.getByRole('combobox', { name: 'Ориентация документа' }).selectOption('portrait');
    await page.getByTitle('Вписать лист в окно').click();
    const fittedPercent = Number((await page.locator('[aria-label="Масштаб просмотра"] output').innerText()).replace('%', ''));
    assert.ok(fittedPercent > 0 && fittedPercent < 75, 'A3 page fit changes viewport zoom without changing the document');
    await page.getByTitle('По ширине листа').click();
    const widthPercent = Number((await page.locator('[aria-label="Масштаб просмотра"] output').innerText()).replace('%', ''));
    assert.ok(widthPercent > fittedPercent, 'width fit uses more of the viewport than full-sheet fit');
    const componentScreen = () => page.locator('[data-component-id]').first().evaluate(group => ({
      x: group.getScreenCTM().e, y: group.getScreenCTM().f,
    }));
    const beforeScroll = await componentScreen();
    await page.getByLabel('Горизонтальная прокрутка схемы').evaluate(element => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); element.scrollLeft += 100;
    });
    await page.waitForTimeout(100);
    const afterHorizontal = await componentScreen();
    assert.ok(Math.abs(afterHorizontal.x - beforeScroll.x + 100) < 2, 'horizontal scrollbar pans the viewport');
    await page.getByLabel('Вертикальная прокрутка схемы').evaluate(element => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); element.scrollTop += 80;
    });
    await page.waitForTimeout(100);
    const afterVertical = await componentScreen();
    assert.ok(Math.abs(afterVertical.y - beforeScroll.y + 80) < 2, 'vertical scrollbar pans the viewport');
    assert.equal(widthPercent, Number((await page.locator('[aria-label="Масштаб просмотра"] output').innerText()).replace('%', '')),
      'scrolling does not change document scale');
    await page.getByTitle('Параметры расчета (t_max, шаг)').click();
    const transientPanel = page.getByRole('dialog', { name: 'Параметры переходного процесса' });
    assert.equal(await transientPanel.getAttribute('aria-modal'), null);
    assert.ok((await transientPanel.boundingBox()).x > 700, 'transient settings are docked on the right');
    await transientPanel.getByRole('button', { name: 'Закрыть параметры расчёта' }).click();
    await page.getByRole('button', { name: 'Параметры частотного анализа' }).click();
    const acPanel = page.getByRole('dialog', { name: 'Частотный анализ' });
    assert.equal(await acPanel.getAttribute('aria-modal'), null);
    assert.ok((await acPanel.boundingBox()).x > 700, 'AC settings are docked on the right');
    await acPanel.getByRole('button', { name: 'Закрыть' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const scm = await fs.readFile(await download.path(), 'utf8');
    assert.match(scm, /Page:\n  Format: A3\n  Orientation: portrait/);
    await page.getByRole('button', { name: 'Экспорт ▾' }).click();
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    const preview = await page.getByTitle('Предварительный просмотр листа').getAttribute('srcdoc');
    assert.match(preview, /data-eskd-frame="true"/);
    assert.match(preview, /data-eskd-title-block="true"/);
    assert.match(preview, /data-width-mm="185"/);
    assert.match(preview, /data-height-mm="55"/);
    assert.match(preview, /#111111/);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('combobox', { name: 'Формат документа' }).selectOption('A4');
    await page.getByRole('button', { name: 'Экспорт ▾' }).click();
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    const a4Preview = await page.getByTitle('Предварительный просмотр листа').getAttribute('srcdoc');
    assert.match(a4Preview, /data-eskd-title-block="true"/);
    assert.match(a4Preview, /data-eskd-frame="true"/);
    assert.match(a4Preview, /#111111/);
    assert.match(a4Preview, /width="210mm"/);
    assert.match(a4Preview, /height="297mm"/);
    assert.match(a4Preview, /font-family:'NAPS Drafting'/);
    assert.match(a4Preview, /data:font\/ttf;base64,/, 'standalone export embeds the licensed drafting font');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('combobox', { name: 'Ориентация документа' }).selectOption('landscape');
    await page.getByRole('button', { name: 'Экспорт ▾' }).click();
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    const landscapePreview = await page.getByTitle('Предварительный просмотр листа').getAttribute('srcdoc');
    assert.match(landscapePreview, /data-width-mm="55"/);
    assert.match(landscapePreview, /data-height-mm="185"/);
    assert.match(landscapePreview, /data-rotation="90"/);
    assert.match(landscapePreview, /data-eskd-field="scale"/);
    assert.match(landscapePreview, /<rect x="-20" y="-8" width="40" height="16"/,
      'the 10 × 4 mm resistor body is exported at physical size');
    const [pdfDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать PDF' }).click()]);
    const pdf = await fs.readFile(await pdfDownload.path());
    if (process.env.NAPS_CAPTURE_PDF_PATH) await fs.writeFile(process.env.NAPS_CAPTURE_PDF_PATH, pdf);
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 841\.889[0-9]* 595\.275[0-9]*\]/,
      'A4 landscape PDF retains physical MediaBox dimensions');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Общие настройки' }).click();
    assert.equal(await page.getByRole('dialog', { name: 'Общие настройки редактора' }).getByLabel('Цвет: Элементы').inputValue(), '#123abc');
    console.log('PASS: appearance persistence, A3 portrait SCM, sheet zoom, zoom px/mm and monochrome ESKD export preview.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
