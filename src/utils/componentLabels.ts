export interface ComponentLabelPoint {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface ComponentLabelLayout {
  name: ComponentLabelPoint;
  value: ComponentLabelPoint;
  isolation: ComponentLabelPoint;
}

interface ComponentLabelOptions {
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  showName?: boolean;
}

/** Positions labels with the component while keeping the text itself upright. */
export function getComponentLabelLayout({
  rotation = 0,
  flipH = false,
  flipV = false,
  showName = true,
}: ComponentLabelOptions): ComponentLabelLayout {
  const normalized = ((rotation % 360) + 360) % 360;
  const radians = normalized * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const isVertical = Math.abs(cos) < 0.3;

  const transform = (x: number, y: number): ComponentLabelPoint => {
    const localX = flipH ? -x : x;
    const localY = flipV ? -y : y;
    const transformedX = localX * cos - localY * sin;
    const transformedY = localX * sin + localY * cos;
    return {
      x: Math.round(transformedX * 10) / 10,
      y: Math.round(transformedY * 10) / 10,
      anchor: isVertical ? 'middle' : transformedX < 0 ? 'end' : 'start',
    };
  };

  return {
    name: transform(-38, -14),
    value: transform(showName ? 38 : -38, -14),
    isolation: { ...transform(0, -34), anchor: 'middle' },
  };
}
