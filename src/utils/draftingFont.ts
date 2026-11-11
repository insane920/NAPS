import { SCHEMATIC_UNITS_PER_MM } from './printLayout';

// Measured from the bundled drafting font's Cyrillic capital Н at 100 CSS units.
// SVG font-size is an em height; GOST text height is the actual capital height.
export const DRAFTING_CAP_HEIGHT_RATIO = 0.64;
export const DRAFTING_BOLD_CAP_HEIGHT_RATIO = 0.66;

export function draftingFontSize(capHeightMm: number, bold = false): number {
  return capHeightMm * SCHEMATIC_UNITS_PER_MM /
    (bold ? DRAFTING_BOLD_CAP_HEIGHT_RATIO : DRAFTING_CAP_HEIGHT_RATIO);
}
