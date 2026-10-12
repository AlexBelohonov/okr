import type { CSSProperties } from 'react';
import type { Objective } from './objectives';

const healthLabels = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
export function ObjectiveHealthIcon({ health }: { health: Objective['health'] }) {
  return <span className={`objective-health-icon ${health}`} role="img" aria-label={healthLabels[health]} title={healthLabels[health]}><span className="objective-health-dot" aria-hidden="true"/></span>;
}
export function objectiveCardStatus(objective: Pick<Objective, 'state' | 'progress'>) {
  return objective.state === 'active' && objective.progress >= 100 ? 'Achieved' : objective.state[0].toUpperCase() + objective.state.slice(1);
}
export function teamCardStyle(teamId: string | null): CSSProperties | undefined {
  if (!teamId) return undefined;
  // A generated color stays the same across cards, filters, reloads and team renames.
  let hash = 2166136261;
  for (const char of teamId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return { '--team-hue': ((hash >>> 0) / 4294967296 * 360).toFixed(3) } as CSSProperties;
}
