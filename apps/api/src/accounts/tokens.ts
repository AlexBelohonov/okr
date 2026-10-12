import type { Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { DAY, hashToken, opaqueToken, type AccountConfig } from './security.js';
import { lockOrganization } from '../organizations/access.js';

export const invalidLink = () => new ApiError(400, 'INVALID_LINK', 'This link is invalid, expired, or already used');
export function accountLink(config: AccountConfig, path: string, token: string) { return `${config.appUrl}/${path}#token=${token}`; }
export async function issueAction(tx: Prisma.TransactionClient, userId: string, type: 'verify' | 'reset', email: string, config: AccountConfig, deliver: boolean) {
  await tx.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  const raw = opaqueToken();
  await tx.authToken.create({ data: { userId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + (type === 'verify' ? DAY : 30 * 60000)) } });
  const link = accountLink(config, type === 'verify' ? 'verify-email' : 'reset-password', raw);
  if (deliver) await tx.emailOutbox.create({ data: { to: email, subject: type === 'verify' ? 'Verify your OKR Workspace email' : 'Reset your OKR Workspace password', text: `${type === 'verify' ? 'Verify your email within 24 hours' : 'Reset your password within 30 minutes'}:\n\n${link}\n\nIgnore this email if you did not request it.` } });
  return link;
}
export async function consumeAction(tx: Prisma.TransactionClient, raw: string, type: 'verify' | 'reset') {
  const token = await tx.authToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } });
  if (!token || token.type !== type || !token.user.active) throw invalidLink();
  const used = await tx.authToken.updateMany({ where: { id: token.id, type, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw invalidLink();
  return token;
}
export async function consumeInvite(tx: Prisma.TransactionClient, raw: string, email: string) {
  const invitation = await tx.invitation.findUnique({ where: { tokenHash: hashToken(raw) }, include: { org: true } });
  if (!invitation || invitation.email !== email || !invitation.org.active) throw invalidLink();
  await lockOrganization(tx, invitation.orgId);
  const org = await tx.organization.findUnique({ where: { id: invitation.orgId } });
  if (!org?.active) throw invalidLink();
  const result = await tx.invitation.updateMany({ where: { id: invitation.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (result.count !== 1) throw invalidLink();
  return invitation;
}
export async function issueInvitation(tx: Prisma.TransactionClient, orgId: string, email: string, role: string, config: AccountConfig, deliver: boolean) {
  await lockOrganization(tx, orgId);
  await tx.invitation.updateMany({ where: { orgId, email, usedAt: null }, data: { usedAt: new Date() } });
  const raw = opaqueToken();
  await tx.invitation.create({ data: { orgId, email, role, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 7 * DAY) } });
  const link = accountLink(config, 'invitation', raw);
  if (deliver) await tx.emailOutbox.create({ data: { to: email, subject: 'Your OKR Workspace invitation', text: `Join your organization within seven days:\n\n${link}` } });
  return link;
}
