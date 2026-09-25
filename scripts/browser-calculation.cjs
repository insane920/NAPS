const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Рассчитать схему' }).click();
  assert.match(await page.getByRole('alert').innerText(), /Добавьте элементы/);
  const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
  await page.getByRole('button', { name: 'Резистор' }).first().click();
  await page.mouse.click(canvas.x + 250, canvas.y + 180);
  await page.getByRole('button', { name: 'Рассчитать схему' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /землю GND/, 'incomplete circuit must report the missing reference');
  await page.getByRole('button', { name: 'Библиотека' }).click();
  assert.match(await page.locator('body').innerText(), /Двухполюсники/);
  await page.screenshot({ path: '.work/browser-library-900.png' });
  await page.getByRole('button', { name: 'Закрыть библиотеку' }).click();
  await page.getByRole('button', { name: 'Примеры' }).click();
  assert.match(await page.locator('body').innerText(), /ФНЧ 1-го порядка/);
  await page.screenshot({ path: '.work/browser-examples-900.png' });
  page.on('dialog', dialog => dialog.accept());
  await page.getByText('ФНЧ 1-го порядка (RC-фильтр)', { exact: true }).click();
  await page.getByRole('button', { name: 'Рассчитать схему' }).click();
  await page.getByRole('dialog', { name: 'Результаты расчёта' }).waitFor({ timeout: 30000 });
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTitle('Экспортировать точки осциллограмм в CSV').click(),
  ]);
  const csvText = await fs.readFile(await csv.path(), 'utf8');
  assert.ok(csvText.split(/\r?\n/).length > 100, 'CSV contains a signal table');
  assert.ok(Math.abs(Number(csvText.split(/\r?\n/)[2].split(',')[2]) - 0.009900990099009901) < 1e-12, 'CSV RC signal agrees with numerical reference');
  await page.getByRole('button', { name: 'Математический расчёт' }).click();
  const mathText = await page.getByRole('dialog', { name: 'Результаты расчёта' }).innerText();
  assert.match(mathText, /Система: строка 1/);
  assert.match(mathText, /0\.009900990099/);
  const [html] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать расчёт HTML' }).click(),
  ]);
  const htmlText = await fs.readFile(await html.path(), 'utf8');
  assert.match(htmlText, /<html/i);
  assert.match(htmlText, /Математический расчёт/);
  await page.screenshot({ path: '.work/browser-math-900.png' });
  const size = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth, viewport: innerWidth}));
  assert.ok(size.scroll <= size.viewport, '900px viewport has no horizontal page overflow');
  await page.getByRole('button', { name: 'Закрыть график' }).click();
  const { valid, rewired, malformed } = await page.evaluate(async () => {
    const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
    const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
    const sample = SAMPLE_CIRCUITS[0];
    const valid = exportToYamlScm(sample.elements, sample.wires, sample.transient);
    return {
      valid,
      rewired: exportToYamlScm(sample.elements, sample.wires.slice(1), sample.transient),
      malformed: valid.replace(/To:\s+\{ ID: \d+, Pin: (?:"[^"]+"|\d+) \}/, 'To: { ID: 999, Pin: "1" }'),
    };
  });
  const fileInput = page.locator('input[type="file"]');
  const beforeInvalidImport = await page.locator('#schematic-world > g[transform^="translate"]').count();
  await fileInput.setInputFiles({ name: 'invalid.scm', mimeType: 'text/plain', buffer: Buffer.from(malformed) });
  assert.match(await page.getByRole('alert').innerText(), /Провод 1.*не найден/);
  assert.equal(await page.locator('#schematic-world > g[transform^="translate"]').count(), beforeInvalidImport, 'failed import keeps the current project');
  await fileInput.setInputFiles({ name: 'rewired.scm', mimeType: 'text/plain', buffer: Buffer.from(rewired) });
  await page.getByRole('button', { name: 'Рассчитать схему' }).click();
  assert.match(await page.getByRole('alert').innerText(), /нелинейной схемы/);
  assert.equal(await page.getByRole('dialog', { name: 'Результаты расчёта' }).count(), 0, 'unsupported topology has no misleading graph');
  await fileInput.setInputFiles({ name: 'example.scm', mimeType: 'text/plain', buffer: Buffer.from(valid) });
  await page.getByRole('button', { name: 'Рассчитать схему' }).click();
  await page.getByRole('dialog', { name: 'Результаты расчёта' }).waitFor();
  assert.match(await page.getByRole('note').innerText(), /Учебная модель/);
  assert.equal(errors.length, 0);
  console.log('PASS: empty and incomplete circuits, SCM validation, nonlinear scope, RC graph, CSV and HTML report.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
