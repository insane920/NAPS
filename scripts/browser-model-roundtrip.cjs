const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    async function open() { await page.locator('[data-component-id]').first().dblclick(); await page.locator('#element-name').waitFor(); }
    async function save() {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
      return fs.readFile(await download.path(), 'utf8');
    }
    const types = ['R', 'C', 'L', 'TR3', 'DIODE', 'THYRISTOR', 'SWITCH', 'NPN', 'PNP', 'NMOS', 'PMOS', 'OPAMP', 'V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'I_AC', 'I_PULSE', 'NOT', 'AND', 'OR', 'XOR', 'COMPARATOR', 'RS_FF', 'D_FF', 'JK_FF'];
    for (const crossingMode of ['explicit', 'connect']) for (const type of types) {
      console.log(`Properties round-trip: ${type}, ${crossingMode}`);
      const fixture = await page.evaluate(async ({ type, crossingMode }) => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        return exportToYamlScm([{ id: 'DUT', name: 'DUT', type, value: 1, valueStr: '1', unit: '', x: 300, y: 200, rotation: 0,
          ...(['R', 'C', 'L'].includes(type) ? { passiveModel: 'nonlinear', modelParams: { cubicCoefficient: .01 } } : {}),
        }], [], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', crossingMode);
      }, { type, crossingMode });
      await page.locator('input[type="file"]').setInputFiles({ name: `${type}.scm`, mimeType: 'text/plain', buffer: Buffer.from(fixture) });
      await open();
      const fields = {};
      for (const input of await page.locator('input[id^="model-"]').all()) {
        const id = await input.getAttribute('id');
        const old = Number(await input.inputValue());
        const value = id === 'model-couplingFactor' ? .8 : id === 'model-sourcePhaseDeg' ? 90 : old * 1.1;
        fields[id.slice(6)] = value;
        await input.fill(String(value));
      }
      if (await page.locator('#element-initial').count()) await page.locator('#element-initial').fill(['RS_FF', 'D_FF', 'JK_FF'].includes(type) ? '1' : '.125');
      if (await page.locator('#element-frequency').count()) await page.locator('#element-frequency').fill('100');
      if (await page.locator('#source-duty').count()) assert.equal(await page.locator('#source-duty').inputValue(), '0.5', 'editing an old pulse must preserve its implicit 50% duty');
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      await page.locator('#element-name').waitFor({ state: 'hidden' });
      let text = await save();
      await page.locator('input[type="file"]').setInputFiles({ name: 'roundtrip.scm', mimeType: 'text/plain', buffer: Buffer.from(text) });
      await open();
      for (const [key, value] of Object.entries(fields)) assert.equal(Number(await page.locator(`#model-${key}`).inputValue()), value, `${type}: ${key}`);
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
      text = await save();
      const stored = await page.evaluate(async text => (await import('/src/utils/yamlScm.ts')).parseYamlScm(text).elements[0], text);
      for (const [key, value] of Object.entries(fields)) assert.equal(stored.modelParams[key], value);
      if (['V_PULSE', 'I_PULSE'].includes(type)) assert.equal(stored.initialCondition, .5);
      if (['L', 'C', 'TR3'].includes(type)) assert.equal(stored.initialCondition, .125);
      if (['R', 'C', 'L', 'V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'I_AC', 'I_PULSE'].includes(type)) {
        const check = await page.evaluate(async ({ text, type }) => {
          const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
          const { solveCircuitTransient } = await import('/src/math/circuitSolver.ts');
          const dut = parseYamlScm(text).elements[0];
          const e = (id, type, value) => ({ id, name: id, type, value, valueStr: String(value), unit: '', x: 0, y: 0, rotation: 0 });
          const w = (a, ap, b, bp) => ({ id: a + ap + b + bp, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp });
          const passive = ['R', 'C', 'L'].includes(type);
          const drive = e('DRIVE', type === 'C' ? 'I_DC' : 'V_DC', type === 'R' ? 2 : type === 'C' ? -.1 : .5);
          const load = e('LOAD', 'R', 100);
          const ground = e('GROUND', 'GND', 0);
          const pair = passive ? [dut, drive] : [dut, load];
          const wires = [w(pair[0].id, '1', pair[1].id, '1'), w(pair[0].id, '2', pair[1].id, '2'), w(pair[0].id, '2', ground.id, '1')];
          const exprY = type === 'R' || type === 'L' || type.startsWith('I_') ? 'I(DUT)' : 'U(DUT)';
          const settings = { tMax: .002, tMaxStr: '.002', step: .001, stepStr: '.001', eps: .001, signals: [{ id: 'out', exprX: 't', exprY, enabled: true, color: '#000', plotIndex: 1 }] };
          const result = solveCircuitTransient([...pair, ground], wires, settings);
          if (type === 'C' || type === 'L') {
            const values = result.signals[exprY];
            // Independent charge/flux conservation, using the UI-entered 0.011 cubic coefficient.
            const law = x => x + .011 * x ** 3;
            return Math.max(...values.map((x, index) => Math.abs(law(x) - law(.125) - (type === 'C' ? .1 : .5) * result.time[index])));
          }
          return result.signals[exprY][0];
        }, { text, type });
        const expected = type === 'R' ? 2 + .011 * 8 : ['C', 'L'].includes(type) ? 0 : type.endsWith('PULSE') ? 1.1 : 1;
        assert.ok(Math.abs(check - expected) < 1e-7, `${type}: edited parameters must reach the actual solver (${check} vs ${expected})`);
      }
    }
    // Temporarily selecting the linear variant must not destroy the user's nonlinear law.
    const nonlinear = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      return exportToYamlScm([{ id: 'R', name: 'R', type: 'R', value: 1, valueStr: '1', unit: '', x: 300, y: 200, rotation: 0, passiveModel: 'nonlinear', passiveLawDefinition: { kind: 'expression', expression: 'n*x+y0*tanh(x/x0)', argumentScale: 2, outputScale: .1 } }], [], SAMPLE_CIRCUITS[0].transient);
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'law.scm', mimeType: 'text/plain', buffer: Buffer.from(nonlinear) });
    await open(); await page.locator('#passive-model').selectOption('linear');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.locator('#element-name').waitFor({ state: 'hidden' });
    const preserved = await save();
    await page.locator('input[type="file"]').setInputFiles({ name: 'linear.scm', mimeType: 'text/plain', buffer: Buffer.from(preserved) });
    await open(); await page.locator('#passive-model').selectOption('nonlinear');
    assert.equal(await page.locator('#passive-law').inputValue(), 'expression');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('PASS: 26 supported model property forms through SCM 7/8, pulse default, transformer IC and retained inactive nonlinear law.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
