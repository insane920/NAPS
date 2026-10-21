export interface SpatialEntry<T> {
  minX: number; minY: number; maxX: number; maxY: number;
  value: T;
}

interface Node<T> {
  minX: number; minY: number; maxX: number; maxY: number;
  entries?: SpatialEntry<T>[];
  left?: Node<T>;
  right?: Node<T>;
}

const intersects = (a: Pick<Node<unknown>, 'minX' | 'minY' | 'maxX' | 'maxY'>, x: number, y: number, radius: number) =>
  a.minX <= x + radius && a.maxX >= x - radius && a.minY <= y + radius && a.maxY >= y - radius;

/** Static bounding-volume tree rebuilt only when model-space geometry changes. */
export class SpatialIndex<T> {
  private readonly root?: Node<T>;

  constructor(entries: SpatialEntry<T>[]) {
    if (entries.length) this.root = this.build(entries);
  }

  private build(entries: SpatialEntry<T>[]): Node<T> {
    const node: Node<T> = {
      minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
    };
    for (const entry of entries) {
      node.minX = Math.min(node.minX, entry.minX);
      node.minY = Math.min(node.minY, entry.minY);
      node.maxX = Math.max(node.maxX, entry.maxX);
      node.maxY = Math.max(node.maxY, entry.maxY);
    }
    if (entries.length <= 16) { node.entries = entries; return node; }
    const axis = node.maxX - node.minX >= node.maxY - node.minY ? 'x' : 'y';
    entries.sort((a, b) => axis === 'x'
      ? (a.minX + a.maxX) - (b.minX + b.maxX)
      : (a.minY + a.maxY) - (b.minY + b.maxY));
    const middle = entries.length >> 1;
    node.left = this.build(entries.slice(0, middle));
    node.right = this.build(entries.slice(middle));
    return node;
  }

  query(x: number, y: number, radius: number): T[] {
    const result: T[] = [];
    const visit = (node?: Node<T>) => {
      if (!node || !intersects(node, x, y, radius)) return;
      if (node.entries) {
        for (const entry of node.entries) if (intersects(entry, x, y, radius)) result.push(entry.value);
      } else {
        visit(node.left);
        visit(node.right);
      }
    };
    visit(this.root);
    return result;
  }
}
