import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db.js';
import { DAY, hashToken, opaqueToken, type AccountConfig } from '../../src/accounts/security.js';
import { issueAction, issueInvitation } from '../../src/accounts/tokens.js';
import { deliverOne } from '../../src/accounts/mail.js';

const initialPassword = 'Secure testing password 2026';
const nextPassword = 'Different secure password 2026';
async function fixture(t: TestContext, mode: 'smtp' | 'selfhosted' = 'selfhosted') {
  const suffix = randomUUID();
  const domain = `${suffix}.accounts.example`;
  const config: AccountConfig = { appUrl: 'http://localhost:8080', secure: false, disableSignup: false, emailMode: mode };
  const app = await buildApp({ logger: false, accountConfig: config });
  t.after(async () => {
    await app.close();
    const users = await db.user.findMany({ where: { email: { endsWith: domain } } });
    const ids = users.map(u => u.id);
    const members = await db.membership.findMany({ where: { userId: { in: ids } } });
    const orgIds = [...new Set(members.map(m => m.orgId))];
    await db.emailOutbox.deleteMany({ where: { to: { endsWith: domain } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ userId: { in: ids } }, { orgId: { in: orgIds } }] } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  });
  let address = 0;
  const client = (application = app) => {
    const cookies = new Map<string, string>();
    const remoteAddress = `10.1.0.${++address}`;
    const request = async (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown, headers: Record<string, string> = {}) => {
      const response = await application.inject({ method, url: `/api/v1/auth/${path}`, payload: payload === undefined ? undefined : JSON.stringify(payload), remoteAddress, headers: { 'content-type': 'application/json', cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...headers } });
      for (const cookie of response.cookies) { if (!cookie.value) cookies.delete(cookie.name); else cookies.set(cookie.name, cookie.value); }
      return response;
    };
    const session = () => request('GET', 'session');
    const mutate = async (path: string, payload: unknown, method: 'POST' | 'PATCH' = 'POST', headers: Record<string, string> = {}) => {
      const current = await session();
      return request(method, path, payload, { origin: config.appUrl, 'content-type': 'application/json', 'x-csrf-token': current.json().csrf, ...headers });
    };
    return { session, mutate, request, cookies };
  };
  const ownerEmail = `owner@${domain}`;
  const owner = client();
  const result = await owner.mutate('signup', { name: 'Test Owner', email: ownerEmail, password: initialPassword, organization: 'Account fixture', timezone: 'America/Toronto' });
  assert.equal(result.statusCode, 201, result.body);
  const account = (await owner.session()).json();
  return { app, config, domain, owner, ownerEmail, account, client };
}
test.after(async () => { await db.$disconnect(); });

for (const mode of ['selfhosted', 'smtp'] as const) test(`disabled public signup has no side effects, while login and validated invitations work (${mode})`, async t => {
  const f = await fixture(t, mode);
  const restricted = await buildApp({ logger: false, accountConfig: { ...f.config, disableSignup: true } });
  t.after(() => restricted.close());
  const guest = f.client(restricted);
  assert.equal((await guest.session()).json().signupEnabled, false);
  assert.equal((await f.owner.session()).json().signupEnabled, true);
  const email = `blocked@${f.domain}`; const organization = `Blocked ${f.domain}`;
  const input = { name: 'Blocked Signup', email, password: initialPassword, organization };
  const denied = await guest.mutate('signup', input);
  assert.equal(denied.statusCode, 403); assert.equal(denied.json().error.code, 'SIGNUP_DISABLED');
  assert.equal(await db.user.count({ where: { email } }), 0);
  assert.equal(await db.organization.count({ where: { name: organization } }), 0);
  assert.equal(await db.emailOutbox.count({ where: { to: email } }), 0);
  assert.equal((await guest.session()).json().user, null);
  assert.equal((await guest.mutate('signup', input, 'POST', { origin: 'https://forged.example' })).json().error.code, 'ORIGIN_REJECTED');
  assert.equal((await guest.mutate('signup', input, 'POST', { 'x-csrf-token': opaqueToken() })).json().error.code, 'CSRF_REJECTED');
  const invited = `invited@${f.domain}`;
  const invalid = await guest.mutate('signup', { name: 'Invited Signup', email: invited, password: initialPassword, inviteToken: opaqueToken() });
  assert.equal(invalid.statusCode, 400); assert.equal(await db.user.count({ where: { email: invited } }), 0);
  const link = await db.$transaction(tx => issueInvitation(tx, f.account.memberships[0].org.id, invited, 'member', f.config, false));
  const token = new URL(link).hash.split('=')[1]!;
  const joined = await guest.mutate('signup', { name: 'Invited Signup', email: invited, password: initialPassword, inviteToken: token });
  assert.equal(joined.statusCode, 201, joined.body);
  const session = (await guest.session()).json();
  assert.equal(session.signupEnabled, false); assert.equal(session.user.verified, true);
  assert.equal(session.memberships[0].org.id, f.account.memberships[0].org.id);
  assert.equal((await guest.mutate('invitation', { token })).statusCode, 400);
  const existing = f.client(restricted);
  assert.equal((await existing.mutate('login', { email: f.ownerEmail, password: initialPassword })).statusCode, 200);
  assert.equal((await existing.session()).json().user.id, f.account.user.id);
});

test('signup persists an owner, salted password, opaque session, and no automatic platform privilege', async t => {
  const f = await fixture(t);
  const user = await db.user.findUniqueOrThrow({ where: { email: f.ownerEmail } });
  assert.ok(user.passwordHash.startsWith('$argon2id$'));
  assert.equal(user.platformAdmin, false);
  assert.equal(user.verified, false);
  assert.equal(f.account.memberships[0].role, 'owner');
  assert.equal(f.account.memberships[0].org.timezone, 'America/Toronto');
  const raw = f.owner.cookies.get('okr_session')!;
  const session = await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(raw) } });
  assert.notEqual(raw, session.tokenHash);
  assert.ok(Math.abs(session.expiresAt.getTime() - Date.now() - 7 * DAY) < 10000);
  const current = await f.owner.session();
  assert.ok(!current.body.includes('passwordHash'));
});
test('duplicate emails, password policy, normalized login and generic invalid credentials', async t => {
  const f = await fixture(t); const guest = f.client();
  const duplicate = await guest.mutate('signup', { name: 'Duplicate', email: f.ownerEmail.toUpperCase(), password: initialPassword, organization: 'Duplicate org' });
  assert.equal(duplicate.statusCode, 409);
  const short = await guest.mutate('signup', { name: 'Short', email: `short@${f.domain}`, password: 'short', organization: 'Short org' });
  assert.equal(short.statusCode, 400);
  const wrong = await guest.mutate('login', { email: f.ownerEmail, password: 'wrong' });
  const missing = await guest.mutate('login', { email: `missing@${f.domain}`, password: 'wrong' });
  assert.equal(wrong.statusCode, 401); assert.equal(missing.statusCode, 401);
  assert.equal(wrong.json().error.message, missing.json().error.message);
  assert.equal((await guest.mutate('login', { email: ` ${f.ownerEmail.toUpperCase()} `, password: initialPassword })).statusCode, 200);
  assert.equal((await guest.mutate('logout', {})).statusCode, 200);
  assert.equal((await guest.session()).json().user, null);
});
test('origin, CSRF, JSON and protected profile checks reject unauthorized requests', async t => {
  const f = await fixture(t);
  assert.equal((await f.owner.mutate('profile', { name: 'Forged' }, 'PATCH', { origin: 'https://attacker.example' })).statusCode, 403);
  assert.equal((await f.owner.mutate('profile', { name: 'Forged' }, 'PATCH', { 'x-csrf-token': opaqueToken() })).statusCode, 403);
  assert.equal((await f.owner.mutate('profile', { name: 'Forged' }, 'PATCH', { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  const guest = f.client();
  assert.equal((await guest.mutate('profile', { name: 'Guest' }, 'PATCH')).statusCode, 401);
  assert.equal((await guest.request('POST', 'login', { email: f.ownerEmail, password: initialPassword }, { origin: f.config.appUrl })).statusCode, 403);
  assert.equal((await f.owner.mutate('profile', { name: 'Updated Owner' }, 'PATCH')).statusCode, 200);
  assert.equal((await f.owner.session()).json().user.name, 'Updated Owner');
});
test('expired and suspended sessions cannot access an account or mutate its profile', async t => {
  const f = await fixture(t);
  await db.session.updateMany({ where: { userId: f.account.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await f.owner.session()).json().user, null);
  assert.equal((await f.owner.mutate('profile', { name: 'Expired' }, 'PATCH')).statusCode, 401);
  const guest = f.client();
  assert.equal((await guest.mutate('login', { email: f.ownerEmail, password: initialPassword })).statusCode, 200);
  await db.user.update({ where: { id: f.account.user.id }, data: { active: false } });
  assert.equal((await guest.session()).json().user, null);
  assert.equal((await guest.mutate('login', { email: f.ownerEmail, password: initialPassword })).statusCode, 401);
});
test('password changes reject wrong credentials and revoke every session', async t => {
  const f = await fixture(t); const second = f.client();
  assert.equal((await second.mutate('login', { email: f.ownerEmail, password: initialPassword })).statusCode, 200);
  assert.equal((await f.owner.mutate('password', { currentPassword: 'wrong', password: nextPassword })).statusCode, 400);
  assert.equal((await f.owner.mutate('password', { currentPassword: initialPassword, password: nextPassword })).statusCode, 200);
  assert.equal((await f.owner.session()).json().user, null);
  assert.equal((await second.session()).json().user, null);
  assert.equal(await db.session.count({ where: { userId: f.account.user.id } }), 0);
  assert.equal((await second.mutate('login', { email: f.ownerEmail, password: initialPassword })).statusCode, 401);
  assert.equal((await second.mutate('login', { email: f.ownerEmail, password: nextPassword })).statusCode, 200);
});
test('self-hosted recovery never discloses account existence or queues an email', async t => {
  const f = await fixture(t); const guest = f.client();
  const known = await guest.mutate('recovery', { email: f.ownerEmail });
  const unknown = await guest.mutate('recovery', { email: `unknown@${f.domain}` });
  assert.deepEqual(known.json(), unknown.json());
  assert.equal(await db.emailOutbox.count({ where: { to: { endsWith: f.domain } } }), 0);
});
test('reset links expire, are single-use, and revoke all sessions without verifying the email', async t => {
  const f = await fixture(t);
  const link = await db.$transaction(tx => issueAction(tx, f.account.user.id, 'reset', f.ownerEmail, f.config, false));
  const token = new URL(link).hash.split('=')[1]!;
  assert.ok(link.includes('#token='));
  const row = await db.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
  assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - 30 * 60000) < 5000);
  const guest = f.client();
  assert.equal((await guest.mutate('reset', { token: opaqueToken(), password: nextPassword })).statusCode, 400);
  assert.equal((await guest.mutate('reset', { token, password: nextPassword })).statusCode, 200);
  assert.equal((await f.owner.session()).json().user, null);
  assert.equal((await guest.mutate('reset', { token, password: nextPassword })).statusCode, 400);
  assert.equal((await guest.mutate('login', { email: f.ownerEmail, password: nextPassword })).statusCode, 200);
  assert.equal((await guest.session()).json().user.verified, false);
  const expired = await db.$transaction(tx => issueAction(tx, f.account.user.id, 'reset', f.ownerEmail, f.config, false));
  const expiredToken = new URL(expired).hash.split('=')[1]!;
  await db.authToken.update({ where: { tokenHash: hashToken(expiredToken) }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await guest.mutate('reset', { token: expiredToken, password: initialPassword })).statusCode, 400);
});
test('concurrent reset consumption allows only one success', async t => {
  const f = await fixture(t);
  const link = await db.$transaction(tx => issueAction(tx, f.account.user.id, 'reset', f.ownerEmail, f.config, false));
  const token = new URL(link).hash.split('=')[1]!;
  const a = f.client(); const b = f.client();
  const results = await Promise.all([a.mutate('reset', { token, password: nextPassword }), b.mutate('reset', { token, password: initialPassword })]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 400]);
});
test('new-account invitations bind email, reject replay, and roll back failed signup', async t => {
  const f = await fixture(t); const orgId = f.account.memberships[0].org.id; const guest = f.client();
  const inviteEmail = `invited@${f.domain}`;
  const link = await db.$transaction(tx => issueInvitation(tx, orgId, inviteEmail, 'viewer', f.config, false));
  const token = new URL(link).hash.split('=')[1]!;
  const row = await db.invitation.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
  assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - 7 * DAY) < 5000);
  assert.equal((await guest.mutate('signup', { name: 'Wrong Recipient', email: `wrong@${f.domain}`, password: initialPassword, inviteToken: token })).statusCode, 400);
  assert.equal(await db.user.count({ where: { email: `wrong@${f.domain}` } }), 0);
  assert.equal((await guest.mutate('invitation', { token })).json().email, inviteEmail);
  assert.equal((await guest.mutate('signup', { name: 'Invited', email: inviteEmail, password: initialPassword, inviteToken: token })).statusCode, 201);
  const joined = (await guest.session()).json();
  assert.equal(joined.user.verified, true); assert.equal(joined.memberships[0].role, 'viewer');
  assert.equal((await guest.mutate('invitation', { token })).statusCode, 400);
});
test('existing invitation acceptance does not promote an existing membership', async t => {
  const f = await fixture(t); const orgId = f.account.memberships[0].org.id;
  const link = await db.$transaction(tx => issueInvitation(tx, orgId, f.ownerEmail, 'viewer', f.config, false));
  const token = new URL(link).hash.split('=')[1]!;
  assert.equal((await f.owner.mutate('accept-invitation', { token })).statusCode, 200);
  assert.equal((await f.owner.session()).json().memberships[0].role, 'owner');
  assert.equal((await f.owner.mutate('accept-invitation', { token })).statusCode, 400);
});
test('expired invitations and inactive organizations/memberships cannot be used', async t => {
  const f = await fixture(t); const orgId = f.account.memberships[0].org.id;
  const link = await db.$transaction(tx => issueInvitation(tx, orgId, f.ownerEmail, 'member', f.config, false));
  const token = new URL(link).hash.split('=')[1]!;
  await db.membership.update({ where: { id: f.account.memberships[0].id }, data: { active: false } });
  assert.equal((await f.owner.mutate('accept-invitation', { token })).statusCode, 403);
  assert.equal((await db.invitation.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } })).usedAt, null);
  await db.organization.update({ where: { id: orgId }, data: { active: false } });
  assert.equal((await f.owner.mutate('invitation', { token })).statusCode, 400);
  await db.organization.update({ where: { id: orgId }, data: { active: true } });
  await db.invitation.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await f.owner.mutate('invitation', { token })).statusCode, 400);
});
test('SMTP verification and recovery atomically queue tokens, reject wrong type/replay, and expire', async t => {
  const f = await fixture(t, 'smtp');
  const queued = await db.emailOutbox.findFirstOrThrow({ where: { to: f.ownerEmail } });
  const token = queued.text.match(/#token=([a-f0-9]{64})/)![1]!;
  const row = await db.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
  assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - DAY) < 5000);
  assert.equal((await f.owner.mutate('reset', { token, password: nextPassword })).statusCode, 400);
  assert.equal((await f.owner.mutate('verify', { token })).statusCode, 200);
  assert.equal((await f.owner.session()).json().user.verified, true);
  assert.equal((await f.owner.mutate('verify', { token })).statusCode, 400);
  const guest = f.client();
  const known = await guest.mutate('recovery', { email: f.ownerEmail });
  const missing = await guest.mutate('recovery', { email: `missing@${f.domain}` });
  assert.deepEqual(known.json(), missing.json());
  assert.equal(await db.emailOutbox.count({ where: { to: f.ownerEmail } }), 2);
  const expiredLink = await db.$transaction(tx => issueAction(tx, f.account.user.id, 'verify', f.ownerEmail, f.config, false));
  const expired = new URL(expiredLink).hash.split('=')[1]!;
  await db.authToken.update({ where: { tokenHash: hashToken(expired) }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await guest.mutate('verify', { token: expired })).statusCode, 400);
});
test('mail worker uses exclusive claims, bounded retries, sanitized errors and payload removal', async t => {
  const f = await fixture(t);
  const row = await db.emailOutbox.create({ data: { to: f.ownerEmail, subject: 'Worker fixture', text: 'Secret link fixture' } });
  let sent = 0;
  await Promise.all([deliverOne(db, async email => { assert.equal(email.id, row.id); sent++; }), deliverOne(db, async email => { assert.equal(email.id, row.id); sent++; })]);
  assert.equal(sent, 1);
  const delivered = await db.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
  assert.ok(delivered.sentAt); assert.ok(!delivered.text.includes('Secret'));
  const retry = await db.emailOutbox.create({ data: { to: f.ownerEmail, subject: 'Retry fixture', text: 'Retry secret' } });
  await deliverOne(db, async () => { throw new Error('SMTP password=private'); });
  const failed = await db.emailOutbox.findUniqueOrThrow({ where: { id: retry.id } });
  assert.equal(failed.attempts, 1); assert.equal(failed.lastError, 'SMTP delivery failed'); assert.ok(failed.nextAttemptAt > new Date());
  await db.emailOutbox.update({ where: { id: retry.id }, data: { attempts: 5, nextAttemptAt: new Date(0) } });
  assert.equal(await deliverOne(db, async () => { throw new Error('Should not send'); }), false);
});

test('trusted operator command issues audited copied reset/invitation links and rejects invalid actors', async t => {
  const f = await fixture(t);
  const args = ['--import', 'tsx', 'src/accounts/issue-link.ts', '--org', f.account.memberships[0].org.id, '--actor', f.ownerEmail];
  const run = promisify(execFile);
  const options = { cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, APP_URL: f.config.appUrl, EMAIL_MODE: 'selfhosted', COOKIE_SECURE: 'false' } };
  const reset = await run(process.execPath, [...args, '--type', 'reset', '--email', f.ownerEmail], options);
  const resetToken = new URL(reset.stdout.trim()).hash.split('=')[1]!;
  assert.equal((await f.client().mutate('reset', { token: resetToken, password: nextPassword })).statusCode, 200);
  const invitation = await run(process.execPath, [...args, '--type', 'invite', '--email', `cli@${f.domain}`, '--role', 'viewer'], options);
  const token = new URL(invitation.stdout.trim()).hash.split('=')[1]!;
  assert.equal((await f.client().mutate('invitation', { token })).json().role, 'viewer');
  assert.equal(await db.auditEvent.count({ where: { userId: f.account.user.id, type: { in: ['operator_reset_issued', 'operator_invitation_issued'] } } }), 2);
  await assert.rejects(run(process.execPath, ['--import', 'tsx', 'src/accounts/issue-link.ts', '--org', f.account.memberships[0].org.id, '--actor', `unknown@${f.domain}`, '--type', 'reset', '--email', f.ownerEmail], options));
});
test('secure signup cookies carry HttpOnly, SameSite, Secure and seven-day expiry', async t => {
  const domain = `${randomUUID()}.accounts.example`;
  const app = await buildApp({ logger: false, accountConfig: { appUrl: 'https://okr.example.com', secure: true, disableSignup: false, emailMode: 'selfhosted' } });
  t.after(async () => {
    await app.close();
    const user = await db.user.findUnique({ where: { email: `secure@${domain}` } });
    if (user) {
      const memberships = await db.membership.findMany({ where: { userId: user.id } });
      await db.auditEvent.deleteMany({ where: { userId: user.id } });
      await db.organization.deleteMany({ where: { id: { in: memberships.map(m => m.orgId) } } });
      await db.user.delete({ where: { id: user.id } });
    }
  });
  const anonymous = await app.inject('/api/v1/auth/session');
  const cookie = anonymous.cookies.find(c => c.name === 'okr_csrf')!;
  const result = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', headers: { origin: 'https://okr.example.com', cookie: `okr_csrf=${cookie.value}`, 'x-csrf-token': anonymous.json().csrf }, payload: { email: `secure@${domain}`, name: 'Secure Account', password: initialPassword, organization: 'Secure fixture' } });
  assert.equal(result.statusCode, 201);
  const headers = String(result.headers['set-cookie']);
  for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=604800']) assert.ok(headers.includes(flag));
});
test('login rate limit is enforced by client IP in normal runtime', async t => {
  const f = await fixture(t); const guest = f.client();
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await guest.mutate('login', { email: `absent@${f.domain}`, password: 'incorrect' })).statusCode, 401);
  const limited = await guest.mutate('login', { email: `absent@${f.domain}`, password: 'incorrect' });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
});
test('database rejects noncanonical email addresses and unsupported action token types', async t => {
  const f = await fixture(t);
  await assert.rejects(db.user.update({ where: { id: f.account.user.id }, data: { email: f.ownerEmail.toUpperCase() } }), /constraint/i);
  await assert.rejects(db.authToken.create({ data: { userId: f.account.user.id, type: 'unsupported', tokenHash: hashToken(opaqueToken()), expiresAt: new Date(Date.now() + DAY) } }), /constraint/i);
});
