const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH
    ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const junction = (id, x, y) => ({ id, name: id, type: 'JUNCTION', x, y,
        rotation: 0, value: 0, valueStr: '', unit: '' });
      const elements = [junction('NW', 200, 180), junction('NE', 500, 180),
        junction('SE', 500, 420), junction('SW', 200, 420),
        { id: 'LOAD', name: 'R1', type: 'R', x: 650, y: 420, rotation: 0,
          value: 1000, valueStr: '1к', unit: 'Ом' }];
      const wire = (id, fromCompId, toCompId, toPinId = '1') => ({
        id, fromCompId, fromPinId: '1', toCompId, toPinId,
      });
      return exportToYamlScm(elements, [wire('top', 'NW', 'NE'), wire('right', 'NE', 'SE'),
        wire('bottom', 'SE', 'SW'), wire('load', 'SE', 'LOAD')],
      SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    async function load(text, name) {
      await page.locator('input[type="file"]').setInputFiles({ name: `${name}.scm`,
        mimeType: 'text/plain', buffer: Buffer.from(text) });
      await page.getByText(name, { exact: true }).waitFor();
    }
    let lastSave = 0;
    async function save() {
      const remaining = 150 - (Date.now() - lastSave);
      if (remaining > 0) await page.waitForTimeout(remaining);
      const [download] = await Promise.all([page.waitForEvent('download'),
        page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
      lastSave = Date.now();
      return fs.readFile(await download.path(), 'utf8');
    }
    const screen = (x, y) => page.locator('#schematic-world').evaluate((world, p) => {
      const point = world.ownerSVGElement.createSVGPoint();
      point.x = p.x; point.y = p.y;
      const result = point.matrixTransform(world.getScreenCTM());
      return { x: result.x, y: result.y };
    }, { x, y });
    async function snapshot() {
      const scm = await save();
      const topology = await page.evaluate(async text => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const data = parseYamlScm(text), parent = new Map();
        const root = key => {
          if (!parent.has(key)) parent.set(key, key);
          const current = parent.get(key);
          if (current !== key) parent.set(key, root(current));
          return parent.get(key);
        };
        for (const wire of data.wires.filter(wire => !wire.disabled)) {
          const from = `${wire.fromCompId}_${wire.fromPinId}`;
          const to = `${wire.toCompId}_${wire.toPinId}`;
          parent.set(root(from), root(to));
        }
        const components = new Set([...parent.keys()].map(root)).size;
        const graph = buildCircuitGraph(data.elements, data.wires).pinToNode;
        const byName = new Map(data.elements.map(element => [element.name, element]));
        const resistor = byName.get('R1');
        const nodeIds = ['NW', 'NE', 'SE', 'SW', 'R1'].map(name =>
          graph.get(`${byName.get(name)?.id}_1`));
        if (nodeIds.some(node => node === undefined)) throw new Error('SCM lost a monitored terminal');
        return { mode: data.crossingMode, wires: data.wires.length, vertices: parent.size,
          components, cycles: data.wires.length - parent.size + components,
          electricalNodes: new Set(nodeIds).size,
          resistor: resistor && [resistor.x, resistor.y],
        };
      }, scm);
      const visible = await page.locator('[data-wire-id]').evaluateAll(groups => groups.map(group => ({
        id: group.getAttribute('data-wire-id'),
        d: group.querySelector('path[stroke="transparent"]')?.getAttribute('d'),
        length: group.querySelector('[data-wire-ink]')?.getTotalLength() ?? 0,
      })));
      return { scm, topology, visible, inkLength: visible.reduce((sum, wire) => sum + wire.length, 0) };
    }
    await load(fixture, 'w09-open');
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-id]').length === 4);
    const open = await snapshot();
    assert.deepEqual(open.topology, { mode: 'connect', wires: 4, vertices: 5,
      components: 1, cycles: 0, electricalNodes: 1, resistor: [650, 420] });
    assert.equal(open.inkLength, 960);

    const nw = await screen(200, 180), sw = await screen(200, 420);
    await page.keyboard.down('Alt');
    await page.mouse.click(nw.x, nw.y);
    await page.keyboard.up('Alt');
    await page.mouse.click(sw.x, sw.y);
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-id]').length === 5);
    await page.keyboard.press('Escape');
    const closed = await snapshot();
    assert.equal(closed.topology.cycles, 1, 'clicking the last two junctions creates one cycle');
    assert.equal(closed.topology.electricalNodes, 1);
    assert.equal(closed.inkLength, 1200, 'the closing side is visibly present');
    assert.equal(closed.visible.filter(wire => wire.d?.includes('200 180') && wire.d?.includes('200 420')).length, 1);

    await page.keyboard.press('Control+z');
    assert.deepEqual(await snapshot(), open, 'Undo of wire creation restores visible and electrical topology');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await snapshot(), closed, 'Redo of wire creation restores the exact loop');

    const shared = await screen(200, 300);
    await page.mouse.click(shared.x, shared.y);
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-id]').length === 4);
    const removed = await snapshot();
    assert.equal(removed.topology.cycles, 0);
    assert.equal(removed.topology.electricalNodes, 1);
    assert.equal(removed.inkLength, 960);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await snapshot(), closed, 'Undo of branch deletion restores the loop');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await snapshot(), removed, 'Redo of branch deletion opens the loop again');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await snapshot(), closed);

    const oldCenter = await screen(650, 420), newCenter = await screen(700, 460);
    await page.mouse.move(oldCenter.x, oldCenter.y);
    await page.mouse.down();
    await page.mouse.move(newCenter.x, newCenter.y, { steps: 5 });
    await page.mouse.up();
    const moved = await snapshot();
    assert.deepEqual(moved.topology.resistor, [700, 460]);
    assert.equal(moved.topology.cycles, 1);
    assert.equal(moved.topology.electricalNodes, 1);
    assert.notDeepEqual(moved.visible, closed.visible, 'connected wire follows the moved resistor');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await snapshot(), closed, 'Undo restores the exact loop and connected component');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await snapshot(), moved, 'Redo restores the moved resistor and loop');
    await load(moved.scm, 'w09-reopened');
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-id]').length === 5);
    const reopened = await snapshot();
    assert.deepEqual(reopened.topology, moved.topology, 'SCM 8 reopening preserves electrical topology and cycle rank');
    assert.deepEqual(reopened.visible.map(({ d, length }) => ({ d, length })),
      moved.visible.map(({ d, length }) => ({ d, length })),
      'SCM 8 reopening preserves every visible segment independent of regenerated internal IDs');
    assert.deepEqual(errors, []);
    console.log('PASS: W09 loop creation, branch deletion, component drag, visible ink, cycle rank, atomic Undo/Redo and SCM 8 reload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
