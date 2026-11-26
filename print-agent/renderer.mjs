function clean(value) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[^\x20-\x7e]/g, '?');
}
function wrap(value, width) {
  const text = clean(value);
  if (!text) return [''];
  const lines = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines;
}
function fixed(value) { return Number(value || 0).toFixed(2); }
function indiaDate(value, timezone = 'Asia/Kolkata') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat('en-IN', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(date).replace(/\b(am|pm)\b/i, match => match.toUpperCase());
}
function rupeeWords(value) {
  const small = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const words = (n) => {
    if (n < 20) return small[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + small[n % 10] : '');
    if (n < 1000) return small[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + words(n % 100) : '');
    for (const [size, label] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand']])
      if (n >= size) return words(Math.floor(n / size)) + ' ' + label + (n % size ? ' ' + words(n % size) : '');
    return String(n);
  };
  let amount = Math.round(Math.abs(Number(value || 0)) * 100) / 100;
  let rupees = Math.floor(amount); let paise = Math.round((amount - rupees) * 100);
  if (paise === 100) { rupees++; paise = 0; }
  return 'Rupees ' + words(rupees) + (paise ? ' and ' + words(paise) + ' Paise' : '') + ' Only';
}
function paymentLabel(payments) {
  const methods = [...new Set((payments || []).map(p => clean(p.method)).filter(Boolean))];
  return methods.length > 1 ? 'Split payment' : (methods[0] || '');
}
function renderBill(job, width) {
  const p = job.payload || {};
  const rule = '-'.repeat(width);
  const rows = [];
  const pushWrap = (value) => rows.push(...wrap(value, width));
  const pushCenter = (value) => {
    const text = clean(value);
    if (text.length > width) return pushWrap(text);
    rows.push(' '.repeat(Math.floor((width - text.length) / 2)) + text);
  };
  const pair = (label, value) => {
    label = clean(label); value = clean(value);
    const filler = Math.max(1, width - label.length - value.length);
    if (label.length + filler + value.length <= width) rows.push(label + '.'.repeat(filler) + value);
    else { pushWrap(label); rows.push(...wrap(value, width).map(part => part.padStart(width))); }
  };
  const currency = clean(p.currency).toUpperCase() === 'INR' || !p.currency ? 'Rs' : clean(p.currency);
  const title = clean(p.title || job.document_type).toUpperCase();
  const docType = String(job.document_type || '').toUpperCase();
  const preview = docType === 'BILL_PREVIEW';
  const canceled = title.includes('CANCEL') || docType.includes('CANCEL');
  const isNc = title.includes('NC');
  const payments = Array.isArray(p.payments) ? p.payments : [];
  const mode = paymentLabel(payments);
  pushCenter(clean(p.businessName || p.title).toUpperCase());
  if (p.outlet) pushCenter(p.outlet);
  if (p.address) pushCenter(p.address);
  if (p.phone) pushCenter('Ph: ' + p.phone);
  if (p.taxNumber) pushCenter('GSTIN: ' + p.taxNumber);
  rows.push(rule); pushCenter(canceled ? 'CANCELLED TAX INVOICE' : preview ? (isNc ? 'NC BILL - PAYMENT DUE' : 'BILL - PAYMENT DUE') : isNc ? 'NC TAX INVOICE' : 'TAX INVOICE'); rows.push(rule);
  if (p.reference) pushWrap('Bill No: ' + p.reference);
  if (p.createdAt) pushWrap('Date: ' + indiaDate(p.createdAt, p.timezone));
  pushWrap('Type: ' + (isNc ? 'NC Bill' : preview ? 'Unpaid Bill' : (mode ? mode + ' Bill' : 'Unpaid Bill')));
  pushWrap('Location: ' + clean(p.table || p.serviceMode || p.outlet || '-'));
  if (p.order) pushWrap('Order No: ' + p.order);
  if (p.waiterName) pushWrap('Steward: ' + p.waiterName);
  if (p.covers) pushWrap('Pax: ' + p.covers);
  if (p.customerName) pushWrap('Customer: ' + p.customerName);
  if (p.originalReference) pushWrap('Original: ' + p.originalReference);
  if (p.reason || p.reprintReason) pushWrap('Reason: ' + (p.reason || p.reprintReason));
  rows.push(rule);
  const items = Array.isArray(p.lines) ? p.lines : [];
  if (width >= 48) {
    const widths = [3,17,4,10,10];
    const cell = (value, size, align = 'left') => {
      const text = clean(value).slice(0, size);
      return align === 'right' ? text.padStart(size) : text.padEnd(size);
    };
    const tableRow = (values) => [cell(values[0],widths[0]),cell(values[1],widths[1]),cell(values[2],widths[2],'right'),cell(values[3],widths[3],'right'),cell(values[4],widths[4],'right')].join('|');
    rows.push(tableRow(['No','PARTICULARS','QTY','RATE','AMOUNT']), rule);
    items.forEach((item, index) => {
      const nameLines = wrap(item.name || item.item_name || 'Item', widths[1]);
      const rate = currency + ' ' + fixed(item.unitPrice ?? item.unit_price);
      const amount = currency + ' ' + fixed(item.total ?? item.subtotal ?? Number(item.unitPrice ?? item.unit_price) * Number(item.quantity || 0));
      rows.push(tableRow([String(index + 1),nameLines[0],String(item.quantity || 0),rate,amount]));
      for (const extra of nameLines.slice(1)) rows.push(tableRow(['',extra,'','','']));
      if (item.variant) pushWrap('   Variant: ' + item.variant);
      if (item.modifiers?.length) pushWrap('   + ' + item.modifiers.map(m => typeof m === 'string' ? m : m.name).join(', '));
    });
  } else {
    rows.push('No.  PARTICULARS', rule);
    items.forEach((item, index) => {
      pushWrap(String(index + 1) + '. ' + (item.name || item.item_name || 'Item'));
      pushWrap('   Qty: ' + String(item.quantity || 0) + '  Rate: ' + currency + ' ' + fixed(item.unitPrice ?? item.unit_price));
      pushWrap('   Amount: ' + currency + ' ' + fixed(item.total ?? item.subtotal ?? Number(item.unitPrice ?? item.unit_price) * Number(item.quantity || 0)));
      if (item.variant) pushWrap('   Variant: ' + item.variant);
      if (item.modifiers?.length) pushWrap('   + ' + item.modifiers.map(m => typeof m === 'string' ? m : m.name).join(', '));
    });
  }
  const subtotal = Number(p.subtotal || 0);
  const discount = Number(p.discount || 0);
  rows.push(rule);
  pair('Items: ' + items.length + '  Qty: ' + items.reduce((sum, item) => sum + Number(item.quantity || 0), 0), 'Gross: ' + currency + ' ' + fixed(subtotal));
  pair('Gross Amount', currency + ' ' + fixed(subtotal));
  if (discount) pair('Discount', '- ' + currency + ' ' + fixed(discount));
  pair('Taxable Amount', currency + ' ' + fixed(subtotal - discount));
  pair('Tax', currency + ' ' + fixed(p.tax));
  rows.push(rule);
  pair('NET AMOUNT', currency + ' ' + fixed(p.total));
  if (payments.length) {
    pair('Paid', currency + ' ' + fixed(p.total));
    for (const payment of payments) pair(clean(payment.method), currency + ' ' + fixed(payment.amount));
  }
  if (Number(p.cashTendered || 0) > 0) pair('Cash tendered', currency + ' ' + fixed(p.cashTendered));
  if (Number(p.change || 0) > 0) pair('Change', currency + ' ' + fixed(p.change));
  rows.push(rule, 'Amount in words');
  pushWrap(rupeeWords(p.total));
  if (p.notes) pushWrap('Notes: ' + p.notes);
  if (p.footer) pushWrap(p.footer);
  pushWrap('Thank you for dining with us.');
  rows.push(rule); pushCenter('Authorised Signatory'); rows.push('');
  return rows.flatMap(row => wrap(row, width));
}
function renderKot(job, width) {
  const p = job.payload;
  const line = '-'.repeat(width);
  const rows = [clean(p.title || job.document_type), clean(p.outlet), clean(p.address), clean(p.taxNumber), line,
    'Ref: ' + clean(p.reference), 'Order: ' + clean(p.order) + '  Table: ' + clean(p.table || '-'), p.createdAt ? 'Date: ' + indiaDate(p.createdAt, p.timezone) : '', line];
  if (p.waiterName) rows.push('Waiter: ' + p.waiterName);
  if (p.covers) rows.push('Pax: ' + p.covers);
  if (p.originalReference) rows.push('Original: ' + p.originalReference);
  if (p.reason || p.reprintReason) rows.push('Reason: ' + (p.reason || p.reprintReason));
  for (const item of p.lines || []) {
    rows.push(String(item.quantity) + ' x ' + item.name);
    if (item.variant) rows.push('  ' + item.variant);
    if (item.modifiers?.length) rows.push('  + ' + item.modifiers.map(m => typeof m === 'string' ? m : m.name).join(', '));
    if (item.notes) rows.push('  NOTE: ' + item.notes);
  }
  if (p.notes) rows.push('ORDER NOTE: ' + p.notes);
  rows.push(line, 'PLEASE PREPARE');
  return rows.flatMap(row => wrap(row, width));
}
export function renderLines(job) {
  const width = Number(job.paper_width) === 58 ? 32 : 48;
  const type = String(job.document_type || '').toUpperCase();
  const rows = type.startsWith('BILL') ? renderBill(job, width) : renderKot(job, width);
  return job.template === 'COMPACT' ? rows.filter(row => row && !row.startsWith('-')) : rows;
}
export function render(job) {
  const layout = [...renderLines(job), '', '', ''];
  return Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from(layout.filter(r => r !== undefined).join('\n'), 'ascii'), Buffer.from([0x1d, 0x56, 0x41, 0x03])]);
}
