import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Modal, ValidationIssues } from './ui';
import { platformRequest } from './Platform';

export type Property = { id: string; name: string; slug: string };
type Account = { id: string; username: string; name: string; role: string; active: boolean };
type Entry = { id: string; action: string; restaurant: string | null; operator_email: string; reason: string; changed_at: string };
type Details = { name: string; address: string; phone: string; tax_number: string; branch_count: number; outlet_count: number; user_count: number };
type Contact = { email: string; phone: string };

function useData<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try { await task(); }
    catch (failure) { setError(failure instanceof Error ? failure : new Error('Request failed.')); }
    finally { setBusy(false); }
  }
  return { value, setValue, error, busy, run };
}

function Feedback({ error, busy }: { error?: Error; busy: boolean }) {
  return error ? <div className="notice error" role="alert"><div><p>{error.message}</p><ValidationIssues error={error} /></div></div> : busy ? <p role="status">Loading…</p> : null;
}

export function PropertyPicker({ properties, value, onChange, all = false }: {
  properties: Property[]; value: string; onChange: (value: string) => void; all?: boolean;
}) {
  return <Field label="Property"><select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{all ? 'All properties' : 'Select a property'}</option>
    {properties.map(property => <option key={property.id} value={property.id}>{property.name} ({property.slug})</option>)}
  </select></Field>;
}

export function Accounts({ properties, token }: { properties: Property[]; token: string }) {
  const [property, setProperty] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<Account>();
  const [operation, setOperation] = useState('username');
  const [temporary, setTemporary] = useState('');
  const [history, setHistory] = useState<Entry[]>();
  const data = useData<Account[]>([]);
  const path = '/tenants/' + property + '/accounts';
  const load = async (id: string) => {
    data.setValue([]);
    if (id) data.setValue(await platformRequest<Account[]>('/tenants/' + id + '/accounts', token));
  };
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    const values = new FormData(event.currentTarget);
    const change = operation === 'username' ? { username: values.get('username') }
      : operation === 'reset' ? { resetPassword: true } : { active: !target.active };
    void data.run(async () => {
      const result = await platformRequest<{ temporaryPassword?: string }>(path + '/' + target.id, token, 'PUT', {
        ...change, reason: values.get('reason'),
      });
      setTemporary(result.temporaryPassword || '');
      setTarget(undefined);
      await load(property);
    });
  }
  const rows = data.value.filter(row => (row.name + ' ' + row.username).toLowerCase().includes(search.toLowerCase()));
  return <section className="card">
    <div className="platform-filters">
      <PropertyPicker properties={properties} value={property} onChange={id => { setProperty(id); void data.run(() => load(id)); }} />
      <Field label="Search accounts"><input value={search} onChange={event => setSearch(event.target.value)} /></Field>
    </div>
    <Feedback {...data} />
    <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.username}</td><td>{row.role}</td>
        <td><span className={'badge ' + (row.active ? 'available' : 'disabled')}>{row.active ? 'Active' : 'Disabled'}</span></td>
        <td className="platform-row-actions">
          <Button className="secondary" disabled={data.busy} onClick={() => { setOperation('username'); setTarget(row); }}>Manage</Button>
          <Button className="subtle" disabled={data.busy} onClick={() => void data.run(async () => {
            setHistory(await platformRequest<Entry[]>('/audit?tenant=' + property + '&subject=' + row.id, token));
          })}>History</Button>
        </td></tr>)}</tbody>
    </table></div>
    {!rows.length && !data.busy && <p className="platform-empty">{property ? 'No matching accounts.' : 'Select a property to view its accounts.'}</p>}
    {target && <Modal title="Manage login account" subtitle={target.username} onClose={() => setTarget(undefined)} noClose={data.busy}>
      <form onSubmit={save}>
        <Field label="Action"><select value={operation} onChange={event => setOperation(event.target.value)}>
          <option value="username">Change username</option><option value="reset">Reset password</option>
          <option value="status">{target.active ? 'Disable' : 'Enable'} account</option>
        </select></Field>
        {operation === 'username' && <Field label="Username"><input name="username" type="email" defaultValue={target.username} required /></Field>}
        <Field label="Reason"><textarea name="reason" required maxLength={500} /></Field>
        {data.error && <Feedback error={data.error} busy={false} />}
        <Button busy={data.busy}>Save account change</Button>
      </form>
    </Modal>}
    {history && <Modal title="Credential history" onClose={() => setHistory(undefined)} wide><AuditTable entries={history} /></Modal>}
    {temporary && <Modal title="Temporary password" onClose={() => setTemporary('')}>
      <p>Share this password securely with the account holder. It appears only here.</p>
      <Field label="Temporary password"><input value={temporary} readOnly onFocus={event => event.target.select()} /></Field>
      <Button onClick={() => setTemporary('')}>Done</Button>
    </Modal>}
  </section>;
}

function AuditTable({ entries }: { entries: Entry[] }) {
  return <><div className="table-scroll"><table className="data-table">
    <thead><tr><th>Time</th><th>Property</th><th>Operator</th><th>Action</th><th>Reason</th></tr></thead>
    <tbody>{entries.map(entry => <tr key={entry.id}><td>{new Date(entry.changed_at).toLocaleString()}</td>
      <td>{entry.restaurant || 'Platform'}</td><td>{entry.operator_email}</td><td>{entry.action.replaceAll('_', ' ')}</td><td>{entry.reason}</td>
    </tr>)}</tbody></table></div>{!entries.length && <p className="platform-empty">No matching events.</p>}</>;
}

export function Audit({ properties, token }: { properties: Property[]; token: string }) {
  const [property, setProperty] = useState('');
  const [search, setSearch] = useState('');
  const data = useData<Entry[]>([]);
  useEffect(() => {
    void data.run(async () => data.setValue(await platformRequest<Entry[]>('/audit' + (property ? '?tenant=' + property : ''), token)));
  }, [token, property]);
  const entries = data.value.filter(entry => [entry.action, entry.operator_email, entry.reason].join(' ').toLowerCase().includes(search.toLowerCase()));
  function download() {
    const quote = (cell: string) => '"' + (/^[\s]*[=+\-@]/.test(cell) ? "'" : '') + cell.replaceAll('"', '""') + '"';
    const csv = [['Time', 'Property', 'Operator', 'Action', 'Reason'], ...entries.map(entry =>
      [entry.changed_at, entry.restaurant || 'Platform', entry.operator_email, entry.action, entry.reason])]
      .map(row => row.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'platform-audit.csv';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="card">
    <div className="platform-filters">
      <PropertyPicker properties={properties} value={property} onChange={setProperty} all />
      <Field label="Search action, operator or reason"><input value={search} onChange={event => setSearch(event.target.value)} /></Field>
      <Button className="secondary" disabled={!entries.length || data.busy} onClick={download}>Export CSV</Button>
    </div>
    <Feedback {...data} /><AuditTable entries={entries} />
  </section>;
}

export function PropertyDetails({ property, token, onClose, onSaved }: {
  property: Property; token: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const data = useData<Details | null>(null);
  const path = '/tenants/' + property.id + '/profile';
  useEffect(() => { void data.run(async () => data.setValue(await platformRequest<Details>(path, token))); }, [token, path]);
  return <Modal title="Property details" subtitle={property.slug} onClose={onClose} noClose={data.busy} wide>
    <Feedback {...data} />{data.value && <form onSubmit={event => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      void data.run(async () => { await platformRequest(path, token, 'PUT', fields); await onSaved(); onClose(); });
    }}>
      <p className="platform-counts">{data.value.branch_count} branches · {data.value.outlet_count} outlets · {data.value.user_count} accounts</p>
      <div className="form-grid">
        <Field label="Name"><input name="name" defaultValue={data.value.name} required maxLength={160} /></Field>
        <Field label="Phone"><input name="phone" type="tel" defaultValue={data.value.phone} maxLength={40} /></Field>
        <Field label="Tax number"><input name="taxNumber" defaultValue={data.value.tax_number} maxLength={80} /></Field>
      </div>
      <Field label="Receipt address"><textarea name="address" defaultValue={data.value.address} maxLength={500} /></Field>
      <Button busy={data.busy}>Save property details</Button>
    </form>}
  </Modal>;
}

export function PlatformContact({ token, onClose }: { token: string; onClose: () => void }) {
  const data = useData<Contact | null>(null);
  useEffect(() => { void data.run(async () => data.setValue(await platformRequest<Contact>('/contact', token))); }, [token]);
  return <Modal title="Platform contact" onClose={onClose} noClose={data.busy}>
    <Feedback {...data} />{data.value && <form onSubmit={event => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      void data.run(async () => { await platformRequest('/contact', token, 'PUT', fields); onClose(); });
    }}>
      <Field label="Support email"><input name="email" type="email" defaultValue={data.value.email} required /></Field>
      <Field label="Support phone"><input name="phone" type="tel" defaultValue={data.value.phone} required /></Field>
      <Button busy={data.busy}>Save contact</Button>
    </form>}
  </Modal>;
}
