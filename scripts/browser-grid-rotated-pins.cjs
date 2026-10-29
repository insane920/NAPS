const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    for (const step of [1, 2, 2.5, 5]) for (const rotation of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const fixture = await page.evaluate(async ({ step, rotation }) => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        const resistor = (id, x, angle) => ({ id, name: id, type: 'R', x, y: 200, rotation: angle,
          value: 1000, valueStr: '1к', unit: 'Ом' });
        return exportToYamlScm([resistor('R1', 200, rotation), resistor('R2', 600, 0)], [
          { id: 'wire', fromCompId: 'R1', fromPinId: '2', toCompId: 'R2', toPinId: '1',
            routeMode: 'direct', manual: true },
        ], SAMPLE_CIRCUITS[0].transient, undefined,
        { format: 'A4', orientation: 'landscape', gridMm: step }, 'current', 'explicit');
      }, { step, rotation });
      await page.locator('input[type="file"]').setInputFiles({ name: `grid-${step}-${rotation}.scm`,
        mimeType: 'text/plain', buffer: Buffer.from(fixture) });
      await page.locator('[data-wire-id]').first().waitFor({ state: 'attached' });
      const snapshot = await page.evaluate(async content => {
        const path = document.querySelector('[data-wire-id] path')?.getAttribute('d');
        const match = path?.match(/^M\s*([\d.-]+)\s+([\d.-]+).*L\s*([\d.-]+)\s+([\d.-]+)\s*$/);
        const svg = document.querySelector('#schematic-world');
        const circles = [...svg.querySelectorAll('[data-component-id] circle[fill="transparent"].cursor-pointer')];
        const worldPins = circles.map(circle => {
          const point = new DOMPoint(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy')))
            .matrixTransform(circle.getCTM()).matrixTransform(svg.getCTM().inverse());
          return { x: point.x, y: point.y };
        });
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const parsed = parseYamlScm(content);
        const pinToNode = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
        return { path, coordinates: match?.slice(1).map(Number), worldPins, net:
          pinToNode.get('R1_2') === pinToNode.get('R2_1') };
      }, fixture);
      assert.ok(snapshot.coordinates, `${step} mm, ${rotation}°: wire has a visible route (${snapshot.path})`);
      assert.ok(snapshot.worldPins.length >= 4, `${step} mm, ${rotation}°: both rotated contacts render`);
      const [x1, y1, x2, y2] = snapshot.coordinates;
      const from = snapshot.worldPins[1], to = snapshot.worldPins[2];
      assert.ok(Math.hypot(x1 - from.x, y1 - from.y) < .01 &&
        Math.hypot(x2 - to.x, y2 - to.y) < .01,
      `${step} mm, ${rotation}°: visible wire endpoints coincide with physical contacts`);
      assert.ok(snapshot.net, `${step} mm, ${rotation}°: contacts remain one electrical node`);
    }
    const snapPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await snapPage.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    for (const [index, step] of [1, 2, 2.5, 5].entries()) {
      await snapPage.getByRole('combobox', { name: 'Шаг сетки в миллиметрах' }).selectOption(String(step));
      await snapPage.getByRole('button', { name: 'Резистор', exact: true }).first().click();
      const rawX = 307 + index * 120, rawY = 243 + index * 60;
      const screen = await snapPage.locator('#schematic-world').evaluate((world, raw) => {
        const point = new DOMPoint(raw.x, raw.y).matrixTransform(world.getScreenCTM());
        return { x: point.x, y: point.y };
      }, { x: rawX, y: rawY });
      await snapPage.mouse.click(screen.x, screen.y);
      await snapPage.keyboard.press('Escape');
      const gridUnits = step * 4;
      const expected = `translate(${Math.round(rawX / gridUnits) * gridUnits}, ${Math.round(rawY / gridUnits) * gridUnits})`;
      const component = snapPage.locator('[data-component-id]').last();
      assert.equal(await component.getAttribute('transform'), expected, `${step} mm: pointer placement uses the physical grid`);
      await component.click();
      await snapPage.keyboard.press('Shift+r');
      assert.equal(await component.getAttribute('transform'), expected, `${step} mm: rotation keeps the physical center fixed`);
    }
    await snapPage.close();
    assert.deepEqual(errors, []);
    console.log('PASS: four physical grid steps snap placed components; all eight terminal angles retain visible and electrical wire anchors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
