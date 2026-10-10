export type PaperFormat = 'A4' | 'A3';
export type PaperOrientation = 'landscape' | 'portrait';
export interface PrintLayout { format: PaperFormat; orientation: PaperOrientation; gridMm: 2.5 | 5 | 10 }

// The schematic has always used a 20-unit main grid. Give that existing
// coordinate system a physical meaning without moving legacy SCM objects.
export const SCHEMATIC_UNITS_PER_MM = 4;
export const GRID_MM = 5;
export const DEFAULT_PRINT_LAYOUT: PrintLayout = { format: 'A4', orientation: 'landscape', gridMm: 5 };
const PAPER_MM: Record<PaperFormat, readonly [number, number]> = {
  A4: [210, 297], A3: [297, 420],
};

export function paperSize(layout: PrintLayout) {
  const [short, long] = PAPER_MM[layout.format];
  const widthMm = layout.orientation === 'landscape' ? long : short;
  const heightMm = layout.orientation === 'landscape' ? short : long;
  return { widthMm, heightMm, width: widthMm * SCHEMATIC_UNITS_PER_MM, height: heightMm * SCHEMATIC_UNITS_PER_MM };
}

export function parsePrintLayout(format?: string, orientation?: string, gridMm?: number): PrintLayout {
  if (format === undefined && orientation === undefined && gridMm === undefined) return { ...DEFAULT_PRINT_LAYOUT };
  if ((format !== 'A4' && format !== 'A3') || (orientation !== 'landscape' && orientation !== 'portrait')) {
    throw new Error('Формат листа: выберите A4/A3 и книжную/альбомную ориентацию.');
  }
  const step = gridMm ?? 5;
  if (step !== 2.5 && step !== 5 && step !== 10) throw new Error('Шаг сетки: допустимы 2,5, 5 или 10 мм.');
  return { format, orientation, gridMm: step };
}
