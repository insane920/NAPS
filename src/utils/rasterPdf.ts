/** One-page RGB JPEG PDF at an exact physical paper size. The drawing is
 * rendered at 300 dpi before it reaches this writer; no printer fit-to-page
 * setting is encoded into the PDF. */
export async function rasterPagePdf(jpeg: Blob, pixelWidth: number, pixelHeight: number, widthMm: number, heightMm: number): Promise<Blob> {
  if (![pixelWidth, pixelHeight, widthMm, heightMm].every(Number.isFinite) || pixelWidth <= 0 || pixelHeight <= 0 || widthMm <= 0 || heightMm <= 0) {
    throw new Error('Некорректные размеры листа PDF.');
  }
  const encode = new TextEncoder();
  const image = new Uint8Array(await jpeg.arrayBuffer());
  const widthPt = widthMm * 72 / 25.4;
  const heightPt = heightMm * 72 / 25.4;
  const paint = encode.encode(`q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ\n`);
  const chunks: Uint8Array[] = [];
  let position = 0;
  const offsets = [0];
  const push = (bytes: Uint8Array) => { chunks.push(bytes); position += bytes.length; };
  const write = (text: string) => push(encode.encode(text));
  const object = (id: number, body: () => void) => {
    offsets[id] = position;
    write(`${id} 0 obj\n`); body(); write('\nendobj\n');
  };
  write('%PDF-1.4\n');
  object(1, () => write('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => write('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  object(3, () => write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  object(4, () => {
    write(`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
    push(image); write('\nendstream');
  });
  object(5, () => { write(`<< /Length ${paint.length} >>\nstream\n`); push(paint); write('endstream'); });
  const xref = position;
  write('xref\n0 6\n0000000000 65535 f \n');
  for (let id = 1; id <= 5; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
