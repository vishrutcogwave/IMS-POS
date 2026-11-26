import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from './api';
import type { ID } from './types';
import { Button, Modal, useAction } from './ui';

export function StructureDelete({ kind, id, name, onDeleted }: {
  kind: 'branches' | 'outlets'; id: ID; name: string; onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const action = useAction();
  const noun = kind === 'branches' ? 'branch' : 'outlet';
  const condition = kind === 'branches'
    ? 'Branches can be deleted only after their outlets, billing counters, and printer pairings are removed.'
    : 'This removes the outlet and its menu, tables, printers, and staff access. Outlets with order, bill, kitchen, or print history are protected.';
  return <>
    <button className="text-button" aria-label={`Delete ${name}`} onClick={() => { action.clear(); setOpen(true); }}>Delete</button>
    {open && <Modal title={`Delete ${noun} “${name}”?`} subtitle={condition} onClose={() => setOpen(false)} noClose={action.busy}>
      {action.feedback}
      <div className="modal-actions">
        <Button type="button" className="secondary" disabled={action.busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="button" className="danger" busy={action.busy} onClick={() => void action.run(async () => {
          await api.deleteStructure(kind, id);
          await onDeleted();
          setOpen(false);
        })}><Trash2 size={15} />Delete {noun}</Button>
      </div>
    </Modal>}
  </>;
}
