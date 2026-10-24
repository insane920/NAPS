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
    const scm = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [['left', 100], ['a', 300], ['b', 320], ['right', 500]].map(([id, x]) => ({
        id, name: id, type: 'JUNCTION', x, y: 200, rotation: 0, value: 0, valueStr: '', unit: '',
      }));
      const wires = [
        { id: 'one', fromCompId: 'left', fromPinId: '1', toCompId: 'a', toPinId: '1', routeMode: 'direct' },
        { id: 'two', fromCompId: 'b', fromPinId: '1', toCompId: 'right', toPinId: '1', routeMode: 'direct' },
      ];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient,
        undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'junction-move.scm',
      mimeType: 'text/plain', buffer: Buffer.from(scm) });
    await page.waitForFunction(() => document.querySelectorAll('[data-node-hit]').length === 4);
    const junction = page.locator('#schematic-world > g[data-component-id][transform="translate(320, 200)"]');
    const point = await junction.evaluate(group => {
      const position = new DOMPoint(0, 0).matrixTransform(group.getScreenCTM());
      return { x: position.x, y: position.y };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 20, point.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('[data-node-hit]').length === 3);
    const sameNetwork = async () => {
      await page.getByRole('button', { name: 'Редактор файла схемы' }).click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"] textarea')?.value.includes('Objects:'));
      const content = await page.getByRole('dialog', { name: 'Редактор кода схемы' }).locator('textarea').inputValue();
      await page.getByRole('dialog', { name: 'Редактор кода схемы' }).getByRole('button').first().click();
      return page.evaluate(async yaml => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const project = parseYamlScm(yaml);
        const graph = buildCircuitGraph(project.elements, project.wires);
        const left = project.elements.find(element => element.name === 'left');
        const right = project.elements.find(element => element.name === 'right');
        return graph.pinToNode.get(`${left.id}_1`) === graph.pinToNode.get(`${right.id}_1`);
      }, content);
    };
    assert.equal(await sameNetwork(), true, 'the visible merged junction also merges electrical nets');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('[data-node-hit]').length === 4);
    assert.equal(await sameNetwork(), false, 'Undo splits the electrical nets again');
    assert.deepEqual(errors, []);
    console.log('PASS: SCM 8 drag merges coincident junctions, and one Undo restores both nodes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
