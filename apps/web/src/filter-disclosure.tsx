import { useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

export function FilterDisclosure({ id, initiallyOpen = false, summary, children }: { id: string; initiallyOpen?: boolean; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <><div className="filter-toolbar"><button className="secondary-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><SlidersHorizontal size={16} aria-hidden="true"/>{open ? 'Hide filters' : 'Show filters'}<ChevronDown size={16} aria-hidden="true" className={open ? 'expanded-chevron' : ''}/></button><span className="account-note">{summary}</span></div><div id={id} hidden={!open}>{children}</div></>;
}
