const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const demoUrl = process.env.NAPS_SPIKE_FILE
      ? pathToFileURL(path.resolve(process.env.NAPS_SPIKE_FILE)).href
      : 'http://127.0.0.1:3000/maxgraph-wiring-spike.html';
    for (const count of [100, 500, 1000]) {
      await page.goto(`${demoUrl}?wires=${count}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!window.napsMaxGraphSpike);
      const result = await page.evaluate(() => {
        const spike = window.napsMaxGraphSpike;
        const edge = spike.graph.getDataModel().getCell('wire-0');
        const original = spike.graph.view.getState(edge).absolutePoints.map(point => ({ x: point.x, y: point.y }));
        const runs = Array.from({ length: 10 }, () => spike.move());
        const updated = spike.graph.view.getState(edge).absolutePoints.map(point => ({ x: point.x, y: point.y }));
        const componentEdge = spike.component.componentWire;
        const componentBefore = spike.graph.view.getState(componentEdge).absolutePoints.map(point => ({ x: point.x, y: point.y }));
        spike.graph.moveCells([spike.component.resistorA], 40, 20);
        const componentAfter = spike.graph.view.getState(componentEdge).absolutePoints.map(point => ({ x: point.x, y: point.y }));
        const importedBefore = spike.importedCircuit.exportGeometry();
        const sampleWire = spike.sample.wires[0];
        const importedEdge = spike.importedCircuit.edges.get(sampleWire.id);
        const importedEndpointBefore = spike.graph.view.getState(importedEdge).absolutePoints[0].x;
        spike.graph.moveCells([spike.importedCircuit.cells.get(sampleWire.fromCompId)], 40, 0);
        const importedEndpointAfter = spike.graph.view.getState(importedEdge).absolutePoints[0].x;
        const importedAfter = spike.importedCircuit.exportGeometry();
        spike.graph.setSelectionCell(componentEdge);
        const edgeHandler = spike.graph.getPlugin('SelectionCellsHandler').getHandler(componentEdge)?.constructor.name;
        return { createdMs: spike.createdMs, runs, original, updated,
          componentBefore, componentAfter, portId: componentEdge.getTerminal(true).getId(),
          edgeHandler,
          importedBefore, importedAfter, importedEndpointBefore, importedEndpointAfter,
          sampleElements: spike.sample.elements, sampleWires: spike.sample.wires, movedId: sampleWire.fromCompId,
          svgPaths: document.querySelectorAll('#canvas svg path').length };
      });
      assert.ok(result.updated[0].x > result.original[0].x, `${count}: connected edge follows moved terminal`);
      assert.equal(result.portId, 'component-a-pin-2', 'wire keeps a stable component pin ID');
      assert.ok(result.edgeHandler, 'selected orthogonal wire receives an edit handler');
      assert.ok(result.componentAfter[0].x > result.componentBefore[0].x,
        'moving a component updates its nested port and connected wire');
      assert.deepEqual(result.importedBefore.elements, result.sampleElements, 'SCM component coordinates survive import/export');
      assert.deepEqual(result.importedBefore.wires, result.sampleWires, 'SCM wire IDs and bends survive import/export');
      assert.ok(result.importedEndpointAfter > result.importedEndpointBefore,
        'imported SCM connection follows its component');
      assert.equal(result.importedAfter.elements.find(element => element.id === result.movedId).x,
        result.sampleElements.find(element => element.id === result.movedId).x + 40,
        'moving an imported component exports the new physical position');
      if (count === 100) {
        assert.equal(await page.locator('#tool-select').getAttribute('aria-pressed'), 'true',
          'selection tool is active by default');
        await page.locator('#tool-wire').click();
        assert.equal(await page.locator('#tool-wire').getAttribute('aria-pressed'), 'true',
          'wire tool is active after switching');
        assert.equal(await page.evaluate(() => window.napsMaxGraphSpike.graph
          .getPlugin('ConnectionHandler').isEnabled()), true, 'wire creation is enabled');
        assert.equal(await page.evaluate(() => window.napsMaxGraphSpike.graph.isCellsMovable()), false,
          'wire tool does not accidentally move components');
        const edgeCountBefore = await page.evaluate(() => {
          const graph = window.napsMaxGraphSpike.graph;
          return graph.getChildCells(graph.getDefaultParent(), false, true).length;
        });
        await page.mouse.move(295, 112);
        await page.mouse.down();
        await page.mouse.move(365, 147, { steps: 10 });
        await page.mouse.up();
        const newConnection = await page.evaluate(before => {
          const graph = window.napsMaxGraphSpike.graph;
          const edges = graph.getChildCells(graph.getDefaultParent(), false, true);
          return { added: edges.length - before, source: edges.at(-1).getTerminal(true)?.getId(),
            target: edges.at(-1).getTerminal(false)?.getId() };
        }, edgeCountBefore);
        assert.deepEqual(newConnection, { added: 1, source: 'source-0', target: 'target-1' },
          'wire tool creates a real graph edge between the chosen terminals');
        await page.locator('#tool-select').click();
        assert.equal(await page.evaluate(() => window.napsMaxGraphSpike.graph
          .getPlugin('ConnectionHandler').isEnabled()), false, 'selection mode disables connection hotspot');
        assert.equal(await page.evaluate(() => window.napsMaxGraphSpike.graph.isCellsMovable()), true,
          'selection mode allows component movement');
        const drag = await page.evaluate(() => {
          const graph = window.napsMaxGraphSpike.graph;
          const cell = graph.getDataModel().getCell('source-0');
          const geometry = cell.getGeometry();
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          return { x: canvas.left + geometry.x + geometry.width / 2,
            y: canvas.top + geometry.y + geometry.height / 2, worldX: geometry.x };
        });
        await page.mouse.move(drag.x, drag.y);
        await page.mouse.down();
        await page.mouse.move(drag.x + 60, drag.y + 20, { steps: 8 });
        await page.mouse.up();
        const draggedX = await page.evaluate(() => window.napsMaxGraphSpike.graph.getDataModel()
          .getCell('source-0').getGeometry().x);
        assert.ok(draggedX > drag.worldX, 'actual mouse drag moves a terminal in the standalone editor');
        // Reproduce the reported spur: move a horizontal wire segment, then move B5.
        await page.mouse.click(220, 287);
        await page.mouse.move(230, 287);
        await page.mouse.down();
        await page.mouse.move(230, 205, { steps: 12 });
        await page.mouse.up();
        const beforeTargetMove = await page.evaluate(() => {
          const graph = window.napsMaxGraphSpike.graph;
          const target = graph.getDataModel().getCell('target-5');
          const edge = graph.getDataModel().getCell('wire-5');
          return { x: target.getGeometry().x,
            waypoints: edge.getGeometry().points.map(point => ({ x: point.x, y: point.y })),
            route: graph.view.getState(edge).absolutePoints.map(point => ({ x: point.x, y: point.y })) };
        });
        const targetDrag = await page.evaluate(() => {
          const g = window.napsMaxGraphSpike.graph.getDataModel().getCell('target-5').getGeometry();
          const box = document.getElementById('canvas').getBoundingClientRect();
          return { x: box.left + g.x + 5, y: box.top + g.y + 5 };
        });
        await page.mouse.move(targetDrag.x, targetDrag.y);
        await page.mouse.down();
        await page.mouse.move(230, 152, { steps: 12 });
        await page.mouse.up();
        const edited = await page.evaluate(() => {
          const graph = window.napsMaxGraphSpike.graph;
          const target = graph.getDataModel().getCell('target-5').getGeometry();
          const edge = graph.getDataModel().getCell('wire-5');
          return { targetCenterX: target.x + target.width / 2,
            waypoints: edge.getGeometry().points.map(point => ({ x: point.x, y: point.y })),
            route: graph.view.getState(edge).absolutePoints.map(point => ({ x: point.x, y: point.y })) };
        });
        assert.equal(edited.waypoints.at(-1).x, edited.targetCenterX,
          'moving a terminal updates the aligned manual bend and removes the old spur');
        assert.equal(edited.waypoints[0].y, edited.waypoints[1].y,
          'the user-moved horizontal segment keeps its chosen height');
        assert.ok(edited.route.every(point => point.x <= edited.targetCenterX),
          'the route no longer travels to the old B5 position and doubles back');
        await page.locator('#undo').click();
        const undone = await page.evaluate(() => {
          const graph = window.napsMaxGraphSpike.graph;
          const target = graph.getDataModel().getCell('target-5');
          const edge = graph.getDataModel().getCell('wire-5');
          return { x: target.getGeometry().x,
            waypoints: edge.getGeometry().points.map(point => ({ x: point.x, y: point.y })),
            route: graph.view.getState(edge).absolutePoints.map(point => ({ x: point.x, y: point.y })) };
        });
        assert.deepEqual(undone, beforeTargetMove,
          'one Undo restores both the component and the attached manual bend');
        await page.locator('#redo').click();
        const redone = await page.evaluate(() => {
          const graph = window.napsMaxGraphSpike.graph;
          const target = graph.getDataModel().getCell('target-5');
          const edge = graph.getDataModel().getCell('wire-5');
          return { targetCenterX: target.getGeometry().x + target.getGeometry().width / 2,
            waypoints: edge.getGeometry().points.map(point => ({ x: point.x, y: point.y })),
            route: graph.view.getState(edge).absolutePoints.map(point => ({ x: point.x, y: point.y })) };
        });
        assert.deepEqual(redone, edited,
          'one Redo restores both the component and the spur-free wire route');
        const repeated = await page.evaluate(() => {
          const graph = window.napsMaxGraphSpike.graph;
          const target = graph.getDataModel().getCell('target-5');
          const edge = graph.getDataModel().getCell('wire-5');
          for (let index = 0; index < 25; index++) {
            graph.moveCells([target], 20, 0);
            graph.moveCells([target], -20, 0);
          }
          return { points: edge.getGeometry().points.map(point => ({ x: point.x, y: point.y })),
            route: graph.view.getState(edge).absolutePoints.map(point => ({ x: point.x, y: point.y })) };
        });
        assert.deepEqual(repeated.points, edited.waypoints,
          '25 moves out and back preserve user bends without accumulating a spur');
        assert.deepEqual(repeated.route, edited.route,
          '25 moves out and back restore the visible route exactly');
        const scmText = await page.evaluate(() => window.napsMaxGraphSpike.sampleScm);
        await page.locator('#open-scm-input').setInputFiles({ name: 'sample.scm', mimeType: 'text/plain',
          buffer: Buffer.from(scmText, 'utf8') });
        await page.waitForFunction(() => !!window.napsMaxGraphSpike.loadedProject);
        const loaded = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          return { sourceGone: !spike.graph.getDataModel().getCell('source-0'),
            elements: spike.loadedProject.elements, wires: spike.loadedProject.wires,
            geometry: spike.loadedCircuit.exportGeometry(),
            edgeCount: spike.loadedCircuit.edges.size,
            status: document.getElementById('stats').textContent };
        });
        assert.ok(loaded.sourceGone, 'opening SCM replaces the synthetic demo scene');
        assert.equal(loaded.edgeCount, loaded.wires.length, 'every SCM wire is imported');
        assert.deepEqual(loaded.geometry.elements, loaded.elements, 'SCM components retain all parameters and positions');
        assert.deepEqual(loaded.geometry.wires, loaded.wires, 'SCM connections and bends retain their IDs and geometry');
        assert.match(loaded.status, /SCM открыт/);
        await page.locator('#open-scm-input').setInputFiles({ name: 'broken.scm', mimeType: 'text/plain',
          buffer: Buffer.from('not a valid circuit', 'utf8') });
        await page.waitForFunction(() => document.getElementById('stats').textContent.includes('Не удалось открыть'));
        assert.equal(await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.edges.size),
          loaded.edgeCount, 'invalid SCM does not discard the displayed circuit');
        const scm8 = await page.evaluate(() => window.napsMaxGraphSpike.sampleScm8);
        await page.locator('#open-scm-input').setInputFiles({ name: 'sample-v8.scm', mimeType: 'text/plain',
          buffer: Buffer.from(scm8, 'utf8') });
        await page.waitForFunction(() => window.napsMaxGraphSpike.loadedProject?.crossingMode === 'connect');
        assert.equal(await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.edges.size),
          loaded.edgeCount, 'SCM 8 wires load without loss');
        const normalized = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const result = spike.normalizeLoadedCrossings();
          return { elements: result.elements.length, wires: result.wires.length };
        });
        assert.ok(normalized.elements >= loaded.elements.length && normalized.wires >= loaded.wires.length,
          'SCM 8 visible routes can be passed to the existing NAPS crossing normalizer');
        const roundTrip = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const before = spike.loadedProject;
          const saved = spike.serializeLoadedProject();
          const after = spike.loadScmText(saved);
          return { before, after, saved };
        });
        const stableScmData = project => {
          const elementIndex = new Map(project.elements.map((element, index) => [element.id, index]));
          return { elements: project.elements.map(({ id, ...element }) => element),
            wires: project.wires.map(({ id, fromCompId, toCompId, ...wire }) => ({ ...wire,
              fromCompId: elementIndex.get(fromCompId), toCompId: elementIndex.get(toCompId) })) };
        };
        assert.deepEqual(stableScmData(roundTrip.after).elements, stableScmData(roundTrip.before).elements,
          'SCM 8 components and parameters survive prototype serialization');
        assert.deepEqual(stableScmData(roundTrip.after).wires, stableScmData(roundTrip.before).wires,
          'SCM 8 connections survive prototype serialization');
        assert.equal(roundTrip.after.crossingMode, 'connect', 'SCM 8 crossing mode survives');
        assert.deepEqual(roundTrip.after.printLayout, roundTrip.before.printLayout,
          'sheet settings survive prototype serialization');
        const reconnect = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const wire = spike.loadedProject.wires[0];
          const edge = spike.loadedCircuit.edges.get(wire.id);
          const newPort = [...spike.loadedCircuit.ports.values()].find(port =>
            port !== edge.getTerminal(true) && port !== edge.getTerminal(false));
          spike.graph.getDataModel().setTerminal(edge, newPort, false);
          const edited = spike.loadedCircuit.exportGeometry();
          const expectedWire = edited.wires[0];
          const expectedName = edited.elements.find(element => element.id === expectedWire.toCompId).name;
          const reopened = spike.loadScmText(spike.serializeLoadedProject());
          const actualName = reopened.elements.find(element => element.id === reopened.wires[0].toCompId).name;
          return { expectedName, actualName, expectedPin: expectedWire.toPinId,
            actualPin: reopened.wires[0].toPinId };
        });
        assert.equal(reconnect.actualName, reconnect.expectedName,
          'a changed wire endpoint is saved to the new component');
        assert.equal(reconnect.actualPin, reconnect.expectedPin,
          'a changed wire endpoint is saved to the exact new pin');
        const changes = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const graph = spike.graph;
          const before = spike.loadedProject.wires.length;
          const removed = spike.loadedCircuit.edges.get(spike.loadedProject.wires[1].id);
          graph.removeCells([removed]);
          const ports = [...spike.loadedCircuit.ports.values()];
          const source = ports[0], target = ports.find(port => port.getParent() !== source.getParent());
          graph.insertEdge({ source, target, style: { edgeStyle: 'orthogonalEdgeStyle', endArrow: 'none' } });
          const edited = spike.loadedCircuit.exportGeometry();
          const added = edited.wires.find(wire => wire.id.startsWith('new_'));
          const expectedSource = edited.elements.find(element => element.id === added.fromCompId).name;
          const expectedTarget = edited.elements.find(element => element.id === added.toCompId).name;
          const reopened = spike.loadScmText(spike.serializeLoadedProject());
          const reopenedNames = reopened.wires.map(wire => ({
            source: reopened.elements.find(element => element.id === wire.fromCompId).name,
            target: reopened.elements.find(element => element.id === wire.toCompId).name,
          }));
          return { before, after: reopened.wires.length, expectedSource, expectedTarget,
            present: reopenedNames.some(wire => wire.source === expectedSource && wire.target === expectedTarget) };
        });
        assert.equal(changes.after, changes.before,
          'one removed and one added wire keep the correct SCM wire count');
        assert.ok(changes.present, 'a newly created wire survives SCM serialization and reopening');
        const portDrag = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const graph = spike.graph;
          const box = document.getElementById('canvas').getBoundingClientRect();
          const visible = [...spike.loadedCircuit.ports.values()].map(port => {
            const state = graph.view.getState(port);
            return { port, x: box.left + state.x + state.width / 2,
              y: box.top + state.y + state.height / 2 };
          }).filter(item => item.x > 10 && item.x < innerWidth - 10 && item.y > 80 && item.y < innerHeight - 10);
          const source = visible[0];
          const target = visible.find(item => item.port.getParent() !== source.port.getParent());
          return { source: { x: source.x, y: source.y }, target: { x: target.x, y: target.y },
            before: graph.getChildCells(graph.getDefaultParent(), false, true).length };
        });
        await page.locator('#tool-wire').click();
        await page.mouse.move(portDrag.source.x, portDrag.source.y);
        await page.mouse.down();
        await page.mouse.move(portDrag.target.x, portDrag.target.y, { steps: 12 });
        await page.mouse.up();
        const connectedPorts = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const graph = spike.graph;
          const edges = graph.getChildCells(graph.getDefaultParent(), false, true);
          const newest = edges.at(-1);
          return { count: edges.length, source: newest.getTerminal(true)?.getId(),
            target: newest.getTerminal(false)?.getId(), savedCount: spike.loadedCircuit.exportGeometry().wires.length };
        });
        assert.equal(connectedPorts.count, portDrag.before + 1,
          'mouse drag between SCM pins creates a wire');
        assert.match(connectedPorts.source, /^scm-pin-/);
        assert.match(connectedPorts.target, /^scm-pin-/);
        assert.equal(connectedPorts.savedCount, connectedPorts.count,
          'mouse-created wire is included in the SCM geometry');
        const crossing = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          spike.loadScmText(spike.crossingScm8);
          return spike.analyzeLoadedTopology();
        });
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length > 0);
        await page.screenshot({ path: '.work/maxgraph-scm8-crossing.png' });
        assert.notEqual(crossing.raw.networks['R1.2'], crossing.raw.networks['R3.2'],
          'before SCM 8 crossing normalization the two wires are distinct networks');
        assert.equal(crossing.normalized.networks['R1.2'], crossing.normalized.networks['R3.2'],
          'the existing NAPS normalizer electrically joins visible X crossings');
        assert.ok(crossing.normalized.elements.some(element => element.type === 'JUNCTION'),
          'SCM 8 normalization creates an actual junction');
        const shifted = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const vertical = spike.loadedProject.elements.filter(element => element.name === 'R3' || element.name === 'R4')
            .map(element => spike.loadedCircuit.cells.get(element.id));
          spike.graph.moveCells(vertical, 300, 0);
          return spike.analyzeLoadedTopology();
        });
        assert.notEqual(shifted.normalized.networks['R1.2'], shifted.normalized.networks['R3.2'],
          'moving the crossing branch away splits the electrical networks');
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length === 0);
        await page.locator('#undo').click();
        const restoredCrossing = await page.evaluate(() => window.napsMaxGraphSpike.analyzeLoadedTopology());
        assert.equal(restoredCrossing.normalized.networks['R1.2'], restoredCrossing.normalized.networks['R3.2'],
          'Undo restores the visible X crossing and its electrical junction');
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length > 0);
        await page.locator('#redo').click();
        const redoneSplit = await page.evaluate(() => window.napsMaxGraphSpike.analyzeLoadedTopology());
        assert.notEqual(redoneSplit.normalized.networks['R1.2'], redoneSplit.normalized.networks['R3.2'],
          'Redo restores the separated networks');
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length === 0);
        const legacyCrossing = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          spike.loadScmText(spike.crossingScm7);
          return spike.analyzeLoadedTopology();
        });
        assert.notEqual(legacyCrossing.normalized.networks['R1.2'], legacyCrossing.normalized.networks['R3.2'],
          'SCM 7 retains independent networks at the same visible X crossing');
        assert.equal(legacyCrossing.normalized.elements.length, legacyCrossing.raw.elements.length,
          'SCM 7 does not create automatic junctions');
        assert.equal(await page.locator('.derived-junction').count(), 0,
          'legacy SCM 7 crossing has no automatic junction marker');
        await page.evaluate(() => window.napsMaxGraphSpike.loadScmText(window.napsMaxGraphSpike.crossingScm8));
        await page.locator('#tool-select').click();
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length === 1);
        for (const scale of [0.25, 0.5, 1.5, 2, 1]) {
          await page.evaluate(value => window.napsMaxGraphSpike.graph.zoomTo(value), scale);
          await page.waitForFunction(() => {
            const spike = window.napsMaxGraphSpike;
            const node = spike.normalizeLoadedCrossings().elements.find(element => element.autoCrossing);
            const expected = spike.loadedCircuit.toCanvasPoint(node);
            const marker = document.querySelector('.derived-junction');
            return marker && Math.abs(parseFloat(marker.style.left) + 4 - expected.x) < 1 &&
              Math.abs(parseFloat(marker.style.top) + 4 - expected.y) < 1;
          });
        }
        await page.locator('.derived-junction').click();
        const fixedX = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const geometry = spike.loadedCircuit.exportGeometry();
          const junction = geometry.elements.find(element => element.type === 'JUNCTION');
          return { elements: geometry.elements.length, wires: geometry.wires.length,
            junctionId: junction?.id, networks: spike.analyzeLoadedTopology().normalized.networks };
        });
        assert.equal(fixedX.elements, 5, 'clicking a derived X marker creates one movable junction');
        assert.equal(fixedX.wires, 4, 'both crossing conductors are split at the junction');
        assert.equal(fixedX.networks['R1.2'], fixedX.networks['R3.2'],
          'materialized X preserves the electrical connection');
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length === 0);
        await page.locator('#undo').click();
        const fixedXUndo = await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.exportGeometry());
        assert.equal(fixedXUndo.elements.length, 4, 'one Undo removes the explicit X node');
        assert.equal(fixedXUndo.wires.length, 2, 'one Undo restores both original crossing wires');
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length === 1);
        await page.locator('#redo').click();
        const fixedXRedo = await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.exportGeometry());
        assert.equal(fixedXRedo.elements.length, 5, 'Redo restores the explicit X node');
        assert.equal(fixedXRedo.wires.length, 4, 'Redo restores all four connected branches');
        const fixedXDrag = await page.evaluate(id => {
          const spike = window.napsMaxGraphSpike;
          const geometry = spike.loadedCircuit.cells.get(id).getGeometry();
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          return { x: canvas.left + geometry.x + 3, y: canvas.top + geometry.y + 7 };
        }, fixedX.junctionId);
        await page.mouse.move(fixedXDrag.x, fixedXDrag.y);
        await page.mouse.down();
        await page.mouse.move(fixedXDrag.x + 40, fixedXDrag.y + 20, { steps: 8 });
        await page.mouse.up();
        const fixedXMoved = await page.evaluate(id => {
          const spike = window.napsMaxGraphSpike;
          const geometry = spike.loadedCircuit.exportGeometry();
          const node = geometry.elements.find(element => element.id === id);
          const port = spike.loadedCircuit.ports.get(`${id}_1`);
          const routes = spike.loadedCircuit.getVisibleRoutes().map(route => route.points.map(point =>
            ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 })));
          return { x: node.x, y: node.y, branches: spike.graph.getEdges(port).length,
            routes, saved: spike.serializeLoadedProject() };
        }, fixedX.junctionId);
        assert.equal(fixedXMoved.branches, 4, 'all four X branches follow the moved node');
        const fixedXReopened = await page.evaluate(saved => {
          const spike = window.napsMaxGraphSpike;
          const reopened = spike.loadScmText(saved);
          return { junction: reopened.elements.find(element => element.type === 'JUNCTION'),
            wires: reopened.wires.length,
            routes: spike.loadedCircuit.getVisibleRoutes().map(route => route.points.map(point =>
              ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 }))) };
        }, fixedXMoved.saved);
        assert.equal(fixedXReopened.wires, 4, 'SCM 8 restores all materialized X branches');
        assert.equal(fixedXReopened.junction.x, fixedXMoved.x, 'SCM 8 preserves the moved X coordinate');
        assert.equal(fixedXReopened.junction.y, fixedXMoved.y, 'SCM 8 preserves the moved Y coordinate');
        assert.deepEqual(fixedXReopened.routes, fixedXMoved.routes,
          'SCM 8 reopening preserves every visible X branch route');
        await page.evaluate(() => window.napsMaxGraphSpike.loadScmText(window.napsMaxGraphSpike.crossingScm8));
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length === 1);
        const xMarker = await page.locator('.derived-junction').boundingBox();
        await page.mouse.move(xMarker.x + xMarker.width / 2, xMarker.y + xMarker.height / 2);
        await page.mouse.down();
        await page.mouse.move(xMarker.x + xMarker.width / 2 + 40,
          xMarker.y + xMarker.height / 2 + 20, { steps: 8 });
        await page.mouse.up();
        const oneGestureX = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const geometry = spike.loadedCircuit.exportGeometry();
          return { node: geometry.elements.find(element => element.type === 'JUNCTION'),
            wires: geometry.wires.length,
            routes: spike.loadedCircuit.getVisibleRoutes().map(route => route.points) };
        });
        assert.equal(oneGestureX.node.x, 290, 'one mouse drag moves a derived X crossing 40 units');
        assert.equal(oneGestureX.node.y, 240, 'one mouse drag moves a derived X crossing 20 units');
        assert.equal(oneGestureX.wires, 4, 'one-gesture crossing keeps all four branches');
        assert.ok(oneGestureX.routes.every(route => route.slice(1).every((point, index) =>
          Math.abs(point.x - route[index].x) < 0.1 || Math.abs(point.y - route[index].y) < 0.1)),
        'all moved X branches remain orthogonal');
        await page.locator('#undo').click();
        const oneGestureUndo = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const geometry = spike.loadedCircuit.exportGeometry();
          return { elements: geometry.elements.length, wires: geometry.wires.length,
            networks: spike.analyzeLoadedTopology().normalized.networks };
        });
        assert.equal(oneGestureUndo.elements, 4, 'one Undo reverses conversion and drag together');
        assert.equal(oneGestureUndo.wires, 2, 'one Undo restores both original X conductors');
        assert.equal(oneGestureUndo.networks['R1.2'], oneGestureUndo.networks['R3.2'],
          'Undo keeps the original derived SCM 8 electrical crossing');
        await page.locator('#redo').click();
        const oneGestureRedo = await page.evaluate(() => {
          const geometry = window.napsMaxGraphSpike.loadedCircuit.exportGeometry();
          return { junction: geometry.elements.find(element => element.type === 'JUNCTION'),
            wires: geometry.wires.length };
        });
        assert.equal(oneGestureRedo.junction.x, 290, 'one Redo restores the moved X node');
        assert.equal(oneGestureRedo.wires, 4, 'one Redo restores the four X branches');
        await page.evaluate(() => window.napsMaxGraphSpike.loadScmText(window.napsMaxGraphSpike.crossingScm8));
        await page.waitForFunction(() => document.querySelectorAll('.derived-junction').length === 1);
        const cancelMarker = await page.locator('.derived-junction').boundingBox();
        await page.mouse.move(cancelMarker.x + 4, cancelMarker.y + 4);
        await page.mouse.down();
        await page.mouse.move(cancelMarker.x + 24, cancelMarker.y + 24, { steps: 4 });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        const canceledX = await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.exportGeometry());
        assert.equal(canceledX.elements.length, 4, 'Escape cancels conversion of a derived X crossing');
        assert.equal(canceledX.wires.length, 2, 'Escape restores both crossing conductors');
        const tStart = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          spike.loadScmText(spike.crossingScm8);
          const graph = spike.graph;
          const source = [...spike.loadedCircuit.ports.values()].find(port => port.getParent().getValue() === 'R3');
          const sourceState = graph.view.getState(source);
          const trunk = [...spike.loadedCircuit.edges.values()][0];
          const route = graph.view.getState(trunk).absolutePoints;
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          return { source: { x: canvas.left + sourceState.x + sourceState.width / 2,
            y: canvas.top + sourceState.y + sourceState.height / 2 },
            target: { x: canvas.left + (route[0].x + route.at(-1).x) / 2 - 50,
              y: canvas.top + route[0].y } };
        });
        await page.locator('#tool-wire').click();
        await page.mouse.move(tStart.source.x, tStart.source.y);
        await page.mouse.down();
        await page.mouse.move(tStart.target.x, tStart.target.y, { steps: 12 });
        await page.mouse.up();
        const tBranch = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const geometry = spike.loadedCircuit.exportGeometry();
          const junction = geometry.elements.find(element => element.type === 'JUNCTION' && !element.autoCrossing);
          const port = spike.loadedCircuit.ports.get(`${junction.id}_1`);
          const names = Object.fromEntries(geometry.elements.map(element => [element.id, element.name]));
          return { elements: geometry.elements.length, wires: geometry.wires.length,
            branches: spike.graph.getEdges(port).length, junctionId: junction.id,
            junctionName: junction.name, connections: geometry.wires.filter(wire =>
              wire.fromCompId === junction.id || wire.toCompId === junction.id).length,
            topology: spike.analyzeLoadedTopology().normalized.networks,
            nameAtSource: names[geometry.wires.at(-1).toCompId] };
        });
        assert.equal(tBranch.elements, 5, 'dropping on a wire creates one explicit T junction');
        assert.equal(tBranch.wires, 4, 'the existing wire is split and the new branch is connected');
        assert.equal(tBranch.branches, 3, 'three physical branches terminate on the same node');
        assert.equal(tBranch.connections, 3, 'all three branches serialize to the same junction');
        await page.locator('#undo').click();
        const tUndo = await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.exportGeometry());
        assert.equal(tUndo.elements.length, 4, 'one Undo removes the branch junction');
        assert.equal(tUndo.wires.length, 2, 'one Undo restores the original unsplit conductor');
        await page.locator('#redo').click();
        const tRedo = await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.exportGeometry());
        assert.equal(tRedo.elements.length, 5, 'one Redo restores the junction');
        assert.equal(tRedo.wires.length, 4, 'one Redo restores all three connected branches');
        await page.locator('#tool-select').click();
        const junctionDrag = await page.evaluate(id => {
          const spike = window.napsMaxGraphSpike;
          const cell = spike.loadedCircuit.cells.get(id);
          const geometry = cell.getGeometry();
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          return { x: canvas.left + geometry.x + 3, y: canvas.top + geometry.y + 7,
            oldX: geometry.x };
        }, tBranch.junctionId);
        await page.mouse.move(junctionDrag.x, junctionDrag.y);
        await page.mouse.down();
        await page.mouse.move(junctionDrag.x + 40, junctionDrag.y + 20, { steps: 8 });
        await page.mouse.up();
        const tMoved = await page.evaluate(id => {
          const spike = window.napsMaxGraphSpike;
          spike.graph.view.validate();
          const cell = spike.loadedCircuit.cells.get(id);
          const port = spike.loadedCircuit.ports.get(`${id}_1`);
          const center = spike.graph.view.getState(port);
          const px = center.x + center.width / 2, py = center.y + center.height / 2;
          const endpointDistances = spike.graph.getEdges(port).map(edge => {
            const route = spike.graph.view.getState(edge).absolutePoints;
            const end = edge.getTerminal(true) === port ? route[0] : route.at(-1);
            return Math.hypot(end.x - px, end.y - py);
          });
          return { x: cell.getGeometry().x,
            exportedX: spike.loadedCircuit.exportGeometry().elements.find(element => element.id === id).x,
            branches: spike.graph.getEdges(port).length,
            endpointDistances, saved: spike.serializeLoadedProject(),
            routes: spike.loadedCircuit.getVisibleRoutes().map(route => route.points.map(point =>
              ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 }))) };
        }, tBranch.junctionId);
        assert.ok(tMoved.x > junctionDrag.oldX, 'the T node moves by dragging its visible body');
        assert.equal(tMoved.branches, 3, 'all three branches remain attached after dragging the junction');
        assert.ok(tMoved.endpointDistances.every(distance => distance <= 2.1),
          `all three visible branches meet the 4px node marker: ${tMoved.endpointDistances}`);
        assert.ok(tMoved.routes.every(route => route.slice(1).every((point, index) =>
          Math.abs(point.x - route[index].x) < 0.1 || Math.abs(point.y - route[index].y) < 0.1)),
        'all three visible T branches remain orthogonal after moving the node');
        const repeatedNodeMove = await page.evaluate(id => {
          const spike = window.napsMaxGraphSpike;
          const cell = spike.loadedCircuit.cells.get(id);
          const visible = () => spike.loadedCircuit.getVisibleRoutes().map(route =>
            route.points.map(point => ({ x: Math.round(point.x * 1000) / 1000,
              y: Math.round(point.y * 1000) / 1000 })));
          const before = visible();
          for (let index = 0; index < 25; index++) {
            spike.graph.moveCells([cell], 20, 0);
            spike.graph.moveCells([cell], -20, 0);
          }
          return { before, after: visible(), branches: spike.graph.getEdges(
            spike.loadedCircuit.ports.get(`${id}_1`)).length };
        }, tBranch.junctionId);
        assert.deepEqual(repeatedNodeMove.after, repeatedNodeMove.before,
          '25 round-trip node moves do not accumulate new wire bends or stubs');
        assert.equal(repeatedNodeMove.branches, 3, 'all T branches remain connected after repeated moves');
        const tReopened = await page.evaluate(saved => {
          const spike = window.napsMaxGraphSpike;
          const project = spike.loadScmText(saved);
          spike.graph.view.validate();
          return { elements: project.elements.length, wires: project.wires.length,
            junction: project.elements.find(element => element.type === 'JUNCTION'),
            routes: spike.loadedCircuit.getVisibleRoutes().map(route => route.points.map(point =>
              ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 }))) };
        }, tMoved.saved);
        assert.equal(tReopened.elements, 5, 'SCM reopens the moved T junction');
        assert.equal(tReopened.wires, 4, 'SCM reopens all T branches');
        assert.equal(tReopened.junction.x, tMoved.exportedX,
          'SCM preserves the moved node coordinate');
        assert.deepEqual(tReopened.routes, tMoved.routes,
          'SCM reopening preserves all three visible T branch routes');
        const secondBranch = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const graph = spike.graph;
          const source = [...spike.loadedCircuit.ports.values()]
            .find(port => port.getParent().getValue() === 'R4');
          const sourceState = graph.view.getState(source);
          const trunk = [...spike.loadedCircuit.edges.values()][0];
          const route = graph.view.getState(trunk).absolutePoints;
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          return { source: { x: canvas.left + sourceState.x + sourceState.width / 2,
            y: canvas.top + sourceState.y + sourceState.height / 2 },
            target: { x: canvas.left + (route[0].x + route.at(-1).x) / 2,
              y: canvas.top + route[0].y } };
        });
        await page.locator('#tool-wire').click();
        await page.mouse.move(secondBranch.source.x, secondBranch.source.y);
        await page.mouse.down();
        await page.mouse.move(secondBranch.target.x, secondBranch.target.y, { steps: 12 });
        await page.mouse.up();
        const multipleBranches = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const geometry = spike.loadedCircuit.exportGeometry();
          return { junctionNames: geometry.elements.filter(element => element.type === 'JUNCTION')
            .map(element => element.name), wires: geometry.wires.length };
        });
        assert.equal(multipleBranches.wires, 6, 'a second branch splits the trunk again');
        assert.equal(new Set(multipleBranches.junctionNames).size, 2,
          'new junction names remain unique after saving and reopening');
        const bentBranch = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          spike.loadScmText(spike.crossingScm8);
          const graph = spike.graph;
          const trunk = [...spike.loadedCircuit.edges.values()][0];
          const route = graph.view.getState(trunk).absolutePoints;
          const Point = route[0].constructor;
          const start = route[0], end = route.at(-1);
          const bendY = start.y + 60;
          const firstBend = start.x + 60, secondBend = end.x - 60;
          const geometry = trunk.getGeometry().clone();
          geometry.points = [new Point(firstBend, bendY), new Point(secondBend, bendY)];
          graph.getDataModel().setGeometry(trunk, geometry);
          const source = [...spike.loadedCircuit.ports.values()]
            .find(port => port.getParent().getValue() === 'R3');
          const sourceState = graph.view.getState(source);
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          return { source: { x: canvas.left + sourceState.x + sourceState.width / 2,
            y: canvas.top + sourceState.y + sourceState.height / 2 },
            target: { x: canvas.left + (firstBend + secondBend) / 2, y: canvas.top + bendY },
            originalBends: geometry.points.map(point => ({ x: point.x, y: point.y })) };
        });
        await page.mouse.move(bentBranch.source.x, bentBranch.source.y);
        await page.mouse.down();
        await page.mouse.move(bentBranch.target.x, bentBranch.target.y, { steps: 12 });
        await page.mouse.up();
        const bentResult = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const geometry = spike.loadedCircuit.exportGeometry();
          return { elements: geometry.elements.length, wires: geometry.wires.length,
            bends: geometry.wires.flatMap(wire => wire.waypoints ?? []),
            junction: geometry.elements.find(element => element.type === 'JUNCTION') };
        });
        assert.equal(bentResult.elements, 5, 'branching from a bent conductor creates a real junction');
        assert.equal(bentResult.wires, 4, 'branching preserves both halves of the bent conductor');
        assert.ok(bentResult.bends.some(point => point.y === bentBranch.originalBends[0].y),
          'manual bend height survives splitting the conductor');
        const bentSaved = await page.evaluate(() => window.napsMaxGraphSpike.serializeLoadedProject());
        const bentReopened = await page.evaluate(saved => window.napsMaxGraphSpike.loadScmText(saved), bentSaved);
        assert.equal(bentReopened.elements.length, 5, 'bent junction survives SCM reopening');
        assert.equal(bentReopened.wires.length, 4, 'bent conductor branches survive SCM reopening');
        const removedBranch = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          const graph = spike.graph;
          const node = spike.loadedCircuit.exportGeometry().elements.find(element => element.type === 'JUNCTION');
          const port = spike.loadedCircuit.ports.get(`${node.id}_1`);
          const branch = graph.getEdges(port).find(edge =>
            [edge.getTerminal(true), edge.getTerminal(false)].some(terminal =>
              terminal !== port && terminal.getParent().getValue() === 'R3'));
          graph.removeCells([branch]);
          return { wires: spike.loadedCircuit.exportGeometry().wires.length,
            branches: graph.getEdges(port).length };
        });
        assert.deepEqual(removedBranch, { wires: 3, branches: 2 },
          'removing one T branch leaves the trunk connected without a hanging segment');
        await page.locator('#undo').click();
        assert.equal(await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.exportGeometry().wires.length),
          4, 'Undo restores the removed T branch');
        await page.locator('#redo').click();
        assert.equal(await page.evaluate(() => window.napsMaxGraphSpike.loadedCircuit.exportGeometry().wires.length),
          3, 'Redo removes only the selected branch again');
        const endpointBranch = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          spike.loadScmText(spike.crossingScm8);
          const graph = spike.graph;
          const trunk = [...spike.loadedCircuit.edges.values()][0];
          const source = [...spike.loadedCircuit.ports.values()]
            .find(port => port.getParent().getValue() === 'R3');
          const wire = graph.insertEdge({ source, target: trunk,
            style: { edgeStyle: 'orthogonalEdgeStyle', strokeColor: '#168348', endArrow: 'none' } });
          const endpoint = graph.view.getState(trunk).absolutePoints[0];
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          const accepted = spike.loadedCircuit.materializeEdgeBranch(wire, trunk,
            canvas.left + endpoint.x, canvas.top + endpoint.y);
          const geometry = spike.loadedCircuit.exportGeometry();
          return { accepted, elements: geometry.elements.length, wires: geometry.wires.length,
            sameTerminal: wire.getTerminal(false) === trunk.getTerminal(true) };
        });
        assert.deepEqual(endpointBranch, { accepted: true, elements: 4, wires: 3, sameTerminal: true },
          'dropping at an existing wire endpoint reuses its contact without a duplicate junction');
        const legacyT = await page.evaluate(() => {
          const spike = window.napsMaxGraphSpike;
          spike.loadScmText(spike.crossingScm7);
          const graph = spike.graph;
          const trunk = [...spike.loadedCircuit.edges.values()][0];
          const source = [...spike.loadedCircuit.ports.values()]
            .find(port => port.getParent().getValue() === 'R3');
          const wire = graph.insertEdge({ source, target: trunk,
            style: { edgeStyle: 'orthogonalEdgeStyle', strokeColor: '#168348', endArrow: 'none' } });
          const route = graph.view.getState(trunk).absolutePoints;
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          spike.loadedCircuit.materializeEdgeBranch(wire, trunk,
            canvas.left + (route[0].x + route.at(-1).x) / 2 - 50, canvas.top + route[0].y);
          const topology = spike.analyzeLoadedTopology();
          return { mode: spike.loadedProject.crossingMode,
            joined: topology.normalized.networks['R1.2'] === topology.normalized.networks['R3.1'],
            explicitJunctions: topology.raw.elements.filter(element => element.type === 'JUNCTION').length };
        });
        assert.deepEqual(legacyT, { mode: 'explicit', joined: true, explicitJunctions: 1 },
          'SCM 7 keeps passive crossings separate but joins an explicitly added T branch');
      }
      assert.ok(result.svgPaths > count, `${count}: edges are rendered`);
      console.log(JSON.stringify({ wires: count, createdMs: Math.round(result.createdMs),
        moveMedianMs: Math.round([...result.runs].sort((a, b) => a - b)[5]), svgPaths: result.svgPaths }));
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
