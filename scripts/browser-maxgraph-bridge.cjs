const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 850 }, acceptDownloads: true });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const content = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [
        { id: 'bridge-r1', type: 'R', name: 'R1', x: 100, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'bridge-r2', type: 'R', name: 'R2', x: 400, y: 200, rotation: 0, value: 2000, valueStr: '2к', unit: 'Ом' },
      ];
      const wires = [{ id: 'bridge-wire', fromCompId: 'bridge-r1', fromPinId: '2', toCompId: 'bridge-r2', toPinId: '1' }];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'bridge.scm', mimeType: 'text/plain', buffer: Buffer.from(content) });
    await page.locator('[data-component-id]').first().waitFor();
    await page.getByRole('button', { name: 'Новая проводка' }).click();
    const apply = page.getByRole('button', { name: 'Применить', exact: true });
    await apply.waitFor();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Применить');
      return button && !button.disabled;
    });
    const before = await page.locator('iframe[title="Редактор проводки"]').evaluate(frame => {
      const spike = frame.contentWindow.napsMaxGraphSpike;
      const element = spike.loadedProject.elements.find(item => item.name === 'R1');
      spike.graph.moveCells([spike.loadedCircuit.cells.get(element.id)], 40, 0);
      return { originalX: element.x, editedX: spike.loadedCircuit.exportGeometry().elements.find(item => item.name === 'R1').x };
    });
    assert.equal(before.editedX, before.originalX + 40);
    await apply.click();
    await page.getByRole('dialog', { name: 'Новая проводка' }).waitFor({ state: 'hidden' });
    const [download] = await Promise.all([
      page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click(),
    ]);
    const saved = await fs.readFile(await download.path(), 'utf8');
    const result = await page.evaluate(async text => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const project = parseYamlScm(text);
      return { x: project.elements.find(item => item.name === 'R1').x,
        elements: project.elements.length, wires: project.wires.length, mode: project.crossingMode };
    }, saved);
    assert.deepEqual(result, { x: 140, elements: 2, wires: 1, mode: 'connect' });
    const savedX = async () => {
      const [file] = await Promise.all([
        page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click(),
      ]);
      const text = await fs.readFile(await file.path(), 'utf8');
      return page.evaluate(async scm => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        return parseYamlScm(scm).elements.find(element => element.name === 'R1').x;
      }, text);
    };
    await page.keyboard.press('Control+z');
    assert.equal(await savedX(), 100, 'one App Undo restores the original component coordinate');
    await page.keyboard.press('Control+y');
    assert.equal(await savedX(), 140, 'one App Redo restores the maxGraph edit');
    await page.getByRole('button', { name: 'Новая проводка' }).click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Применить');
      return button && !button.disabled;
    });
    await page.locator('iframe[title="Редактор проводки"]').evaluate(frame => {
      const spike = frame.contentWindow.napsMaxGraphSpike;
      const element = spike.loadedProject.elements.find(item => item.name === 'R1');
      spike.graph.moveCells([spike.loadedCircuit.cells.get(element.id)], 60, 0);
    });
    await page.getByRole('button', { name: 'Закрыть без изменений' }).click();
    assert.equal(await savedX(), 140, 'closing the wiring window discards uncommitted changes');
    const branchFixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [
        { id: 'r1', type: 'R', name: 'R1', x: 100, y: 220, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'r2', type: 'R', name: 'R2', x: 400, y: 220, rotation: 0, value: 2000, valueStr: '2к', unit: 'Ом' },
        { id: 'r3', type: 'R', name: 'R3', x: 250, y: 80, rotation: 0, value: 3000, valueStr: '3к', unit: 'Ом' },
      ];
      const wires = [{ id: 'trunk', fromCompId: 'r1', fromPinId: '2', toCompId: 'r2', toPinId: '1' }];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'branch.scm', mimeType: 'text/plain', buffer: Buffer.from(branchFixture) });
    await page.getByRole('button', { name: 'Новая проводка' }).click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Применить');
      return button && !button.disabled;
    });
    const frame = page.locator('iframe[title="Редактор проводки"]');
    const frameBox = await frame.boundingBox();
    const drag = await frame.evaluate(iframe => {
      const spike = iframe.contentWindow.napsMaxGraphSpike;
      const graph = spike.graph;
      const source = [...spike.loadedCircuit.ports.values()].find(port => port.getParent().getValue() === 'R3');
      const state = graph.view.getState(source);
      const route = graph.view.getState([...spike.loadedCircuit.edges.values()][0]).absolutePoints;
      const canvas = iframe.contentDocument.getElementById('canvas').getBoundingClientRect();
      return { from: { x: canvas.left + state.x + state.width / 2,
        y: canvas.top + state.y + state.height / 2 },
        to: { x: canvas.left + (route[0].x + route.at(-1).x) / 2 - 40,
          y: canvas.top + route[0].y } };
    });
    await page.frameLocator('iframe[title="Редактор проводки"]').locator('#tool-wire').click();
    await page.mouse.move(frameBox.x + drag.from.x, frameBox.y + drag.from.y);
    await page.mouse.down();
    await page.mouse.move(frameBox.x + drag.to.x, frameBox.y + drag.to.y, { steps: 12 });
    await page.mouse.up();
    const inside = await frame.evaluate(iframe => {
      const geometry = iframe.contentWindow.napsMaxGraphSpike.loadedCircuit.exportGeometry();
      return { junctions: geometry.elements.filter(element => element.type === 'JUNCTION').length,
        wires: geometry.wires.length };
    });
    assert.deepEqual(inside, { junctions: 1, wires: 3 }, 'new workbench creates a real T branch');
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await page.getByRole('dialog', { name: 'Новая проводка' }).waitFor({ state: 'hidden' });
    const [branchDownload] = await Promise.all([
      page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click(),
    ]);
    const branchSaved = await fs.readFile(await branchDownload.path(), 'utf8');
    const branchResult = await page.evaluate(async text => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const project = parseYamlScm(text);
      const ids = Object.fromEntries(project.elements.map(element => [element.name, element.id]));
      const networks = buildCircuitGraph(project.elements, project.wires).pinToNode;
      return { junctions: project.elements.filter(element => element.type === 'JUNCTION').length,
        wires: project.wires.length, joined: networks.get(`${ids.R1}_2`) === networks.get(`${ids.R3}_1`) };
    }, branchSaved);
    assert.deepEqual(branchResult, { junctions: 1, wires: 3, joined: true },
      'applied T branch remains electrically connected after saving SCM');
    assert.deepEqual(errors, []);
    console.log('PASS: maxGraph edits the open NAPS project, applies through SCM validation and remains undoable.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
