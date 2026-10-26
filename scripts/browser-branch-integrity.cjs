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
    const state = scm => page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(scm), graph = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      return { mode: parsed.crossingMode,
        geometry: parsed.elements.map(({ name, x, y }) => ({ name, x, y })),
        bends: parsed.wires.find(wire => wire.manual)?.waypoints,
        nets: new Set(parsed.wires.map(wire => graph.get(`${wire.fromCompId}_${wire.fromPinId}`))).size,
        wires: parsed.wires.length };
    }, scm);
    for (const mode of ['explicit', 'connect']) {
      const fixture = await page.evaluate(async mode => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        const resistor = (id, x, y, rotation = 0) => ({ id, name: id, type: 'R', x, y, rotation,
          value: 1000, valueStr: '1к', unit: 'Ом' });
        const elements = [resistor('A', 100, 300), resistor('B', 500, 300), resistor('C', 300, 500, 90),
          { id: 'N', name: 'N', type: 'JUNCTION', x: 300, y: 300, rotation: 0, value: 0, valueStr: '', unit: '' },
          ...Array.from({ length: 8 }, (_, index) => resistor(`obstacle_${index}`, 100 + index * 60, 200))];
        const wires = [
          { id: 'left', fromCompId: 'A', fromPinId: '2', toCompId: 'N', toPinId: '1' },
          { id: 'right', fromCompId: 'N', fromPinId: '1', toCompId: 'B', toPinId: '1', manual: true,
            waypoints: [{ x: 400, y: 300 }, { x: 400, y: 400 }, { x: 460, y: 400 }, { x: 460, y: 300 }] },
          { id: 'bottom', fromCompId: 'N', fromPinId: '1', toCompId: 'C', toPinId: '1' },
        ];
        return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', mode);
      }, mode);
      await load(fixture, `mixed-${mode}`);
      const before = await state(fixture);
      const node = page.locator('[data-component-id]:has([data-node-hit])');
      const origin = await node.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f,
        scale: group.getScreenCTM().a }));
      await page.mouse.move(origin.x, origin.y); await page.mouse.down();
      await page.mouse.move(origin.x + 20 * origin.scale, origin.y + 20 * origin.scale, { steps: 4 });
      await page.mouse.up();
      const saved = await save(), moved = await state(saved);
      assert.equal(moved.nets, 1, `${mode}: all three mixed branches remain one electrical net`);
      assert.equal(moved.wires, 3);
      assert.deepEqual(moved.geometry.find(element => element.name === 'N'), { name: 'N', x: 320, y: 320 });
      assert.deepEqual(moved.bends, [{ x: 420, y: 320 }, ...before.bends.slice(1)],
        `${mode}: only the terminal-adjacent bend follows the node`);
      await page.keyboard.press('Control+z');
      assert.deepEqual(await state(await save()), before, 'one undo restores mixed geometry and topology');
      await page.keyboard.press('Control+y');
      assert.deepEqual(await state(await save()), moved, 'one redo restores all branches');
      await load(saved, `mixed-reopen-${mode}`);
      assert.deepEqual(await state(await save()), moved, 'mixed automatic/manual branches survive SCM reload');
    }
    const overlap = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [100, 300, 400].map((x, index) => ({ id: `N${index}`, name: `N${index}`,
        type: 'JUNCTION', x, y: 300, rotation: 0, value: 0, valueStr: '', unit: '' }));
      return exportToYamlScm(elements, [
        { id: 'short', fromCompId: 'N0', fromPinId: '1', toCompId: 'N1', toPinId: '1', routeMode: 'direct' },
        { id: 'long', fromCompId: 'N0', fromPinId: '1', toCompId: 'N2', toPinId: '1', routeMode: 'direct' },
      ], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'explicit');
    });
    await load(overlap, 'shared-ink');
    const lengths = await page.locator('[data-wire-id]').evaluateAll(groups => groups.map(group => ({
      full: group.querySelector('path[stroke="transparent"]').getTotalLength(),
      visible: group.querySelector('[data-wire-ink]').getTotalLength(),
    })));
    assert.deepEqual(lengths, [{ full: 200, visible: 200 }, { full: 300, visible: 100 }],
      'shared network stretch is drawn once while both editable routes remain intact');
    const originalOverlap = await state(overlap);
    const savedOverlap = await save();
    assert.deepEqual(await state(savedOverlap), originalOverlap, 'ink reduction never modifies SCM geometry');
    await load(savedOverlap, 'shared-ink-reopen');
    assert.equal(await page.locator('[data-wire-id]').count(), 2, 'neither conductor is deleted');
    assert.deepEqual(dialogs, []);
    assert.deepEqual(errors, []);
    console.log('PASS: mixed branches with obstacles, manual bend preservation, atomic Undo/Redo, SCM 7/8 and deduplicated network ink.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
