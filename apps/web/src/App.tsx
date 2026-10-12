import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { NavLink, Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, ArrowRight, Check, Circle, Database, Flag, LayoutDashboard, ListTree, Mail, Menu, RefreshCw, Server, Settings2, Target, Users, X } from 'lucide-react';
import { getReadiness } from './api';
import { AccountProvider, ProtectedWorkspace, Login, Signup, ForgotPassword, ResetPassword, VerifyEmail, Invitation, ProfilePanel, useAccount } from './accounts';
import { OrganizationProvider, OrganizationSwitcher, OrganizationSettings, MembersPage, TeamsPage, AdminHistory, useOrganization } from './organizations';
import { AlignmentPage } from './relationships';
import { NewObjective, ObjectiveDetail, ObjectivesOverview, ObjectivesPage, PeriodsPage } from './objectives';
import { ActivityFeed, ActivityPage, NotificationNav, NotificationsPage } from './collaboration-loader';
import { PlatformPage } from './platform';
import { ObjectiveOrganizationLink } from './objective-link';

function useConnection() { return useQuery({ queryKey: ['readiness'], queryFn: ({ signal }) => getReadiness(signal), refetchInterval: 30000, networkMode: 'always', retry: false }); }


export function App() {
  const location = useLocation();
  return <AccountProvider><Routes><Route path="/login" element={<Login/>}/><Route path="/signup" element={<Signup/>}/><Route path="/forgot-password" element={<ForgotPassword/>}/><Route path="/reset-password" element={<ResetPassword key={location.key}/>}/><Route path="/verify-email" element={<VerifyEmail key={location.key}/>}/><Route path="/invitation" element={<Invitation key={location.key}/>}/><Route path="*" element={<ProtectedWorkspace><WorkspaceShell/></ProtectedWorkspace>}/></Routes></AccountProvider>;
}
function WorkspaceShell() {
  const { account } = useAccount();
  return <OrganizationProvider key={account.user!.id}><WorkspaceContent/></OrganizationProvider>;
}
function WorkspaceContent() {
  const { account } = useAccount();
  const { orgId, selected } = useOrganization();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const menuButton = useRef<HTMLButtonElement>(null);
  const previousRoute = useRef('');
  const navigated = useRef(false);
  const location = useLocation();
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const resize = () => { setMobile(media.matches); setMenuOpen(false); };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const pageName = { '/platform': 'Platform administration', '/objectives': 'All objectives', '/objectives/new': 'New objective', '/my-objectives': 'My objectives', '/periods': 'Planning periods', '/alignment': 'Alignment', '/activity': 'Activity', '/notifications': 'Notifications', '/settings': 'Settings', '/organization': 'Organization', '/members': 'Members', '/teams': 'Teams', '/administration-history': 'History', '/overview': 'Overview', '/': 'Overview' }[location.pathname] || (location.pathname.startsWith('/objectives/') ? 'Objective' : 'Page not found');
  useEffect(() => {
    document.title = `${pageName} · ${selected?.org.name || 'OKR Workspace'}`;
    const route = `${orgId}:${location.pathname}`;
    if (previousRoute.current && previousRoute.current !== route) {
      navigated.current = true; setMenuOpen(false);
      document.getElementById('main-content')?.focus(); window.scrollTo(0, 0);
    }
    previousRoute.current = route;
  }, [location.pathname, orgId, pageName, selected?.org.name]);
  const connection = useConnection();
  const navigation = <>
      <Link to="/overview" className="brand" onClick={() => setMenuOpen(false)}><span className="brand-mark"><Target size={23} strokeWidth={2.4}/></span><span>OKR<span className="brand-secondary">Workspace</span></span></Link>
      <OrganizationSwitcher/>
      <nav className="primary-nav" aria-label="Workspace">
        <div className="nav-group"><div className="nav-label">PLANNING</div>
        <NavLink to="/overview" onClick={() => setMenuOpen(false)}><LayoutDashboard size={18}/><span>Overview</span></NavLink>
        <NavLink to="/my-objectives" onClick={() => setMenuOpen(false)}><Flag size={18}/><span>My objectives</span></NavLink>
        <NavLink to="/objectives" onClick={() => setMenuOpen(false)}><Target size={18}/><span>All objectives</span></NavLink>
        <NavLink to="/alignment" onClick={() => setMenuOpen(false)}><ListTree size={18}/><span>Alignment</span></NavLink>
        <NavLink to="/periods" onClick={() => setMenuOpen(false)}><Flag size={18}/><span>Planning periods</span></NavLink></div>
        <div className="nav-group"><div className="nav-label">COLLABORATION</div>
        <NavLink to="/activity" onClick={() => setMenuOpen(false)}><Activity size={18}/><span>Activity</span></NavLink>
        <NotificationNav onNavigate={() => setMenuOpen(false)}/></div>
        <div className="nav-group"><div className="nav-label">ORGANIZATION</div>
        <NavLink to="/members" onClick={() => setMenuOpen(false)}><Users size={18}/><span>Members</span></NavLink>
        <NavLink to="/teams" onClick={() => setMenuOpen(false)}><Users size={18}/><span>Teams</span></NavLink>
        <NavLink to="/organization" onClick={() => setMenuOpen(false)}><Settings2 size={18}/><span>Organization</span></NavLink>
        {['owner', 'admin'].includes(selected?.role || '') && <NavLink to="/administration-history" onClick={() => setMenuOpen(false)}><Activity size={18}/><span>Administration history</span></NavLink>}</div>
      </nav>
      <div className="sidebar-bottom"><NavLink to="/settings" onClick={() => setMenuOpen(false)}><Settings2 size={18}/><span>Settings</span></NavLink>
        {account.user?.platformAdmin && <NavLink to="/platform" onClick={() => setMenuOpen(false)}><Settings2 size={18}/><span>Platform administration</span></NavLink>}
        <div className="connection-small"><span className={`connection-dot ${connection.isError ? 'failed' : connection.isPending ? 'pending' : ''}`}/><span>{connection.isError ? 'Connection unavailable' : connection.isPending ? 'Connecting' : 'Workspace connected'}</span></div>
      </div>
  </>;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {!mobile && <aside className="sidebar" aria-label="Workspace navigation">{navigation}</aside>}
    <Dialog.Root open={mobile && menuOpen} onOpenChange={setMenuOpen}><Dialog.Portal><Dialog.Overlay className="sidebar-backdrop"/><Dialog.Content className="sidebar is-open mobile-navigation" onCloseAutoFocus={event => { event.preventDefault(); if (navigated.current) document.getElementById('main-content')?.focus(); else menuButton.current?.focus(); }}>
      <Dialog.Title className="sr-only">Workspace navigation</Dialog.Title><Dialog.Description className="sr-only">Choose a workspace page or switch organization.</Dialog.Description>
      <Dialog.Close className="icon-button navigation-close" aria-label="Close navigation" title="Close navigation"><X size={18}/></Dialog.Close>{navigation}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <div className="workspace-main">
      <header className="topbar"><div className="topbar-left"><button ref={menuButton} className="icon-button mobile-menu" aria-label="Open navigation" title="Open navigation" aria-expanded={menuOpen} onClick={() => { navigated.current = false; setMenuOpen(true); }}><Menu size={20}/></button><span className="breadcrumb">Workspace<span>/</span><span>{pageName}</span></span></div><Link className="topbar-account" to="/settings" title="Account settings">{account.user?.name}</Link></header>
      <main id="main-content" tabIndex={-1}>
        {!account.user?.verified && account.emailMode === 'smtp' && <div className="verification-banner"><Mail size={17}/><span>Email verification required.</span><Link to="/settings">Account settings <ArrowRight size={14}/></Link></div>}
        <Routes key={orgId}><Route path="/orgs/:orgId/objectives/:id" element={<ObjectiveOrganizationLink/>}/><Route path="/" element={<Navigate to="/overview" replace/>}/><Route path="/overview" element={<Overview/>}/><Route path="/platform" element={<PlatformPage/>}/><Route path="/settings" element={<Settings/>}/><Route path="/organization" element={<OrganizationSettings/>}/><Route path="/members" element={<MembersPage/>}/><Route path="/teams" element={<TeamsPage/>}/><Route path="/administration-history" element={<AdminHistory/>}/><Route path="/objectives" element={<ObjectivesPage/>}/><Route path="/my-objectives" element={<ObjectivesPage mine/>}/><Route path="/objectives/new" element={<NewObjective/>}/><Route path="/objectives/:id" element={<ObjectiveDetail/>}/><Route path="/alignment" element={<AlignmentPage/>}/><Route path="/periods" element={<PeriodsPage/>}/><Route path="/activity" element={<ActivityPage/>}/><Route path="/notifications" element={<NotificationsPage/>}/><Route path="*" element={<NotFound/>}/></Routes>
      </main>
      <footer className="workspace-footer"><span>OKR Workspace</span><span>{connection.data ? `v${connection.data.version}` : '--'}</span></footer>
    </div>
  </div>;
}

function Overview() {
  const { selected } = useOrganization();
  const organization = selected?.org;
  const connection = useConnection();
  return <>
    <div className="page-heading"><div><div className="eyebrow">WORKSPACE</div><h1>Overview</h1></div><div className="heading-actions"><span className="neutral-badge organization-badge">{organization?.name || 'No organization'}</span><button className="icon-button" aria-label="Refresh connection" title="Refresh connection" disabled={connection.isFetching} onClick={() => { void connection.refetch(); }}><RefreshCw size={18} className={connection.isFetching ? 'spin' : ''}/></button></div></div>
    {connection.isError && <div className="error-banner" role="alert"><span>Workspace connection unavailable.</span><button onClick={() => { void connection.refetch(); }}>Retry <RefreshCw size={14}/></button></div>}
    <div className="overview-columns"><section className="objective-section"><ObjectivesOverview/></section>
      <aside className="activity-section" aria-labelledby="activity-heading"><div className="section-heading"><h2 id="activity-heading">Recent activity</h2><Activity size={17}/></div><ActivityFeed compact/><div className="status-line"><span className={`connection-dot ${connection.isError ? 'failed' : connection.isPending ? 'pending' : ''}`}/><span aria-live="polite">{connection.isPending ? 'Connecting to workspace' : connection.isError ? 'Service unavailable' : 'All systems connected'}</span><Link to="/settings" aria-label="View connection status"><ArrowRight size={16}/></Link></div></aside>
    </div>
  </>;
}

function Settings() {
  const connection = useConnection();
  return <>
    <div className="page-heading"><div><div className="eyebrow">WORKSPACE</div><h1>Settings</h1></div><button className="icon-button" title="Refresh status" aria-label="Refresh status" disabled={connection.isFetching} onClick={() => { void connection.refetch(); }}><RefreshCw size={18} className={connection.isFetching ? 'spin' : ''}/></button></div>
    <ProfilePanel/>
    <section className="settings-section" aria-labelledby="connection-heading"><div className="section-heading"><h2 id="connection-heading">Connection</h2><span className={`status-badge ${connection.isError ? 'status-error' : ''}`}>{connection.isPending ? 'Connecting' : connection.isError ? 'Unavailable' : 'Connected'}</span></div>
      <div className="setting-row"><span className="setting-icon"><Server size={21}/></span><div><strong>Workspace service</strong><span>OKR Workspace</span></div><span className="setting-value">{connection.isSuccess ? <><Check size={16}/>Online</> : '--'}</span></div>
      <div className="setting-row"><span className="setting-icon"><Database size={21}/></span><div><strong>Database</strong><span>PostgreSQL</span></div><span className="setting-value">{connection.isSuccess ? <><Check size={16}/>Connected</> : '--'}</span></div>
      <div className="setting-row"><span className="setting-icon"><Settings2 size={21}/></span><div><strong>Version</strong></div><span className="setting-value">{connection.data?.version ?? '--'}</span></div>
      {connection.isError && <div className="error-banner" role="alert"><span>{connection.error.message}</span><button onClick={() => { void connection.refetch(); }}>Retry <RefreshCw size={14}/></button></div>}
    </section>
  </>;
}

function NotFound() { return <div className="not-found"><h1>Page not found</h1><Link to="/overview"><ArrowLeft size={16}/>Back to overview</Link></div>; }
