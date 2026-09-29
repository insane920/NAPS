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
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    for (const x of [220, 420, 620]) {
      await page.getByRole('button', { name: 'Резистор' }).first().click();
      await page.mouse.click(canvas.x + x, canvas.y + 200);
    }
    await page.locator('#schematic-world > g[transform^="translate"]').nth(1).click();
    await page.keyboard.press('Delete');
    await page.getByRole('button', { name: 'Резистор' }).first().click();
    await page.mouse.click(canvas.x + 820, canvas.y + 200);
    const names = (await page.locator('#schematic-world text').allTextContents()).filter(text => /^R\d+$/.test(text));
    assert.deepEqual(names, ['R1', 'R3', 'R4'], 'new name must not reuse R3 after deleting R2');

    await page.locator('#schematic-world > g[transform^="translate"]').last().dblclick();
    await page.locator('#element-value').fill('1кк');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    assert.match(await page.getByRole('alert').innerText(), /допустимой инженерной приставкой/);
    assert.equal(await page.getByRole('dialog', { name: /Параметры: Сопротивление/ }).count(), 1);
    await page.locator('#element-value').fill('2к');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить' }).click()]);
    const saved = await fs.readFile(await download.path(), 'utf8');
    assert.match(saved.slice(saved.indexOf('Name: "R4"')), /Value: "2000"/);

    await page.locator('#schematic-world > g[transform^="translate"]').nth(1).dblclick();
    await page.locator('#element-name').fill('R1');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    assert.match(await page.getByRole('alert').innerText(), /уже используется/);
    await page.getByRole('button', { name: 'Отмена' }).click();

    await page.getByRole('button', { name: /Библиотека/ }).first().click();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true, 'modal focus must not escape into the editor');
    await page.getByTitle('Закрыть библиотеку').click();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes('Библиотека')), true, 'focus returns to library opener');
    assert.deepEqual(errors, []);
    await page.close();

    const invalid = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await invalid.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    await invalid.getByRole('button', { name: 'Редактор файла схемы' }).click();
    const malformed = ['scm:', 'Objects:', '  - ID: 1', '    Type: R', '    Name: R1', '    X: wrong', '    Y: 100', 'Wires:', 'Analysis:', '  Transient:', '    EndTime: 10m', '    TimeStep: 1m'].join('\n');
    await invalid.getByRole('textbox', { name: 'Код схемы YAML' }).fill(malformed);
    await invalid.getByRole('button', { name: 'Применить схему из YAML' }).click();
    assert.match(await invalid.getByRole('dialog', { name: 'Редактор кода схемы' }).innerText(), /X элемента/);
    assert.equal(await invalid.locator('#schematic-world > g[transform^="translate"]').count(), 0, 'invalid SCM must not replace the project');
    await invalid.close();

    const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await fresh.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    await fresh.getByTitle('Параметры расчета (t_max, шаг)').click();
    assert.equal(await fresh.getByRole('dialog', { name: 'Параметры переходного процесса' }).locator('tbody tr').count(), 0, 'new projects must not inherit demo plot signals');
    await fresh.getByRole('button', { name: 'Отмена' }).click();
    const sampleName = await fresh.evaluate(async () => (await import('/src/data/sampleCircuits.ts')).SAMPLE_CIRCUITS[0].name);
    await fresh.getByTitle('Открыть готовую схему NAPS').hover();
    await fresh.getByRole('button', { name: new RegExp(sampleName) }).click();
    const sampleCount = await fresh.locator('#schematic-world > g[transform^="translate"]').count();
    assert.ok(sampleCount > 0, 'sample should contain elements');
    fresh.once('dialog', dialog => dialog.accept());
    await fresh.getByTitle('Очистить схему').click();
    assert.equal(await fresh.locator('#schematic-world > g[transform^="translate"]').count(), 0, 'clear removes sample elements');
    assert.match(await fresh.title(), /Новая схема/);
    await fresh.getByTitle('Параметры расчета (t_max, шаг)').click();
    assert.equal(await fresh.getByRole('dialog', { name: 'Параметры переходного процесса' }).locator('tbody tr').count(), 0, 'clear also removes sample plot signals');
    await fresh.getByRole('button', { name: 'Отмена' }).click();
    await fresh.getByRole('button', { name: 'Отменить', exact: true }).click();
    assert.equal(await fresh.locator('#schematic-world > g[transform^="translate"]').count(), sampleCount, 'undo restores the sample');
    assert.match(await fresh.title(), new RegExp(sampleName));
    await fresh.getByRole('button', { name: 'Повторить', exact: true }).click();
    assert.equal(await fresh.locator('#schematic-world > g[transform^="translate"]').count(), 0, 'redo clears the sample again');
    const scm = await fresh.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const element = (id, type, value) => ({ id, type, value, name: id, x: 100, y: 100, rotation: 0, valueStr: String(value), unit: '' });
      const wire = (a, ap, b, bp) => ({ id: a + ap + b + bp, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
      return exportToYamlScm(
        [element('V1', 'V_DC', 12), element('R1', 'R', 1000), element('G', 'GND', 0)],
        [wire('V1', '1', 'R1', '1'), wire('R1', '2', 'G', '1'), wire('V1', '2', 'G', '1')],
        { ...SAMPLE_CIRCUITS[0].transient, signals: [] },
      );
    });
    await fresh.getByRole('button', { name: 'Редактор файла схемы' }).click();
    await fresh.getByRole('textbox', { name: 'Код схемы YAML' }).fill(scm);
    await fresh.getByRole('button', { name: 'Применить схему из YAML' }).click();
    await fresh.getByRole('button', { name: 'Рассчитать схему' }).click();
    await fresh.getByRole('dialog', { name: 'Результаты расчёта' }).waitFor();
    assert.equal(await fresh.getByRole('alert').count(), 0, 'valid fresh circuit must calculate without demo expressions');
    await fresh.close();
    console.log('PASS: unique names, strict nominals and SCM, dialog focus, and fresh-project signals.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
