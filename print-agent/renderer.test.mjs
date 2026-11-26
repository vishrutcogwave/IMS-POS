import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from './renderer.mjs';
const job = {
  document_type: 'KOT', paper_width: 80, template: 'STANDARD',
  payload: { title: 'KOT', reference: 'K-00001', outlet: 'Garden', order: 'O-00001', table: 'T2', createdAt: '2026-11-18T12:00:00Z',
    lines: [{ name: 'Thali', quantity: 2, variant: 'Large', modifiers: [{ name: 'Extra rice' }], notes: 'Less spicy' }] },
};
test('KOT includes immutable reference, table, quantities, options and notes', () => {
  const text = render(job).toString('ascii');
  for (const value of ['K-00001','Garden','O-00001','T2','2 x Thali','Large','Extra rice','Less spicy']) assert.ok(text.includes(value));
});
test('untrusted fields cannot inject ESC/POS control commands', () => {
  const bytes = render({ ...job, payload: { ...job.payload, lines: [{ name: 'Food\x1b@\x1dV', quantity: 1, notes: '\x00\x07' }] } });
  assert.equal([...bytes].filter(x => x === 0x1b).length, 1);
  assert.equal([...bytes].filter(x => x === 0x1d).length, 1);
  assert.equal([...bytes].filter(x => x === 0x00).length, 0);
});
test('compact template and 58mm layout are distinct', () => {
  const standard = render(job);
  const compact = render({ ...job, template: 'COMPACT' });
  assert.ok(compact.length < standard.length);
  const narrow = render({ ...job, paper_width: 58 }).toString('ascii');
  assert.ok(narrow.includes('-'.repeat(32)));
  assert.ok(!narrow.includes('-'.repeat(48)));
});
test('bill renders cent-accurate totals and cancellation references', () => {
  const text = render({ ...job, document_type: 'BILL_CANCEL', payload: { ...job.payload, title: 'CANCELLED BILL', subtotal: 280, discount: 10, tax: 13.5, total: 283.5, originalReference: 'B-00001', reason: 'Guest cancellation' } }).toString('ascii');
  assert.match(text, /283\.50/); assert.match(text, /13\.50/); assert.match(text, /Original: B-00001/); assert.match(text, /Guest cancellation/);
});
test('pre-settlement bill is marked due and does not show payment details', () => {
  const text = render({ ...job, document_type: 'BILL_PREVIEW', paper_width: 80, payload: { ...job.payload, title: 'BILL PREVIEW', reference: 'B-00002', subtotal: 220, discount: 0, tax: 11, total: 231, payments: [] } }).toString('ascii');
  assert.match(text, /BILL - PAYMENT DUE/);
  assert.match(text, /Unpaid Bill/);
  assert.match(text, /231\.00/);
  assert.doesNotMatch(text, /Paid|Cash tendered|Change/);
});
test('kitchen instructions never appear on bill previews or receipts', () => {
  const text = render({ ...job, document_type: 'BILL_PREVIEW', payload: { ...job.payload, subtotal: 280, discount: 0, tax: 14, total: 294, payments: [] } }).toString('ascii');
  assert.doesNotMatch(text, /Less spicy|NOTE: Less spicy/);
});
