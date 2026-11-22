import { useState } from 'react';
import type { Category } from './types';
import { api } from './api';
import { configureBackgroundPrinting, localBackgroundStatus, posBridgeStatus, pcPrinting, storageKey, type Connection, type NamedPrinter } from './pcPrinting';
import { Button, Field, LoadError, PageHeader, Refresh, useAction, useLoad, useWorkspace } from './ui';

function validIp(ip: string) {
  if (!ip) return true;
  if (ip.includes(':')) {
    try { return new URL('http://[' + ip + ']').hostname.startsWith('['); }
    catch { return false; }
  }
  const segments = ip.split('.');
  return segments.length === 4 && segments.every(segment => /^\d{1,3}$/.test(segment) && Number(segment) <= 255);
}

const empty = { key: '', pcId: '', printers: [], bills: [], categories: {} };
export function PrintUtilityPage() {
  const { outletId, outlet, can, session } = useWorkspace();
  const canViewCategories = (['ORDER', 'BILL', 'KITCHEN', 'PRINT'] as const).some(permission =>
    can(permission));
  const categories = useLoad(async () => {
    if (!outletId || !canViewCategories) return [];
    return (await api.catalog(outletId)).categories;
  }, [outletId, canViewCategories]);
  return <div className="page">
    <PageHeader title="Utility Settings" description="Connect the print bridge on this Windows PC and assign its KOT and bill printers."
      actions={canViewCategories && outletId ? <Refresh onClick={categories.reload} busy={categories.loading} /> : undefined} />
    {categories.error && <LoadError error={categories.error} retry={categories.reload} />}
    <PcPrintSetup branchId={outlet?.branch_id} canPair={session.user.role === 'OWNER' && can('SETTINGS')} categories={categories.data?.filter(category => category.outlet_id === outletId) ?? []} />
  </div>;
}
export function PcPrintSetup({ categories, branchId, canPair }: { categories: Category[]; branchId?: string; canPair: boolean }) {
  const [config, setConfig] = useState<Connection>(() => pcPrinting() ?? empty);
  const [installed, setInstalled] = useState<NamedPrinter[]>([]);
  const [defaultPrinter, setDefaultPrinter] = useState<string | null>(null);
  const [backgroundPaired, setBackgroundPaired] = useState(() => !!pcPrinting()?.backgroundPaired);
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const action = useAction();
  async function save(next: Connection, sync = true) {
    if (!next.pcId) throw new Error('Check the POS bridge first.');
    if (sync && backgroundPaired) await configureBackgroundPrinting(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    localStorage.removeItem('hearth-print-pc');
    setConfig(next);
  }
  async function connect() {
    const key = config.key.trim();
    const status = await posBridgeStatus(key);
    setInstalled(status.printers.map(name => ({ name, ip: '' })));
    setDefaultPrinter(status.defaultPrinter);
    const pcId = pcPrinting()?.pcId || [...crypto.getRandomValues(new Uint8Array(16))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    await save({ ...config, key, pcId }, false);
    setBackgroundPaired((await localBackgroundStatus(key).catch(() => ({ paired: false }))).paired);
  }
  async function add() {
    if (!validIp(ip.trim())) throw new Error('Enter a valid IP address or leave the field blank.');
    const enteredName = name.trim();
    if (!enteredName) throw new Error('Enter the Windows printer name.');
    const matches = (printer: NamedPrinter) => printer.name.toLowerCase() === enteredName.toLowerCase();
    const existing = config.printers.find(matches) ?? installed.find(matches);
    const added = { name: existing?.name ?? enteredName, ip: ip.trim() };
    await save({ ...config, printers: [...config.printers.filter(printer => !matches(printer)), added] });
    setName('');
    setIp('');
  }
  async function pairBranch() {
    if (!branchId || !config.pcId) throw new Error('Select an outlet and check the bridge first.');
    const { code } = await api.createPrintPairing(branchId);
    await configureBackgroundPrinting(config, code);
    setBackgroundPaired(true);
  }

  return <section className="card utility-agent">
    <h2>Windows printing on this PC</h2><p>Assign installed Windows printers to KOT categories and bills. Blank assignments use the Windows default.</p>
    <Field label="Bridge key"><input type="password" autoComplete="off" value={config.key}
      onChange={event => setConfig({ ...config, key: event.target.value, pcId: '' })} /></Field>
    <Button type="button" className="secondary" disabled={!config.key.trim()} busy={action.busy}
      onClick={() => void action.run(connect, 'POS bridge connected.')}>Check POS bridge</Button>
    {action.feedback}
        {!!config.pcId && <>
      {canPair && branchId && <Button type="button" className="secondary" busy={action.busy}
        onClick={() => void action.run(pairBranch, 'This PC will now print branch jobs in the background.')}>
        {backgroundPaired ? 'Pair this PC to the selected branch' : 'Set this PC as branch print PC'}
      </Button>}
      {backgroundPaired && <p>Background printing is configured on this PC.</p>}
      {defaultPrinter && <p>Windows default printer: {defaultPrinter}</p>}
      <form onSubmit={event => { event.preventDefault(); void action.run(async () => add(), 'Printer saved on this PC.'); }}>
        <div className="form-grid">
          <Field label="Windows printer name" hint="Enter the queue name shown in Windows printer settings."><input list="windows-printer-names" value={name} onChange={event => setName(event.target.value)} maxLength={255} required />
            <datalist id="windows-printer-names">{installed.map(printer => <option key={printer.name} value={printer.name} />)}</datalist></Field>
          <Field label="IP address (optional)" hint="Saved for future mobile printing."><input value={ip} onChange={event => setIp(event.target.value)} /></Field>
        </div>
        <Button type="submit" disabled={!name.trim()} busy={action.busy}>Add printer</Button>
      </form>
      {!!config.printers.length && <ul>{config.printers.map(printer => <li key={printer.name}>
        {printer.name}{printer.ip && ' · ' + printer.ip}
        {' '}<button type="button" className="text-button" onClick={() => void action.run(() => save({ ...config,
          printers: config.printers.filter(entry => entry.name !== printer.name),
          bills: config.bills.filter(entry => entry !== printer.name),
          categories: Object.fromEntries(Object.entries(config.categories).filter(([, entry]) => entry !== printer.name)),
        }))}>Remove</button>
      </li>)}</ul>}
      <KotCategoryAssignments categories={categories} config={config}
        onSave={assignments => save({ ...config, categories: assignments })} />
      <fieldset><legend>Bill printers</legend>
        {!config.bills.length && <p>Uses the Windows default printer.</p>}
        {config.printers.map(printer => <label className="check-field" key={printer.name}>
          <input type="checkbox" checked={config.bills.includes(printer.name)} onChange={event => void action.run(() => save({ ...config,
            bills: event.target.checked ? [...config.bills, printer.name] : config.bills.filter(entry => entry !== printer.name),
          }))} /> {printer.name}
        </label>)}
      </fieldset>
    </>}
  </section>;
}

function KotCategoryAssignments({ categories, config, onSave }: {
  categories: Category[];
  config: Connection;
  onSave: (assignments: Connection['categories']) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [printer, setPrinter] = useState('');
  const [page, setPage] = useState(0);
  const action = useAction();
  const filtered = categories.filter(category =>
    (!assignedOnly || !!config.categories[category.id]) &&
    category.name.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.ceil(filtered.length / 10);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visible = filtered.slice(currentPage * 10, (currentPage + 1) * 10);
  const available = new Set(categories.map(category => category.id));
  const selection = new Set(selected.filter(id => available.has(id)));
  const allVisibleSelected = visible.length > 0 && visible.every(category => selection.has(category.id));
  const selectedPrinter = config.printers.some(entry => entry.name === printer) ? printer : '';

  async function apply() {
    const assignments = { ...config.categories };
    for (const id of selection) {
      if (selectedPrinter) assignments[id] = selectedPrinter;
      else delete assignments[id];
    }
    await onSave(assignments);
    setSelected([]);
  }

  if (!categories.length) return null;
  return <fieldset className="kot-category-assignments" disabled={action.busy}>
    <legend>KOT category printer assignments</legend>
    <div className="kot-category-filters">
      <Field label="Search categories">
        <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      </Field>
    </div>
    <label className="check-field">
      <input type="checkbox" checked={assignedOnly}
        onChange={event => { setAssignedOnly(event.target.checked); setPage(0); }} />
      Show saved assignments only
    </label>
    {visible.length ? <div className="table-scroll"><table className="data-table">
      <thead><tr>
        <th scope="col"><input type="checkbox" aria-label="Select all categories on this page" checked={allVisibleSelected}
          onChange={event => {
            const ids = visible.map(category => category.id);
            setSelected(current => event.target.checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)));
          }} /></th>
        <th scope="col">Category</th><th scope="col">Assigned printer</th><th scope="col">Actions</th>
      </tr></thead>
      <tbody>{visible.map(category => <tr key={category.id}>
        <td><input type="checkbox" aria-label={'Select ' + category.name} checked={selection.has(category.id)}
          onChange={event => setSelected(current => event.target.checked
            ? [...current, category.id] : current.filter(id => id !== category.id))} /></td>
        <td>{category.name}</td>
        <td>{config.categories[category.id] || 'Windows default'}</td>
        <td>{config.categories[category.id] && <button type="button" className="text-button danger-text"
          aria-label={'Remove printer assignment for ' + category.name}
          onClick={() => void action.run(async () => {
            const assignments = { ...config.categories };
            delete assignments[category.id];
            await onSave(assignments);
            setSelected(current => current.filter(id => id !== category.id));
          }, category.name + ' now uses the Windows default printer.')}>Remove assignment</button>}</td>
      </tr>)}</tbody>
    </table></div> : <p>{assignedOnly && !query.trim() ? 'No saved category printer assignments.' : 'No categories match your search.'}</p>}
    {pageCount > 1 && <div className="pagination">
      <span>Page {currentPage + 1} of {pageCount}</span>
      <div>
        <Button type="button" className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Button type="button" className="secondary" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
      </div>
    </div>}
    <div className="kot-category-toolbar">
      <Field label="Printer for selected categories">
        <select value={selectedPrinter} onChange={event => setPrinter(event.target.value)}>
          <option value="">Windows default</option>
          {config.printers.map(entry => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
        </select>
      </Field>
      <Button type="button" disabled={!selection.size}
        onClick={() => void action.run(async () => apply(), 'Category printer assignments saved.')}>Apply to selected</Button>
      {selection.size > 0 && <Button type="button" className="subtle" onClick={() => setSelected([])}>Clear selection</Button>}
      <span role="status">{selection.size} selected</span>
    </div>
    {action.feedback}
  </fieldset>;
}