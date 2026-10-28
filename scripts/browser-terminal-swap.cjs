const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    let lastDownload = 0;
    async function save() {
      const delay = 150 - (Date.now() - lastDownload);
      if (delay > 0) await page.waitForTimeout(delay);
      try {
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
        lastDownload = Date.now();
        return fs.readFile(await download.path(), 'utf8');
      } catch (error) {
        console.error('Save diagnostic', { url: page.url(), error: await page.locator('.error-banner').allTextContents(), status: await page.locator('.status-text').allTextContents(), dialogs });
        await page.screenshot({ path: '.work/terminal-swap-failure.png' }); throw error;
      }
    }
    const evaluate = text => page.evaluate(async text => {
      const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
      const { solveCircuitTransient, solveCircuitAC, buildCircuitGraph } = await import('/src/math/circuitSolver.ts');
      const { solveDCOperatingPoint } = await import('/src/math/dcOperatingPoint.ts');
      const { getComponentPins } = await import('/src/components/SchematicEditor.tsx');
      const data = parseYamlScm(text), graph = buildCircuitGraph(data.elements, data.wires);
      const load = data.elements.find(e => e.name === 'LOAD'), src = data.elements.find(e => e.name === 'SRC');
      const dc = solveDCOperatingPoint(data.elements, data.wires);
      const acSettings = { fMin: 10, fMax: 100, points: 2, scaleType: 'log', signals: [
        { id: 'mag', exprX: 'f', exprY: 'mag(U(LOAD))', plotIndex: 1, color: '#000', enabled: true },
        { id: 'phase', exprX: 'f', exprY: 'phs(U(LOAD))', plotIndex: 2, color: '#000', enabled: true },
      ] };
      let ac = null, acDiagnostic = null;
      try { ac = solveCircuitAC(data.elements, data.wires, acSettings); }
      catch (error) { if (src.type.endsWith('AC')) throw error; acDiagnostic = error.message; }
      return {
        initial: solveCircuitTransient(data.elements, data.wires, data.transient).signals['U(LOAD)'][0],
        dc: dc.potentials.get(graph.pinToNode.get(`${load.id}_1`)), mag: ac?.signals['mag(U(LOAD))'][0] ?? null, phase: ac?.signals['phs(U(LOAD))'][0] ?? null, acDiagnostic,
        endpoints: data.wires.map(w => {
          const endpoint = (id, pinId) => { const e = data.elements.find(e => e.id === id), pin = getComponentPins(e).find(p => p.id === pinId); return [e.x + pin.x, e.y + pin.y]; };
          return [endpoint(w.fromCompId, w.fromPinId), endpoint(w.toCompId, w.toPinId), w.waypoints];
        }), flipH: !!src.flipH, nodes: graph.nodeCount,
      };
    }, text);
    for (const mode of ['explicit', 'connect']) for (const type of ['V_DC', 'V_AC', 'V_PULSE', 'I_DC', 'I_AC', 'I_PULSE']) {
      console.log(`Terminal swap: ${type}, ${mode}`);
      const fixture = await page.evaluate(async ({ mode, type }) => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const e = (id, type, value, x, y) => ({ id, name: id, type, value, valueStr: String(value), unit: '', x, y, rotation: 0 });
        const elements = [{ ...e('SRC', type, 2, 200, 200), secondaryValue: 50, modelParams: { sourceOffset: 1, sourcePhaseDeg: 0, pulseLow: .5, pulseHigh: 2, pulseDelay: .001 } }, e('LOAD', 'R', 100, 500, 200), e('G0', 'GND', 0, 500, 400)];
        const w = (id, a, ap, b, bp, points) => ({ id, fromCompId: a, fromPinId: ap, toCompId: b, toPinId: bp, manual: true, waypoints: points.map(([x, y]) => ({ x, y })) });
        const wires = [w('high', 'SRC', '1', 'LOAD', '1', [[140, 200], [140, 100], [440, 100], [440, 200]]),
          w('low', 'SRC', '2', 'G0', '1', [[260, 200], [260, 300], [500, 300]]),
          w('ground', 'LOAD', '2', 'G0', '1', [[560, 200], [560, 340], [500, 340]])];
        const settings = { tMax: .002, tMaxStr: '.002', step: .001, stepStr: '.001', eps: .001, signals: [{ id: 'out', exprX: 't', exprY: 'U(LOAD)', enabled: true, plotIndex: 1, color: '#000' }] };
        return exportToYamlScm(elements, wires, settings, undefined, undefined, 'current', mode);
      }, { mode, type });
      await page.locator('input[type="file"]').setInputFiles({ name: `${type}-${mode}.scm`, mimeType: 'text/plain', buffer: Buffer.from(fixture) });
      const original = await evaluate(fixture);
      const source = page.locator('[data-component-id]').first();
      const screen = await source.evaluate(g => { const p = g.ownerSVGElement.createSVGPoint(); const v = p.matrixTransform(g.getScreenCTM()); return { x: v.x, y: v.y }; });
      await page.mouse.click(screen.x, screen.y, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Поменять выводы местами', exact: true }).click();
      const changedText = await save(), changed = await evaluate(changedText);
      assert.equal(changed.flipH, true);
      assert.deepEqual(changed.endpoints, original.endpoints, 'wire endpoints and all manual bends stay at their physical points');
      assert.equal(changed.nodes, original.nodes);
      assert.ok(Math.abs(changed.initial + original.initial) < 1e-7, `${type}: signed transient output reverses`);
      assert.ok(Math.abs(changed.dc + original.dc) < 1e-7, `${type}: signed DC output reverses`);
      if (changed.mag !== null) assert.ok(Math.abs(changed.mag - original.mag) < 1e-7);
      else assert.match(changed.acDiagnostic, /подключите источник/);
      if (type.endsWith('AC')) assert.ok(Math.abs(Math.cos(changed.phase * Math.PI / 180) + Math.cos(original.phase * Math.PI / 180)) < 1e-8);
      await page.keyboard.press('Control+z');
      assert.deepEqual(await evaluate(await save()), original, 'one Undo restores the entire operation');
      await page.keyboard.press('Control+y');
      const redone = await save();
      assert.deepEqual(await evaluate(redone), changed);
      await page.locator('input[type="file"]').setInputFiles({ name: 'swapped.scm', mimeType: 'text/plain', buffer: Buffer.from(redone) });
      assert.deepEqual(await evaluate(await save()), changed, 'reopening keeps the terminal role and model result');
    }
    const rotatingSource = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      return exportToYamlScm([{ id: 'SRC', name: 'SRC', type: 'V_DC', value: 5, valueStr: '5', unit: 'В',
        x: 300, y: 240, rotation: 0 }], [], SAMPLE_CIRCUITS[0].transient, undefined, undefined, 'current', 'connect');
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'polarity-rotation.scm', mimeType: 'text/plain', buffer: Buffer.from(rotatingSource) });
    const source = page.locator('[data-component-id]').first();
    const position = await source.evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint();
      const screen = point.matrixTransform(group.getScreenCTM());
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(position.x, position.y);
    for (const [keys, expectedAngle] of [['Shift+r', 45], ['r', 135], ['r', 225]]) {
      await page.keyboard.press(keys);
      const marks = await source.evaluate(group => {
        const positive = group.querySelector('rect[data-pin-marker="positive"]');
        const negative = group.querySelector('circle[data-pin-marker="negative"]');
        return { positive: positive && { x: Number(positive.getAttribute('x')) + 3, y: Number(positive.getAttribute('y')) + 3 },
          negative: negative && { x: Number(negative.getAttribute('cx')), y: Number(negative.getAttribute('cy')) } };
      });
      const stored = await save();
      const pins = await page.evaluate(async scm => {
        const { parseYamlScm } = await import('/src/utils/yamlScm.ts');
        const { getComponentPins } = await import('/src/components/SchematicEditor.tsx');
        const element = parseYamlScm(scm).elements[0];
        return { angle: element.rotation, pins: getComponentPins(element).map(({ x, y }) => ({ x, y })) };
      }, stored);
      assert.equal(pins.angle, expectedAngle);
      for (const [marker, pin] of [[marks.positive, pins.pins[0]], [marks.negative, pins.pins[1]]]) {
        assert.ok(marker && Math.hypot(marker.x - pin.x, marker.y - pin.y) < 1e-6,
          `${expectedAngle}°: square and round markers follow the electrical terminal positions`);
      }
    }
    assert.deepEqual(dialogs, []); assert.deepEqual(errors, []);
    console.log('PASS: source terminal swaps keep physical conductors, reverse signed DC/transient/AC and round-trip atomically through SCM 7/8.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
