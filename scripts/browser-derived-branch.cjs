const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH
    ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const e = (id, type, x, y, rotation = 0) => ({ id, name: id, type, x, y, rotation,
        value: 1000, valueStr: '1к', unit: 'Ом' });
      const elements = [e('A', 'R', 200, 300), e('B', 'R', 600, 300), e('C', 'R', 420, 100, 90), e('J', 'JUNCTION', 420, 320)];
      const wires = [['a', 'A', '2'], ['b', 'B', '1'], ['c', 'C', '2']].map(([id, fromCompId, fromPinId]) =>
        ({ id, fromCompId, fromPinId, toCompId: 'J', toPinId: '1' }));
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'derived-t.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.getByText('derived-t', { exact: true }).waitFor();
    const marker = page.locator('[data-derived-branch]');
    assert.equal(await marker.count(), 1);
    assert.deepEqual(await marker.evaluate(node => [Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))]), [420, 300]);
    const toScreen = (x, y) => page.locator('#schematic-world').evaluate((world, point) => {
      const p = world.ownerSVGElement.createSVGPoint(); p.x = point.x; p.y = point.y;
      const s = p.matrixTransform(world.getScreenCTM()); return { x: s.x, y: s.y };
    }, { x, y });
    const start = await toScreen(420, 300), end = await toScreen(440, 280);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 }); await page.mouse.up();
    const selected = page.locator('[data-component-id]').filter({ has: page.locator('[data-component-symbol="JUNCTION"]') });
    assert.equal(await selected.count(), 2, 'promoted branch is a second model-backed junction');
    const edited = await page.locator('[data-wire-id] > path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
    assert.equal(edited.length, 4, 'three branches and one trunk, without duplicate tails');
    assert.equal(await page.locator('[data-derived-branch]').count(), 0,
      'the visible branch stays at the moved electrical node instead of appearing earlier on a shared route');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const saved = await fs.readFile(await download.path(), 'utf8');
    const state = await page.evaluate(async text => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const doc = parseYamlScm(text), graph = buildCircuitGraph(doc.elements, doc.wires);
      const byName = Object.fromEntries(doc.elements.map(element => [element.name, element]));
      return { junction: doc.elements.find(element => element.type === 'JUNCTION' && element.name !== 'J'),
        same: [['A', '2'], ['B', '1'], ['C', '2'], ['J', '1']].map(([name, pin]) => graph.pinToNode.get(`${byName[name].id}_${pin}`)) };
    }, saved);
    assert.deepEqual([state.junction.x, state.junction.y], [440, 280]);
    assert.equal(new Set(state.same).size, 1, 'all original branches stay electrically connected');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('[data-component-id]').count(), 4, 'one Undo removes the promoted branch and its drag');
    await page.keyboard.press('Control+y');
    assert.equal(await page.locator('[data-component-id]').count(), 5, 'one Redo restores the durable branch');
    await page.locator('input[type="file"]').setInputFiles({ name: 'derived-reopened.scm', mimeType: 'text/plain', buffer: Buffer.from(saved) });
    await page.getByText('derived-reopened', { exact: true }).waitFor();
    assert.deepEqual(await page.locator('[data-wire-id] > path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d'))), edited,
      'SCM 8 preserves the moved branch geometry');
    const branchId = await page.locator('[data-component-id][transform="translate(440, 280)"]').getAttribute('data-component-id');
    assert(branchId, 'promoted branch remains selectable after reopening');
    let current = { x: 440, y: 280 };
    const knownRoutes = new Map();
    for (const percent of [25, 50, 100, 150, 200]) {
      await page.getByRole('slider', { name: 'Масштаб просмотра в процентах' }).evaluate((input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, percent);
      await page.waitForFunction(value => Number(document.querySelector('[aria-label="Масштаб просмотра в процентах"]')?.value) === value, percent);
      assert.equal((await page.locator('[aria-label="Масштаб просмотра"] output').innerText()).trim(), `${percent}%`,
        'the editor transform, not only the native slider value, uses the requested zoom');
      for (let repeat = 0; repeat < 10; repeat++) {
        const next = [{ x: 460, y: 260 }, { x: 420, y: 300 }, { x: 440, y: 280 }][repeat % 3];
        if (next.x === current.x && next.y === current.y) continue;
        const from = await toScreen(current.x, current.y), to = await toScreen(next.x, next.y);
        await page.mouse.move(from.x, from.y); await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 3 }); await page.mouse.up();
        await page.locator(`[data-component-id="${branchId}"]`).waitFor();
        assert.equal(await page.locator(`[data-component-id="${branchId}"]`).getAttribute('transform'),
          `translate(${next.x}, ${next.y})`, `${percent}%: controlled electrical node follows the pointer`);
        assert.equal(await page.locator('[data-derived-branch]').count(), 0, 'moving the real junction never leaves an earlier visual T');
        const paths = await page.locator('[data-wire-id] > path[stroke="transparent"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')));
        const key = `${next.x},${next.y}`;
        if (knownRoutes.has(key)) assert.deepEqual(paths, knownRoutes.get(key), '50 repeats never accumulate automatic bends');
        else knownRoutes.set(key, paths);
        current = next;
      }
      const [snapshot] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
      const snapshotText = await fs.readFile(await snapshot.path(), 'utf8');
      const netCheck = await page.evaluate(async text => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const doc = parseYamlScm(text), graph = buildCircuitGraph(doc.elements, doc.wires);
        const named = Object.fromEntries(doc.elements.map(element => [element.name, element]));
        return { nodes: [['A', '2'], ['B', '1'], ['C', '2'], ['J', '1']].map(([name, pin]) => graph.pinToNode.get(`${named[name].id}_${pin}`)),
          branch: doc.elements.find(element => element.branchAnchor) };
      }, snapshotText);
      assert.equal(new Set(netCheck.nodes).size, 1, `${percent}%: real electrical network survives ten more drags`);
      assert.deepEqual([netCheck.branch.x, netCheck.branch.y], [current.x, current.y], 'SCM saves world coordinates independently of zoom');
    }
    console.log('PASS: derived T branch promotion, 50 drags at 25–200%, one electrical net, atomic Undo/Redo and SCM 8 reload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
