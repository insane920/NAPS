const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    for (const width of [800, 1440, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
      const viewButton = await page.getByRole('button', { name: 'Вид ▾', exact: true }).boundingBox();
      assert.ok(viewButton && viewButton.x >= 0 && viewButton.x + viewButton.width <= width + 1,
        'view controls remain inside the viewport at narrow and wide window sizes');
      const fixture = await page.evaluate(async () => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        const e = (id, type, x, y) => ({ id, name: id, type, value: 1, valueStr: '1', unit: '', x, y, rotation: 0 });
        return exportToYamlScm([e('U1', 'V_DC', 200, 160), e('I1', 'I_DC', 200, 340), e('R1', 'R', 500, 160), e('C1', 'C', 500, 340), e('L1', 'L', 200, 520)], [
          { id: 'one', fromCompId: 'U1', fromPinId: '2', toCompId: 'R1', toPinId: '1' },
        ], SAMPLE_CIRCUITS[0].transient);
      });
      async function load(text, name = 'view.scm') { await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) }); }
      async function save() {
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
        return fs.readFile(await download.path(), 'utf8');
      }
      async function toggle(name, state) {
        await page.getByRole('button', { name: 'Вид ▾', exact: true }).click();
        const item = page.getByRole('menuitemcheckbox', { name, exact: true });
        if ((await item.getAttribute('aria-checked')) !== String(state)) await item.click();
        await page.getByRole('button', { name: 'Вид ▾', exact: true }).click();
      }
      const state = text => page.evaluate(async text => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const data = parseYamlScm(text), graph = buildCircuitGraph(data.elements, data.wires);
        return { elements: data.elements.map(({ id, ...element }) => element), nodes: data.elements.map(e => [e.name, graph.pinToNode.get(`${e.id}_1`), graph.pinToNode.get(`${e.id}_2`)]),
          wires: data.wires.map(w => [data.elements.find(e => e.id === w.fromCompId).name, w.fromPinId, data.elements.find(e => e.id === w.toCompId).name, w.toPinId]) };
      }, text);
      await load(fixture);
      const before = await state(fixture);
      assert.equal(await page.locator('[data-pin-marker="positive"]').count(), 5, 'first terminal of every two-pole has a square marker');
      await toggle('Номера узлов', true);
      const numbers = await page.locator('[data-network-node]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-network-node')));
      assert.equal(numbers.length, 9, 'ten contacts and one connection form nine networks');
      assert.equal(new Set(numbers).size, numbers.length);
      assert.equal(await page.locator('[data-node-number-ring]').count(), 9);
      assert.equal(await page.locator('[data-label-collision]').count(), 0, 'control schematic annotations avoid symbols, labels and wires');
      for (const name of ['Обозначения', 'Номиналы', 'Номера узлов', 'Сетка', 'Полярность выводов']) await toggle(name, false);
      const hidden = await save();
      await load(hidden);
      assert.equal(await page.locator('[data-label-kind="name"], [data-label-kind="value"], [data-network-node], [data-pin-label], [data-pin-marker="positive"]').count(), 0);
      assert.equal(await page.locator('rect[fill="url(#naps_grid)"]').count(), 0);
      assert.deepEqual(await state(hidden), before, 'display switches must not change model, geometry or topology');
      for (const name of ['Обозначения', 'Номиналы', 'Номера узлов', 'Сетка', 'Полярность выводов']) await toggle(name, true);
      for (const mode of ['eskd', 'teacher']) {
        await page.getByRole('button', { name: 'Общие настройки', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Общие настройки редактора' });
        await page.keyboard.press('Shift+Tab');
        assert.equal(await settings.evaluate(node => node.contains(document.activeElement)), true, 'settings trap keyboard focus');
        await page.getByLabel('Режим оформления документа').selectOption(mode);
        if (width === 1440) await page.getByLabel('Цвет: Элементы').fill('#123abc');
        await page.keyboard.press('Escape');
        await settings.waitFor({ state: 'hidden' });
        assert.equal(await page.locator('[data-node-number-ring]').count(), mode === 'teacher' ? 9 : 0);
        assert.equal(await page.locator('[data-pin-marker="positive"]').count(), mode === 'teacher' ? 5 : 0);
        const text = await save();
        assert.match(text, new RegExp(`Presentation: ${mode}`));
        await load(text);
        assert.deepEqual(await state(text), before, 'presentation round-trip leaves circuit unchanged');
        await page.getByRole('button', { name: 'Экспорт ▾', exact: true }).click();
        await page.getByRole('menuitem', { name: 'SVG', exact: true }).click();
        const ringCount = await page.getByTitle('Предварительный просмотр листа').evaluate(frame => {
          const doc = new DOMParser().parseFromString(frame.getAttribute('srcdoc'), 'text/html');
          return doc.querySelectorAll('[data-node-number-ring]').length;
        });
        assert.equal(ringCount, mode === 'teacher' ? 9 : 0,
          'teacher-only circular network numbers follow the selected document mode into export');
        await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      }
      // Selection colour is never part of a colour SVG/PDF/PNG document.
      for (const type of ['V_DC', 'I_DC', 'R', 'C', 'L']) {
        const group = page.locator(`[data-component-id]:has([data-component-symbol="${type}"])`).first();
        const point = await group.evaluate(g => { const p = g.ownerSVGElement.createSVGPoint(); const v = p.matrixTransform(g.getScreenCTM()); return { x: v.x, y: v.y }; });
        await page.mouse.click(point.x, point.y);
        assert.ok(await group.locator('[stroke="#dc2626"]').count());
        assert.equal(await group.locator(':scope > rect[stroke="#dc2626"]').count(), 0,
          `${type}: selection changes symbol ink without drawing a frame around the component`);
        await page.getByRole('button', { name: 'Экспорт ▾', exact: true }).click();
        await page.getByRole('menuitem', { name: 'SVG', exact: true }).click();
        await page.getByLabel('Ч/б', { exact: true }).uncheck();
        await page.getByLabel('Режим масштабирования печати').selectOption('fit');
        await page.waitForFunction(colour => {
          const text = document.querySelector('iframe[title="Предварительный просмотр листа"]')?.getAttribute('srcdoc');
          return text && new DOMParser().parseFromString(text, 'text/html').querySelector(`[data-component-symbol] [stroke="${colour}"]`);
        }, width === 1440 ? '#123abc' : '#1d4ed8');
        const selectedInk = await page.getByTitle('Предварительный просмотр листа').evaluate(frame => {
          const doc = new DOMParser().parseFromString(frame.getAttribute('srcdoc'), 'text/html');
          return doc.querySelectorAll('[data-component-symbol] [stroke="#dc2626"], [data-component-symbol] [fill="#dc2626"]').length;
        });
        assert.equal(selectedInk, 0, `${type}: export strips editor selection colour`);
        await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      }
      if (width === 1440) {
        await page.getByRole('button', { name: 'Экспорт ▾', exact: true }).click();
        await page.getByRole('menuitem', { name: 'SVG', exact: true }).click();
        await page.getByLabel('Ч/б', { exact: true }).check();
        await page.waitForFunction(() => document.querySelector('iframe[title="Предварительный просмотр листа"]')
          ?.getAttribute('srcdoc')?.includes('data-component-symbol="L"'));
        const ink = await page.getByTitle('Предварительный просмотр листа').evaluate(frame => {
          const doc = new DOMParser().parseFromString(frame.getAttribute('srcdoc'), 'text/html');
          const types = ['V_DC', 'I_DC', 'R', 'C', 'L'];
          const symbols = types.map(type => doc.querySelector(`[data-component-symbol="${type}"]`));
          return { distinct: new Set(symbols.map(symbol => symbol?.innerHTML)).size,
            blackSymbols: symbols.map(symbol => symbol?.querySelectorAll('[stroke="#111111"]').length || 0),
            wireStroke: doc.querySelector('[data-wire-ink]')?.getAttribute('stroke') };
        });
        assert.equal(ink.distinct, 5, 'all five symbols retain distinct geometry in monochrome');
        assert.ok(ink.blackSymbols.every(count => count > 0), 'all five symbols retain visible dark outlines');
        assert.equal(ink.wireStroke, '#111111', 'conductors remain visible in monochrome');
        await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      }
      assert.equal(await page.getByRole('button', { name: 'Экспорт ▾', exact: true }).count(), 1);
      await page.getByTitle('Параметры расчета (t_max, шаг)').click();
      await page.getByRole('dialog', { name: 'Параметры переходного процесса' }).waitFor();
      await page.getByRole('button', { name: 'Параметры частотного анализа', exact: true }).click();
      assert.equal(await page.getByRole('dialog', { name: 'Параметры переходного процесса' }).count(), 0);
      await page.getByRole('dialog', { name: 'Частотный анализ', exact: true }).waitFor();
      await load(fixture, 'reload-with-analysis.scm');
      await page.getByRole('dialog', { name: 'Частотный анализ', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('dialog', { name: 'Частотный анализ', exact: true }).count(), 0, 'file load closes the old parameter draft');
      const long = await page.evaluate(async fixture => {
        const { parseYamlScm, exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const data = parseYamlScm(fixture); const r = data.elements.find(e => e.type === 'R');
        return exportToYamlScm([{ ...r, name: 'Длинное_обозначение_'.repeat(12), isolation: 'open' }], [], data.transient);
      }, fixture);
      await load(long, 'long.scm');
      await page.locator('[data-component-id]').first().dispatchEvent('mouseover');
      await page.waitForFunction(() => document.querySelector('.status-text')?.textContent?.includes('разрыв'));
      assert.match(await page.locator('.status-text').getAttribute('title'), /разрыв/);
      const status = await page.locator('.status-bar').boundingBox();
      assert.ok(status.x + status.width <= width + 1, 'long hover text does not push the status bar outside the viewport');
      const empty = await page.evaluate(async fixture => {
        const { parseYamlScm, exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        return exportToYamlScm([], [], parseYamlScm(fixture).transient);
      }, fixture);
      await load(empty, 'empty.scm');
      assert.doesNotMatch(await page.locator('.status-text').innerText(), /Длинное_обозначение/, 'empty replacement clears the old hovered element');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: view switches, one annotation per network, presentation SCM, accessible settings, clean selection export, exclusive analysis panels and long hover text at 800/1440/1920 px.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
