import { useEffect, useState } from 'react';
import { ArrowRight, Banknote, Check, CreditCard, FilePenLine, Plus, Printer, ReceiptText, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from './api';
import { brandTitle } from './Brand';
import type { Bill, Payment } from './types';
import { activeLine, Badge, Button, cents, CheckField, dateTime, Empty, Field, itemName, label, LoadError, Loading, Modal, number, PageHeader, ReasonDialog, Refresh, useAction, useLoad, useMoney, useWorkspace } from './ui';

export function BillsPage({ initialBillId }: { initialBillId?: string }) {
  const { outletId } = useWorkspace(); const format = useMoney(); const state = useLoad(() => api.bills(outletId), [outletId]);
  const [selected, setSelected] = useState(initialBillId || ''); const [filter, setFilter] = useState('all'); const [search, setSearch] = useState('');
  useEffect(() => { if (initialBillId) setSelected(initialBillId); }, [initialBillId]);
  const bills = state.data || []; const visible = bills.filter(b => (filter === 'all' || (filter === 'unpaid' ? !['PAID', 'CANCELLED'].includes(b.status) : b.status === filter)) && `${b.bill_number} ${b.order_number || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page"><PageHeader eyebrow="A PERFECT FINISH" title="Bring it to the bill." description="Review, split and settle. Every receipt keeps a clear trail." actions={<Refresh onClick={state.reload} busy={state.loading} />} /><div className="bills-summary"><div><span className="stat-icon orange"><ReceiptText size={20} /></span><span>Awaiting settlement<strong>{bills.filter(b => !['PAID', 'CANCELLED'].includes(b.status)).length} bills</strong></span></div><div><span className="stat-icon green"><Banknote size={20} /></span><span>Outstanding total<strong>{format(bills.filter(b => !['PAID', 'CANCELLED'].includes(b.status)).reduce((s, b) => s + number(b.total), 0))}</strong></span></div><p>Includes bills returned by the current outlet.<br />For date-based settled sales, use Reports.</p></div><section className="card bills-card"><div className="toolbar"><div className="tabs">{[['all', 'All bills'], ['unpaid', 'Awaiting payment'], ['PAID', 'Paid'], ['CANCELLED', 'Cancelled']].map(([value, title]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{title}</button>)}</div><div className="search-box"><Search size={17} /><input aria-label="Search bills" value={search} onChange={e => setSearch(e.target.value)} placeholder="Bill or order number…" /></div></div>{state.error ? <LoadError error={state.error} retry={state.reload} /> : state.loading ? <Loading /> : visible.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Bill</th><th>Order</th><th>Created</th><th>Status</th><th className="align-right">Amount</th><th /></tr></thead><tbody>{visible.map(bill => <tr key={bill.id}><td><button className="text-button strong" onClick={() => setSelected(bill.id)}>#{bill.bill_number}</button></td><td>#{bill.order_number || bill.order_id.slice(0, 8)}</td><td>{dateTime(bill.created_at)}</td><td><Badge status={bill.status}>{bill.non_chargeable && bill.status === 'PAID' ? 'Completed' : undefined}</Badge></td><td className="align-right strong">{format(bill.total)}</td><td><button className="text-button" onClick={() => setSelected(bill.id)}>View bill <ArrowRight size={16} /></button></td></tr>)}</tbody></table></div> : <Empty title="No bills on the table" text="Send all order items to the kitchen, then create a bill from Point of sale. Receipts appear here automatically." />}</section>{selected && <BillDialog id={selected} onClose={() => { setSelected(''); state.reload(); }} onChanged={state.reload} />}</div>;
}
function BillDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can, navigate, outletId } = useWorkspace(); const state = useLoad(() => api.bill(id), [id]); const [mode, setMode] = useState<'view' | 'settle' | 'cancel' | 'modify' | 'discount' | 'edit-items' | 'correct-payment' | 'reverse' | 'reverse-edit' | 'reprint'>('view'); const [notice, setNotice] = useState('');
  const bill = state.data; const closeAction = () => { setMode('view'); state.reload(); onChanged(); };
  const update = (value: Bill) => { state.setData(value); onChanged(); };
  const orderId = bill?.order_id;
  const routing = useLoad(() => orderId ? api.printPcStatus(outletId, orderId) : Promise.resolve(undefined), [outletId, orderId]);
  const paired = routing.data?.paired;
  const billPrintJobs = routing.data?.jobs?.filter(job => job.reference_id === id) ?? [];
  const { reload: reloadPrinting, loading: loadingPrinting } = routing;
  useEffect(() => {
    if (!orderId || loadingPrinting) return;
    const timer = window.setTimeout(reloadPrinting, 3000);
    return () => window.clearTimeout(timer);
  }, [orderId, loadingPrinting, reloadPrinting]);
  if (bill && mode === 'settle') return <SettlementDialog bill={bill} onClose={closeAction} onSaved={value => { update(value); setMode('view'); setNotice(bill.non_chargeable ? 'NC bill completed. A zero-amount receipt was queued.' : 'Payment recorded. A receipt print job was queued; physical printing is not confirmed.'); }} onConflict={closeAction} />;
  if (bill && mode === 'correct-payment') return <SettlementDialog bill={bill} correction onClose={closeAction}
    onSaved={value => { update(value); setMode('view'); setNotice('Payment correction saved. A corrected receipt was queued.'); }} onConflict={closeAction} />;
  if (bill && (mode === 'reverse' || mode === 'reverse-edit')) return <PaidReversalDialog bill={bill} reopen={mode === 'reverse-edit'}
    onClose={closeAction} onSaved={value => {
      update(value);
      if (mode === 'reverse-edit') { onClose(); navigate({ page: 'pos', orderId: value.order_id }); }
      else setNotice(bill.non_chargeable ? 'NC bill voided.' : 'Refund recorded and bill cancelled.');
    }} />;
  if (bill && mode === 'cancel') return <ReasonDialog title="Cancel bill?" text="This reopens the order and cancels its unpaid bills together. Enter a reason for the bill history." danger onClose={closeAction} onConfirm={async reason => update(await api.cancelBill(bill.id, bill.version, reason))} />;
  if (bill && mode === 'modify') return <Modal title="Modify bill" subtitle={`Bill #${bill.bill_number}`} onClose={closeAction}>
    <div className="bill-dialog-actions">
      {can('ORDER') && can('CANCEL') && <Button className="secondary" onClick={() => setMode(bill.status === 'PAID' ? 'reverse-edit' : 'edit-items')}>Add or remove items</Button>}
      {!bill.non_chargeable && <Button className="secondary" onClick={() => setMode(bill.status === 'PAID' ? 'correct-payment' : 'settle')}>{bill.status === 'PAID' ? 'Correct payment mode' : 'Choose payment mode'}</Button>}
      {bill.status !== 'PAID' && can('DISCOUNT') && can('CANCEL') && <Button className="secondary" onClick={() => setMode('discount')}>Change discount</Button>}
    </div>
  </Modal>;
  if (bill && mode === 'discount') return <ModifyBillDialog bill={bill} onClose={closeAction} onSaved={update} />;
  if (bill && mode === 'edit-items') return <ReasonDialog title="Reopen bill for item changes"
    text="The current unpaid bill is cancelled and retained in Bill History. Add or remove items on the order, send any new KOTs, then create the replacement bill."
    onClose={closeAction} onConfirm={async reason => {
      const cancelled = await api.cancelBill(bill.id, bill.version, reason);
      onClose();
      navigate({ page: 'pos', orderId: cancelled.order_id });
    }} />;
  if (bill && mode === 'reprint') return <ReasonDialog title="Queue a receipt reprint" text="The original immutable receipt and bill reference will be used. This queues a new copy and does not confirm physical printing." onClose={closeAction} onConfirm={async reason => { await api.reprintBill(bill.id, reason); setNotice('Receipt reprint queued. Check the local print agent for output.'); }} />;
  return <Modal title={bill ? `Bill #${bill.bill_number}` : 'Opening bill'} subtitle="A clear account of a great service." onClose={onClose} wide>{state.error ? <LoadError error={state.error} retry={state.reload} /> : state.loading ? <Loading /> : bill && <><div className="bill-dialog-toolbar"><Badge status={bill.status}>{bill.non_chargeable && bill.status === 'PAID' ? 'Completed' : undefined}</Badge><span className="muted small-text">{dateTime(bill.created_at)}</span>{paired ? bill.status === 'PAID' && can('PRINT') && <Button className="subtle" onClick={() => setMode('reprint')}><Printer size={16} />Print bill</Button> : <Button className="subtle" onClick={() => window.print()}><Printer size={16} />Browser print</Button>}</div>{notice && <div className="notice success"><Check size={18} /><span>{notice}</span></div>}<Receipt bill={bill} />{bill.reversal && <div className="notice info"><div><strong>{bill.non_chargeable ? 'NC bill voided' : 'Refund recorded'}</strong><p>{bill.reversal.reason}{bill.reversal.refund_reference && ' · Reference ' + bill.reversal.refund_reference} · {dateTime(bill.reversal.created_at)}</p></div></div>}<div className="bill-dialog-actions">{!['PAID', 'CANCELLED'].includes(bill.status) && <><Button onClick={() => setMode('settle')}><CreditCard size={18} />{bill.non_chargeable ? 'Complete NC bill' : 'Settle bill'}</Button><Button className="secondary" onClick={() => setMode('modify')}><FilePenLine size={16} />Modify bill</Button>{can('CANCEL') && <button className="text-button danger-text" onClick={() => setMode('cancel')}>Cancel bill</button>}</>}{bill.status === 'PAID' && can('CANCEL') && <><Button className="secondary" onClick={() => setMode('modify')}><FilePenLine size={16} />Modify bill</Button><button className="text-button danger-text" onClick={() => setMode('reverse')}>{bill.non_chargeable ? 'Void NC bill' : 'Cancel paid bill'}</button></>}{!paired && can('PRINT') && bill.status === 'PAID' && <Button className="secondary" onClick={() => setMode('reprint')}><Printer size={16} />Queue reprint</Button>}{can('ORDER') && <button className="text-button" onClick={() => { onClose(); navigate({ page: 'pos', orderId: bill.order_id }); }}>View order <ArrowRight size={15} /></button>}</div>{paired ? <div aria-label="Bill print status">
      {billPrintJobs.map(job => <p key={job.id} className={job.status === 'NEEDS_REVIEW' || job.status === 'FAILED' ? 'notice warning' : 'small-text muted'}>
        {job.status === 'NEEDS_REVIEW' ? 'Needs review. Check the physical printer before resending.' :
          job.status === 'SENT_TO_PRINTER' ? 'Sent to printer' :
          job.status === 'FAILED' ? 'Print failed. ' + (job.error ?? '') :
          routing.data?.online ? 'Queued for printing' : 'Queued. Branch print PC is offline.'}
      </p>)}
    </div> : <p className="small-text muted">Browser printing never marks a hardware job as printed.</p>}</>}</Modal>;
}
function Receipt({ bill }: { bill: Bill }) {
  const { session, outlet } = useWorkspace(); const format = useMoney(); const tenant = bill.tenant || session.tenant;
  return <article className="receipt printable-target"><header className="receipt-header"><div className="receipt-brand">{tenant.name}</div><p>{bill.outlet?.name || outlet?.name}</p>{(tenant.receipt_address || bill.receipt_address) && <p className="pre-line">{tenant.receipt_address || bill.receipt_address}</p>}{(tenant.tax_number || bill.tax_number) && <p>Tax ID: {tenant.tax_number || bill.tax_number}</p>}{tenant.phone && <p>{tenant.phone}</p>}<div className="receipt-title">{bill.status === 'CANCELLED' ? 'CANCELLED BILL' : bill.non_chargeable ? 'NC BILL' : bill.status === 'PAID' ? 'RECEIPT' : 'UNPAID BILL'}</div></header><div className="receipt-meta"><span>Bill #{bill.bill_number}</span><span>{dateTime(bill.created_at)}</span><span>Order #{bill.order?.order_number || bill.order_number || bill.order_id.slice(0, 8)}</span><span>{bill.order?.table_name || (bill.order?.service_mode ? label(bill.order.service_mode) : '')}</span></div><table className="receipt-table"><thead><tr><th>Item</th><th>Qty</th><th className="align-right">Amount</th></tr></thead><tbody>{(bill.items || []).filter(activeLine).map((line, i) => <tr key={line.id || i}><td>{itemName(line)}{line.variant && <small>{line.variant}</small>}{!!line.modifiers?.length && <small>{line.modifiers.map(m => typeof m === 'string' ? m : m.name).join(', ')}</small>}</td><td>{line.quantity}</td><td className="align-right">{format(line.total ?? line.line_total ?? number(line.unit_price) * line.quantity)}</td></tr>)}</tbody></table><div className="receipt-totals"><div><span>Subtotal</span><span>{format(bill.subtotal)}</span></div><div><span>Discount</span><span>− {format(bill.discount)}</span></div><div><span>Tax</span><span>{format(bill.tax)}</span></div><div className="receipt-grand"><strong>Total</strong><strong>{format(bill.total)}</strong></div>{bill.payments?.map((p, i) => <div key={i}><span>{label(p.method)}{p.reference && <small>Ref: {p.reference}</small>}</span><span>{format(p.amount)}</span></div>)}{bill.change !== undefined && <div><span>Cash change</span><span>{format(bill.change)}</span></div>}</div><footer>{tenant.receipt_footer || bill.receipt_footer || 'Thank you for dining with us.'}<small>{brandTitle}</small></footer></article>;
}
function SettlementDialog({ bill, onClose, onSaved, onConflict, correction = false }: {
  bill: Bill; onClose: () => void; onSaved: (bill: Bill) => void; onConflict: () => void; correction?: boolean;
}) {
  const { outlet } = useWorkspace(); const format = useMoney(); const methods = bill.outlet?.payment_methods || outlet?.payment_methods || [];
  const first = methods.includes('CASH') ? 'CASH' : methods[0] || '';
  const originalPayments = correction && !!bill.payments?.length ? bill.payments : undefined;
  const [rows, setRows] = useState<Payment[]>(originalPayments ?? [{ method: first, amount: number(bill.total), reference: '' }]);
  const initialCash = originalPayments?.filter(row => row.method === 'CASH').reduce((sum, row) => sum + number(row.amount), 0);
  const [tendered, setTendered] = useState(initialCash ? String(initialCash + number(bill.change ?? 0)) : first === 'CASH' ? String(bill.total) : '');
  const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false); const action = useAction(onConflict);
  const allocated = rows.reduce((sum, r) => sum + cents(r.amount), 0); const cash = rows.filter(r => r.method === 'CASH').reduce((sum, r) => sum + cents(r.amount), 0); const remaining = cents(bill.total) - allocated; const external = rows.some(r => ['CARD', 'UPI'].includes(r.method)); const tenderedCents = tendered === '' ? 0 : cents(tendered);
  const valid = rows.length > 0 && remaining === 0 && rows.every(r => methods.includes(r.method) && Number.isFinite(number(r.amount)) && (cents(bill.total) === 0 ? number(r.amount) >= 0 : number(r.amount) > 0) && (!['CARD', 'UPI'].includes(r.method) || !!r.reference?.trim())) && (!cash || tendered !== '' && tenderedCents >= cash) && (!external || confirmed);
  const edit = (index: number, patch: Partial<Payment>) => { setRows(list => list.map((p, i) => i === index ? { ...p, ...patch } : p)); setConfirmed(false); };
  if (!correction && cents(bill.total) === 0) return <Modal title={bill.non_chargeable ? 'Complete NC bill' : 'Complete zero-amount bill'} onClose={onClose} noClose={action.busy}>
    <p>Total {format(bill.total)}. Complete the bill to close the order and queue the receipt.</p>
    {action.feedback}
    <div className="modal-actions"><Button className="secondary" onClick={onClose}>Back to bill</Button>
      <Button busy={action.busy} onClick={() => void action.run(async () => onSaved(await api.settle(bill.id, bill.version, [])))}>Complete bill</Button></div>
  </Modal>;
  async function submit() {
    const payments = rows.map(r => ({ method: r.method, amount: number(r.amount), reference: r.reference?.trim() || '' }));
    const cashTendered = cash ? number(tendered) : undefined;
    onSaved(await (correction ? api.correctBillPayment(bill.id, bill.version, payments, reason.trim(), cashTendered)
      : api.settle(bill.id, bill.version, payments, cashTendered)));
  }
  return <Modal title={correction ? 'Correct recorded payment' : 'Settle bill'} subtitle={`Bill #${bill.bill_number}`} onClose={onClose} wide noClose={action.busy}><div className="settlement-total"><span>{correction ? 'Recorded bill total' : 'Amount to settle'}</span><strong>{format(bill.total)}</strong><Badge status={correction ? 'PAID' : 'BILL_PENDING'} /></div><form onSubmit={e => { e.preventDefault(); if (!valid || correction && reason.trim().length < 3) return; void action.run(submit); }}><fieldset disabled={action.blocked}><div className="section-heading"><h3>Payment allocation</h3><button className="text-button" type="button" disabled={!methods.length} onClick={() => { setRows(r => [...r, { method: methods[0], amount: Math.max(0, remaining / 100), reference: '' }]); setConfirmed(false); }}><Plus size={15} />Add payment</button></div>{!methods.length && <div className="notice error">No payment methods are configured for this outlet.</div>}{rows.map((row, i) => <div className="payment-row" key={i}><Field label={`Payment ${i + 1}`}><select value={row.method} onChange={e => edit(i, { method: e.target.value, reference: '' })} required><option value="" disabled>Select method</option>{methods.map(m => <option key={m} value={m}>{label(m)}</option>)}</select></Field><Field label="Amount"><input type="number" min={cents(bill.total) === 0 ? 0 : 0.01} step="0.01" required value={row.amount} onChange={e => edit(i, { amount: e.target.value })} /></Field><Field label={['CARD', 'UPI'].includes(row.method) ? 'Confirmation reference *' : 'Reference (optional)'}><input value={row.reference || ''} onChange={e => edit(i, { reference: e.target.value })} required={['CARD', 'UPI'].includes(row.method)} placeholder={row.method === 'UPI' ? 'UTR / transaction reference' : row.method === 'CARD' ? 'Terminal approval reference' : 'Reference'} /></Field><button className="icon-button" type="button" disabled={rows.length === 1} aria-label={`Remove payment ${i + 1}`} onClick={() => { setRows(r => r.filter((_, n) => n !== i)); setConfirmed(false); }}><Trash2 size={17} /></button></div>)}<div className={`allocation-balance ${remaining === 0 ? 'balanced' : ''}`}><span>{remaining < 0 ? 'Over-allocated' : 'Remaining to allocate'}</span><strong>{format(Math.abs(remaining) / 100)}</strong></div>{cash > 0 && <div className="cash-panel"><Field label="Cash tendered by guest"><input type="number" min={cash / 100} step="0.01" required value={tendered} onChange={e => setTendered(e.target.value)} /></Field><div><small>Expected cash change</small><strong>{format(Math.max(0, tenderedCents - cash) / 100)}</strong><small>Final change is confirmed by the server.</small></div></div>}{external && <div className="manual-confirmation"><div><ShieldCheck size={21} /><div><strong>Manual confirmation only — not a payment gateway</strong><p>Verify successful payment on your card terminal or UPI provider first. Enter a reference for every Card / UPI row. The POS records the payment reference you enter.</p></div></div><CheckField label="I have verified that every Card / UPI payment above was successfully received outside the POS." checked={confirmed} onChange={setConfirmed} /></div>}{correction && <Field label="Required audit reason"><textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} required /></Field>}</fieldset>{action.feedback}{correction && <div className="notice info small-text">Enter how the payment was actually received. The correction updates the recorded payment and queues a corrected receipt.</div>}<div className="modal-actions"><Button type="button" className="subtle" onClick={onClose} disabled={action.busy}>Back to bill</Button><Button busy={action.busy} disabled={action.blocked || !valid || correction && reason.trim().length < 3}><Check size={17} />{correction ? 'Save payment correction' : `Record ${format(bill.total)} payment`}</Button></div></form></Modal>;
}
function PaidReversalDialog({ bill, reopen, onClose, onSaved }: {
  bill: Bill; reopen: boolean; onClose: () => void; onSaved: (bill: Bill) => void;
}) {
  const format = useMoney();
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  return <ReasonDialog title={bill.non_chargeable ? 'Void NC bill' : reopen ? 'Reverse payment and edit items' : 'Cancel paid bill'}
    text={bill.non_chargeable ? (reopen ? 'Void the NC bill and reopen the order for item changes.' : 'The voided NC bill will stay in bill history.') : `Record a completed refund of ${format(bill.total)}. ${reopen ? 'This cancels the bill and reopens the order for item changes.' : 'The cancelled bill and original payment remain in history.'}`}
    danger onClose={onClose} onConfirm={async reason => {
      if (!bill.non_chargeable && (!confirmed || !reference.trim())) throw new Error('Confirm the full refund and enter its reference.');
      onSaved(await api.reverseBill(bill.id, bill.version, reason, reference.trim(), reopen));
    }}>
    {!bill.non_chargeable && <><Field label="Refund reference"><input value={reference} onChange={e => { setReference(e.target.value); setConfirmed(false); }} maxLength={160} required /></Field>
    <CheckField label="I confirm the full refund was completed outside the POS." checked={confirmed} onChange={setConfirmed} /></>}
  </ReasonDialog>;
}
function ModifyBillDialog({ bill, onClose, onSaved }: { bill: Bill; onClose: () => void; onSaved: (bill: Bill) => void }) {
  const [discount, setDiscount] = useState(number(bill.discount));
  return <ReasonDialog title="Modify bill discount" text="Only unpaid standalone bills can be modified. Split bills must be cancelled and regenerated. The server recalculates totals from immutable items and records the change." onClose={onClose} onConfirm={async reason => onSaved(await api.modifyBill(bill.id, bill.version, reason, discount))}><Field label="New discount amount"><input type="number" required min={0} max={number(bill.subtotal)} step="0.01" value={discount} onChange={e => setDiscount(Number(e.target.value))} /></Field></ReasonDialog>;
}
