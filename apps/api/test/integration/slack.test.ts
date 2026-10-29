import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db.js';
import type { AccountConfig } from '../../src/accounts/security.js';
import { deliverSlack, SlackFailure } from '../../src/slack/service.js';

if (!/^okr_ch(?:09|10|12)_test_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL || 'postgresql://unused/unsafe').pathname.slice(1)))
  throw new Error('Slack integration checks require a dedicated acceptance database; use scripts/run-isolated-checks.mjs.');
process.env.SLACK_ENCRYPTION_KEY = 'a'.repeat(64);
const webhook = 'https://hooks.slack.com/services/TTEST/BTEST/fixtureSecretOnly';
const password = 'Slack integration fixture 2026';
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function fixture(t: TestContext) {
  const domain = `${randomUUID()}.slack.accounts.example`; const orgIds: string[] = [];
  const config: AccountConfig = { appUrl: 'http://localhost:8080', secure: false, emailMode: 'selfhosted', disableSignup: false };
  const app = await buildApp({ logger: false, accountConfig: config }); let address = 0;
  const client = (target: FastifyInstance = app) => {
    const cookies = new Map<string, string>(); const remoteAddress = `10.12.0.${++address}`;
    const request = async (method: Method, path: string, payload?: unknown, headers: Record<string, string> = {}) => {
      const response = await target.inject({ method, url: `/api/v1/${path}`, remoteAddress, payload: payload === undefined ? undefined : JSON.stringify(payload),
        headers: { 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers } });
      for (const cookie of response.cookies) { if (cookie.value) cookies.set(cookie.name, cookie.value); else cookies.delete(cookie.name); }
      return response;
    };
    const session = () => request('GET', 'auth/session');
    const mutate = async (path: string, payload: unknown, method: Method = 'POST', headers: Record<string, string> = {}) => request(method, path, payload, { origin: config.appUrl, 'x-csrf-token': (await session()).json().csrf, ...headers });
    return { request, session, mutate };
  };
  const owner = client(); const email = `owner@${domain}`;
  assert.equal((await owner.mutate('auth/signup', { name: 'Slack Reviewer', email, password, organization: 'Slack fixture', timezone: 'UTC' })).statusCode, 201);
  const account = (await owner.session()).json(); const orgId: string = account.memberships[0].org.id; orgIds.push(orgId);
  const root = `orgs/${orgId}`; const path = `${root}/integrations/slack`;
  t.after(async () => {
    await app.close(); const ids = (await db.user.findMany({ where: { email: { endsWith: domain } } })).map(user => user.id);
    await db.slackDelivery.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.emailOutbox.deleteMany({ where: { to: { endsWith: domain } } });
    await db.auditEvent.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.notification.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.checkIn.deleteMany({ where: { orgId: { in: orgIds } } }); await db.comment.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.objectiveLink.deleteMany({ where: { orgId: { in: orgIds } } }); await db.objective.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } }); await db.user.deleteMany({ where: { id: { in: ids } } });
  });
  const settings = { version: 0, enabled: true, objectiveUpdates: true, notifications: true, channelLabel: '#okr', webhookUrl: webhook };
  const connect = async (fields = {}) => { const response = await owner.mutate(path, { ...settings, ...fields }, 'PUT'); assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const create = async () => { const response = await owner.mutate(`${root}/objectives`, { title: 'Slack outcome', description: '', scope: 'personal', leadId: account.memberships[0].id,
    startDate: '2026-01-01', endDate: '2026-12-31', state: 'active', health: 'on_track', progressMode: 'key_results', assignments: [] }); assert.equal(response.statusCode, 201, response.body); return response.json(); };
  const due = async () => { await db.slackIntegration.update({ where: { orgId }, data: { nextSendAt: new Date(0) } }); await db.slackDelivery.updateMany({ where: { orgId, sentAt: null }, data: { nextAttemptAt: new Date(0) } }); };
  return { app, config, client, owner, account, domain, email, orgId, orgIds, root, path, settings, connect, create, due };
}
test.after(() => db.$disconnect());

test('Slack configuration enforces tenant/admin/Origin/CSRF/version checks and redacts credentials', async t => {
  const f = await fixture(t); const initial = (await f.owner.request('GET', f.path)).json(); assert.equal(initial.version, 0); assert.equal(initial.configured, false);
  const connected = await f.connect(); assert.equal(connected.configured, true); assert.equal(connected.version, 1); assert.ok(!JSON.stringify(connected).includes('fixtureSecretOnly'));
  const stored = await db.slackIntegration.findUniqueOrThrow({ where: { orgId: f.orgId } }); assert.ok(!stored.webhookCiphertext!.includes(webhook));
  assert.ok(!JSON.stringify(await db.auditEvent.findMany({ where: { orgId: f.orgId } })).includes('fixtureSecretOnly'));
  assert.equal((await f.owner.mutate(f.path, f.settings, 'PUT')).statusCode, 409);
  for (const headers of ([{ origin: 'https://evil.example' }, { 'x-csrf-token': 'wrong' }] as Record<string, string>[])) assert.equal((await f.owner.mutate(f.path, { ...f.settings, version: 1 }, 'PUT', headers)).statusCode, 403);
  assert.equal((await f.owner.mutate(f.path, { ...f.settings, version: 1, webhookUrl: 'https://localhost/private' }, 'PUT')).statusCode, 400);
  const foreign = await db.organization.create({ data: { name: 'Foreign Slack tenant' } }); f.orgIds.push(foreign.id);
  assert.equal((await f.owner.request('GET', `orgs/${foreign.id}/integrations/slack`)).statusCode, 404);
  const user = await db.user.create({ data: { email: `viewer@${f.domain}`, name: 'Viewer', passwordHash: (await db.user.findUniqueOrThrow({ where: { id: f.account.user.id } })).passwordHash, verified: true } });
  await db.membership.create({ data: { orgId: f.orgId, userId: user.id, role: 'viewer' } }); const viewer = f.client();
  assert.equal((await viewer.mutate('auth/login', { email: user.email, password })).statusCode, 200);
  for (const method of ['GET', 'PUT', 'DELETE'] as Method[]) assert.equal((method === 'GET' ? await viewer.request(method, f.path) : await viewer.mutate(f.path, method === 'DELETE' ? { version: 1 } : { ...f.settings, version: 1 }, method)).statusCode, 403);
  assert.equal((await viewer.mutate(`${f.path}/test`, { version: 1 })).statusCode, 403);
});

test('Slack captures actual metric/check-in/lifecycle snapshots and notification-only filters', async t => {
  const f = await fixture(t); await f.connect(); const o = await f.create();
  const metric = await f.owner.mutate(`${f.root}/objectives/${o.id}/key-results`, { objectiveVersion: o.version, title: 'Result', type: 'number', baseline: 0, target: 100, current: 0, unit: '%', weight: 1 }); assert.equal(metric.statusCode, 201, metric.body);
  let objective = (await f.owner.request('GET', `${f.root}/objectives/${o.id}`)).json();
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${o.id}/check-ins`, { version: objective.version, note: 'Reached the target', health: 'on_track', metrics: [{ id: objective.keyResults[0].id, version: objective.keyResults[0].version, current: 100 }] })).statusCode, 201);
  const check = await db.slackDelivery.findFirstOrThrow({ where: { orgId: f.orgId, audit: { type: 'check_in_created' } } });
  assert.ok(JSON.stringify(check.payload).includes('Achieved (active)')); assert.ok(JSON.stringify(check.payload).includes('100%'));
  objective = (await f.owner.request('GET', `${f.root}/objectives/${o.id}`)).json();
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${o.id}/lifecycle`, { version: objective.version, state: 'completed', note: 'Explicitly complete' })).statusCode, 200);
  const completed = await db.slackDelivery.findFirstOrThrow({ where: { orgId: f.orgId, audit: { type: 'objective_lifecycle' } } }); assert.ok(JSON.stringify(completed.payload).includes('completed'));
  assert.ok(JSON.stringify(check.payload).includes('Achieved (active)'));
  await f.connect({ version: 1, objectiveUpdates: false }); assert.equal(await db.slackDelivery.count({ where: { orgId: f.orgId } }), 0);
  const other = await f.create(); assert.equal(await db.slackDelivery.count({ where: { orgId: f.orgId } }), 0);
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${other.id}/comments`, { text: 'Channel notification' })).statusCode, 201);
  assert.equal(await db.slackDelivery.count({ where: { orgId: f.orgId, kind: 'notification' } }), 1);
  await f.owner.mutate(`${f.root}/objectives/${other.id}/follow`, { follow: true, version: other.version }, 'PUT');
  assert.equal(await db.slackDelivery.count({ where: { orgId: f.orgId } }), 1);
  await f.connect({ version: 2, objectiveUpdates: true, notifications: false });
  const current = (await f.owner.request('GET', `${f.root}/objectives/${other.id}`)).json();
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${other.id}/check-ins`, { version: current.version, note: 'Progress-only update', health: 'at_risk', metrics: [] })).statusCode, 201);
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${other.id}/comments`, { text: 'Filtered comment' })).statusCode, 201);
  const updatesOnly = await db.slackDelivery.findMany({ where: { orgId: f.orgId } });
  assert.equal(updatesOnly.length, 1); assert.ok(JSON.stringify(updatesOnly[0].payload).includes('Progress-only update'));
});

for (const end of ['parent', 'child'] as const) test(`${end} replacement queues both endpoint histories and rolls back when Slack queuing fails`, async t => {
  const f = await fixture(t); const old = await f.create(); const next = await f.create(); const child = await f.create();
  const connected = await f.owner.mutate(`${f.root}/links`, { sourceId: old.id, targetId: child.id, sourceVersion: old.version, targetVersion: child.version, type: 'alignment', weight: 3 }); assert.equal(connected.statusCode, 201); const link = connected.json();
  await f.connect(); const ids = [old.id, next.id, child.id]; const before = await db.objective.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }); const auditCount = await db.auditEvent.count({ where: { orgId: f.orgId } });
  const body = { sourceVersion: before.find(o => o.id === old.id)!.version, targetVersion: before.find(o => o.id === child.id)!.version, parentId: next.id, parentVersion: next.version };
  const path = `${f.root}/links/${link.id}/${end === 'parent' ? 'reparent' : 'reconnect'}`;
  const payload = end === 'parent' ? body : { sourceVersion: body.sourceVersion, targetVersion: body.targetVersion, end, objectiveId: next.id, objectiveVersion: next.version };
  const failing = db.$extends({ query: { slackDelivery: { async create() { throw new Error('Injected reparent queue failure'); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app); await actor.mutate('auth/login', { email: f.email, password });
  assert.equal((await actor.mutate(path, payload)).statusCode, 500);
  assert.deepEqual(await db.objectiveLink.findUnique({ where: { id: link.id } }), link); assert.deepEqual(await db.objective.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }), before);
  assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), auditCount); assert.equal(await db.slackDelivery.count({ where: { orgId: f.orgId } }), 0);
  assert.equal((await f.owner.mutate(path, payload)).statusCode, 200);
  const queued = await db.slackDelivery.findMany({ where: { orgId: f.orgId }, include: { audit: true } }); assert.equal(queued.length, 4);
  assert.deepEqual(queued.map(d => d.audit!.type).sort(), ['relationship_created', 'relationship_created', 'relationship_removed', 'relationship_removed']);
  assert.deepEqual(queued.map(d => d.objectiveId).sort(), (end === 'parent' ? [old.id, next.id, child.id, child.id] : [old.id, old.id, child.id, next.id]).sort()); assert.ok(queued.every(d => (d.audit!.data as any)[end === 'parent' ? 'newParentId' : 'newChildId'] === next.id));
});
test('Slack queue failure rolls back objective, check-in and audit writes atomically', async t => {
  const f = await fixture(t); await f.connect(); const o = await f.create();
  const failing = db.$extends({ query: { slackDelivery: { async create() { throw new Error('Injected Slack queue failure'); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app);
  await actor.mutate('auth/login', { email: f.email, password });
  const before = await db.auditEvent.count({ where: { orgId: f.orgId } });
  assert.equal((await actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, { version: o.version, note: 'Must roll back', health: 'off_track', metrics: [] })).statusCode, 500);
  assert.equal(await db.checkIn.count({ where: { objectiveId: o.id } }), 0); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), before);
  const updated = await db.objective.findUniqueOrThrow({ where: { id: o.id } }); assert.equal(updated.version, o.version); assert.equal(updated.health, 'on_track');
});

test('Slack outage retains the committed objective, retries safely and scrubs delivered content', async t => {
  const f = await fixture(t); await f.connect(); const o = await f.create();
  assert.equal(await deliverSlack(db, async () => { throw new Error(`Network failed ${webhook}`); }), true);
  let row = await db.slackDelivery.findFirstOrThrow({ where: { orgId: f.orgId } }); assert.equal(row.attempts, 1); assert.equal(row.lastError, 'Slack delivery unavailable'); assert.ok(row.nextAttemptAt > new Date());
  assert.equal(await db.objective.count({ where: { id: o.id } }), 1); await f.due();
  assert.equal(await deliverSlack(db, async (url, payload) => { assert.equal(url, webhook); assert.ok(JSON.stringify(payload).includes(o.title)); }), true);
  row = await db.slackDelivery.findUniqueOrThrow({ where: { id: row.id } }); assert.ok(row.sentAt); assert.deepEqual(row.payload, { delivered: true }); assert.equal(row.lastError, null);
  assert.equal((await f.owner.request('GET', f.path)).json().pending, 0);
});

test('Slack workers serialize a channel without blocking ordinary objective writes', async t => {
  const f = await fixture(t); await f.connect(); await f.create(); await f.owner.mutate(`${f.path}/test`, { version: 1 });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let sends = 0;
  const first = deliverSlack(db, async () => { sends++; started(); await gate; });
  try {
    await ready; assert.equal(await deliverSlack(db, async () => { sends++; }), false);
    await f.create(); // This inserts an FK reference while the worker holds its integration lock.
    assert.equal(sends, 1);
  } finally { release(); }
  assert.equal(await first, true); assert.equal(await deliverSlack(db, async () => { sends++; }), false);
  assert.equal(sends, 1); assert.equal(await db.slackDelivery.count({ where: { orgId: f.orgId, sentAt: { not: null } } }), 1);
});

test('Slack honors Retry-After, stops permanent failures and permits scoped manual retry', async t => {
  const f = await fixture(t); await f.connect(); await f.create(); const before = Date.now();
  await deliverSlack(db, async () => { throw new SlackFailure('Slack rate limit; delivery deferred', false, 120000); });
  const limited = await db.slackIntegration.findUniqueOrThrow({ where: { orgId: f.orgId } }); assert.ok(limited.nextSendAt.getTime() >= before + 120000);
  assert.equal(await deliverSlack(db, async () => { throw new Error('Must not send during rate limit'); }), false);
  await f.due(); await deliverSlack(db, async () => { throw new SlackFailure('Slack delivery failed (HTTP 403)', true); });
  assert.equal((await f.owner.request('GET', f.path)).json().failed, 1);
  assert.equal((await f.owner.mutate(`${f.path}/retry`, { version: 1 })).statusCode, 200);
  const row = await db.slackDelivery.findFirstOrThrow({ where: { orgId: f.orgId } }); assert.equal(row.attempts, 0); assert.equal(row.lastError, null);
});

test('Slack pauses suspended tenants and discards unsent messages on replacement/disconnect', async t => {
  const f = await fixture(t); await f.connect(); await f.create();
  await db.organization.update({ where: { id: f.orgId }, data: { active: false } }); assert.equal(await deliverSlack(db, async () => { throw new Error('Suspended tenant'); }), false);
  await db.organization.update({ where: { id: f.orgId }, data: { active: true } });
  await f.connect({ version: 1, webhookUrl: webhook.replace('fixtureSecretOnly', 'replacementSecretOnly') }); assert.equal(await db.slackDelivery.count({ where: { orgId: f.orgId } }), 0);
  await f.create(); await f.connect({ version: 2, enabled: false }); assert.equal(await deliverSlack(db, async () => { throw new Error('Paused delivery'); }), false);
  assert.equal(await db.slackDelivery.count({ where: { orgId: f.orgId } }), 0);
  assert.equal((await f.owner.mutate(f.path, { version: 3 }, 'DELETE')).statusCode, 200);
  const status = (await f.owner.request('GET', f.path)).json(); assert.equal(status.configured, false); assert.equal(status.version, 4);
});

test('Slack delivery database constraints reject foreign objective/audit references', async t => {
  const f = await fixture(t); await f.connect(); const other = await db.organization.create({ data: { name: 'Foreign delivery' } }); f.orgIds.push(other.id);
  const membership = await db.membership.create({ data: { orgId: other.id, userId: f.account.user.id, role: 'owner' } });
  const objective = await db.objective.create({ data: { orgId: other.id, leadId: membership.id, title: 'Foreign objective', startDate: '2026-01-01', endDate: '2026-12-31' } });
  const audit = await db.auditEvent.create({ data: { orgId: other.id, objectiveId: objective.id, userId: f.account.user.id, type: 'objective_created', text: 'Foreign audit' } });
  const data = { orgId: f.orgId, integrationVersion: 1, kind: 'objective', payload: {} };
  await assert.rejects(db.slackDelivery.create({ data: { ...data, objectiveId: objective.id } }), { code: 'P2003' });
  await assert.rejects(db.slackDelivery.create({ data: { ...data, auditId: audit.id } }), { code: 'P2003' });
});
