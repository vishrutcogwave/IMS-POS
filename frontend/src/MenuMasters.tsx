import { useState } from 'react';
import { api, ApiError } from './api';
import { MasterDelete } from './MasterDelete';
import { exportMenuWorkbook, readMenuWorkbook } from './menuWorkbook';
import type { Category, MenuGroup, MenuImportPreview, MenuImportRow, MenuItem, MenuTax, MenuUnit } from './types';
import { Button, Empty, Field, Modal, number, useAction } from './ui';

type MasterKind = 'units' | 'taxes';
export function MenuMasterPage({ kind, outletId, units, taxes, onSaved }: {
  kind: MasterKind; outletId: string; units: MenuUnit[]; taxes: MenuTax[]; onSaved: () => Promise<void>;
}) {
  const [edit, setEdit] = useState<MenuUnit | MenuTax | 'new'>();
  const action = useAction(() => setEdit(undefined));
  const rows = kind === 'units' ? units : taxes;
  const noun = kind === 'units' ? 'unit' : 'tax';
  const fieldError = (key: string) => action.error instanceof ApiError ? action.error.fieldErrors[key] : undefined;
  return <section className="card">
    <div className="section-heading"><h2>{kind === 'units' ? 'Unit master' : 'Tax master'}</h2>
      <Button onClick={() => { action.clear(); setEdit('new'); }}>Add {noun}</Button></div>
    {rows.length ? <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Name</th>{kind === 'taxes' && <th>Rate</th>}<th>Actions</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td>{'rate' in row && <td>{String(row.rate)}%</td>}
        <td><div className="heading-actions"><Button className="secondary" onClick={() => { action.clear(); setEdit(row); }}>Edit</Button><MasterDelete kind={kind} id={row.id} outletId={outletId} name={row.name} onDeleted={onSaved} /></div></td></tr>)}</tbody>
    </table></div> : <Empty title={kind === 'units' ? 'No units yet' : 'No taxes yet'} text="Add a record to use it when creating or importing items." />}
    {edit && <Modal title={(edit === 'new' ? 'Add ' : 'Edit ') + noun} onClose={() => setEdit(undefined)} noClose={action.busy}>
      <form onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void action.run(async () => {
          await api.saveMenuMaster(kind, {
            outletId, name: String(form.get('name')).trim(),
            ...(kind === 'taxes' ? { rate: Number(form.get('rate')) } : {}),
          }, edit === 'new' ? undefined : edit.id);
          await onSaved();
          setEdit(undefined);
        });
      }}>
        <Field label="Name" error={fieldError('name')}><input name="name" maxLength={80} required defaultValue={edit === 'new' ? '' : edit.name} /></Field>
        {kind === 'taxes' && <Field label="Tax rate (%)" error={fieldError('rate')}>
          <input name="rate" type="number" min={0} max={100} step="0.01" required defaultValue={edit !== 'new' && 'rate' in edit ? number(edit.rate) : undefined} />
        </Field>}
        {action.feedback}
        <Button busy={action.busy}>Save {noun}</Button>
      </form>
    </Modal>}
  </section>;
}

export function ItemWorkbookActions({ outletId, items, categories, units, taxes, groups, onSaved }: {
  outletId: string; items: MenuItem[]; categories: Category[]; units: MenuUnit[]; taxes: MenuTax[]; groups: MenuGroup[];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<MenuImportPreview>();
  const [rows, setRows] = useState<MenuImportRow[]>([]);
  const [revalidate, setRevalidate] = useState(false);
  const action = useAction();
  return <>
    <div className="toolbar item-workbook-tools">
      <div className="heading-actions">
        <Button className="secondary" busy={action.busy} disabled={!items.length} onClick={() =>
          void action.run(() => exportMenuWorkbook(items, categories, units, taxes, groups, 'outlet-items-' + outletId))}>Export items</Button>
        <Button className="secondary" onClick={() => { setOpen(true); setFile(undefined); setPreview(undefined); setRevalidate(false); action.clear(); }}>Import items</Button>
      </div>
      {!open && action.feedback}
    </div>
    {open && <Modal title="Import outlet items" onClose={() => setOpen(false)} wide noClose={action.busy}>
      <p>This workbook can add items and create missing groups, categories, units and tax records for this outlet. Outlets and tables are set up separately.</p>
      <div className="toolbar"><Button className="secondary" disabled={action.busy} onClick={() =>
        void action.run(() => exportMenuWorkbook([], [], [], [], [], 'pos-item-import-template'))}>Download template</Button></div>
      <Field label="Item workbook" hint=".xlsx, up to 200 items and 2 MB.">
        <input type="file" accept=".xlsx" disabled={action.busy} onChange={event => {
          setFile(event.target.files?.[0]); setPreview(undefined); setRows([]); setRevalidate(false); action.clear();
        }} />
      </Field>
      <Button className="secondary" busy={action.busy} disabled={!file} onClick={() => {
        if (!file) return;
        setPreview(undefined);
        void action.run(async () => {
          const parsed = await readMenuWorkbook(file);
          setPreview(await api.previewMenuImport(outletId, parsed));
          setRows(parsed);
          setRevalidate(false);
        });
      }}>Validate &amp; preview</Button>
      {preview && <>
        <div className="section-divider" />
        <h3>Import preview</h3>
        <p>{preview.items} items · {preview.groups.length} new groups · {preview.categories.length} new categories · {preview.units.length} new units · {preview.taxes.length} new taxes</p>
        {!!preview.groups.length && <p>Groups: {preview.groups.join(', ')}</p>}{!!preview.categories.length && <p>Categories: {preview.categories.join(', ')}</p>}
        {!!preview.units.length && <p>Units: {preview.units.join(', ')}</p>}
        {!!preview.taxes.length && <p>Taxes: {preview.taxes.join(', ')}</p>}
        {!!preview.issues.length && <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Row</th><th>Field</th><th>What to fix</th></tr></thead>
          <tbody>{preview.issues.map((issue, index) => <tr key={index}><td>{issue.row}</td><td>{issue.field}</td><td>{issue.message}</td></tr>)}</tbody>
        </table></div>}
        <div className="modal-actions"><Button busy={action.busy} disabled={revalidate || !!preview.issues.length} onClick={() => {
          void action.run(async () => {
            try {
              const result = await api.confirmMenuImport(outletId, rows);
              await onSaved();
              setPreview(undefined);
              setFile(undefined);
              setOpen(false);
              return result;
            } catch (error) {
              setRevalidate(true);
              throw error;
            }
          }, 'Items imported successfully.');
        }}>Confirm import</Button></div>
      </>}
      {action.feedback}
    </Modal>}
  </>;
}
