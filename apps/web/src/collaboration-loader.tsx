import { lazy, Suspense } from 'react';
import type { Objective } from './objectives';

const Panel = lazy(() => import('./collaboration').then(m => ({ default: m.CollaborationPanel })));
const Feed = lazy(() => import('./collaboration').then(m => ({ default: m.ActivityFeed })));
const Activity = lazy(() => import('./collaboration').then(m => ({ default: m.ActivityPage })));
const Nav = lazy(() => import('./collaboration').then(m => ({ default: m.NotificationNav })));
const Notifications = lazy(() => import('./collaboration').then(m => ({ default: m.NotificationsPage })));
const loading = <p className="account-note" role="status">Loading collaboration…</p>;
export function CollaborationPanel(props: { objective: Objective }) { return <Suspense fallback={loading}><Panel {...props}/></Suspense>; }
export function ActivityFeed(props: { compact?: boolean }) { return <Suspense fallback={loading}><Feed {...props}/></Suspense>; }
export function ActivityPage() { return <Suspense fallback={loading}><Activity/></Suspense>; }
export function NotificationNav(props: { onNavigate: () => void }) { return <Suspense fallback={null}><Nav {...props}/></Suspense>; }
export function NotificationsPage() { return <Suspense fallback={loading}><Notifications/></Suspense>; }
