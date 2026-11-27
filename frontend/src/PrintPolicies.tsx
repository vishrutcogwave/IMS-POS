import { useEffect, useState } from 'react';
import { Printer, Save } from 'lucide-react';
import { api } from './api';
import type { Branch, Outlet, PrintPolicy } from './types';
import { Button, CheckField, Field, useAction } from './ui';

const defaults = (branch_id: string): PrintPolicy => ({ branch_id, kot_on_send: true, nc_kot_on_send: true,
  bill_before_payment: true, receipt_after_settlement: true });

export function PrintPoliciesPage({ branches, outlets, initialBranchId, policies, onSaved }: {
  branches: Branch[]; outlets: Outlet[]; initialBranchId?: string; policies: PrintPolicy[]; onSaved: () => Promise<void>;
}) {
  const [branchId, setBranchId] = useState(initialBranchId || branches[0]?.id || '');
  const branch = branches.find(value => value.id === branchId) || branches[0];
  const branchOutlets = outlets.filter(outlet => outlet.branch_id === branch?.id);
  const savedPolicy = policies.find(value => value.branch_id === branch?.id);
  const [policy, setPolicy] = useState<PrintPolicy>(() => savedPolicy || defaults(branch?.id || ''));
  const action = useAction();
  useEffect(() => setPolicy(savedPolicy || defaults(branch?.id || '')), [branch?.id, savedPolicy]);
  const set = (key: keyof Omit<PrintPolicy, 'branch_id'>, value: boolean) => setPolicy(current => ({ ...current, [key]: value }));
  if (!branch) return <section className="card"><p>Add a branch before configuring print rules.</p></section>;
  return <section className="card">
    <div className="section-heading"><div><h2>Branch-wide automatic print rules</h2><p>Each rule applies to every outlet in this branch. One shared policy controls KOTs, bill previews, and receipts.</p></div><Printer size={22} /></div>
    <Field label="Branch"><select aria-label="Print rules branch" value={branch.id} onChange={event => setBranchId(event.target.value)}>
      {branches.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
    </select></Field>
    <p className="small-text muted">Applies to: {branchOutlets.length ? branchOutlets.map(outlet => outlet.name).join(', ') : 'No outlets in this branch yet'}</p>
    <div className="outlet-checkboxes">
      <CheckField label="Print regular KOT when sent to kitchen" checked={policy.kot_on_send} onChange={value => set('kot_on_send', value)} />
      <CheckField label="Print NC KOT when sent" checked={policy.nc_kot_on_send} onChange={value => set('nc_kot_on_send', value)} />
      <CheckField label="Print bill before payment" checked={policy.bill_before_payment} onChange={value => set('bill_before_payment', value)} />
      <CheckField label="Print receipt after settlement" checked={policy.receipt_after_settlement} onChange={value => set('receipt_after_settlement', value)} />
    </div>
    <div className="notice info"><span>Staff reprint rights, print queue access, printer tests and retries are controlled separately under Masters → Branch logins &amp; permissions. Turning automatic printing off does not disable an authorized manual print.</span></div>
    {action.feedback}
    <div className="modal-actions"><Button busy={action.busy} disabled={action.blocked} onClick={() => void action.run(async () => {
      const { branch_id, ...values } = policy;
      const saved = await api.savePrintPolicy(branch_id, values);
      setPolicy(saved);
      await onSaved();
    }, 'Branch-wide print rules saved for every outlet in this branch.') }><Save size={16} />Save branch print rules</Button></div>
  </section>;
}
