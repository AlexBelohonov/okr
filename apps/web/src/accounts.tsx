import { createContext, useContext, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, KeyRound, LoaderCircle, LogIn, LogOut, Mail, RefreshCw, Save, Target, UserPlus } from 'lucide-react';
import type { AccountSession } from '@okr/shared';
import { accountRequest, getAccount, RequestError } from './api';
import { RoleDescription } from './roles';

const AccountContext = createContext<{ account: AccountSession; refresh: () => Promise<void>; send: <T = { message: string }>(path: string, payload: unknown, method?: string) => Promise<T> } | null>(null);
export function useAccount() { const value = useContext(AccountContext); if (!value) throw new Error('Missing account provider'); return value; }
export function AccountProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ['account'], queryFn: getAccount, retry: false, networkMode: 'always', staleTime: 30000, refetchOnWindowFocus: true });
  const refresh = async () => { await cache.invalidateQueries({ queryKey: ['account'] }); };
  if (query.isPending) return <div className="account-status" role="status"><LoaderCircle className="spin" size={22}/>Connecting to workspace</div>;
  if (query.isError) return <div className="account-status"><h1>Connection unavailable</h1><p role="alert">Unable to connect to your workspace.</p><button className="primary-button" onClick={() => { void query.refetch(); }}><RefreshCw size={17}/>Retry</button></div>;
  const send = async <T,>(path: string, payload: unknown, method = 'POST'): Promise<T> => {
    try { return await accountRequest<T>(path, method, payload, query.data.csrf); }
    catch (error) { if (error instanceof RequestError && error.status === 401 && !['login'].includes(path)) await refresh(); throw error; }
  };
  return <AccountContext.Provider value={{ account: query.data, refresh, send }}>{children}</AccountContext.Provider>;
}
export function ProtectedWorkspace({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const location = useLocation();
  return account.user ? children : <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }}/ >;
}
function PasswordField({ label, name, autoComplete, minLength = 1 }: { label: string; name: string; autoComplete: string; minLength?: number }) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return <div className="form-field"><label htmlFor={id}>{label}</label><div className="password-field"><input id={id} name={name} type={shown ? 'text' : 'password'} required minLength={minLength} maxLength={128} autoComplete={autoComplete}/><button type="button" className="icon-button" title={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>;
}
function useSubmission() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const run = async (work: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed. Try again.'); }
    finally { setPending(false); }
  };
  return { pending, error, message, setMessage, run };
}
function Feedback({ error, message }: { error: string; message: string }) { return <>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status"><Check size={16}/>{message}</p>}</>; }
function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · OKR Workspace`; }, [title]);
  return <div className="auth-page"><header className="auth-header"><Link className="brand" to="/login"><span className="brand-mark"><Target size={23}/></span><span>OKR<span className="brand-secondary">Workspace</span></span></Link></header><main className="auth-main"><h1>{title}</h1>{children}</main><footer className="auth-footer">OKR Workspace</footer></div>;
}
export function Login() {
  const { account, send, refresh } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const action = useSubmission();
  const from = (location.state as { from?: string } | null)?.from;
  const destination = from && from.startsWith('/') && !from.startsWith('//') ? from : '/overview';
  if (account.user) return <Navigate to={destination} replace/>;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void action.run(async () => { await send('login', { email: form.get('email'), password: form.get('password') }); await refresh(); navigate(destination, { replace: true }); });
  };
  return <AuthFrame title="Sign in"><form onSubmit={submit} className="account-form"><label className="form-field"><span>Email address</span><input name="email" type="email" required maxLength={254} autoComplete="username" autoFocus/></label><PasswordField label="Password" name="password" autoComplete="current-password"/><div className="form-inline"><Link to="/forgot-password">Forgot password?</Link></div><Feedback {...action}/><button className="primary-button" disabled={action.pending}>{action.pending ? <LoaderCircle className="spin" size={17}/> : <LogIn size={17}/>}Sign in</button></form>{account.signupEnabled && <p className="auth-switch">New to OKR Workspace? <Link to="/signup">Create account <ArrowRight size={14}/></Link></p>}</AuthFrame>;
}
function SignupForm({ invite, token }: { invite?: { email: string; organization: string; role: string }; token?: string }) {
  const { send, refresh } = useAccount(); const navigate = useNavigate(); const action = useSubmission();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirmPassword')) { void action.run(async () => { throw new Error('Passwords do not match'); }); return; }
    void action.run(async () => {
      await send('signup', { name: form.get('name'), email: invite?.email || form.get('email'), password: form.get('password'), ...(token ? { inviteToken: token } : { organization: form.get('organization'), timezone: form.get('timezone') }) });
      await refresh(); navigate('/overview', { replace: true });
    });
  };
  return <form className="account-form" onSubmit={submit}><label className="form-field"><span>Full name</span><input name="name" required minLength={2} maxLength={100} autoComplete="name" autoFocus/></label><label className="form-field"><span>Email address</span><input name="email" type="email" required maxLength={254} autoComplete="username" defaultValue={invite?.email} readOnly={Boolean(invite)}/></label>{!invite && <><label className="form-field"><span>Organization name</span><input name="organization" required minLength={2} maxLength={100} autoComplete="organization"/></label><label className="form-field"><span>Timezone</span><select name="timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}>{Array.from(new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, ...Intl.supportedValuesOf('timeZone')])).map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label></>}<PasswordField label="Password" name="password" autoComplete="new-password" minLength={12}/><PasswordField label="Confirm password" name="confirmPassword" autoComplete="new-password" minLength={12}/><Feedback {...action}/><button className="primary-button" disabled={action.pending}>{action.pending ? <LoaderCircle className="spin" size={17}/> : <UserPlus size={17}/>}Create account</button></form>;
}
export function Signup() {
  const { account } = useAccount();
  if (account.user) return <Navigate to="/overview" replace/>;
  if (!account.signupEnabled) return <Navigate to="/login" replace/>;
  return <AuthFrame title="Create account"><SignupForm/><p className="auth-switch">Already have an account? <Link to="/login">Sign in <ArrowRight size={14}/></Link></p></AuthFrame>;
}
export function ForgotPassword() {
  const { send, account } = useAccount(); const action = useSubmission();
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const email = new FormData(event.currentTarget).get('email'); void action.run(async () => { const result = await send('recovery', { email }); action.setMessage(result.message); }); };
  return <AuthFrame title="Recover account"><form className="account-form" onSubmit={submit}><label className="form-field"><span>Email address</span><input name="email" type="email" required autoComplete="email" maxLength={254}/></label>{account.emailMode === 'selfhosted' && <p className="account-note">Email delivery is disabled. Contact your workspace administrator for a reset link.</p>}<Feedback {...action}/><button className="primary-button" disabled={action.pending}>{action.pending ? <LoaderCircle className="spin" size={17}/> : <Mail size={17}/>}Request recovery</button></form><Link className="auth-back" to="/login"><ArrowLeft size={15}/>Back to sign in</Link></AuthFrame>;
}
function useLinkToken() { const location = useLocation(); return new URLSearchParams(location.hash.slice(1)).get('token') || ''; }
export function ResetPassword() {
  const token = useLinkToken(); const { send, refresh } = useAccount(); const action = useSubmission(); const location = useLocation(); const navigate = useNavigate();
  const message = (location.state as { message?: string } | null)?.message || '';
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void action.run(async () => { if (form.get('password') !== form.get('confirmPassword')) throw new Error('Passwords do not match'); const result = await send('reset', { token, password: form.get('password') }); await refresh(); navigate('/reset-password', { replace: true, state: { message: result.message } }); }); };
  return <AuthFrame title="Reset password">{message && !token ? <Feedback error="" message={message}/> : !token ? <p className="form-error" role="alert">This reset link is missing or invalid.</p> : <form className="account-form" onSubmit={submit}><PasswordField label="New password" name="password" autoComplete="new-password" minLength={12}/><PasswordField label="Confirm password" name="confirmPassword" autoComplete="new-password" minLength={12}/><Feedback {...action}/><button className="primary-button" disabled={action.pending}><KeyRound size={17}/>Reset password</button></form>}<Link className="auth-back" to="/login"><ArrowLeft size={15}/>Back to sign in</Link></AuthFrame>;
}
export function VerifyEmail() {
  const token = useLinkToken(); const { send, refresh } = useAccount(); const action = useSubmission(); const location = useLocation(); const navigate = useNavigate();
  const message = (location.state as { message?: string } | null)?.message || '';
  return <AuthFrame title="Verify email">{!token && !message ? <p className="form-error" role="alert">This verification link is missing or invalid.</p> : <><Feedback error={action.error} message={!token ? message : ''}/>{token && <button className="primary-button" disabled={action.pending} onClick={() => { void action.run(async () => { const result = await send('verify', { token }); await refresh(); navigate('/verify-email', { replace: true, state: { message: result.message } }); }); }}><Mail size={17}/>Verify email</button>}</>}<Link className="auth-back" to="/overview"><ArrowRight size={15}/>Go to workspace</Link></AuthFrame>;
}
export function Invitation() {
  const token = useLinkToken(); const { send, account, refresh } = useAccount(); const action = useSubmission(); const navigate = useNavigate();
  const invitation = useQuery({ queryKey: ['invitation', token], queryFn: () => send<{ email: string; organization: string; role: string }>('invitation', { token }), retry: false, enabled: Boolean(token), staleTime: Infinity });
  return <AuthFrame title="Join organization">{!token || invitation.isError ? <p className="form-error" role="alert">{invitation.error?.message || 'This invitation link is missing or invalid.'}</p> : invitation.isPending ? <p role="status">Loading invitation</p> : <><div className="invitation-summary"><strong>{invitation.data.organization}</strong><span>{invitation.data.email}</span><span className="neutral-badge">{invitation.data.role}</span><RoleDescription role={invitation.data.role}/></div>{account.user ? <>{account.user.email !== invitation.data.email ? <p className="form-error" role="alert">Sign out and use the invited email address.</p> : <button className="primary-button" disabled={action.pending} onClick={() => { void action.run(async () => { await send('accept-invitation', { token }); await refresh(); navigate('/overview', { replace: true }); }); }}><UserPlus size={17}/>Accept invitation</button>}<Feedback {...action}/><SignOutButton/></> : <><SignupForm invite={invitation.data} token={token}/><p className="auth-switch">Already have an account? <Link to="/login" state={{ from: `/invitation#token=${token}` }}>Sign in <ArrowRight size={14}/></Link></p></>}</>}</AuthFrame>;
}
export function SignOutButton() {
  const { send, refresh } = useAccount(); const action = useSubmission(); const navigate = useNavigate();
  return <><button className="secondary-button" disabled={action.pending} onClick={() => { void action.run(async () => { await send('logout', {}); await refresh(); navigate('/login', { replace: true }); }); }}><LogOut size={16}/>Sign out</button><Feedback {...action}/></>;
}
export function ProfilePanel() {
  const { account, send, refresh } = useAccount(); const profile = useSubmission(); const credentials = useSubmission(); const verification = useSubmission(); const navigate = useNavigate();
  const user = account.user!;
  return <section className="profile-section" aria-labelledby="profile-heading"><div className="section-heading"><h2 id="profile-heading">Your account</h2><SignOutButton/></div><div className="profile-details"><span>{user.email}</span><span className={`status-badge ${user.verified ? '' : 'unverified'}`}>{user.verified ? 'Email verified' : 'Email unverified'}</span></div>{!user.verified && account.emailMode === 'smtp' && <div className="verification-action"><button className="secondary-button" disabled={verification.pending} onClick={() => { void verification.run(async () => { const result = await send('verification', {}); verification.setMessage(result.message); }); }}><Mail size={16}/>Resend verification email</button><Feedback {...verification}/></div>}
    <form className="account-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void profile.run(async () => { const result = await send('profile', { name: form.get('name') }, 'PATCH'); await refresh(); profile.setMessage(result.message); }); }}><label className="form-field"><span>Full name</span><input key={user.name} name="name" defaultValue={user.name} required minLength={2} maxLength={100} autoComplete="name"/></label><Feedback {...profile}/><button className="primary-button" disabled={profile.pending}><Save size={16}/>Save profile</button></form>
    <h3 className="password-heading">Change password</h3><form className="account-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void credentials.run(async () => { if (form.get('password') !== form.get('confirmPassword')) throw new Error('Passwords do not match'); await send('password', { currentPassword: form.get('currentPassword'), password: form.get('password') }); await refresh(); navigate('/login', { replace: true }); }); }}><PasswordField label="Current password" name="currentPassword" autoComplete="current-password"/><PasswordField label="New password" name="password" autoComplete="new-password" minLength={12}/><PasswordField label="Confirm password" name="confirmPassword" autoComplete="new-password" minLength={12}/><Feedback {...credentials}/><button className="primary-button" disabled={credentials.pending}><KeyRound size={16}/>Change password</button></form>
  </section>;
}
