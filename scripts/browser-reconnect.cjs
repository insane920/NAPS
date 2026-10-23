const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

const center = locator => locator.evaluate(node => {
  const point = node.ownerSVGElement.createSVGPoint();
  point.x = Number(node.getAttribute('cx')); point.y = Number(node.getAttribute('cy'));
  const result = point.matrixTransform(node.getScreenCTM());
  return { x: result.x, y: result.y };
});

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [[200, 180], [500, 180], [500, 340]].map(([x, y], index) => ({
        id: `r${index + 1}`, name: `R${index + 1}`, type: 'R', x, y, rotation: 0,
        value: 1000, valueStr: '1к', unit: 'Ом',
      }));
      const wires = [{ id: 'link', fromCompId: 'r1', fromPinId: '2', toCompId: 'r2', toPinId: '1',
        routeMode: 'direct', waypoints: [{ x: 340, y: 180 }], manual: true }];
      return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'reconnect.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    const parts = page.locator('[data-component-id]');
    const pin = (component, terminal) => parts.nth(component).locator('circle[fill="transparent"].cursor-pointer').nth(terminal);
    const first = await center(pin(0, 1)); const old = await center(pin(1, 0)); const next = await center(pin(2, 0));
    await page.mouse.click((first.x + old.x) / 2, first.y);
    const handle = page.locator('[data-wire-end$=":to"]');
    await handle.waitFor();
    const start = await center(handle);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(next.x, next.y, { steps: 6 });
    await page.locator('[data-reconnect-preview="true"]').waitFor();
    await page.mouse.up();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const content = await fs.readFile(await download.path(), 'utf8');
    const result = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const parsed = parseYamlScm(scm);
      const names = Object.fromEntries(parsed.elements.map(element => [element.name, element.id]));
      const nodes = buildCircuitGraph(parsed.elements, parsed.wires).pinToNode;
      return { mode: parsed.crossingMode, destination: parsed.wires[0].toCompId === names.R3,
        oldSeparated: nodes.get(`${names.R1}_2`) !== nodes.get(`${names.R2}_1`),
        bends: parsed.wires[0].waypoints?.length };
    }, content);
    assert.deepEqual(result, { mode: 'connect', destination: true, oldSeparated: true, bends: 1 });
    await page.keyboard.press('Control+z');
    const [undoneDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const undoneScm = await fs.readFile(await undoneDownload.path(), 'utf8');
    const undoneTarget = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const parsed = parseYamlScm(scm);
      return parsed.elements.find(element => element.id === parsed.wires[0].toCompId)?.name;
    }, undoneScm);
    assert.equal(undoneTarget, 'R2', 'one undo restores the old endpoint');
    await page.keyboard.press('Control+y');
    await page.mouse.click(first.x + 30, first.y);
    const restoredHandle = page.locator('[data-wire-end$=":to"]');
    await restoredHandle.waitFor();
    const attachedEnd = await center(restoredHandle);
    await page.mouse.move(attachedEnd.x, attachedEnd.y); await page.mouse.down();
    await page.mouse.move(attachedEnd.x + 70, attachedEnd.y + 70, { steps: 4 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    const [cancelDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const cancelled = await fs.readFile(await cancelDownload.path(), 'utf8');
    assert.doesNotMatch(cancelled, /Disabled: true/, 'Escape cancels without changing electrical topology');
    await page.mouse.click(first.x + 30, first.y);
    const detachHandle = page.locator('[data-wire-end$=":to"]');
    await detachHandle.waitFor();
    const detachStart = await center(detachHandle);
    await page.mouse.move(detachStart.x, detachStart.y); await page.mouse.down();
    await page.mouse.move(detachStart.x + 70, detachStart.y + 70, { steps: 4 }); await page.mouse.up();
    const [detachDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const detached = await fs.readFile(await detachDownload.path(), 'utf8');
    assert.match(detached, /Disabled: true/, 'free end is saved as a disabled grey connection');
    const blockedFixture = await page.evaluate(async scm => {
      const { parseYamlScm, exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const parsed = parseYamlScm(scm);
      parsed.elements.push({ id: 'blocking-r4', name: 'R4', type: 'R', x: 420, y: 280,
        rotation: 0, value: 1000, valueStr: '1к', unit: 'Ом' });
      return exportToYamlScm(parsed.elements, parsed.wires, parsed.transient,
        parsed.ac, parsed.printLayout, 'current', 'connect');
    }, fixture);
    await page.locator('input[type="file"]').setInputFiles({ name: 'blocked-reconnect.scm',
      mimeType: 'text/plain', buffer: Buffer.from(blockedFixture) });
    const blockedPin = (component, terminal) => page.locator('[data-component-id]').nth(component)
      .locator('circle[fill="transparent"].cursor-pointer').nth(terminal);
    const blockedFirst = await center(blockedPin(0, 1));
    const blockedOld = await center(blockedPin(1, 0));
    const blockedNext = await center(blockedPin(2, 0));
    await page.mouse.click((blockedFirst.x + blockedOld.x) / 2, blockedFirst.y);
    const blockedHandle = page.locator('[data-wire-end$=":to"]');
    await blockedHandle.waitFor();
    const blockedStart = await center(blockedHandle);
    const alert = page.waitForEvent('dialog').then(async warning => {
      const message = warning.message();
      await warning.accept();
      return message;
    });
    await page.mouse.move(blockedStart.x, blockedStart.y); await page.mouse.down();
    await page.mouse.move(blockedNext.x, blockedNext.y, { steps: 6 }); await page.mouse.up();
    assert.match(await alert, /Переподключение отменено/);
    const [blockedDownload] = await Promise.all([page.waitForEvent('download'),
      page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
    const blockedScm = await fs.readFile(await blockedDownload.path(), 'utf8');
    const preserved = await page.evaluate(async scm => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const parsed = parseYamlScm(scm);
      return parsed.elements.find(element => element.id === parsed.wires[0].toCompId)?.name;
    }, blockedScm);
    assert.equal(preserved, 'R2', 'blocked reconnection leaves the old electrical endpoint intact');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: endpoint preview, pin reconnection, blocked-route cancellation, free disconnection, Escape, SCM 8 topology, preserved bend and atomic Undo/Redo.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
