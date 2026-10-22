export type PaperFormat = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
export type PaperOrientation = 'landscape' | 'portrait';
export type GridStepMm = 0.5 | 1 | 2 | 2.5 | 5 | 10;
export interface PrintLayout { format: PaperFormat; orientation: PaperOrientation; gridMm: GridStepMm }
export interface SchemeBounds { x: number; y: number; width: number; height: number }
export interface PrintPlacement {
  widthMm: number; heightMm: number; width: number; height: number;
  scale: number; translateX: number; translateY: number; fits: boolean;
  contentWidthMm: number; contentHeightMm: number;
}

// The schematic has always used a 20-unit main grid. Give that existing
// coordinate system a physical meaning without moving legacy SCM objects.
export const SCHEMATIC_UNITS_PER_MM = 4;
export const GRID_MM = 5;
export const DEFAULT_PRINT_LAYOUT: PrintLayout = { format: 'A4', orientation: 'landscape', gridMm: 5 };
const PAPER_MM: Record<PaperFormat, readonly [number, number]> = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297],
};

export function paperSize(layout: PrintLayout) {
  const [short, long] = PAPER_MM[layout.format];
  const widthMm = layout.orientation === 'landscape' ? long : short;
  const heightMm = layout.orientation === 'landscape' ? short : long;
  return { widthMm, heightMm, width: widthMm * SCHEMATIC_UNITS_PER_MM, height: heightMm * SCHEMATIC_UNITS_PER_MM };
}

/** Scheme units are physical coordinates. Zoom and monitor DPI never enter this calculation. */
export function computePrintPlacement(bounds: SchemeBounds, layout: PrintLayout, marginMm: number, mode: 'actual' | 'fit', requestedScale = 1, center = true, reservedBottomMm = 0, reservedRightMm = 0): PrintPlacement {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, marginMm, requestedScale, reservedBottomMm, reservedRightMm].every(Number.isFinite) ||
      bounds.width < 0 || bounds.height < 0 || marginMm < 0 || reservedBottomMm < 0 || reservedRightMm < 0 || requestedScale <= 0) throw new Error('Некорректные размеры схемы или параметры печати.');
  const page = paperSize(layout);
  const left = marginMm * SCHEMATIC_UNITS_PER_MM;
  const right = Math.max(marginMm, reservedRightMm) * SCHEMATIC_UNITS_PER_MM;
  const usableWidth = page.width - left - right;
  const top = marginMm * SCHEMATIC_UNITS_PER_MM;
  const bottom = Math.max(marginMm, reservedBottomMm) * SCHEMATIC_UNITS_PER_MM;
  const usableHeight = page.height - top - bottom;
  if (usableWidth <= 0 || usableHeight <= 0) throw new Error('Поля не оставляют места для схемы.');
  const scale = mode === 'fit'
    ? Math.min(1, usableWidth / Math.max(bounds.width, 1), usableHeight / Math.max(bounds.height, 1))
    : requestedScale;
  const fits = bounds.width * scale <= usableWidth + 1e-8 && bounds.height * scale <= usableHeight + 1e-8;
  const translateX = (center ? left + (usableWidth - bounds.width * scale) / 2 : left) - bounds.x * scale;
  const translateY = (center ? top + (usableHeight - bounds.height * scale) / 2 : top) - bounds.y * scale;
  return { ...page, scale, translateX, translateY, fits,
    contentWidthMm: bounds.width / SCHEMATIC_UNITS_PER_MM, contentHeightMm: bounds.height / SCHEMATIC_UNITS_PER_MM };
}

export function printScaleLabel(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return '—';
  return scale >= 1 ? `${Number(scale.toFixed(2))}:1` : `1:${Number((1 / scale).toFixed(2))}`;
}

export function parsePrintLayout(format?: string, orientation?: string, gridMm?: number): PrintLayout {
  if (format === undefined && orientation === undefined && gridMm === undefined) return { ...DEFAULT_PRINT_LAYOUT };
  if ((format !== 'A0' && format !== 'A1' && format !== 'A2' && format !== 'A3' && format !== 'A4') ||
      (orientation !== 'landscape' && orientation !== 'portrait')) {
    throw new Error('Формат листа: выберите A0–A4 и книжную/альбомную ориентацию.');
  }
  const step = gridMm ?? 5;
  if (step !== 0.5 && step !== 1 && step !== 2 && step !== 2.5 && step !== 5 && step !== 10) throw new Error('Шаг сетки: допустимы 0,5, 1, 2, 2,5, 5 или 10 мм.');
  return { format, orientation, gridMm: step };
}
