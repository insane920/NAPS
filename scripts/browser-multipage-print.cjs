const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const zlib = require('node:zlib');

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
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const resistor = (id, x) => ({ id, type: 'R', name: id, x, y: 200, rotation: 0, value: 100,
        valueStr: '100', unit: 'Ом' });
      return exportToYamlScm([resistor('R1', 200), resistor('R2', 1600)], [], SAMPLE_CIRCUITS[0].transient,
        undefined, { format: 'A4', orientation: 'portrait', gridMm: 5 });
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'wide-print.scm',
      mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.getByRole('button', { name: 'Экспорт ▾' }).click();
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    const dialog = page.getByRole('dialog', { name: 'Настройки печати и экспорта' });
    await dialog.getByRole('checkbox', { name: 'Рамка и основная надпись' }).uncheck();
    await dialog.getByRole('combobox', { name: 'Формат листа' }).selectOption('A4');
    await dialog.getByRole('combobox', { name: 'Ориентация листа' }).selectOption('portrait');
    await dialog.getByRole('combobox', { name: 'Режим масштабирования печати' }).selectOption('actual');
    await dialog.getByRole('combobox', { name: 'Масштаб печати' }).selectOption('1');
    await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="Настройки печати и экспорта"] button') !== null);
    assert.equal(await dialog.getByRole('button', { name: 'Скачать PDF' }).isDisabled(), true,
      'oversized 1:1 drawing cannot silently crop a single-page PDF');
    await dialog.getByRole('checkbox', { name: 'Разместить на нескольких листах' }).check();
    await page.waitForFunction(() => document.querySelector('iframe[title="Предварительный просмотр листа"]')
      ?.getAttribute('srcdoc')?.match(/data-page-column=/g)?.length === 2);
    assert.match(await dialog.innerText(), /2 листов/);
    const preview = await page.getByTitle('Предварительный просмотр листа').getAttribute('srcdoc');
    assert.match(preview, /data-label-kind="name"/, 'the source document contains component designations');
    const visibleLabel = await page.getByTitle('Предварительный просмотр листа').evaluate(frame => {
      const label = frame.contentDocument?.querySelector('[data-label-kind="name"]');
      const svg = label?.closest('svg');
      const rect = label?.getBoundingClientRect();
      const pageRect = svg?.getBoundingClientRect();
      return label && rect && pageRect ? { text: label.textContent, x: rect.x - pageRect.x,
        y: rect.y - pageRect.y, width: rect.width, height: rect.height } : null;
    });
    assert.ok(visibleLabel?.width > 0 && visibleLabel?.height > 0, 'preview renders a measurable component designation');
    const transforms = await page.getByTitle('Предварительный просмотр листа').evaluate(frame => {
      const doc = new DOMParser().parseFromString(frame.getAttribute('srcdoc'), 'text/html');
      return [...doc.querySelectorAll('svg #schematic-world')].map(node => node.getAttribute('transform'));
    });
    assert.equal(transforms.length, 2);
    assert.notEqual(transforms[0], transforms[1], 'pages use different origins for one unchanged world model');
    assert.equal((preview.match(/data-print-margin-mask="true"/g) || []).length, 8,
      'each sheet masks ink outside its printable rectangle without clipping vector text');
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Скачать PDF' }).click()]);
    const pdfBytes = await fs.readFile(await download.path());
    if (process.env.NAPS_CAPTURE_PDF_PATH) await fs.writeFile(process.env.NAPS_CAPTURE_PDF_PATH, pdfBytes);
    const pdf = pdfBytes.toString('latin1');
    assert.equal((pdf.match(/\/Type\s*\/Page\b/g) || []).length, 2, 'vector PDF has two physical pages');
    assert.equal((pdf.match(/\/MediaBox \[0 0 595\.275[0-9]* 841\.889[0-9]*\]/g) || []).length, 2);
    assert.doesNotMatch(pdf, /\/Subtype\s*\/Image/, 'both PDF sheets remain vector-based');
    const pageCommands = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
      const raw = Buffer.from(match[1], 'latin1');
      try { return zlib.inflateSync(raw).toString('latin1'); } catch { return ''; }
    }).filter(stream => stream.includes('BT'));
    assert.equal(pageCommands.length, 2, 'both pages contain extractable vector text');
    assert.ok(pageCommands.every(stream => (stream.match(/\bTj\b/g) || []).length >= 4));
    assert.ok(pageCommands.every(stream => !/\b2 Tr\b/.test(stream)),
      'component designations must not be painted with a thick white text stroke');
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await page.getByRole('button', { name: 'Экспорт ▾' }).click();
    await page.getByRole('menuitem', { name: 'Печать' }).click();
    const printDialog = page.getByRole('dialog', { name: 'Настройки печати и экспорта' });
    await page.waitForFunction(() => document.querySelector('iframe[title="Предварительный просмотр листа"]')
      ?.getAttribute('srcdoc')?.match(/data-page-column=/g)?.length === 2);
    assert.equal(await printDialog.getByRole('button', { name: 'Печать…' }).isDisabled(), false,
      'the same multi-page preview is printable');
    assert.deepEqual(errors, []);
    console.log('PASS: oversized drawing tiles across two 1:1 A4 vector PDF pages and print preview.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
