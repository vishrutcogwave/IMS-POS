import type { Category, MenuGroup, MenuImportRow, MenuItem, MenuTax, MenuUnit, PriceOption } from './types';

const columns = [
  'Item', 'Category', 'Department', 'Description', 'Price', 'Unit', 'Tax',
  'Tax Rate', 'Available', 'Vegetarian', 'Variants JSON', 'Modifiers JSON', 'Group',
];

export async function exportMenuWorkbook(
  items: MenuItem[], categories: Category[], units: MenuUnit[], taxes: MenuTax[], groups: MenuGroup[], filename: string,
) {
  const { Workbook } = await import('exceljs');
  const book = new Workbook();
  const sheet = book.addWorksheet('Items');
  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, index) => { column.width = index === 3 ? 36 : 20; });
  for (const item of items) {
    const category = categories.find(row => row.id === item.category_id);
    sheet.addRow([
      item.name, category?.name ?? '', category?.department ?? '', item.description, Number(item.price),
      units.find(row => row.id === item.unit_id)?.name ?? '', taxes.find(row => row.id === item.tax_id)?.name ?? '',
      Number(item.tax_rate), item.available ? 'Yes' : 'No', item.vegetarian ? 'Yes' : 'No',
      JSON.stringify(item.variants ?? []), JSON.stringify(item.modifiers ?? []),
      groups.find(row => row.id === category?.group_id)?.name ?? '',
    ]);
  }
  const file = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([file], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename + '.xlsx';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function priceOptions(text: string, row: number, column: string): PriceOption[] {
  if (!text) return [];
  try {
    const values: unknown = JSON.parse(text);
    if (!Array.isArray(values) || values.length > 30) throw new Error();
    return values.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || !('name' in entry) || !('price' in entry) ||
          typeof entry.name !== 'string' || (typeof entry.price !== 'number' && typeof entry.price !== 'string')) throw new Error();
      return { name: entry.name, price: entry.price };
    });
  } catch { throw new Error('Row ' + row + ', ' + column + ': enter a JSON array of names and prices, or leave it blank.'); }
}

export async function readMenuWorkbook(file: File): Promise<MenuImportRow[]> {
  if (!/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024) throw new Error('Choose an .xlsx workbook no larger than 2 MB.');
  const { Workbook } = await import('exceljs');
  const book = new Workbook();
  try { await book.xlsx.load(await file.arrayBuffer()); }
  catch { throw new Error('This workbook could not be read. Save it as an .xlsx file and try again.'); }
  const sheet = book.getWorksheet('Items') ?? book.worksheets[0];
  if (!sheet || sheet.columnCount > columns.length || columns.some((column, i) => i < columns.length - 1 ? sheet.getCell(1, i + 1).text.trim() !== column : !["", column].includes(sheet.getCell(1, i + 1).text.trim()))) {
    throw new Error('The item columns do not match the template. Download a fresh template and keep the headings in order.');
  }
  if (sheet.rowCount > 201) throw new Error('Use up to 200 item rows per workbook.');
  const rows: MenuImportRow[] = [];
  for (let row = 2; row <= sheet.rowCount; row++) {
    const values = columns.map((column, i) => {
      const value = sheet.getCell(row, i + 1).value;
      if (value == null) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
      throw new Error('Row ' + row + ', ' + column + ': enter a plain value instead of a formula, link or date.');
    });
    if (values.every(value => value === '')) continue;
    const [name, category, department, description, price, unit, tax, rate, available, vegetarian, variants, modifiers, group] = values;
    const amount = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) ? Number(value) : null;
    const flag = (value: string, fallback: boolean) =>
      value === '' ? fallback : /^yes$|^true$/i.test(value) ? true : /^no$|^false$/i.test(value) ? false : null;
    rows.push({ row, name, category, group, department: department || 'Kitchen', description, price: amount(price), unit, tax,
      taxRate: amount(rate || '0'), available: flag(available, true), vegetarian: flag(vegetarian, true),
      variants: priceOptions(variants, row, 'Variants JSON'), modifiers: priceOptions(modifiers, row, 'Modifiers JSON'),
    });
  }
  if (!rows.length) throw new Error('The workbook has no item rows.');
  return rows;
}
