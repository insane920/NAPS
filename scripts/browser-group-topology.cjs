const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, col) => ({
        id: `R${row}${col}`, name: `R${row}${col}`, type: 'R', value: 100, valueStr: '100', unit: 'Ом',
        x: 200 + col * 200, y: 200 + row * 160, rotation: 0,
      }))).flat();
      const wires = Array.from({ length: 4 }, (_, row) => Array.from({ length: 3 }, (_, col) => ({
        id: `row${row}_${col}`, fromCompId: `R${row}${col}`, fromPinId: '2',
        toCompId: `R${row}${col + 1}`, toPinId: '1', waypoints: [], manual: true,
      }))).flat();
      wires.push({ id: 'cross', fromCompId: 'R00', fromPinId: '1', toCompId: 'R33', toPinId: '2',
        waypoints: [{ x: 170, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 780 }, { x: 830, y: 780 }], manual: true });
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'group-topology.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.waitForFunction(() => document.querySelectorAll('#schematic-world > [data-component-id]').length === 20);
    await page.getByTitle('Показать схему целиком').click();
    let lastDownload = 0;
    async function snapshot() {
      const delay = 150 - (Date.now() - lastDownload);
      if (delay > 0) await page.waitForTimeout(delay);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
      lastDownload = Date.now();
      const scm = await fs.readFile(await download.path(), 'utf8');
      return page.evaluate(async text => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const data = parseYamlScm(text), graph = buildCircuitGraph(data.elements, data.wires);
        const nets = new Map();
        for (const element of data.elements) for (const pin of ['1', '2']) {
          const node = graph.pinToNode.get(`${element.id}_${pin}`);
          if (!nets.has(node)) nets.set(node, []);
          nets.get(node).push(`${element.name}_${pin}`);
        }
        return {
          elements: data.elements.map(e => [e.name, e.x, e.y]).sort((a, b) => a[0].localeCompare(b[0])),
          nets: [...nets.values()].map(members => members.sort().join(',')).sort(),
          wireCount: data.wires.length, nodeCount: graph.nodeCount,
        };
      }, scm);
    }
    const original = await snapshot();
    const components = page.locator('#schematic-world > [data-component-id]');
    const centers = await components.evaluateAll(groups => groups.map(group => {
      const point = group.ownerSVGElement.createSVGPoint();
      const screen = point.matrixTransform(group.getScreenCTM());
      return { x: screen.x, y: screen.y };
    }));
    const left = Math.min(...centers.map(p => p.x));
    const right = Math.max(...centers.map(p => p.x));
    const top = Math.min(...centers.map(p => p.y));
    const bottom = Math.max(...centers.map(p => p.y));
    await page.mouse.move(left - 80, top - 35); await page.mouse.down();
    await page.mouse.move(right + 35, bottom + 35, { steps: 8 }); await page.mouse.up();
    await page.screenshot({ path: '.work/group-topology-marquee.png' });
    assert.equal(await page.locator('[data-component-id] [stroke="#dc2626"]').count() > 0, true);
    await page.mouse.move(centers[0].x, centers[0].y); await page.mouse.down();
    await page.mouse.move(centers[0].x + 40, centers[0].y + 20, { steps: 8 }); await page.mouse.up();
    const moved = await snapshot();
    assert.equal(moved.elements.length, 20);
    assert.equal(moved.wireCount, original.wireCount);
    assert.deepEqual(moved.nets, original.nets, 'group drag retains every electrical network across X crossings');
    assert.deepEqual(moved.elements.map((entry, index) => [entry[0], entry[1] - original.elements[index][1], entry[2] - original.elements[index][2]]),
      original.elements.map(entry => [entry[0], 40, 20]), 'all selected components move by one rigid delta');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await snapshot(), original, 'one Undo restores grouped geometry and topology');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await snapshot(), moved, 'one Redo restores grouped geometry and topology');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const saved = await fs.readFile(await download.path(), 'utf8');
    await page.locator('input[type=file]').setInputFiles({ name: 'group-topology-reopen.scm', mimeType: 'text/plain', buffer: Buffer.from(saved) });
    assert.deepEqual(await snapshot(), moved, 'SCM 8 reopening preserves group geometry and electrical networks');
    assert.deepEqual(errors, []);
    console.log('PASS: 16 resistors and 4 crossing nodes move as one group with graph, rigid geometry, atomic Undo/Redo and SCM 8.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
