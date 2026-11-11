const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

const center = locator => locator.evaluate(circle => {
  const point = circle.ownerSVGElement.createSVGPoint();
  point.x = Number(circle.getAttribute('cx'));
  point.y = Number(circle.getAttribute('cy'));
  const result = point.matrixTransform(circle.getScreenCTM());
  return { x: result.x, y: result.y };
});

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    const dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const positions = [[100, 200, 0], [500, 200, 0], [300, 50, 90], [300, 350, 90]];
      const elements = positions.map(([x, y, rotation], index) => ({
        id: `r${index + 1}`, type: 'R', name: `R${index + 1}`, x, y, rotation,
        value: 1000, valueStr: '1к', unit: 'Ом',
      }));
      const wires = [{ id: 'horizontal', fromCompId: 'r1', fromPinId: '2', toCompId: 'r2', toPinId: '1', routeMode: 'direct' }];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'connect-crossings.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.getByText('connect-crossings', { exact: true }).waitFor();
    const parts = page.locator('[data-component-id]');
    const pin = (index, terminal) => parts.nth(index).locator('circle[fill="transparent"].cursor-pointer').nth(terminal);
    for (const p of [await center(pin(2, 1)), await center(pin(3, 0))]) await page.mouse.click(p.x, p.y);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const saved = await fs.readFile(await download.path(), 'utf8');
    const result = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(scm);
      const ids = Object.fromEntries(parsed.elements.map(item => [item.name, item.id]));
      const nodes = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      return { mode: parsed.crossingMode, junctions: parsed.elements.filter(item => item.type === 'JUNCTION').length,
        wires: parsed.wires.length, joined: nodes.get(`${ids.R1}_2`) === nodes.get(`${ids.R3}_2`) };
    }, saved);
    assert.deepEqual(result, { mode: 'connect', junctions: 1, wires: 4, joined: true });
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('[data-component-id]').count(), 4, 'undo removes the crossing junction with its wire');
    await page.keyboard.press('Control+y');
    assert.equal(await page.locator('[data-component-id]').count(), 5, 'redo restores the connected junction');
    const top = await center(pin(2, 1));
    const bottom = await center(pin(3, 0));
    const grab = { x: top.x, y: top.y + (bottom.y - top.y) * 0.25 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x - 250, grab.y, { steps: 4 });
    await page.mouse.up();
    const [movedDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const movedScm = await fs.readFile(await movedDownload.path(), 'utf8');
    const moved = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(scm);
      const ids = Object.fromEntries(parsed.elements.map(item => [item.name, item.id]));
      const nodes = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      return { junctions: parsed.elements.filter(item => item.type === 'JUNCTION').length,
        anchored: parsed.elements.some(item => item.type === 'JUNCTION' && item.branchAnchor),
        joined: nodes.get(`${ids.R1}_2`) === nodes.get(`${ids.R3}_2`) };
    }, movedScm);
    assert.deepEqual(moved, { junctions: 1, anchored: true, joined: true },
      'dragging a connected branch promotes its movable junction and keeps the electrical net together');
    const movedJunctionX = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      return parseYamlScm(scm).elements.find(item => item.type === 'JUNCTION')?.x;
    }, movedScm);
    assert.notEqual(movedJunctionX, 300, 'dragging the branch actually moves its junction');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('[data-component-id]').count(), 5, 'undo restores the original crossing position');
    await page.keyboard.press('Control+y');
    assert.equal(await page.locator('[data-component-id]').count(), 5, 'redo moves the connected crossing again');
    await page.keyboard.press('Control+z');
    const rotated = await pin(2, 1).locator('..').evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint(); point.x = 0; point.y = 0;
      const screen = point.matrixTransform(group.getScreenCTM());
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(rotated.x, rotated.y);
    await page.keyboard.press('r');
    const [rotatedDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const rotatedScm = await fs.readFile(await rotatedDownload.path(), 'utf8');
    const rotationResult = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(scm);
      const ids = Object.fromEntries(parsed.elements.map(item => [item.name, item.id]));
      const graph = buildCircuitGraph(parsed.elements, parsed.wires);
      return { junctions: parsed.elements.filter(item => item.autoCrossing).length,
        joined: graph.pinToNode.get(`${ids.R1}_2`) === graph.pinToNode.get(`${ids.R3}_2`) };
    }, rotatedScm);
    assert.deepEqual(rotationResult, { junctions: 1, joined: true }, 'rotation preserves the connected junction');
    await page.keyboard.press('Control+z');
    const branchTop = await center(pin(2, 1));
    const branchJunction = await parts.nth(4).evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint();
      const screen = point.matrixTransform(group.getScreenCTM());
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click((branchTop.x + branchJunction.x) / 2, (branchTop.y + branchJunction.y) / 2);
    await page.keyboard.press('Delete');
    assert.equal(await page.locator('#schematic-world path[stroke="transparent"]').count(), 3,
      'deleting one crossing fragment retains the other branches');
    const [cutDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const cutScm = await fs.readFile(await cutDownload.path(), 'utf8');
    const cut = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(scm);
      const ids = Object.fromEntries(parsed.elements.map(item => [item.name, item.id]));
      const nodes = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      return { wires: parsed.wires.length, automatic: parsed.elements.filter(item => item.autoCrossing).length,
        provenance: parsed.wires.filter(item => item.originWireId).length,
        separated: nodes.get(`${ids.R3}_2`) !== nodes.get(`${ids.R1}_2`),
        intact: nodes.get(`${ids.R1}_2`) === nodes.get(`${ids.R4}_1`) };
    }, cutScm);
    assert.deepEqual(cut, { wires: 3, automatic: 0, provenance: 0, separated: true, intact: true },
      'explicit deletion freezes incomplete provenance and separates only the removed branch');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#schematic-world path[stroke="transparent"]').count(), 4, 'undo restores the cut fragment');
    await page.keyboard.press('Control+y');
    assert.equal(await page.locator('#schematic-world path[stroke="transparent"]').count(), 3, 'redo restores the cut');
    await page.locator('input[type="file"]').setInputFiles({ name: 'cut-crossing.scm', mimeType: 'text/plain', buffer: Buffer.from(cutScm) });
    await page.getByText('cut-crossing', { exact: true }).waitFor();
    assert.equal(await page.locator('#schematic-world path[stroke="transparent"]').count(), 3, 'reloading preserves the edited branched topology');
    assert.deepEqual(errors, []);
    console.log('PASS: SCM 8 crossing creation, segment edit, branch deletion, rotation, save and undo/redo.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
