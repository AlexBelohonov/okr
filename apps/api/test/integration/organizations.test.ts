import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db.js';
import { hashToken, opaqueToken, type AccountConfig } from '../../src/accounts/security.js';
import { requireAssignable } from '../../src/organizations/access.js';

const password = 'Secure organization tests 2026';
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function fixture(t: TestContext, mode: 'smtp' | 'selfhosted' = 'selfhosted') {
  const domain = `${randomUUID()}.organizations.accounts.example`; const orgIds: string[] = [];
  const config: AccountConfig = { appUrl: 'http://localhost:8080', secure: false, disableSignup: false, emailMode: mode };
  const app = await buildApp({ logger: false, accountConfig: config });
  t.after(async () => {
    await app.close(); const users = await db.user.findMany({ where: { email: { endsWith: domain } } }); const ids = users.map(u => u.id);
    await db.emailOutbox.deleteMany({ where: { to: { endsWith: domain } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ userId: { in: ids } }, { orgId: { in: orgIds } }] } });
    await db.objective.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.membership.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  });
  let address = 0;
  const client = (targetApp: FastifyInstance = app) => {
    const cookies = new Map<string, string>(); const remoteAddress = `10.4.0.${++address}`;
    const request = async (method: Method, path: string, payload?: unknown, headers: Record<string, string> = {}) => {
      const result = await targetApp.inject({ method, url: `/api/v1/${path}`, remoteAddress, payload: payload === undefined ? undefined : JSON.stringify(payload), headers: { 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers } });
      for (const c of result.cookies) { if (c.value) cookies.set(c.name, c.value); else cookies.delete(c.name); } return result;
    };
    const session = () => request('GET', 'auth/session');
    const mutate = async (path: string, payload: unknown, method: Method = 'POST', headers: Record<string, string> = {}) => request(method, path, payload, { origin: config.appUrl, 'x-csrf-token': (await session()).json().csrf, ...headers });
    return { request, mutate, session, cookies };
  };
  const owner = client(); const email = `owner@${domain}`;
  const result = await owner.mutate('auth/signup', { name: 'Organization Owner', email, password, organization: 'Organization fixture', timezone: 'America/Toronto' }); assert.equal(result.statusCode, 201, result.body);
  const account = (await owner.session()).json(); const orgId: string = account.memberships[0].org.id; orgIds.push(orgId);
  const member = async (role = 'member', active = true) => {
    const user = await db.user.create({ data: { email: `${randomUUID()}@${domain}`, name: `Test ${role}`, passwordHash: (await db.user.findUniqueOrThrow({ where: { id: account.user.id } })).passwordHash, verified: true } });
    const membership = await db.membership.create({ data: { orgId, userId: user.id, role, active } });
    const actor = client(); assert.equal((await actor.mutate('auth/login', { email: user.email, password })).statusCode, 200); return { user, membership, actor };
  };
  const team = async (name = 'Design team') => { const response = await owner.mutate(`orgs/${orgId}/teams`, { name }); assert.equal(response.statusCode, 201, response.body); return response.json(); };
  return { app, config, domain, owner, account, orgId, orgIds, client, member, team };
}
test.after(async () => { await db.$disconnect(); });

test('organization creation produces independent ownership, settings use versions and validate timezones', async t => {
  const f = await fixture(t); const result = await f.owner.mutate('orgs', { name: 'Second organization', timezone: 'UTC' }); assert.equal(result.statusCode, 201, result.body);
  const second = result.json(); f.orgIds.push(second.id); assert.equal((await f.owner.session()).json().memberships.length, 2);
  const edit = await f.owner.mutate(`orgs/${second.id}`, { name: 'Renamed organization', timezone: 'Europe/Paris', version: 1 }, 'PATCH'); assert.equal(edit.statusCode, 200); assert.equal(edit.json().version, 2);
  assert.equal((await f.owner.mutate(`orgs/${second.id}`, { name: 'Stale', timezone: 'UTC', version: 1 }, 'PATCH')).statusCode, 409);
  assert.equal((await f.owner.mutate('orgs', { name: 'Invalid', timezone: 'Not/AZone' })).statusCode, 400);
  assert.equal((await f.owner.request('GET', `orgs/${f.orgId}`)).json().organization.name, 'Organization fixture');
  assert.equal(await db.auditEvent.count({ where: { orgId: second.id, type: 'organization_updated' } }), 1);
});

test('all tenant paths hide foreign resources and wrong-tenant team assignments fail', async t => {
  const f = await fixture(t); const foreign = await db.organization.create({ data: { name: 'Foreign tenant' } }); f.orgIds.push(foreign.id);
  const otherUser = await f.member(); const foreignMember = await db.membership.create({ data: { orgId: foreign.id, userId: otherUser.user.id, role: 'owner' } });
  const foreignTeam = await db.team.create({ data: { orgId: foreign.id, name: 'Foreign team' } }); const team = await f.team();
  for (const path of ['', '/members', '/teams', '/invitations', '/audit']) assert.equal((await f.owner.request('GET', `orgs/${foreign.id}${path}`)).statusCode, 404);
  assert.equal((await f.owner.mutate(`orgs/${foreign.id}`, { name: 'Forged', timezone: 'UTC', version: 1 }, 'PATCH')).statusCode, 404);
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/members/${foreignMember.id}`, { role: 'member', active: true, version: 1 }, 'PATCH')).statusCode, 404);
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/teams/${foreignTeam.id}`, { name: 'Forged', version: 1 }, 'PATCH')).statusCode, 404);
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/teams/${team.id}/members/${foreignMember.id}`, { manager: false, version: 1 }, 'PUT')).statusCode, 404);
  assert.equal(await db.teamMember.count({ where: { teamId: team.id } }), 0);
  const foreignInvite = await db.invitation.create({ data: { orgId: foreign.id, email: `invite@${f.domain}`, tokenHash: hashToken(opaqueToken()), expiresAt: new Date(Date.now() + 60000) } });
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/invitations/${foreignInvite.id}`, {}, 'DELETE')).statusCode, 404);
});

test('organization routes independently require live sessions, exact Origin and CSRF', async t => {
  const f = await fixture(t); const path = `orgs/${f.orgId}/teams`;
  assert.equal((await f.client().request('GET', `orgs/${f.orgId}`)).statusCode, 401);
  assert.equal((await f.owner.mutate(path, { name: 'Forged' }, 'POST', { origin: 'https://attacker.example' })).statusCode, 403);
  assert.equal((await f.owner.mutate(path, { name: 'Forged' }, 'POST', { 'x-csrf-token': opaqueToken() })).statusCode, 403);
  assert.equal((await f.owner.mutate(path, { name: 'Forged' }, 'POST', { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  assert.equal((await f.owner.mutate(path, { name: 'Forged' }, 'POST', { 'content-type': 'text/plain' })).statusCode, 415);
  await db.session.deleteMany({ where: { userId: f.account.user.id } });
  assert.equal((await f.owner.mutate(path, { name: 'Revoked' })).statusCode, 401);
  assert.equal(await db.team.count({ where: { orgId: f.orgId } }), 0);
});

test('SMTP organization mutations require verified email and tenant suspension remains scoped', async t => {
  const f = await fixture(t, 'smtp');
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/teams`, { name: 'Denied' })).json().error.code, 'EMAIL_UNVERIFIED');
  assert.equal((await f.owner.mutate('orgs', { name: 'Denied', timezone: 'UTC' })).statusCode, 403);
  await db.user.update({ where: { id: f.account.user.id }, data: { verified: true } });
  await f.team(); const second = (await f.owner.mutate('orgs', { name: 'Still active', timezone: 'UTC' })).json(); f.orgIds.push(second.id);
  await db.organization.update({ where: { id: f.orgId }, data: { active: false } });
  assert.equal((await f.owner.request('GET', `orgs/${f.orgId}/teams`)).statusCode, 404);
  assert.equal((await f.owner.request('GET', `orgs/${second.id}`)).statusCode, 200);
  assert.equal((await f.owner.session()).json().memberships.length, 1);
});

test('fixed role boundaries reject viewers, members, managers and administrator owner escalation', async t => {
  const f = await fixture(t); const team = await f.team();
  for (const role of ['viewer', 'member', 'manager']) {
    const m = await f.member(role);
    assert.equal((await m.actor.request('GET', `orgs/${f.orgId}/teams`)).statusCode, 200);
    assert.equal((await m.actor.mutate(`orgs/${f.orgId}/teams`, { name: `Denied ${role}` })).statusCode, 403);
    assert.equal((await m.actor.mutate(`orgs/${f.orgId}/members/${m.membership.id}`, { role: 'admin', active: true, version: 1 }, 'PATCH')).statusCode, 403);
    assert.equal((await m.actor.mutate(`orgs/${f.orgId}/invitations`, { email: `invite-${role}@${f.domain}`, role: 'member' })).statusCode, 403);
    assert.equal((await m.actor.request('GET', `orgs/${f.orgId}/audit`)).statusCode, 403);
    assert.equal((await m.actor.mutate(`orgs/${f.orgId}/teams/${team.id}`, { name: 'Denied rename', version: 1 }, 'PATCH')).statusCode, 403);
  }
  const admin = await f.member('admin');
  assert.equal((await admin.actor.mutate(`orgs/${f.orgId}/members/${admin.membership.id}`, { role: 'owner', active: true, version: 1 }, 'PATCH')).statusCode, 403);
  assert.equal((await admin.actor.mutate(`orgs/${f.orgId}/members/${f.account.memberships[0].id}`, { role: 'admin', active: true, version: 1 }, 'PATCH')).statusCode, 403);
  assert.equal((await admin.actor.mutate(`orgs/${f.orgId}/teams`, { name: 'Allowed admin team' })).statusCode, 201);
});

test('last owner is protected, concurrent self-demotions preserve an owner, transfer is atomic', async t => {
  const f = await fixture(t); const ownerId = f.account.memberships[0].id;
  for (const input of [{ role: 'admin', active: true }, { role: 'owner', active: false }]) assert.equal((await f.owner.mutate(`orgs/${f.orgId}/members/${ownerId}`, { ...input, version: 1 }, 'PATCH')).json().error.code, 'LAST_OWNER');
  const second = await f.member('owner');
  const results = await Promise.all([f.owner.mutate(`orgs/${f.orgId}/members/${ownerId}`, { role: 'admin', active: true, version: 1 }, 'PATCH'), second.actor.mutate(`orgs/${f.orgId}/members/${second.membership.id}`, { role: 'admin', active: true, version: 1 }, 'PATCH')]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(await db.membership.count({ where: { orgId: f.orgId, role: 'owner', active: true, user: { active: true } } }), 1);
  const current = await db.membership.findFirstOrThrow({ where: { orgId: f.orgId, role: 'owner' } }); const actor = current.id === ownerId ? f.owner : second.actor;
  const target = await f.member('viewer');
  assert.equal((await actor.mutate(`orgs/${f.orgId}/transfer-ownership`, { membershipId: target.membership.id, version: current.version, targetVersion: 2 })).statusCode, 409);
  const transfer = await actor.mutate(`orgs/${f.orgId}/transfer-ownership`, { membershipId: target.membership.id, version: current.version, targetVersion: 1 }); assert.equal(transfer.statusCode, 200, transfer.body);
  assert.equal((await db.membership.findUniqueOrThrow({ where: { id: current.id } })).role, 'admin');
  assert.equal((await db.membership.findUniqueOrThrow({ where: { id: target.membership.id } })).role, 'owner');
  assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, type: 'ownership_transferred' } }), 1);
});

test('inactive global accounts do not count as owners or accept activation/ownership transfer', async t => {
  const f = await fixture(t); const inactive = await f.member('owner'); await db.user.update({ where: { id: inactive.user.id }, data: { active: false } });
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/members/${f.account.memberships[0].id}`, { role: 'admin', active: true, version: 1 }, 'PATCH')).json().error.code, 'LAST_OWNER');
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/members/${inactive.membership.id}`, { role: 'owner', active: true, version: 1 }, 'PATCH')).json().error.code, 'ACCOUNT_INACTIVE');
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/transfer-ownership`, { membershipId: inactive.membership.id, version: 1, targetVersion: 1 })).statusCode, 404);
});

test('member search/pagination are tenant scoped, suspension revokes only tenant access and stale changes fail', async t => {
  const f = await fixture(t); const m = await f.member(); const second = await db.organization.create({ data: { name: 'Other membership' } }); f.orgIds.push(second.id);
  await db.membership.create({ data: { orgId: second.id, userId: m.user.id, role: 'owner' } });
  const found = await f.owner.request('GET', `orgs/${f.orgId}/members?search=${encodeURIComponent(m.user.email.toUpperCase())}&limit=1`); assert.equal(found.statusCode, 200, found.body); assert.equal(found.json().total, 1); assert.equal(found.json().items[0].id, m.membership.id); assert.ok(!found.body.includes('passwordHash'));
  assert.equal((await f.owner.request('GET', `orgs/${f.orgId}/members?limit=1&page=2`)).json().items.length, 1);
  const path = `orgs/${f.orgId}/members/${m.membership.id}`;
  assert.equal((await f.owner.mutate(path, { role: 'member', active: false, version: 1 }, 'PATCH')).statusCode, 200);
  assert.equal((await m.actor.request('GET', `orgs/${f.orgId}`)).statusCode, 404);
  assert.equal((await m.actor.request('GET', `orgs/${second.id}`)).statusCode, 200);
  assert.equal((await m.actor.session()).json().user.id, m.user.id);
  assert.equal((await f.owner.mutate(path, { role: 'member', active: true, version: 1 }, 'PATCH')).statusCode, 409);
  assert.equal((await f.owner.mutate(path, { role: 'member', active: true, version: 2 }, 'PATCH')).statusCode, 200);
  assert.equal((await m.actor.request('GET', `orgs/${f.orgId}`)).statusCode, 200);
});

test('offboarding and viewer demotion require reassignment including historical objective ownership', async t => {
  const f = await fixture(t); const m = await f.member();
  const objective = await db.objective.create({ data: { orgId: f.orgId, title: 'Historical owned work', leadId: m.membership.id, startDate: '2026-01-01', endDate: '2026-03-31', state: 'completed', archivedAt: new Date(), finalScore: 90 } });
  const path = `orgs/${f.orgId}/members/${m.membership.id}`;
  assert.equal((await f.owner.mutate(path, { role: 'member', active: false, version: 1 }, 'PATCH')).json().error.code, 'REASSIGN_REQUIRED');
  assert.equal((await f.owner.mutate(path, { role: 'viewer', active: true, version: 1 }, 'PATCH')).statusCode, 409);
  await db.objective.update({ where: { id: objective.id }, data: { leadId: f.account.memberships[0].id } });
  await db.assignment.create({ data: { orgId: f.orgId, objectiveId: objective.id, membershipId: m.membership.id, role: 'contributor' } });
  assert.equal((await f.owner.mutate(path, { role: 'member', active: false, version: 1 }, 'PATCH')).statusCode, 409);
  await db.assignment.deleteMany({ where: { objectiveId: objective.id } });
  const metric = await db.keyResult.create({ data: { orgId: f.orgId, objectiveId: objective.id, title: 'Owned metric', ownerId: m.membership.id } });
  assert.equal((await f.owner.mutate(path, { role: 'viewer', active: true, version: 1 }, 'PATCH')).statusCode, 409);
  await db.keyResult.update({ where: { id: metric.id }, data: { ownerId: null } });
  assert.equal((await f.owner.mutate(path, { role: 'member', active: false, version: 1 }, 'PATCH')).statusCode, 200);
  assert.equal(await db.auditEvent.count({ where: { orgId: f.orgId, type: 'membership_updated' } }), 1);
});

test('assignment helper rejects foreign, inactive and viewer editing assignments', async t => {
  const f = await fixture(t); const viewer = await f.member('viewer'); const inactive = await f.member('member', false);
  await assert.rejects(requireAssignable(db, f.orgId, viewer.membership.id), /Viewers/);
  await assert.rejects(requireAssignable(db, f.orgId, inactive.membership.id), /Resource not found/);
  await assert.rejects(requireAssignable(db, randomUUID(), viewer.membership.id), /Resource not found/);
  assert.equal((await requireAssignable(db, f.orgId, viewer.membership.id, false)).id, viewer.membership.id);
});

test('designated managers can manage their roster but not other teams or manager appointments', async t => {
  const f = await fixture(t); const manager = await f.member('manager'); const person = await f.member(); const team = await f.team(); const unrelated = await f.team('Unrelated team');
  const path = `orgs/${f.orgId}/teams/${team.id}`;
  assert.equal((await f.owner.mutate(`${path}/members/${manager.membership.id}`, { manager: true, version: 1 }, 'PUT')).statusCode, 200);
  assert.equal((await manager.actor.mutate(path, { name: 'Managed rename', version: 2 }, 'PATCH')).statusCode, 200);
  assert.equal((await manager.actor.mutate(`${path}/members/${person.membership.id}`, { manager: false, version: 3 }, 'PUT')).statusCode, 200);
  assert.equal((await manager.actor.mutate(`${path}/members/${manager.membership.id}`, { manager: false, version: 4 }, 'PUT')).statusCode, 403);
  assert.equal((await manager.actor.mutate(`${path}/members/${person.membership.id}`, { manager: true, version: 4 }, 'PUT')).statusCode, 403);
  assert.equal((await manager.actor.mutate(`orgs/${f.orgId}/teams/${unrelated.id}`, { name: 'Forbidden', version: 1 }, 'PATCH')).statusCode, 403);
  assert.equal((await manager.actor.mutate(`${path}/members/${person.membership.id}`, { version: 4 }, 'DELETE')).statusCode, 200);
  assert.equal((await manager.actor.mutate(path, { version: 5 }, 'DELETE')).statusCode, 403);
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/members/${manager.membership.id}`, { role: 'member', active: true, version: 1 }, 'PATCH')).statusCode, 200);
  assert.equal((await db.teamMember.findUniqueOrThrow({ where: { teamId_membershipId: { teamId: team.id, membershipId: manager.membership.id } } })).manager, false);
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: team.id } })).version, 6);
  assert.equal((await manager.actor.mutate(path, { name: 'Revoked manager', version: 6 }, 'PATCH')).statusCode, 403);
});

test('team versions, duplicate names, eligible managers, inactive assignments and deletion safeguards', async t => {
  const f = await fixture(t); const team = await f.team(); const inactive = await f.member('member', false); const person = await f.member();
  assert.equal((await f.owner.mutate(`orgs/${f.orgId}/teams`, { name: team.name })).statusCode, 409);
  const path = `orgs/${f.orgId}/teams/${team.id}`;
  assert.equal((await f.owner.mutate(`${path}/members/${inactive.membership.id}`, { manager: false, version: 1 }, 'PUT')).statusCode, 404);
  assert.equal((await f.owner.mutate(`${path}/members/${person.membership.id}`, { manager: true, version: 1 }, 'PUT')).statusCode, 400);
  assert.equal((await f.owner.mutate(path, { name: 'New name', version: 1 }, 'PATCH')).statusCode, 200);
  assert.equal((await f.owner.mutate(path, { version: 1 }, 'DELETE')).statusCode, 409);
  const objective = await db.objective.create({ data: { orgId: f.orgId, title: 'Team work', teamId: team.id, scope: 'team', leadId: f.account.memberships[0].id, startDate: '2026-01-01', endDate: '2026-03-31' } });
  assert.equal((await f.owner.mutate(path, { version: 2 }, 'DELETE')).json().error.code, 'TEAM_IN_USE');
  await db.objective.delete({ where: { id: objective.id } });
  assert.equal((await f.owner.mutate(path, { version: 2 }, 'DELETE')).statusCode, 200);
  assert.equal(await db.team.count({ where: { id: team.id } }), 0);
});

test('admin invitations normalize email, rotate links, reject owner role and redact tokens from list/audit', async t => {
  const f = await fixture(t); const path = `orgs/${f.orgId}/invitations`; const email = `invite@${f.domain}`;
  const first = await f.owner.mutate(path, { email: email.toUpperCase(), role: 'member' }); assert.equal(first.statusCode, 201); const firstToken = new URL(first.json().link).hash.split('=')[1]!;
  const second = await f.owner.mutate(path, { email, role: 'viewer' }); assert.equal(second.statusCode, 201); const token = new URL(second.json().link).hash.split('=')[1]!;
  assert.equal((await f.client().mutate('auth/invitation', { token: firstToken })).statusCode, 400);
  assert.equal((await f.client().mutate('auth/invitation', { token })).json().role, 'viewer');
  assert.equal((await f.owner.mutate(path, { email: `owner-invite@${f.domain}`, role: 'owner' })).statusCode, 400);
  assert.equal((await f.owner.mutate(path, { email: f.account.user.email, role: 'member' })).statusCode, 409);
  assert.equal((await f.owner.mutate(path, { email, role: 'member', send: true })).statusCode, 409);
  const list = await f.owner.request('GET', path); const history = await f.owner.request('GET', `orgs/${f.orgId}/audit`);
  for (const r of [list, history]) { assert.ok(!r.body.includes(token)); assert.ok(!r.body.includes('tokenHash')); }
  const open = list.json().items.find((i: { usedAt: string | null }) => !i.usedAt);
  assert.equal((await f.owner.mutate(`${path}/${open.id}`, {}, 'DELETE')).statusCode, 200);
  assert.equal((await f.client().mutate('auth/invitation', { token })).statusCode, 400);
});

test('SMTP invitation issuance commits outbox and audit with single-use new-account acceptance', async t => {
  const f = await fixture(t, 'smtp'); await db.user.update({ where: { id: f.account.user.id }, data: { verified: true } });
  const email = `invite@${f.domain}`; const result = await f.owner.mutate(`orgs/${f.orgId}/invitations`, { email, role: 'manager', send: true }); assert.equal(result.statusCode, 201, result.body);
  const token = new URL(result.json().link).hash.split('=')[1]!; assert.equal(await db.emailOutbox.count({ where: { to: email } }), 1);
  const guest = f.client(); assert.equal((await guest.mutate('auth/signup', { name: 'Accepted Member', email, password, inviteToken: token })).statusCode, 201);
  assert.equal((await guest.session()).json().memberships[0].role, 'manager');
  assert.equal((await guest.mutate('auth/accept-invitation', { token })).statusCode, 400);
});

test('audit insertion failure rolls back membership and designation changes', async t => {
  const f = await fixture(t); const manager = await f.member('manager'); const team = await f.team();
  await db.teamMember.create({ data: { orgId: f.orgId, teamId: team.id, membershipId: manager.membership.id, manager: true } });
  const failingDatabase = db.$extends({ query: { auditEvent: { async create({ args, query }) { if (args.data.orgId === f.orgId && args.data.type === 'membership_updated') throw new Error('Injected audit failure'); return query(args); } } } }) as unknown as PrismaClient;
  const app = await buildApp({ logger: false, database: failingDatabase, accountConfig: f.config }); t.after(() => app.close());
  const actor = f.client(app); assert.equal((await actor.mutate('auth/login', { email: f.account.user.email, password })).statusCode, 200);
  const response = await actor.mutate(`orgs/${f.orgId}/members/${manager.membership.id}`, { role: 'member', active: false, version: 1 }, 'PATCH'); assert.equal(response.statusCode, 500); assert.ok(!response.body.includes('Injected'));
  const current = await db.membership.findUniqueOrThrow({ where: { id: manager.membership.id } }); assert.equal(current.role, 'manager'); assert.equal(current.active, true); assert.equal(current.version, 1);
  assert.equal((await db.teamMember.findUniqueOrThrow({ where: { teamId_membershipId: { teamId: team.id, membershipId: current.id } } })).manager, true);
  assert.equal((await db.team.findUniqueOrThrow({ where: { id: team.id } })).version, 1);
});
