const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH
    ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const resistor = (id, x) => ({ id, name: id, type: 'R', x, y: 200,
        rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' });
      return exportToYamlScm([resistor('A', 100), resistor('B', 500)], [{ id: 'manual',
        fromCompId: 'A', fromPinId: '2', toCompId: 'B', toPinId: '1', manual: true,
        waypoints: [{ x: 260, y: 200 }, { x: 260, y: 300 }, { x: 360, y: 300 }, { x: 360, y: 200 }] }],
      SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'manual-point.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.keyboard.press('Escape');
    const screen = async point => page.evaluate(({ x, y }) => {
      const group = document.getElementById('schematic-world');
      const svgPoint = group.ownerSVGElement.createSVGPoint(); svgPoint.x = x; svgPoint.y = y;
      const result = svgPoint.matrixTransform(group.getScreenCTM());
      return { x: result.x, y: result.y };
    }, point);
    const selected = await screen({ x: 300, y: 300 });
    await page.mouse.click(selected.x, selected.y);
    const handle = page.locator('[data-wire-waypoint$=":1"]');
    await handle.waitFor();
    const before = await handle.getAttribute('cy');
    const start = await screen({ x: 260, y: 300 });
    const end = await screen({ x: 260, y: 340 });
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
    assert.notEqual(await handle.getAttribute('cy'), before, 'manual bend moves independently');
    const [download] = await Promise.all([page.waitForEvent('download'),
      page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const saved = await fs.readFile(await download.path(), 'utf8');
    const result = await page.evaluate(async content => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(content);
      const wire = parsed.wires.find(item => item.id === 'manual') ?? parsed.wires[0];
      const pins = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      const names = Object.fromEntries(parsed.elements.map(element => [element.name, element.id]));
      return { waypoint: wire.waypoints[1], connected: pins.get(`${names.A}_2`) === pins.get(`${names.B}_1`) };
    }, saved);
    assert.deepEqual(result, { waypoint: { x: 260, y: 340 }, connected: true }, 'SCM keeps moved bend and topology');
    await page.keyboard.press('Control+z');
    await page.mouse.click(selected.x, selected.y);
    assert.equal(await handle.getAttribute('cy'), before, 'one undo restores manual bend');
    await page.keyboard.press('Control+y');
    const redoneRoute = await screen({ x: 300, y: 340 });
    await page.mouse.click(redoneRoute.x, redoneRoute.y);
    assert.equal(Number(await handle.getAttribute('cy')), 340, 'redo reapplies manual bend');
    await page.locator('input[type="file"]').setInputFiles({ name: 'manual-point-reopen.scm', mimeType: 'text/plain', buffer: Buffer.from(saved) });
    assert.deepEqual(errors, []);
    console.log('PASS: manual bend drag, SCM round trip, electrical topology and atomic Undo/Redo.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
