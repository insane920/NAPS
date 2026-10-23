const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const fixture = async mode => page.evaluate(async crossingMode => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const resistor = (id, x, y) => ({ id, name: id, type: 'R', x, y, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' });
      const junction = (id, x, y) => ({ id, name: id, type: 'JUNCTION', x, y, rotation: 0, value: 0, valueStr: '', unit: '' });
      const elements = [resistor('A', 100, 200), resistor('B', 500, 200), resistor('BLOCK', 300, 200),
        junction('C', 350, 100), junction('D', 350, 300)];
      const wires = [{ id: 'foreign', fromCompId: 'C', fromPinId: '1', toCompId: 'D', toPinId: '1' },
        { id: 'main', fromCompId: 'A', fromPinId: '2', toCompId: 'B', toPinId: '1' }];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', crossingMode);
    }, mode);
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    for (const mode of ['connect', 'explicit']) {
      await page.locator('input[type="file"]').setInputFiles({ name: `obstacles-${mode}.scm`, mimeType: 'text/plain', buffer: Buffer.from(await fixture(mode)) });
      const main = page.locator('[data-wire-id]').nth(1).locator('path[stroke]').last();
      await main.waitFor();
      const initial = await main.getAttribute('d');
      const result = await page.evaluate(async d => {
        const { componentObstacle, routeIsClear } = await import('/src/utils/orthogonalRouter.ts');
        const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
        const points = []; for (let i = 0; i < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
        const blocker = componentObstacle({ id: 'BLOCK', type: 'R', x: 300, y: 200, rotation: 0 });
        return { points, safe: routeIsClear(points, [blocker], [[{ x: 350, y: 100 }, { x: 350, y: 300 }]]) };
      }, initial);
      assert.equal(result.safe, true, `${mode}: path avoids component body and foreign net`);
      assert.ok(result.points.length >= 4, `${mode}: detour is visible`);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
      const saved = await fs.readFile(await download.path(), 'utf8');
      const topology = await page.evaluate(async content => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const parsed = parseYamlScm(content), graph = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
        const ids = Object.fromEntries(parsed.elements.map(element => [element.name, element.id]));
        return { mode: parsed.crossingMode, distinct: graph.get(`${ids.A}_2`) !== graph.get(`${ids.C}_1`),
          manualPoints: parsed.wires.find(wire => wire.fromCompId === ids.A && wire.toCompId === ids.B)?.waypoints?.length ?? 0 };
      }, saved);
      assert.deepEqual(topology, { mode, distinct: true, manualPoints: 0 }, 'routing changes no electrical endpoint or user point');
      await page.locator('input[type="file"]').setInputFiles({ name: `reopen-${mode}.scm`, mimeType: 'text/plain', buffer: Buffer.from(saved) });
      assert.equal(await main.getAttribute('d'), initial, 'route is deterministic after save/reopen');
      const blocker = page.locator('[data-component-id]').filter({ hasText: 'BLOCK' });
      const origin = await blocker.evaluate(group => {
        const point = group.ownerSVGElement.createSVGPoint(); point.x = 0; point.y = 0;
        const screen = point.matrixTransform(group.getScreenCTM());
        return { x: screen.x, y: screen.y };
      });
      await page.mouse.move(origin.x, origin.y); await page.mouse.down();
      await page.mouse.move(origin.x, origin.y + 100, { steps: 5 }); await page.mouse.up();
      assert.equal(await main.getAttribute('d'), initial, 'a still-safe automatic route does not change after moving a nearby component');
      await page.keyboard.press('Control+z');
      assert.equal(await main.getAttribute('d'), initial, 'undo preserves the route');
    }
    const blockedScm = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [
        { id: 'A', name: 'A', type: 'R', x: 100, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'B', name: 'B', type: 'R', x: 500, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
        { id: 'BLOCK', name: 'BLOCK', type: 'R', x: 169, y: 200, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' },
      ];
      return exportToYamlScm(elements, [], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'blocked.scm', mimeType: 'text/plain', buffer: Buffer.from(blockedScm) });
    await page.keyboard.press('Escape');
    const center = async locator => {
      const box = await locator.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const source = await center(page.locator('[data-component-id]').nth(0).locator('circle[fill="transparent"].cursor-pointer').nth(1));
    const target = await center(page.locator('[data-component-id]').nth(1).locator('circle[fill="transparent"].cursor-pointer').nth(0));
    const dialogs = []; page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    await page.mouse.click(source.x, source.y);
    await page.getByText('Проводка активна: выберите конечный контакт или существующий провод').waitFor();
    await page.mouse.click(target.x, target.y);
    assert.match(dialogs.join(' '), /Не удалось проложить провод/);
    assert.equal(await page.locator('[data-wire-id]').count(), 0, 'blocked wire was not saved');
    const moveScm = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const resistor = (id, x, y) => ({ id, name: id, type: 'R', x, y, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' });
      return exportToYamlScm([resistor('A', 100, 200), resistor('B', 500, 200), resistor('BLOCK', 160, 300)],
        [{ id: 'ab', fromCompId: 'A', fromPinId: '2', toCompId: 'B', toPinId: '1' }],
        SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'move-blocked.scm', mimeType: 'text/plain', buffer: Buffer.from(moveScm) });
    await page.keyboard.press('Escape');
    const movingBlock = page.locator('[data-component-id]').filter({ hasText: 'BLOCK' });
    const beforeMove = await movingBlock.getAttribute('transform');
    const blockCenter = await movingBlock.evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint(); point.x = 0; point.y = 0;
      const screen = point.matrixTransform(group.getScreenCTM());
      return { x: screen.x, y: screen.y, scale: group.getScreenCTM().d };
    });
    await page.mouse.move(blockCenter.x, blockCenter.y); await page.mouse.down();
    await page.mouse.move(blockCenter.x, blockCenter.y - 100 * blockCenter.scale, { steps: 8 }); await page.mouse.up();
    assert.match(dialogs.join(' '), /Перемещение отменено.*нет безопасного маршрута/);
    assert.equal(await movingBlock.getAttribute('transform'), beforeMove, 'impossible move restores component position');
    await page.keyboard.press('Control+z');
    assert.equal(await movingBlock.getAttribute('transform'), beforeMove, 'cancelled move does not enter undo history');
    assert.deepEqual(errors, []);
    console.log('PASS: obstacle detours, safe cancellation, SCM 7/8 topology and round trip.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
