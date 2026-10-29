const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [
        { id: 'A', name: 'A', type: 'R', value: 100, valueStr: '100', unit: 'Ом', x: 300, y: 240, rotation: 0 },
        { id: 'B', name: 'B', type: 'R', value: 200, valueStr: '200', unit: 'Ом', x: 600, y: 240, rotation: 0 },
      ];
      const wires = [{ id: 'AB', fromCompId: 'A', fromPinId: '2', toCompId: 'B', toPinId: '1', waypoints: [], manual: true }];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'context-actions.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    const element = page.locator('[data-component-id]').first();
    const componentId = await element.getAttribute('data-component-id');
    async function openMenu() {
      const screen = await element.evaluate(group => {
        const point = group.ownerSVGElement.createSVGPoint();
        const screen = point.matrixTransform(group.getScreenCTM());
        return { x: screen.x, y: screen.y };
      });
      await page.mouse.click(screen.x, screen.y, { button: 'right' });
      await page.getByRole('menu', { name: 'Действия с A' }).waitFor();
    }
    let lastDownload = 0;
    async function save() {
      const delay = 150 - (Date.now() - lastDownload);
      if (delay > 0) await page.waitForTimeout(delay);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Сохранить', exact: true }).click(),
      ]);
      lastDownload = Date.now();
      return fs.readFile(await download.path(), 'utf8');
    }
    async function model() {
      const scm = await save();
      return page.evaluate(async text => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const data = parseYamlScm(text);
        return {
          elements: data.elements.map(({ name, type, x, y, rotation, flipH, isolation, value }) => ({ name, type, x, y, rotation, flipH: !!flipH, isolation: isolation || null, value })),
          wires: data.wires.map(w => ({
            from: data.elements.find(e => e.id === w.fromCompId)?.name, fromPinId: w.fromPinId,
            to: data.elements.find(e => e.id === w.toCompId)?.name, toPinId: w.toPinId,
            waypoints: w.waypoints,
          })),
          nodeCount: buildCircuitGraph(data.elements, data.wires).nodeCount,
        };
      }, scm);
    }
    const original = await model();
    await openMenu();
    await page.getByRole('menuitem', { name: 'Поменять элемент…' }).click();
    await page.getByRole('button', { name: 'Конденсатор (C)' }).dblclick();
    const replaced = await model();
    assert.equal(await element.getAttribute('data-component-id'), componentId, 'replacement preserves the connected component identity');
    assert.equal(replaced.elements[0].type, 'C', 'replacement changes the chosen model');
    assert.equal(replaced.wires.length, original.wires.length, 'replacement keeps the attached wire');
    assert.deepEqual(replaced.wires[0].waypoints, original.wires[0].waypoints, 'replacement keeps the wire route');
    assert.equal(replaced.nodeCount, original.nodeCount, 'replacement keeps the electrical network');
    assert.ok(await element.locator('[stroke="#dc2626"]').count() > 0, 'the replacement remains selected');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await model(), original, 'Undo restores the original component and connection in one step');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await model(), replaced, 'Redo restores the replacement and connection');
    const saved = await save();
    await page.locator('input[type="file"]').setInputFiles({ name: 'context-actions-roundtrip.scm', mimeType: 'text/plain', buffer: Buffer.from(saved) });
    assert.deepEqual(await model(), replaced, 'SCM reopening retains the replacement and connection');
    for (const [menuLabel, verify] of [
      ['Повернуть по часовой ↻', state => assert.equal(state.elements[0].rotation, 90)],
      ['Повернуть против часовой ↺', state => assert.equal(state.elements[0].rotation, 270)],
      ['Повернуть на 45° ↻', state => assert.equal(state.elements[0].rotation, 45)],
      ['Повернуть на 45° ↺', state => assert.equal(state.elements[0].rotation, 315)],
      ['Поменять выводы местами', state => assert.equal(state.elements[0].flipH, true)],
      ['Изолировать: разрыв', state => assert.equal(state.elements[0].isolation, 'open')],
      ['Изолировать: замыкание', state => assert.equal(state.elements[0].isolation, 'short')],
    ]) {
      await page.locator('input[type="file"]').setInputFiles({ name: 'context-actions.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
      await openMenu();
      await page.getByRole('menuitem', { name: menuLabel, exact: true }).click();
      const changed = await model();
      verify(changed);
      assert.equal(changed.wires.length, 1, `${menuLabel}: connected wire remains`);
      assert.equal(changed.nodeCount, menuLabel === 'Изолировать: замыкание' ? original.nodeCount - 1 : original.nodeCount,
        `${menuLabel}: graph reflects the requested electrical state`);
      await page.keyboard.press('Control+z');
      assert.deepEqual(await model(), original, `${menuLabel}: Undo restores model and wire`);
      await page.keyboard.press('Control+y');
      assert.deepEqual(await model(), changed, `${menuLabel}: Redo restores model and wire`);
    }
    await openMenu();
    await page.getByRole('menuitem', { name: 'Участвует в расчёте' }).click();
    assert.equal((await model()).elements[0].isolation, null, 'normal mode clears isolation');
    await page.locator('input[type="file"]').setInputFiles({ name: 'context-actions.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await openMenu();
    await page.getByRole('menuitem', { name: 'Копировать' }).click();
    await openMenu();
    await page.getByRole('menuitem', { name: 'Вставить копию рядом' }).click();
    assert.equal((await model()).elements.length, 3, 'context copy/paste creates one additional component');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await model(), original, 'copy/paste Undo restores connected schematic');
    await page.locator('input[type="file"]').setInputFiles({ name: 'context-actions.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await openMenu();
    await page.getByRole('menuitem', { name: 'Свойства элемента…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Параметры: Сопротивление' });
    await dialog.locator('#element-value').fill('300');
    await dialog.getByRole('button', { name: 'OK' }).click();
    assert.equal((await model()).elements[0].value, 300, 'context properties update the connected model');
    await page.locator('input[type="file"]').setInputFiles({ name: 'context-actions.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await openMenu();
    await page.getByRole('menuitem', { name: 'Удалить' }).click();
    assert.equal((await model()).elements.length, 1, 'context delete removes the component');
    assert.equal((await model()).wires.length, 0, 'context delete removes its attached wire');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await model(), original, 'delete Undo restores the component and wire');
    assert.deepEqual(errors, []);
    console.log('PASS: all connected-element context commands, replacement selection, topology, Undo/Redo and SCM round-trip.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
