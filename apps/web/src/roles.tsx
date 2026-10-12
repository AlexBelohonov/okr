import { roles, type Role } from '@okr/shared';

export const roleDescriptions: Record<Role, string> = {
  owner: 'Full organization access, including changing owner roles and transferring ownership.',
  admin: 'Manages settings, members, invitations, teams, planning periods and all objectives.',
  manager: 'Member access, plus creating company objectives and managing designated teams and their objectives.',
  member: 'Creates personal objectives and objectives for their teams. Edits or updates work according to assignments.',
  viewer: 'Reads organization content and follows objectives. Cannot edit content.'
};

export function RoleDescription({ role, id }: { role: string; id?: string }) {
  const description = roleDescriptions[role as Role];
  return description ? <p id={id} className="role-description">{description}</p> : null;
}

export function RoleGuide() {
  return <details className="role-guide"><summary>What do the roles mean?</summary><dl>{roles.map(role => <div key={role}><dt>{role[0].toUpperCase() + role.slice(1)}</dt><dd>{roleDescriptions[role]}</dd></div>)}</dl></details>;
}
