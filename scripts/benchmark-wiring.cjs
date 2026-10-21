// Manual browser stress check. Run with a local Vite server and NAPS_TEST_URL.
const { chromium } = require('playwright-core');
const { performance } = require('node:perf_hooks');
const summary = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: Math.round(sorted[Math.floor(sorted.length / 2)]), p95: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]) };
};

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3135/', { waitUntil: 'networkidle' });
    const cdp = await page.context().newCDPSession(page);
    const listenerCounts = async () => {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      return Object.fromEntries(['mouseup', 'blur', 'keydown'].map(type => [type, listeners.filter(listener => listener.type === type).length]));
    };
    const initialListeners = await listenerCounts();
    const results = [];
    const sizes = process.env.NAPS_BENCH_10000 ? [10, 100, 500, 1000, 5000, 10000] : [10, 100, 500, 1000, 5000];
    for (const count of sizes) {
      const content = await page.evaluate(async n => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
        const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        const junction = (id, x, y) => ({ id, type: 'JUNCTION', name: id, x, y, rotation: 0, value: 0, valueStr: '', unit: '' });
        const elements = [junction('SRC', 100, 100)];
        const wires = [];
        for (let index = 0; index < n; index++) {
          const id = `J${index + 1}`;
          elements.push(junction(id, 300 + (index % 100) * 20, 100 + Math.floor(index / 100) * 20));
          wires.push({ id: `W${index}`, fromCompId: 'SRC', fromPinId: '1', toCompId: id, toPinId: '1' });
        }
        return exportToYamlScm(elements, wires, SAMPLE_CIRCUITS[0].transient);
      }, count);
      const started = performance.now();
      await page.locator('input[type="file"]').setInputFiles({
        name: `wiring-benchmark-${count}.scm`, mimeType: 'text/plain', buffer: Buffer.from(content),
      });
      await page.waitForFunction(n => document.querySelectorAll('#schematic-world path[stroke="transparent"]').length === n, count, { timeout: 120000 });
      const loadMs = Math.round(performance.now() - started);
      // Target known model geometry; fixed screen coordinates can miss a fitted large scene.
      const targets = await page.locator('#schematic-world').evaluate((world, n) => {
        return Array.from({ length: 20 }, (_, index) => {
          const point = world.ownerSVGElement.createSVGPoint();
          point.x = 300 + (index % Math.min(n, 30)) * 20;
          point.y = 100;
          const screen = point.matrixTransform(world.getScreenCTM());
          return { x: screen.x, y: screen.y };
        });
      }, count);
      const pointerSamples = [];
      for (let index = 0; index < 20; index++) {
        const moveStarted = performance.now();
        await page.mouse.move(targets[index].x, targets[index].y);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        pointerSamples.push(performance.now() - moveStarted);
      }
      const pointerMs = summary(pointerSamples);
      const heapMb = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
      if (count === sizes.at(-1)) await page.screenshot({ path: `.work/browser-wiring-${count}.png` });
      results.push({ wires: count, loadMs, pointerMs, heapMb, listeners: await listenerCounts() });
      console.log(JSON.stringify(results.at(-1)));
    }
    const finalListeners = await listenerCounts();
    console.log(JSON.stringify({ initialListeners, finalListeners }));
    const firstProjectListeners = results[0].listeners;
    if (Object.keys(firstProjectListeners).some(type => finalListeners[type] > firstProjectListeners[type])) throw new Error('Window listener count kept increasing across project imports.');
    if (errors.length) throw new Error(errors.join('; '));
    console.log('PASS: browser wiring stress check completed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
