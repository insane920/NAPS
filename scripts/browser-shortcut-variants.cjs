const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Общие настройки', exact: true }).click();
    await page.getByRole('button', { name: 'Настроить горячие клавиши', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Горячие клавиши', exact: true });
    const names = ['Резистор (R)', 'Конденсатор (C)', 'Индуктивность (L)', 'Источник DC (U_dc)', 'Источник тока (I_dc)'];
    async function assign(name, combination) {
      const button = settings.getByRole('button', { name: `Назначить: ${name}`, exact: true });
      await button.click(); await page.keyboard.press(combination);
    }
    await assign(names[0], 'Control+Alt+1');
    await assign(names[1], 'Control+Alt+1');
    assert.match(await settings.getByRole('status').innerText(), /Уже назначено/);
    const recording = settings.getByRole('button', { name: `Назначить: ${names[1]}`, exact: true });
    await recording.dispatchEvent('keydown', { code: 'KeyW', key: 'w', ctrlKey: true, bubbles: true, cancelable: true });
    assert.match(await settings.getByRole('status').innerText(), /уже используется/);
    await page.keyboard.press('Escape');
    await assign('Повернуть выбранный элемент', 'Alt+r');
    await assign(names[1], 'Alt+Shift+r');
    assert.match(await settings.getByRole('status').innerText(), /Уже назначено/, 'rotation also reserves its shifted 45° combination');
    await page.keyboard.press('Escape');
    for (let index = 1; index < names.length; index++) await assign(names[index], `Control+Alt+${index + 1}`);
    await page.keyboard.press('Escape');
    await settings.waitFor({ state: 'hidden' });
    let count = 0;
    async function place() {
      const box = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
      const x = box.x + 110 + (count % 8) * 130, y = box.y + 80 + Math.floor(count / 8) * 110;
      await page.mouse.move(x, y);
      assert.match(await page.locator('[data-placement-preview]').getAttribute('transform'), /rotate\(135\)/, 'preview keeps the selected angle across variant changes');
      await page.mouse.click(x, y); count++;
      assert.equal(await page.locator('[data-component-id]').count(), count, 'repeated placement adds exactly one object per click');
    }
    const expected = [];
    for (const [index, type] of ['R', 'C', 'L', 'V_DC', 'I_DC'].entries()) {
      await page.keyboard.press(`Control+Alt+${index + 1}`);
      await page.keyboard.press('Alt+r'); await page.keyboard.press('Alt+Shift+r');
      if (index < 3) {
        for (const passiveModel of ['linear', 'nonlinear']) {
          const select = page.getByLabel('Вариант размещаемого элемента');
          if ((await select.inputValue()) !== passiveModel) await page.mouse.wheel(0, 100);
          assert.equal(await select.inputValue(), passiveModel);
          for (let repeated = 0; repeated < 2; repeated++) { await place(); expected.push({ type, passiveModel }); }
        }
      } else {
        const types = index === 3 ? ['V_DC', 'V_AC', 'V_PULSE', 'VCVS', 'CCVS'] : ['I_DC', 'I_AC', 'I_PULSE', 'VCCS', 'CCCS'];
        for (const variant of types) {
          const select = page.getByLabel('Вариант размещаемого источника');
          if ((await select.inputValue()) !== variant) await page.mouse.wheel(0, 100);
          assert.equal(await select.inputValue(), variant);
          for (let repeated = 0; repeated < 2; repeated++) { await place(); expected.push({ type: variant }); }
        }
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-placement-preview]').count(), 0);
    }
    await page.keyboard.press('Control+Alt+1');
    await page.keyboard.press('Alt+r'); await page.keyboard.press('Alt+Shift+r');
    for (let repeated = 0; repeated < 5; repeated++) { await place(); expected.push({ type: 'R', passiveModel: 'nonlinear' }); }
    await page.keyboard.press('Escape');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const text = await fs.readFile(await download.path(), 'utf8');
    const actual = await page.evaluate(async text => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { getCircuitPinIds } = await import('/src/math/circuitSolver.ts');
      return parseYamlScm(text).elements.map(e => ({ type: e.type, ...(e.passiveModel ? { passiveModel: e.passiveModel } : {}), rotation: e.rotation, pins: getCircuitPinIds(e.type, e).length }));
    }, text);
    assert.deepEqual(actual, expected.map(element => ({ ...element, rotation: 135, pins: 2 })));
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('naps_editor_shortcuts')));
    for (const [index, type] of ['R', 'C', 'L', 'V_DC', 'I_DC'].entries()) assert.equal(persisted[`component:${type}`], `Ctrl+Alt+Digit${index + 1}`);
    assert.deepEqual(errors, []);
    console.log('PASS: remapped keys, conflicts and reserved window actions; all source/passive variants by wheel, ghost rotations and repeated placement.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
