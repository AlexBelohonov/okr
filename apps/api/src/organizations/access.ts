import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../errors.js';
import { assertLiveSession, type ActiveSession, type AccountConfig } from '../accounts/security.js';
import { requireVerifiedEmail } from '../accounts/access.js';

type Database = Prisma.TransactionClient | PrismaClient;
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Resource not found');
export const isAdmin = (member: { role: string }) => ['owner', 'admin'].includes(member.role);
export function requireAdmin(member: { role: string }) {
  if (!isAdmin(member)) throw new ApiError(403, 'FORBIDDEN', 'Organization administrator access required');
}
export function requireOwner(member: { role: string }) {
  if (member.role !== 'owner') throw new ApiError(403, 'FORBIDDEN', 'Organization owner access required');
}
export function checkVersion(actual: number, expected: number) {
  if (actual !== expected) throw new ApiError(409, 'VERSION_CONFLICT', 'This record changed. Reload and try again.');
}
// Account/session locks precede organization locks. All tenant administration and
// invitation consumption serialize here; CH05 assignment writes must reuse this lock.
export async function lockOrganization(tx: Prisma.TransactionClient, orgId: string) {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId}::uuid FOR UPDATE`;
}
export async function requireMembership(database: Database, orgId: string, userId: string) {
  const member = await database.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true, user: { select: { active: true, verified: true } } } });
  if (!member?.active || !member.org.active || !member.user.active) throw notFound();
  return member;
}
export async function writeAccess(tx: Prisma.TransactionClient, session: ActiveSession, orgId: string, config: AccountConfig) {
  await assertLiveSession(tx, session);
  await lockOrganization(tx, orgId);
  const member = await requireMembership(tx, orgId, session.userId);
  requireVerifiedEmail(member.user, config);
  return member;
}
export async function requireAssignable(database: Database, orgId: string, membershipId: string, editing = true) {
  const member = await database.membership.findFirst({ where: { id: membershipId, orgId, active: true, user: { active: true } } });
  if (!member) throw notFound();
  if (editing && member.role === 'viewer') throw new ApiError(400, 'INVALID_ASSIGNMENT', 'Viewers cannot receive editing assignments');
  return member;
}
export async function requireTeamManager(database: Database, member: { id: string; orgId: string; role: string }, teamId: string) {
  const team = await database.team.findFirst({ where: { id: teamId, orgId: member.orgId } });
  if (!team) throw notFound();
  if (!isAdmin(member) && !(member.role === 'manager' && await database.teamMember.findFirst({ where: { orgId: member.orgId, teamId, membershipId: member.id, manager: true } })))
    throw new ApiError(403, 'FORBIDDEN', 'Manage only your designated teams');
  return team;
}
export async function assertOffboarding(tx: Prisma.TransactionClient, orgId: string, membershipId: string) {
  const [lead, assigned, metric] = await Promise.all([
    tx.objective.findFirst({ where: { orgId, leadId: membershipId } }),
    tx.assignment.findFirst({ where: { orgId, membershipId, role: { in: ['coowner', 'contributor'] } } }),
    tx.keyResult.findFirst({ where: { orgId, ownerId: membershipId } })
  ]);
  if (lead || assigned || metric) throw new ApiError(409, 'REASSIGN_REQUIRED', 'Reassign objective leads, editing assignments, and key result ownership first');
}
