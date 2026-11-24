type ReportRow = Record<string, unknown>;
type ChanceTotals = Record<string, string | number>;

const pageWidth = 1684;
const pageHeight = 1191;
const moneyFields = new Set(['sale', 'subtotal', 'discount', 'tax', 'cgst', 'sgst', 'total', 'rounding', 'grand', 'amount']);
const titleCase = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const amount = (value: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(value ?? 0));
const safe = (value: unknown) => value === null || value === undefined || value === '' ? '—'
  : typeof value === 'object' ? JSON.stringify(value) : String(value);

function drawPage(title: string, scope: string, range: string) {
  const canvas = document.createElement('canvas');
  canvas.width = pageWidth; canvas.height = pageHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare a PDF report.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, pageWidth, pageHeight);
  context.fillStyle = '#214d46'; context.fillRect(0, 0, pageWidth, 13);
  context.fillStyle = '#1f2a25'; context.font = '700 40px Inter, Arial, sans-serif'; context.fillText(title, 58, 77);
  context.fillStyle = '#69766f'; context.font = '20px Inter, Arial, sans-serif';
  context.fillText(`${scope}  ·  ${range}`, 60, 114);
  context.fillStyle = '#b8c6bd'; context.fillRect(58, 137, pageWidth - 116, 2);
  return { canvas, context };
}

function textCell(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, align: CanvasTextAlign = 'left') {
  context.save(); context.beginPath(); context.rect(x + 8, y, Math.max(0, width - 16), 34); context.clip();
  context.textAlign = align; context.fillText(text, align === 'right' ? x + width - 12 : x + 12, y + 24); context.restore();
}

function drawTable(context: CanvasRenderingContext2D, columns: string[], rows: ReportRow[], startY: number, chance = false) {
  const left = 58, width = pageWidth - 116, rowHeight = 36, columnWidth = width / columns.length;
  context.fillStyle = '#214d46'; context.fillRect(left, startY, width, 40);
  context.font = '600 14px Inter, Arial, sans-serif'; context.fillStyle = '#ffffff';
  columns.forEach((column, index) => textCell(context, titleCase(column), left + index * columnWidth, startY + 3, columnWidth));
  let y = startY + 40;
  rows.forEach((row, rowIndex) => {
    context.fillStyle = rowIndex % 2 ? '#f5f7f4' : '#ffffff'; context.fillRect(left, y, width, rowHeight);
    context.strokeStyle = '#e1e7e2'; context.beginPath(); context.moveTo(left, y + rowHeight); context.lineTo(left + width, y + rowHeight); context.stroke();
    columns.forEach((column, index) => {
      const value = row[column];
      const rendered = chance && column === 'payment_modes' && value && typeof value === 'object'
        ? Object.entries(value as Record<string, unknown>).map(([method, total]) => `${titleCase(method)} ${amount(total)}`).join(', ') || '—'
        : moneyFields.has(column) && value !== null && value !== undefined && value !== '' ? amount(value) : safe(value);
      context.fillStyle = '#26332d'; context.font = '13px Inter, Arial, sans-serif';
      textCell(context, rendered, left + index * columnWidth, y + 1, columnWidth, moneyFields.has(column) ? 'right' : 'left');
    });
    y += rowHeight;
  });
  return y;
}

function drawChanceSummary(scope: string, range: string, outletSummary: ReportRow[], paymentSummary: ReportRow[], totals: ChanceTotals) {
  const page = drawPage('Chance Sheet · Summary', scope, range);
  const { context, canvas } = page;
  const totalColumns = [
    ['Bills', totals.bill_count ?? outletSummary.reduce((sum, row) => sum + Number(row.bill_count ?? 0), 0)],
    ['Sale', totals.sale], ['Tax', totals.tax], ['CGST', totals.cgst], ['SGST', totals.sgst],
    ['Total', totals.total], ['Round', totals.rounding], ['Grand', totals.grand],
  ].filter(([, value]) => value !== undefined);
  context.fillStyle = '#1f2a25'; context.font = '700 24px Inter, Arial, sans-serif'; context.fillText('Overall Total', 60, 183);
  const cellWidth = (pageWidth - 120) / 4, cellHeight = 74;
  totalColumns.forEach(([label, value], index) => {
    const col = index % 4, row = Math.floor(index / 4), x = 60 + col * cellWidth, y = 204 + row * cellHeight;
    context.fillStyle = '#f5f7f4'; context.fillRect(x, y, cellWidth - 8, cellHeight - 8);
    context.fillStyle = '#67766e'; context.font = '600 14px Inter, Arial, sans-serif'; context.fillText(String(label), x + 14, y + 24);
    context.fillStyle = '#214d46'; context.font = '700 20px Inter, Arial, sans-serif';
    context.fillText(label === 'Bills' ? String(value ?? 0) : amount(value), x + 14, y + 53);
  });
  const rowOffset = Math.ceil(totalColumns.length / 4) * cellHeight;
  const remarkY = 225 + rowOffset;
  context.fillStyle = '#1f2a25'; context.font = '700 24px Inter, Arial, sans-serif'; context.fillText('Remarks Summary', 60, remarkY);
  drawTable(context, ['method', 'total'], paymentSummary, remarkY + 20);
  context.fillStyle = '#69766f'; context.font = '14px Inter, Arial, sans-serif';
  context.fillText(`Generated ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`, 60, pageHeight - 35);
  const summaryPages = [canvas];
  const rowsPerSummaryPage = 24;
  for (let offset = 0; offset < outletSummary.length || offset === 0; offset += rowsPerSummaryPage) {
    const outletPage = drawPage('Outlet Wise Summary', scope, range);
    outletPage.context.fillStyle = '#69766f'; outletPage.context.font = '16px Inter, Arial, sans-serif';
    outletPage.context.fillText('Sales and bill totals grouped by outlet', 60, 167);
    drawTable(outletPage.context, ['name', 'bill_count', 'sale', 'tax', 'cgst', 'sgst', 'grand'], outletSummary.slice(offset, offset + rowsPerSummaryPage), 190);
    outletPage.context.fillStyle = '#69766f'; outletPage.context.font = '14px Inter, Arial, sans-serif';
    outletPage.context.fillText(`Outlets ${outletSummary.length ? offset + 1 : 0}-${Math.min(outletSummary.length, offset + rowsPerSummaryPage)} of ${outletSummary.length}`, 60, pageHeight - 35);
    summaryPages.push(outletPage.canvas);
    if (!outletSummary.length) break;
  }
  return summaryPages;
}

async function canvasJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not render a PDF page.')), 'image/jpeg', 0.88));
  return new Uint8Array(await blob.arrayBuffer());
}

const encoder = new TextEncoder();
function concatenate(chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let cursor = 0; for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}
function pdfBlob(images: Uint8Array[]) {
  const bodies: Uint8Array[] = [];
  const add = (body: Uint8Array) => { bodies.push(body); return bodies.length; };
  const catalog = add(encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'));
  const pagesId = add(new Uint8Array());
  const pageIds: number[] = [];
  images.forEach(image => {
    const pageId = bodies.length + 1, contentId = pageId + 1, imageId = pageId + 2;
    pageIds.push(pageId);
    add(encoder.encode(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    const stream = encoder.encode('q 842 0 0 595 0 0 cm /Im0 Do Q');
    add(concatenate([encoder.encode(`<< /Length ${stream.length} >>\nstream\n`), stream, encoder.encode('\nendstream')]));
    add(concatenate([encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${pageWidth} /Height ${pageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, encoder.encode('\nendstream')]));
  });
  bodies[pagesId - 1] = encoder.encode(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const chunks: Uint8Array[] = [encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = [0]; let offset = chunks[0].length;
  bodies.forEach((body, index) => {
    offsets.push(offset);
    const object = concatenate([encoder.encode(`${index + 1} 0 obj\n`), body, encoder.encode('\nendobj\n')]);
    chunks.push(object); offset += object.length;
  });
  const xrefOffset = offset;
  const xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${bodies.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(encoder.encode(xref));
  return new Blob(chunks, { type: 'application/pdf' });
}

export async function downloadReportPdf(input: {
  title: string; scope: string; range: string; rows: ReportRow[]; columns: string[]; totals: ChanceTotals;
  chanceSheet?: boolean; outletSummary?: ReportRow[]; paymentSummary?: ReportRow[];
}) {
  const pages: HTMLCanvasElement[] = [];
  const pageRows = 24;
  for (let offset = 0; offset < input.rows.length; offset += pageRows) {
    const page = drawPage(input.title, input.scope, input.range);
    const chunk = input.rows.slice(offset, offset + pageRows);
    drawTable(page.context, input.columns, chunk, 160, input.chanceSheet);
    page.context.fillStyle = '#69766f'; page.context.font = '14px Inter, Arial, sans-serif';
    page.context.fillText(`Rows ${offset + 1}-${Math.min(input.rows.length, offset + chunk.length)} of ${input.rows.length}`, 60, pageHeight - 35);
    pages.push(page.canvas);
  }
  if (!pages.length) {
    const page = drawPage(input.title, input.scope, input.range);
    page.context.fillStyle = '#69766f'; page.context.font = '20px Inter, Arial, sans-serif'; page.context.fillText('No records for the selected dates.', 60, 190);
    pages.push(page.canvas);
  }
  if (input.chanceSheet) pages.push(...drawChanceSummary(input.scope, input.range, input.outletSummary ?? [], input.paymentSummary ?? [], input.totals));
  const pdf = pdfBlob(await Promise.all(pages.map(canvasJpeg)));
  const url = URL.createObjectURL(pdf);
  const link = document.createElement('a'); link.href = url; link.download = `${input.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${input.range.replaceAll(/[^0-9-]/g, '')}.pdf`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
