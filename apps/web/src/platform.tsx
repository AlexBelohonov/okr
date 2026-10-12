import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useAccount } from './accounts';
import { apiRequest, RequestError } from './api';
import { FilterDisclosure } from './filter-disclosure';
import { useUrlFilters } from './filters';

interface RecordRow { id: string; name: string; active: boolean; version: number; email?: string; platformAdmin?: boolean; timezone?: string }
interface AuditRow { id: string; text: string; createdAt: string; data: { reason?: string }; user: { name: string; email: string } }
interface Results<T> { items: T[]; total: number; page: number; limit: number }
function ActivationRow({ item, save }: { item: RecordRow; save: (item: RecordRow, reason: string) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false); const [reason, setReason] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  return <article className="member-card platform-card" aria-label={item.email || item.name}>
    <div className="member-identity"><strong>{item.name}</strong><span>{item.email || item.timezone}{item.platformAdmin ? ' · Platform administrator' : ''}</span><div className="badge-row"><span className={`status-badge ${item.active ? '' : 'status-error'}`}>{item.active ? 'Active' : 'Suspended'}</span></div></div>
    {!confirming ? <button className="secondary-button" onClick={() => { setConfirming(true); setError(''); }}>{item.active ? 'Suspend' : 'Activate'}</button> : <form className="account-form" onSubmit={event => {
      event.preventDefault(); setPending(true); setError('');
      void save(item, reason).then(() => { setConfirming(false); setReason(''); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Request failed')).finally(() => setPending(false));
    }}><p className="account-note">{item.email ? 'This changes access across all organizations. Suspension requires reassignment and preserves an active owner in every organization.' : 'This changes access for every member of this organization.'}</p>
      <label className="form-field"><span>Reason for {item.active ? 'suspension' : 'activation'}</span><input value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500}/></label>
      <button className="primary-button" disabled={pending}>Confirm {item.active ? 'suspension' : 'activation'}</button><button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
      {error && <p role="alert" className="form-error">{error}</p>}
    </form>}
  </article>;
}
export function PlatformPage() {
  const { account, refresh } = useAccount(); const [params, change, clear] = useUrlFilters(true);
  const section = ['users', 'organizations', 'audit'].includes(params.get('section') || '') ? params.get('section')! : 'users';
  const search = params.get('search') || ''; const page = Math.max(1, Number(params.get('page')) || 1); const [message, setMessage] = useState('');
  const query = useQuery({ queryKey: ['platform', account.user?.id, section, search, page], enabled: Boolean(account.user?.platformAdmin), retry: false, queryFn: ({ signal }) => apiRequest<Results<RecordRow & AuditRow>>(`platform/${section}?search=${encodeURIComponent(search)}&page=${page}`, 'GET', undefined, undefined, signal) });
  if (!account.user?.platformAdmin) return <Navigate to="/overview" replace/>;
  const save = async (item: RecordRow, reason: string) => {
    try { await apiRequest(`platform/${section}/${item.id}`, 'PATCH', { active: !item.active, version: item.version, reason }, account.csrf); await refresh(); await query.refetch(); setMessage('Activation saved'); }
    catch (error) { if (error instanceof RequestError && [401, 403].includes(error.status)) await refresh(); throw error; }
  };
  return <><div className="page-heading"><div><div className="eyebrow">PLATFORM</div><h1>Platform administration</h1></div><button className="secondary-button" onClick={() => { setMessage(''); void refresh(); void query.refetch(); }}>Reload</button></div>
    <p className="account-note">Manage global account and organization access. Organization membership is required to view objectives. Administrator promotion requires the trusted host bootstrap command.</p>
    <div className="heading-actions platform-tabs" aria-label="Platform sections">{[['users', 'Accounts'], ['organizations', 'Organizations'], ['audit', 'Platform history']].map(([key, label]) => <button key={key} className="secondary-button" aria-pressed={section === key} onClick={() => { setMessage(''); clear(); change('section', key); }}>{label}</button>)}</div>
    <FilterDisclosure id="platform-filters" initiallyOpen={Boolean(search)} summary={search ? '1 active filter' : 'All records'}><label className="form-field directory-search"><span>Search platform records</span><input type="search" value={search} onChange={event => { setMessage(''); change('search', event.target.value); }}/></label></FilterDisclosure>
    {message && <p role="status" className="form-success">{message}</p>}{query.isPending && <p role="status">Loading platform records…</p>}{query.isError && <p role="alert" className="form-error">{query.error.message}</p>}
    {query.isSuccess && <><section className="member-list" aria-label={section === 'users' ? 'Platform accounts' : section === 'organizations' ? 'Platform organizations' : 'Platform history'}>
      {section === 'audit' ? query.data.items.map(item => <article className="member-card platform-card" key={item.id}><div className="member-identity"><strong>{item.text}</strong><span>{item.user.name} · {new Date(item.createdAt).toLocaleString()}</span>{item.data.reason && <p>{item.data.reason}</p>}</div></article>) : query.data.items.map(item => <ActivationRow key={`${section}:${item.id}:${item.version}`} item={item} save={save}/>)}
      {!query.data.total && <p className="account-note">No matching records.</p>}
    </section><nav className="pagination" aria-label="Platform pagination"><button className="secondary-button" disabled={page <= 1} onClick={() => change('page', String(page - 1))}>Previous page</button><span>Page {page} · {query.data.total} records</span><button className="secondary-button" disabled={page * query.data.limit >= query.data.total} onClick={() => change('page', String(page + 1))}>Next page</button></nav></>}
  </>;
}
