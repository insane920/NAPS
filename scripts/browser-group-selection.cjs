const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const canvas = await page.locator('.schematic-editor div.relative.overflow-hidden.bg-white').last().boundingBox();
    const components = page.locator('#schematic-world > g[data-component-id]');
    await page.getByRole('button', { name: 'Резистор' }).first().click();
    for (const x of [220, 420, 620]) await page.mouse.click(canvas.x + x, canvas.y + 220);
    assert.equal(await components.count(), 3, 'placement stays active for repeated components');
    await page.keyboard.press('Escape');
    const origin = index => components.nth(index).evaluate(group => {
      const point = group.ownerSVGElement.createSVGPoint();
      const screen = point.matrixTransform(group.getScreenCTM());
      return { x: screen.x, y: screen.y };
    });
    const marqueeFirst = await origin(0), marqueeSecond = await origin(1);
    await page.mouse.move(marqueeFirst.x - 50, marqueeFirst.y - 40);
    await page.mouse.down();
    await page.mouse.move(marqueeSecond.x + 50, marqueeSecond.y + 40, { steps: 6 });
    await page.mouse.up();
    const before = await components.evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
    await page.mouse.move(marqueeFirst.x, marqueeFirst.y);
    await page.mouse.down();
    await page.mouse.move(marqueeFirst.x + 40, marqueeFirst.y + 20, { steps: 6 });
    await page.mouse.up();
    const after = await components.evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
    assert.notEqual(after[0], before[0], 'first selected component moves');
    assert.notEqual(after[1], before[1], 'second selected component moves with the group');
    assert.equal(after[2], before[2], 'unselected component stays in place');

    await page.keyboard.press('Delete');
    assert.equal(await components.count(), 1, 'Delete removes the selected group');
    await page.keyboard.press('Control+z');
    assert.equal(await components.count(), 3, 'Undo restores group deletion');
    const first = await origin(0), second = await origin(1);
    await page.keyboard.down('Shift'); await page.mouse.click(first.x, first.y); await page.keyboard.up('Shift');
    await page.keyboard.down('Control'); await page.mouse.click(second.x, second.y); await page.keyboard.up('Control');
    const beforeMulti = await components.evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
    await page.mouse.move(first.x, first.y); await page.mouse.down();
    await page.mouse.move(first.x + 40, first.y + 20, { steps: 5 }); await page.mouse.up();
    const afterMulti = await components.evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
    assert.notEqual(afterMulti[0], beforeMulti[0], 'Shift/Ctrl selection moves the first component');
    assert.notEqual(afterMulti[1], beforeMulti[1], 'Shift/Ctrl selection moves the second component');
    assert.equal(afterMulti[2], beforeMulti[2]);
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
    assert.equal(await components.count(), 5, 'group copy and paste duplicates both elements');
    await page.keyboard.press('Control+z');
    assert.equal(await components.count(), 3, 'undo removes the pasted group');

    const imported = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const sample = SAMPLE_CIRCUITS[0];
      return { scm: exportToYamlScm(sample.elements, sample.wires, sample.transient), count: sample.elements.length };
    });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'loaded.scm', mimeType: 'text/plain', buffer: Buffer.from(imported.scm) });
    await page.waitForFunction(() => document.title.includes('loaded'));
    await page.waitForFunction(count => document.querySelectorAll('#schematic-world > g[data-component-id]').length === count, imported.count);
    assert.equal(await components.count(), imported.count, 'loaded circuit replaces the edit session');
    await components.first().dblclick();
    assert.equal(await page.locator('#element-value').count(), 1, 'properties remain usable after loading a wired circuit');
    await page.locator('#element-value').fill('150');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить' }).click()]);
    const saved = await fs.readFile(await download.path(), 'utf8');
    assert.match(saved, /Name: "U1"[\s\S]*?Value: "150"/, 'updated parameter is saved after opening a wired circuit');
    await page.getByTitle('Повернуть выбранный элемент (R)').click();
    assert.equal(await page.getByRole('button', { name: 'Сохранить' }).isEnabled(), true, 'toolbar remains usable after loading');
    assert.deepEqual(errors, []);
    console.log('PASS: repeated placement, marquee and Shift/Ctrl selection, group move/copy/delete, undo and controls after SCM load.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
