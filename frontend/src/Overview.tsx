import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, Banknote, ChartNoAxesCombined, ChevronLeft, ChevronRight, Clock3, CreditCard, LayoutGrid, Plus, Printer, ReceiptText, Search, Users } from 'lucide-react';
import { api } from './api';
import { reportTypes } from './types';
import type { PaymentModeTotal, ReportType } from './types';
import { Badge, Button, DateFilters, Empty, label, LoadError, Loading, number, PageHeader, Refresh, useAction, useDateRange, useLoad, useMoney, useWorkspace } from './ui';

export function DashboardPage() {
  const { session, outletId, can, navigate, outlet } = useWorkspace(); const format = useMoney(); const [range, setRange] = useDateRange();
  const state = useLoad(() => api.dashboard(outletId, range), [outletId, range.from, range.to]);
  const data = state.data;
  const maxSales = Math.max(1, ...(data?.daily || []).map(d => number(d.total)));
  return <div className="page"><PageHeader eyebrow="THE BIG PICTURE" title={`Welcome in, ${session.user.name.split(' ')[0]}.`} description="A fresh view of your restaurant, from tables to takings." actions={<><Refresh onClick={state.reload} busy={state.loading} />{can('ORDER') && <Button onClick={() => navigate({ page: 'floor' })}><Plus size={17} />New order</Button>}</>} /><div className="overview-strip"><div><span className="tiny-dot" /><strong>{outlet?.name}</strong><span className="muted">Settled receipts only · {outlet?.timezone}</span></div><DateFilters value={range} onChange={setRange} /></div>{state.error ? <LoadError error={state.error} retry={state.reload} /> : state.loading ? <Loading /> : data && <><div className="stats-grid">{[{ title: 'Net sales', value: format(data.sales), Icon: Banknote, note: 'Across settled receipts', color: 'orange' }, { title: 'Bills settled', value: data.billCount, Icon: ReceiptText, note: 'Completed during this period', color: 'green' }, { title: 'Average bill', value: format(data.averageBill), Icon: ChartNoAxesCombined, note: 'Per settled receipt', color: 'blue' }, { title: 'Tables in service', value: data.activeTables, Icon: LayoutGrid, note: `${data.activeOrders} active orders right now`, color: 'purple' }].map(({ title, value, Icon, note, color }) => <section className="stat-card" key={title}><div className="stat-top"><span>{title}</span><span className={`stat-icon ${color}`}><Icon size={19} /></span></div><strong className="stat-value">{value}</strong><p>{note}</p></section>)}</div><div className="dashboard-grid"><section className="card sales-card"><div className="section-heading"><div><h2>Service, by the day</h2><p>Settled sales in the selected period</p></div><Badge>SALES</Badge></div>{data.subtotal !== undefined && <dl className="sales-breakdown">
  <div><dt>Gross sales</dt><dd>{format(data.subtotal)}</dd></div>
  <div><dt>Discounts</dt><dd>{format(data.discount)}</dd></div>
  <div><dt>Tax</dt><dd>{format(data.tax)}</dd></div>
  <div><dt>Net sales</dt><dd>{format(data.sales)}</dd></div>
</dl>}{data.daily.length ? <div className="sales-chart-scroll" tabIndex={0} aria-label="Daily sales chart"><div className="bar-chart" style={{ minWidth: data.daily.length * 72 }}>{data.daily.map(day => <div className="chart-column" key={day.date} title={`${day.date}: ${format(day.total)}`}><span className="chart-value">{format(day.total)}</span><div className="chart-track"><div className="chart-bar" style={{ height: `${Math.max(2, number(day.total) / maxSales * 100)}%` }} /></div><span>{day.date.slice(5)}</span></div>)}</div></div> : <Empty title="A new service awaits" text="Your daily sales will appear here when your first bill is settled." />}</section><section className="card"><div className="section-heading"><div><h2>How guests paid</h2><p>Confirmed payment allocations</p></div><CreditCard size={20} className="muted" /></div><PaymentModeChart payments={data.payments} /><div className="insight-note"><Clock3 size={16} /><span>Only recorded confirmations are included. Card and UPI payments are confirmed externally.</span></div></section><section className="card"><div className="section-heading"><div><h2>Guest favourites</h2><p>Most ordered, by settled sales</p></div><span className="eyebrow">ON THE MENU</span></div>{data.topItems.length ? <div className="rank-list">{data.topItems.map((item, i) => <div key={`${item.name}-${i}`}><span className="rank">{String(i + 1).padStart(2, '0')}</span><span><strong>{item.name}</strong><small>{item.quantity} served</small></span><b>{format(item.total)}</b></div>)}</div> : <Empty title="Your favourites are still cooking" text="Menu insights appear after orders are paid." />}</section><section className="card"><div className="section-heading"><div><h2>Category & outlet mix</h2><p>Where your sales come from</p></div></div>{data.topCategories.length ? <div className="mix-list">{data.topCategories.map((c, i) => <div key={`${c.name}-${i}`}><div><span>{c.name}</span><strong>{format(c.total)}</strong></div><div className="meter"><span style={{ width: `${Math.min(100, number(c.total) / Math.max(1, number(data.sales)) * 100)}%` }} /></div></div>)}</div> : <p className="muted">No category sales in this period.</p>}<div className="section-divider" />{data.outlets.map((o, i) => <div className="total-row" key={`${o.name}-${i}`}><span>{o.name}</span><strong>{format(o.total)}</strong></div>)}{can('REPORT') && <button className="text-button" onClick={() => navigate({ page: 'reports' })}>Explore detailed reports <ArrowRight size={16} /></button>}</section></div></>}</div>;
}

export function TablesPage({ onOutletChange }: { onOutletChange: (id: string) => void }) {
  const { outletId, navigate, session } = useWorkspace(); const state = useLoad(() => api.catalog(outletId), [outletId]);
  const [search, setSearch] = useState(''); const tables = state.data?.tables || [];
  const { loading, reload } = state;
  useEffect(() => {
    if (loading) return;
    const refreshVisible = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = window.setInterval(refreshVisible, 5000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [loading, reload]);

  const visible = tables.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="page"><PageHeader title="Tables" description="Open or resume orders for tables in the selected outlet." actions={<><Refresh onClick={state.reload} busy={state.loading} /></>} />
    <div className="tabs outlet-tabs" aria-label="Outlets">
      {session.outlets.map(outlet => <button key={outlet.id} type="button" className={outlet.id === outletId ? 'active' : ''}
        aria-pressed={outlet.id === outletId} onClick={() => { setSearch(''); onOutletChange(outlet.id); }}>{outlet.name}</button>)}
    </div><div className="floor-summary"><div><span className="status-dot available" /><strong>{tables.filter(t => !t.active_order_id).length}</strong> available</div><div><span className="status-dot occupied" /><strong>{tables.filter(t => t.active_order_id).length}</strong> in service</div><div><Users size={16} /><strong>{tables.reduce((s, t) => s + t.seats, 0)}</strong> configured seats</div></div><div className="toolbar"><div className="search-box"><Search size={17} /><input aria-label="Search tables" placeholder="Find a table…" value={search} onChange={e => setSearch(e.target.value)} /></div></div>{state.error ? <LoadError error={state.error} retry={state.reload} /> : state.loading && !state.data ? <Loading /> : visible.length ? <div className="table-grid">{visible.map(t => <button key={t.id} className={`floor-table ${t.active_order_id ? 'in-service' : ''}`} onClick={() => navigate({ page: 'pos', ...(t.active_order_id ? { orderId: t.active_order_id } : { tableId: t.id }) })}><div className="table-card-top"><span className={`status-dot ${t.active_order_id ? 'occupied' : 'available'}`} /></div><div className="table-diagram" aria-hidden="true"><span className="seat top" /><span className="seat left" /><span className="table-surface" /><span className="seat right" /><span className="seat bottom" /></div><strong className="table-name">{t.name}</strong><div className="table-card-bottom"><span><Users size={14} /> {t.seats} seats</span><Badge status={t.active_order_id ? t.order_status || 'OPEN' : 'AVAILABLE'} /></div><span className="table-action">{t.active_order_id ? 'Resume order' : 'Seat your guests'} <ArrowRight size={15} /></span></button>)}</div> : <Empty title={tables.length ? 'No matching tables' : 'No tables in this outlet'} text={tables.length ? 'Try another table name.' : 'Add tables in Masters to start a dine-in service. Takeaway orders can be started from Point of sale.'} />}</div>;
}

const paymentNames: Record<string, string> = { CASH: 'Cash', CARD: 'Card', UPI: 'UPI' };
const moneyColumns = new Set(['amount', 'average_bill', 'subtotal', 'discount', 'tax', 'taxable', 'total', 'unit_price', 'unitPrice', 'cashTendered', 'change']);
const hiddenReportField = (key: string) => key === 'id' || /(?:_id|_ids|Id|Ids|Job)$/.test(key);
const reportLabel = (type: ReportType) =>
  type === 'nc-kots' ? 'NC KOTs by department' : type === 'kot-cancellations' ? 'KOT voids and cancellations' :
    type === 'payment-details' ? 'Payment Details' : type === 'payments' ? 'Payment Summary' : label(type);

function PaymentModeChart({ payments }: { payments: PaymentModeTotal[] }) {
  const format = useMoney();
  const total = payments.reduce((sum, row) => sum + Math.round(number(row.total) * 100), 0);
  const rows = [...new Set([...Object.keys(paymentNames), ...payments.map(row => row.method)])].map(method => {
    const entry = payments.find(row => row.method === method);
    const amount = number(entry?.total);
    return { method, amount, count: entry?.payment_count ?? 0, share: total ? amount * 10000 / total : 0 };
  });
  const shades = ['#8e4325', '#214d46', '#ad732e'];
  return <div className="payment-mode-chart">
    <div className="payment-chart-total"><span>Total collected</span><strong>{format(total / 100)}</strong></div>
    {total > 0 && <div className="payment-mode-track" aria-hidden="true">
      {rows.filter(row => row.share > 0).map(row => <span key={row.method}
        style={{ width: row.share + '%', background: shades[rows.indexOf(row) % shades.length] }} />)}
    </div>}
    {rows.length > 0 ? <ul className="payment-mode-legend">{rows.map((row, index) => <li key={row.method}>
      <span className="payment-mode-swatch" style={{ background: shades[index % shades.length] }} aria-hidden="true" />
      <span><strong>{paymentNames[row.method] ?? label(row.method)}</strong><small>{row.count} {row.count === 1 ? 'payment' : 'payments'}</small></span>
      <span className="payment-mode-value"><strong>{format(row.amount)}</strong><small>{row.share ? row.share.toFixed(1) : '0'}%</small></span>
    </li>)}</ul> : <p className="muted">No payments in this date range.</p>}
  </div>;
}

function ReportValue({ field, value, timezone }: { field: string; value: unknown; timezone?: string }) {
  const format = useMoney();
  return <>{reportValue(field, value, timezone, format)}</>;
}

function groupedReportItems(values: unknown[]): unknown[] {
  const rows: unknown[] = [];
  const groups = new Map<string, Record<string, unknown>>();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      rows.push(value);
      continue;
    }
    const item = value as Record<string, unknown>;
    const quantity = typeof item.quantity === 'number' || typeof item.quantity === 'string' ? Number(item.quantity) : NaN;
    if (typeof item.name !== 'string' || !Number.isFinite(quantity) || quantity <= 0) {
      rows.push(value);
      continue;
    }
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers.map(modifier => JSON.stringify(modifier)).sort() : [];
    const key = JSON.stringify([item.menu_item_id ?? item.menuItemId, item.name, item.variant || '', item.notes || '',
      modifiers, item.unit_price ?? item.unitPrice, item.tax_rate ?? item.taxRate, !!item.non_chargeable]);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity = Number(existing.quantity) + quantity;
    } else {
      const row = { ...item, quantity };
      groups.set(key,row);
      rows.push(row);
    }
  }
  return rows;
}
function reportValue(field: string, value: unknown, timezone: string | undefined, format: ReturnType<typeof useMoney>): ReactNode {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' && ['items', 'modifiers', 'details'].includes(field) && /^[{\[]/.test(value.trimStart())) {
    try { value = JSON.parse(value); } catch { return String(value); }
  }
  if (Array.isArray(value)) {
    if (!value.length) return '—';
    const entries = field === 'items' ? groupedReportItems(value) : value;
    return <ul className="report-cell-list">{entries.map((part, index) => <li key={index}>{reportValue(field, part, timezone, format)}</li>)}</ul>;
  }
  if (value && typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    if (typeof entry.name === 'string') {
      return <div className="report-item-detail">
        <strong>{typeof entry.quantity === 'number' ? entry.quantity + ' × ' : ''}{entry.name}</strong>
        {typeof entry.variant === 'string' && entry.variant && <small>{entry.variant}</small>}
        {Array.isArray(entry.modifiers) && entry.modifiers.length > 0 && reportValue('modifiers', entry.modifiers, timezone, format)}
        {typeof entry.notes === 'string' && entry.notes && <small>{entry.notes}</small>}
      </div>;
    }
    const fields = Object.entries(entry).filter(([key, detail]) => !hiddenReportField(key) && detail !== null && detail !== undefined && detail !== '');
    return fields.length ? <dl className="report-cell-details">{fields.map(([key, detail]) => <div key={key}>
      <dt>{label(key.replace(/([a-z])([A-Z])/g, '$1 $2'))}</dt><dd>{reportValue(key, detail, timezone, format)}</dd>
    </div>)}</dl> : '—';
  }
  if (moneyColumns.has(field) && (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value))) return format(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    if (field === 'method') return paymentNames[value] ?? label(value);
    if (field === 'status') return <Badge status={value} />;
    if (field === 'action' || field === 'entity_type' || field === 'service_mode') return label(value);
    if (field.endsWith('_at') && !Number.isNaN(Date.parse(value)))
      return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
  }
  return String(value);
}
export function ReportsPage() {
  const { outletId, outlet } = useWorkspace(); const [type, setType] = useState<ReportType>('daily-sales'); const [range, setRange] = useDateRange(); const [page, setPage] = useState(0);
  const state = useLoad(() => api.report(type, outletId, range, page), [type, outletId, range.from, range.to, page]); const action = useAction();
  const data = state.data; const columns = [...new Set(data?.rows.flatMap(r => Object.keys(r)) || [])].filter(key => !hiddenReportField(key));
  const download = () => void action.run(async () => { const blob = await api.exportReport(type, outletId, range); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `hearth-table-${type}-${range.from}-${range.to}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, 'CSV export downloaded with the selected outlet and date filters.');
  return <div className="page report-page"><PageHeader eyebrow="KNOW YOUR RESTAURANT" title="Clarity, on the record." description="Sales, service and audit trails. Real numbers, with room for the details." actions={<><Button className="secondary" onClick={() => window.print()} disabled={!data || state.loading || !!state.error}><Printer size={16} />Print this page</Button><Button onClick={download} busy={action.busy} disabled={action.blocked}><ArrowDownToLine size={16} />Export CSV</Button></>} /><div className="report-layout"><aside className="report-nav"><span className="eyebrow">REPORT LIBRARY</span>{reportTypes.map(t => <button key={t} className={t === type ? 'active' : ''} onClick={() => { setType(t); setPage(0); }}><ReceiptText size={16} />{reportLabel(t)}{t === type && <ChevronRight size={15} />}</button>)}</aside><section className="report-content"><div className="card report-filters"><div><h2>{reportLabel(type)}</h2><p>{outlet?.name} · {range.from} — {range.to}</p></div><DateFilters value={range} onChange={r => { setRange(r); setPage(0); }} /></div>{action.feedback}{state.error ? <LoadError error={state.error} retry={state.reload} /> : state.loading ? <Loading text="Preparing your report…" /> : data && <>{type === 'payment-details' && <div className="card report-payment-card">
  <h3>Totals by payment mode</h3>
  <PaymentModeChart payments={data.paymentModes ?? []} />
</div>}<div className="report-totals">{Object.entries(data.totals).map(([key, value]) => <div key={key}><span>{label(key)}</span><strong><ReportValue field={key} value={value} /></strong></div>)}</div><div className="card report-table-card"><div className="section-heading"><h3>{data.totalElements.toLocaleString()} {data.totalElements === 1 ? 'record' : 'records'}</h3><Refresh onClick={state.reload} /></div>{data.rows.length ? <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map(c => <th key={c}>{label(c)}</th>)}</tr></thead><tbody>{data.rows.map((row, i) => <tr key={i}>{columns.map(c => <td className={moneyColumns.has(c) ? 'align-right' : undefined} key={c}><ReportValue field={c} value={row[c]} timezone={outlet?.timezone} /></td>)}</tr>)}</tbody></table></div> : <Empty title="Nothing in this period" text="Choose a different date range, or return after restaurant activity has been recorded." />}<div className="pagination"><span>Page {data.page + 1} of {Math.max(1, Math.ceil(data.totalElements / data.size))} · {data.size} per page</span><div><Button className="subtle" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} />Previous</Button><Button className="subtle" disabled={(page + 1) * data.size >= data.totalElements} onClick={() => setPage(p => p + 1)}>Next<ChevronRight size={16} /></Button></div></div></div><p className="small-text muted">CSV includes the full bounded result, not just this page. Exports are limited to 366 days and the server's row limit; oversized exports return an explicit error.</p></>}</section></div></div>;
}
