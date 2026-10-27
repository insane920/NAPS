const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ ...(process.env.NAPS_CHROME_PATH ? { executablePath: process.env.NAPS_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    await fs.mkdir('.work/p0-routing', { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(process.env.NAPS_TEST_URL || 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(async () => {
      const { exportToYamlScm } = await import('/src/utils/yamlScm.ts');
      const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
      const elements = [[200, 300], [600, 500]].map(([x, y], index) => ({ id: `r${index}`, name: `R${index + 1}`, type: 'R', value: 1000, valueStr: '1к', unit: 'Ом', x, y, rotation: 0 }));
      return exportToYamlScm(elements, [{ id: 'auto', fromCompId: 'r0', fromPinId: '2', toCompId: 'r1', toPinId: '1' }], SAMPLE_CIRCUITS[0].transient);
    });
    await page.locator('input[type="file"]').setInputFiles({ name: 'minimal-route.scm', mimeType: 'text/plain', buffer: Buffer.from(fixture) });
    await page.getByText('minimal-route', { exact: true }).waitFor();
    const route = () => page.locator('[data-wire-id] > path[stroke="transparent"]').first().getAttribute('d');
    await page.screenshot({ path: '.work/p0-routing/before.png' });
    const initial = await route();
    const screen = await page.locator('#schematic-world').evaluate(world => {
      const p = world.ownerSVGElement.createSVGPoint();
      const at = (x, y) => { p.x = x; p.y = y; const v = p.matrixTransform(world.getScreenCTM()); return { x: v.x, y: v.y }; };
      return { from: at(600, 500), to: at(600, 340) };
    });
    await page.mouse.move(screen.from.x, screen.from.y); await page.mouse.down();
    await page.mouse.move(screen.to.x, screen.to.y);
    await page.screenshot({ path: '.work/p0-routing/during.png' });
    await page.mouse.up();
    assert.equal(await page.locator('[data-component-id]').nth(1).getAttribute('transform'), 'translate(600, 340)', 'the drag must actually move the component');
    await page.screenshot({ path: '.work/p0-routing/after.png' });
    const after = await route();
    const bends = (after.match(/ L /g) || []).length - 1;
    console.log(JSON.stringify({ initial, after, bends, expectedBends: 2 }));
    assert.equal(bends, 2, 'moving the endpoint past its original bend must not keep the obsolete detour');
    const getPoints = () => page.locator('[data-wire-id] > path[stroke="transparent"]').evaluateAll(paths => paths.map(path => { const n = [...path.getAttribute('d').matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0])); return Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[i * 2], y: n[i * 2 + 1] })); }));
    const toScreen = (x, y) => page.locator('#schematic-world').evaluate((world, point) => { const p = world.ownerSVGElement.createSVGPoint(); p.x = point.x; p.y = point.y; const v = p.matrixTransform(world.getScreenCTM()); return { x: v.x, y: v.y }; }, { x, y });
    let lastSave = 0;
    async function save() { const remaining = 150 - (Date.now() - lastSave); if (remaining > 0) await page.waitForTimeout(remaining); const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сохранить', exact: true }).click()]); lastSave = Date.now(); return fs.readFile(await download.path(), 'utf8'); }
    async function load(text, name) { await page.locator('input[type="file"]').setInputFiles({ name: name + '.scm', mimeType: 'text/plain', buffer: Buffer.from(text) }); await page.getByText(name, { exact: true }).waitFor(); await page.keyboard.press('Escape'); }
    async function assertRoutes() { const points = await getPoints(); assert.equal(await page.evaluate(async points => { const { isOrthogonalAutomaticRoute } = await import('/src/utils/orthogonalRouter.ts'); return points.every(isOrthogonalAutomaticRoute); }, points), true, 'visible routes are finite, orthogonal and loop-free'); return points; }
    for (const mode of ['explicit', 'connect']) {
      const base = await page.evaluate(async ({ fixture, mode }) => { const { parseYamlScm, exportToYamlScm } = await import('/src/utils/yamlScm.ts'); const data = parseYamlScm(fixture); return exportToYamlScm(data.elements, data.wires, data.transient, undefined, data.printLayout, 'current', mode); }, { fixture, mode });
      await load(base, 'moves-' + mode);
      let previousPosition = { x: 600, y: 500 };
      for (let repeat = 0; repeat < 3; repeat++) for (const [x, y] of [[600, 340], [680, 340], [520, 340], [520, 460], [600, 300], [600, 500]]) {
        const before = await route(); const from = await toScreen(previousPosition.x, previousPosition.y), to = await toScreen(x, y);
        await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 3 });
        await assertRoutes(); await page.mouse.up();
        assert.equal(await page.locator('[data-component-id]').nth(1).getAttribute('transform'), 'translate(' + x + ', ' + y + ')');
        const points = (await assertRoutes())[0], updated = await route();
        assert.equal(points.length - 2, y === 300 ? 0 : 2, 'minimal bends after every direction of movement');
        assert.deepEqual(points[0], { x: 230, y: 300 }); assert.deepEqual(points.at(-1), { x: x - 30, y });
        await page.keyboard.press('Control+z'); assert.equal(await route(), before, 'one Undo restores exact route geometry');
        await page.keyboard.press('Control+y'); assert.equal(await route(), updated, 'one Redo restores exact route geometry');
        previousPosition = { x, y };
      }
      await page.screenshot({ path: '.work/p0-routing/' + mode + '-undo-redo.png' });
      const saved = await save();
      const proof = await page.evaluate(async text => { const { parseYamlScm } = await import('/src/utils/yamlScm.ts'); const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts'); const data = parseYamlScm(text), graph = buildCircuitGraph(data.elements, data.wires); return { joined: graph.pinToNode.get(data.elements[0].id + '_2') === graph.pinToNode.get(data.elements[1].id + '_1'), route: data.wires[0].autoRoute, mode: data.crossingMode }; }, saved);
      assert.equal(proof.joined, true); assert.equal(proof.mode, mode); assert.deepEqual(proof.route, (await getPoints())[0]);
      const beforeReload = await route(); await load(saved, 'reopened-' + mode); assert.equal(await route(), beforeReload);
      await page.screenshot({ path: '.work/p0-routing/' + mode + '-reopened.png' });
    }
    for (const mode of ['explicit', 'connect']) {
      const crossed = await page.evaluate(async mode => {
        const { exportToYamlScm } = await import('/src/utils/yamlScm.ts'); const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts');
        const elements = [[200,350,0],[600,350,0],[400,100,90],[400,600,90]].map(([x,y,rotation],i)=>({id:'r'+i,name:'R'+(i+1),type:'R',value:1000,valueStr:'1к',unit:'Ом',x,y,rotation}));
        const wires = [{id:'h',fromCompId:'r0',fromPinId:'2',toCompId:'r1',toPinId:'1',routeMode:'direct',manual:true},{id:'v',fromCompId:'r2',fromPinId:'2',toCompId:'r3',toPinId:'1',routeMode:'direct',manual:true}];
        return exportToYamlScm(elements,wires,SAMPLE_CIRCUITS[0].transient,undefined,undefined,'current',mode);
      }, mode);
      await load(crossed, 'x-' + mode);
      assert.equal(await page.locator('[data-node-hit]').count(), mode === 'connect' ? 1 : 0, 'SCM 8 repairs actual stored crossings; SCM 7 does not migrate them');
      await assertRoutes(); const saved = await save();
      const joined = await page.evaluate(async text => { const { parseYamlScm } = await import('/src/utils/yamlScm.ts'); const { buildCircuitGraph } = await import('/src/math/circuitSolver.ts'); const data = parseYamlScm(text), ids = Object.fromEntries(data.elements.map(e=>[e.name,e.id])), graph=buildCircuitGraph(data.elements,data.wires); return graph.pinToNode.get(ids.R1+'_2') === graph.pinToNode.get(ids.R3+'_2'); },saved);
      assert.equal(joined, mode === 'connect'); await page.screenshot({path:'.work/p0-routing/x-'+mode+'.png'});
    }
    for (const mode of ['explicit', 'connect']) {
      const overlap = await page.evaluate(async mode => {
        const {exportToYamlScm}=await import('/src/utils/yamlScm.ts'); const {SAMPLE_CIRCUITS}=await import('/src/data/sampleCircuits.ts');
        const elements=[100,500,250,650].map((x,i)=>({id:'j'+i,name:'J'+i,type:'JUNCTION',x,y:300,rotation:0,value:0,valueStr:'',unit:''}));
        const wires=[{id:'a',fromCompId:'j0',fromPinId:'1',toCompId:'j1',toPinId:'1',routeMode:'direct',manual:true},{id:'b',fromCompId:'j2',fromPinId:'1',toCompId:'j3',toPinId:'1',routeMode:'direct',manual:true}];
        return exportToYamlScm(elements,wires,SAMPLE_CIRCUITS[0].transient,undefined,undefined,'current',mode);
      },mode);
      await load(overlap,'overlap-'+mode); await assertRoutes(); const saved=await save();
      const nodes=await page.evaluate(async text=>{const {parseYamlScm}=await import('/src/utils/yamlScm.ts');const {buildCircuitGraph}=await import('/src/math/circuitSolver.ts');const data=parseYamlScm(text),g=buildCircuitGraph(data.elements,data.wires);return data.elements.filter(e=>/^J[0-3]$/.test(e.name)).map(e=>g.pinToNode.get(e.id+'_1'));},saved);
      assert.equal(new Set(nodes).size, mode==='connect'?1:2,'partial collinear overlap is joined only in SCM 8');
      const points=await getPoints(); await load(saved,'overlap-reload-'+mode); assert.deepEqual(await getPoints(),points);
    }
    for (const [kind, expected] of [['straight', 0], ['corner', 1], ['obstacle', 4]]) {
      const data = await page.evaluate(async kind => { const { exportToYamlScm } = await import('/src/utils/yamlScm.ts'); const { SAMPLE_CIRCUITS } = await import('/src/data/sampleCircuits.ts'); const e=(id,type,x,y,rotation=0)=>({id,name:id,type,x,y,rotation,value:1000,valueStr:'1к',unit:'Ом'}); const elements=[e('A','R',200,300),e('B','R',600,kind==='corner'?500:300,kind==='corner'?90:0)]; if(kind==='obstacle')elements.push(e('BLOCK','R',400,300)); return exportToYamlScm(elements,[{id:'wire',fromCompId:'A',fromPinId:'2',toCompId:'B',toPinId:'1'}],SAMPLE_CIRCUITS[0].transient); }, kind);
      await load(data, kind); const points=(await assertRoutes())[0]; assert.equal(points.length-2,expected,kind+': exact minimum number of bends');
      if(kind==='obstacle')assert.equal(points.slice(1).reduce((sum,p,i)=>sum+Math.abs(p.x-points[i].x)+Math.abs(p.y-points[i].y),0),364,'shortest path within the four-bend class');
    }
    for (const mode of ['explicit','connect']) {
      const t = await page.evaluate(async mode=>{ const { exportToYamlScm }=await import('/src/utils/yamlScm.ts'); const { SAMPLE_CIRCUITS }=await import('/src/data/sampleCircuits.ts'); const e=(id,type,x,y,rotation=0)=>({id,name:id,type,x,y,rotation,value:1000,valueStr:type==='R'?'1к':'',unit:'',}); const elements=[e('A','R',200,300),e('B','R',600,300),e('C','R',400,100,90),e('J','JUNCTION',400,300),e('Q1','JUNCTION',800,450),e('Q2','JUNCTION',1000,450)]; const wires=[['a','A','2'],['b','B','1'],['c','C','2']].map(([id,fromCompId,fromPinId])=>({id,fromCompId,fromPinId,toCompId:'J',toPinId:'1'})); wires.push({id:'independent',fromCompId:'Q1',fromPinId:'1',toCompId:'Q2',toPinId:'1'}); return exportToYamlScm(elements,wires,SAMPLE_CIRCUITS[0].transient,undefined,undefined,'current',mode); },mode);
      await load(t,'t-'+mode); const before=await getPoints(), independent=before.at(-1); await page.screenshot({path:'.work/p0-routing/t-'+mode+'-before.png'});
      const from=await toScreen(400,300), to=await toScreen(420,320); await page.mouse.move(from.x,from.y); await page.mouse.down(); await page.mouse.move(to.x,to.y,{steps:4}); await page.screenshot({path:'.work/p0-routing/t-'+mode+'-during.png'}); await page.mouse.up();
      const after=await assertRoutes(); assert.deepEqual(after.at(-1),independent,'moving T must not reroute another network'); assert.deepEqual(after.slice(0,3).map(p=>p.length-2),[1,1,2],'T branches use minimal non-looping geometry');
      const markers=await page.locator('[data-derived-branch]').evaluateAll(nodes=>nodes.map(node=>({x:Number(node.getAttribute('cx')),y:Number(node.getAttribute('cy'))})));
      assert.deepEqual(markers, mode==='connect'?[{x:420,y:300}]:[], 'only SCM 8 shows the real branch point before the explicit junction');
      const tree=await page.evaluate(async points=>{const {followsSharedNetwork}=await import('/src/utils/orthogonalRouter.ts');return followsSharedNetwork(points[1],[points[0]])&&followsSharedNetwork(points[2],[points[0],points[1]]);},after); assert.equal(tree,true,'branches merge into the existing tree without leaving it and forming a loop');
      await page.screenshot({path:'.work/p0-routing/t-'+mode+'-after.png'}); await page.keyboard.press('Control+z'); assert.deepEqual(await getPoints(),before); await page.keyboard.press('Control+y'); assert.deepEqual(await getPoints(),after); await page.screenshot({path:'.work/p0-routing/t-'+mode+'-undo-redo.png'}); const saved=await save(); await load(saved,'t-reopen-'+mode); assert.deepEqual(await getPoints(),after);
      assert.equal(await page.locator('[data-derived-branch]').count(), mode==='connect'?1:0, 'branch dot survives SCM reopening'); await page.screenshot({path:'.work/p0-routing/t-'+mode+'-reopened.png'});
    }
    const dense=await page.evaluate(async()=>{const {exportToYamlScm}=await import('/src/utils/yamlScm.ts');const {SAMPLE_CIRCUITS}=await import('/src/data/sampleCircuits.ts');const elements=Array.from({length:48},(_,i)=>({id:'r'+i,name:'R'+(i+1),type:'R',x:100+(i%6)*100,y:100+Math.floor(i/6)*100,rotation:0,value:1000,valueStr:'1к',unit:'Ом'}));elements.push({id:'j',name:'J',type:'JUNCTION',x:900,y:450,rotation:0,value:0,valueStr:'',unit:''});const wires=elements.slice(0,48).map(e=>({id:'w'+e.id,fromCompId:e.id,fromPinId:'2',toCompId:'j',toPinId:'1'}));return exportToYamlScm(elements,wires,SAMPLE_CIRCUITS[0].transient,undefined,undefined,'current','connect');});
    await load(dense,'dense-star'); const densePoints=await assertRoutes(); assert.equal(densePoints.length,48); assert.ok(densePoints.every(points=>points.length<=4),'dense star routes have at most two bends'); await page.screenshot({path:'.work/p0-routing/dense-star.png'});
    const denseSaved=await save(); const denseNetworks=await page.evaluate(async text=>{const {parseYamlScm}=await import('/src/utils/yamlScm.ts');const {buildCircuitGraph}=await import('/src/math/circuitSolver.ts');const data=parseYamlScm(text),g=buildCircuitGraph(data.elements,data.wires);return [...new Set(data.elements.filter(e=>e.type==='R').map(e=>g.pinToNode.get(e.id+'_2')))];},denseSaved);
    assert.equal(denseNetworks.length,1,'all 48 rendered branches are one actual electrical network');
    await load(denseSaved,'dense-reopen'); assert.deepEqual(await getPoints(),densePoints,'dense geometry survives SCM reopening');
    console.log('PASS: P0 straight/L/obstacle minimum routes, 36 repeated moves with Undo/Redo, T-tree stability, stored X intersections, 48-branch dense schema and SCM 7/8 reload.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
