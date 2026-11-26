import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowRightLeft, Check, ChefHat, ChevronDown, CirclePlus, FilePenLine, Leaf, Minus, Plus, ReceiptText, Search, Send, Users, X } from 'lucide-react';
import { api } from './api';
import type { Catalog, Kot, MenuItem, Order, OrderItem } from './types';
import { activeLine, Badge, Button, CheckField, Empty, Field, itemName, label, LoadError, Loading, Modal, number, PageHeader, ReasonDialog, Refresh, useAction, useLoad, useMoney, useWorkspace } from './ui';

type OrderDialog = { type: 'item'; item: MenuItem } | { type: 'line'; line: OrderItem } | { type: 'cancel-line'; kotId: string; items: OrderItem[]; quantity: number } | { type: 'void-kot'; kot: Kot } | { type: 'create' | 'details' | 'transfer' | 'cancel' | 'bills' } | null;
function groupCartItems(items: OrderItem[]) {
  const groups = new Map<string, { items: OrderItem[]; quantity: number; total: number }>();
  for (const item of items) {
    const modifiers = (item.modifiers ?? []).map(modifier =>
      typeof modifier === 'string' ? [modifier] : [modifier.name, number(modifier.price)]);
    const key = JSON.stringify([
      item.menu_item_id, itemName(item), item.variant ?? '', item.notes ?? '', number(item.unit_price),
      number(item.tax_rate), !!item.non_chargeable, modifiers.map(value => JSON.stringify(value)).sort(),
    ]);
    const row = groups.get(key) ?? { items: [], quantity: 0, total: 0 };
    row.items.push(item);
    row.quantity += number(item.quantity);
    row.total += number(item.total ?? item.line_total ?? number(item.unit_price) * number(item.quantity));
    groups.set(key, row);
  }
  return [...groups.entries()];
}
export function POSPage({ initialOrderId, initialTableId }: { initialOrderId?: string; initialTableId?: string }) {
  const { outletId, outlet, can, navigate } = useWorkspace(); const format = useMoney();
  const cart = useRef<HTMLElement>(null);
  const [voidQuantity, setVoidQuantity] = useState(1);
  const [selected, setSelected] = useState(initialOrderId || '');
  const [dialog, setDialog] = useState<OrderDialog>(initialTableId ? { type: 'create' } : null);
  const [group, setGroup] = useState('all');
  const [ncKot, setNcKot] = useState(false);
  const [ncDepartmentId, setNcDepartmentId] = useState('');
  const [ncReason, setNcReason] = useState('');
  const [category, setCategory] = useState('all'); const [search, setSearch] = useState(''); const [vegOnly, setVegOnly] = useState(false);
  const resources = useLoad(async () => ({ catalog: await api.catalog(outletId), orders: await api.orders(outletId) }), [outletId]);
  const detail = useLoad(() => selected ? api.order(selected) : Promise.resolve(null), [selected]);
  const order = detail.data?.id === selected ? detail.data : null; const catalog = resources.data?.catalog;
  const action = useAction(() => { detail.reload(); resources.reload(); });
  const update = (value: Order) => { detail.setData(value); setSelected(value.id); resources.reload(); };
  const close = () => setDialog(null);
  function afterItemRemoval(value: Order) {
    if (value.status === 'CANCELLED' && value.table_id) navigate({ page: 'floor' });
    else update(value);
  }
  useEffect(() => { if (initialOrderId) setSelected(initialOrderId); }, [initialOrderId]);
  const lines = order?.items?.filter(activeLine) || []; const unsent = lines.filter(l => number(l.sent_quantity) < number(l.quantity));
  const editable = !!order && ['DRAFT', 'OPEN'].includes(order.status);
  const ncDepartments = (catalog?.ncDepartments ?? []).filter(department => department.active);
  const ncReady = !ncKot || ncDepartments.some(department => department.id === ncDepartmentId) && !!ncReason.trim();
  async function sendKot(current: Order) {
    update(await api.send(current.id, current.version, ncKot ? { ncDepartmentId, ncReason: ncReason.trim() } : undefined));
    setNcKot(false);
    setNcDepartmentId('');
    setNcReason('');
  }
  function changeQuantity(current: Order, line: OrderItem, delta: number) {
    const quantity = number(line.quantity) + delta;
    void action.run(async () => {
      if (quantity === 0) afterItemRemoval(await api.cancelItem(current.id, line.id, current.version));
      else update(await api.editItem(current.id, line.id, { version: current.version, quantity }));
    });
  }
  const groups = catalog?.groups || [];
  const activeGroup = group === 'all' ? 'all' : groups.some(row => row.id === group) ? group : groups[0]?.id || 'all';
  const categories = (catalog?.categories || []).filter(row => activeGroup === 'all' || row.group_id === activeGroup);
  const categoryIds = new Set(categories.map(row => row.id));
  const groupItems = (catalog?.items || []).filter(item => categoryIds.has(item.category_id));
  const menu = groupItems.filter(item =>(category === 'all' || item.category_id === category) && (!vegOnly || item.vegetarian) && `${item.name} ${item.description || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="pos-page"><PageHeader eyebrow="LET’S MAKE IT A GREAT SERVICE" title={order?.table_name ? 'Table ' + order.table_name : 'Table order'} actions={<><Refresh onClick={() => { resources.reload(); detail.reload(); }} busy={resources.loading || detail.loading} /><Button className="secondary" onClick={() => navigate({ page: 'floor' })}>Back to tables</Button>{order && <Button className="secondary mobile-order-jump" onClick={() => { cart.current?.focus({ preventScroll: true }); cart.current?.scrollIntoView({ block: 'start' }); }}>View order</Button>}</>} />{resources.error && <LoadError error={resources.error} retry={resources.reload} />}{resources.loading && !catalog ? <Loading text="Bringing your menu to the table…" /> : catalog && <><div className="tabs pos-group-tabs" aria-label="Menu groups">
      <button type="button" className={activeGroup === 'all' ? 'active' : ''} aria-pressed={activeGroup === 'all'} onClick={() => { setGroup('all'); setCategory('all'); }}>All</button>
      {groups.map(row => <button type="button" key={row.id} className={row.id === activeGroup ? 'active' : ''}
        aria-pressed={row.id === activeGroup} onClick={() => { setGroup(row.id); setCategory('all'); }}>{row.name}</button>)}
    </div><div className="pos-workspace"><aside className="category-rail"><div className="category-rail-title">THE MENU<span>{groupItems.length}</span></div><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}><span className="category-symbol tone-0">ALL</span><span>All categories<small>{groupItems.length} items</small></span></button>{[...categories].sort((a, b) => a.sort_order - b.sort_order).map((c, i) => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => setCategory(c.id)}><span className={`category-symbol tone-${i % 4}`}>{c.name.slice(0, 2).toUpperCase()}</span><span>{c.name}<small>{catalog.items.filter(m => m.category_id === c.id).length} items</small></span></button>)}<div className="category-bottom"><ChefHat size={22} /><p>Good food.<br /><strong>Even better service.</strong></p></div></aside><section className="menu-pane"><div className="menu-toolbar"><div className="search-box"><Search size={18} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the menu…" aria-label="Search menu items" />{search && <button className="icon-button" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</div><button className={`veg-filter ${vegOnly ? 'active' : ''}`} onClick={() => setVegOnly(!vegOnly)} aria-pressed={vegOnly}><Leaf size={16} />Veg only</button></div><div className="menu-section-heading"><h2>{category === 'all' ? (activeGroup === 'all' ? 'All items' : 'All items · ' + (groups.find(row => row.id === activeGroup)?.name || 'Group')) : catalog.categories.find(c => c.id === category)?.name}</h2><span>{menu.length} items</span></div>{!order && <div className="menu-callout"><CirclePlus size={18} /><span>Start or resume an order to add dishes.</span><button className="text-button" onClick={() => navigate({ page: 'floor' })}>Start order <ArrowRight size={14} /></button></div>}{menu.length ? <div className="menu-grid">{menu.map((item, i) => <button key={item.id} className={`menu-item ${!item.available ? 'unavailable' : ''}`} disabled={!item.available || action.blocked || (!!order && !editable) || detail.loading} onClick={() => { if (!order) navigate({ page: 'floor' }); else if (item.variants?.length || item.modifiers?.length) setDialog({ type: 'item', item }); else void action.run(async () => {
  update(await api.addItem(order.id, { version: order.version, menuItemId: item.id, quantity: 1, variant: '', modifiers: [], notes: '' }));
}); }}><div className="menu-item-meta"><span className={`diet-mark ${item.vegetarian ? 'veg' : 'nonveg'}`} title={item.vegetarian ? 'Vegetarian' : 'Non-vegetarian'} aria-label={item.vegetarian ? 'Vegetarian' : 'Non-vegetarian'}><i /></span><span>{!item.available ? 'UNAVAILABLE' : item.variants?.length ? 'CUSTOMISABLE' : catalog.categories.find(c => c.id === item.category_id)?.department || 'FRESHLY MADE'}</span></div><div className={`dish-glyph dish-${i % 4}`} aria-hidden="true"><span /><span /><span /></div><h3>{item.name}</h3><p>{item.description || catalog.categories.find(c => c.id === item.category_id)?.name}</p><div className="menu-item-footer"><strong>{format(item.price)}</strong><span className="add-dish"><Plus size={18} /></span></div></button>)}</div> : <Empty title="No dishes found" text={catalog.items.length ? 'Try a different search or category.' : 'Add your restaurant menu in Settings to get started.'} />}</section><aside className="cart-pane" ref={cart} tabIndex={-1} aria-label="Current order"><div className="cart-header"><div><span className="eyebrow">CURRENT ORDER</span><h2>{order ? `#${order.order_number}` : 'Ready when you are'}</h2></div>{order && <Badge status={order.status} />}</div><div className="order-selector"><select aria-label="Resume an open order" value={selected} disabled={action.blocked} onChange={e => { setSelected(e.target.value); action.clear(); }}><option value="">Resume an active order…</option>{resources.data?.orders.map(o => <option key={o.id} value={o.id}>#{o.order_number} · {o.table_name || label(o.service_mode)} · {format(o.total)}</option>)}{order && !resources.data?.orders.some(o => o.id === order.id) && <option value={order.id}>#{order.order_number}</option>}</select><ChevronDown size={16} /></div>{detail.error ? <LoadError error={detail.error} retry={detail.reload} /> : detail.loading && selected ? <Loading text="Loading order…" /> : order ? <><div className="order-context"><span>{order.table_name || catalog.tables.find(t => t.id === order.table_id)?.name || label(order.service_mode)}</span><span><Users size={14} />{order.covers} pax</span>{order.waiter_name && <span>Steward: {order.waiter_name}</span>}<button className="icon-button" title="Edit order details" aria-label="Edit order details" disabled={!editable || action.blocked} onClick={() => setDialog({ type: 'details' })}><FilePenLine size={17} /></button></div>{order.customer_name && <div className="cart-customer">Guest: {order.customer_name}</div>}{order.notes && <div className="order-note">{order.notes}</div>}<div className="cart-lines">{unsent.length ? <>{unsent.length > 0 && <div className="line-section"><span className="tiny-dot orange-dot" />KOT NOT SENT<span>{unsent.length}</span></div>}{groupCartItems(unsent).map(([key, group]) => {
        const line = group.items[0];
        const increment = group.items.find(item => number(item.quantity) < 999);
        const decrement = group.items[group.items.length - 1];
        const name = itemName(line);
        return <div key={key} className="cart-line">
          <div className="cart-line-title"><strong>{name}</strong><span>{format(group.total)}</span></div>
          {line.variant && <small>{line.variant}</small>}
          {!!line.modifiers?.length && <small>+ {line.modifiers.map(m => typeof m === 'string' ? m : m.name).join(', ')}</small>}
          {line.notes && <p className="line-note"><strong>Kitchen:</strong> “{line.notes}”</p>}
          <div className="cart-line-bottom">
            <span className="quantity-label">{format(line.unit_price)} each</span>
            <div className="line-controls" aria-label={name + ' quantity'}>
              <button type="button" aria-label={'Decrease ' + name} disabled={!editable || action.blocked}
                onClick={() => changeQuantity(order, decrement, -1)}><Minus size={15} /></button>
              <strong className="cart-quantity">{group.quantity}</strong>
              <button type="button" aria-label={'Increase ' + name} disabled={!editable || action.blocked || !increment}
                onClick={() => { if (increment) changeQuantity(order, increment, 1); }}><Plus size={15} /></button>
            </div>
          </div>
          {editable && group.items.length === 1 && <button type="button" className="text-button" disabled={action.blocked}
            onClick={() => setDialog({ type: 'line', line })}>{line.notes ? 'Edit kitchen instructions' : 'Add kitchen instructions'}</button>}
        </div>;
      })}</> : <Empty title="No new items" text="Add dishes from the menu. Sent items appear under their KOT below." />}</div><div className="cart-footer">{action.feedback}<div className="totals"><div><span>Subtotal</span><strong>{format(order.subtotal)}</strong></div><div><span>Discount {can('DISCOUNT') && editable && <button className="text-button" onClick={() => setDialog({ type: 'details' })} disabled={action.blocked}>Edit</button>}</span><strong>− {format(order.discount)}</strong></div><div><span>Taxes</span><strong>{format(order.tax)}</strong></div><div className="grand-total"><span>Total</span><strong>{format(order.total)}</strong></div></div><p className="server-note">Calculated by your restaurant server</p>{editable && <>{unsent.length > 0 && <fieldset disabled={action.busy} className="kot-send-options">
  <legend>KOT type</legend>
  <label><input type="radio" name="kot-type" checked={!ncKot} onChange={() => setNcKot(false)} /> Normal KOT</label>
  <label><input type="radio" name="kot-type" checked={ncKot} onChange={() => setNcKot(true)} /> NC KOT</label>
  {ncKot && <>
    <p className="small-text muted">All unsent items in this batch will be non-chargeable.</p>
    <Field label="NC department"><select value={ncDepartmentId} onChange={event => setNcDepartmentId(event.target.value)}>
      <option value="">Select a department</option>
      {ncDepartments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
    </select></Field>
    {!ncDepartments.length && <p className="notice info">Add an active department in Masters → NC Departments.</p>}
    <Field label="NC reason"><textarea value={ncReason} maxLength={500} onChange={event => setNcReason(event.target.value)} /></Field>
  </>}
</fieldset>}<Button className="full" disabled={!unsent.length || !ncReady || action.blocked} busy={action.busy} onClick={() => void action.run(() => sendKot(order), ncKot ? 'NC KOT queued.' : 'KOT queued.')}><Send size={17} />{ncKot ? 'Send NC KOT' : 'Send KOT'}{unsent.length > 0 && <span className="button-count">{unsent.length}</span>}</Button>{can('BILL') && <Button className="secondary full" disabled={!lines.length || unsent.length > 0 || action.blocked} onClick={() => setDialog({ type: 'bills' })}><ReceiptText size={17} />Create bill / split bill</Button>}{!!unsent.length && can('BILL') && <p className="small-text muted center">Send all items before creating a bill.</p>}</>}{order.status === 'BILL_PENDING' && can('BILL') && <Button className="full" onClick={() => navigate({ page: 'bills', billId: order.bills?.find(b => b.status !== 'CANCELLED' && b.status !== 'PAID')?.id })}><ReceiptText size={17} />View & settle bills</Button>}{!!order.kots?.length && <details className="order-kots" open>
  <summary>KOTs ({order.kots.length})</summary>
  {order.kots.map(kot => <section key={kot.id}>
    <div className="order-kot-row">
      <div><strong>{kot.kot_number}</strong>{kot.nc_department_name && <small>NC · {kot.nc_department_name}</small>}
        {kot.nc_reason && <small>{kot.nc_reason}</small>}{kot.status === 'CANCELLED' && kot.reason && <small>Void reason: {kot.reason}</small>}</div>
      {kot.status === 'CANCELLED' ? <Badge status="CANCELLED">Voided</Badge> :
        editable && can('CANCEL') && <button type="button" className="text-button danger-text" disabled={action.blocked}
          onClick={() => setDialog({ type: 'void-kot', kot })}>Void KOT</button>}
    </div>
    {kot.status !== 'CANCELLED' && groupCartItems(kot.items.flatMap(item => {
      const line = lines.find(entry => entry.id === item.order_item_id);
      return line?.sent_quantity ? [line] : [];
    })).map(([key, group]) => {
      const line = group.items[0];
      return <div className="order-kot-row sent-line" key={key}>
        <div><strong>{itemName(line)}</strong>
          {line.variant && <small>{line.variant}</small>}
          {!!line.modifiers?.length && <small>{line.modifiers.map(modifier => typeof modifier === 'string' ? modifier : modifier.name).join(', ')}</small>}
          {line.notes && <small>{line.notes}</small>}
          <small>{group.quantity} sent</small>
        </div>
        {editable && can('CANCEL') && <button type="button" className="text-button danger-text" disabled={action.blocked}
          aria-label={'Void ' + itemName(line)} onClick={() => {
            setVoidQuantity(1);
            setDialog({ type: 'cancel-line', kotId: kot.id, items: group.items, quantity: group.quantity });
          }}>Void item</button>}
      </div>;
    })}
  </section>)}</details>}<div className="cart-secondary-actions">{can('TRANSFER') && editable && <button className="text-button" onClick={() => setDialog({ type: 'transfer' })} disabled={action.blocked}><ArrowRightLeft size={14} />Transfer</button>}{can('CANCEL') && ['DRAFT', 'OPEN', 'BILL_PENDING'].includes(order.status) && <button className="text-button danger-text" onClick={() => setDialog({ type: 'cancel' })} disabled={action.blocked}>{order.status === 'DRAFT' ? 'Discard draft' : 'Cancel order'}</button>}</div></div></> : <div className="cart-empty"><div className="receipt-illustration"><ReceiptText size={49} strokeWidth={1.1} /></div><h3>A table full of possibilities.</h3><p>Start a new order, or resume an active service above.</p><Button onClick={() => navigate({ page: 'floor' })}><Plus size={17} />Start an order</Button><div className="cart-empty-foot"><Check size={15} />Saved as you serve</div></div>}</aside></div></>}
    {dialog?.type === 'create' && catalog && initialTableId && <CreateOrderDialog catalog={catalog} tableId={initialTableId} onClose={() => navigate({ page: 'floor' })} onCreated={value => { update(value); close(); }} />}
    {dialog?.type === 'item' && order && <ItemDialog item={dialog.item} order={order} onClose={close} onSaved={update} onConflict={() => { detail.reload(); close(); }} />}
    {dialog?.type === 'line' && order && <LineDialog line={dialog.line} order={order} onClose={close} onSaved={update} onConflict={() => { detail.reload(); close(); }} />}
    {dialog?.type === 'cancel-line' && order && <ReasonDialog title={'Void ' + itemName(dialog.items[0])}
      text="Select the quantity to remove. A VOID KOT slip will print for that quantity." danger
      onClose={() => { close(); detail.reload(); }}
      onConfirm={async reason => afterItemRemoval(await api.voidKotItems(dialog.kotId, { version: order.version, orderItemIds: dialog.items.map(item => item.id), quantity: voidQuantity, reason }))}>
      <Field label="Quantity to void"><input type="number" min={1} max={dialog.quantity} step={1}
        value={voidQuantity || ''} onChange={event => setVoidQuantity(Number(event.target.value))} required /></Field>
    </ReasonDialog>}
     {dialog?.type === 'details' && order && <DetailsDialog order={order} onClose={close} onSaved={update} onConflict={() => { detail.reload(); close(); }} />}
    {dialog?.type === 'transfer' && order && catalog && <TransferDialog order={order} catalog={catalog} onClose={() => { close(); detail.reload(); resources.reload(); }} onSaved={update} />}
    {dialog?.type === 'void-kot' && order && <ReasonDialog title={`Void ${dialog.kot.kot_number ?? 'KOT'}?`}
      text="This removes the remaining items on the ticket and queues a VOID KOT slip at its original printer."
      danger onClose={close} onConfirm={async reason => {
        await api.cancelKot(dialog.kot.id, reason);
        afterItemRemoval(await api.order(order.id));
      }} />}
    {dialog?.type === 'cancel' && order && <ReasonDialog title="Cancel this order?" text="Unpaid bills will be voided and kitchen cancellation jobs queued. Orders with paid bills cannot be cancelled." danger onClose={() => { close(); detail.reload(); }} onConfirm={async reason => update(await api.cancelOrder(order.id, order.version, reason))} />}
    {dialog?.type === 'bills' && order && <SplitDialog order={order} onClose={close} onSaved={value => { update(value); navigate({ page: 'bills', billId: value.bills?.find(b => b.status !== 'CANCELLED')?.id }); }} onConflict={() => { detail.reload(); close(); }} />}
    {!outlet?.service_modes?.length && catalog && <div className="notice info">Configure this outlet's service modes in Settings before opening an order.</div>}
  </div>;
}
function CreateOrderDialog({ catalog, tableId, onClose, onCreated }: {
  catalog: Catalog; tableId: string; onClose: () => void; onCreated: (order: Order) => void;
}) {
  const { outletId } = useWorkspace();
  const [pax, setPax] = useState('1');
  const [stewardId, setStewardId] = useState('');
  const stewards = (catalog.stewards ?? []).filter(steward => steward.active);
  const action = useAction(onClose);
  const table = catalog.tables.find(row => row.id === tableId);
  return <Modal title={table ? 'Open table ' + table.name : 'Open table'} subtitle={catalog.outlet.name} onClose={onClose} noClose={action.busy}>
    <form onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const order = await api.createOrder({ outletId, tableId, serviceMode: 'DINE_IN', covers: Number(pax),
          stewardId, notes: '', customerName: '' });
        onCreated(order);
      });
    }}>
      <fieldset disabled={action.blocked}>
        <Field label="Pax"><input type="number" min={1} max={100} step={1} required value={pax} onChange={event => setPax(event.target.value)} /></Field>
        <Field label="Steward"><select required value={stewardId} onChange={event => setStewardId(event.target.value)}>
          <option value="">Select a steward</option>
          {stewards.map(steward => <option key={steward.id} value={steward.id}>{steward.name}</option>)}
        </select></Field>
        {!stewards.length && <p className="notice info">Add an active steward in Masters → Stewards for this outlet.</p>}
      </fieldset>
      {action.feedback}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" busy={action.busy} disabled={!table || !stewardId}>Open table</Button>
      </div>
    </form>
  </Modal>;
}

interface EditProps { order: Order; onClose: () => void; onSaved: (order: Order) => void; onConflict: () => void }
function ItemDialog({ item, order, onClose, onSaved, onConflict }: EditProps & { item: MenuItem }) {
  const format = useMoney(); const action = useAction(onConflict); const [variant, setVariant] = useState(item.variants?.[0]?.name || ''); const [modifiers, setModifiers] = useState<string[]>([]); const [quantity, setQuantity] = useState(1);
  return <Modal title={item.name} subtitle={item.description || 'Make it just right for your guest.'} onClose={onClose} noClose={action.busy}><form onSubmit={e => { e.preventDefault(); void action.run(async () => { onSaved(await api.addItem(order.id, { version: order.version, menuItemId: item.id, quantity, variant, modifiers, notes: '' })); onClose(); }); }}><fieldset disabled={action.blocked}>{!!item.variants?.length && <Field label="Choose a size / variant"><select value={variant} onChange={e => setVariant(e.target.value)} required>{item.variants.map(v => <option key={v.name} value={v.name}>{v.name} · {format(v.price)}</option>)}</select></Field>}{!!item.modifiers?.length && <div className="modifier-list"><h3>A little extra</h3>{item.modifiers.map(m => <CheckField key={m.name} label={`${m.name} · +${format(m.price)}`} checked={modifiers.includes(m.name)} onChange={checked => setModifiers(v => checked ? [...v, m.name] : v.filter(n => n !== m.name))} />)}</div>}<Field label="Quantity"><div className="quantity-picker"><button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity(q => q - 1)}><Minus size={18} /></button><input type="number" required min={1} max={999} step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /><button type="button" aria-label="Increase quantity" disabled={quantity >= 999} onClick={() => setQuantity(q => q + 1)}><Plus size={18} /></button></div></Field></fieldset>{action.feedback}<div className="modal-actions"><span className="small-text muted">Menu prices are verified by the server.</span><Button busy={action.busy} disabled={action.blocked}>Save to order <Plus size={17} /></Button></div></form></Modal>;
}
function LineDialog({ line, order, onClose, onSaved, onConflict }: EditProps & { line: OrderItem }) {
  const [quantity, setQuantity] = useState(line.quantity); const [notes, setNotes] = useState(line.notes || ''); const action = useAction(onConflict);
  return <Modal title={`Edit ${itemName(line)}`} subtitle="Only unsent lines can be edited. Instructions print on the kitchen ticket only." onClose={onClose} noClose={action.busy}><form onSubmit={e => { e.preventDefault(); void action.run(async () => { onSaved(await api.editItem(order.id, line.id, { version: order.version, quantity, notes })); onClose(); }); }}><fieldset disabled={action.blocked}><Field label="Quantity"><input type="number" required min={1} step={1} max={999} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></Field><Field label="Kitchen instructions"><textarea maxLength={2000} value={notes} placeholder="For example: extra spicy, serve cold, no onions" onChange={e => setNotes(e.target.value)} /></Field></fieldset>{action.feedback}<div className="modal-actions"><Button busy={action.busy} disabled={action.blocked}>Save changes</Button></div></form></Modal>;
}
function DetailsDialog({ order, onClose, onSaved, onConflict }: EditProps) {
  const { can } = useWorkspace(); const [name, setName] = useState(order.customer_name || ''); const [notes, setNotes] = useState(order.notes || ''); const [discount, setDiscount] = useState(number(order.discount)); const action = useAction(onConflict);
  return <Modal title="Order details" subtitle={`Order #${order.order_number} · Changes are checked against the current order version.`} onClose={onClose} noClose={action.busy}><form onSubmit={e => { e.preventDefault(); void action.run(async () => { onSaved(await api.editOrder(order.id, { version: order.version, notes, customerName: name, ...(can('DISCOUNT') && discount !== number(order.discount) ? { discount } : {}) })); onClose(); }); }}><fieldset disabled={action.blocked}><Field label="Guest name"><input value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Order notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>{can('DISCOUNT') && <Field label="Discount amount" hint="A fixed amount, not a percentage. Taxes and final totals are recalculated on the server."><input type="number" min={0} max={number(order.subtotal)} step="0.01" required value={discount} onChange={e => setDiscount(Number(e.target.value))} /></Field>}</fieldset>{action.feedback}<div className="modal-actions"><Button busy={action.busy} disabled={action.blocked}>Save order details</Button></div></form></Modal>;
}
function TransferDialog({ order, catalog, onClose, onSaved }: Omit<EditProps, 'onConflict'> & { catalog: Catalog }) {
  const [table, setTable] = useState('');
  return <ReasonDialog title="Move to another table" text="The destination must be available in this outlet. The move is recorded in the audit trail." onClose={onClose} onConfirm={async reason => { if (!table) throw new Error('Choose a destination table.'); onSaved(await api.transfer(order.id, order.version, table, reason)); }}><Field label="Destination table"><select required value={table} onChange={e => setTable(e.target.value)}><option value="">Select table</option>{catalog.tables.filter(t => !t.active_order_id && t.id !== order.table_id).map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></Field></ReasonDialog>;
}
function SplitDialog({ order, onClose, onSaved, onConflict }: EditProps) {
  const format = useMoney(); const lines = order.items.filter(activeLine); const [count, setCount] = useState(1); const [allocation, setAllocation] = useState<Record<string, number[]>>(() => Object.fromEntries(lines.map(l => [l.id, [l.quantity]]))); const action = useAction(onConflict);
  const valid = lines.every(l => allocation[l.id].reduce((s, n) => s + n, 0) === l.quantity && allocation[l.id].every(n => Number.isFinite(n) && n >= 0 && Number.isInteger(n))) && Array.from({ length: count }, (_, i) => lines.some(l => allocation[l.id][i] > 0)).every(Boolean);
  const allNc = lines.length > 0 && lines.every(line => line.non_chargeable);
  const [ncBill, setNcBill] = useState(allNc);
  return <Modal title="Create bill" subtitle="Create one bill, or allocate exact item quantities across separate bills. All active quantities must be assigned once." onClose={onClose} wide noClose={action.busy}><form onSubmit={e => { e.preventDefault(); if (!valid) return; void action.run(async () => { const groups = count === 1 ? undefined : Array.from({ length: count }, (_, i) => ({ items: lines.filter(l => allocation[l.id][i] > 0).map(l => ({ itemId: l.id, quantity: allocation[l.id][i] })) })); onSaved(await api.createBills(order.id, order.version, groups, ncBill && count === 1)); onClose(); }); }}><fieldset disabled={action.blocked}>{allNc && <div className="kot-send-options"><strong>Bill type</strong>
  <label><input type="radio" name="bill-type" checked={ncBill} onChange={() => {
    setNcBill(true); setCount(1); setAllocation(Object.fromEntries(lines.map(line => [line.id, [line.quantity]])));
  }} /> NC bill (zero amount)</label>
  <label><input type="radio" name="bill-type" checked={!ncBill} onChange={() => setNcBill(false)} /> Split NC items</label>
</div>}<div className="split-heading"><Field label="Number of bills"><select value={count} disabled={ncBill} onChange={e => { const n = Number(e.target.value); setCount(n); setAllocation(Object.fromEntries(lines.map(l => [l.id, Array.from({ length: n }, (_, i) => i === 0 ? l.quantity : 0)]))); }}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n === 1 ? 'One bill for the table' : `${n} separate bills`}</option>)}</select></Field><div className="split-total"><small>Order total</small><strong>{format(order.total)}</strong></div></div><div className="table-scroll"><table className="data-table split-table"><thead><tr><th>Dish</th><th>Ordered</th>{Array.from({ length: count }, (_, i) => <th key={i}>Bill {i + 1}</th>)}<th>Left</th></tr></thead><tbody>{lines.map(l => { const left = l.quantity - allocation[l.id].reduce((s, n) => s + n, 0); return <tr key={l.id}><td>{itemName(l)}{l.variant && <small>{l.variant}</small>}</td><td>{l.quantity}</td>{allocation[l.id].map((q, i) => <td key={i}><input aria-label={`${itemName(l)}, bill ${i + 1} quantity`} type="number" required min={0} max={l.quantity} step={1} value={q} onChange={e => setAllocation(a => ({ ...a, [l.id]: a[l.id].map((v, n) => n === i ? Number(e.target.value) : v) }))} /></td>)}<td className={left ? 'danger-text' : 'success-text'}>{left}</td></tr>; })}</tbody></table></div>{!valid && <div className="notice warning">Allocate every item exactly once, with at least one item in each bill.</div>}<p className="muted small-text">Discounts and taxes are allocated by the server, with rounding reconciled across bills. Billed orders cannot be edited without an authorized cancellation.</p></fieldset>{action.feedback}<div className="modal-actions"><Button type="button" className="subtle" onClick={onClose} disabled={action.busy}>Back to order</Button><Button busy={action.busy} disabled={action.blocked || !valid}>Create {count === 1 ? 'bill' : `${count} bills`} <ReceiptText size={17} /></Button></div></form></Modal>;
}
