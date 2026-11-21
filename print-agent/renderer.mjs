function clean(value) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[^\x20-\x7e]/g, '?');
}
function wrap(value, width) {
  const text = clean(value);
  const lines = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join('\n');
}
export function renderLines(job) {
  const p = job.payload;
  const width = Number(job.paper_width) === 58 ? 32 : 48;
  const line = '-'.repeat(width);
  const pair = (label, value) => clean(label).slice(0, width - 14).padEnd(width - 14) + Number(value || 0).toFixed(2).padStart(14);
  const rows = [clean(p.title || job.document_type), clean(p.outlet), clean(p.address), clean(p.taxNumber), line,
    `Ref: ${clean(p.reference)}`, `Order: ${clean(p.order)}  Table: ${clean(p.table || '-')}`, clean(p.createdAt), line];
  if (p.originalReference) rows.push(`Original: ${clean(p.originalReference)}`);
  if (p.reason || p.reprintReason) rows.push(wrap(`Reason: ${p.reason || p.reprintReason}`, width));
  for (const item of p.lines || []) {
    rows.push(wrap(`${item.quantity} x ${item.name}`, width));
    if (item.variant) rows.push(wrap(`  ${item.variant}`, width));
    if (item.modifiers?.length) rows.push(wrap(`  + ${item.modifiers.map(m => typeof m === 'string' ? m : m.name).join(', ')}`, width));
    if (item.notes) rows.push(wrap(`  NOTE: ${item.notes}`, width));
    if (item.unitPrice !== undefined && job.document_type.startsWith('BILL')) rows.push(pair('  Line amount', Number(item.unitPrice) * Number(item.quantity)));
  }
  if (p.notes) rows.push(wrap(`ORDER NOTE: ${p.notes}`, width));
  if (p.total !== undefined) rows.push(line, pair('Subtotal', p.subtotal), pair('Discount', p.discount), pair('Tax', p.tax), pair('TOTAL', p.total));
  if (p.footer) rows.push(line, wrap(p.footer, width));
  const layout = job.template === 'COMPACT' ? rows.filter(r => r && r !== line) : rows;
  return layout.flatMap(row => row.split('\n'));
}

export function render(job) {
  const layout = [...renderLines(job), '', '', ''];
  return Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from(layout.filter(r => r !== undefined).join('\n'), 'ascii'), Buffer.from([0x1d, 0x56, 0x41, 0x03])]);
}
