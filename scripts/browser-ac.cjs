const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  const corner = 1 / (2 * Math.PI * 1000 * 1e-6);
  // Build the SCM using the application's own serializer, with a genuine AC source.
  const content = await page.evaluate(async cornerFrequency => {
    const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
    const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
    const sample = SAMPLE_CIRCUITS.find(item => item.id === 'rc-filter');
    const elements = sample.elements.map(e => e.type === 'V_DC' ? { ...e, type: 'V_AC', secondaryValue: 50, secondaryStr: '50' } : e);
    const ac = { fMin: cornerFrequency, fMax: cornerFrequency * 2, fMinStr: String(cornerFrequency), fMaxStr: String(cornerFrequency * 2), points: 2, scaleType: 'linear',
      signals: [{ id: 'db', plotIndex: 1, exprX: 'f', exprY: 'db(U(OUT)/U(IN))', color: '#2563eb', enabled: true },
        { id: 'phase', plotIndex: 2, exprX: 'f', exprY: 'phs(U(OUT)/U(IN))', color: '#dc2626', enabled: true }] };
    return exportToYamlScm(elements, sample.wires, sample.transient, ac);
  }, corner);
  await page.locator('input[type="file"]').setInputFiles({ name: 'ac-test.scm', mimeType: 'text/plain', buffer: Buffer.from(content) });
  await page.getByRole('button', { name: 'АЧХ/ФЧХ' }).click();
  await page.getByRole('dialog', { name: 'Результаты расчёта' }).waitFor({ timeout: 30000 });
  const graph = page.getByRole('dialog', { name: 'Результаты расчёта' });
  await page.getByRole('button', { name: 'Математический расчёт' }).waitFor();
  assert.match(await graph.innerText(), /db\(U\(OUT\)\/U\(IN\)\)/);
  assert.match(await graph.innerText(), /phs\(U\(OUT\)\/U\(IN\)\)/);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTitle('Экспортировать точки осциллограмм в CSV').click()]);
  const rows = (await fs.readFile(await csv.path(), 'utf8')).trim().split(/\r?\n/);
  assert.match(rows[0], /^Frequency \(Hz\)/);
  const first = rows[1].split(',').map(Number);
  assert.ok(Math.abs(first[1] - 20 * Math.log10(Math.SQRT1_2)) < 1e-7, 'RC -3dB point');
  assert.ok(Math.abs(first[2] + 45) < 1e-7, 'RC -45 degree point');
  await page.getByRole('button', { name: 'Математический расчёт' }).click();
  assert.match(await graph.innerText(), /Y = jωC/);
  assert.match(await graph.innerText(), /Комплексные потенциалы/);
  await page.getByRole('button', { name: 'Закрыть график' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить' }).click()]);
  const saved = await fs.readFile(await download.path(), 'utf8');
  assert.match(saved, /AC:\r?\n/);
  assert.match(saved, /db\(U\(OUT\)\/U\(IN\)\)/);
  assert.deepEqual(errors, []);
  console.log('PASS: AC SCM import, actual RC Bode plots, CSV values, calculation details and SCM export.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
