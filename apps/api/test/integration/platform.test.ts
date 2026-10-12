import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { db } from '../../src/db.js';
import { buildApp } from '../../src/app.js';
import { bootstrapAdministrator } from '../../src/platform/bootstrap.js';
import { hashPassword, hashToken, opaqueToken, type AccountConfig } from '../../src/accounts/security.js';

const password = 'Secure platform test password 2026';
type Method = 'GET' | 'POST' | 'PATCH';
async function fixture(t: TestContext, mode: 'smtp' | 'selfhosted' = 'selfhosted') {
  const domain = `${randomUUID()}.platform.accounts.example`; const orgs: string[] = [];
  const config: AccountConfig = { appUrl: 'http://localhost:8080', secure: false, emailMode: mode, disableSignup: true };
  const app = await buildApp({ logger: false, accountConfig: config }); const hash = await hashPassword(password);
  const client = (application: FastifyInstance = app) => {
    const cookies = new Map<string, string>();
    const request = async (method: Method, path: string, payload?: unknown, headers: Record<string, string> = {}) => {
      const response = await application.inject({ method, url: `/api/v1/${path}`, payload: payload === undefined ? undefined : JSON.stringify(payload), headers: { 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers } });
      for (const cookie of response.cookies) { if (cookie.value) cookies.set(cookie.name, cookie.value); else cookies.delete(cookie.name); } return response;
    };
    const session = () => request('GET', 'auth/session');
    const mutate = async (path: string, payload: unknown, method: Method = 'PATCH', headers: Record<string, string> = {}) => request(method, path, payload, { origin: config.appUrl, 'x-csrf-token': (await session()).json().csrf, ...headers });
    return { request, session, mutate };
  };
  const user = async (admin = false, verified = true) => {
    const record = await db.user.create({ data: { email: `${randomUUID()}@${domain}`, name: 'Platform fixture user', passwordHash: hash, platformAdmin: admin, verified } });
    const actor = client(); assert.equal((await actor.mutate('auth/login', { email: record.email, password }, 'POST')).statusCode, 200); return { record, actor };
  };
  const admin = await user(true);
  const organization = async (ownerId: string, active = true) => {
    const org = await db.organization.create({ data: { name: `Platform organization ${randomUUID()}`, active } }); orgs.push(org.id);
    const membership = await db.membership.create({ data: { orgId: org.id, userId: ownerId, role: 'owner' } }); return { org, membership };
  };
  t.after(async () => {
    await app.close(); const users = await db.user.findMany({ where: { email: { endsWith: domain } } }); const ids = users.map(u => u.id);
    await db.emailOutbox.deleteMany({ where: { to: { endsWith: domain } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ userId: { in: ids } }, { orgId: { in: orgs } }] } });
    await db.notification.deleteMany({ where: { orgId: { in: orgs } } });
    await db.keyResult.deleteMany({ where: { orgId: { in: orgs } } }); await db.assignment.deleteMany({ where: { orgId: { in: orgs } } });
    await db.objective.deleteMany({ where: { orgId: { in: orgs } } }); await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.membership.deleteMany({ where: { userId: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: ids } } });
  });
  return { domain, orgs, config, app, client, user, admin, organization };
}
test.after(() => db.$disconnect());

test('trusted bootstrap creates/promotes explicitly, never grants memberships, preserves credentials and is idempotent', async t => {
  const f = await fixture(t); const address = `created@${f.domain}`;
  const created = await bootstrapAdministrator(db, { email: address, name: 'Host admin', password });
  assert.equal(created.platformAdmin, true); assert.equal(created.verified, true); assert.equal(await db.membership.count({ where: { userId: created.id } }), 0);
  assert.equal((await bootstrapAdministrator(db, { email: address })).changed, false);
  const existing = await f.user(); const promoted = await bootstrapAdministrator(db, { email: existing.record.email });
  assert.equal(promoted.version, 2); assert.equal((await existing.actor.session()).json().user.platformAdmin, true);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: promoted.id } })).passwordHash, existing.record.passwordHash);
  assert.equal(await db.auditEvent.count({ where: { userId: created.id, type: 'platform_admin_bootstrap' } }), 1);
  await assert.rejects(bootstrapAdministrator(db, { email: existing.record.email, password }));
  await db.user.update({ where: { id: existing.record.id }, data: { active: false } });
  await assert.rejects(bootstrapAdministrator(db, { email: existing.record.email }));
  await assert.rejects(bootstrapAdministrator(db, { email: `missing@${f.domain}` }));
  assert.equal(await db.user.count({ where: { email: `missing@${f.domain}` } }), 0);
});
test('platform routes reject anonymous/ordinary users and mutation forgery; lists omit credentials and tenant content', async t => {
  const f = await fixture(t); const ordinary = await f.user(); const { org } = await f.organization(ordinary.record.id);
  for (const path of ['platform/users', 'platform/organizations', 'platform/audit']) {
    assert.equal((await f.client().request('GET', path)).statusCode, 401);
    assert.equal((await ordinary.actor.request('GET', path)).statusCode, 403);
  }
  const body = { active: false, version: 1, reason: 'Access review' };
  assert.equal((await ordinary.actor.mutate(`platform/users/${f.admin.record.id}`, body)).statusCode, 403);
  assert.equal((await f.admin.actor.mutate(`platform/organizations/${org.id}`, body, 'PATCH', { origin: 'https://attacker.test' })).statusCode, 403);
  assert.equal((await f.admin.actor.mutate(`platform/organizations/${org.id}`, body, 'PATCH', { 'x-csrf-token': opaqueToken() })).statusCode, 403);
  const response = await f.admin.actor.request('GET', `platform/users?search=${encodeURIComponent(f.domain)}&limit=1`);
  assert.equal(response.json().total, 2); assert.equal(response.json().items.length, 1);
  for (const field of ['passwordHash', 'sessions', 'tokens', 'memberships']) assert.equal(field in response.json().items[0], false);
  for (const path of ['', '/objectives', '/members', '/teams', '/audit', '/graph?type=alignment']) assert.equal((await f.admin.actor.request('GET', `orgs/${org.id}${path}`)).statusCode, 404);
  assert.equal(await db.auditEvent.count({ where: { userId: f.admin.record.id, type: 'platform_organization_activation' } }), 0);
});
test('organization activation is versioned/audited and removes tenant access without adding platform membership', async t => {
  const f = await fixture(t); const owner = await f.user(); const { org } = await f.organization(owner.record.id);
  const result = await f.admin.actor.mutate(`platform/organizations/${org.id}`, { active: false, version: 1, reason: 'Maintenance window' });
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().version, 2);
  assert.equal((await owner.actor.request('GET', `orgs/${org.id}`)).statusCode, 404); assert.equal((await owner.actor.session()).json().memberships.length, 0);
  assert.equal((await f.admin.actor.mutate(`platform/organizations/${org.id}`, { active: true, version: 1, reason: 'Stale edit' })).json().error.code, 'VERSION_CONFLICT');
  assert.equal((await f.admin.actor.mutate(`platform/organizations/${org.id}`, { active: true, version: 2, reason: 'Maintenance ended' })).statusCode, 200);
  assert.equal((await owner.actor.request('GET', `orgs/${org.id}`)).statusCode, 200);
  const history = (await f.admin.actor.request('GET', `platform/audit?search=${encodeURIComponent(org.name)}`)).json();
  assert.equal(history.total, 2); assert.equal(history.items[0].user.id, f.admin.record.id); assert.equal(history.items[0].data.reason, 'Maintenance ended');
  assert.equal(await db.auditEvent.count({ where: { orgId: org.id, type: { startsWith: 'platform_' } } }), 0);
});
test('global suspension revokes sessions/tokens, clears team management and never reactivates scoped memberships', async t => {
  const f = await fixture(t); const owner = await f.user(); const target = await f.user(); const { org } = await f.organization(owner.record.id);
  const member = await db.membership.create({ data: { orgId: org.id, userId: target.record.id, role: 'manager' } });
  const team = await db.team.create({ data: { orgId: org.id, name: 'Managed team' } });
  await db.teamMember.create({ data: { orgId: org.id, teamId: team.id, membershipId: member.id, manager: true } });
  const token = await db.authToken.create({ data: { userId: target.record.id, tokenHash: hashToken(opaqueToken()), type: 'reset', expiresAt: new Date(Date.now() + 60000) } });
  const result = await f.admin.actor.mutate(`platform/users/${target.record.id}`, { active: false, version: 1, reason: 'Offboarding complete' });
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().version, 2); assert.equal((await target.actor.session()).json().user, null);
  assert.equal(await db.session.count({ where: { userId: target.record.id } }), 0); assert.ok((await db.authToken.findUniqueOrThrow({ where: { id: token.id } })).usedAt);
  assert.equal((await db.teamMember.findFirstOrThrow({ where: { teamId: team.id } })).manager, false); assert.equal((await db.team.findUniqueOrThrow({ where: { id: team.id } })).version, 2);
  assert.equal((await f.admin.actor.mutate(`platform/users/${target.record.id}`, { active: true, version: 1, reason: 'Stale activation' })).json().error.code, 'VERSION_CONFLICT');
  await db.membership.update({ where: { id: member.id }, data: { active: false } });
  assert.equal((await f.admin.actor.mutate(`platform/users/${target.record.id}`, { active: true, version: 2, reason: 'Account restored' })).statusCode, 200);
  assert.equal((await db.membership.findUniqueOrThrow({ where: { id: member.id } })).active, false);
  assert.equal(await db.auditEvent.count({ where: { userId: f.admin.record.id, type: 'platform_account_activation' } }), 2);
});
test('global suspension protects last globally active owners in every tenant, including suspended organizations', async t => {
  const f = await fixture(t); const target = await f.user(); const backup = await f.user(); const inactive = await f.user();
  const first = await f.organization(target.record.id); const second = await f.organization(target.record.id, false);
  await db.membership.create({ data: { orgId: first.org.id, userId: backup.record.id, role: 'owner' } });
  await db.membership.create({ data: { orgId: second.org.id, userId: inactive.record.id, role: 'owner' } }); await db.user.update({ where: { id: inactive.record.id }, data: { active: false } });
  const result = await f.admin.actor.mutate(`platform/users/${target.record.id}`, { active: false, version: 1, reason: 'Owner departure' });
  assert.equal(result.json().error.code, 'LAST_OWNER'); assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.record.id } })).active, true);
  assert.equal(await db.auditEvent.count({ where: { userId: f.admin.record.id, type: 'platform_account_activation' } }), 0);
  await db.membership.create({ data: { orgId: second.org.id, userId: backup.record.id, role: 'owner' } });
  assert.equal((await f.admin.actor.mutate(`platform/users/${target.record.id}`, { active: false, version: 1, reason: 'Owners reassigned' })).statusCode, 200);
});
test('archived/historical leads, coowners, contributors and metric owners require global offboarding; followers may remain', async t => {
  const f = await fixture(t); const owner = await f.user(); const target = await f.user(); const { org, membership } = await f.organization(owner.record.id);
  const member = await db.membership.create({ data: { orgId: org.id, userId: target.record.id } });
  const objective = await db.objective.create({ data: { orgId: org.id, leadId: member.id, title: 'Historical objective', startDate: '2025-01-01', endDate: '2025-03-31', archivedAt: new Date(), state: 'completed', finalScore: 75, closingNote: 'Frozen history' } });
  const suspend = () => f.admin.actor.mutate(`platform/users/${target.record.id}`, { active: false, version: 1, reason: 'Historical reassignment' });
  assert.equal((await suspend()).json().error.code, 'REASSIGN_REQUIRED'); await db.objective.update({ where: { id: objective.id }, data: { leadId: membership.id } });
  for (const role of ['coowner', 'contributor']) { await db.assignment.create({ data: { orgId: org.id, objectiveId: objective.id, membershipId: member.id, role } }); assert.equal((await suspend()).json().error.code, 'REASSIGN_REQUIRED'); await db.assignment.deleteMany({ where: { objectiveId: objective.id } }); }
  const kr = await db.keyResult.create({ data: { orgId: org.id, objectiveId: objective.id, title: 'Historical owner', ownerId: member.id } }); assert.equal((await suspend()).json().error.code, 'REASSIGN_REQUIRED');
  await db.keyResult.update({ where: { id: kr.id }, data: { ownerId: membership.id } });
  await db.assignment.create({ data: { orgId: org.id, objectiveId: objective.id, membershipId: member.id, role: 'follower' } });
  assert.equal((await suspend()).statusCode, 200); assert.equal((await db.objective.findUniqueOrThrow({ where: { id: objective.id } })).finalScore, 75);
});
test('concurrent global owner suspension and scoped owner demotion preserve an active owner', async t => {
  const f = await fixture(t); const first = await f.user(); const second = await f.user(); const { org } = await f.organization(first.record.id);
  const member = await db.membership.create({ data: { orgId: org.id, userId: second.record.id, role: 'owner' } });
  const results = await Promise.all([
    f.admin.actor.mutate(`platform/users/${first.record.id}`, { active: false, version: 1, reason: 'Concurrent suspension' }),
    second.actor.mutate(`orgs/${org.id}/members/${member.id}`, { role: 'admin', active: true, version: 1 })
  ]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(await db.membership.count({ where: { orgId: org.id, active: true, role: 'owner', user: { active: true } } }), 1);
});
test('SMTP requires verified platform mutation actors and refuses organization activation without an active owner', async t => {
  const f = await fixture(t, 'smtp'); const unverified = await f.user(true, false); const owner = await f.user(); const { org } = await f.organization(owner.record.id, false);
  assert.equal((await unverified.actor.request('GET', 'platform/users')).statusCode, 200);
  assert.equal((await unverified.actor.mutate(`platform/organizations/${org.id}`, { active: true, version: 1, reason: 'Not verified' })).json().error.code, 'EMAIL_UNVERIFIED');
  await db.user.update({ where: { id: owner.record.id }, data: { active: false } });
  assert.equal((await f.admin.actor.mutate(`platform/organizations/${org.id}`, { active: true, version: 1, reason: 'Missing owner' })).json().error.code, 'LAST_OWNER');
});

test('audit failure rolls back activation, session/token revocation and bootstrap promotion', async t => {
  const f = await fixture(t); const target = await f.user();
  const failing = new Proxy(db, { get(database, key) {
    if (key === '$transaction') return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => database.$transaction(tx => work(new Proxy(tx, { get(transaction, property) {
      if (property === 'auditEvent') return new Proxy(transaction.auditEvent, { get(delegate, operation) { if (operation === 'create') return () => { throw new Error('Injected audit failure'); }; return Reflect.get(delegate, operation); } });
      return Reflect.get(transaction, property);
    } })));
    return Reflect.get(database, key);
  } }) as PrismaClient;
  const app = await buildApp({ logger: false, database: failing, accountConfig: f.config }); t.after(() => app.close());
  const actor = f.client(app); assert.equal((await actor.mutate('auth/login', { email: f.admin.record.email, password }, 'POST')).statusCode, 200);
  const token = await db.authToken.create({ data: { userId: target.record.id, tokenHash: hashToken(opaqueToken()), type: 'verify', expiresAt: new Date(Date.now() + 60000) } });
  const result = await actor.mutate(`platform/users/${target.record.id}`, { active: false, version: 1, reason: 'Audit rollback test' }); assert.equal(result.statusCode, 500);
  const current = await db.user.findUniqueOrThrow({ where: { id: target.record.id } }); assert.equal(current.active, true); assert.equal(current.version, 1);
  assert.ok(await db.session.count({ where: { userId: target.record.id } })); assert.equal((await db.authToken.findUniqueOrThrow({ where: { id: token.id } })).usedAt, null);
  await assert.rejects(bootstrapAdministrator(failing, { email: target.record.email })); assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.record.id } })).platformAdmin, false);
});

test('concurrent assignment versus global suspension cannot leave an inactive objective lead', async t => {
  const f = await fixture(t); const owner = await f.user(); const target = await f.user(); const { org, membership } = await f.organization(owner.record.id);
  const member = await db.membership.create({ data: { orgId: org.id, userId: target.record.id } });
  const objective = await db.objective.create({ data: { orgId: org.id, leadId: membership.id, title: 'Concurrent lead', startDate: '2026-10-01', endDate: '2026-12-31' } });
  const results = await Promise.all([
    f.admin.actor.mutate(`platform/users/${target.record.id}`, { active: false, version: 1, reason: 'Concurrent offboarding' }),
    owner.actor.mutate(`orgs/${org.id}/objectives/${objective.id}/ownership`, { version: 1, leadId: member.id, assignments: [] })
  ]);
  assert.equal(results.filter(r => r.statusCode === 200).length, 1, results.map(r => r.body).join('\n'));
  assert.ok(results.every(r => [200, 404, 409].includes(r.statusCode)));
  const finalObjective = await db.objective.findUniqueOrThrow({ where: { id: objective.id }, include: { lead: { include: { user: true } } } }); assert.equal(finalObjective.lead.user.active, true);
});

test('the last active platform administrator cannot be suspended, including concurrent admin departures', async t => {
  const f = await fixture(t);
  if (await db.user.count({ where: { platformAdmin: true, active: true } }) !== 1) { t.skip('Run in an isolated database to exercise the last platform administrator'); return; }
  const body = { active: false, version: 1, reason: 'Last administrator check' };
  assert.equal((await f.admin.actor.mutate(`platform/users/${f.admin.record.id}`, body)).json().error.code, 'LAST_PLATFORM_ADMIN');
  const second = await f.user(true);
  const results = await Promise.all([f.admin.actor.mutate(`platform/users/${second.record.id}`, body), second.actor.mutate(`platform/users/${f.admin.record.id}`, body)]);
  assert.equal(results.filter(r => r.statusCode === 200).length, 1);
  assert.ok(results.every(r => [200, 401, 409].includes(r.statusCode)));
  assert.equal(await db.user.count({ where: { platformAdmin: true, active: true } }), 1);
});
