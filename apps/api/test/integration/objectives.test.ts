import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db.js';
import type { AccountConfig } from '../../src/accounts/security.js';
import { todayInTimezone } from '../../src/objectives/domain.js';
import { mailStatus, retryMail } from '../../src/accounts/mail-operations.js';
import { deliverOne } from '../../src/accounts/mail.js';

const password = 'Secure objective tests 2026';
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function fixture(t: TestContext, emailMode: 'selfhosted' | 'smtp' = 'selfhosted') {
  const domain = `${randomUUID()}.objectives.accounts.example`; const orgIds: string[] = [];
  const config: AccountConfig = { appUrl: 'http://localhost:8080', secure: false, emailMode, disableSignup: false };
  const app = await buildApp({ logger: false, accountConfig: config }); let address = 0;
  t.after(async () => {
    await app.close(); const users = await db.user.findMany({ where: { email: { endsWith: domain } } }); const ids = users.map(u => u.id);
    await db.emailOutbox.deleteMany({ where: { to: { endsWith: domain } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ orgId: { in: orgIds } }, { userId: { in: ids } }] } });
    await db.objectiveLink.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.notification.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.checkIn.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.comment.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.objective.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.membership.deleteMany({ where: { userId: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: ids } } });
  });
  const client = (targetApp: FastifyInstance = app) => {
    const cookies = new Map<string, string>(); const remoteAddress = `10.5.0.${++address}`;
    const request = async (method: Method, path: string, payload?: unknown, headers: Record<string, string> = {}) => {
      const result = await targetApp.inject({ method, url: `/api/v1/${path}`, remoteAddress, payload: payload === undefined ? undefined : JSON.stringify(payload), headers: { 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers } });
      for (const cookie of result.cookies) { if (cookie.value) cookies.set(cookie.name, cookie.value); else cookies.delete(cookie.name); } return result;
    };
    const session = () => request('GET', 'auth/session');
    const mutate = async (path: string, payload: unknown, method: Method = 'POST', headers: Record<string, string> = {}) => request(method, path, payload, { origin: config.appUrl, 'x-csrf-token': (await session()).json().csrf, ...headers });
    return { request, mutate, session };
  };
  const owner = client(); const signup = await owner.mutate('auth/signup', { name: 'Objective Owner', email: `owner@${domain}`, password, organization: 'Objective fixture', timezone: 'America/Toronto' }); assert.equal(signup.statusCode, 201, signup.body);
  const account = (await owner.session()).json(); const orgId: string = account.memberships[0].org.id; orgIds.push(orgId); const leadId: string = account.memberships[0].id; const root = `orgs/${orgId}`;
  const member = async (role = 'member', active = true) => {
    const user = await db.user.create({ data: { email: `${randomUUID()}@${domain}`, name: `Test ${role}`, passwordHash: (await db.user.findUniqueOrThrow({ where: { id: account.user.id } })).passwordHash, verified: true } });
    const membership = await db.membership.create({ data: { orgId, userId: user.id, role, active } }); const actor = client(); assert.equal((await actor.mutate('auth/login', { email: user.email, password })).statusCode, 200); return { user, membership, actor };
  };
  const input = { title: 'Improve outcomes', description: '', scope: 'personal', leadId, startDate: '2026-01-01', endDate: '2026-03-31', state: 'active', health: 'on_track', progressMode: 'key_results', assignments: [] };
  const create = async (fields: Record<string, unknown> = {}, actor = owner) => { const response = await actor.mutate(`${root}/objectives`, { ...input, ...fields }); assert.equal(response.statusCode, 201, response.body); return response.json(); };
  const get = async (id: string, actor = owner) => (await actor.request('GET', `${root}/objectives/${id}`)).json();
  const metric = async (id: string, fields: Record<string, unknown> = {}) => { const objective = await get(id); const response = await owner.mutate(`${root}/objectives/${id}/key-results`, { title: 'Measurable result', type: 'number', baseline: 0, target: 100, current: 50, weight: 1, unit: '%', objectiveVersion: objective.version, ...fields }); assert.equal(response.statusCode, 201, response.body); return response.json(); };
  return { app, config, domain, orgIds, orgId, root, leadId, owner, account, client, member, input, create, get, metric };
}
test.after(() => db.$disconnect());

const checkBody = (o: any, fields: Record<string, unknown> = {}) => ({ version: o.version, health: 'at_risk', note: 'Progress with a blocker', metrics: o.keyResults.map((kr: any) => ({ id: kr.id, current: 80, version: kr.version })), ...fields });
test('check-ins atomically update multiple metrics, health, rollups, versions and immutable snapshots', async t => {
  const f = await fixture(t); const person = await f.member(); const parent = await f.create({ progressMode: 'children' }); const child = await f.create({ assignments: [{ membershipId: person.membership.id, role: 'contributor' }] });
  await f.metric(child.id, { current: 0 }); await f.metric(child.id, { type: 'binary', current: 0, title: 'Binary result' }); await connect(f, parent.id, child.id);
  const before = await f.get(child.id); const parentBefore = await f.get(parent.id); const body = checkBody(before); body.metrics.find((m: any) => m.id === before.keyResults.find((kr: any) => kr.type === 'binary').id).current = 1;
  const response = await person.actor.mutate(`${f.root}/objectives/${child.id}/check-ins`, body); assert.equal(response.statusCode, 201, response.body); const entry = response.json();
  assert.equal(entry.progress, 90); assert.equal(entry.userId, person.user.id); assert.equal(entry.metrics.mode, 'key_results'); assert.equal(entry.metrics.keyResults.length, 2); assert.ok(entry.metrics.changes.every((m: any) => m.before === 0));
  const after = await f.get(child.id); assert.equal(after.health, 'at_risk'); assert.equal(after.version, before.version + 1); assert.ok(after.keyResults.every((kr: any) => kr.version === 2)); assert.equal((await f.get(parent.id)).progress, 90); assert.equal((await f.get(parent.id)).version, parentBefore.version + 1);
  assert.equal((await person.actor.mutate(`${f.root}/objectives/${child.id}/check-ins`, body)).statusCode, 409);
  assert.equal((await person.actor.mutate(`${f.root}/objectives/${child.id}/check-ins`, checkBody(after, { metrics: [], note: 'Correction as a new entry', health: 'on_track' }))).statusCode, 201);
  assert.deepEqual((await db.checkIn.findUniqueOrThrow({ where: { id: entry.id } })).metrics, entry.metrics);
  await assert.rejects(db.checkIn.update({ where: { id: entry.id }, data: { note: 'Rewrite' } }));
  const audit = await db.auditEvent.findFirstOrThrow({ where: { orgId: f.orgId, type: 'check_in_created' } }); assert.equal(audit.userId, person.user.id);
  assert.equal((await f.owner.request('GET', `${f.root}/objectives/${child.id}/check-ins?limit=1`)).json().total, 2);
  const parentFresh = await f.get(parent.id); const snapshot = await f.owner.mutate(`${f.root}/objectives/${parent.id}/check-ins`, checkBody(parentFresh, { metrics: [] })); assert.equal(snapshot.json().progress, 90); assert.equal(snapshot.json().metrics.children[0].progress, 90);
});

test('check-in rights include metric owners with own-metric limits and exclude viewers, followers and unassigned members', async t => {
  const f = await fixture(t); const metricOwner = await f.member(); const contributor = await f.member(); const coowner = await f.member(); const viewer = await f.member('viewer'); const ordinary = await f.member();
  let o = await f.create({ assignments: [{ membershipId: contributor.membership.id, role: 'contributor' }, { membershipId: coowner.membership.id, role: 'coowner' }, { membershipId: viewer.membership.id, role: 'follower' }] });
  await f.metric(o.id, { ownerId: metricOwner.membership.id }); o = await f.metric(o.id, { title: 'Other result' });
  for (const person of [viewer, ordinary]) assert.equal((await person.actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, checkBody(o))).statusCode, 403);
  assert.equal((await metricOwner.actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, checkBody(o))).statusCode, 403);
  const own = o.keyResults.find((kr: any) => kr.ownerId === metricOwner.membership.id); assert.equal((await metricOwner.actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, checkBody(o, { metrics: [{ id: own.id, current: 70, version: own.version }] }))).statusCode, 201);
  for (const person of [coowner, contributor]) { o = await f.get(o.id); assert.equal((await person.actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, checkBody(o, { metrics: [] }))).statusCode, 201); }
  o = await f.get(o.id); assert.equal((await contributor.actor.mutate(`${f.root}/objectives/${o.id}/ownership`, { version: o.version, leadId: contributor.membership.id, assignments: [] }, 'PATCH')).statusCode, 403);
  assert.equal((await contributor.actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, { ...checkBody(o, { metrics: [] }), leadId: contributor.membership.id })).statusCode, 400);
});

test('check-in invalid, duplicate, foreign and stale metric changes roll back the whole batch', async t => {
  const f = await fixture(t); const first = await f.create(); await f.metric(first.id); const o = await f.metric(first.id, { type: 'binary', current: 0 }); const foreign = await f.metric((await f.create()).id);
  const numeric = o.keyResults.find((m: any) => m.type === 'number'); const binary = o.keyResults.find((m: any) => m.type === 'binary');
  const change = { id: numeric.id, version: numeric.version, current: 99 }; const path = `${f.root}/objectives/${o.id}/check-ins`;
  for (const [metrics, status] of [[[{ ...change }, { id: binary.id, version: binary.version, current: 2 }], 400], [[change, change], 400], [[change, { id: foreign.keyResults[0].id, version: 1, current: 80 }], 404], [[change, { id: binary.id, version: 100, current: 1 }], 409]] as const) {
    assert.equal((await f.owner.mutate(path, checkBody(o, { metrics }))).statusCode, status); assert.equal((await f.get(o.id)).keyResults.find((m: any) => m.id === numeric.id).current, 50); assert.equal((await f.get(o.id)).version, o.version);
  }
  assert.equal(await db.checkIn.count({ where: { objectiveId: o.id } }), 0);
});

test('check-in/comment audit or notification failure rolls back every collaboration write', async t => {
  const f = await fixture(t); const follower = await f.member('viewer'); const o = await f.metric((await f.create({ assignments: [{ membershipId: follower.membership.id, role: 'follower' }] })).id); const parent = await f.create({ progressMode: 'children' }); await connect(f, parent.id, o.id); const current = await f.get(o.id); const beforeParent = await f.get(parent.id);
  for (const fail of ['audit', 'notification']) {
    const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) { if (fail === 'audit' && args.data.orgId === f.orgId && ['check_in_created', 'comment_created'].includes(args.data.type)) throw new Error('Injected audit failure'); return query(args); } }, notification: { async createMany({ args, query }) { if (fail === 'notification') throw new Error('Injected notification failure'); return query(args); } } } }) as unknown as PrismaClient;
    const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app); await actor.mutate('auth/login', { email: f.account.user.email, password });
    assert.equal((await actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, checkBody(current))).statusCode, 500);
    assert.equal((await actor.mutate(`${f.root}/objectives/${o.id}/comments`, { text: 'Must roll back' })).statusCode, 500);
    assert.equal((await f.get(o.id)).progress, current.progress); assert.equal((await f.get(o.id)).health, current.health); assert.equal((await f.get(o.id)).version, current.version); assert.equal((await f.get(parent.id)).version, beforeParent.version);
    assert.equal(await db.checkIn.count({ where: { objectiveId: o.id } }), 0); assert.equal(await db.comment.count({ where: { objectiveId: o.id } }), 0); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, type: { in: ['check_in_created', 'comment_created'] } } }), 0);
  }
});

test('notifications deduplicate participants, exclude actor and inactive accounts, respect mute and isolate read states', async t => {
  const f = await fixture(t); const contributor = await f.member(); const follower = await f.member('viewer'); const muted = await f.member(); const suspended = await f.member();
  const o = await f.create({ assignments: [{ membershipId: contributor.membership.id, role: 'contributor' }, { membershipId: follower.membership.id, role: 'follower' }, { membershipId: muted.membership.id, role: 'follower' }, { membershipId: suspended.membership.id, role: 'follower' }] }); await f.metric(o.id, { ownerId: contributor.membership.id }); await db.user.update({ where: { id: suspended.user.id }, data: { active: false } });
  assert.equal((await muted.actor.mutate(`${f.root}/objectives/${o.id}/notification-preference`, { enabled: false }, 'PUT')).statusCode, 200); assert.equal((await f.get(o.id, muted.actor)).notificationsEnabled, false);
  await db.notification.deleteMany({ where: { orgId: f.orgId } });
  assert.equal((await contributor.actor.mutate(`${f.root}/objectives/${o.id}/comments`, { text: 'Notify participants once' })).statusCode, 201);
  const rows = await db.notification.findMany({ where: { orgId: f.orgId } }); assert.deepEqual(new Set(rows.map(n => n.userId)), new Set([f.account.user.id, follower.user.id]));
  const own = rows.find(n => n.userId === follower.user.id)!; const owner = rows.find(n => n.userId === f.account.user.id)!;
  assert.equal((await follower.actor.mutate(`${f.root}/notifications/${owner.id}/read`, { read: true }, 'PUT')).statusCode, 404);
  assert.equal((await follower.actor.mutate(`${f.root}/notifications/${own.id}/read`, { read: true }, 'PUT')).statusCode, 200); assert.equal((await follower.actor.request('GET', `${f.root}/notifications?unread=true`)).json().total, 0); assert.equal((await f.owner.request('GET', `${f.root}/notifications`)).json().unread, 1);
  assert.equal((await follower.actor.mutate(`${f.root}/notifications/${own.id}/read`, { read: false }, 'PUT')).statusCode, 200);
  assert.equal((await follower.actor.mutate(`${f.root}/notifications/read-all`, {}, 'PUT')).statusCode, 200);
  await muted.actor.mutate(`${f.root}/objectives/${o.id}/notification-preference`, { enabled: true }, 'PUT'); await contributor.actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, checkBody(await f.get(o.id)));
  assert.equal((await muted.actor.request('GET', `${f.root}/notifications`)).json().total, 1); assert.equal((await follower.actor.request('GET', `${f.root}/notifications`)).json().unread, 1);
  await db.membership.update({ where: { id: follower.membership.id }, data: { active: false } }); assert.equal((await follower.actor.request('GET', `${f.root}/notifications`)).statusCode, 404); assert.equal((await follower.actor.mutate(`${f.root}/notifications/${own.id}/read`, { read: true }, 'PUT')).statusCode, 404);
});

test('assignment notifications cover creation, lead/roles/removal and metric owners without unrelated broadcasts', async t => {
  const f = await fixture(t); const lead = await f.member(); const assigned = await f.member(); const o = await f.create({ leadId: lead.membership.id, assignments: [{ membershipId: assigned.membership.id, role: 'coowner' }] });
  assert.equal(await db.notification.count({ where: { orgId: f.orgId, userId: lead.user.id } }), 1); assert.equal(await db.notification.count({ where: { orgId: f.orgId, userId: assigned.user.id } }), 1);
  let fresh = await f.get(o.id); await f.owner.mutate(`${f.root}/objectives/${o.id}`, { ...fresh, description: 'No assignment change' }, 'PATCH'); assert.equal(await db.notification.count({ where: { orgId: f.orgId } }), 2);
  fresh = await f.get(o.id); await f.owner.mutate(`${f.root}/objectives/${o.id}/ownership`, { version: fresh.version, leadId: f.leadId, assignments: [{ membershipId: assigned.membership.id, role: 'contributor' }] }, 'PATCH'); assert.equal(await db.notification.count({ where: { orgId: f.orgId, userId: lead.user.id } }), 2); assert.equal(await db.notification.count({ where: { orgId: f.orgId, userId: assigned.user.id } }), 2);
  fresh = await f.metric(o.id, { ownerId: assigned.membership.id }); assert.equal(await db.notification.count({ where: { orgId: f.orgId, userId: assigned.user.id } }), 3);
  const kr = fresh.keyResults[0]; await f.owner.mutate(`${f.root}/objectives/${o.id}/key-results/${kr.id}/owner`, { version: kr.version, objectiveVersion: fresh.version, ownerId: lead.membership.id }, 'PATCH'); assert.equal(await db.notification.count({ where: { orgId: f.orgId, userId: lead.user.id } }), 3);
});

test('archived collaboration remains readable with authorship after suspension; viewers cannot comment; feed omits admin events', async t => {
  const f = await fixture(t); const person = await f.member(); const viewer = await f.member('viewer'); let o = await f.create({ assignments: [{ membershipId: person.membership.id, role: 'contributor' }] });
  await person.actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, checkBody(o, { metrics: [] })); o = await f.get(o.id); await f.owner.mutate(`${f.root}/objectives/${o.id}/archive`, { version: o.version, archived: true });
  assert.equal((await person.actor.mutate(`${f.root}/objectives/${o.id}/check-ins`, checkBody(await f.get(o.id), { metrics: [] }))).statusCode, 409);
  const comment = await person.actor.mutate(`${f.root}/objectives/${o.id}/comments`, { text: 'Archived discussion' }); assert.equal(comment.statusCode, 201); await assert.rejects(db.comment.update({ where: { id: comment.json().id }, data: { text: 'Rewrite' } }));
  assert.equal((await viewer.actor.mutate(`${f.root}/objectives/${o.id}/comments`, { text: 'Denied' })).statusCode, 403);
  await db.membership.update({ where: { id: person.membership.id }, data: { active: false } }); const checks = await viewer.actor.request('GET', `${f.root}/objectives/${o.id}/check-ins`); assert.equal(checks.json().items[0].user.name, person.user.name);
  const comments = (await viewer.actor.request('GET', `${f.root}/objectives/${o.id}/comments`)).json(); assert.equal(comments.items[0].text, 'Archived discussion');
  const feed = (await viewer.actor.request('GET', `${f.root}/activity?limit=2`)).json(); assert.equal(feed.items.length, 2); assert.ok(feed.items.every((e: any) => e.objectiveId === o.id)); assert.ok(feed.total >= 4); assert.ok(feed.items.some((e: any) => e.type === 'comment_created'));
});

test('collaboration rejects cross-tenant resources, revoked sessions, forged origins and unverified SMTP writes', async t => {
  const f = await fixture(t, 'smtp'); const o = await db.objective.create({ data: { orgId: f.orgId, leadId: f.leadId, title: 'Unverified fixture', startDate: '2026-01-01', endDate: '2026-03-31' } }); const path = `${f.root}/objectives/${o.id}`;
  assert.equal((await f.owner.mutate(`${path}/comments`, { text: 'Denied' })).statusCode, 403);
  assert.equal((await f.owner.mutate(`${path}/check-ins`, checkBody({ ...o, keyResults: [] }))).statusCode, 403);
  await db.user.update({ where: { id: f.account.user.id }, data: { verified: true } });
  assert.equal((await f.owner.mutate(`${path}/comments`, { text: 'Denied' }, 'POST', { origin: 'https://forged.example' })).statusCode, 403); assert.equal((await f.owner.request('POST', `${path}/comments`, { text: 'Denied' }, { origin: f.config.appUrl })).statusCode, 403);
  const other = await db.organization.create({ data: { name: 'Other collaboration tenant' } }); f.orgIds.push(other.id); const member = await db.membership.create({ data: { orgId: other.id, userId: f.account.user.id, role: 'owner' } }); const foreign = await db.objective.create({ data: { orgId: other.id, leadId: member.id, title: 'Foreign', startDate: '2026-01-01', endDate: '2026-03-31' } });
  for (const suffix of ['comments', 'check-ins']) assert.equal((await f.owner.request('GET', `${f.root}/objectives/${foreign.id}/${suffix}`)).statusCode, 404);
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${foreign.id}/comments`, { text: 'Denied' })).statusCode, 404); assert.equal((await f.owner.mutate(`${f.root}/objectives/${foreign.id}/notification-preference`, { enabled: false }, 'PUT')).statusCode, 404);
  await db.session.deleteMany({ where: { userId: f.account.user.id } }); assert.equal((await f.owner.request('GET', `${f.root}/activity`)).statusCode, 401);
});

test('distinct actors racing check-ins or completion cannot commit a stale snapshot', async t => {
  const f = await fixture(t); const person = await f.member(); const o = await f.metric((await f.create({ assignments: [{ membershipId: person.membership.id, role: 'contributor' }] })).id); const path = `${f.root}/objectives/${o.id}`;
  const results = await Promise.all([f.owner.mutate(`${path}/check-ins`, checkBody(o)), person.actor.mutate(`${path}/check-ins`, checkBody(o, { note: 'Concurrent check-in' }))]); assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]); assert.equal(await db.checkIn.count({ where: { objectiveId: o.id } }), 1);
  const current = await f.get(o.id); const race = await Promise.all([person.actor.mutate(`${path}/check-ins`, checkBody(current, { metrics: current.keyResults.map((kr: any) => ({ id: kr.id, current: 25, version: kr.version })) })), f.owner.mutate(`${path}/lifecycle`, { version: current.version, state: 'completed', note: 'Race completion' })]); assert.ok(race.some(r => r.statusCode === 409)); const final = await f.get(o.id); if (final.state === 'completed') assert.equal(final.finalScore, 80); else assert.equal(final.progress, 25);
});

test('assignment notification failure rolls back new objectives and ownership changes', async t => {
  const f = await fixture(t); const person = await f.member(); const o = await f.create();
  const failing = db.$extends({ query: { notification: { async createMany() { throw new Error('Injected assignment notification failure'); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app); await actor.mutate('auth/login', { email: f.account.user.email, password });
  assert.equal((await actor.mutate(`${f.root}/objectives`, { ...f.input, leadId: person.membership.id })).statusCode, 500); assert.equal(await db.objective.count({ where: { orgId: f.orgId } }), 1);
  assert.equal((await actor.mutate(`${f.root}/objectives/${o.id}/ownership`, { version: o.version, leadId: person.membership.id, assignments: [] }, 'PATCH')).statusCode, 500); assert.equal((await f.get(o.id)).leadId, f.leadId); assert.equal((await f.get(o.id)).version, o.version); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, type: 'ownership_updated' } }), 0);
});

test('notification IDs and activity never cross organizations even for a member of both', async t => {
  const f = await fixture(t); const local = await f.create(); const other = await db.organization.create({ data: { name: 'Foreign notifications' } }); f.orgIds.push(other.id); const member = await db.membership.create({ data: { orgId: other.id, userId: f.account.user.id, role: 'owner' } });
  const foreign = await db.objective.create({ data: { orgId: other.id, leadId: member.id, title: 'Private other tenant', startDate: '2026-01-01', endDate: '2026-03-31' } }); const notification = await db.notification.create({ data: { orgId: other.id, userId: f.account.user.id, objectiveId: foreign.id, text: 'Other tenant notification' } }); await db.auditEvent.create({ data: { orgId: other.id, objectiveId: foreign.id, userId: f.account.user.id, type: 'comment_created', text: 'Other tenant activity' } });
  assert.equal((await f.owner.mutate(`${f.root}/notifications/${notification.id}/read`, { read: true }, 'PUT')).statusCode, 404); assert.equal((await f.owner.request('GET', `${f.root}/notifications`)).json().total, 0); const activity = (await f.owner.request('GET', `${f.root}/activity`)).json(); assert.ok(activity.items.every((a: any) => a.objectiveId === local.id)); assert.equal((await f.owner.request('GET', `orgs/${other.id}/notifications`)).json().total, 1);
});

test('trusted-host mail diagnostics omit secrets; exhausted retry is audited and serialized with workers', async t => {
  const f = await fixture(t); const row = await db.emailOutbox.create({ data: { to: f.account.user.email, subject: 'Private subject', text: 'Secret token=private', attempts: 5, lastError: 'Old secret error' } });
  const status = await mailStatus(db); assert.ok(status.failed >= 1); const listed = status.latest.find(r => r.id === row.id)!; assert.equal('text' in listed, false); assert.equal('to' in listed, false); assert.equal('subject' in listed, false); assert.equal('lastError' in listed, false);
  const races = await Promise.allSettled([retryMail(db, row.id, f.account.user.email), retryMail(db, row.id, f.account.user.email)]); assert.equal(races.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await db.auditEvent.count({ where: { userId: f.account.user.id, type: 'operator_mail_retry' } }), 1);
  let sent = 0; await Promise.all([deliverOne(db, async () => { sent++; }), deliverOne(db, async () => { sent++; })]); assert.equal(sent, 1); await assert.rejects(retryMail(db, row.id, f.account.user.email));
  assert.equal((await db.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).text, '[Delivered account message removed]');
});

test('child creation commits alignment, audits, rollup and ancestor versions together', async t => {
  const f = await fixture(t); const top = await f.create({ title: 'Child creation ancestor', progressMode: 'children' }); const parent = await f.create({ title: 'Child creation parent', progressMode: 'children' }); const existing = await f.create(); await f.metric(existing.id, { current: 100 }); await connect(f, top.id, parent.id); await connect(f, parent.id, existing.id);
  const before = await f.get(parent.id); const ancestor = await f.get(top.id);
  const response = await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, title: 'New aligned child', parentVersion: before.version }); assert.equal(response.statusCode, 201, response.body); const child = response.json();
  assert.equal(child.version, 2); assert.equal(child.canEdit, true); assert.equal(child.progress, 0); assert.equal((await f.get(parent.id)).progress, 50); assert.equal((await f.get(top.id)).progress, 50); assert.equal((await f.get(parent.id)).version, before.version + 1); assert.equal((await f.get(top.id)).version, ancestor.version + 1);
  const link = await db.objectiveLink.findFirstOrThrow({ where: { orgId: f.orgId, sourceId: parent.id, targetId: child.id } }); assert.equal(link.type, 'alignment'); assert.equal(link.weight, 1);
  const audits = await db.auditEvent.findMany({ where: { orgId: f.orgId, OR: [{ objectiveId: child.id }, { objectiveId: parent.id, type: 'relationship_created' }] } }); assert.equal(audits.filter(a => a.objectiveId === child.id && a.type === 'objective_created').length, 1); assert.equal(audits.filter(a => a.type === 'relationship_created' && (a.data as any).linkId === link.id).length, 2); assert.ok(audits.every(a => a.userId === f.account.user.id));
});

test('child creation requires parent editing, allowed scope and editing rights on the new child', async t => {
  const f = await fixture(t); const editor = await f.member(); const contributor = await f.member(); const viewer = await f.member('viewer'); const manager = await f.member('manager'); const parent = await f.create({ assignments: [{ membershipId: editor.membership.id, role: 'coowner' }, { membershipId: contributor.membership.id, role: 'contributor' }, { membershipId: manager.membership.id, role: 'coowner' }] });
  for (const actor of [contributor, viewer]) assert.equal((await actor.actor.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, leadId: actor.membership.id, parentVersion: parent.version })).statusCode, 403);
  assert.equal((await editor.actor.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, scope: 'company', leadId: editor.membership.id, parentVersion: parent.version })).statusCode, 403);
  assert.equal((await manager.actor.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, scope: 'company', leadId: editor.membership.id, parentVersion: parent.version })).statusCode, 403);
  assert.equal(await db.objective.count({ where: { orgId: f.orgId } }), 1); assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId } }), 0);
  const response = await editor.actor.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, leadId: editor.membership.id, parentVersion: parent.version }); assert.equal(response.statusCode, 201, response.body); assert.equal(response.json().leadId, editor.membership.id);
});

test('child creation rejects foreign parents and references and locked parents without orphan records', async t => {
  const f = await fixture(t); const parent = await f.create(); const foreign = await db.organization.create({ data: { name: 'Foreign child creation' } }); f.orgIds.push(foreign.id); const foreignMember = await db.membership.create({ data: { orgId: foreign.id, userId: f.account.user.id, role: 'owner' } }); const foreignObjective = await db.objective.create({ data: { orgId: foreign.id, leadId: foreignMember.id, title: 'Foreign parent', startDate: '2026-01-01', endDate: '2026-03-31' } });
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${foreignObjective.id}/children`, { ...f.input, parentVersion: 1 })).statusCode, 404); assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, leadId: foreignMember.id, parentVersion: parent.version })).statusCode, 404);
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input })).statusCode, 400); assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, state: 'completed', parentVersion: parent.version })).statusCode, 400);
  for (const state of ['completed', 'cancelled']) { await close(f, parent.id, state); const current = await f.get(parent.id); assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, parentVersion: current.version })).json().error.code, 'OBJECTIVE_LOCKED'); await close(f, parent.id, 'active'); }
  const current = await f.get(parent.id); await f.owner.mutate(`${f.root}/objectives/${parent.id}/archive`, { archived: true, version: current.version }); assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, parentVersion: (await f.get(parent.id)).version })).json().error.code, 'OBJECTIVE_LOCKED');
  assert.equal(await db.objective.count({ where: { orgId: f.orgId } }), 1); assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId } }), 0);
});

test('concurrent child creation serializes distinct accounts and stale requests create no child', async t => {
  const f = await fixture(t); const admin = await f.member('admin'); const parent = await f.create(); const input = { ...f.input, parentVersion: parent.version };
  const responses = await Promise.all([f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, { ...input, title: 'First contender' }), admin.actor.mutate(`${f.root}/objectives/${parent.id}/children`, { ...input, title: 'Second contender' })]); assert.deepEqual(responses.map(r => r.statusCode).sort(), [201, 409]); assert.equal(await db.objective.count({ where: { orgId: f.orgId } }), 2); assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId } }), 1);
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, input)).statusCode, 409); assert.equal(await db.objective.count({ where: { orgId: f.orgId } }), 2);
});

test('child relationship audit failure rolls back objective, assignments, link and ancestor versions', async t => {
  const f = await fixture(t); const coowner = await f.member(); const top = await f.create(); const parent = await f.create(); await connect(f, top.id, parent.id); const before = await f.get(parent.id); const ancestor = await f.get(top.id); const auditCount = await db.auditEvent.count({ where: { orgId: f.orgId } });
  const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) { if (args.data.orgId === f.orgId && args.data.type === 'relationship_created') throw new Error('Injected child alignment audit failure'); return query(args); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app); await actor.mutate('auth/login', { email: f.account.user.email, password });
  assert.equal((await actor.mutate(`${f.root}/objectives/${parent.id}/children`, { ...f.input, parentVersion: before.version, assignments: [{ membershipId: coowner.membership.id, role: 'coowner' }] })).statusCode, 500); assert.equal(await db.objective.count({ where: { orgId: f.orgId } }), 2); assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId } }), 1); assert.equal(await db.assignment.count({ where: { orgId: f.orgId } }), 0); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), auditCount); assert.equal((await f.get(parent.id)).version, before.version); assert.equal((await f.get(top.id)).version, ancestor.version);
});

test('child creation rechecks SMTP verification, Origin, CSRF and active tenant access', async t => {
  const f = await fixture(t, 'smtp'); await db.user.update({ where: { id: f.account.user.id }, data: { verified: true } }); const parent = await f.create(); const input = { ...f.input, parentVersion: parent.version };
  for (const headers of ([{ origin: 'https://attacker.example' }, { 'x-csrf-token': 'wrong' }] as Record<string, string>[])) assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, input, 'POST', headers)).statusCode, 403);
  await db.user.update({ where: { id: f.account.user.id }, data: { verified: false } }); assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, input)).json().error.code, 'EMAIL_UNVERIFIED'); await db.user.update({ where: { id: f.account.user.id }, data: { verified: true } }); await db.organization.update({ where: { id: f.orgId }, data: { active: false } }); assert.equal((await f.owner.mutate(`${f.root}/objectives/${parent.id}/children`, input)).statusCode, 404); assert.equal(await db.objective.count({ where: { orgId: f.orgId } }), 1); assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId } }), 0);
});

async function connect(f: Awaited<ReturnType<typeof fixture>>, sourceId: string, targetId: string, type = 'alignment', weight = 1, actor = f.owner) {
  const source = await f.get(sourceId); const target = await f.get(targetId);
  return actor.mutate(`${f.root}/links`, { sourceId, targetId, type, weight, sourceVersion: source.version, targetVersion: target.version });
}
async function close(f: Awaited<ReturnType<typeof fixture>>, id: string, state: string, fields = {}) {
  const current = await f.get(id); return f.owner.mutate(`${f.root}/objectives/${id}/lifecycle`, { version: current.version, state, note: 'Lifecycle assessment', ...fields });
}
test('single-parent trees and unequal child weights recalculate ancestors, modes and unique totals', async t => {
  const f = await fixture(t); const a = await f.create({ title: 'Parent one', progressMode: 'children' }); const b = await f.create({ title: 'Sibling objective' }); const top = await f.create({ progressMode: 'children' });
  const low = await f.create(); await f.metric(low.id, { current: 20 }); const high = await f.create(); await f.metric(high.id, { current: 80 });
  await f.metric(b.id, { current: 35 });
  for (const [s, target, weight] of [[a.id, low.id, 1], [a.id, high.id, 3], [top.id, a.id, 1], [top.id, b.id, 1]] as const) assert.equal((await connect(f, s, target, 'alignment', weight)).statusCode, 201);
  assert.equal((await f.get(a.id)).progress, 65); assert.equal((await f.get(b.id)).progress, 35); assert.equal((await f.get(top.id)).progress, 50);
  const before = await f.get(top.id); const child = await f.get(low.id); const kr = child.keyResults[0]; assert.equal((await f.owner.mutate(`${f.root}/objectives/${low.id}/key-results/${kr.id}/current`, { current: 40, version: kr.version, objectiveVersion: child.version }, 'PATCH')).statusCode, 200);
  assert.equal((await f.get(top.id)).progress, 52.5); assert.ok((await f.get(top.id)).version > before.version);
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${top.id}/lifecycle`, { state: 'completed', note: 'Stale rollup', version: before.version })).statusCode, 409);
  const summary = (await f.owner.request('GET', `${f.root}/objective-summary`)).json(); assert.equal(summary.total, 5); assert.equal(summary.averageProgress, 55.5);
  const current = await f.get(a.id); assert.equal((await f.owner.mutate(`${f.root}/objectives/${a.id}`, { ...current, progressMode: 'key_results' }, 'PATCH')).json().progress, 0);
  await f.metric(a.id, { current: 12 }); assert.equal((await f.get(a.id)).progress, 12); const fresh = await f.get(a.id); assert.equal((await f.owner.mutate(`${f.root}/objectives/${a.id}`, { ...fresh, progressMode: 'children' }, 'PATCH')).json().progress, 70);
});
test('child lifecycle and archive determine contribution; completed parents freeze then reopen live', async t => {
  const f = await fixture(t); const parent = await f.create({ progressMode: 'children' }); const child = await f.create(); await f.metric(child.id, { current: 70 }); await connect(f, parent.id, child.id);
  assert.equal((await f.get(parent.id)).progress, 70);
  for (const state of ['draft', 'active', 'cancelled', 'active']) { assert.equal((await close(f, child.id, state)).statusCode, 200); assert.equal((await f.get(parent.id)).progress, state === 'active' ? 70 : 0); }
  let current = await f.get(child.id); await f.owner.mutate(`${f.root}/objectives/${child.id}/archive`, { archived: true, version: current.version }); assert.equal((await f.get(parent.id)).progress, 0);
  current = await f.get(child.id); await f.owner.mutate(`${f.root}/objectives/${child.id}/archive`, { archived: false, version: current.version });
  assert.equal((await close(f, parent.id, 'completed')).json().finalScore, 70);
  current = await f.get(child.id); const kr = current.keyResults[0]; await f.owner.mutate(`${f.root}/objectives/${child.id}/key-results/${kr.id}/current`, { current: 90, version: kr.version, objectiveVersion: current.version }, 'PATCH');
  assert.equal((await f.get(parent.id)).progress, 70); assert.equal((await close(f, parent.id, 'active')).json().progress, 90);
  await close(f, child.id, 'completed'); assert.equal((await f.get(parent.id)).progress, 90);
});
test('alignment weights and removal reject stale versions and record both endpoint audits', async t => {
  const f = await fixture(t); const parent = await f.create({ progressMode: 'children' }); const child = await f.create(); await f.metric(child.id, { current: 50 }); const link = (await connect(f, parent.id, child.id)).json();
  const s = await f.get(parent.id); const target = await f.get(child.id); const versions = { sourceVersion: s.version, targetVersion: target.version };
  assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}`, { ...versions, weight: 3 }, 'PATCH')).statusCode, 200);
  assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}`, versions, 'DELETE')).statusCode, 409);
  const source = await f.get(parent.id); const freshTarget = await f.get(child.id); assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}`, { sourceVersion: source.version, targetVersion: freshTarget.version }, 'DELETE')).statusCode, 200);
  assert.equal((await f.get(parent.id)).progress, 0); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, type: { startsWith: 'relationship_' } } }), 6);
});
async function parentChange(f: Awaited<ReturnType<typeof fixture>>, link: { id: string; sourceId: string; targetId: string }, parentId: string) {
  return { sourceVersion: (await f.get(link.sourceId)).version, targetVersion: (await f.get(link.targetId)).version, parentId, parentVersion: (await f.get(parentId)).version };
}
async function reconnectChange(f: Awaited<ReturnType<typeof fixture>>, link: { sourceId: string; targetId: string }, objectiveId: string, end = 'child') {
  return { sourceVersion: (await f.get(link.sourceId)).version, targetVersion: (await f.get(link.targetId)).version, end, objectiveId, objectiveVersion: (await f.get(objectiveId)).version };
}
test('single-parent rule rejects additional parents and moving a line to an already parented child without side effects', async t => {
  const f = await fixture(t); const parent = await f.create(); const other = await f.create(); const child = await f.create(); const attached = await f.create();
  const link = (await connect(f, parent.id, child.id)).json(); await connect(f, other.id, attached.id);
  const before = await db.objectiveLink.findMany({ where: { orgId: f.orgId }, orderBy: { id: 'asc' } }); const versions = await Promise.all([parent.id, other.id, child.id, attached.id].map(id => f.get(id))); const count = await db.auditEvent.count({ where: { orgId: f.orgId } });
  assert.equal((await connect(f, other.id, child.id)).json().error.code, 'PARENT_ALREADY_ATTACHED');
  assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}/reconnect`, await reconnectChange(f, link, attached.id))).json().error.code, 'PARENT_ALREADY_ATTACHED');
  assert.deepEqual(await db.objectiveLink.findMany({ where: { orgId: f.orgId }, orderBy: { id: 'asc' } }), before); assert.deepEqual(await Promise.all([parent.id, other.id, child.id, attached.id].map(id => f.get(id))), versions); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), count);
  // Prerequisites do not count as parents, including several for the same child.
  assert.equal((await connect(f, parent.id, child.id, 'dependency')).statusCode, 201); assert.equal((await connect(f, other.id, child.id, 'dependency')).statusCode, 201);
  assert.equal((await f.get(child.id)).alignmentParentCount, 1);
  const hidden = (await f.owner.request('GET', `${f.root}/objectives?search=${encodeURIComponent(child.title)}`)).json(); assert.ok(hidden.items.some((o: any) => o.id === child.id && o.alignmentParentCount === 1));
});
test('concurrent parent creation and reconnection serialize to leave exactly one incoming alignment', async t => {
  const f = await fixture(t); const admin = await f.member('admin'); const a = await f.create(); const b = await f.create(); const child = await f.create();
  const body = (source: any) => ({ sourceId: source.id, targetId: child.id, sourceVersion: source.version, targetVersion: child.version, type: 'alignment' });
  const results = await Promise.all([f.owner.mutate(`${f.root}/links`, body(a)), admin.actor.mutate(`${f.root}/links`, body(b))]); assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]);
  assert.equal(await db.objectiveLink.count({ where: { targetId: child.id, type: 'alignment' } }), 1);
  const winner = results.find(r => r.statusCode === 201)!.json(); const loser = winner.sourceId === a.id ? b : a; const secondChild = await f.create(); const second = (await connect(f, loser.id, secondChild.id)).json(); const target = await f.create();
  const changes = await Promise.all([reconnectChange(f, winner, target.id), reconnectChange(f, second, target.id)]);
  const moves = await Promise.all([f.owner.mutate(`${f.root}/links/${winner.id}/reconnect`, changes[0]), admin.actor.mutate(`${f.root}/links/${second.id}/reconnect`, changes[1])]); assert.deepEqual(moves.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(await db.objectiveLink.count({ where: { targetId: target.id, type: 'alignment' } }), 1); assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId, type: 'alignment' } }), 2);
});
test('reattaching a child preserves weight and unrelated links, updates rollups, versions and all endpoint histories', async t => {
  const f = await fixture(t); const top = await f.create({ progressMode: 'children' }); const parent = await f.create({ progressMode: 'children' }); const old = await f.create(); const next = await f.create(); const other = await f.create({ progressMode: 'children' });
  await f.metric(old.id, { current: 20 }); await f.metric(next.id, { current: 80 }); await connect(f, top.id, parent.id); await connect(f, other.id, old.id, 'dependency'); await connect(f, old.id, next.id, 'dependency');
  const link = (await connect(f, parent.id, old.id, 'alignment', 3)).json(); const ids = [top.id, parent.id, old.id, next.id, other.id]; const before = await Promise.all(ids.map(id => f.get(id)));
  const untouched = await db.objectiveLink.findMany({ where: { orgId: f.orgId, id: { not: link.id } }, orderBy: { id: 'asc' } });
  const response = await f.owner.mutate(`${f.root}/links/${link.id}/reconnect`, await reconnectChange(f, link, next.id)); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().id, link.id); assert.equal(response.json().sourceId, parent.id); assert.equal(response.json().targetId, next.id); assert.equal(response.json().weight, 3);
  assert.deepEqual(await db.objectiveLink.findMany({ where: { orgId: f.orgId, id: { not: link.id } }, orderBy: { id: 'asc' } }), untouched);
  const after = await Promise.all(ids.map(id => f.get(id))); assert.deepEqual(after.map(o => o.progress), [80, 80, 20, 80, 0]);
  for (let i = 0; i < ids.length; i++) assert.equal(after[i].version, before[i].version + (i === 4 ? 0 : 1));
  for (const index of [2, 3]) { assert.equal(after[index].title, before[index].title); assert.deepEqual(after[index].keyResults, before[index].keyResults); }
  const audits = await db.auditEvent.findMany({ where: { orgId: f.orgId, data: { path: ['newChildId'], equals: next.id } } });
  assert.equal(audits.length, 4); assert.deepEqual(audits.map(a => a.objectiveId).sort(), [parent.id, parent.id, old.id, next.id].sort()); assert.ok(audits.every(a => a.userId === f.account.user.id));
  // The same route moves the other end, without altering this child or its weight.
  const current = response.json(); const moved = await f.owner.mutate(`${f.root}/links/${link.id}/reconnect`, await reconnectChange(f, current, other.id, 'parent')); assert.equal(moved.statusCode, 200, moved.body); assert.equal(moved.json().sourceId, other.id); assert.equal(moved.json().targetId, next.id); assert.equal(moved.json().weight, 3);
});
test('child reconnection rejects stale versions, self, duplicate, cycles, unchanged and foreign endpoints without mutation', async t => {
  const f = await fixture(t); const parent = await f.create(); const old = await f.create(); const next = await f.create(); const ancestor = await f.create(); const duplicate = await f.create();
  const link = (await connect(f, parent.id, old.id)).json(); await connect(f, ancestor.id, parent.id); await connect(f, parent.id, duplicate.id);
  const body = await reconnectChange(f, link, next.id); const auditCount = await db.auditEvent.count({ where: { orgId: f.orgId } });
  for (const key of ['sourceVersion', 'targetVersion', 'objectiveVersion'] as const) assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}/reconnect`, { ...body, [key]: body[key] + 1 })).json().error.code, 'VERSION_CONFLICT');
  for (const [id, code] of [[parent.id, 'GRAPH_CYCLE'], [ancestor.id, 'GRAPH_CYCLE'], [duplicate.id, 'DUPLICATE_LINK'], [old.id, 'CHILD_UNCHANGED']]) assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}/reconnect`, await reconnectChange(f, link, id))).json().error.code, code);
  const foreign = await db.organization.create({ data: { name: 'Foreign reconnect' } }); f.orgIds.push(foreign.id); const member = await db.membership.create({ data: { orgId: foreign.id, userId: f.account.user.id, role: 'owner' } }); const objective = await db.objective.create({ data: { orgId: foreign.id, leadId: member.id, title: 'Foreign endpoint', startDate: '2026-01-01', endDate: '2026-03-31' } });
  assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}/reconnect`, { ...body, objectiveId: objective.id, objectiveVersion: objective.version })).statusCode, 404);
  assert.deepEqual(await db.objectiveLink.findUnique({ where: { id: link.id } }), link); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), auditCount); assert.deepEqual(await reconnectChange(f, link, next.id), body);
  const dependency = (await connect(f, parent.id, old.id, 'dependency')).json(); assert.equal((await f.owner.mutate(`${f.root}/links/${dependency.id}/reconnect`, await reconnectChange(f, dependency, next.id))).json().error.code, 'ALIGNMENT_REQUIRED');
});
test('child reconnection requires all three editors and live objectives, plus Origin, CSRF and active tenant/session', async t => {
  const f = await fixture(t); const member = await f.member(); const viewer = await f.member('viewer'); const parent = await f.create(); const old = await f.create(); const next = await f.create(); const link = (await connect(f, parent.id, old.id)).json(); const path = `${f.root}/links/${link.id}/reconnect`;
  assert.equal((await viewer.actor.mutate(path, await reconnectChange(f, link, next.id))).statusCode, 403);
  for (const id of [parent.id, old.id, next.id]) {
    assert.equal((await member.actor.mutate(path, await reconnectChange(f, link, next.id))).statusCode, 403);
    await db.assignment.create({ data: { orgId: f.orgId, objectiveId: id, membershipId: member.membership.id, role: 'coowner' } });
  }
  for (const id of [parent.id, old.id, next.id]) {
    await close(f, id, 'completed'); assert.equal((await member.actor.mutate(path, await reconnectChange(f, link, next.id))).json().error.code, 'OBJECTIVE_LOCKED'); await close(f, id, 'active');
    await f.owner.mutate(`${f.root}/objectives/${id}/archive`, { archived: true, version: (await f.get(id)).version }); assert.equal((await member.actor.mutate(path, await reconnectChange(f, link, next.id))).json().error.code, 'OBJECTIVE_LOCKED'); await f.owner.mutate(`${f.root}/objectives/${id}/archive`, { archived: false, version: (await f.get(id)).version });
  }
  const body = await reconnectChange(f, link, next.id);
  for (const headers of ([{ origin: 'https://attacker.example' }, { 'x-csrf-token': 'wrong' }] as Record<string, string>[])) assert.equal((await f.owner.mutate(path, body, 'POST', headers)).statusCode, 403);
  assert.equal((await f.owner.mutate(path, { ...body, end: 'dependency' })).statusCode, 400); assert.equal((await f.owner.mutate(path, { ...body, objectiveVersion: 0 })).statusCode, 400);
  await db.organization.update({ where: { id: f.orgId }, data: { active: false } }); assert.equal((await f.owner.mutate(path, body)).statusCode, 404); await db.organization.update({ where: { id: f.orgId }, data: { active: true } });
  await db.session.deleteMany({ where: { userId: f.account.user.id } }); assert.equal((await f.owner.mutate(path, body)).statusCode, 401);
  assert.equal((await member.actor.mutate(path, body)).statusCode, 200);
});
test('child reconnection rolls back after a later audit failure and concurrent opposing reconnections cannot create a cycle', async t => {
  const f = await fixture(t); const admin = await f.member('admin'); const a = await f.create(); const b = await f.create(); const x = await f.create(); const y = await f.create();
  const ax = (await connect(f, a.id, x.id)).json(); const by = (await connect(f, b.id, y.id)).json(); const before = await db.objective.findMany({ where: { orgId: f.orgId }, orderBy: { id: 'asc' } }); const auditCount = await db.auditEvent.count({ where: { orgId: f.orgId } });
  const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) { if (args.data.orgId === f.orgId && args.data.type === 'relationship_created') throw new Error('Injected reconnect audit failure'); return query(args); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app); await actor.mutate('auth/login', { email: f.account.user.email, password });
  assert.equal((await actor.mutate(`${f.root}/links/${ax.id}/reconnect`, await reconnectChange(f, ax, b.id))).statusCode, 500);
  assert.deepEqual(await db.objectiveLink.findUnique({ where: { id: ax.id } }), ax); assert.deepEqual(await db.objective.findMany({ where: { orgId: f.orgId }, orderBy: { id: 'asc' } }), before); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), auditCount);
  const results = await Promise.all([f.owner.mutate(`${f.root}/links/${ax.id}/reconnect`, await reconnectChange(f, ax, b.id)), admin.actor.mutate(`${f.root}/links/${by.id}/reconnect`, await reconnectChange(f, by, a.id))]); assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const losing = results[0].statusCode === 200 ? by : ax; const replacement = results[0].statusCode === 200 ? a.id : b.id; assert.equal((await f.owner.mutate(`${f.root}/links/${losing.id}/reconnect`, await reconnectChange(f, losing, replacement))).json().error.code, 'GRAPH_CYCLE');
});
test('changing one parent preserves other relationships and weight, recalculates both ancestries and audits atomically', async t => {
  const f = await fixture(t); const topOld = await f.create({ progressMode: 'children' }); const topNew = await f.create({ progressMode: 'children' });
  const old = await f.create({ title: 'Original parent', progressMode: 'children' }); const next = await f.create({ title: 'New parent', progressMode: 'children' }); const other = await f.create({ progressMode: 'children' });
  const child = await f.create({ title: 'Moving objective' }); await f.metric(child.id, { current: 75 }); const nested = await f.create();
  await connect(f, topOld.id, old.id); await connect(f, topNew.id, next.id); await connect(f, other.id, child.id, 'dependency'); await connect(f, child.id, nested.id); await connect(f, old.id, child.id, 'dependency');
  const link = (await connect(f, old.id, child.id, 'alignment', 3)).json();
  const ids = [topOld.id, topNew.id, old.id, next.id, other.id, child.id]; const before = await Promise.all(ids.map(id => f.get(id)));
  const untouched = await db.objectiveLink.findMany({ where: { orgId: f.orgId, id: { not: link.id } }, orderBy: { id: 'asc' } }); const auditCount = await db.auditEvent.count({ where: { orgId: f.orgId } });
  const response = await f.owner.mutate(`${f.root}/links/${link.id}/reparent`, await parentChange(f, link, next.id)); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().id, link.id); assert.equal(response.json().weight, 3); assert.equal(response.json().sourceId, next.id);
  assert.deepEqual(await db.objectiveLink.findMany({ where: { orgId: f.orgId, id: { not: link.id } }, orderBy: { id: 'asc' } }), untouched);
  const after = await Promise.all(ids.map(id => f.get(id))); assert.deepEqual(after.map(o => o.progress), [0, 75, 0, 75, 0, 75]);
  for (let i = 0; i < ids.length; i++) assert.equal(after[i].version, before[i].version + (i === 4 ? 0 : 1));
  assert.equal(after[5].title, before[5].title); assert.deepEqual(after[5].keyResults, before[5].keyResults); assert.equal(after[5].state, before[5].state);
  assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), auditCount + 4);
  const audits = await db.auditEvent.findMany({ where: { orgId: f.orgId, data: { path: ['newParentId'], equals: next.id } } });
  assert.equal(audits.length, 4); assert.ok(audits.every(a => a.userId === f.account.user.id)); assert.deepEqual(audits.map(a => a.objectiveId).sort(), [old.id, next.id, child.id, child.id].sort());
});
test('changing parents rejects each stale objective version without detaching or auditing', async t => {
  const f = await fixture(t); const old = await f.create(); const next = await f.create(); const child = await f.create(); const link = (await connect(f, old.id, child.id)).json();
  const body = await parentChange(f, link, next.id); const auditCount = await db.auditEvent.count({ where: { orgId: f.orgId } });
  for (const key of ['sourceVersion', 'targetVersion', 'parentVersion'] as const) {
    const r = await f.owner.mutate(`${f.root}/links/${link.id}/reparent`, { ...body, [key]: body[key] + 1 }); assert.equal(r.json().error.code, 'VERSION_CONFLICT');
  }
  assert.deepEqual(await db.objectiveLink.findUnique({ where: { id: link.id } }), link);
  assert.deepEqual(await parentChange(f, link, next.id), body); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), auditCount);
});
test('changing parents rejects cycles, self, unchanged, foreign and prerequisite links', async t => {
  const f = await fixture(t); const old = await f.create(); const child = await f.create(); const descendant = await f.create(); const other = await f.create();
  const link = (await connect(f, old.id, child.id)).json(); await connect(f, child.id, descendant.id);
  for (const [id, code] of [[child.id, 'GRAPH_CYCLE'], [descendant.id, 'GRAPH_CYCLE'], [old.id, 'PARENT_UNCHANGED']]) {
    const r = await f.owner.mutate(`${f.root}/links/${link.id}/reparent`, await parentChange(f, link, id)); assert.equal(r.json().error.code, code, r.body);
  }
  const foreign = await db.organization.create({ data: { name: 'Foreign parents' } }); f.orgIds.push(foreign.id); const member = await db.membership.create({ data: { orgId: foreign.id, userId: f.account.user.id, role: 'owner' } });
  const foreignParent = await db.objective.create({ data: { orgId: foreign.id, leadId: member.id, title: 'Foreign parent', startDate: '2026-01-01', endDate: '2026-03-31' } });
  const body = { ...await parentChange(f, link, other.id), parentId: foreignParent.id, parentVersion: foreignParent.version };
  assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}/reparent`, body)).statusCode, 404);
  const foreignLink = await db.objectiveLink.create({ data: { orgId: foreign.id, sourceId: foreignParent.id, targetId: (await db.objective.create({ data: { orgId: foreign.id, leadId: member.id, title: 'Foreign child', startDate: '2026-01-01', endDate: '2026-03-31' } })).id, type: 'alignment' } });
  assert.equal((await f.owner.mutate(`${f.root}/links/${foreignLink.id}/reparent`, body)).statusCode, 404);
  const dependency = (await connect(f, old.id, child.id, 'dependency')).json(); assert.equal((await f.owner.mutate(`${f.root}/links/${dependency.id}/reparent`, await parentChange(f, dependency, other.id))).json().error.code, 'ALIGNMENT_REQUIRED');
  assert.equal((await db.objectiveLink.findUniqueOrThrow({ where: { id: link.id } })).sourceId, old.id);
});
test('changing parents requires all three editors and live unarchived objectives', async t => {
  const f = await fixture(t); const member = await f.member(); const viewer = await f.member('viewer'); const contributor = await f.member();
  const old = await f.create(); const next = await f.create(); const child = await f.create({ assignments: [{ membershipId: contributor.membership.id, role: 'contributor' }] }); const link = (await connect(f, old.id, child.id)).json();
  for (const actor of [member.actor, viewer.actor, contributor.actor]) assert.equal((await actor.mutate(`${f.root}/links/${link.id}/reparent`, await parentChange(f, link, next.id))).statusCode, 403);
  // Grant edits one endpoint at a time: neither the child nor either parent can be skipped.
  for (const id of [child.id, old.id, next.id]) {
    assert.equal((await member.actor.mutate(`${f.root}/links/${link.id}/reparent`, await parentChange(f, link, next.id))).statusCode, 403);
    await db.assignment.create({ data: { orgId: f.orgId, objectiveId: id, membershipId: member.membership.id, role: 'coowner' } });
  }
  for (const id of [old.id, next.id, child.id]) {
    await close(f, id, 'completed'); assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}/reparent`, await parentChange(f, link, next.id))).json().error.code, 'OBJECTIVE_LOCKED'); await close(f, id, 'active');
    await f.owner.mutate(`${f.root}/objectives/${id}/archive`, { archived: true, version: (await f.get(id)).version }); assert.equal((await f.owner.mutate(`${f.root}/links/${link.id}/reparent`, await parentChange(f, link, next.id))).json().error.code, 'OBJECTIVE_LOCKED');
    await f.owner.mutate(`${f.root}/objectives/${id}/archive`, { archived: false, version: (await f.get(id)).version });
  }
  assert.equal((await member.actor.mutate(`${f.root}/links/${link.id}/reparent`, await parentChange(f, link, next.id))).statusCode, 200);
});
test('parent replacement rolls back even when a later new-parent audit fails', async t => {
  const f = await fixture(t); const top = await f.create({ progressMode: 'children' }); const old = await f.create({ progressMode: 'children' }); const next = await f.create({ progressMode: 'children' }); const child = await f.create(); await f.metric(child.id); await connect(f, top.id, old.id);
  const link = (await connect(f, old.id, child.id)).json(); const ids = [top.id, old.id, next.id, child.id]; const before = await Promise.all(ids.map(id => f.get(id))); const auditCount = await db.auditEvent.count({ where: { orgId: f.orgId } });
  const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) { if (args.data.orgId === f.orgId && args.data.type === 'relationship_created') throw new Error('Injected reparent audit failure'); return query(args); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app); await actor.mutate('auth/login', { email: f.account.user.email, password });
  assert.equal((await actor.mutate(`${f.root}/links/${link.id}/reparent`, await parentChange(f, link, next.id))).statusCode, 500);
  assert.equal((await db.objectiveLink.findUniqueOrThrow({ where: { id: link.id } })).sourceId, old.id); assert.deepEqual(await Promise.all(ids.map(id => f.get(id))), before); assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId } }), auditCount);
});
test('concurrent parent replacements serialize and cannot create opposing cycles', async t => {
  const f = await fixture(t); const admin = await f.member('admin'); const a = await f.create(); const b = await f.create(); const x = await f.create(); const y = await f.create();
  const ax = (await connect(f, a.id, x.id)).json(); const by = (await connect(f, b.id, y.id)).json();
  const bodies = await Promise.all([parentChange(f, ax, y.id), parentChange(f, by, x.id)]);
  const results = await Promise.all([f.owner.mutate(`${f.root}/links/${ax.id}/reparent`, bodies[0]), admin.actor.mutate(`${f.root}/links/${by.id}/reparent`, bodies[1])]); assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const losing = results[0].statusCode === 200 ? by : ax; const parentId = results[0].statusCode === 200 ? x.id : y.id;
  assert.equal((await f.owner.mutate(`${f.root}/links/${losing.id}/reparent`, await parentChange(f, losing, parentId))).json().error.code, 'GRAPH_CYCLE');
  assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId } }), 2);
});
test('parent replacement enforces Origin, CSRF, active tenant and session', async t => {
  const f = await fixture(t); const old = await f.create(); const child = await f.create(); const next = await f.create(); const link = (await connect(f, old.id, child.id)).json(); const path = `${f.root}/links/${link.id}/reparent`; const body = await parentChange(f, link, next.id);
  for (const headers of ([{ origin: 'https://attacker.example' }, { 'x-csrf-token': 'wrong' }] as Record<string, string>[])) assert.equal((await f.owner.mutate(path, body, 'POST', headers)).statusCode, 403);
  assert.equal((await f.owner.mutate(path, { ...body, parentVersion: 0 })).statusCode, 400);
  await db.organization.update({ where: { id: f.orgId }, data: { active: false } }); assert.equal((await f.owner.mutate(path, body)).statusCode, 404);
  await db.organization.update({ where: { id: f.orgId }, data: { active: true } }); await db.session.deleteMany({ where: { userId: f.account.user.id } }); assert.equal((await f.owner.mutate(path, body)).statusCode, 401);
  assert.equal((await db.objectiveLink.findUniqueOrThrow({ where: { id: link.id } })).sourceId, old.id);
});
test('self duplicate indirect cycles and cross-tenant graph resources are rejected independently', async t => {
  const f = await fixture(t); const a = await f.create(); const b = await f.create(); const c = await f.create();
  assert.equal((await connect(f, a.id, a.id)).json().error.code, 'GRAPH_CYCLE');
  assert.equal((await connect(f, a.id, b.id)).statusCode, 201); assert.equal((await connect(f, a.id, b.id)).json().error.code, 'DUPLICATE_LINK'); await connect(f, b.id, c.id);
  assert.equal((await connect(f, c.id, a.id)).json().error.code, 'GRAPH_CYCLE');
  assert.equal((await connect(f, c.id, a.id, 'dependency')).statusCode, 201); assert.equal((await connect(f, a.id, c.id, 'dependency')).json().error.code, 'GRAPH_CYCLE');
  const foreign = await db.organization.create({ data: { name: 'Foreign graph' } }); f.orgIds.push(foreign.id); const membership = await db.membership.create({ data: { orgId: foreign.id, userId: f.account.user.id, role: 'owner' } }); const objective = await db.objective.create({ data: { orgId: foreign.id, leadId: membership.id, title: 'Foreign node', startDate: '2026-01-01', endDate: '2026-03-31' } });
  assert.equal((await f.owner.mutate(`${f.root}/links`, { sourceId: objective.id, targetId: a.id, sourceVersion: 1, targetVersion: (await f.get(a.id)).version, type: 'alignment' })).statusCode, 404);
  const foreignLink = await db.objectiveLink.create({ data: { orgId: foreign.id, sourceId: objective.id, targetId: (await db.objective.create({ data: { orgId: foreign.id, leadId: membership.id, title: 'Foreign other', startDate: '2026-01-01', endDate: '2026-03-31' } })).id, type: 'alignment' } });
  assert.equal((await f.owner.mutate(`${f.root}/links/${foreignLink.id}`, { sourceVersion: 1, targetVersion: 1 }, 'DELETE')).statusCode, 404);
  assert.equal((await f.client().request('GET', `${f.root}/graph`)).statusCode, 401); assert.equal((await f.owner.request('GET', `${f.root}/objectives/${objective.id}/relationships`)).statusCode, 404);
});
test('concurrent opposing links in each graph never form cycles, including refreshed retries', async t => {
  const f = await fixture(t); const otherAdmin = await f.member('admin');
  for (const type of ['alignment', 'dependency']) {
    const a = await f.create(); const b = await f.create();
    const results = await Promise.all([connect(f, a.id, b.id, type), connect(f, b.id, a.id, type, 1, otherAdmin.actor)]); assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]);
    const success = results[0].statusCode === 201; assert.equal((await connect(f, success ? b.id : a.id, success ? a.id : b.id, type)).json().error.code, 'GRAPH_CYCLE');
    assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId, type } }), 1);
  }
});
test('alignment needs both editors; dependency needs dependent editor; viewers and contributors cannot link', async t => {
  const f = await fixture(t); const member = await f.member(); const viewer = await f.member('viewer'); const contributor = await f.member(); const a = await f.create(); const own = await f.create({ leadId: member.membership.id, assignments: [{ membershipId: contributor.membership.id, role: 'contributor' }] });
  assert.equal((await connect(f, a.id, own.id, 'alignment', 1, member.actor)).statusCode, 403); assert.equal((await connect(f, own.id, a.id, 'dependency', 1, member.actor)).statusCode, 403);
  for (const actor of [viewer.actor, contributor.actor]) assert.equal((await connect(f, a.id, own.id, 'dependency', 1, actor)).statusCode, 403);
  assert.equal((await connect(f, a.id, own.id, 'dependency', 1, member.actor)).statusCode, 201);
  const relations = (await member.actor.request('GET', `${f.root}/objectives/${own.id}/relationships`)).json(); assert.equal(relations[0].canChange, true); assert.equal((await viewer.actor.request('GET', `${f.root}/objectives/${own.id}/relationships`)).json()[0].canChange, false);
  const both = await f.create({ assignments: [{ membershipId: member.membership.id, role: 'coowner' }] }); assert.equal((await connect(f, both.id, own.id, 'alignment', 1, member.actor)).statusCode, 201);
  await close(f, a.id, 'completed'); const extra = await f.create({ leadId: member.membership.id }); assert.equal((await connect(f, a.id, extra.id, 'dependency', 1, member.actor)).statusCode, 201); assert.equal((await f.get(extra.id)).blocked, false);
  assert.equal((await connect(f, a.id, extra.id, 'alignment')).json().error.code, 'OBJECTIVE_LOCKED');
});
test('prerequisites warn without numeric effects; completion override is required and audited with snapshot', async t => {
  const f = await fixture(t); const prerequisite = await f.create({ state: 'draft' }); const dependent = await f.create(); await f.metric(dependent.id, { current: 60 }); await connect(f, prerequisite.id, dependent.id, 'dependency');
  const current = await f.get(dependent.id); assert.equal(current.progress, 60); assert.equal(current.blocked, true); assert.equal(current.unresolvedPrerequisites[0].id, prerequisite.id);
  assert.equal((await close(f, dependent.id, 'completed')).json().error.code, 'PREREQUISITES_UNRESOLVED'); assert.equal((await close(f, dependent.id, 'completed', { overrideNote: '   ' })).statusCode, 409);
  const done = await close(f, dependent.id, 'completed', { overrideNote: 'Approved independent delivery' }); assert.equal(done.statusCode, 200); assert.equal(done.json().dependencyOverrideNote, 'Approved independent delivery'); assert.equal(done.json().finalScore, 60);
  const audit = await db.auditEvent.findFirstOrThrow({ where: { objectiveId: dependent.id, type: 'objective_lifecycle' } }); assert.equal((audit.data as any).overrideNote, 'Approved independent delivery'); assert.equal((audit.data as any).unresolvedPrerequisites[0].state, 'draft');
  assert.equal((await close(f, dependent.id, 'active')).json().dependencyOverrideNote, ''); await close(f, prerequisite.id, 'active'); await close(f, prerequisite.id, 'cancelled'); assert.equal((await f.get(dependent.id)).blocked, true); await close(f, prerequisite.id, 'active'); await close(f, prerequisite.id, 'completed');
  assert.equal((await f.get(dependent.id)).blocked, false); assert.equal((await close(f, dependent.id, 'completed')).statusCode, 200);
});
test('graph filters preserve unique nodes, hide foreign content and indicate outside connections and cross-period links', async t => {
  const f = await fixture(t); const a = await f.create({ title: 'Visible parent', progressMode: 'children' }); const b = await f.create({ title: 'Other quarter child', startDate: '2026-04-01', endDate: '2026-06-30' }); await f.metric(b.id, { current: 75 }); await connect(f, a.id, b.id);
  const full = (await f.owner.request('GET', `${f.root}/graph`)).json(); assert.equal(full.total, 2); assert.equal(full.links.length, 1); assert.equal(full.nodes.find((o: any) => o.id === a.id).progress, 75);
  assert.equal(full.nodes.find((o: any) => o.id === a.id).alignmentParentCount, 0);
  assert.equal(full.nodes.find((o: any) => o.id === b.id).alignmentParentCount, 1);
  const childOnly = (await f.owner.request('GET', `${f.root}/graph?search=Other`)).json(); assert.equal(childOnly.nodes.length, 1); assert.equal(childOnly.links.length, 0); assert.equal(childOnly.nodes[0].alignmentParentCount, 1);
  const filtered = (await f.owner.request('GET', `${f.root}/graph?search=VISIBLE&from=2026-03-31&to=2026-03-31`)).json(); assert.equal(filtered.nodes.length, 1); assert.equal(filtered.links.length, 0); assert.equal(filtered.nodes[0].outsideConnections, 1);
  assert.equal((await f.owner.request('GET', `${f.root}/objectives/${a.id}/relationships`)).json()[0].crossPeriod, true);
  assert.equal((await f.owner.request('GET', `${f.root}/graph?type=dependency`)).json().links.length, 0);
  assert.equal((await f.owner.request('GET', `${f.root}/graph?state=completed`)).json().total, 0); assert.equal((await f.owner.request('GET', `${f.root}/graph?from=2026-05-01&to=2026-01-01`)).statusCode, 400);
  assert.equal((await f.owner.request('GET', `${f.root}/graph?periodId=${randomUUID()}`)).json().total, 0); assert.equal((await f.owner.request('GET', `${f.root}/graph?teamId=${randomUUID()}`)).json().total, 0);
  assert.ok(!/passwordHash|tokenHash|platformAdmin/.test(JSON.stringify(full)));
});
test('audit failure rolls back graph edges, endpoint and ancestor versions and dependency override', async t => {
  const f = await fixture(t); const top = await f.create({ progressMode: 'children' }); const a = await f.create({ progressMode: 'children' }); const b = await f.create(); await connect(f, top.id, a.id);
  const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) { if (args.data.orgId === f.orgId && (args.data.type.startsWith('relationship_') || args.data.type === 'objective_lifecycle')) throw new Error('Injected graph audit failure'); return query(args); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app); await actor.mutate('auth/login', { email: f.account.user.email, password });
  const before = await f.get(top.id); const parent = await f.get(a.id); assert.equal((await connect(f, a.id, b.id, 'alignment', 1, actor)).statusCode, 500); assert.equal(await db.objectiveLink.count({ where: { orgId: f.orgId } }), 1); assert.equal((await f.get(top.id)).version, before.version); assert.equal((await f.get(a.id)).version, parent.version);
  const dependency = (await connect(f, a.id, b.id, 'dependency')).json(); const current = await f.get(b.id);
  assert.equal((await actor.mutate(`${f.root}/objectives/${b.id}/lifecycle`, { state: 'completed', note: 'Assessment', overrideNote: 'Override rollback', version: current.version })).statusCode, 500); assert.equal((await f.get(b.id)).dependencyOverrideNote, ''); assert.equal((await f.get(b.id)).state, 'active');
  assert.equal((await actor.mutate(`${f.root}/links/${dependency.id}`, { sourceVersion: (await f.get(a.id)).version, targetVersion: current.version }, 'DELETE')).statusCode, 500); assert.ok(await db.objectiveLink.findUnique({ where: { id: dependency.id } }));
});
test('graph mutations recheck SMTP verification, exact Origin, CSRF, sessions and tenant activation', async t => {
  const f = await fixture(t, 'smtp'); await db.user.update({ where: { id: f.account.user.id }, data: { verified: true } }); const a = await f.create(); const b = await f.create(); const input = { sourceId: a.id, targetId: b.id, sourceVersion: 1, targetVersion: 1, type: 'alignment' };
  for (const headers of ([{ origin: 'https://attacker.example' }, { 'x-csrf-token': 'wrong' }] as Record<string, string>[])) assert.equal((await f.owner.mutate(`${f.root}/links`, input, 'POST', headers)).statusCode, 403);
  await db.user.update({ where: { id: f.account.user.id }, data: { verified: false } }); assert.equal((await f.owner.mutate(`${f.root}/links`, input)).json().error.code, 'EMAIL_UNVERIFIED');
  await db.user.update({ where: { id: f.account.user.id }, data: { verified: true } }); await db.organization.update({ where: { id: f.orgId }, data: { active: false } }); assert.equal((await f.owner.mutate(`${f.root}/links`, input)).statusCode, 404); assert.equal((await f.owner.request('GET', `${f.root}/graph`)).statusCode, 404);
  await db.organization.update({ where: { id: f.orgId }, data: { active: true } }); await db.session.deleteMany({ where: { userId: f.account.user.id } }); assert.equal((await f.owner.mutate(`${f.root}/links`, input)).statusCode, 401);
});
test('child updates racing parent completion retain consistent snapshots', async t => {
  const f = await fixture(t); const otherAdmin = await f.member('admin'); const parent = await f.create({ progressMode: 'children' }); const child = await f.create(); await f.metric(child.id, { current: 40 }); await connect(f, parent.id, child.id);
  const p = await f.get(parent.id); const c = await f.get(child.id); const metric = c.keyResults[0];
  const results = await Promise.all([f.owner.mutate(`${f.root}/objectives/${parent.id}/lifecycle`, { state: 'completed', note: 'Concurrent snapshot', version: p.version }), otherAdmin.actor.mutate(`${f.root}/objectives/${child.id}/key-results/${metric.id}/current`, { current: 90, version: metric.version, objectiveVersion: c.version }, 'PATCH')]);
  assert.equal(results[1].statusCode, 200); const final = await f.get(parent.id); if (results[0].statusCode === 200) { assert.equal(final.finalScore, 40); assert.equal(final.progress, 40); } else { assert.equal(results[0].statusCode, 409); assert.equal(final.progress, 90); }
});

test('periods have inclusive calendar dates, unique names, guarded edits and optimistic versions', async t => {
  const f = await fixture(t); const path = `${f.root}/periods`;
  const period = (await f.owner.mutate(path, { kind: 'quarter', year: 2024, quarter: 1 })).json(); assert.equal(period.startDate, '2024-01-01'); assert.equal(period.endDate, '2024-03-31');
  assert.equal((await f.owner.mutate(path, { kind: 'quarter', year: 2024, quarter: 1 })).statusCode, 409);
  assert.equal((await f.owner.mutate(path, { kind: 'custom', name: 'One day', startDate: '2024-02-29', endDate: '2024-02-29' })).statusCode, 201);
  for (const dates of [['2025-02-29', '2025-03-01'], ['2026-02-01', '2026-01-01']]) assert.equal((await f.owner.mutate(path, { kind: 'custom', name: 'Invalid dates', startDate: dates[0], endDate: dates[1] })).statusCode, 400);
  const member = await f.member(); assert.equal((await member.actor.mutate(path, { kind: 'quarter', year: 2026, quarter: 1 })).statusCode, 403);
  await f.create({ periodId: period.id, startDate: period.startDate, endDate: period.endDate });
  assert.equal((await f.owner.mutate(`${path}/${period.id}`, { ...period, startDate: '2024-01-02' }, 'PATCH')).json().error.code, 'PERIOD_IN_USE');
  const renamed = await f.owner.mutate(`${path}/${period.id}`, { ...period, name: 'Renamed quarter' }, 'PATCH'); assert.equal(renamed.statusCode, 200); assert.equal(renamed.json().version, 2);
  assert.equal((await f.owner.mutate(`${path}/${period.id}`, { version: 1 }, 'DELETE')).statusCode, 409);
  assert.equal((await f.owner.mutate(`${path}/${period.id}`, { version: 2 }, 'DELETE')).json().error.code, 'PERIOD_IN_USE');
  assert.equal((await f.owner.mutate(`${f.root}/objectives`, { ...f.input, periodId: period.id })).json().error.code, 'PERIOD_DATES');
});

test('objective, period, assignment and metric resources never cross tenant boundaries', async t => {
  const f = await fixture(t); const foreign = await db.organization.create({ data: { name: 'Foreign' } }); f.orgIds.push(foreign.id);
  const m = await f.member(); const membership = await db.membership.create({ data: { orgId: foreign.id, userId: m.user.id, role: 'owner' } });
  const period = await db.period.create({ data: { orgId: foreign.id, name: 'Foreign period', startDate: '2026-01-01', endDate: '2026-03-31' } });
  const team = await db.team.create({ data: { orgId: foreign.id, name: 'Foreign team' } });
  const objective = await db.objective.create({ data: { orgId: foreign.id, title: 'Foreign work', leadId: membership.id, startDate: period.startDate, endDate: period.endDate } });
  const local = await f.create();
  for (const path of [`orgs/${foreign.id}/objectives`, `${f.root}/objectives/${objective.id}`, `${f.root}/objectives/${objective.id}/history`]) assert.equal((await f.owner.request('GET', path)).statusCode, 404);
  for (const fields of [{ periodId: period.id }, { leadId: membership.id }, { assignments: [{ membershipId: membership.id, role: 'coowner' }] }, { scope: 'team', teamId: team.id }]) assert.equal((await f.owner.mutate(`${f.root}/objectives`, { ...f.input, ...fields })).statusCode, 404);
  assert.equal((await f.owner.mutate(`${f.root}/periods/${period.id}`, { version: 1 }, 'DELETE')).statusCode, 404);
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${local.id}/key-results/${randomUUID()}/current`, { current: 0, version: 1, objectiveVersion: 1 }, 'PATCH')).statusCode, 404);
  const read = await f.owner.request('GET', `${f.root}/objectives/${local.id}`); assert.ok(!/passwordHash|tokenHash|platformAdmin/.test(read.body));
});

test('personal, team and company creation enforce roles and team membership', async t => {
  const f = await fixture(t); const m = await f.member(); const manager = await f.member('manager'); const viewer = await f.member('viewer');
  const team = await db.team.create({ data: { orgId: f.orgId, name: 'Product' } });
  await f.create({ leadId: m.membership.id }, m.actor);
  assert.equal((await m.actor.mutate(`${f.root}/objectives`, f.input)).statusCode, 403);
  assert.equal((await m.actor.mutate(`${f.root}/objectives`, { ...f.input, scope: 'company', leadId: m.membership.id })).statusCode, 403);
  await f.create({ scope: 'company', leadId: manager.membership.id }, manager.actor);
  assert.equal((await m.actor.mutate(`${f.root}/objectives`, { ...f.input, scope: 'team', teamId: team.id, leadId: m.membership.id })).statusCode, 403);
  await db.teamMember.create({ data: { orgId: f.orgId, teamId: team.id, membershipId: m.membership.id } });
  await f.create({ scope: 'team', teamId: team.id, leadId: m.membership.id }, m.actor);
  assert.equal((await viewer.actor.mutate(`${f.root}/objectives`, { ...f.input, leadId: viewer.membership.id })).statusCode, 403);
  assert.equal((await viewer.actor.request('GET', `${f.root}/objectives`)).statusCode, 200);
});

test('co-owners edit structure; contributors and metric owners only update current values; followers read', async t => {
  const f = await fixture(t); const coowner = await f.member(); const contributor = await f.member(); const metricOwner = await f.member(); const follower = await f.member('viewer'); const outsider = await f.member();
  const created = await f.create({ assignments: [{ membershipId: coowner.membership.id, role: 'coowner' }, { membershipId: contributor.membership.id, role: 'contributor' }, { membershipId: follower.membership.id, role: 'follower' }] });
  let objective = await f.metric(created.id, { ownerId: metricOwner.membership.id }); const path = `${f.root}/objectives/${objective.id}`;
  for (const actor of [contributor.actor, metricOwner.actor, follower.actor, outsider.actor]) assert.equal((await actor.mutate(path, { ...objective, title: 'Denied structure' }, 'PATCH')).statusCode, 403);
  for (const actor of [contributor.actor, metricOwner.actor]) { const kr = objective.keyResults[0]; const result = await actor.mutate(`${path}/key-results/${kr.id}/current`, { current: 60, version: kr.version, objectiveVersion: objective.version }, 'PATCH'); assert.equal(result.statusCode, 200, result.body); objective = result.json(); }
  for (const actor of [follower.actor, outsider.actor]) assert.equal((await actor.mutate(`${path}/key-results/${objective.keyResults[0].id}/current`, { current: 80, version: objective.keyResults[0].version, objectiveVersion: objective.version }, 'PATCH')).statusCode, 403);
  const edit = await coowner.actor.mutate(path, { ...objective, title: 'Edited by co-owner' }, 'PATCH'); assert.equal(edit.statusCode, 200, edit.body);
  assert.equal((await follower.actor.request('GET', path)).json().canEdit, false);
});

test('designated managers edit only their teams without granting organization-wide structural access', async t => {
  const f = await fixture(t); const m = await f.member('manager');
  const team = await db.team.create({ data: { orgId: f.orgId, name: 'Managed team' } }); await db.teamMember.create({ data: { orgId: f.orgId, teamId: team.id, membershipId: m.membership.id, manager: true } });
  const managed = await f.create({ scope: 'team', teamId: team.id }); const personal = await f.create(); const company = await f.create({ scope: 'company' });
  assert.equal((await m.actor.mutate(`${f.root}/objectives/${managed.id}`, { ...managed, title: 'Managed edit' }, 'PATCH')).statusCode, 200);
  for (const objective of [personal, company]) assert.equal((await m.actor.mutate(`${f.root}/objectives/${objective.id}`, { ...objective, title: 'Denied edit' }, 'PATCH')).statusCode, 403);
});

test('editing assignments reject viewers, inactive users, duplicate roles and lead duplication', async t => {
  const f = await fixture(t); const viewer = await f.member('viewer'); const inactive = await f.member('member', false); const globallyInactive = await f.member(); await db.user.update({ where: { id: globallyInactive.user.id }, data: { active: false } });
  for (const m of [viewer, inactive, globallyInactive]) assert.equal((await f.owner.mutate(`${f.root}/objectives`, { ...f.input, leadId: m.membership.id })).statusCode, m === viewer ? 400 : 404);
  const follower = await f.create({ assignments: [{ membershipId: viewer.membership.id, role: 'follower' }] });
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${follower.id}/ownership`, { leadId: f.leadId, assignments: [{ membershipId: viewer.membership.id, role: 'contributor' }], version: 1 }, 'PATCH')).statusCode, 400);
  for (const assignments of [[{ membershipId: f.leadId, role: 'follower' }], [{ membershipId: viewer.membership.id, role: 'follower' }, { membershipId: viewer.membership.id, role: 'follower' }]]) assert.equal((await f.owner.mutate(`${f.root}/objectives`, { ...f.input, assignments })).statusCode, 400);
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${follower.id}/key-results`, { title: 'Viewer metric', type: 'number', baseline: 0, target: 10, current: 0, weight: 1, ownerId: viewer.membership.id, objectiveVersion: 1 })).statusCode, 400);
});

test('weighted numeric and binary scores clamp, empty objectives score zero and invalid metrics are rejected', async t => {
  const f = await fixture(t); const created = await f.create(); assert.equal(created.progress, 0);
  let objective = await f.metric(created.id, { current: 25, weight: 1 }); objective = await f.metric(created.id, { title: 'Reduce cost', baseline: 100, target: 0, current: 50, weight: 3 }); assert.equal(objective.progress, 43.75);
  objective = await f.metric(created.id, { title: 'Launch outcome', type: 'binary', baseline: 0, target: 1, current: 1, weight: 4 }); assert.equal(objective.progress, 71.875);
  for (const fields of [{ baseline: 1, target: 1 }, { weight: 0 }, { type: 'binary', baseline: 0, target: 1, current: 2 }]) assert.equal((await f.owner.mutate(`${f.root}/objectives/${created.id}/key-results`, { title: 'Invalid metric', type: 'number', baseline: 0, target: 100, current: 0, weight: 1, objectiveVersion: objective.version, ...fields })).statusCode, 400);
  const kr = objective.keyResults.find((k: { type: string }) => k.type === 'binary');
  assert.equal((await f.owner.mutate(`${f.root}/objectives/${created.id}/key-results/${kr.id}/current`, { current: 2, version: kr.version, objectiveVersion: objective.version }, 'PATCH')).statusCode, 400);
  objective = await f.metric(created.id, { title: 'Beyond target', current: 150 }); assert.equal(objective.keyResults.find((k: { title: string }) => k.title === 'Beyond target').progress, 100);
});

test('completion freezes a score and closing note; reopen and archive preserve history and require versions', async t => {
  const f = await fixture(t); const created = await f.create(); let objective = await f.metric(created.id, { current: 65 }); const path = `${f.root}/objectives/${created.id}`; const kr = objective.keyResults[0];
  assert.equal((await f.owner.mutate(`${path}/lifecycle`, { state: 'completed', version: objective.version })).statusCode, 400);
  const complete = await f.owner.mutate(`${path}/lifecycle`, { state: 'completed', note: 'Delivered most of the planned outcome', version: objective.version }); assert.equal(complete.statusCode, 200, complete.body); objective = complete.json(); assert.equal(objective.finalScore, 65); assert.equal(objective.progress, 65);
  assert.equal((await f.owner.mutate(`${path}/key-results/${kr.id}/current`, { current: 100, version: kr.version, objectiveVersion: objective.version }, 'PATCH')).statusCode, 409);
  assert.equal((await f.owner.mutate(path, { ...objective, title: 'Closed edit' }, 'PATCH')).statusCode, 409);
  objective = (await f.owner.mutate(`${path}/archive`, { archived: true, version: objective.version })).json();
  assert.equal((await f.owner.request('GET', `${f.root}/objectives`)).json().total, 0); assert.equal((await f.owner.request('GET', `${f.root}/objectives?archived=true`)).json().total, 1);
  assert.equal((await f.owner.mutate(`${path}/lifecycle`, { state: 'active', version: objective.version })).statusCode, 409);
  objective = (await f.owner.mutate(`${path}/archive`, { archived: false, version: objective.version })).json(); objective = (await f.owner.mutate(`${path}/lifecycle`, { state: 'active', version: objective.version })).json(); assert.equal(objective.finalScore, null); assert.equal(objective.closingNote, '');
  objective = (await f.owner.mutate(`${path}/key-results/${kr.id}/current`, { current: 80, version: kr.version, objectiveVersion: objective.version }, 'PATCH')).json(); assert.equal(objective.progress, 80);
  const history = (await f.owner.request('GET', `${path}/history?limit=100`)).json(); const completion = history.items.find((e: { data: { after: string } }) => e.data.after === 'completed'); assert.equal(completion.data.finalScore, 65); assert.equal(completion.data.note, 'Delivered most of the planned outcome');
});

test('concurrent metric edits and completion cannot commit a stale completion score or duplicate audit', async t => {
  const f = await fixture(t); const created = await f.create(); const objective = await f.metric(created.id); const kr = objective.keyResults[0]; const path = `${f.root}/objectives/${objective.id}`;
  const edits = await Promise.all([10, 90].map(current => f.owner.mutate(`${path}/key-results/${kr.id}/current`, { current, version: kr.version, objectiveVersion: objective.version }, 'PATCH'))); assert.deepEqual(edits.map(r => r.statusCode).sort(), [200, 409]);
  const fresh = await f.get(objective.id); const metric = fresh.keyResults[0];
  const results = await Promise.all([f.owner.mutate(`${path}/lifecycle`, { state: 'completed', note: 'Race completion', version: fresh.version }), f.owner.mutate(`${path}/key-results/${kr.id}/current`, { current: 75, version: metric.version, objectiveVersion: fresh.version }, 'PATCH')]); assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const final = await f.get(objective.id); if (final.state === 'completed') assert.equal(final.finalScore, fresh.progress); else { assert.equal(final.progress, 75); assert.equal(final.finalScore, null); }
  assert.equal(await db.auditEvent.count({ where: { objectiveId: objective.id } }), 4);
  assert.equal((await f.owner.mutate(`${path}/key-results/${kr.id}/current`, { current: 1, version: 1, objectiveVersion: final.version }, 'PATCH')).statusCode, 409);
});

test('reassignment clears historical offboarding guards without changing frozen score', async t => {
  const f = await fixture(t); const departing = await f.member(); const replacement = await f.member();
  const created = await f.create({ leadId: departing.membership.id, assignments: [{ membershipId: replacement.membership.id, role: 'contributor' }] }); let objective = await f.metric(created.id, { ownerId: departing.membership.id, current: 72 }); const path = `${f.root}/objectives/${objective.id}`;
  objective = (await f.owner.mutate(`${path}/lifecycle`, { state: 'completed', note: 'Historical work', version: objective.version })).json(); objective = (await f.owner.mutate(`${path}/archive`, { archived: true, version: objective.version })).json();
  const suspend = () => f.owner.mutate(`${f.root}/members/${departing.membership.id}`, { role: 'member', active: false, version: 1 }, 'PATCH'); assert.equal((await suspend()).json().error.code, 'REASSIGN_REQUIRED');
  objective = (await f.owner.mutate(`${path}/ownership`, { leadId: replacement.membership.id, assignments: [], version: objective.version }, 'PATCH')).json(); assert.equal((await suspend()).statusCode, 409);
  const kr = objective.keyResults[0]; const reassign = await f.owner.mutate(`${path}/key-results/${kr.id}/owner`, { ownerId: replacement.membership.id, version: kr.version, objectiveVersion: objective.version }, 'PATCH'); assert.equal(reassign.statusCode, 200, reassign.body); assert.equal(reassign.json().progress, 72); assert.equal(reassign.json().closingNote, 'Historical work');
  assert.equal((await suspend()).statusCode, 200); assert.equal((await departing.actor.request('GET', path)).statusCode, 404);
});

test('offboarding racing a new assignment never leaves an inactive editing reference', async t => {
  const f = await fixture(t); const m = await f.member(); const objective = await f.create();
  const results = await Promise.all([f.owner.mutate(`${f.root}/members/${m.membership.id}`, { role: 'member', active: false, version: 1 }, 'PATCH'), f.owner.mutate(`${f.root}/objectives/${objective.id}/ownership`, { leadId: m.membership.id, assignments: [], version: 1 }, 'PATCH')]);
  assert.equal(results.filter(r => r.statusCode === 200).length, 1); const membership = await db.membership.findUniqueOrThrow({ where: { id: m.membership.id } }); const current = await f.get(objective.id); assert.ok(current.leadId !== membership.id || membership.active);
});

test('unique explorer totals, date overlap, timezone overdue and active averages exclude closed and archived work', async t => {
  const f = await fixture(t); const today = todayInTimezone('America/Toronto'); const owner = await f.create({ title: 'Unique active', startDate: today, endDate: today }); await f.metric(owner.id, { ownerId: f.leadId, current: 80 });
  await f.create({ title: 'Other active', endDate: '2026-01-01' }); await f.create({ state: 'draft' }); const cancelled = await f.create(); await f.owner.mutate(`${f.root}/objectives/${cancelled.id}/lifecycle`, { state: 'cancelled', version: 1 });
  const archived = await f.create(); await f.owner.mutate(`${f.root}/objectives/${archived.id}/archive`, { archived: true, version: 1 });
  const list = (await f.owner.request('GET', `${f.root}/objectives?mine=true&limit=1&sort=title&direction=asc`)).json(); assert.equal(list.total, 4); assert.equal(list.items.length, 1);
  const search = (await f.owner.request('GET', `${f.root}/objectives?search=UNIQUE&mine=true`)).json(); assert.equal(search.total, 1);
  const dates = (await f.owner.request('GET', `${f.root}/objectives?from=${today}&to=${today}`)).json(); assert.equal(dates.total, 1);
  assert.equal((await f.owner.request('GET', `${f.root}/objectives?from=2026-03-01&to=2026-01-01`)).statusCode, 400);
  const summary = (await f.owner.request('GET', `${f.root}/objective-summary`)).json(); assert.equal(summary.total, 4); assert.equal(summary.active, 2); assert.equal(summary.averageProgress, 40); assert.equal(summary.overdue, 1);
});

test('viewers follow and unfollow without edit privileges; child mode activates with no inputs', async t => {
  const f = await fixture(t); const viewer = await f.member('viewer'); const objective = await f.create(); const path = `${f.root}/objectives/${objective.id}`;
  const follow = await viewer.actor.mutate(`${path}/follow`, { follow: true, version: 1 }, 'PUT'); assert.equal(follow.statusCode, 200); assert.equal(follow.json().canEdit, false); assert.equal((await viewer.actor.request('GET', `${f.root}/objectives?mine=true`)).json().total, 1);
  assert.equal((await viewer.actor.mutate(`${path}/follow`, { follow: false, version: follow.json().version }, 'PUT')).statusCode, 200);
  assert.equal((await f.owner.mutate(`${f.root}/objectives`, { ...f.input, progressMode: 'children' })).statusCode, 201);
  const children = await f.create({ progressMode: 'children', state: 'draft' }); assert.equal(children.progress, 0);
  const activated = await f.owner.mutate(`${f.root}/objectives/${children.id}/lifecycle`, { state: 'active', version: 1 }); assert.equal(activated.statusCode, 200); assert.equal(activated.json().progress, 0);
});

test('objective plugin requires live sessions, verified SMTP accounts, exact Origin and CSRF', async t => {
  const f = await fixture(t, 'smtp'); assert.equal((await f.owner.mutate(`${f.root}/objectives`, f.input)).json().error.code, 'EMAIL_UNVERIFIED');
  await db.user.update({ where: { id: f.account.user.id }, data: { verified: true } });
  const forged: Record<string, string>[] = [{ origin: 'https://attacker.example' }, { 'x-csrf-token': 'wrong' }, { 'sec-fetch-site': 'cross-site' }];
  for (const headers of forged) assert.equal((await f.owner.mutate(`${f.root}/objectives`, f.input, 'POST', headers)).statusCode, 403);
  assert.equal((await f.client().request('GET', `${f.root}/objectives`)).statusCode, 401);
  await db.session.deleteMany({ where: { userId: f.account.user.id } }); assert.equal((await f.owner.mutate(`${f.root}/objectives`, f.input)).statusCode, 401);
});

test('audit failure rolls back metric value, both versions and completion snapshot atomically', async t => {
  const f = await fixture(t); const created = await f.create(); const objective = await f.metric(created.id); const kr = objective.keyResults[0];
  const failing = db.$extends({ query: { auditEvent: { async create({ args, query }) { if (args.data.orgId === f.orgId && ['metric_updated', 'objective_lifecycle'].includes(args.data.type)) throw new Error('Injected audit failure'); return query(args); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close()); const actor = f.client(app); await actor.mutate('auth/login', { email: f.account.user.email, password }); const path = `${f.root}/objectives/${created.id}`;
  const update = await actor.mutate(`${path}/key-results/${kr.id}/current`, { current: 90, version: kr.version, objectiveVersion: objective.version }, 'PATCH'); assert.equal(update.statusCode, 500); assert.ok(!update.body.includes('Injected'));
  assert.equal((await actor.mutate(`${path}/lifecycle`, { state: 'completed', note: 'Rollback note', version: objective.version })).statusCode, 500);
  const current = await f.get(created.id); assert.equal(current.version, objective.version); assert.equal(current.keyResults[0].version, kr.version); assert.equal(current.progress, 50); assert.equal(current.state, 'active'); assert.equal(current.finalScore, null); assert.equal(current.closingNote, ''); assert.equal(await db.auditEvent.count({ where: { objectiveId: created.id } }), 2);
});
