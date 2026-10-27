const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    async function properties(name) {
      const group = page.locator('[data-component-id]').filter({ has: page.locator('text[data-label-kind="name"]').filter({ hasText: new RegExp(`^${name}$`) }) });
      await group.waitFor({ state: 'visible' });
      const point = await group.evaluate(g => { if (!g.ownerSVGElement) throw new Error(JSON.stringify({tag:g.tagName,connected:g.isConnected,parent:g.parentElement?.outerHTML.slice(0,500)})); const p = g.ownerSVGElement.createSVGPoint(); const v = p.matrixTransform(g.getScreenCTM()); return { x: v.x, y: v.y }; });
      await page.mouse.dblclick(point.x, point.y);
      await page.locator('#element-name').waitFor();
    }
    async function save() {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
      return fs.readFile(await download.path(), 'utf8');
    }
    for (const crossingMode of ['explicit', 'connect']) for (const [type, gain, expected] of [['VCVS', 3, 6], ['VCCS', .5, -100], ['CCVS', 50, -1], ['CCCS', 2, 4]]) {
      const fixture = await page.evaluate(async ({ type, crossingMode }) => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const e = (id, type, value, x, y) => ({ id, name: id, type, value, valueStr: String(value), unit: '', x, y, rotation: 0 });
        const elements = [e('VIN', 'V_DC', 2, 200, 160), e('RIN', 'R', 100, 400, 160), e('DEP', type, 1, 200, 380), e('LOAD', 'R', 100, 400, 380), e('G0', 'GND', 0, 600, 260)];
        const w = (a, ap, b, bp) => ({ id: `${a}${ap}${b}${bp}`, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
        const wires = [w('VIN', '1', 'RIN', '1'), w('VIN', '2', 'G0', '1'), w('RIN', '2', 'G0', '1'), w('DEP', '1', 'LOAD', '1'), w('DEP', '2', 'G0', '1'), w('LOAD', '2', 'G0', '1')];
        const transient = { tMax: .002, tMaxStr: '.002', step: .001, stepStr: '.001', eps: .001, signals: [{ id: 'out', exprX: 't', exprY: 'U(LOAD)', enabled: true, color: '#000', plotIndex: 1 }] };
        return exportToYamlScm(elements, wires, transient, undefined, undefined, 'current', crossingMode);
      }, { type, crossingMode });
      await page.locator('input[type="file"]').setInputFiles({ name: `${type}-${crossingMode}.scm`, mimeType: 'text/plain', buffer: Buffer.from(fixture) });
      await properties('DEP');
      await page.locator('#element-value').fill(String(gain));
      if (type === 'VCVS' || type === 'VCCS') {
        await page.getByLabel('Способ выбора напряжения').selectOption('reference');
        for (const [label, prefix] of [['Положительный контакт', 'VIN:1'], ['Отрицательный контакт', 'G0:1']]) {
          const option = page.getByLabel(label).locator('option').filter({ hasText: prefix });
          await page.getByLabel(label).selectOption(await option.getAttribute('value'));
        }
      } else {
        const option = page.locator('#control-source option').filter({ hasText: 'I(VIN)' });
        await page.locator('#control-source').selectOption(await option.getAttribute('value'));
      }
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      await properties('VIN');
      await page.locator('#element-name').fill('CONTROL');
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      let text = await save();
      await page.locator('input[type="file"]').setInputFiles({ name: 'reopened.scm', mimeType: 'text/plain', buffer: Buffer.from(text) });
      await properties('DEP');
      assert.equal(await page.locator('#element-value').inputValue(), String(gain));
      if (type === 'VCVS' || type === 'VCCS') assert.match(await page.getByLabel('Положительный контакт').locator('option:checked').innerText(), /CONTROL:1/);
      else assert.match(await page.locator('#control-source option:checked').innerText(), /I\(CONTROL\)/);
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
      text = await save();
      const actual = await page.evaluate(async text => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { solveCircuitTransient } = await import('/src/math/circuitSolver.ts');
        const data = parseYamlScm(text);
        return solveCircuitTransient(data.elements, data.wires, data.transient).signals['U(LOAD)'][1];
      }, text);
      assert.ok(Math.abs(actual - expected) < 1e-7, `${type} ${crossingMode}: ${actual} != ${expected}`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: four controlled sources UI edit → rename → SCM 7/8 → reopen → calculation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
