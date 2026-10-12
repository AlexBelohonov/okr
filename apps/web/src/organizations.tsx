import { createContext, useContext, useId, useState, type ReactNode, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus, RefreshCw, Save, UserPlus } from 'lucide-react';
import { roles, type Role } from '@okr/shared';
import { useAccount } from './accounts';
import { apiRequest, RequestError } from './api';
import { RoleDescription, RoleGuide } from './roles';
import { Link } from 'react-router-dom';
import { useUrlFilters } from './filters';
import { FilterDisclosure } from './filter-disclosure';
import { teamCardStyle } from './objective-visuals';
import { SlackPanel } from './slack';

interface Org { id: string; name: string; timezone: string; version: number }
interface Membership { id: string; role: Role; version: number }
export interface Member extends Membership { active: boolean; userId: string; user: { id: string; name: string; email: string; active: boolean; verified: boolean } }
interface Team { id: string; name: string; version: number; members: { membershipId: string; manager: boolean; membership: Member }[] }
interface Invitation { id: string; email: string; role: string; expiresAt: string; usedAt: string | null }
interface Audit { id: string; text: string; type: string; createdAt: string; user: { name: string } }
interface PageData<T> { items: T[]; total: number; page: number; limit: number }
interface OrganizationContextValue {
  orgId: string; select: (id: string) => void; selected: ReturnType<typeof useAccount>['account']['memberships'][number] | undefined;
  send: <T = { message: string }>(path: string, payload: unknown, method?: string) => Promise<T>; reload: () => Promise<void>;
}
const OrganizationContext = createContext<OrganizationContextValue | null>(null);
export function useOrganization() { const value = useContext(OrganizationContext); if (!value) throw new Error('Missing organization provider'); return value; }
export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { account, refresh } = useAccount(); const cache = useQueryClient();
  const storageKey = `okr.organization.${account.user!.id}`;
  const [chosen, setChosen] = useState(() => { try { return sessionStorage.getItem(storageKey) || ''; } catch { return ''; } });
  const selected = account.memberships.find(m => m.org.id === chosen) ?? account.memberships[0]; const orgId = selected?.org.id || '';
  const select = (id: string) => { setChosen(id); try { sessionStorage.setItem(storageKey, id); } catch { /* Selection still works without browser storage. */ } };
  const reload = async () => { await Promise.all([refresh(), cache.invalidateQueries({ queryKey: ['organization', account.user!.id, orgId] })]); };
  const send = async <T,>(path: string, payload: unknown, method = 'POST'): Promise<T> => {
    try { return await apiRequest<T>(path ? `orgs/${orgId}/${path}` : `orgs/${orgId}`, method, payload, account.csrf); }
    catch (e) { if (e instanceof RequestError && [401, 403, 404].includes(e.status)) await refresh(); throw e; }
  };
  return <OrganizationContext.Provider value={{ orgId, selected, select, send, reload }}>{children}</OrganizationContext.Provider>;
}
export function useOrgQuery<T>(path: string, refetchInterval?: number) {
  const { account, refresh } = useAccount(); const { orgId } = useOrganization();
  return useQuery({ queryKey: ['organization', account.user!.id, orgId, path], queryFn: async ({ signal }) => {
    try { return await apiRequest<T>(path ? `orgs/${orgId}/${path}` : `orgs/${orgId}`, 'GET', undefined, undefined, signal); }
    catch (e) { if (e instanceof RequestError && [401, 404].includes(e.status)) await refresh(); throw e; }
  }, enabled: Boolean(orgId), retry: false, refetchInterval });
}
export function useAction() {
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const run = async (work: () => Promise<string | void>) => { if (pending) return; setPending(true); setError(''); setMessage(''); try { setMessage((await work()) || 'Saved'); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save. Try again.'); } finally { setPending(false); } };
  return { pending, error, message, run };
}
export function Feedback({ error, message }: { error: string; message: string }) { return <>{error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status" className="form-success"><Check size={16}/>{message}</p>}</>; }
export function LoadState({ query }: { query: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown } }) {
  return query.isError ? <div className="error-banner" role="alert"><span>{query.error?.message}</span><button onClick={() => { query.refetch(); }}>Retry <RefreshCw size={15}/></button></div> : query.isPending ? <p role="status" className="account-note">Loading…</p> : null;
}
export function Pagination({ page, total, limit = 25, change }: { page: number; total: number; limit?: number; change: (page: number) => void }) {
  return <nav className="pagination" aria-label="Pagination"><span>{total} {total === 1 ? 'record' : 'records'} · Page {page} of {Math.max(1, Math.ceil(total / limit))}</span><button className="secondary-button" disabled={page <= 1} onClick={() => change(page - 1)}>Previous</button><button className="secondary-button" disabled={page * limit >= total} onClick={() => change(page + 1)}>Next</button></nav>;
}
function TimezoneField({ value, disabled }: { value?: string; disabled?: boolean }) {
  const zones = Array.from(new Set(['UTC', value || 'UTC', ...Intl.supportedValuesOf('timeZone')]));
  return <label className="form-field"><span>Organization timezone</span><select name="timezone" disabled={disabled} defaultValue={value || Intl.DateTimeFormat().resolvedOptions().timeZone}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select></label>;
}
function RoleField({ role, owner, disabled }: { role: string; owner: boolean; disabled?: boolean }) {
  const [selectedRole, setSelectedRole] = useState(role); const descriptionId = useId();
  return <div className="role-field"><label className="form-field"><span>Role</span><select name="role" value={selectedRole} onChange={e => setSelectedRole(e.target.value)} disabled={disabled} aria-describedby={descriptionId}>{roles.filter(r => owner || r !== 'owner').map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></label><RoleDescription role={selectedRole} id={descriptionId}/></div>;
}
export function MemberPicker({ onChoose, exclude = [], editingOnly = false }: { onChoose: (member: Member) => void; exclude?: string[]; editingOnly?: boolean }) {
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const query = useOrgQuery<PageData<Member>>(`members?search=${encodeURIComponent(search)}&page=${page}`);
  return <div className="member-picker"><label className="form-field"><span>Find a member</span><input type="search" value={search} placeholder="Search name or email" onChange={e => { setSearch(e.target.value); setPage(1); }}/></label><LoadState query={query}/>{query.isSuccess && <><div className="picker-list">{query.data.items.filter(m => m.active && m.user.active && (!editingOnly || m.role !== 'viewer') && !exclude.includes(m.id)).map(m => <button key={m.id} type="button" className="picker-option" onClick={() => onChoose(m)}><strong>{m.user.name}</strong><span>{m.user.email} · {m.role}</span></button>)}</div>{query.data.items.length === 0 && <p className="account-note">No members match this search.</p>}<Pagination page={page} total={query.data.total} change={setPage}/></>}</div>;
}
export function OrganizationSwitcher() {
  const { account } = useAccount(); const { selected, select } = useOrganization();
  return <div className="workspace-selector"><label className="organization-select"><span>Organization</span><select aria-label="Switch organization" value={selected?.org.id || ''} onChange={e => select(e.target.value)}>{!selected && <option value="">No organization</option>}{account.memberships.map(m => <option key={m.id} value={m.org.id}>{m.org.name}</option>)}</select><small>{selected?.role || 'No membership'}</small></label></div>;
}
export function OrganizationSettings() {
  const { account, refresh } = useAccount(); const { orgId, select, send, reload } = useOrganization();
  const query = useOrgQuery<{ organization: Org; membership: Membership }>(''); const action = useAction(); const create = useAction();
  const [target, setTarget] = useState<Member | null>(null); const transfer = useAction();
  const admin = query.data && ['owner', 'admin'].includes(query.data.membership.role);
  return <><div className="page-heading"><div><div className="eyebrow">ADMINISTRATION</div><h1>Organization settings</h1></div>{orgId && <button className="secondary-button" onClick={() => { void reload(); }}><RefreshCw size={16}/>Reload</button>}</div>
    {orgId ? <><LoadState query={query}/>{query.isSuccess && <section className="admin-panel"><h2>Organization details</h2><form key={query.data.organization.version} className="account-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void action.run(async () => { await send('', { name: form.get('name'), timezone: form.get('timezone'), version: query.data.organization.version }, 'PATCH'); await reload(); return 'Organization settings saved'; }); }}><label className="form-field"><span>Organization name</span><input name="name" defaultValue={query.data.organization.name} required minLength={2} maxLength={100} disabled={!admin}/></label><TimezoneField value={query.data.organization.timezone}/>{!admin && <p className="account-note">Only owners and administrators can change organization settings.</p>}{admin && <button className="primary-button" disabled={action.pending}><Save size={16}/>Save organization</button>}<Feedback {...action}/></form></section>}
    {orgId && admin && <SlackPanel/>}
    {query.data?.membership.role === 'owner' && <section className="admin-panel"><h2>Transfer ownership</h2><p className="account-note">Select an active member to become an owner. You will become an administrator and retain access.</p><MemberPicker exclude={[query.data.membership.id]} onChoose={setTarget}/>{target && <div className="transfer-confirmation"><p>Transfer ownership to <strong>{target.user.name}</strong> ({target.user.email})?</p><button className="primary-button" disabled={transfer.pending} onClick={() => { void transfer.run(async () => { const result = await send('transfer-ownership', { membershipId: target.id, version: query.data!.membership.version, targetVersion: target.version }); setTarget(null); await reload(); return result.message; }); }}>Confirm ownership transfer</button><button className="secondary-button" onClick={() => setTarget(null)}>Cancel</button></div>}<Feedback {...transfer}/></section>}</> : <p className="account-note">You have no active organization membership. Create an organization or accept an invitation.</p>}
    <section className="admin-panel"><h2>Create another organization</h2><form className="account-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void create.run(async () => { const result = await apiRequest<Org>('orgs', 'POST', { name: form.get('name'), timezone: form.get('timezone') }, account.csrf); await refresh(); select(result.id); return 'Organization created'; }); }}><label className="form-field"><span>New organization name</span><input name="name" required minLength={2} maxLength={100}/></label><TimezoneField/><button className="primary-button" disabled={create.pending}><Plus size={16}/>Create organization</button><Feedback {...create}/></form></section></>;
}
function MemberRow({ member, actor }: { member: Member; actor: Membership }) {
  const { send, reload } = useOrganization(); const action = useAction(); const admin = ['owner', 'admin'].includes(actor.role); const allowed = admin && (actor.role === 'owner' || member.role !== 'owner');
  return <article className="member-card"><div className="member-identity"><strong>{member.user.name}</strong><span>{member.user.email}</span><div className="badge-row"><span className={`status-badge ${member.active ? '' : 'unverified'}`}>{member.active ? 'Active membership' : 'Inactive membership'}</span>{!member.user.active && <span className="status-badge status-error">Account suspended</span>}<span className="neutral-badge">{member.user.verified ? 'Email verified' : 'Email unverified'}</span></div></div>
    {allowed ? <form key={member.version} className="member-controls" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void action.run(async () => { await send(`members/${member.id}`, { role: form.get('role'), active: form.get('active') === 'on', version: member.version }, 'PATCH'); await reload(); return 'Membership saved'; }); }}><RoleField role={member.role} owner={actor.role === 'owner'}/><label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={member.active}/>Active</label><button className="secondary-button" disabled={action.pending}>Save member</button><Feedback {...action}/></form> : <span className="neutral-badge">{member.role}</span>}</article>;
}
function InvitationsPanel() {
  const { account } = useAccount(); const { send, reload } = useOrganization(); const action = useAction(); const [link, setLink] = useState(''); const [copied, setCopied] = useState(false); const [page, setPage] = useState(1);
  const invitations = useOrgQuery<PageData<Invitation>>(`invitations?page=${page}`); const revoke = useAction();
  return <section className="admin-panel invitations-panel"><h2>Invitations</h2><p className="account-note">Links expire in seven days. Reissuing invalidates the previous unused invitation.</p><form className="account-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); setLink(''); setCopied(false); void action.run(async () => { const result = await send<{ link: string; message: string }>('invitations', { email: form.get('email'), role: form.get('role'), send: form.get('send') === 'on' }); setLink(result.link); await reload(); return result.message; }); }}><label className="form-field"><span>Invite email address</span><input name="email" type="email" required maxLength={254}/></label><RoleField role="member" owner={false}/>{account.emailMode === 'smtp' && <label className="checkbox-field"><input name="send" type="checkbox" defaultChecked/>Send invitation email</label>}<button className="primary-button" disabled={action.pending}><UserPlus size={16}/>Create invitation</button><Feedback {...action}/></form>
    {link && <div className="invitation-link"><label className="form-field"><span>Invitation link</span><input readOnly value={link} onFocus={e => e.currentTarget.select()}/></label><button className="secondary-button" onClick={() => { void action.run(async () => { if (!navigator.clipboard) throw new Error('Select the link and copy it using your keyboard.'); await navigator.clipboard.writeText(link); setCopied(true); return 'Invitation link copied'; }); }}><Copy size={16}/>{copied ? 'Copied' : 'Copy link'}</button><button className="secondary-button" onClick={() => setLink('')}>Dismiss link</button></div>}
    <LoadState query={invitations}/>{invitations.isSuccess && <><div className="invitation-list">{invitations.data.items.map(invite => <article key={invite.id} className="invitation-row"><div><strong>{invite.email}</strong><span>{invite.role} · {invite.usedAt ? 'Closed' : new Date(invite.expiresAt) <= new Date() ? 'Expired' : 'Pending'} · Expires {new Date(invite.expiresAt).toLocaleDateString()}</span></div>{!invite.usedAt && <button className="secondary-button" disabled={revoke.pending} onClick={() => { void revoke.run(async () => { await send(`invitations/${invite.id}`, {}, 'DELETE'); await reload(); return 'Invitation revoked'; }); }}>Revoke</button>}</article>)}</div>{!invitations.data.total && <p className="account-note">No invitations yet.</p>}<Pagination page={page} total={invitations.data.total} change={setPage}/></>}<Feedback {...revoke}/><p className="account-note">Password recovery affects the whole account. In self-hosted mode, ask a trusted host operator to issue a reset link.</p></section>;
}
export function MembersPage() {
  const { orgId, reload } = useOrganization(); const [params, change] = useUrlFilters(true);
  const search = params.get('search') || ''; const page = Number(params.get('page') || 1);
  const setSearch = (value: string) => change('search', value); const setPage = (value: number) => change('page', String(value));
  const info = useOrgQuery<{ organization: Org; membership: Membership }>(''); const query = useOrgQuery<PageData<Member>>(`members?search=${encodeURIComponent(search)}&page=${page}`);
  if (!orgId) return <p className="account-note">Select or create an organization to view members.</p>;
  return <><div className="page-heading"><div><div className="eyebrow">ORGANIZATION</div><h1>Members</h1></div><button className="secondary-button" onClick={() => { void reload(); }}><RefreshCw size={16}/>Reload</button></div><RoleGuide/><FilterDisclosure id="member-filters" initiallyOpen={Boolean(search)} summary={search ? '1 active filter' : 'All members'}><label className="form-field directory-search"><span>Search members</span><input type="search" value={search} placeholder="Search name or email" onChange={e => setSearch(e.target.value)}/></label></FilterDisclosure><LoadState query={info}/><LoadState query={query}/>{query.isSuccess && info.isSuccess && <><section className="member-list" aria-label="Members">{query.data.items.map(m => <MemberRow key={m.id} member={m} actor={info.data.membership}/>)}</section>{!query.data.total && <p className="account-note">No members match this search.</p>}<Pagination page={page} total={query.data.total} change={setPage}/>{['owner', 'admin'].includes(info.data.membership.role) && <InvitationsPanel/>}</>}</>;
}
function TeamCard({ team, actor }: { team: Team; actor: Membership }) {
  const { send, reload } = useOrganization(); const action = useAction(); const [adding, setAdding] = useState(false); const [chosen, setChosen] = useState<Member | null>(null); const [confirmDelete, setConfirmDelete] = useState(false);
  const admin = ['owner', 'admin'].includes(actor.role); const canManage = admin || (actor.role === 'manager' && team.members.some(m => m.membershipId === actor.id && m.manager));
  const save = (path: string, body: unknown, method: string, message: string) => { void action.run(async () => { await send(path, body, method); await reload(); setChosen(null); setAdding(false); return message; }); };
  return <section className="team-card graph-team" style={teamCardStyle(team.id)}><div className="section-heading"><h2>{team.name}</h2><span className="neutral-badge">{team.members.length} members</span></div>{canManage && <form key={team.version} className="team-rename" onSubmit={e => { e.preventDefault(); save(`teams/${team.id}`, { name: new FormData(e.currentTarget).get('name'), version: team.version }, 'PATCH', 'Team renamed'); }}><label className="form-field"><span>Team name</span><input name="name" defaultValue={team.name} minLength={2} maxLength={100} required/></label><button className="secondary-button" disabled={action.pending}>Rename team</button></form>}
    <div className="team-work-links"><Link className="secondary-button" to={`/objectives?teamId=${team.id}`}>View team objectives</Link><Link className="secondary-button" to={`/alignment?teamId=${team.id}`}>View team alignment</Link></div>
    <ul className="team-roster">{team.members.map(entry => <li key={entry.membershipId}><div><strong>{entry.membership.user.name}</strong><span>{entry.membership.role}{entry.manager ? ' · Designated manager' : ''}{!entry.membership.active || !entry.membership.user.active ? ' · Inactive' : ''}</span></div><div className="roster-actions">{admin && entry.membership.active && entry.membership.user.active && ['owner', 'admin', 'manager'].includes(entry.membership.role) && <button className="secondary-button" disabled={action.pending} onClick={() => save(`teams/${team.id}/members/${entry.membershipId}`, { manager: !entry.manager, version: team.version }, 'PUT', 'Manager designation saved')}>{entry.manager ? 'Remove designation' : 'Designate manager'}</button>}{canManage && (admin || !entry.manager) && <button className="secondary-button" disabled={action.pending} aria-label={`Remove ${entry.membership.user.name} from ${team.name}`} onClick={() => save(`teams/${team.id}/members/${entry.membershipId}`, { version: team.version }, 'DELETE', 'Team member removed')}>Remove</button>}</div></li>)}</ul>{!team.members.length && <p className="account-note">No team members yet.</p>}
    {canManage && <button className="secondary-button" onClick={() => { setAdding(!adding); setChosen(null); }}><Plus size={16}/>{adding ? 'Cancel adding member' : 'Add team member'}</button>}{adding && <MemberPicker exclude={team.members.map(m => m.membershipId)} onChoose={setChosen}/>} {chosen && <form className="team-add" onSubmit={e => { e.preventDefault(); save(`teams/${team.id}/members/${chosen.id}`, { manager: new FormData(e.currentTarget).get('manager') === 'on', version: team.version }, 'PUT', 'Team member added'); }}><p>Add <strong>{chosen.user.name}</strong> to {team.name}</p>{admin && ['owner', 'admin', 'manager'].includes(chosen.role) && <label className="checkbox-field"><input name="manager" type="checkbox"/>Designated manager</label>}<button className="primary-button" disabled={action.pending}>Confirm team member</button></form>}
    {admin && <div className="team-delete">{confirmDelete ? <><p>Delete {team.name} and its team roster?</p><button className="secondary-button danger-button" disabled={action.pending} onClick={() => save(`teams/${team.id}`, { version: team.version }, 'DELETE', 'Team deleted')}>Confirm delete team</button><button className="secondary-button" onClick={() => setConfirmDelete(false)}>Cancel</button></> : <button className="text-button" onClick={() => setConfirmDelete(true)}>Delete team</button>}</div>}<Feedback {...action}/></section>;
}
export function TeamsPage() {
  const { orgId, send, reload } = useOrganization(); const info = useOrgQuery<{ membership: Membership }>(''); const query = useOrgQuery<Team[]>('teams'); const action = useAction();
  if (!orgId) return <p className="account-note">Select or create an organization to view teams.</p>;
  return <><div className="page-heading"><div><div className="eyebrow">ORGANIZATION</div><h1>Teams</h1></div><button className="secondary-button" onClick={() => { void reload(); }}><RefreshCw size={16}/>Reload</button></div><LoadState query={info}/><LoadState query={query}/>{info.isSuccess && ['owner', 'admin'].includes(info.data.membership.role) && <section className="admin-panel"><h2>Create a team</h2><form className="team-rename" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const name = new FormData(form).get('name'); void action.run(async () => { await send('teams', { name }); form.reset(); await reload(); return 'Team created'; }); }}><label className="form-field"><span>New team name</span><input name="name" required minLength={2} maxLength={100}/></label><button className="primary-button" disabled={action.pending}><Plus size={16}/>Create team</button></form><Feedback {...action}/></section>}{query.isSuccess && info.isSuccess && <div className="teams-grid">{query.data.map(team => <TeamCard key={team.id} team={team} actor={info.data.membership}/>)}{!query.data.length && <p className="account-note">No teams yet.</p>}</div>}</>;
}
export function AdminHistory() {
  const { orgId } = useOrganization(); const [params, change] = useUrlFilters(); const page = Number(params.get('page') || 1); const setPage = (value: number) => change('page', String(value)); const query = useOrgQuery<PageData<Audit>>(`audit?page=${page}`);
  return <><div className="page-heading"><div><div className="eyebrow">ADMINISTRATION</div><h1>Administration history</h1></div><button className="secondary-button" onClick={() => { void query.refetch(); }}><RefreshCw size={16}/>Reload</button></div>{!orgId ? <p className="account-note">Select an organization to view its history.</p> : <><LoadState query={query}/>{query.isSuccess && <><ol className="audit-list">{query.data.items.map(event => <li key={event.id}><div><strong>{event.text}</strong><span>{event.user.name} · {event.type.replaceAll('_', ' ')}</span></div><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></li>)}</ol>{!query.data.total && <p className="account-note">No administrative activity yet.</p>}<Pagination page={page} total={query.data.total} change={setPage}/></>}</>}</>;
}
