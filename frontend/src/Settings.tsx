import { useState } from 'react';
import { Building2, ChefHat, FilePenLine, MapPin, LayoutGrid, Plus, Save, Settings2, ShieldCheck, Store, Trash2, Users, UtensilsCrossed } from 'lucide-react';
import { api } from './api';
import type { Branch, Category, MenuGroup, MenuItem, Outlet, Permission, PriceOption, Printer as PrinterEntity, RestaurantTable, Role, Settings, SetupEntity, SetupKind, Steward, User } from './types';
import { Badge, Button, CheckField, Empty, Field, label, LoadError, Loading, Modal, number, PageHeader, Refresh, useAction, useLoad, useMoney, useWorkspace } from './ui';

import { ItemWorkbookActions, MenuMasterPage } from './MenuMasters';

type SettingsTab = 'business' | 'outlets' | 'groups' | 'categories' | 'items' | 'units' | 'taxes' | 'tables' | 'team' | 'stewards' | 'nc-departments';
const tabs: { id: SettingsTab; title: string; Icon: typeof Store }[] = [
  { id: 'outlets', title: 'Branches & outlets', Icon: Building2 },
  { id: 'tables', title: 'Tables', Icon: MapPin },
  { id: 'groups', title: 'Groups', Icon: LayoutGrid },
  { id: 'categories', title: 'Categories', Icon: ChefHat },
  { id: 'items', title: 'Items', Icon: UtensilsCrossed },
  { id: 'units', title: 'Units', Icon: Settings2 },
  { id: 'taxes', title: 'Taxes', Icon: FilePenLine },
  { id: 'stewards', title: 'Stewards', Icon: Users },
  { id: 'nc-departments', title: 'NC Departments', Icon: Building2 },
  { id: 'team', title: 'Branch logins & permissions', Icon: Users },
  { id: 'business', title: 'Business', Icon: Store },
];
const outletTabs: SettingsTab[] = ['tables', 'groups', 'categories', 'items', 'units', 'taxes', 'stewards', 'nc-departments'];
const roleDescriptions: Record<Role, string> = {
  OWNER: 'All permissions, all outlets, including owner account management.',
  MANAGER: 'Can run the selected outlets, including permitted settings and reports. Only the property owner manages branch logins.',
  CASHIER: 'Dashboard, orders, bills and printing in assigned outlets.',
  WAITER: 'Orders, table transfers and printing in assigned outlets.',
  KITCHEN: 'Kitchen ticket progression and printing in assigned outlets.',
  ACCOUNTANT: 'Dashboard, reports and printing in assigned outlets.',
};
export function SettingsPage({ onOutletChange }: { onOutletChange: (id: string) => void }) {
  const { outletId, can, session, refreshSession, navigate } = useWorkspace(); const format = useMoney(); const state = useLoad(api.settings, []); const [tab, setTab] = useState<SettingsTab>('outlets');
  const [edit, setEdit] = useState<{ kind: SetupKind; entity?: SetupEntity; categoryId?: string; groupId?: string } | null>(null); const [prices, setPrices] = useState(false);
  const [itemCategory, setItemCategory] = useState('');
  const [groupId, setGroupId] = useState('');
  const data = state.data;
  const selectedOutlet = data?.outlets.find(outlet => outlet.id === outletId); const scoped = <T extends { outlet_id: string },>(values: T[] = []) => values.filter(v => v.outlet_id === outletId);
  const groups = scoped(data?.groups);
  const selectedGroup = groups.find(group => group.id === groupId) ?? groups[0];
  const categories = scoped(data?.categories);
  const groupCategories = categories.filter(category => category.group_id === selectedGroup?.id);
  const items = scoped(data?.items);
  const selectedCategory = categories.find(category => category.id === itemCategory) ?? categories[0];
  const open = (kind: SetupKind, entity?: SetupEntity, categoryId?: string, groupId?: string) => setEdit({ kind, entity, categoryId, groupId });
  const configureOutlet = (id: string) => { onOutletChange(id); setItemCategory(''); setGroupId(''); setTab('tables'); };
  const editButton = (kind: SetupKind, entity: SetupEntity) => <button className="text-button" onClick={() => open(kind, entity)}><FilePenLine size={15} />Edit</button>;
  const saved = async () => { state.reload(); await refreshSession(); };
  const setupSaved = async (id?: string) => {
    await saved();
    if (!edit?.entity && id && edit?.kind === 'outlets') configureOutlet(id);
    if (!edit?.entity && id && edit?.kind === 'groups') { setGroupId(id); setTab('categories'); }
    if (!edit?.entity && id && edit?.kind === 'categories') { setItemCategory(id); setTab('items'); }
  };
  if (!can('SETTINGS') || !['OWNER', 'MANAGER'].includes(session.user.role)) return <Empty title="Settings are restricted" text="Only owners and managers can manage restaurant configuration." />;
  return <div className="page"><PageHeader title="Masters" description="Manage branches, outlets, tables, menus, and staff." actions={<Refresh onClick={state.reload} busy={state.loading} />} /><div className="settings-tabs tabs">{tabs.filter(t => t.id !== 'team' || can('USERS')).map(({ id, title, Icon }) => <button key={id} className={tab === id ? 'active' : ''} disabled={outletTabs.includes(id) && !outletId} onClick={() => setTab(id)}><Icon size={17} />{title}</button>)}</div>{state.error ? <LoadError error={state.error} retry={state.reload} /> : state.loading && !data ? <Loading /> : data && <>
    {outletTabs.includes(tab) && selectedOutlet && <section className="card masters-outlet">
      <Field label="Setup outlet"><select aria-label="Setup outlet" value={outletId}
        onChange={event => { onOutletChange(event.target.value); setItemCategory(''); }}>
        {data.outlets.map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name} · {data.branches.find(branch => branch.id === outlet.branch_id)?.name}</option>)}
      </select></Field>
      <p className="muted">{scoped(data.tables).length} tables · {categories.length} categories · {items.length} items</p>
    </section>}
    {tab === 'business' && <BusinessForm key={data.tenant.id} data={data} onSaved={saved} />}
    {tab === 'outlets' && <div className="settings-two-columns"><section className="card"><div className="section-heading"><div><h2>Branches</h2><p>Business locations</p></div>{session.user.role === 'OWNER' && <Button className="secondary" onClick={() => open('branches')}><Plus size={16} />Add branch</Button>}</div>{data.branches.length ? <div className="entity-list">{data.branches.map(branch => <div key={branch.id}><span className="entity-icon"><Building2 size={22} /></span><div><h3>{branch.name}</h3><p>{branch.address || 'No address provided'}</p></div><Badge>{data.outlets.filter(o => o.branch_id === branch.id).length} outlets</Badge>{session.user.role === 'OWNER' && editButton('branches', branch)}</div>)}</div> : <Empty title="No branches yet" text="Add a branch, then configure its outlets." />}</section><section className="card"><div className="section-heading"><div><h2>Service outlets</h2><p>Only accessible outlets are shown</p></div>{session.user.role === 'OWNER' && <Button onClick={() => open('outlets')} disabled={!data.branches.length}><Plus size={16} />Add outlet</Button>}</div>{data.outlets.map(outlet => <div className="outlet-setting" key={outlet.id}><div className="section-heading"><div><h3>{outlet.name}{outlet.id === outletId && <Badge>Current</Badge>}</h3><p>{data.branches.find(b => b.id === outlet.branch_id)?.name}</p></div><div className="heading-actions"><Button className="secondary" onClick={() => configureOutlet(outlet.id)}>Set up outlet</Button>{editButton('outlets', outlet)}</div></div><div className="permission-list">{outlet.service_modes?.map(m => <Badge key={m}>{label(m)}</Badge>)}</div><p className="small-text muted">{outlet.payment_methods?.map(label).join(' · ')}<br />{outlet.currency} · {outlet.timezone}</p></div>)}</section></div>}
    {tab === 'groups' && selectedOutlet && <section className="card">
      <div className="section-heading"><div><h2>Groups</h2><p>Groups for {selectedOutlet.name}</p></div>
        <Button onClick={() => open('groups')}><Plus size={16} />Add group</Button></div>
      {groups.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Group</th><th>Categories</th><th>Actions</th></tr></thead>
        <tbody>{groups.map((group: MenuGroup) => <tr key={group.id}>
          <td>{group.name}</td><td>{categories.filter(category => category.group_id === group.id).length}</td>
          <td><div className="heading-actions">
            <Button className="secondary" onClick={() => { setGroupId(group.id); setTab('categories'); }}>View categories</Button>
            {editButton('groups', group)}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <Empty title="No groups yet" text="Add a group before creating categories." />}
    </section>}
    {tab === 'categories' && selectedOutlet && <section className="card">
      <div className="section-heading"><div><h2>Categories</h2><p>Menu categories for {selectedOutlet.name}</p></div>
        <Button onClick={() => open('categories', undefined, undefined, selectedGroup?.id)} disabled={!selectedGroup}><Plus size={16} />Add category</Button></div>
      {groups.length > 0 && <Field label="Category group"><select aria-label="Category group" value={selectedGroup?.id || ''}
        onChange={event => setGroupId(event.target.value)}>
        {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></Field>}
      {groupCategories.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Category</th><th>Items</th><th>Actions</th></tr></thead>
        <tbody>{groupCategories.map(category => <tr key={category.id}>
          <td><strong>{category.name}</strong></td>
          <td>{items.filter(item => item.category_id === category.id).length}</td>
          <td><div className="heading-actions">
            <Button className="secondary" onClick={() => { setItemCategory(category.id); setTab('items'); }}>View items</Button>
            {editButton('categories', category)}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <Empty title="No categories yet" text="Create your first category before adding menu items." />}
    </section>}
    {tab === 'items' && selectedOutlet && <section className="card">
      <div className="section-heading"><div><h2>Items</h2><p>Menu for {selectedOutlet.name}</p></div>
        <div className="heading-actions">
          <Button className="secondary" onClick={() => setPrices(true)} disabled={!items.length}>Bulk prices</Button>
          <Button onClick={() => open('items', undefined, selectedCategory?.id)} disabled={!selectedCategory}><Plus size={16} />Add item</Button>
        </div>
      </div>
      <ItemWorkbookActions key={outletId} outletId={outletId} items={items} categories={categories} groups={groups}
        units={scoped(data.units)} taxes={scoped(data.taxes)} onSaved={saved} />
      {selectedCategory ? <>
        <Field label="Item category"><select aria-label="Item category" value={selectedCategory.id}
          onChange={event => setItemCategory(event.target.value)}>
          {groups.map(group => <optgroup key={group.id} label={group.name}>
            {categories.filter(category => category.group_id === group.id).map(category =>
              <option key={category.id} value={category.id}>{category.name}</option>)}
          </optgroup>)}
        </select></Field>
        {items.some(item => item.category_id === selectedCategory.id) ? <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Item</th><th>Price / tax</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{items.filter(item => item.category_id === selectedCategory.id).map(item => <tr key={item.id}>
            <td><strong><span className={item.vegetarian ? 'diet-mark' : 'diet-mark nonveg'}><i /></span> {item.name}</strong>
              <small>{item.variants?.length || 0} variants · {item.modifiers?.length || 0} extras</small></td>
            <td>{format(item.price)}<small>{number(item.tax_rate)}% tax</small></td>
            <td><Badge status={item.available ? 'AVAILABLE' : 'DISABLED'}>{item.available ? 'Available' : 'Hidden'}</Badge></td>
            <td>{editButton('items', item)}</td>
          </tr>)}</tbody>
        </table></div> : <Empty title="No items in this category" text="Add an item to make it available for this outlet’s menu." />}
      </> : <Empty title="Create a category first" text="Items belong to a category in the selected outlet."
        action={<Button onClick={() => setTab('categories')}>Go to categories</Button>} />}
    </section>}
    {(tab === 'units' || tab === 'taxes') && selectedOutlet && <MenuMasterPage key={outletId + tab}
      kind={tab} outletId={outletId} units={scoped(data.units)} taxes={scoped(data.taxes)} onSaved={saved} />}
    {tab === 'tables' && selectedOutlet && <section className="card"><div className="section-heading"><div><h2>Tables</h2><p>Tables for {selectedOutlet.name}</p></div><div className="heading-actions">{can('ORDER') && <Button className="secondary" onClick={() => navigate({ page: 'floor' })}>View tables</Button>}<Button onClick={() => open('tables')}><Plus size={16} />Add table</Button></div></div>{scoped(data.tables).length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Table name</th><th>Seats</th><th /></tr></thead><tbody>{scoped(data.tables).map(t => <tr key={t.id}><td><strong>{t.name}</strong></td><td>{t.seats}</td><td>{editButton('tables', t)}</td></tr>)}</tbody></table></div> : <Empty title="Give every guest a place" text="Create tables for the selected outlet." />}</section>}
    {tab === 'team' && <section className="card"><div className="section-heading"><div><h2>Branch logins</h2><p>Each login has a role, one branch and explicitly assigned outlets.</p></div>{session.user.role === 'OWNER' && <Button onClick={() => open('users')}><Plus size={16} />Create branch login</Button>}</div><div className="notice info"><ShieldCheck size={20} /><span>New accounts receive an initial password that you share securely. No invitation email is sent. Editing access can revoke active sessions.</span></div>{data.users.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Team member</th><th>Role</th><th>Outlet access</th><th>Allowed actions</th><th>Status</th><th /></tr></thead><tbody>{data.users.map(u => <tr key={u.id}><td><strong>{u.name}</strong><small>{u.email}</small></td><td><Badge>{label(u.role)}</Badge></td><td>{u.role === 'OWNER' ? 'All outlets' : (u.outlet_ids || []).map(id => data.outlets.find(o => o.id === id)?.name || 'Assigned outlet').join(', ') || 'No outlets assigned'}</td><td>{(u.permitted_actions ?? data.rolePermissions[u.role]).map(label).join(', ')}</td><td><Badge status={u.active === false ? 'DISABLED' : 'AVAILABLE'}>{u.active === false ? 'Inactive' : 'Active'}</Badge></td><td>{session.user.role === 'OWNER' ? editButton('users', u) : <span className="small-text muted">Owner only</span>}</td></tr>)}</tbody></table></div> : <Empty title="No team accounts available" text="Create a team member or verify your user-management permission." />}<div className="role-guide"><h3>Clear responsibilities</h3>{Object.entries(roleDescriptions).map(([role, description]) => <div key={role}><strong>{label(role)}</strong><p>{description}</p></div>)}</div></section>}
    {(tab === 'stewards' || tab === 'nc-departments') && selectedOutlet && <NamedOutletMaster key={outletId + tab}
      kind={tab} outletId={outletId} entries={scoped(tab === 'stewards' ? data.stewards : data.ncDepartments)} onSaved={saved} />}
    {prices && <OutletPriceDialog key={outletId} outletId={outletId} categories={scoped(data.categories)} items={scoped(data.items)} onClose={() => setPrices(false)} onSaved={saved} />}
    {edit && <SetupDialog key={`${edit.kind}-${edit.entity?.id || 'new'}`} kind={edit.kind} entity={edit.entity} categoryId={edit.categoryId} groupId={edit.groupId} data={data} onClose={() => setEdit(null)} onSaved={setupSaved} />}
  </>}</div>;
}
function NamedOutletMaster({ kind, outletId, entries, onSaved }: {
  kind: 'stewards' | 'nc-departments'; outletId: string; entries: Steward[]; onSaved: () => Promise<void>;
}) {
  const singular = kind === 'stewards' ? 'steward' : 'NC department';
  const [editing, setEditing] = useState<Steward | 'new' | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const action = useAction();
  const open = (steward: Steward | 'new') => {
    action.clear();
    setEditing(steward);
    setName(steward === 'new' ? '' : steward.name);
    setActive(steward === 'new' || steward.active);
  };
  return <section className="card">
    <div className="section-heading"><h2>{kind === 'stewards' ? 'Stewards' : 'NC Departments'}</h2><Button onClick={() => open('new')}><Plus size={16} />Add {singular}</Button></div>
    {entries.length ? <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{entries.map(steward => <tr key={steward.id}><td>{steward.name}</td>
        <td><Badge status={steward.active ? 'AVAILABLE' : 'DISABLED'}>{steward.active ? 'Active' : 'Inactive'}</Badge></td>
        <td><button className="text-button" onClick={() => open(steward)}>Edit</button></td></tr>)}</tbody>
    </table></div> : <p className="muted">{kind === 'stewards' ? 'Add the stewards who can be selected when opening a table.' : 'Add a department to select it when sending an NC KOT.'}</p>}
    {editing && <Modal title={(editing === 'new' ? 'Add ' : 'Edit ') + singular} onClose={() => setEditing(null)} noClose={action.busy}>
      <form onSubmit={event => {
        event.preventDefault();
        void action.run(async () => {
          await api.saveNamedMaster(kind, { outletId, name: name.trim(), active }, editing === 'new' ? undefined : editing.id);
          await onSaved();
          setEditing(null);
        });
      }}>
        <fieldset disabled={action.busy}>
          <Field label={kind === 'stewards' ? 'Steward name' : 'Department name'}><input name="name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required /></Field>
          <CheckField label="Active" checked={active} onChange={setActive} />
        </fieldset>
        {action.feedback}
        <div className="modal-actions"><Button type="submit" busy={action.busy} disabled={!name.trim()}>Save {singular}</Button></div>
      </form>
    </Modal>}
  </section>;
}
function BusinessForm({ data, onSaved }: { data: Settings; onSaved: () => Promise<void> }) {
  const t = data.tenant; const [form, setForm] = useState({ name: t.name, receiptAddress: t.receipt_address || '', taxNumber: t.tax_number || '', phone: t.phone || '', receiptFooter: t.receipt_footer || '' }); const action = useAction();
  const field = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));
  return <div className="business-grid"><section className="card"><div className="section-heading"><div><h2>Your restaurant identity</h2><p>These details appear on guest receipts.</p></div><Store size={22} className="muted" /></div><form onSubmit={e => { e.preventDefault(); void action.run(async () => { await api.business(form); await onSaved(); }, 'Business details saved.'); }}><fieldset disabled={action.blocked}><Field label="Business name"><input required value={form.name} onChange={e => field('name', e.target.value)} /></Field><Field label="Receipt address"><textarea value={form.receiptAddress} onChange={e => field('receiptAddress', e.target.value)} /></Field><div className="form-grid"><Field label="Tax registration number"><input value={form.taxNumber} onChange={e => field('taxNumber', e.target.value)} /></Field><Field label="Business phone"><input type="tel" value={form.phone} onChange={e => field('phone', e.target.value)} /></Field></div><Field label="Receipt footer"><textarea value={form.receiptFooter} onChange={e => field('receiptFooter', e.target.value)} placeholder="Thank you for dining with us." /></Field></fieldset>{action.feedback}<Button busy={action.busy} disabled={action.blocked}><Save size={17} />Save business details</Button></form></section><aside className="settings-aside"><span className="eyebrow">IT’S IN THE DETAILS</span><div className="mini-receipt"><Store size={28} /><h3>{form.name || 'Your restaurant'}</h3><p className="pre-line">{form.receiptAddress || 'Your receipt address'}</p>{form.taxNumber && <p>Tax ID: {form.taxNumber}</p>}<div className="receipt-rule" /><span>Receipt identity preview</span><div className="receipt-rule" /><p>{form.receiptFooter || 'Thank you for dining with us.'}</p></div><p className="small-text muted">This is a layout preview, not a financial receipt. Changes apply after saving.</p><div className="workspace-slug"><ShieldCheck size={18} /><div><strong>{t.slug}</strong><small>Your immutable workspace identifier</small></div></div></aside></div>;
}

type FormValues = Record<string, string | boolean>;
function initialValues(kind: SetupKind, entity?: SetupEntity): FormValues {
  const common: FormValues = { name: entity?.name || '' };
  if (kind === 'branches') return { ...common, address: (entity as Branch | undefined)?.address || '' };
  if (kind === 'outlets') { const e = entity as Outlet | undefined; return { ...common, branchId: e?.branch_id || '', serviceModes: e?.service_modes?.join(', ') || 'DINE_IN, TAKEAWAY, DELIVERY', paymentMethods: e?.payment_methods?.join(', ') || 'CASH, CARD, UPI', currency: e?.currency || 'INR', timezone: e?.timezone || 'Asia/Kolkata' }; }
  if (kind === 'categories') { const e = entity as Category | undefined; return { ...common, department: e?.department || 'Kitchen', groupId: e?.group_id || '', sortOrder: String(e?.sort_order ?? 0) }; }
  if (kind === 'items') { const e = entity as MenuItem | undefined; return { ...common, categoryId: e?.category_id || '', unitId: e?.unit_id || '', taxId: e?.tax_id || '', description: e?.description || '', price: String(e?.price ?? ''), taxRate: String(e?.tax_rate ?? 0), available: e?.available ?? true, vegetarian: e?.vegetarian ?? true }; }
  if (kind === 'tables') { const e = entity as RestaurantTable | undefined; return { ...common, section: e?.section || 'Tables', seats: String(e?.seats ?? 2) }; }
  if (kind === 'users') { const e = entity as User | undefined; return { ...common, email: e?.email || '', password: '', role: e?.role || 'WAITER', active: e?.active ?? true }; }
  const e = entity as PrinterEntity | undefined; return { ...common, deviceKey: e?.device_key || '', documentType: e?.document_type || 'KOT', paperWidth: String(e?.paper_width ?? 80), copies: String(e?.copies ?? 1), enabled: e?.enabled ?? true, isFallback: e?.is_fallback ?? false, isReceipt: e?.is_receipt ?? false, template: e?.template || 'STANDARD' };
}
function SetupDialog({ kind, entity, categoryId, groupId, data, onClose, onSaved }: { kind: SetupKind; entity?: SetupEntity; categoryId?: string; groupId?: string; data: Settings; onClose: () => void; onSaved: (id?: string) => Promise<void> }) {
  const { outletId } = useWorkspace(); const [form, setForm] = useState<FormValues>(() => ({ ...initialValues(kind, entity), ...(!entity ? { ...(categoryId ? { categoryId } : {}), ...(groupId ? { groupId } : {}) } : {}) })); const [access, setAccess] = useState<string[]>(kind === 'users' && entity ? (entity as User).outlet_ids || [] : outletId ? [outletId] : []); const [variants, setVariants] = useState<PriceOption[]>(kind === 'items' && entity ? (entity as MenuItem).variants || [] : []); const [modifiers, setModifiers] = useState<PriceOption[]>(kind === 'items' && entity ? (entity as MenuItem).modifiers || [] : []); const action = useAction(onClose);
  const str = (key: string) => String(form[key] ?? ''); const bool = (key: string) => form[key] === true; const set = (key: string, value: string | boolean) => setForm(f => ({ ...f, [key]: value }));
  const configuredUser = kind === 'users' ? entity as User | undefined : undefined;
  const [branchId, setBranchId] = useState(() => {
    const assignments = configuredUser?.outlet_ids ?? (outletId ? [outletId] : []);
    const branches = new Set(data.outlets.filter(row => assignments.includes(row.id)).map(row => row.branch_id));
    return branches.size === 1 ? [...branches][0] : '';
  });
  const [permissions, setPermissions] = useState<Permission[] | null>(configuredUser?.permitted_actions ?? null);
  const role = str('role') as Role;
  const rolePermissions = data.rolePermissions[role] || [];
  const assignedOutlets = data.outlets.filter(row => row.branch_id === branchId);
  const tax = data.taxes.find(entry => entry.outlet_id === outletId && entry.id === str('taxId'));
  const csv = (key: string) => [...new Set(str(key).split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
  const text = (key: string, title: string, options: { type?: string; required?: boolean; hint?: string; min?: number; max?: number; step?: string; minLength?: number; pattern?: string } = {}) => <Field label={title} hint={options.hint}><input value={str(key)} onChange={e => set(key, e.target.value)} type={options.type || 'text'} required={options.required ?? true} min={options.min} max={options.max} step={options.step} minLength={options.minLength} pattern={options.pattern} autoComplete={options.type === 'password' ? 'new-password' : undefined} /></Field>;
  const select = (key: string, title: string, options: { id: string; name: string }[]) => <Field label={title}><select required value={str(key)} onChange={e => set(key, e.target.value)}><option value="">Select {title.toLowerCase()}</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>;
  const toggle = (key: string, title: string) => <CheckField label={title} checked={bool(key)} onChange={v => set(key, v)} />;
  const save = async () => {
    const name = str('name').trim(); if (!name) throw new Error('A name is required.');
    let savedId: string | undefined;
    switch (kind) {
      case 'branches': await api.saveSetup('branches', { name, address: str('address') }, entity?.id); break;
      case 'outlets': {
        if (!csv('serviceModes').length || !csv('paymentMethods').length) throw new Error('At least one service mode and payment method are required.');
        try { new Intl.DateTimeFormat('en', { timeZone: str('timezone') }); } catch { throw new Error('Enter a valid IANA timezone, such as Asia/Kolkata.'); }
        savedId = (await api.saveSetup('outlets', { name, branchId: str('branchId'), serviceModes: csv('serviceModes'), paymentMethods: csv('paymentMethods'), currency: str('currency').toUpperCase(), timezone: str('timezone') }, entity?.id)).id; break;
      }
      case 'groups':
        savedId = (await api.saveSetup('groups', { name, outletId }, entity?.id)).id; break;
      case 'categories': savedId = (await api.saveSetup('categories', { name, outletId, groupId: str('groupId'), department: str('department'), sortOrder: Number(str('sortOrder')) }, entity?.id)).id; break;
      case 'items': {
        for (const [title, options] of [['Variants', variants], ['Modifiers', modifiers]] as const) { if (options.some(o => !o.name.trim() || !Number.isFinite(number(o.price)) || number(o.price) < 0)) throw new Error(`${title} require a name and non-negative price.`); if (new Set(options.map(o => o.name.trim().toLowerCase())).size !== options.length) throw new Error(`${title} names must be unique.`); }
        await api.saveSetup('items', { name, outletId, categoryId: str('categoryId'), description: str('description'), price: Number(str('price')), taxRate: str('taxId') ? 0 : Number(str('taxRate')), unitId: str('unitId') || null, taxId: str('taxId') || null, available: bool('available'), vegetarian: bool('vegetarian'), variants: variants.map(v => ({ name: v.name.trim(), price: number(v.price) })), modifiers: modifiers.map(v => ({ name: v.name.trim(), price: number(v.price) })) }, entity?.id); break;
      }
      case 'tables': await api.saveSetup('tables', { name, outletId, section: str('section'), seats: Number(str('seats')) }, entity?.id); break;
      case 'users':
        if (role !== 'OWNER' && (!branchId || !access.length || access.some(id => !assignedOutlets.some(outlet => outlet.id === id)))) {
          throw new Error('Choose a branch and at least one outlet in that branch.');
        }
        if (permissions?.length === 0) throw new Error('Choose at least one allowed action for this login.');
        await api.saveSetup('users', { name, email: str('email'), role, outletIds: role === 'OWNER' ? (configuredUser?.outlet_ids || []) : access,
          ...(permissions && role !== 'OWNER' ? { permissions } : {}),
          ...(entity ? { active: bool('active') } : { password: str('password') }) }, entity?.id);
        break;
      case 'printers': await api.saveSetup('printers', { name, outletId, deviceKey: str('deviceKey'), documentType: str('documentType'), paperWidth: Number(str('paperWidth')), copies: Number(str('copies')), enabled: bool('enabled'), isFallback: bool('isFallback'), isReceipt: bool('isReceipt'), template: str('template') }, entity?.id); break;
    }
    await onSaved(savedId); onClose();
  };
  const singular: Record<SetupKind, string> = { branches: 'branch', outlets: 'outlet', groups: 'group', categories: 'category', items: 'menu item', tables: 'table', users: 'branch login', printers: 'printer' };
  return <Modal title={`${entity ? 'Edit' : 'Add'} ${singular[kind]}`} subtitle={['groups', 'categories', 'items', 'tables', 'printers'].includes(kind) ? 'Saved in the currently selected outlet. Relationships are verified by the server.' : 'Set up the details your restaurant runs on.'} onClose={onClose} wide={['items', 'users', 'printers', 'outlets'].includes(kind)} noClose={action.busy}><form onSubmit={e => { e.preventDefault(); void action.run(save); }}><fieldset disabled={action.blocked}>{text('name', kind === 'users' ? 'Full name' : 'Name')}
    {kind === 'branches' && <Field label="Address"><textarea value={str('address')} onChange={e => set('address', e.target.value)} /></Field>}
    {kind === 'outlets' && <>{select('branchId', 'Branch', data.branches)}<div className="form-grid">{text('serviceModes', 'Enabled service modes', { hint: 'Comma-separated: DINE_IN, TAKEAWAY, DELIVERY, ROOM_SERVICE' })}{text('paymentMethods', 'Accepted payment methods', { hint: 'Comma-separated: CASH, CARD, UPI. External methods are manual confirmations.' })}{text('currency', 'Currency code', { pattern: '[A-Za-z]{3}', hint: 'ISO currency code, for example INR' })}{text('timezone', 'Outlet timezone', { hint: 'IANA timezone, for example Asia/Kolkata' })}</div></>}
    {kind === 'categories' && <div className="form-grid">{select('groupId', 'Group', data.groups.filter(group => group.outlet_id === outletId))}{text('sortOrder', 'Display position', { type: 'number', min: 0, step: '1' })}</div>}
    {kind === 'items' && <>{select('categoryId', 'Category', data.categories.filter(c => c.outlet_id === outletId))}<Field label="Description"><textarea value={str('description')} onChange={e => set('description', e.target.value)} /></Field><div className="form-grid">{text('price', 'Base price', { type: 'number', min: 0, step: '0.01' })}<Field label="Unit"><select aria-label="Unit" value={str('unitId')} onChange={event => set('unitId', event.target.value)}>
      <option value="">No unit</option>{data.units.filter(unit => unit.outlet_id === outletId).map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
    </select></Field>
    <Field label="Tax master"><select aria-label="Tax master" value={str('taxId')} onChange={event => set('taxId', event.target.value)}>
      <option value="">Enter a custom rate</option>{data.taxes.filter(entry => entry.outlet_id === outletId).map(entry => <option key={entry.id} value={entry.id}>{entry.name} ({entry.rate}%)</option>)}
    </select></Field>
    {tax ? <Field label="Tax rate (%)"><input readOnly value={tax.rate} /></Field>
      : text('taxRate', 'Tax rate (%)', { type: 'number', min: 0, max: 100, step: '0.01' })}</div><div className="form-grid">{toggle('available', 'Available for ordering')}{toggle('vegetarian', 'Vegetarian')}</div><PriceOptions title="Variants" hint="Absolute prices that replace the base price, e.g. Regular / Large." value={variants} onChange={setVariants} /><PriceOptions title="Modifiers" hint="Additive prices for extras, e.g. Extra cheese." value={modifiers} onChange={setModifiers} /></>}
    {kind === 'tables' && <div className="form-grid">{text('seats', 'Seats', { type: 'number', min: 1, max: 100, step: '1' })}</div>}
    {kind === 'users' && <>{text('email', 'Email address', { type: 'email' })}{!entity && text('password', 'Initial password', { type: 'password', minLength: 12, hint: 'At least 12 characters. Share securely; no invitation email is sent.' })}<Field label="Role"><select aria-label="Role" value={role} onChange={event => { set('role', event.target.value); setPermissions(null); }}>
      {(Object.keys(roleDescriptions) as Role[]).filter(value => value !== 'OWNER' || configuredUser?.role === 'OWNER').map(value =>
        <option key={value} value={value}>{label(value)}</option>)}
    </select></Field>
    <p className="notice info">{roleDescriptions[role]}</p>
    {role !== 'OWNER' && <>
      <Field label="Branch"><select aria-label="Branch" required value={branchId} onChange={event => { setBranchId(event.target.value); setAccess([]); }}>
        <option value="">Select a branch</option>{data.branches.map(branch => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
      </select></Field>
      <h3>Assigned outlets</h3>
      {branchId && !assignedOutlets.length && <p className="small-text muted">This branch has no outlets yet. Create an outlet for it first.</p>}
      <div className="outlet-checkboxes">{assignedOutlets.map(outlet => <CheckField key={outlet.id} label={outlet.name}
        checked={access.includes(outlet.id)} onChange={checked => setAccess(ids => checked ? [...ids, outlet.id] : ids.filter(id => id !== outlet.id))} />)}</div>
      <h3>What this user can do</h3>
      <CheckField label="Customize this login’s permissions" checked={permissions !== null}
        onChange={checked => setPermissions(checked ? [...rolePermissions] : null)} />
      <div className="outlet-checkboxes">{rolePermissions.map(permission => <CheckField key={permission}
        label={permission === 'USERS' ? 'View branch users' : label(permission)} disabled={permissions === null}
        checked={(permissions ?? rolePermissions).includes(permission)} onChange={checked =>
          setPermissions(current => checked ? [...(current ?? []), permission] : (current ?? []).filter(value => value !== permission))} />)}</div>
    </>}{entity && toggle('active', 'Account is active')}</>}
    {kind === 'printers' && <><div className="form-grid">{text('deviceKey', 'Local device alias', { pattern: '[A-Za-z0-9_-]+', hint: 'A local alias such as kitchen or receipt. No host address or executable.' })}{select('documentType', 'Document type', [{ id: 'KOT', name: 'KOT printer' }, { id: 'BILL', name: 'Receipts' }, { id: 'BOTH', name: 'KOT and bill printer' }])}{select('paperWidth', 'Paper width', [{ id: '58', name: '58 mm' }, { id: '80', name: '80 mm' }])}{text('copies', 'Copies per job', { type: 'number', min: 1, max: 5, step: '1' })}</div>{text('template', 'Receipt / ticket template', { hint: 'Template identifier used by your local print agent, e.g. STANDARD.' })}<div className="form-grid">{toggle('enabled', 'Printer is enabled')}{toggle('isFallback', 'KOT fallback for unmapped categories')}{toggle('isReceipt', 'Print bills on this printer')}</div><div className="notice warning">An enabled receipt printer is required to settle a bill. Configuration alone does not connect or test a physical device; use the Print queue to queue a test.</div></>}
  </fieldset>{action.feedback}<div className="modal-actions"><Button type="button" className="subtle" onClick={onClose} disabled={action.busy}>Back</Button><Button busy={action.busy} disabled={action.blocked}><Save size={16} />{entity ? 'Save changes' : `Create ${singular[kind]}`}</Button></div></form></Modal>;
}
function OutletPriceDialog({ outletId, categories, items, onClose, onSaved }: {
  outletId: string; categories: Category[]; items: MenuItem[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [category, setCategory] = useState('');
  const [mode, setMode] = useState('amount');
  const [value, setValue] = useState('');
  const format = useMoney();
  const { outlet } = useWorkspace();
  const action = useAction(onClose);
  const adjustment = Number(value);
  const selected = items.filter(item => item.category_id === category);
  const changes = selected.map(item => {
    const original = Math.round(number(item.price) * 100);
    const next = mode === 'amount' ? original + Math.round(adjustment * 100)
      : Math.round(original * (1 + adjustment / 100));
    return { itemId: item.id, name: item.name, expectedPrice: original / 100, price: next / 100 };
  });
  const valid = !!value && Number.isFinite(adjustment) && adjustment !== 0 && changes.length > 0 &&
    changes.length <= 200 && changes.every(row => row.price >= 0 && row.price <= 9999999999.99) &&
    changes.some(row => row.price !== row.expectedPrice);
  return <Modal title="Bulk outlet prices" subtitle={outlet?.name} onClose={onClose} wide noClose={action.busy}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!valid) return;
      void action.run(async () => {
        await api.outletPrices({ outletId, changes: changes.map(({ itemId, expectedPrice, price }) => ({ itemId, expectedPrice, price })) });
        await onSaved();
        onClose();
      });
    }}>
      <fieldset disabled={action.blocked}>
        <div className="form-grid">
          <Field label="Category"><select value={category} onChange={event => setCategory(event.target.value)} required>
            <option value="">Choose a category</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></Field>
          <Field label="Adjustment type"><select value={mode} onChange={event => setMode(event.target.value)}>
            <option value="amount">Fixed amount (INR)</option><option value="percent">Percentage</option>
          </select></Field>
          <Field label="Adjustment" hint="Enter a negative value to reduce base prices. Variants and modifiers keep their prices.">
            <input type="number" step="0.01" value={value} onChange={event => setValue(event.target.value)} required />
          </Field>
        </div>
        {category && !changes.length && <p role="status">This category has no items in this outlet.</p>}
        {changes.length > 200 && <p className="notice error">A bulk change supports up to 200 items per category.</p>}
        {!!value && changes.some(row => row.price < 0 || row.price > 9999999999.99) && <p className="notice error">Choose an adjustment that keeps all prices within the supported range.</p>}
        {!!changes.length && <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Item</th><th>Current price</th><th>New price</th></tr></thead>
          <tbody>{changes.slice(0, 200).map(row => <tr key={row.itemId}><td>{row.name}</td><td>{format(row.expectedPrice)}</td><td>{format(row.price)}</td></tr>)}</tbody>
        </table></div>}
      </fieldset>
      {action.feedback}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" busy={action.busy} disabled={!valid || action.blocked}>Apply prices</Button>
      </div>
    </form>
  </Modal>;
}

function PriceOptions({ title, hint, value, onChange }: { title: string; hint: string; value: PriceOption[]; onChange: (value: PriceOption[]) => void }) {
  return <div className="price-options"><div className="section-heading"><div><h3>{title}</h3><p>{hint}</p></div><button type="button" className="text-button" onClick={() => onChange([...value, { name: '', price: 0 }])}><Plus size={15} />Add</button></div>{value.map((option, i) => <div className="price-option-row" key={i}><Field label={`${title.slice(0, -1)} name`}><input required value={option.name} onChange={e => onChange(value.map((v, n) => n === i ? { ...v, name: e.target.value } : v))} /></Field><Field label="Price"><input type="number" required min={0} step="0.01" value={option.price} onChange={e => onChange(value.map((v, n) => n === i ? { ...v, price: e.target.value } : v))} /></Field><button type="button" className="icon-button" aria-label={`Remove ${title.toLowerCase()} row ${i + 1}`} onClick={() => onChange(value.filter((_, n) => n !== i))}><Trash2 size={17} /></button></div>)}{!value.length && <p className="small-text muted">No {title.toLowerCase()} configured.</p>}</div>;
}
