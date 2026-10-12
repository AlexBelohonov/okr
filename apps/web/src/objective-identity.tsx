import { Building2, UserRound, Users } from 'lucide-react';
import type { Objective } from './objectives';

export function ObjectiveScope({ objective }: { objective: Objective }) {
  const ScopeIcon = objective.scope === 'team' ? Users : objective.scope === 'company' ? Building2 : UserRound;
  const label = objective.scope === 'team' ? `Team objective: ${objective.team?.name || 'Unassigned'}` : `${objective.scope === 'company' ? 'Company' : 'Personal'} objective`;
  return <span className="objective-scope-icon" role="img" aria-label={label} title={label}><ScopeIcon size={16} aria-hidden="true"/></span>;
}

export function ObjectiveIdentity({ objective, compact = false }: { objective: Objective; compact?: boolean }) {
  const name = objective.lead.user.name;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
  if (compact) return <div className="objective-identity compact-identity"><div className="objective-lead" title={`Lead: ${name}`}><span className="lead-avatar" aria-hidden="true">{initials || <UserRound size={15}/>}</span><span>Lead: {name}</span></div><ObjectiveScope objective={objective}/></div>;
  const ScopeIcon = objective.scope === 'team' ? Users : objective.scope === 'company' ? Building2 : UserRound;
  return <div className="objective-identity"><div className="objective-lead"><span className="lead-avatar" aria-hidden="true">{initials || <UserRound size={15}/>}</span><span>Lead: {name}</span></div><div className="objective-scope"><ScopeIcon size={15} aria-hidden="true"/><span>{objective.scope === 'team' ? `Team: ${objective.team?.name || 'Unassigned'}` : `${objective.scope === 'company' ? 'Company' : 'Personal'} objective`}</span></div></div>;
}
