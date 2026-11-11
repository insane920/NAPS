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
    for (const mode of ['connect', 'explicit']) {
      const movedNetworkScm = await page.evaluate(async crossingMode => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        const resistor = (id, x, y) => ({ id, name: id, type: 'R', x, y, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' });
        const junction = (id, x, y) => ({ id, name: id, type: 'JUNCTION', x, y, rotation: 0, value: 0, valueStr: '', unit: '' });
        const elements = [resistor('A', 100, 550), resistor('B', 500, 550), junction('C', 300, 600), junction('D', 300, 700)];
        const wires = [
          { id: 'main', fromCompId: 'A', fromPinId: '2', toCompId: 'B', toPinId: '1' },
          { id: 'moving', fromCompId: 'C', fromPinId: '1', toCompId: 'D', toPinId: '1' },
        ];
        return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', crossingMode);
      }, mode);
      await page.locator('input[type="file"]').setInputFiles({ name: `moving-network-${mode}.scm`, mimeType: 'text/plain', buffer: Buffer.from(movedNetworkScm) });
      await page.keyboard.press('Escape');
      const movingJunction = page.locator('[data-component-id]').nth(2);
      const beforeRoutes = await page.locator('[data-wire-id] path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
      const center = await movingJunction.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f, scale: group.getScreenCTM().d }));
      await page.mouse.move(center.x, center.y); await page.mouse.down();
      await page.mouse.move(center.x, center.y - 100 * center.scale, { steps: 8 }); await page.mouse.up();
      const afterRoutes = await page.locator('[data-wire-id] path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
      const result = await page.evaluate(async () => {
        const { routeIsClear } = await import('/src/utils/orthogonalRouter.ts');
        const routes = [...document.querySelectorAll('[data-wire-id] path[stroke="transparent"]')].map(path => {
          const numbers = [...path.getAttribute('d').matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
          return Array.from({ length: numbers.length / 2 }, (_, i) => ({ x: numbers[i * 2], y: numbers[i * 2 + 1] }));
        });
        return { clear: routeIsClear(routes[0], [], [routes[1]]), routes };
      });
      assert.equal(result.clear, true, `${mode}: moving another net must reroute without creating a short`);
      assert.equal(afterRoutes[0], beforeRoutes[0], `${mode}: unaffected network stays still`);
      for (let repeat = 0; repeat < 10; repeat++) {
        const current = await movingJunction.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f, scale: group.getScreenCTM().d }));
        await page.mouse.move(current.x, current.y); await page.mouse.down();
        await page.mouse.move(current.x, current.y + 100 * current.scale, { steps: 3 }); await page.mouse.up();
        assert.deepEqual(await page.locator('[data-wire-id] path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d'))),
          beforeRoutes, `${mode}: return ${repeat + 1} restores the original geometry`);
        const back = await movingJunction.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f, scale: group.getScreenCTM().d }));
        await page.mouse.move(back.x, back.y); await page.mouse.down();
        await page.mouse.move(back.x, back.y - 100 * back.scale, { steps: 3 }); await page.mouse.up();
        assert.deepEqual(await page.locator('[data-wire-id] path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d'))),
          afterRoutes, `${mode}: repeated crossing ${repeat + 1} adds no bends`);
      }
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
      const saved = await fs.readFile(await download.path(), 'utf8');
      const distinct = await page.evaluate(async scm => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
        const data = parseYamlScm(scm), graph = buildCircuitGraph(data.elements, data.wires).pinToNode;
        const ids = Object.fromEntries(data.elements.map(element => [element.name, element.id]));
        return graph.get(`${ids.A}_2`) !== graph.get(`${ids.C}_1`);
      }, saved);
      assert.equal(distinct, true, `${mode}: movement preserves electrical separation`);
      await page.keyboard.press('Control+z');
      assert.deepEqual(await page.locator('[data-wire-id] path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d'))), beforeRoutes);
      await page.keyboard.press('Control+y');
      assert.deepEqual(await page.locator('[data-wire-id] path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d'))), afterRoutes);
      await page.locator('input[type="file"]').setInputFiles({ name: `moving-network-reopen-${mode}.scm`, mimeType: 'text/plain', buffer: Buffer.from(saved) });
      assert.deepEqual(await page.locator('[data-wire-id] path[stroke="transparent"]').evaluateAll(paths => paths.map(path => path.getAttribute('d'))), afterRoutes);
    }
    const damagedScm = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const resistor = (id, x) => ({ id, name: id, type: 'R', x, y: 200, rotation: 0,
        value: 1000, valueStr: '1к', unit: 'Ом' });
      return exportToYamlScm([resistor('A', 100), resistor('B', 500), resistor('BLOCK', 300)],
        [{ id: 'damaged-wire', fromCompId: 'A', fromPinId: '2', toCompId: 'B', toPinId: '1', routeMode: 'direct' }],
        SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'damaged.scm', mimeType: 'text/plain', buffer: Buffer.from(damagedScm) });
    assert.match(await page.getByRole('alert').innerText(), /провод A\.2 → B\.1 \(ID [^)]+\)/,
      'opening an obstructed SCM 8 warns immediately and identifies the connection');
    assert.equal(await page.locator('[data-wire-id]').count(), 1, 'the warning leaves the conductor available for repair');
    const [damagedDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const damagedSaved = await fs.readFile(await damagedDownload.path(), 'utf8');
    assert.equal(await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const data = parseYamlScm(scm);
      return data.crossingMode === 'connect' && data.wires.length === 1 && data.wires[0].routeMode === 'direct';
    }, damagedSaved), true, 'saving the damaged document retains SCM 8 semantics and wire data');
    const damagedFingerprint = await page.evaluate(async ({ original, saved }) => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const fingerprint = scm => {
        const data = parseYamlScm(scm), names = new Map(data.elements.map(e => [e.id, e.name]));
        const graph = buildCircuitGraph(data.elements, data.wires).pinToNode;
        const pins = data.elements.flatMap(e => ['1', '2'].map(pin => ({ key: `${e.id}_${pin}`, name: `${e.name}:${pin}` })));
        return { mode: data.crossingMode,
          elements: data.elements.map(({ name, type, x, y }) => ({ name, type, x, y })),
          wires: data.wires.map(w => ({ from: `${names.get(w.fromCompId)}:${w.fromPinId}`,
            to: `${names.get(w.toCompId)}:${w.toPinId}`, routeMode: w.routeMode, waypoints: w.waypoints })),
          connectedPairs: pins.flatMap((a, i) => pins.slice(i + 1).filter(b => graph.get(a.key) === graph.get(b.key))
            .map(b => `${a.name}|${b.name}`)) };
      };
      return { before: fingerprint(original), after: fingerprint(saved) };
    }, { original: damagedScm, saved: damagedSaved });
    assert.deepEqual(damagedFingerprint.after, damagedFingerprint.before,
      'damaged SCM 8 save preserves components, route and exact electrical partition');
    await page.locator('input[type="file"]').setInputFiles({ name: 'damaged-reopened.scm',
      mimeType: 'text/plain', buffer: Buffer.from(damagedSaved) });
    assert.match(await page.getByRole('alert').innerText(), /провод A\.2 → B\.1/,
      'reopening the unchanged damaged route reports the same defect');
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
    assert.deepEqual(dialogs, [], 'the narrow but open corridor is routed without a false refusal');
    assert.equal(await page.locator('[data-wire-id]').count(), 1, 'new valid corridor survives drawing');
    const narrowPath = await page.locator('[data-wire-id] path[stroke="transparent"]').first().getAttribute('d');
    assert.ok(narrowPath && narrowPath.split(' L ').length >= 4, 'the corridor has a visible orthogonal detour');
    const [narrowDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const narrowScm = await fs.readFile(await narrowDownload.path(), 'utf8');
    assert.equal(await page.evaluate(async scm => { const {parseYamlScm}=await import('/src/utils/yamlScm.ts'); const {buildCircuitGraph}=await import('/src/math/circuitSolver.ts'); const data=parseYamlScm(scm), graph=buildCircuitGraph(data.elements,data.wires); return graph.pinToNode.get(data.elements[0].id+'_2')===graph.pinToNode.get(data.elements[1].id+'_1'); },narrowScm), true, 'the visible narrow detour has a real electrical connection');
    const moveScm = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const resistor = (id, x, y) => ({ id, name: id, type: 'R', x, y, rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' });
      return exportToYamlScm([resistor('A', 100, 200), resistor('B', 500, 200), resistor('BLOCK', 140, 300)],
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
    for (const mode of ['explicit', 'connect']) {
      const keyboardFixture = await page.evaluate(async ({ scm, mode }) => {
        const { parseYamlScm, exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const parsed = parseYamlScm(scm);
        return exportToYamlScm(parsed.elements, parsed.wires, parsed.transient,
          parsed.ac, parsed.printLayout, 'current', mode);
      }, { scm: moveScm, mode });
      await page.locator('input[type="file"]').setInputFiles({ name: `keyboard-${mode}.scm`,
        mimeType: 'text/plain', buffer: Buffer.from(keyboardFixture) });
      const point = await movingBlock.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f }));
      await page.mouse.click(point.x, point.y);
      for (let step = 0; step < 4; step++) {
        await page.keyboard.press('ArrowUp');
        const position = 'translate(140, ' + (280 - step * 20) + ')';
        await page.waitForFunction(expected => [...document.querySelectorAll('[data-component-id]')]
          .some(node => node.textContent.includes('BLOCK') && node.getAttribute('transform') === expected), position);
      }
      const rejectedKeyMove = page.waitForEvent('dialog', { timeout: 5000 });
      await page.keyboard.press('ArrowUp');
      await rejectedKeyMove;
      assert.equal(await movingBlock.getAttribute('transform'), 'translate(140, 220)',
        `${mode}: keyboard movement rejects the blocked fifth step`);
      assert.match(dialogs.at(-1), /Изменение отменено.*нет безопасного маршрута/);
      await page.keyboard.press('Control+z');
      assert.equal(await movingBlock.getAttribute('transform'), 'translate(140, 240)',
        `${mode}: cancelled keyboard step does not consume an undo entry`);
      const drag = await movingBlock.evaluate(group => ({ x: group.getScreenCTM().e,
        y: group.getScreenCTM().f, scale: group.getScreenCTM().d }));
      await page.mouse.move(drag.x, drag.y); await page.mouse.down();
      await page.mouse.move(drag.x, drag.y - 40 * drag.scale, { steps: 4 }); await page.mouse.up();
      assert.equal(await movingBlock.getAttribute('transform'), 'translate(140, 240)',
        `${mode}: blocked drag rolls back after Undo`);
      await page.keyboard.press('Control+y');
      assert.equal(await movingBlock.getAttribute('transform'), 'translate(140, 220)',
        `${mode}: rejected drag preserves the pre-existing Redo stack`);
      const rotateFixture = await page.evaluate(async ({ scm, mode }) => {
        const { parseYamlScm, exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const parsed = parseYamlScm(scm);
        const blocker = parsed.elements.find(element => element.name === 'BLOCK');
        blocker.x = 100; blocker.y = 240;
        return exportToYamlScm(parsed.elements, parsed.wires, parsed.transient,
          parsed.ac, parsed.printLayout, 'current', mode);
      }, { scm: moveScm, mode });
      await page.locator('input[type="file"]').setInputFiles({ name: `rotate-${mode}.scm`,
        mimeType: 'text/plain', buffer: Buffer.from(rotateFixture) });
      const sourceElement = page.locator('[data-component-id]').first();
      const initialTransform = await sourceElement.getAttribute('transform');
      const initialSymbol = await sourceElement.locator('g[transform^="rotate("]').getAttribute('transform');
      const sourceCenter = await sourceElement.evaluate(group => ({ x: group.getScreenCTM().e, y: group.getScreenCTM().f }));
      await page.mouse.click(sourceCenter.x, sourceCenter.y);
      await page.keyboard.press('r');
      assert.match(dialogs.at(-1), /Изменение отменено.*нет безопасного маршрута/);
      assert.equal(await sourceElement.getAttribute('transform'), initialTransform,
        `${mode}: rotation with a blocked terminal rolls back`);
      assert.equal(await sourceElement.locator('g[transform^="rotate("]').getAttribute('transform'), initialSymbol,
        `${mode}: rejected rotation restores the symbol and pin orientation`);
      assert.equal(await page.locator('[data-wire-id]').count(), 1, `${mode}: rejected rotation preserves the conductor`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: obstacle detours, safe cancellation, SCM 7/8 topology and round trip.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
