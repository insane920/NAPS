const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  const scm = await page.evaluate(async () => {
   const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
   const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
   const sample = SAMPLE_CIRCUITS.find(s => s.id === 'synchronous-buck');
   return exportToYamlScm(sample.elements, sample.wires, sample.transient);
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'buck.scm', mimeType: 'text/plain', buffer: Buffer.from(scm) });
  await page.getByTitle('Показать схему целиком').click();
  const collisions = await page.locator('[data-element-labels] text').evaluateAll(nodes => {
   const boxes = nodes.map(node => ({ text: node.textContent, box: node.getBoundingClientRect() }));
   const found = [];
   for (let i = 0; i < boxes.length; i++) for (let j = i+1; j < boxes.length; j++) {
    const a = boxes[i].box, b = boxes[j].box;
    if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) found.push([boxes[i].text, boxes[j].text]);
   }
   return found;
  });
  assert.deepEqual(collisions, [], 'buck labels do not overlap each other');
  const wireCollisions = await page.evaluate(() => {
   const labels = [...document.querySelectorAll('[data-element-labels] text')].map(node => ({ text: node.textContent, box: node.getBoundingClientRect() }));
   const found = [];
   for (const path of document.querySelectorAll('#schematic-world path[stroke="transparent"]')) {
    for (let distance = 0; distance <= path.getTotalLength(); distance += 2) {
     const point = path.getPointAtLength(distance).matrixTransform(path.getScreenCTM());
     for (const { text, box } of labels) if (point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom) found.push(text);
    }
   }
   return [...new Set(found)];
  });
  if (wireCollisions.length) console.log(await page.locator('[data-element-labels] text').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, x: node.getAttribute('x'), y: node.getAttribute('y') }))));
  assert.deepEqual(wireCollisions, [], 'buck wires do not cross labels');
  await page.screenshot({ path: '.work/buck-label-layout.png' });
  await page.getByRole('button', { name: 'Вид ▾' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Обозначения' }).click();
  await page.getByRole('button', { name: 'Вид ▾' }).click();
  const denseValues = await page.locator('[data-label-kind="value"]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()));
  for (let i = 0; i < denseValues.length; i++) for (let j = i + 1; j < denseValues.length; j++) {
   const a = denseValues[i], b = denseValues[j];
   assert.ok(!(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top),
    'hidden designations leave dense-schematic values on distinct readable lanes');
  }
  await page.getByRole('button', { name: 'Вид ▾' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Обозначения' }).click();
  await page.getByRole('button', { name: 'Вид ▾' }).click();
  for (const angle of [45, 90]) {
   const rotationFixture = await page.evaluate(async angle => {
    const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
    const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
    const types = ['V_DC', 'I_DC', 'R', 'C', 'L'];
    return exportToYamlScm(types.map((type, index) => ({
     id: `test_${index}`, name: `T${index + 1}`, type, value: 1, valueStr: '1', unit: '',
     x: 220 + index * 180, y: 330, rotation: angle,
    })), [], SAMPLE_CIRCUITS[0].transient);
   }, angle);
   await page.locator('input[type=file]').setInputFiles({ name: `labels-${angle}.scm`, mimeType: 'text/plain', buffer: Buffer.from(rotationFixture) });
   await page.waitForFunction(() => document.querySelectorAll('[data-component-id]').length === 5);
   const positions = async () => page.locator('[data-component-id]').evaluateAll(groups => groups.map(group => {
    const name = group.querySelector('[data-label-kind="name"]');
    const value = group.querySelector('[data-label-kind="value"]');
    return { name: name && { x: Number(name.getAttribute('x')), y: Number(name.getAttribute('y')) },
     value: value && { x: Number(value.getAttribute('x')), y: Number(value.getAttribute('y')) } };
   }));
   const shown = await positions();
   assert.equal(shown.length, 5);
   for (const labels of shown) {
    assert.ok(labels.name && labels.value);
    assert.ok(labels.name.x > 0 && labels.value.x < 0, `${angle}°: designation and nominal occupy opposite sides`);
   }
   await page.getByRole('button', { name: 'Вид ▾' }).click();
   await page.getByRole('menuitemcheckbox', { name: 'Обозначения' }).click();
   await page.getByRole('button', { name: 'Вид ▾' }).click();
   const hidden = await positions();
   for (const labels of hidden) {
    assert.equal(labels.name, null);
    assert.ok(labels.value && labels.value.x > 0, `${angle}°: nominal takes the designation side when the name is hidden`);
   }
   await page.getByRole('button', { name: 'Вид ▾' }).click();
   await page.getByRole('menuitemcheckbox', { name: 'Обозначения' }).click();
   await page.getByRole('button', { name: 'Вид ▾' }).click();
  }
  console.log('PASS: buck collision layout and 45°/90° designation sides for five families, with hidden-name nominal placement.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
