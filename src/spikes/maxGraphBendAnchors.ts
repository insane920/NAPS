import { Graph, InternalEvent, Point, type Cell } from '@maxgraph/core';

/** Keep the end of a user-moved segment attached to a component as it moves. */
export function installTerminalBendAnchors(graph: Graph) {
  const center = (terminal: Cell) => {
    const geometry = terminal.getGeometry()!;
    if (geometry.relative && terminal.getParent()?.getGeometry()) {
      const parent = terminal.getParent()!.getGeometry()!;
      return { x: parent.x + geometry.x * parent.width + (geometry.offset?.x ?? 0) + geometry.width / 2,
        y: parent.y + geometry.y * parent.height + (geometry.offset?.y ?? 0) + geometry.height / 2 };
    }
    return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  };
  graph.addListener(InternalEvent.CELLS_MOVED, (_sender, event) => {
    const moved = event.getProperty('cells') as Cell[];
    const dx = event.getProperty('dx') as number;
    const dy = event.getProperty('dy') as number;
    if (!dx && !dy) return;
    for (const cell of moved) {
      if (!cell.isVertex()) continue;
      for (const terminal of [cell, ...graph.getChildCells(cell, true, false)]) {
        const current = center(terminal);
        for (const edge of graph.getEdges(terminal)) {
          const geometry = edge.getGeometry();
          if (!geometry?.points || geometry.points.length < 2) continue;
          const points = geometry.points.map(point => new Point(point.x, point.y));
          const source = edge.getTerminal(true) === terminal;
          const target = edge.getTerminal(false) === terminal;
          if (!source && !target) continue;
          const endpoint = source ? points[0] : points[points.length - 1];
          const adjacent = source ? points[1] : points[points.length - 2];
          let changed = false;
          if (Math.abs(endpoint.y - adjacent.y) < 0.001 &&
              Math.abs(endpoint.x - (current.x - dx)) < 0.001) {
            endpoint.x = current.x;
            changed = true;
          } else if (Math.abs(endpoint.x - adjacent.x) < 0.001 &&
              Math.abs(endpoint.y - (current.y - dy)) < 0.001) {
            endpoint.y = current.y;
            changed = true;
          }
          if (changed) {
            const next = geometry.clone();
            next.points = points;
            graph.getDataModel().setGeometry(edge, next);
          }
        }
      }
    }
  });
}
