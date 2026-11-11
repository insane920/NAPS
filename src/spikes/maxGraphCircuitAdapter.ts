import { Graph, Point, type Cell } from '@maxgraph/core';
import { getComponentPins } from '../components/SchematicEditor';
import type { CircuitElement, CircuitWire } from '../types';

/** Migration experiment: SCM stays authoritative while maxGraph owns canvas interaction. */
export function importCircuitIntoMaxGraph(graph: Graph, elements: CircuitElement[], wires: CircuitWire[], offsetX = 1100) {
  const preexistingEdges = new Set(graph.getChildCells(graph.getDefaultParent(), false, true));
  const cells = new Map<string, Cell>();
  const ports = new Map<string, Cell>();
  const portReferences = new Map<Cell, { elementId: string; pinId: string }>();
  const edges = new Map<string, Cell>();
  const originalWires = new Map<Cell, CircuitWire>();
  const originals = new Map(elements.map(element => [element.id, element]));
  const addedElements: CircuitElement[] = [];
  let branchSequence = 0;
  graph.batchUpdate(() => {
    for (const element of elements) {
      const isJunction = element.type === 'JUNCTION';
      const width = isJunction ? 14 : 80, height = isJunction ? 14 : 40;
      const cell = graph.insertVertex({ id: `scm-element-${element.id}`, value: isJunction ? '' : element.name,
        position: [element.x + offsetX - width / 2, element.y - height / 2], size: [width, height],
        style: { shape: isJunction ? 'ellipse' : 'rectangle',
          fillColor: isJunction ? '#166534' : '#ffffff', strokeColor: isJunction ? '#166534' : '#245ee0' } });
      cell.setConnectable(false);
      cells.set(element.id, cell);
      for (const pin of getComponentPins(element)) {
        const portSize = isJunction ? 4 : 8;
        const port = graph.insertVertex({ parent: cell, id: `scm-pin-${element.id}-${pin.id}`, value: '',
          position: [(pin.x + width / 2) / width, (pin.y + height / 2) / height],
          size: [portSize, portSize], relative: true,
          style: { shape: 'ellipse', fillColor: isJunction ? '#166534' : '#245ee0',
            strokeColor: isJunction ? '#166534' : '#245ee0' } });
        const portGeometry = port.getGeometry()!.clone();
        portGeometry.offset = new Point(-portSize / 2, -portSize / 2);
        graph.getDataModel().setGeometry(port, portGeometry);
        ports.set(`${element.id}_${pin.id}`, port);
        portReferences.set(port, { elementId: element.id, pinId: pin.id });
      }
    }
    for (const wire of wires) {
      const source = ports.get(`${wire.fromCompId}_${wire.fromPinId}`);
      const target = ports.get(`${wire.toCompId}_${wire.toPinId}`);
      if (!source || !target) continue;
      const edge = graph.insertEdge({ id: `scm-wire-${wire.id}`, source, target,
        style: { edgeStyle: wire.routeMode === 'direct' ? undefined : 'orthogonalEdgeStyle',
          strokeColor: '#168348', endArrow: 'none' } });
      if (wire.waypoints?.length) {
        const geometry = edge.getGeometry()!.clone();
        geometry.points = wire.waypoints.map(point => new Point(point.x + offsetX, point.y));
        graph.getDataModel().setGeometry(edge, geometry);
      }
      edges.set(wire.id, edge);
      originalWires.set(edge, wire);
    }
  });
  const exportGeometry = () => ({
    elements: [...elements, ...addedElements].filter(element => cells.get(element.id)?.getParent()).map(element => {
      const geometry = cells.get(element.id)?.getGeometry();
      return geometry ? { ...originals.get(element.id)!,
        x: geometry.x + geometry.width / 2 - offsetX,
        y: geometry.y + geometry.height / 2 } : element;
    }),
    wires: graph.getChildCells(graph.getDefaultParent(), false, true).filter(edge => !preexistingEdges.has(edge)).map(edge => {
      const wire = originalWires.get(edge);
      const source = portReferences.get(edge.getTerminal(true)!);
      const target = portReferences.get(edge.getTerminal(false)!);
      if (!source || !target) throw new Error(`Провод ${wire?.id ?? edge.getId()}: конец не подключён к известному выводу.`);
      const points = edge.getGeometry()?.points;
      const { waypoints: _oldPoints, ...base } = wire ?? { id: `new_${edge.getId()}` };
      const connected = { ...base, fromCompId: source.elementId, fromPinId: source.pinId,
        toCompId: target.elementId, toPinId: target.pinId };
      return points?.length ? { ...connected, waypoints: points.map(point => ({ x: point.x - offsetX, y: point.y })) } : connected;
    }),
  });
  const getVisibleRoutes = () => {
    const exported = exportGeometry();
    const liveEdges = graph.getChildCells(graph.getDefaultParent(), false, true)
      .filter(edge => !preexistingEdges.has(edge));
    return exported.wires.map((wire, index) => {
      const state = graph.view.getState(liveEdges[index]);
      if (!state?.absolutePoints?.length) throw new Error(`Провод ${wire.id}: видимый маршрут отсутствует.`);
      return { wire, points: state.absolutePoints.map(point => ({
        x: point.x / graph.view.scale - graph.view.translate.x - offsetX,
        y: point.y / graph.view.scale - graph.view.translate.y,
      })) };
    });
  };
  const toCanvasPoint = (point: { x: number; y: number }) => ({
    x: (point.x + offsetX + graph.view.translate.x) * graph.view.scale,
    y: (point.y + graph.view.translate.y) * graph.view.scale,
  });
  const materializeEdgeBranch = (branch: Cell, trunk: Cell, clientX: number, clientY: number) => {
    if (preexistingEdges.has(trunk) || branch.getTerminal(false) !== trunk ||
        !portReferences.has(branch.getTerminal(true)!)) return false;
    const state = graph.view.getState(trunk);
    if (!state?.absolutePoints || state.absolutePoints.length < 2) return false;
    const canvas = graph.container.getBoundingClientRect();
    const cursor = { x: clientX - canvas.left, y: clientY - canvas.top };
    const route = state.absolutePoints.map(point => ({
      x: point.x / graph.view.scale - graph.view.translate.x,
      y: point.y / graph.view.scale - graph.view.translate.y,
    }));
    let closest: { index: number; x: number; y: number; distance: number } | undefined;
    const worldCursor = { x: cursor.x / graph.view.scale - graph.view.translate.x,
      y: cursor.y / graph.view.scale - graph.view.translate.y };
    for (let index = 0; index < route.length - 1; index++) {
      const a = route[index], b = route[index + 1];
      const fraction = Math.max(0, Math.min(1, ((worldCursor.x - a.x) * (b.x - a.x) +
        (worldCursor.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)));
      const x = a.x + fraction * (b.x - a.x), y = a.y + fraction * (b.y - a.y);
      const distance = Math.hypot(x - worldCursor.x, y - worldCursor.y);
      if (!closest || distance < closest.distance) closest = { index, x, y, distance };
    }
    if (!closest || closest.distance > 12 / graph.view.scale) return false;
    const oldSource = trunk.getTerminal(true), oldTarget = trunk.getTerminal(false);
    if (!oldSource || !oldTarget) return false;
    // Reuse an existing electrical contact when the drop lands at the end of
    // the trunk. Splitting there would create a zero-length edge and a second
    // junction on top of the same visible point.
    for (const [terminal, endpoint] of [[oldSource, route[0]], [oldTarget, route[route.length - 1]]] as const) {
      if (Math.hypot(closest.x - endpoint.x, closest.y - endpoint.y) <= 4 / graph.view.scale) {
        if (branch.getTerminal(true) === terminal) return false;
        graph.getDataModel().setTerminal(branch, terminal, false);
        return true;
      }
    }
    const usedNames = new Set([...elements, ...addedElements]
      .filter(element => cells.get(element.id)?.getParent()).map(element => element.name));
    let nodeName: string;
    do { nodeName = `N${++branchSequence}`; } while (usedNames.has(nodeName));
    const id = `branch_${Date.now()}_${branchSequence}`;
    const node: CircuitElement = { id, type: 'JUNCTION', name: nodeName,
      x: closest.x - offsetX, y: closest.y, rotation: 0, value: 0, valueStr: '', unit: '' };
    const interior = (points: typeof route) => points.map(point => new Point(point.x, point.y));
    graph.batchUpdate(() => {
      const nodeCell = graph.insertVertex({ id: `scm-element-${id}`, value: '',
        position: [closest!.x - 7, closest!.y - 7], size: [14, 14],
        style: { shape: 'ellipse', fillColor: '#166534', strokeColor: '#166534' } });
      nodeCell.setConnectable(false);
      const port = graph.insertVertex({ parent: nodeCell, id: `scm-pin-${id}-1`, value: '',
        position: [0.5, 0.5], size: [4, 4], relative: true,
        style: { shape: 'ellipse', fillColor: '#166534', strokeColor: '#166534' } });
      const portGeometry = port.getGeometry()!.clone();
      portGeometry.offset = new Point(-2, -2);
      graph.getDataModel().setGeometry(port, portGeometry);
      cells.set(id, nodeCell);
      ports.set(`${id}_1`, port);
      portReferences.set(port, { elementId: id, pinId: '1' });
      originals.set(id, node);
      addedElements.push(node);
      const first = trunk.getGeometry()!.clone();
      first.points = interior(route.slice(1, closest!.index + 1));
      graph.getDataModel().setTerminal(trunk, port, false);
      graph.getDataModel().setGeometry(trunk, first);
      const second = graph.insertEdge({ source: port, target: oldTarget,
        style: { edgeStyle: 'orthogonalEdgeStyle', strokeColor: '#168348', endArrow: 'none' } });
      const secondGeometry = second.getGeometry()!.clone();
      secondGeometry.points = interior(route.slice(closest!.index + 1, -1));
      graph.getDataModel().setGeometry(second, secondGeometry);
      graph.getDataModel().setTerminal(branch, port, false);
      // ConnectionHandler creates a straight edge by default. Keep the live
      // route orthogonal so saving and reopening cannot silently add a bend.
      graph.getDataModel().setStyle(branch, { ...branch.getStyle(),
        edgeStyle: 'orthogonalEdgeStyle', strokeColor: '#168348', endArrow: 'none' });
    });
    return true;
  };
  /** Make a derived SCM 8 X crossing into one movable, serializable node. */
  const materializeCrossing = (point: { x: number; y: number }): Cell | null => {
    const world = { x: point.x + offsetX, y: point.y };
    const candidates: Array<{ edge: Cell; route: Array<{ x: number; y: number }>; index: number }> = [];
    for (const edge of graph.getChildCells(graph.getDefaultParent(), false, true)) {
      if (preexistingEdges.has(edge)) continue;
      const state = graph.view.getState(edge);
      if (!state?.absolutePoints?.length) continue;
      const route = state.absolutePoints.map(location => ({
        x: location.x / graph.view.scale - graph.view.translate.x,
        y: location.y / graph.view.scale - graph.view.translate.y,
      }));
      const index = route.findIndex((a, segment) => {
        const b = route[segment + 1];
        if (!b) return false;
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((world.x - a.x) * dx + (world.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(a.x + t * dx - world.x, a.y + t * dy - world.y) <= 1;
      });
      if (index >= 0) {
        if (Math.hypot(route[0].x - world.x, route[0].y - world.y) < 4 ||
            Math.hypot(route.at(-1)!.x - world.x, route.at(-1)!.y - world.y) < 4) return null;
        candidates.push({ edge, route, index });
      }
    }
    if (candidates.length < 2) return null;
    const usedNames = new Set([...elements, ...addedElements]
      .filter(element => cells.get(element.id)?.getParent()).map(element => element.name));
    let nodeName: string;
    do { nodeName = `N${++branchSequence}`; } while (usedNames.has(nodeName));
    const id = `crossing_${Date.now()}_${branchSequence}`;
    const node: CircuitElement = { id, type: 'JUNCTION', name: nodeName,
      x: point.x, y: point.y, rotation: 0, value: 0, valueStr: '', unit: '' };
    let nodeCell: Cell | null = null;
    graph.batchUpdate(() => {
      nodeCell = graph.insertVertex({ id: `scm-element-${id}`, value: '',
        position: [world.x - 7, world.y - 7], size: [14, 14],
        style: { shape: 'ellipse', fillColor: '#166534', strokeColor: '#166534' } });
      nodeCell!.setConnectable(false);
      const port = graph.insertVertex({ parent: nodeCell!, id: `scm-pin-${id}-1`, value: '',
        position: [0.5, 0.5], size: [4, 4], relative: true,
        style: { shape: 'ellipse', fillColor: '#166534', strokeColor: '#166534' } });
      const portGeometry = port.getGeometry()!.clone();
      portGeometry.offset = new Point(-2, -2);
      graph.getDataModel().setGeometry(port, portGeometry);
      cells.set(id, nodeCell!);
      ports.set(`${id}_1`, port);
      portReferences.set(port, { elementId: id, pinId: '1' });
      originals.set(id, node);
      addedElements.push(node);
      for (const { edge, route, index } of candidates) {
        const oldTarget = edge.getTerminal(false);
        if (!oldTarget) continue;
        const first = edge.getGeometry()!.clone();
        first.points = route.slice(1, index + 1).map(p => new Point(p.x, p.y));
        graph.getDataModel().setTerminal(edge, port, false);
        graph.getDataModel().setGeometry(edge, first);
        const second = graph.insertEdge({ source: port, target: oldTarget,
          style: { edgeStyle: 'orthogonalEdgeStyle', strokeColor: '#168348', endArrow: 'none' } });
        const secondGeometry = second.getGeometry()!.clone();
        secondGeometry.points = route.slice(index + 1, -1).map(p => new Point(p.x, p.y));
        graph.getDataModel().setGeometry(second, secondGeometry);
      }
    });
    return nodeCell;
  };
  return { cells, ports, edges, exportGeometry, getVisibleRoutes, toCanvasPoint,
    materializeEdgeBranch, materializeCrossing };
}
