import { useEffect, useState, type FormEvent } from 'react';
import { ClipboardList, LogOut, Store, UserRoundCog } from 'lucide-react';
import { Button, Field, ValidationIssues } from './ui';
import { ApiError } from './api';
import { Brand } from './Brand';
import { Accounts, Audit, PlatformContact, PropertyDetails, type Property } from './PlatformOperations';

type Subscription = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED';
  expires_at: string | null;
  starts_on: string | null;
  max_branches: number | null;
  max_users: number | null;
  is_demo: boolean;
  access_status: string;
};
type History = { id: number; operator_email: string; changed_at: string; reason: string; new_value: Pick<Subscription, 'plan' | 'status'> };

export async function platformRequest<T>(path: string, token = '', method = 'GET', body?: object): Promise<T> {
  const response = await fetch('/api/platform' + path, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.message || 'The platform request failed.', response.status, error.code, error.requestId, error.fieldErrors);
  }
  return response.json() as Promise<T>;
}

export default function Platform({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [restaurants, setRestaurants] = useState<Subscription[]>([]);
  const [selected, setSelected] = useState<Subscription>();
  const [history, setHistory] = useState<History[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState<'stores' | 'accounts' | 'audit'>('stores');
  const [details, setDetails] = useState<Property>();
  const [contact, setContact] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [samplesOnly, setSamplesOnly] = useState(false);
  const [tablePage, setTablePage] = useState(0);
  const refresh = async () => setRestaurants(await platformRequest<Subscription[]>('/tenants', token));

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setMessage('');
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure : new Error('Try again.')); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    void run(refresh);
  }, [token]);

  function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const payload = { ...fields, slug: String(fields.slug).trim().toLowerCase(),
      maxBranches: Number(fields.maxBranches), maxUsers: Number(fields.maxUsers) };
    void run(async () => {
      await platformRequest('/tenants', token, 'POST', payload);
      setRestaurants(await platformRequest<Subscription[]>('/tenants', token));
      setCreating(false);
      setMessage('Restaurant created.');
    });
  }

  function show(restaurant: Subscription) {
    setSelected(restaurant);
    setHistory([]);
    void run(async () => setHistory(await platformRequest<History[]>('/tenants/' + restaurant.id + '/history', token)));
  }

  function save(event: FormEvent<HTMLFormElement>, restaurant: Subscription) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiry = String(form.get('expiry') || '');
    const path = '/tenants/' + restaurant.id;
    void run(async () => {
      await platformRequest(path, token, 'PUT', {
        plan: form.get('plan'),
        status: form.get('status'),
        startsOn: form.get('start') || null,
        maxBranches: form.get('maxBranches') ? Number(form.get('maxBranches')) : null,
        maxUsers: form.get('maxUsers') ? Number(form.get('maxUsers')) : null,
        expiresAt: expiry ? new Date(expiry + 'T' + String(form.get('time')) + ':00Z').toISOString() : null,
        reason: form.get('reason'),
      });
      const updated = await platformRequest<Subscription[]>('/tenants', token);
      setRestaurants(updated);
      setSelected(updated.find(item => item.id === restaurant.id));
      setHistory(await platformRequest<History[]>(path + '/history', token));
      setMessage('Subscription saved.');
    });
  }

  const visible = restaurants.filter(row => (!samplesOnly || row.is_demo) && (!statusFilter || row.access_status === statusFilter) &&
    (row.name + ' ' + row.slug).toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / 10));
  const currentPage = Math.min(tablePage, pages - 1);
  const tabs = [
    { id: 'stores', label: 'Stores', icon: Store },
    { id: 'accounts', label: 'Store Accounts', icon: UserRoundCog },
    { id: 'audit', label: 'Audit Log', icon: ClipboardList },
  ] as const;

  return <div className="platform-shell">
    <aside className="platform-sidebar">
      <div className="platform-brand"><Brand /></div>
      <nav aria-label="Platform administration">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={page === id ? 'active' : ''}
          aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setError(undefined); setMessage(''); }}>
          <Icon size={19} />{label}
        </button>)}
      </nav>
      <Button className="subtle platform-signout" disabled={busy} onClick={() => void run(async () => {
        try { await platformRequest('/logout', token, 'POST', {}); }
        finally { onSignOut(); }
      })}><LogOut size={17} />Sign out</Button>
    </aside>
    <main className="page platform-page">
      <header className="page-heading">
        <div><div className="eyebrow">Platform administration</div><h1>{tabs.find(tab => tab.id === page)?.label}</h1></div>
        {page === 'stores' && <Button className="secondary" onClick={() => setContact(true)}>Platform contact</Button>}
      </header>
    {error && <div className="notice error" role="alert"><div><p>{error.message}</p><ValidationIssues error={error} /></div></div>}
    {message && <p className="notice success" role="status">{message}</p>}
    {page === 'accounts' && <Accounts properties={restaurants} token={token} />}
    {page === 'audit' && <Audit properties={restaurants} token={token} />}
    {contact && <PlatformContact token={token} onClose={() => setContact(false)} />}
    {details && <PropertyDetails property={details} token={token} onClose={() => setDetails(undefined)} onSaved={refresh} />}
    {page === 'stores' && <>
      <div className="platform-metrics">
        <div className="card"><span>Registered stores</span><strong>{restaurants.length}</strong></div>
        <div className="card"><span>Active stores</span><strong>{restaurants.filter(row => row.access_status === 'ACTIVE').length}</strong></div>
        <div className="card"><span>Trials</span><strong>{restaurants.filter(row => row.access_status === 'TRIAL').length}</strong></div>
        <div className="card"><span>Expired or suspended</span><strong>{restaurants.filter(row => ['EXPIRED', 'SUSPENDED'].includes(row.access_status)).length}</strong></div>
      </div>
      <section className="card">
        <div className="section-heading"><h2>Restaurants</h2>
          <Button className="secondary" disabled={busy} onClick={() => setCreating(!creating)}>
            {creating ? 'Close form' : 'Add restaurant'}
          </Button>
        </div>
        {creating && <form onSubmit={provision}>
          <div className="form-grid">
            <Field label="Restaurant name" error={error instanceof ApiError ? error.fieldErrors.businessName : undefined}><input name="businessName" required maxLength={160} /></Field>
            <Field label="Property ID" hint="Use 3–64 letters, numbers or hyphens. Start and end with a letter or number." error={error instanceof ApiError ? error.fieldErrors.slug : undefined}><input name="slug" required minLength={3} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9\-]{1,62}[a-zA-Z0-9]" title="Use 3–64 letters, numbers or hyphens, starting and ending with a letter or number." /></Field>
            <Field label="Owner name" error={error instanceof ApiError ? error.fieldErrors.name : undefined}><input name="name" required maxLength={120} /></Field>
            <Field label="Owner email" error={error instanceof ApiError ? error.fieldErrors.email : undefined}><input name="email" type="email" required /></Field>
            <Field label="Initial owner password" error={error instanceof ApiError ? error.fieldErrors.password : undefined}><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></Field>
            <Field label="Allowed branches" hint="Includes the main branch." error={error instanceof ApiError ? error.fieldErrors.maxBranches : undefined}>
              <input name="maxBranches" type="number" min={1} max={1000} step={1} required />
            </Field>
            <Field label="Allowed users" hint="Includes the owner and other login accounts." error={error instanceof ApiError ? error.fieldErrors.maxUsers : undefined}>
              <input name="maxUsers" type="number" min={1} max={10000} step={1} required />
            </Field>
          </div>
          <Button busy={busy}>Create restaurant</Button>
          <div className="section-divider" />
        </form>}
        <div className="platform-filters">
          <label className="check-field"><input type="checkbox" checked={samplesOnly}
            onChange={event => { setSamplesOnly(event.target.checked); setTablePage(0); }} /> Sample restaurants only</label>
          <Field label="Search restaurants"><input value={query} onChange={event => { setQuery(event.target.value); setTablePage(0); }} /></Field>
          <Field label="Filter by status"><select value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setTablePage(0); }}>
            <option value="">All statuses</option>{['ACTIVE', 'TRIAL', 'SCHEDULED', 'EXPIRED', 'SUSPENDED'].map(status => <option key={status}>{status}</option>)}
          </select></Field>
        </div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Restaurant</th><th>Plan</th><th>Access</th><th>Limits</th><th>Expires</th><th>Action</th></tr></thead>
          <tbody>{visible.slice(currentPage * 10, (currentPage + 1) * 10).map(row => <tr key={row.id}>
            <td><strong>{row.name}</strong><small>{row.slug}{row.is_demo ? ' · Sample' : ''}</small></td><td>{row.plan}</td>
            <td>{row.access_status}</td><td>Branches: {row.max_branches ?? 'Unlimited'}<br />Users: {row.max_users ?? 'Unlimited'}</td><td>{row.expires_at ? new Date(row.expires_at).toLocaleString() : 'No expiry'}</td>
            <td className="platform-row-actions"><Button className="secondary" disabled={busy} onClick={() => show(row)}>Subscription</Button><Button className="subtle" disabled={busy} onClick={() => setDetails(row)}>Details</Button></td>
          </tr>)}</tbody>
        </table></div>
        {pages > 1 && <div className="pagination">
          <span>Page {currentPage + 1} of {pages}</span><div>
            <Button className="secondary" disabled={!currentPage} onClick={() => setTablePage(currentPage - 1)}>Previous</Button>
            <Button className="secondary" disabled={currentPage + 1 >= pages} onClick={() => setTablePage(currentPage + 1)}>Next</Button>
          </div>
        </div>}
        {!visible.length && <p className="muted">No restaurants found.</p>}
      </section>
      {selected && <section className="card platform-editor">
        <h2>{selected.name}</h2>
        <form key={JSON.stringify(selected) + history[0]?.id} onSubmit={event => save(event, selected)}>
          <div className="form-grid">
            <Field label="Plan"><input name="plan" defaultValue={selected.plan} required maxLength={80} /></Field>
            <Field label="Status"><select name="status" defaultValue={selected.status}>
              <option value="ACTIVE">Active</option><option value="TRIAL">Trial</option><option value="SUSPENDED">Suspended</option>
            </select></Field>
            <Field label="Start date (UTC)"><input name="start" type="date" defaultValue={selected.starts_on || ''} /></Field>
            <Field label="Branch limit"><input name="maxBranches" type="number" min={1} max={1000} defaultValue={selected.max_branches ?? ''} placeholder="Unlimited" /></Field>
            <Field label="User limit"><input name="maxUsers" type="number" min={1} max={10000} defaultValue={selected.max_users ?? ''} placeholder="Unlimited" /></Field>
            <Field label="Expiry date (UTC)"><input name="expiry" type="date" defaultValue={selected.expires_at?.slice(0, 10)} /></Field>
            <Field label="Expiry time (UTC)"><input name="time" type="time" defaultValue={selected.expires_at?.slice(11, 16) || '23:59'} required /></Field>
          </div>
          <Field label="Reason for change"><textarea name="reason" required maxLength={500} /></Field>
          <Button busy={busy}>Save subscription</Button>
        </form>
        <div className="section-divider" />
        <h2>Change history</h2>
        {history.length ? <ul>{history.map(entry => <li key={entry.id}>
          <strong>{entry.new_value.plan} / {entry.new_value.status}</strong> {entry.reason}
          <p className="muted">{entry.operator_email} · {new Date(entry.changed_at).toLocaleString()}</p>
        </li>)}</ul> : <p className="muted">No changes recorded.</p>}
      </section>}
    </>}
    </main>
  </div>;
}
