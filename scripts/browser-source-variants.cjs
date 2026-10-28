const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await page.addInitScript(() => localStorage.setItem('naps_editor_shortcuts', JSON.stringify({
      'component:NPN': 'Ctrl+Alt+KeyN', 'component:PORT': 'Ctrl+Alt+KeyP',
    })));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Общие настройки', exact: true }).click();
    await page.getByRole('button', { name: 'Настроить горячие клавиши', exact: true }).click();
    const shortcuts = page.getByRole('dialog', { name: 'Горячие клавиши', exact: true });
    assert.equal(await shortcuts.getByRole('button', { name: /Назначить: Транзистор NPN/ }).count(), 0,
      'hidden archive types are absent from the shortcut UI');
    assert.equal(await shortcuts.getByRole('button', { name: /Назначить: Порт/ }).count(), 0,
      'legacy PORT remains hidden from placement shortcuts');
    assert.equal(await shortcuts.getByRole('button', { name: /Назначить: Источник AC/ }).count(), 1,
      'active source variants retain their own configurable shortcuts');
    await shortcuts.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.keyboard.press('Control+Alt+n');
    assert.equal(await page.locator('[data-placement-preview]').count(), 0,
      'a saved shortcut for a hidden transistor cannot place it');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('naps_editor_shortcuts'))['component:NPN']),
      'Ctrl+Alt+KeyN', 'old hidden shortcut preferences survive for future restoration');
    await page.getByRole('button', { name: 'Библиотека...' }).click();
    assert.equal(await page.locator('.component-card').count(), 5, 'the library still shows five source/passive families');
    await page.getByTitle('Закрыть библиотеку').click();
    const family = page.getByRole('combobox', { name: 'Двухполюсники: выбрать элемент' });
    const waveform = page.getByRole('combobox', { name: 'Вариант размещаемого источника' });
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    await family.selectOption('V_DC');
    await page.mouse.move(canvas.x + 260, canvas.y + 180);
    await page.mouse.wheel(0, 100);
    assert.equal(await waveform.inputValue(), 'V_AC');
    await page.mouse.click(canvas.x + 260, canvas.y + 180);
    await page.mouse.wheel(0, 100);
    assert.equal(await waveform.inputValue(), 'V_PULSE');
    await page.mouse.click(canvas.x + 440, canvas.y + 180);
    await family.selectOption('I_DC');
    await page.mouse.move(canvas.x + 620, canvas.y + 180);
    await page.mouse.wheel(0, 100);
    assert.equal(await waveform.inputValue(), 'I_AC');
    await page.mouse.click(canvas.x + 620, canvas.y + 180);
    await waveform.selectOption('I_PULSE');
    await page.mouse.click(canvas.x + 800, canvas.y + 180);
    await page.keyboard.press('Escape');
    await family.selectOption('V_DC');
    const quick = await family.locator('..').locator('..').locator('button').boundingBox();
    await page.mouse.move(quick.x + quick.width / 2, quick.y + quick.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 940, canvas.y + 180, { steps: 5 });
    await page.mouse.wheel(0, 100);
    assert.equal(await waveform.inputValue(), 'V_AC', 'wheel also changes the source while dragging from the quick palette');
    await page.mouse.up();
    for (const [type, x, y] of [['VCVS', 240, 330], ['CCVS', 420, 330]]) {
      await waveform.selectOption(type);
      await page.mouse.click(canvas.x + x, canvas.y + y);
    }
    await family.selectOption('I_DC');
    for (const [type, x, y] of [['VCCS', 600, 330], ['CCCS', 780, 330]]) {
      await waveform.selectOption(type);
      await page.mouse.click(canvas.x + x, canvas.y + y);
    }
    await page.keyboard.press('Escape');
    await page.locator('[data-component-id]').nth(6).dblclick();
    const controlledProperties = page.getByRole('dialog', { name: 'Параметры: ИНУТ (CCVS)' });
    await controlledProperties.waitFor();
    assert.ok((await controlledProperties.locator('#control-source option').count()) >= 2,
      'current-controlled source offers actual independent voltage branches');
    await controlledProperties.getByRole('button', { name: 'Отмена' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const text = await fs.readFile(await download.path(), 'utf8');
    const types = await page.evaluate(async content => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { getCircuitPinIds } = await import('/src/math/circuitSolver.ts');
      const elements = parseYamlScm(content).elements;
      if (!elements.every(element => getCircuitPinIds(element.type, element).length === 2)) throw new Error('New source variants must remain two-terminal symbols');
      return elements.map(element => element.type);
    }, text);
    assert.deepEqual(types, ['V_AC', 'V_PULSE', 'I_AC', 'I_PULSE', 'V_AC', 'VCVS', 'CCVS', 'VCCS', 'CCCS']);
    console.log('PASS: five-family library, independent and controlled source variants and SCM persistence.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
