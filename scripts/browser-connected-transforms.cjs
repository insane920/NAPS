const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH
    ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [], dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const load = async (scm, name) => {
      await page.locator('input[type="file"]').setInputFiles({ name: `${name}.scm`, mimeType: 'text/plain', buffer: Buffer.from(scm) });
      await page.getByText(name, { exact: true }).waitFor();
      await page.keyboard.press('Escape');
    };
    const save = async () => {
      const [download] = await Promise.all([page.waitForEvent('download'),
        page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
      return fs.readFile(await download.path(), 'utf8');
    };
    const snapshot = scm => page.evaluate(async content => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(content);
      const names = new Map(parsed.elements.map(element => [element.id, element.name]));
      const graph = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      return { mode: parsed.crossingMode,
        elements: parsed.elements.map(({ name, x, y, rotation }) => ({ name, x, y, rotation })),
        wires: parsed.wires.map(wire => ({ from: [names.get(wire.fromCompId), wire.fromPinId],
          to: [names.get(wire.toCompId), wire.toPinId], waypoints: wire.waypoints ?? [] })),
        netCount: new Set(parsed.wires.map(wire => graph.get(`${wire.fromCompId}_${wire.fromPinId}`))).size };
    }, scm);
    const clickBody = async (index, modifier) => {
      const point = await page.locator('[data-component-id]').nth(index).evaluate(group =>
        ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f }));
      if (modifier) await page.keyboard.down(modifier);
      await page.mouse.click(point.x, point.y);
      if (modifier) await page.keyboard.up(modifier);
    };
    for (const mode of ['explicit', 'connect']) {
      const automatic = await page.evaluate(async mode => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        const base = { rotation: 0, value: 0, valueStr: '', unit: '' };
        const elements = [{ ...base, id: 'R', name: 'R', type: 'R', x: 300, y: 300, value: 1000, valueStr: '1к', unit: 'Ом' },
          { ...base, id: 'LEFT', name: 'LEFT', type: 'JUNCTION', x: 100, y: 300 },
          { ...base, id: 'RIGHT', name: 'RIGHT', type: 'JUNCTION', x: 500, y: 300 }];
        return exportToYamlScm(elements, [
          { id: 'left_wire', fromCompId: 'R', fromPinId: '1', toCompId: 'LEFT', toPinId: '1' },
          { id: 'right_wire', fromCompId: 'R', fromPinId: '2', toCompId: 'RIGHT', toPinId: '1' },
        ], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', mode);
      }, mode);
      await load(automatic, `all-angles-${mode}`);
      const before = await snapshot(await save());
      await clickBody(0);
      for (let turn = 1; turn <= 8; turn++) {
        await page.keyboard.press('Shift+r');
        const symbol = page.locator('[data-component-id]').first().locator('g[transform^="rotate("]');
        assert.match(await symbol.getAttribute('transform'), new RegExp(`^rotate\\(${turn * 45 % 360}\\)`),
          `${mode}: rotate to ${turn * 45 % 360} degrees`);
        assert.equal(await page.locator('[data-wire-id]').count(), 2, `${mode}: rotation does not create crossing fragments`);
        assert.equal(await page.locator('[data-wire-id] path[stroke="#dc2626"]').count(), 0, 'rotation finds safe routes');
      }
      const state = await snapshot(await save());
      assert.equal(state.netCount, 2, `${mode}: rotation never shorts the two terminals`);
      assert.deepEqual(state.wires.map(({ from, to }) => ({ from, to })), before.wires.map(({ from, to }) => ({ from, to })),
        `${mode}: both wires stay on their original pins`);
      await page.keyboard.press('Control+z');
      assert.equal((await snapshot(await save())).elements[0].rotation, 315, 'one undo reverses one rotation');
      await page.keyboard.press('Control+y');
      const rotatedSCM = await save();
      await load(rotatedSCM, `rotated-reopen-${mode}`);
      assert.deepEqual(await snapshot(await save()), before, 'full rotation and SCM reload preserve geometry and topology');

      const manual = await page.evaluate(async mode => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        const elements = [100, 500].map((x, index) => ({ id: `R${index + 1}`, name: `R${index + 1}`, type: 'R',
          x, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' }));
        return exportToYamlScm(elements, [{ id: 'manual', fromCompId: 'R1', fromPinId: '2',
          toCompId: 'R2', toPinId: '2', manual: true, routeMode: 'direct', waypoints: [{ x: 700, y: 400 }] }],
          SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', mode);
      }, mode);
      await load(manual, `group-bend-${mode}`);
      const original = await snapshot(await save());
      await clickBody(0); await clickBody(1, 'Shift');
      await page.keyboard.press('Shift+r');
      const transformed = await snapshot(await save());
      assert.deepEqual(transformed.elements.map(element => element.rotation), [45, 45]);
      // Pin coordinates are rounded to 0.001 world units by getComponentPins.
      assert.equal(transformed.wires[0].waypoints.length, 1);
      assert(Math.hypot(transformed.wires[0].waypoints[0].x - 691.213,
        transformed.wires[0].waypoints[0].y - 421.213) < 1e-9,
        `${mode}: a shared bend moves once, not once per selected component`);
      assert.equal(transformed.netCount, 1);
      await page.keyboard.press('Control+z');
      assert.deepEqual(await snapshot(await save()), original, 'group rotation and bends are one undo');
      await page.keyboard.press('Control+y');
      assert.deepEqual(await snapshot(await save()), transformed, 'redo restores group rotation and bends');
      await load(await save(), `group-reopen-${mode}`);
      assert.deepEqual(await snapshot(await save()), transformed, 'manual bend survives save and reload');
    }
    assert.deepEqual(dialogs, [], 'valid transforms must not show routing errors');
    assert.deepEqual(errors, []);
    console.log('PASS: all eight terminal rotations, separate networks, group manual bend, atomic Undo/Redo and SCM 7/8 reload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
