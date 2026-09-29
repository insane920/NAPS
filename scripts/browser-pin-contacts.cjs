const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

async function screenCenter(locator) {
  return locator.evaluate(circle => {
    const point = circle.ownerSVGElement.createSVGPoint();
    point.x = Number(circle.getAttribute('cx'));
    point.y = Number(circle.getAttribute('cy'));
    const result = point.matrixTransform(circle.getScreenCTM());
    return { x: result.x, y: result.y };
  });
}

async function worldPoint(page, x, y) {
  return page.locator('#schematic-world').evaluate((world, [worldX, worldY]) => {
    const point = world.ownerSVGElement.createSVGPoint();
    point.x = worldX;
    point.y = worldY;
    const result = point.matrixTransform(world.getScreenCTM());
    return { x: result.x, y: result.y };
  }, [x, y]);
}

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const canvas = page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last();
    const bounds = await canvas.boundingBox();
    assert(bounds);
    const components = page.locator('#schematic-world > g[transform^="translate"]');
    const wires = page.locator('#schematic-world path[stroke="transparent"]');
    const pin = (component, terminal) => components.nth(component).locator('circle[fill="transparent"].cursor-pointer').nth(terminal);
    const placeResistor = async (x, y) => {
      await page.getByRole('button', { name: 'Резистор' }).first().click();
      await page.mouse.click(bounds.x + x, bounds.y + y);
    };
    const dragPinToPin = async (source, target) => {
      const from = await screenCenter(source);
      const to = await screenCenter(target);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
    };

    await placeResistor(260, 170);
    await placeResistor(560, 270);
    assert.equal(await components.count(), 2);
    assert.equal(await page.getByRole('button', { name: 'Проводка', exact: true }).count(), 0, 'wiring has no mode switch');

    const source = pin(0, 1);
    const target = pin(1, 0);
    const from = await screenCenter(source);
    const to = await screenCenter(target);
    await page.mouse.move(from.x, from.y);
    await components.nth(0).locator('circle[stroke="#059669"]').waitFor();
    await page.screenshot({ path: '.work/browser-pin-hover.png' });
    await page.mouse.down();
    await page.getByText('Проводка активна: выберите конечный контакт или существующий провод').waitFor();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
    assert.equal(await page.locator('#schematic-world path[stroke-dasharray="4 3"]').count(), 1, 'wire preview follows the cursor');
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await components.nth(1).locator('circle[stroke="#059669"]').waitFor();
    await page.mouse.up();
    assert.equal(await wires.count(), 1, 'dragging from an ordinary-mode contact creates a wire');
    await page.screenshot({ path: '.work/browser-pin-connected.png' });

    await page.mouse.click(from.x, from.y);
    assert.equal(await page.locator('#schematic-world path[stroke-dasharray="4 3"]').count(), 1);
    await page.mouse.click(bounds.x + 100, bounds.y + 500, { button: 'right' });
    assert.equal(await page.locator('#schematic-world path[stroke-dasharray="4 3"]').count(), 0, 'right click cancels the pending wire');

    await placeResistor(780, 380);
    await dragPinToPin(pin(0, 1), pin(2, 0));
    assert.equal(await wires.count(), 2, 'one terminal accepts multiple wires');
    await dragPinToPin(pin(0, 1), pin(1, 0));
    assert.equal(await wires.count(), 2, 'repeating the same pair does not create a duplicate');

    const wireSegment = await worldPoint(page, 600, 360);
    await page.mouse.click(wireSegment.x, wireSegment.y);
    await page.keyboard.press('Delete');
    assert.equal(await wires.count(), 1, 'selected wire can be deleted');
    await dragPinToPin(pin(0, 1), pin(2, 0));
    assert.equal(await wires.count(), 2, 'deleted connection can be restored');

    await page.getByRole('button', { name: 'Увеличить масштаб' }).click();
    const zoomedPin = await screenCenter(pin(1, 1));
    await page.mouse.move(zoomedPin.x, zoomedPin.y);
    await components.nth(1).locator('circle[stroke="#059669"]').waitFor();
    await dragPinToPin(pin(1, 1), pin(2, 1));
    assert.equal(await wires.count(), 3, 'contacts remain interactive after zooming');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Сохранить' }).click(),
    ]);
    const scm = await fs.readFile(await download.path(), 'utf8');
    const graph = await page.evaluate(async content => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(content);
      const nodes = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      const ids = Object.fromEntries(parsed.elements.map(element => [element.name, element.id]));
      return {
        wireCount: parsed.wires.length,
        sharedInputNode: [ids.R1, ids.R2, ids.R3].map((id, index) => nodes.get(`${id}_${index === 0 ? 2 : 1}`)),
        sharedOutputNode: [ids.R2, ids.R3].map(id => nodes.get(`${id}_2`)),
      };
    }, scm);
    assert.equal(graph.wireCount, 3);
    assert.equal(new Set(graph.sharedInputNode).size, 1, 'saved connections form one electrical input node');
    assert.equal(new Set(graph.sharedOutputNode).size, 1, 'saved connections form one electrical output node');

    const catalogueFixture = await page.evaluate(async () => {
      const { COMPONENT_CATALOG } = await import('/src/components/ComponentPalette.tsx');
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const types = [...COMPONENT_CATALOG.map(item => item.type).filter(type => type !== 'TEXT'), 'PORT'];
      const elements = types.map((type, index) => ({
        id: `pin_test_${index}`, type, name: `${type}_${index + 1}`,
        x: 120 + (index % 4) * 220, y: 100 + Math.floor(index / 4) * 125,
        rotation: 0, value: 1, valueStr: '1', unit: '',
        ...(type === 'PORT' ? { portName: 'TEST' } : {}),
      }));
      return { types, content: exportToYamlScm(elements, [], SAMPLE_CIRCUITS[0].transient) };
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: 'all-terminals.scm', mimeType: 'text/plain', buffer: Buffer.from(catalogueFixture.content),
    });
    await page.getByText('all-terminals', { exact: true }).waitFor();
    assert.equal(await components.count(), catalogueFixture.types.length);
    let checkedPins = 0;
    for (let index = 0; index < catalogueFixture.types.length; index++) {
      const type = catalogueFixture.types[index];
      if (type === 'JUNCTION') continue;
      const hitTargets = components.nth(index).locator('circle[fill="transparent"].cursor-pointer');
      const count = await hitTargets.count();
      assert(count > 0, `${type} has clickable terminals`);
      for (let terminal = 0; terminal < count; terminal++) {
        const center = await screenCenter(hitTargets.nth(terminal));
        await page.mouse.move(center.x, center.y);
        await components.nth(index).locator('circle[stroke="#059669"]').waitFor({ timeout: 2000 });
        checkedPins++;
      }
    }
    const junctionIndex = catalogueFixture.types.indexOf('JUNCTION');
    const junctionCenter = await components.nth(junctionIndex).evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint();
      const result = point.matrixTransform(group.getScreenCTM());
      return { x: result.x, y: result.y };
    });
    await page.mouse.move(junctionCenter.x, junctionCenter.y);
    await components.nth(junctionIndex).locator('circle[stroke="#2563eb"]').waitFor({ timeout: 2000 });
    const firstTerminal = await screenCenter(pin(0, 0));
    await page.mouse.down();
    await page.mouse.move(firstTerminal.x, firstTerminal.y, { steps: 8 });
    await page.mouse.up();
    assert.equal(await wires.count(), 1, 'junction starts a wire without a toolbar mode');
    assert.deepEqual(errors, [], 'browser must not report uncaught errors');
    console.log(`PASS: default-mode hover on ${checkedPins} terminals and a junction across ${catalogueFixture.types.length} types, drag wiring, fan-out, duplicate guard, deletion, reconnection, zoom and saved electrical nodes.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
