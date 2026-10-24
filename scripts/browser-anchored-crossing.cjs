const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH
    ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { materializeWireCrossings } = await import('/src/components/SchematicEditor.tsx');
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [['west', 100, 200], ['east', 500, 200], ['north', 300, 100],
        ['south', 300, 300], ['spur', 200, 300]].map(([id, x, y]) => ({ id, name: id,
          type: 'JUNCTION', x, y, rotation: 0, value: 0, valueStr: '', unit: '' }));
      const wires = [
        { id: 'horizontal', fromCompId: 'west', fromPinId: '1', toCompId: 'east', toPinId: '1', routeMode: 'direct' },
        { id: 'vertical', fromCompId: 'north', fromPinId: '1', toCompId: 'south', toPinId: '1', routeMode: 'direct' },
      ];
      const crossed = materializeWireCrossings(elements, wires, [
        { wire: wires[0], points: [{ x: 100, y: 200 }, { x: 500, y: 200 }] },
        { wire: wires[1], points: [{ x: 300, y: 100 }, { x: 300, y: 300 }] },
      ], wires[1].id);
      const automatic = crossed.elements.find(element => element.autoCrossing);
      const duplicate = { ...automatic, id: 'duplicate-marker', name: 'Nduplicate' };
      const fragments = crossed.wires.map((wire, index) => index !== 0 ? wire : ({ ...wire,
        fromCompId: wire.fromCompId === automatic.id ? duplicate.id : wire.fromCompId,
        toCompId: wire.toCompId === automatic.id ? duplicate.id : wire.toCompId,
      }));
      return exportToYamlScm([...crossed.elements, duplicate], fragments, SAMPLE_CIRCUITS[0].transient,
        undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'anchored-crossing.scm',
      mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.waitForFunction(() => document.querySelectorAll('[data-node-hit]').length === 6);
    const at = async (x, y) => page.locator(`#schematic-world > g[data-component-id][transform="translate(${x}, ${y})"] [data-node-hit]`).evaluate(node => {
      const position = new DOMPoint(0, 0).matrixTransform(node.getScreenCTM());
      return { x: position.x, y: position.y };
    });
    await page.getByRole('button', { name: 'Прямой', exact: true }).click();
    const start = await at(200, 300), end = await at(300, 200);
    await page.keyboard.down('Alt');
    await page.mouse.click(start.x, start.y);
    await page.keyboard.up('Alt');
    await page.mouse.click(end.x, end.y);
    const state = async () => {
      await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"] textarea')?.value.includes('Objects:'));
      const yaml = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
      await page.getByRole('dialog', { name: 'Редактор кода схемы' }).getByRole('button').first().click();
      return page.evaluate(async content => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const project = parseYamlScm(content);
        const ids = Object.fromEntries(project.elements.map(element => [element.name, element.id]));
        const nodes = buildCircuitGraph(project.elements, project.wires).pinToNode;
        return {
          wires: project.wires.length,
          automatic: project.elements.filter(element => element.autoCrossing).length,
          provenance: project.wires.filter(wire => wire.originWireId).length,
          anchored: nodes.get(`${ids.spur}_1`) === nodes.get(`${ids.west}_1`),
          dangling: project.wires.some(wire => !project.elements.some(element => element.id === wire.fromCompId) ||
            !project.elements.some(element => element.id === wire.toCompId)),
        };
      }, yaml);
    };
    assert.deepEqual(await state(), { wires: 5, automatic: 0, provenance: 0, anchored: true, dangling: false });
    await page.keyboard.press('Control+z');
    assert.deepEqual(await state(), { wires: 4, automatic: 1, provenance: 4, anchored: false, dangling: false });
    await page.keyboard.press('Control+y');
    assert.deepEqual(await state(), { wires: 5, automatic: 0, provenance: 0, anchored: true, dangling: false });
    const junction = await at(300, 200);
    await page.mouse.move(junction.x, junction.y);
    await page.mouse.down();
    await page.mouse.move(junction.x + 30, junction.y, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.locator('#schematic-world > g[data-component-id][transform="translate(320, 200)"] [data-node-hit]').count(), 1,
      'a three-branch junction remains editable after automatic-to-explicit promotion');
    assert.deepEqual(await state(), { wires: 5, automatic: 0, provenance: 0, anchored: true, dangling: false });
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#schematic-world > g[data-component-id][transform="translate(300, 200)"] [data-node-hit]').count(), 1,
      'one Undo restores the junction position and connected routes');
    assert.deepEqual(await state(), { wires: 5, automatic: 0, provenance: 0, anchored: true, dangling: false });
    assert.deepEqual(errors, []);
    console.log('PASS: a user branch anchors an automatic crossing, with valid SCM and atomic Undo/Redo.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
