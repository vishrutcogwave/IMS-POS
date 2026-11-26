import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from './api';
import type { ID } from './types';
import { Button, Modal, useAction } from './ui';

export function MasterDelete({ kind, id, outletId, name, onDeleted }: {
  kind: string; id: ID; outletId: ID; name: string; onDeleted: () => Promise<void>;
}) {
  const action = useAction();
  const [open, setOpen] = useState(false);
  return <>
    <button className="text-button" aria-label={`Delete ${name}`} onClick={() => { action.clear(); setOpen(true); }}>Delete</button>
    {open && <Modal title={`Delete ${name}?`} subtitle="This cannot be undone. Records used by orders or other master data are protected." onClose={() => setOpen(false)} noClose={action.busy}>
      {action.feedback}
      <div className="modal-actions">
        <Button type="button" className="secondary" onClick={() => setOpen(false)} disabled={action.busy}>Cancel</Button>
        <Button type="button" className="danger" busy={action.busy} onClick={() => void action.run(async () => {
          await api.deleteMaster(kind, id, outletId);
          await onDeleted();
          setOpen(false);
        })}><Trash2 size={15} />Delete</Button>
      </div>
    </Modal>}
  </>;
}
