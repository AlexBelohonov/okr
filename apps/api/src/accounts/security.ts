import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ApiError } from '../errors.js';

export const SESSION_COOKIE = 'okr_session';
export const CSRF_COOKIE = 'okr_csrf';
export const DAY = 86400000;
export const opaqueToken = () => randomBytes(32).toString('hex');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
export function equalToken(a: unknown, b: unknown) {
  return typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export interface AccountConfig { appUrl: string; secure: boolean; emailMode: 'smtp' | 'selfhosted'; disableSignup: boolean }
export function accountConfig(): AccountConfig {
  const appUrl = new URL(process.env.APP_URL || 'http://localhost:8080');
  const secure = process.env.COOKIE_SECURE === 'true';
  const emailMode = process.env.EMAIL_MODE || 'selfhosted';
  const disableSignup = process.env.DISABLE_SIGNUP ?? 'true';
  if (!['true', 'false'].includes(disableSignup)) throw new Error('DISABLE_SIGNUP must be true or false');
  if (!['smtp', 'selfhosted'].includes(emailMode)) throw new Error('Invalid EMAIL_MODE');
  if (secure && appUrl.protocol !== 'https:') throw new Error('Secure cookies require HTTPS APP_URL');
  if (appUrl.pathname !== '/' || appUrl.search || appUrl.hash || appUrl.username || appUrl.password) throw new Error('APP_URL must be an origin');
  if (process.env.NODE_ENV === 'production' && (!secure || appUrl.protocol !== 'https:')) throw new Error('Production accounts require HTTPS and secure cookies');
  return { appUrl: appUrl.origin, secure, emailMode: emailMode as AccountConfig['emailMode'], disableSignup: disableSignup === 'true' };
}
export async function readSession(database: PrismaClient, request: FastifyRequest) {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const session = await database.session.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: { include: { memberships: { where: { active: true, org: { active: true } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { org: true } } } } } });
  return session && session.expiresAt > new Date() && session.user.active ? session : null;
}
export type ActiveSession = NonNullable<Awaited<ReturnType<typeof readSession>>>;
export function requireSession(session: ActiveSession | null): ActiveSession {
  if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');
  return session;
}
export function checkMutation(request: FastifyRequest, session: ActiveSession | null, config: AccountConfig) {
  if (request.headers.origin !== config.appUrl || request.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed');
  const expected = session?.csrf ?? request.cookies[CSRF_COOKIE];
  if (!equalToken(request.headers['x-csrf-token'], expected)) throw new ApiError(403, 'CSRF_REJECTED', 'Refresh the page and try again');
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json');
}
export function cookieOptions(config: AccountConfig) { return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.secure }; }
export function clearSession(reply: FastifyReply, config: AccountConfig) {
  reply.clearCookie(SESSION_COOKIE, cookieOptions(config));
  reply.clearCookie(CSRF_COOKIE, cookieOptions(config));
}
export async function lockUser(tx: Prisma.TransactionClient, id: string) {
  // Serialize credential/session/non-key account writes while permitting FK KEY SHARE
  // references (notifications to a recipient waiting on the organization lock).
  // Account IDs/emails are not edited by these operations. Deletion still conflicts.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
}
export async function assertLiveSession(tx: Prisma.TransactionClient, session: ActiveSession) {
  await lockUser(tx, session.userId);
  const current = await tx.session.findUnique({ where: { id: session.id }, include: { user: true } });
  if (!current || current.expiresAt <= new Date() || !current.user.active) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');
}
export async function newSession(tx: Prisma.TransactionClient, userId: string) {
  const raw = opaqueToken();
  const session = await tx.session.create({ data: { userId, tokenHash: hashToken(raw), csrf: opaqueToken(), expiresAt: new Date(Date.now() + 7 * DAY) } });
  return { raw, session };
}
export function setSession(reply: FastifyReply, raw: string, config: AccountConfig) {
  reply.setCookie(SESSION_COOKIE, raw, { ...cookieOptions(config), maxAge: 7 * 86400 });
  reply.clearCookie(CSRF_COOKIE, cookieOptions(config));
}
