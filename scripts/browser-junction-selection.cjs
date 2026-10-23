const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH
    ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const quick = page.getByRole('button', { name: 'Резистор', exact: true });
    assert.equal(await quick.count(), 1);
    assert.equal((await quick.innerText()).trim(), '', 'the closed two-terminal chooser has no component caption');
    assert.equal(await quick.getAttribute('title'), 'Резистор');
    const chooser = page.getByRole('combobox', { name: 'Двухполюсники: выбрать элемент' });
    await chooser.selectOption('C');
    assert.equal(await page.getByRole('button', { name: 'Конденсатор', exact: true }).count(), 1);
    await chooser.selectOption('R');
    assert.equal((await quick.innerText()).trim(), '', 'changing the variant does not restore a caption');
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [
        { id: 'r1', type: 'R', name: 'R1', x: 100, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'r2', type: 'R', name: 'R2', x: 440, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'r3', type: 'R', name: 'R3', x: 270, y: 390, rotation: 90, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'j1', type: 'JUNCTION', name: 'N1', x: 270, y: 200, rotation: 0, value: 0, valueStr: '', unit: '' },
      ];
      const wires = [
        { id: 'w1', fromCompId: 'r1', fromPinId: '2', toCompId: 'j1', toPinId: '1', routeMode: 'orthogonal' },
        { id: 'w2', fromCompId: 'j1', fromPinId: '1', toCompId: 'r2', toPinId: '1', routeMode: 'orthogonal' },
        { id: 'w3', fromCompId: 'j1', fromPinId: '1', toCompId: 'r3', toPinId: '1', routeMode: 'orthogonal' },
      ];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'junction-hit.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.getByText('junction-hit', { exact: true }).waitFor();
    const node = page.locator('[data-component-id]:has([data-node-hit])');
    const hit = node.locator('[data-node-hit]');
    const location = () => node.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f }));
    const position = () => node.getAttribute('transform');
    const selected = () => node.locator('circle[fill="#3b82f6"]').count();
    await fs.mkdir(path.resolve('.work'), { recursive: true });
    await page.screenshot({ path: path.resolve('.work/junction-before.png') });
    const first = await location();
    await page.mouse.click(first.x, first.y);
    assert.equal(await selected(), 1, 'first click chooses the junction, not its wire');
    assert.equal(await position(), 'translate(270, 200)');
    assert.equal(await page.locator('[data-reconnect-preview]').count(), 0);
    const nearby = { x: first.x + 30, y: first.y };
    await page.mouse.click(nearby.x, nearby.y);
    assert.equal(await selected(), 0, 'click outside the node hit area may select the nearby wire');
    for (const zoom of [25, 50, 100, 150, 200]) {
      await page.getByRole('slider', { name: 'Масштаб просмотра в процентах' }).fill(String(zoom));
      const start = await location();
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 2, start.y + 2);
      assert.equal(await position(), 'translate(270, 200)', `${zoom}%: click jitter does not move node`);
      await page.mouse.move(start.x + Math.max(20, zoom / 2), start.y + Math.max(20, zoom / 2), { steps: 5 });
      await page.mouse.up();
      assert.notEqual(await position(), 'translate(270, 200)', `${zoom}%: drag moves node`);
      await page.keyboard.press('Control+z');
      assert.equal(await position(), 'translate(270, 200)', `${zoom}%: undo restores node`);
    }
    const start = await location();
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 50, start.y + 50, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await position(), 'translate(270, 200)', 'Escape restores the node and attached routes');
    await page.getByRole('slider', { name: 'Масштаб просмотра в процентах' }).fill('100');
    await page.getByLabel('Горизонтальная прокрутка схемы').evaluate(scroll => {
      scroll.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); scroll.scrollLeft += 40;
    });
    await page.getByLabel('Вертикальная прокрутка схемы').evaluate(scroll => {
      scroll.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); scroll.scrollTop += 30;
    });
    await page.waitForTimeout(40);
    const scrolled = await location();
    await page.mouse.move(scrolled.x, scrolled.y); await page.mouse.down();
    await page.mouse.move(scrolled.x + 40, scrolled.y + 20, { steps: 5 }); await page.mouse.up();
    assert.equal(await position(), 'translate(320, 220)', 'drag after scrolling uses document coordinates and grid snapping');
    const routes = await page.locator('[data-wire-id] > path[stroke="transparent"]').evaluateAll(paths => paths.map(path =>
      [...path.getAttribute('d').matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)]
        .map(([, x, y]) => ({ x: Number(x), y: Number(y) }))));
    assert.equal(routes.length, 3);
    for (const points of routes) {
      const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const drawn = points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
      assert(drawn <= distance(points[0], points.at(-1)) + 1,
        `moving a junction must not create a backtracking loop: ${JSON.stringify(points)}`);
    }
    await page.screenshot({ path: path.resolve('.work/junction-after.png') });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const saved = await fs.readFile(await download.path(), 'utf8');
    const topology = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(scm);
      const graph = buildCircuitGraph(parsed.elements, parsed.wires);
      const ids = Object.fromEntries(parsed.elements.map(element => [element.name, element.id]));
      return { mode: parsed.crossingMode, junctions: parsed.elements.filter(el => el.type === 'JUNCTION').length,
        wires: parsed.wires.length, connected: [`${ids.R1}_2`, `${ids.R2}_1`, `${ids.R3}_1`]
          .every(pin => graph.pinToNode.get(pin) === graph.pinToNode.get(`${ids.N1}_1`)) };
    }, saved);
    assert.deepEqual(topology, { mode: 'connect', junctions: 1, wires: 3, connected: true });
    await page.locator('input[type="file"]').setInputFiles({ name: 'junction-reopen.scm', mimeType: 'text/plain', buffer: Buffer.from(saved) });
    await page.getByText('junction-reopen', { exact: true }).waitFor();
    assert.equal(await position(), 'translate(320, 220)', 'SCM reopens at the same location');
    const legacy = await page.evaluate(async scm => {
      const { parseYamlScm, exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const parsed = parseYamlScm(scm);
      return exportToYamlScm(parsed.elements, parsed.wires, parsed.transient, parsed.ac, parsed.printLayout, 'current', 'explicit', parsed.description);
    }, fixture);
    await page.locator('input[type="file"]').setInputFiles({ name: 'junction-legacy.scm', mimeType: 'text/plain', buffer: Buffer.from(legacy) });
    await page.getByText('junction-legacy', { exact: true }).waitFor();
    const [legacyDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    assert.match(await fs.readFile(await legacyDownload.path(), 'utf8'), /MajorVersion: 7/, 'SCM 7 stays SCM 7');
    const twoBranch = await page.evaluate(async scm => {
      const { parseYamlScm, exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const parsed = parseYamlScm(scm);
      return exportToYamlScm(parsed.elements, parsed.wires.slice(0, 2), parsed.transient,
        parsed.ac, parsed.printLayout, 'current', 'explicit', parsed.description);
    }, legacy);
    await page.locator('input[type="file"]').setInputFiles({ name: 'junction-two-branch.scm', mimeType: 'text/plain', buffer: Buffer.from(twoBranch) });
    await page.getByText('junction-two-branch', { exact: true }).waitFor();
    const twoStart = await location();
    await page.mouse.move(twoStart.x, twoStart.y); await page.mouse.down();
    await page.mouse.move(twoStart.x + 40, twoStart.y + 20, { steps: 5 }); await page.mouse.up();
    const [twoDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const twoSaved = await fs.readFile(await twoDownload.path(), 'utf8');
    const twoResult = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(scm);
      const ids = Object.fromEntries(parsed.elements.map(element => [element.name, element.id]));
      const nodes = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      return { mode: parsed.crossingMode, junctions: parsed.elements.filter(el => el.type === 'JUNCTION').length,
        wires: parsed.wires.length, connected: nodes.get(`${ids.R1}_2`) === nodes.get(`${ids.R2}_1`) &&
          nodes.get(`${ids.R1}_2`) === nodes.get(`${ids.N1}_1`) };
    }, twoSaved);
    assert.deepEqual(twoResult, { mode: 'explicit', junctions: 1, wires: 2, connected: true });
    const overlap = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      return exportToYamlScm([
        { id: 'node-under-body', type: 'JUNCTION', name: 'N1', x: 200, y: 200, rotation: 0, value: 0, valueStr: '', unit: '' },
        { id: 'body-over-node', type: 'R', name: 'R1', x: 200, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
      ], [], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'explicit');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'junction-overlap.scm', mimeType: 'text/plain', buffer: Buffer.from(overlap) });
    await page.getByText('junction-overlap', { exact: true }).waitFor();
    const overlapPoint = await location();
    await page.mouse.click(overlapPoint.x, overlapPoint.y);
    assert.equal(await selected(), 1, 'junction wins over a component body regardless of SVG object order');
    const bendOverlap = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      return exportToYamlScm([
        { id: 'bend-left', type: 'R', name: 'R1', x: 100, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'bend-right', type: 'R', name: 'R2', x: 300, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'bend-node', type: 'JUNCTION', name: 'N1', x: 200, y: 200, rotation: 0, value: 0, valueStr: '', unit: '' },
      ], [{ id: 'bend-wire', fromCompId: 'bend-left', fromPinId: '2', toCompId: 'bend-right', toPinId: '1',
        routeMode: 'direct', manual: true, waypoints: [{ x: 200, y: 200 }] }],
      SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'explicit');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'junction-bend-overlap.scm', mimeType: 'text/plain', buffer: Buffer.from(bendOverlap) });
    await page.getByText('junction-bend-overlap', { exact: true }).waitFor();
    const importedWireId = await page.locator('[data-wire-id]').first().getAttribute('data-wire-id');
    const wirePath = page.locator(`[data-wire-id="${importedWireId}"] path[stroke="transparent"]`);
    const wireMatrix = await wirePath.evaluate(path => ({ x: path.getScreenCTM().e, y: path.getScreenCTM().f,
      sx: path.getScreenCTM().a, sy: path.getScreenCTM().d }));
    await page.mouse.click(wireMatrix.x + 160 * wireMatrix.sx, wireMatrix.y + 200 * wireMatrix.sy);
    await page.locator(`[data-wire-waypoint="${importedWireId}:0"]`).waitFor();
    const bendNode = page.locator('[data-component-id]:has([data-node-hit])');
    const bendPoint = await bendNode.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f }));
    await page.mouse.click(bendPoint.x, bendPoint.y);
    assert.equal(await bendNode.locator('circle[fill="#3b82f6"]').count(), 1,
      'junction wins over a selected manual waypoint at the same coordinate');
    assert.deepEqual(errors, []);
    assert.equal(await bendNode.locator('[data-node-hit]').count(), 1);
    console.log('PASS: compact two-terminal chooser, junction hit priority, 25–200% drag, Escape, Undo and SCM topology.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
