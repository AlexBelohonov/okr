import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { signupSchema, loginSchema, profileSchema, passwordChangeSchema, recoverySchema, tokenSchema, resetSchema } from '@okr/shared';
import { ApiError } from '../errors.js';
import { db } from '../db.js';
import { accountConfig, assertLiveSession, checkMutation, clearSession, cookieOptions, CSRF_COOKIE, hashPassword, hashToken, lockUser, newSession, opaqueToken, readSession, requireSession, setSession, verifyPassword, type AccountConfig } from './security.js';
import { consumeAction, consumeInvite, invalidLink, issueAction } from './tokens.js';

export async function registerAccounts(app: FastifyInstance, options: { database?: PrismaClient; config?: AccountConfig } = {}) {
  const database = options.database ?? db;
  const config = options.config ?? accountConfig();
  const dummyHash = await hashPassword(opaqueToken());
  const multiplier = process.env.NODE_ENV === 'test' ? 20 : 1;
  const route = (summary: string, max = 15) => ({ schema: { tags: ['accounts'], summary }, config: { rateLimit: { max: max * multiplier, timeWindow: '1 minute' } } });
  app.addHook('preHandler', async request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) checkMutation(request, await readSession(database, request), config);
  });
  app.get('/api/v1/auth/session', route('Current account and CSRF token', 120), async (request, reply) => {
    const session = await readSession(database, request);
    const previous = request.cookies[CSRF_COOKIE];
    const csrf = session?.csrf ?? (previous && /^[a-f0-9]{64}$/.test(previous) ? previous : opaqueToken());
    if (!session) {
      clearSession(reply, config);
      reply.setCookie(CSRF_COOKIE, csrf, { ...cookieOptions(config), maxAge: 3600 });
    }
    return { csrf, emailMode: config.emailMode, signupEnabled: !config.disableSignup, user: session ? { id: session.user.id, email: session.user.email, name: session.user.name, verified: session.user.verified, platformAdmin: session.user.platformAdmin } : null,
      memberships: session?.user.memberships.map(m => ({ id: m.id, role: m.role, org: { id: m.org.id, name: m.org.name, timezone: m.org.timezone } })) ?? [] };
  });
  app.post('/api/v1/auth/signup', route('Create an account and organization, or join an invitation', 6), async (request, reply) => {
    const input = signupSchema.parse(request.body);
    if (config.disableSignup && !input.inviteToken) throw new ApiError(403, 'SIGNUP_DISABLED', 'Public sign-up is disabled. Ask an organization administrator for an invitation.');
    const passwordHash = await hashPassword(input.password);
    try {
      const result = await database.$transaction(async tx => {
        const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, verified: Boolean(input.inviteToken) } });
        if (input.inviteToken) {
          const invite = await consumeInvite(tx, input.inviteToken, input.email);
          await tx.membership.create({ data: { orgId: invite.orgId, userId: user.id, role: invite.role } });
          await tx.auditEvent.create({ data: { orgId: invite.orgId, userId: user.id, type: 'invitation_accepted', text: 'Account joined by invitation' } });
        } else {
          const org = await tx.organization.create({ data: { name: input.organization!, timezone: input.timezone } });
          await tx.membership.create({ data: { orgId: org.id, userId: user.id, role: 'owner' } });
          await tx.auditEvent.create({ data: { orgId: org.id, userId: user.id, type: 'organization_created', text: 'Account and organization created' } });
        }
        if (config.emailMode === 'smtp' && !user.verified) await issueAction(tx, user.id, 'verify', user.email, config, true);
        return newSession(tx, user.id);
      });
      setSession(reply, result.raw, config);
      return reply.code(201).send({ message: 'Account created' });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ApiError(409, 'EMAIL_IN_USE', 'An account already uses that email. Sign in instead.');
      throw error;
    }
  });
  app.post('/api/v1/auth/login', route('Sign in', 10), async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await database.user.findUnique({ where: { email: input.email } });
    if (!user) { await verifyPassword(dummyHash, input.password); throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'); }
    const result = await database.$transaction(async tx => {
      await lockUser(tx, user.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const valid = await verifyPassword(current.passwordHash, input.password);
      if (!valid || !current.active) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      const oldRaw = request.cookies.okr_session;
      if (oldRaw) await tx.session.deleteMany({ where: { tokenHash: hashToken(oldRaw) } });
      return newSession(tx, user.id);
    }, { timeout: 15000 });
    setSession(reply, result.raw, config);
    return { message: 'Signed in' };
  });
  app.post('/api/v1/auth/logout', route('Sign out', 120), async (request, reply) => {
    const session = await readSession(database, request);
    if (session) await database.$transaction(async tx => { await lockUser(tx, session.userId); await tx.session.deleteMany({ where: { id: session.id } }); });
    clearSession(reply, config);
    return { message: 'Signed out' };
  });
  app.patch('/api/v1/auth/profile', route('Update your name'), async request => {
    const session = requireSession(await readSession(database, request));
    const input = profileSchema.parse(request.body);
    await database.$transaction(async tx => {
      await assertLiveSession(tx, session);
      await tx.user.update({ where: { id: session.userId }, data: input });
      await tx.auditEvent.create({ data: { userId: session.userId, type: 'profile_updated', text: 'Profile name updated' } });
    });
    return { message: 'Profile saved' };
  });
  app.post('/api/v1/auth/password', route('Change password and revoke all sessions', 6), async (request, reply) => {
    const session = requireSession(await readSession(database, request));
    const input = passwordChangeSchema.parse(request.body);
    const passwordHash = await hashPassword(input.password);
    await database.$transaction(async tx => {
      await assertLiveSession(tx, session);
      const user = await tx.user.findUniqueOrThrow({ where: { id: session.userId } });
      if (!await verifyPassword(user.passwordHash, input.currentPassword)) throw new ApiError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.authToken.updateMany({ where: { userId: user.id, type: 'reset', usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { userId: user.id, type: 'password_changed', text: 'Password changed; sessions revoked' } });
    }, { timeout: 15000 });
    clearSession(reply, config);
    return { message: 'Password changed. Sign in again.' };
  });
  app.post('/api/v1/auth/recovery', route('Request password recovery (generic response)', 6), async request => {
    const { email } = recoverySchema.parse(request.body);
    const deadline = Date.now() + 250 + randomInt(50);
    try {
      if (config.emailMode === 'smtp') {
        const user = await database.user.findUnique({ where: { email } });
        if (user) await database.$transaction(async tx => {
          await lockUser(tx, user.id);
          const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
          if (current.active) await issueAction(tx, user.id, 'reset', current.email, config, true);
        });
      }
    } catch { request.log.warn({ code: 'RECOVERY_QUEUE_UNAVAILABLE' }, 'Recovery could not be queued'); }
    await delay(Math.max(0, deadline - Date.now()));
    return { message: 'If recovery is available for this address, instructions will be sent. Without email delivery, contact your administrator.' };
  });
  app.post('/api/v1/auth/reset', route('Consume a reset link and revoke all sessions', 6), async (request, reply) => {
    const input = resetSchema.parse(request.body);
    const token = await database.authToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
    if (!token || token.type !== 'reset') throw invalidLink();
    const passwordHash = await hashPassword(input.password);
    await database.$transaction(async tx => {
      await lockUser(tx, token.userId);
      const consumed = await consumeAction(tx, input.token, 'reset');
      await tx.user.update({ where: { id: consumed.userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: consumed.userId } });
      await tx.authToken.updateMany({ where: { userId: consumed.userId, type: 'reset', usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { userId: consumed.userId, type: 'password_reset', text: 'Password reset; sessions revoked' } });
    });
    clearSession(reply, config);
    return { message: 'Password reset. Sign in with your new password.' };
  });
  app.post('/api/v1/auth/verification', route('Resend your verification email', 3), async request => {
    const session = requireSession(await readSession(database, request));
    if (config.emailMode !== 'smtp') throw new ApiError(409, 'EMAIL_DISABLED', 'Email verification is not configured');
    await database.$transaction(async tx => {
      await assertLiveSession(tx, session);
      const user = await tx.user.findUniqueOrThrow({ where: { id: session.userId } });
      if (!user.verified) await issueAction(tx, user.id, 'verify', user.email, config, true);
    });
    return { message: 'Verification email queued' };
  });
  app.post('/api/v1/auth/verify', route('Consume an email verification link'), async request => {
    const { token: raw } = tokenSchema.parse(request.body);
    const token = await database.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!token || token.type !== 'verify') throw invalidLink();
    await database.$transaction(async tx => {
      await lockUser(tx, token.userId);
      const consumed = await consumeAction(tx, raw, 'verify');
      await tx.user.update({ where: { id: consumed.userId }, data: { verified: true } });
      await tx.auditEvent.create({ data: { userId: consumed.userId, type: 'email_verified', text: 'Email verified' } });
    });
    return { message: 'Email verified' };
  });
  app.post('/api/v1/auth/invitation', route('Inspect an invitation without consuming it'), async request => {
    const { token } = tokenSchema.parse(request.body);
    const invite = await database.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { org: true } });
    if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !invite.org.active) throw invalidLink();
    return { email: invite.email, organization: invite.org.name, role: invite.role };
  });
  app.post('/api/v1/auth/accept-invitation', route('Join an invited organization with your existing account'), async request => {
    const session = requireSession(await readSession(database, request));
    const { token } = tokenSchema.parse(request.body);
    await database.$transaction(async tx => {
      await assertLiveSession(tx, session);
      const user = await tx.user.findUniqueOrThrow({ where: { id: session.userId } });
      const invite = await consumeInvite(tx, token, user.email);
      const existing = await tx.membership.findUnique({ where: { orgId_userId: { orgId: invite.orgId, userId: user.id } } });
      if (existing && !existing.active) throw new ApiError(403, 'MEMBERSHIP_INACTIVE', 'Ask your administrator to reactivate your membership');
      if (!existing) await tx.membership.create({ data: { orgId: invite.orgId, userId: user.id, role: invite.role } });
      await tx.user.update({ where: { id: user.id }, data: { verified: true } });
      await tx.auditEvent.create({ data: { orgId: invite.orgId, userId: user.id, type: 'invitation_accepted', text: 'Invitation accepted' } });
    });
    return { message: 'Invitation accepted' };
  });
}
