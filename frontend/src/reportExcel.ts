import type ExcelJS from 'exceljs';

type ReportRow = Record<string, unknown>;
const titleCase = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const plain = (value: unknown) => value && typeof value === 'object' ? JSON.stringify(value) : value ?? '';
const money = (value: unknown) => Number(value ?? 0);
function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF214D46' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
}
function setWidths(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach(column => { column.width = Math.min(34, Math.max(13, String(column.header ?? '').length + 3)); });
}
function addTop(sheet: ExcelJS.Worksheet, title: string, scope: string, from: string, to: string, endCol: number) {
  sheet.addRow([title]); sheet.mergeCells(1, 1, 1, Math.max(1, endCol));
  sheet.getRow(1).font = { size: 18, bold: true, color: { argb: 'FF214D46' } };
  sheet.addRow([`${scope}  |  ${from} to ${to}`]); sheet.mergeCells(2, 1, 2, Math.max(1, endCol));
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF69766F' } };
  sheet.addRow([]);
}
function save(workbook: ExcelJS.Workbook, filename: string) {
  return workbook.xlsx.writeBuffer().then(buffer => {
    const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

export async function downloadReportExcel(input: {
  title: string; scope: string; from: string; to: string; rows: ReportRow[]; columns: string[];
  totals: Record<string, unknown>; chanceSheet?: boolean; outletSummary?: ReportRow[]; paymentSummary?: ReportRow[];
}) {
  const { default: ExcelJSRuntime } = await import('exceljs');
  const workbook = new ExcelJSRuntime.Workbook(); workbook.creator = 'POS powered by Hiremath Web Studio';
  workbook.created = new Date(); workbook.modified = new Date();
  const sheet = workbook.addWorksheet(input.chanceSheet ? 'Chance Sheet' : 'Report', { views: [{ state: 'frozen', ySplit: 4 }] });
  if (input.chanceSheet) {
    const methods = [...new Set((input.paymentSummary ?? []).map(row => String(row.method ?? '')).filter(method => method && method !== 'Bill Pending'))];
    const columns = ['outlet','bill_number','date','time','sale','tax','cgst','sgst','total','rounding','grand',...methods,'status'];
    addTop(sheet, input.title, input.scope, input.from, input.to, columns.length);
    const header = sheet.addRow(columns.map(titleCase)); styleHeader(header);
    let currentOutlet = '';
    for (const row of input.rows) {
      const outlet = String(row.outlet ?? '');
      if (currentOutlet && outlet !== currentOutlet) {
        const end = sheet.addRow([]); end.height = 8;
      }
      currentOutlet = outlet;
      const modes = row.payment_modes && typeof row.payment_modes === 'object' ? row.payment_modes as Record<string, unknown> : {};
      sheet.addRow([outlet,row.bill_number,row.date,row.time,...['sale','tax','cgst','sgst','total','rounding','grand'].map(key => money(row[key])),...methods.map(method => money(modes[method])),row.status]);
    }
    const grand = sheet.addRow(['OVERALL TOTAL','', '', '', ...['sale','tax','cgst','sgst','total','rounding','grand'].map(key => money(input.totals[key])), ...methods.map(() => ''), '']);
    grand.font = { bold: true }; grand.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2ED' } };
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
    for (let row = 5; row <= sheet.rowCount; row++) {
      for (let col = 5; col <= columns.length - 1; col++) sheet.getRow(row).getCell(col).numFmt = '#,##0.00;[Red]-#,##0.00';
    }
    const summary = workbook.addWorksheet('Outlet Summary', { views: [{ state: 'frozen', ySplit: 4 }] });
    const sumColumns = ['name','bill_count','sale','tax','cgst','sgst','total','rounding','grand'];
    addTop(summary, 'Chance Sheet Summary', input.scope, input.from, input.to, sumColumns.length);
    styleHeader(summary.addRow(sumColumns.map(titleCase)));
    for (const row of input.outletSummary ?? []) summary.addRow(sumColumns.map(key => key === 'name' ? plain(row[key]) : Number(row[key] ?? 0)));
    const totalRow = summary.addRow(['OVERALL TOTAL',Number(input.totals.bill_count ?? input.rows.length),...['sale','tax','cgst','sgst','total','rounding','grand'].map(key => money(input.totals[key]))]);
    totalRow.font = { bold: true }; totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2ED' } };
    const payment = workbook.addWorksheet('Remarks Summary');
    addTop(payment, 'Remarks Summary', input.scope, input.from, input.to, 2);
    styleHeader(payment.addRow(['Particular','Amount']));
    for (const row of input.paymentSummary ?? []) payment.addRow([titleCase(String(row.method ?? '')),money(row.total)]);
    payment.getColumn(2).eachCell(cell => { if (typeof cell.value === 'number') cell.numFmt = '#,##0.00;[Red]-#,##0.00'; });
    setWidths(sheet); setWidths(summary); setWidths(payment);
    for (const target of [sheet,summary]) target.eachRow((row,rowNumber) => {
      if (rowNumber <= 4) return;
      row.eachCell(cell => {
        const header = String(target.getRow(4).getCell(cell.col).value ?? '');
        if (typeof cell.value === 'number' && header !== 'Bill Count') cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      });
    });
  } else {
    const columns = input.columns.length ? input.columns : ['message'];
    addTop(sheet, input.title, input.scope, input.from, input.to, columns.length);
    styleHeader(sheet.addRow(columns.map(titleCase)));
    for (const row of input.rows) sheet.addRow(columns.map(key => plain(row[key])));
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
    const summary = workbook.addWorksheet('Summary');
    addTop(summary, 'Report Totals', input.scope, input.from, input.to, 2);
    styleHeader(summary.addRow(['Particular','Amount']));
    for (const [key,value] of Object.entries(input.totals)) summary.addRow([titleCase(key),plain(value)]);
    setWidths(sheet); setWidths(summary);
  }
  const filename = `${input.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${input.from}-${input.to}.xlsx`;
  await save(workbook, filename);
}
