import type { CircuitDescription } from './yamlScm';
import { paperSize, SCHEMATIC_UNITS_PER_MM, type PrintLayout } from './printLayout';
import { draftingFontSize } from './draftingFont';

export const TITLE_BLOCK_WIDTH_MM = 185;
export const TITLE_BLOCK_HEIGHT_MM = 55;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function titleBlockBounds(layout: PrintLayout) {
  const page = paperSize(layout);
  const rotated = layout.format === 'A4' && layout.orientation === 'landscape';
  const widthMm = rotated ? TITLE_BLOCK_HEIGHT_MM : TITLE_BLOCK_WIDTH_MM;
  const heightMm = rotated ? TITLE_BLOCK_WIDTH_MM : TITLE_BLOCK_HEIGHT_MM;
  return { xMm: page.widthMm - 5 - widthMm, yMm: page.heightMm - 5 - heightMm,
    widthMm, heightMm, rotated };
}

/** Physical, unscaled Form 1 title area. Its user fields are intentionally blank until entered. */
export function createTitleBlock(document: Document, layout: PrintLayout, description: CircuitDescription, scaleLabel: string): SVGGElement {
  const bounds = titleBlockBounds(layout), units = SCHEMATIC_UNITS_PER_MM;
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('data-eskd-title-block', 'true');
  group.setAttribute('data-width-mm', String(bounds.widthMm));
  group.setAttribute('data-height-mm', String(bounds.heightMm));
  group.setAttribute('data-rotation', bounds.rotated ? '90' : '0');
  group.setAttribute('transform', bounds.rotated
    ? `translate(${(bounds.xMm + bounds.widthMm) * units} ${bounds.yMm * units}) rotate(90)`
    : `translate(${bounds.xMm * units} ${bounds.yMm * units})`);
  const line = (x1: number, y1: number, x2: number, y2: number, strong = false) => {
    const node = document.createElementNS(SVG_NS, 'line');
    for (const [key, value] of [['x1', x1], ['y1', y1], ['x2', x2], ['y2', y2]] as const) node.setAttribute(key, String(value * units));
    node.setAttribute('stroke', '#111111'); node.setAttribute('stroke-width', strong ? '2' : '1');
    group.appendChild(node);
  };
  const label = (field: string, value: string, x: number, y: number, width = 50, size = 2.5) => {
    if (!value) return;
    const node = document.createElementNS(SVG_NS, 'text');
    node.setAttribute('data-eskd-field', field);
    node.setAttribute('x', String(x * units)); node.setAttribute('y', String(y * units));
    node.setAttribute('font-size', String(draftingFontSize(size))); node.setAttribute('fill', '#111111');
    node.setAttribute('font-family', 'NAPS Drafting, Arial Narrow, sans-serif');
    if (value.length * size * 0.55 / 0.64 > width) {
      node.setAttribute('textLength', String(width * units)); node.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    node.textContent = value; group.appendChild(node);
  };
  const outline = document.createElementNS(SVG_NS, 'rect');
  outline.setAttribute('x', '0'); outline.setAttribute('y', '0');
  outline.setAttribute('width', String(TITLE_BLOCK_WIDTH_MM * units));
  outline.setAttribute('height', String(TITLE_BLOCK_HEIGHT_MM * units));
  outline.setAttribute('fill', 'white'); outline.setAttribute('stroke', '#111111'); outline.setAttribute('stroke-width', '2');
  group.appendChild(outline);
  // Form 1: revision section 7+10+23+15+10 mm; identification 70 mm; issue area 50 mm.
  for (const x of [7, 17, 40, 55, 65]) line(x, 0, x, 55);
  for (const y of [15, 20, 25, 30, 35, 40, 45, 50]) line(0, y, 65, y);
  line(65, 15, 185, 15); line(65, 40, 135, 40); line(135, 15, 135, 55);
  // Form 1: three 5 mm letter cells, 17 mm mass cell, 18 mm scale cell.
  for (const x of [140, 145, 150, 167]) line(x, 15, x, 35);
  line(135, 20, 185, 20); line(135, 35, 185, 35);
  line(155, 35, 155, 55); line(135, 40, 185, 40);
  label('revision', 'Изм.', 0.5, 18.5, 6);
  label('revision-sheet', 'Лист', 7.3, 18.5, 9);
  label('revision-document', '№ докум.', 17.5, 18.5, 22);
  label('revision-signature', 'Подп.', 40.5, 18.5, 14);
  label('revision-date', 'Дата', 55.5, 18.5, 9);
  const persons = [
    ['author', 'Разраб.', description.author ?? ''],
    ['checker', 'Пров.', description.checker ?? ''],
    ['technical-controller', 'Т. контр.', description.technicalController ?? ''],
    ['norm-controller', 'Н. контр.', description.normController ?? ''],
    ['approver', 'Утв.', description.approver ?? ''],
  ] as const;
  persons.forEach(([field, role, name], index) => {
    const y = 23.5 + index * 5;
    label(`${field}-role`, role, 7.3, y, 9);
    label(field, name, 17.5, y, 22);
  });
  label('issue-date', description.issueDate ?? '', 55.3, 23.5, 9);
  label('designation', description.designation ?? '', 67, 10, 116, 3.5);
  label('title', description.title || 'Электрическая схема', 67, 27, 66, 3.5);
  label('purpose', description.purpose ?? '', 67, 35, 66);
  label('letter-label', 'Лит.', 136, 18.5, 13);
  Array.from(description.letter ?? '').slice(0, 3).forEach((character, index) =>
    label(`letter-${index + 1}`, character, 136 + index * 5, 29, 4, 2.5));
  label('mass-label', 'Масса', 151, 18.5, 16);
  label('mass', description.mass ?? '', 152, 29, 14);
  label('scale-label', 'Масштаб', 168, 18.5, 17);
  label('scale', scaleLabel, 172, 29, 12, 3.5);
  label('sheet-label', 'Лист', 136, 38.5, 18);
  label('sheet-count-label', 'Листов', 156, 38.5, 28);
  label('sheet-number', description.sheetNumber ?? '', 140, 49, 14);
  label('sheet-count', description.sheetCount ?? '', 160, 49, 23);
  label('organization', description.organization ?? '', 67, 49, 66, 2.5);
  // Form 1 fields 31 and 32 occupy the 5 mm strip below the main inscription.
  // The user-facing A4 landscape variant rotates Form 1 and has no normative bottom strip.
  if (!bounds.rotated) {
    label('copier', `Копировал${description.copier ? `: ${description.copier}` : ''}`, 83, 58.5, 48, 2.5);
    label('paper-format', `Формат ${layout.format}`, 151, 58.5, 32, 2.5);
  }
  return group;
}
