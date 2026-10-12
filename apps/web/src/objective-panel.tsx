import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ObjectiveDetails } from './objectives';

export function ObjectivePanel({ id, onSelect, onClose, restoreFocus }: { id: string | null; onSelect: (id: string) => void; onClose: () => void; restoreFocus: () => void }) {
  return <Dialog.Root open={Boolean(id)} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="objective-panel-overlay"/><Dialog.Content className="objective-panel" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}><div className="objective-panel-header"><div><Dialog.Title>Objective details</Dialog.Title><Dialog.Description>Review this objective and update the work you manage.</Dialog.Description></div><Dialog.Close className="secondary-button panel-close" aria-label="Close objective details"><X size={20} aria-hidden="true"/></Dialog.Close></div><div className="objective-panel-body">{id && <><Link className="text-link panel-page-link" to={`/objectives/${id}`}><ArrowUpRight size={16} aria-hidden="true"/>Open full objective page</Link><ObjectiveDetails key={id} id={id} inPanel onOpenObjective={onSelect}/></>}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
