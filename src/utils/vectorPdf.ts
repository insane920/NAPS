import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import fontDataUrl from '../assets/fonts/OpenGOSTtypeA-Regular.ttf?inline';

/** Convert the already laid-out SVG page without rasterizing lines, symbols or text. */
export async function vectorPagePdf(xml: string, widthMm: number, heightMm: number): Promise<Blob> {
  return vectorPagesPdf([xml], widthMm, heightMm);
}

/** Render each already-laid-out sheet as a separate vector PDF page. */
export async function vectorPagesPdf(pages: readonly string[], widthMm: number, heightMm: number): Promise<Blob> {
  if (!(widthMm > 0 && heightMm > 0)) throw new Error('Неверный физический размер листа PDF.');
  if (pages.length < 1 || pages.length > 64) throw new Error('PDF должен содержать от 1 до 64 листов.');
  const pointWidth = widthMm * 72 / 25.4;
  const pointHeight = heightMm * 72 / 25.4;
  const pdf = new jsPDF({ orientation: widthMm > heightMm ? 'landscape' : 'portrait',
    unit: 'pt', format: [pointWidth, pointHeight], precision: 12, compress: true,
    putOnlyUsedFonts: true });
  const base64 = fontDataUrl.slice(fontDataUrl.indexOf(',') + 1);
  pdf.addFileToVFS('OpenGOSTtypeA-Regular.ttf', base64);
  pdf.addFont('OpenGOSTtypeA-Regular.ttf', 'NAPS Drafting', 'normal');
  pdf.addFont('OpenGOSTtypeA-Regular.ttf', 'NAPS Drafting', 'bold');
  pdf.setFont('NAPS Drafting', 'normal');
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const parsed = new DOMParser().parseFromString(pages[pageIndex], 'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw new Error(`SVG листа ${pageIndex + 1} повреждён.`);
    const source = parsed.documentElement;
    if (source.localName !== 'svg') throw new Error('Векторный экспорт требует SVG схемы.');
    const svg = document.importNode(source, true) as unknown as SVGSVGElement;
    // jsPDF uses its own registered font; an SVG @font-face data URI would be ignored.
    svg.querySelectorAll('style').forEach(style => style.remove());
    svg.style.position = 'fixed'; svg.style.left = '-100000px'; svg.style.top = '0';
    document.body.appendChild(svg);
    try {
      if (pageIndex > 0) pdf.addPage([pointWidth, pointHeight], widthMm > heightMm ? 'landscape' : 'portrait');
      pdf.setFont('NAPS Drafting', 'normal');
      await svg2pdf(svg, pdf, { x: 0, y: 0, width: pointWidth, height: pointHeight,
        loadExternalStyleSheets: false, loadImages: false });
    } finally { svg.remove(); }
  }
  return pdf.output('blob');
}
