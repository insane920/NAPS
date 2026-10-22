import type { CircuitDescription } from './yamlScm';
import { paperSize, SCHEMATIC_UNITS_PER_MM, type PrintLayout } from './printLayout';

export const TITLE_BLOCK_WIDTH_MM = 185;
export const TITLE_BLOCK_HEIGHT_MM = 55;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function titleBlockBounds(layout: PrintLayout) {
  const page = paperSize(layout);
  return { xMm: page.widthMm - 5 - TITLE_BLOCK_WIDTH_MM, yMm: page.heightMm - 5 - TITLE_BLOCK_HEIGHT_MM,
    widthMm: TITLE_BLOCK_WIDTH_MM, heightMm: TITLE_BLOCK_HEIGHT_MM };
}

/** Physical, unscaled Form 1 title area. Its user fields are intentionally blank until entered. */
export function createTitleBlock(document: Document, layout: PrintLayout, description: CircuitDescription, scaleLabel: string): SVGGElement {
  const bounds = titleBlockBounds(layout), units = SCHEMATIC_UNITS_PER_MM;
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('data-eskd-title-block', 'true');
  group.setAttribute('data-width-mm', String(bounds.widthMm));
  group.setAttribute('data-height-mm', String(bounds.heightMm));
  group.setAttribute('transform', `translate(${bounds.xMm * units} ${bounds.yMm * units})`);
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
    node.setAttribute('font-size', String(size * units)); node.setAttribute('fill', '#111111');
    node.setAttribute('font-family', 'GOST type A, GOST 2.304, Arial Narrow, sans-serif');
    if (value.length * size * 0.55 > width) {
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
  // Form 1's 65 mm revision section and 120 mm identification area remain in real millimetres.
  for (const x of [7, 17, 40, 55, 65]) line(x, 0, x, 55);
  for (const y of [11, 22, 33, 44]) line(0, y, 65, y);
  line(65, 15, 185, 15); line(65, 30, 185, 30); line(65, 42, 185, 42);
  line(135, 30, 135, 55); line(160, 42, 160, 55);
  line(65, 49, 185, 49);
  label('revision', 'Изм.', 0.6, 3.5, 6, 1.8);
  label('revision-sheet', 'Лист', 7.5, 3.5, 9, 1.8);
  label('revision-document', '№ докум.', 17.5, 3.5, 22, 1.8);
  label('revision-signature', 'Подп.', 40.5, 3.5, 14, 1.8);
  label('revision-date', 'Дата', 55.5, 3.5, 9, 1.8);
  label('title', description.title || 'Электрическая схема', 67, 11, 116, 3);
  label('designation', description.designation ?? '', 67, 26, 116, 3);
  label('author', `Разраб. ${description.author ?? ''}`, 67, 35, 66, 2.2);
  label('checker', `Пров. ${description.checker ?? ''}`, 67, 40, 66, 2.2);
  label('norm-controller', `Н. контр. ${description.normController ?? ''}`, 67, 46, 66, 2.2);
  label('approver', `Утв. ${description.approver ?? ''}`, 67, 53, 66, 2.2);
  label('organization', description.organization ?? '', 137, 35, 46, 2.5);
  label('issue-date', description.issueDate ?? '', 137, 40, 46, 2.2);
  label('scale', `Масштаб ${scaleLabel}`, 137, 46, 22, 1.9);
  label('sheet-number', `Лист ${description.sheetNumber ?? ''}`, 161, 46, 22, 1.9);
  label('sheet-count', `Листов ${description.sheetCount ?? ''}`, 137, 53, 46, 1.9);
  return group;
}
