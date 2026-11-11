const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fontMetric = await page.evaluate(async () => {
      await document.fonts.load('100px "NAPS Drafting"');
      const context = document.createElement('canvas').getContext('2d');
      context.font = '100px "NAPS Drafting"';
      const metric = context.measureText('Н');
      context.font = 'bold 100px "NAPS Drafting"';
      const bold = context.measureText('Н');
      return { capHeight: metric.actualBoundingBoxAscent, descent: metric.actualBoundingBoxDescent, width: metric.width, boldCapHeight: bold.actualBoundingBoxAscent };
    });
    assert.equal(fontMetric.capHeight, 64);
    assert.equal(fontMetric.boldCapHeight, 66);
    await page.getByRole('button', { name: 'Резистор', exact: true }).first().click();
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    await page.mouse.click(canvas.x + 260, canvas.y + 180);
    await page.keyboard.press('Escape');
    const labelFontSize = Number(await page.locator('[data-label-kind="name"]').first().getAttribute('font-size'));
    assert.ok(Math.abs(labelFontSize * fontMetric.boldCapHeight / 100 / 4 - 2.5) < 0.05,
      'default designation has the 2.5 mm standard capital height');
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
      if (format === 'A4' && orientation === 'portrait') {
        await page.frameLocator('iframe[title="Предварительный просмотр листа"]').locator('[data-eskd-title-block]')
          .screenshot({ path: '.work/print-a4-title-block.png' });
        const textSize = await page.evaluate(() => {
          const html = document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc') || '';
          const field = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-eskd-field="revision"]');
          return Number(field?.getAttribute('font-size'));
        });
        assert.ok(Math.abs(textSize * fontMetric.capHeight / 100 / 4 - 2.5) < 0.05,
          'title block labels have 2.5 mm physical capital height');
        const upperCellsMm = await page.evaluate(() => {
          const html = document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc') || '';
          const block = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-eskd-title-block]');
          return [...block.querySelectorAll('line')].filter(line => line.getAttribute('y1') === '60' &&
            line.getAttribute('y2') === '140' && line.getAttribute('x1') === line.getAttribute('x2'))
            .map(line => Number(line.getAttribute('x1')) / 4).sort((a, b) => a - b);
        });
        assert.deepEqual(upperCellsMm, [140, 145, 150, 167],
          'Form 1 reserves three 5 mm letter cells, 17 mm mass and 18 mm scale cells');
        const bottomFields = await page.evaluate(() => {
          const html = document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc') || '';
          const block = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-eskd-title-block]');
          const lines = [...block.querySelectorAll('line')].map(line => [Number(line.getAttribute('x1')) / 4,
            Number(line.getAttribute('y1')) / 4, Number(line.getAttribute('x2')) / 4,
            Number(line.getAttribute('y2')) / 4]);
          return { split: lines.some(line => line.join(',') === '155,35,155,55'),
            stray: lines.some(line => line.join(',') === '135,45,185,45') };
        });
        assert.deepEqual(bottomFields, { split: true, stray: false },
          'Form 1 keeps the sheet-number and sheet-count columns through the 15 mm value row');
        const organization = await page.evaluate(async () => {
          const { createTitleBlock } = await import('/src/utils/eskdTitleBlock.ts');
          const block = createTitleBlock(document, { format: 'A4', orientation: 'portrait' },
            { title: 'Схема', purpose: '', comment: '', organization: 'СПбГУТ' }, '1:1');
          const field = block.querySelector('[data-eskd-field="organization"]');
          return { x: Number(field.getAttribute('x')) / 4, y: Number(field.getAttribute('y')) / 4 };
        });
        assert.deepEqual(organization, { x: 67, y: 49 },
          'organization is placed in central field (3), not in the sheet number cells');
        const footer = await page.evaluate(() => {
          const html = document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc') || '';
          const block = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-eskd-title-block]');
          return ['copier', 'paper-format'].map(field => {
            const text = block.querySelector(`[data-eskd-field="${field}"]`);
            return { field, x: Number(text?.getAttribute('x')) / 4, y: Number(text?.getAttribute('y')) / 4 };
          });
        });
        assert.deepEqual(footer, [{ field: 'copier', x: 83, y: 58.5 }, { field: 'paper-format', x: 151, y: 58.5 }],
          'Form 1 supplementary fields 31/32 occupy the physical 5 mm lower strip');
        const singleSheetCount = await page.evaluate(() => {
          const html = document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc') || '';
          return new DOMParser().parseFromString(html, 'text/html').querySelector('[data-eskd-field="sheet-count"]')?.textContent;
        });
        assert.equal(singleSheetCount, '1', 'a single exported sheet has a filled sheet-count field');
      }
      assert.equal(await dialog.getByRole('button', { name: 'Печать…' }).isDisabled(), false);
      assert.equal(await page.locator('[data-component-id]').first().getAttribute('transform'), original,
        'changing paper never moves the stored component');
      await dialog.getByRole('button', { name: 'Закрыть' }).click();
    }
    await page.getByRole('combobox', { name: 'Формат документа' }).selectOption('A4');
    await page.getByRole('combobox', { name: 'Ориентация документа' }).selectOption('portrait');
    await page.getByRole('button', { name: 'Экспорт ▾' }).click();
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    await page.waitForFunction(() => {
      const preview = document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc') || '';
      return preview.includes('width="210mm"') && preview.includes('data-component-symbol="R"');
    });
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать PDF' }).click()]);
    await fs.copyFile(await pdf.path(), '.work/print-a4-font.pdf');
    assert.deepEqual(errors, []);
    console.log('PASS: print preview A0–A4 in both orientations retains physical sheet sizes, frame, title block and SCM geometry.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
