import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { organizationSchema, organizationUpdateSchema, memberUpdateSchema, ownershipTransferSchema, invitationSchema, teamSchema, teamUpdateSchema, teamMemberSchema, versionSchema } from '@okr/shared';
import { db } from '../db.js';
import { ApiError } from '../errors.js';
import { accountConfig, assertLiveSession, checkMutation, readSession, requireSession, type AccountConfig } from '../accounts/security.js';
import { requireVerifiedEmail } from '../accounts/access.js';
import { issueInvitation } from '../accounts/tokens.js';
import { assertOffboarding, checkVersion, isAdmin, notFound, requireAdmin, requireAssignable, requireMembership, requireOwner, requireTeamManager, writeAccess } from './access.js';

const paramsSchema = z.object({ orgId: z.string().uuid(), id: z.string().uuid().optional(), membershipId: z.string().uuid().optional() });
const pageSchema = z.object({ search: z.string().trim().max(254).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
const userSelect = { id: true, name: true, email: true, verified: true, active: true } as const;
const memberInclude = { user: { select: userSelect }, teamMembers: true } as const;
const teamInclude = { members: { include: { membership: { include: { user: { select: userSelect } } } }, orderBy: { membershipId: 'asc' as const } } } as const;
async function audit(tx: Prisma.TransactionClient, orgId: string, userId: string, type: string, text: string, data: Prisma.InputJsonObject = {}) {
  await tx.auditEvent.create({ data: { orgId, userId, type, text, data } });
}
async function unique<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') throw new ApiError(409, 'DUPLICATE_NAME', 'A team already uses that name');
    throw e;
  }
}
export async function registerOrganizations(app: FastifyInstance, options: { database?: PrismaClient; config?: AccountConfig } = {}) {
  const database = options.database ?? db; const config = options.config ?? accountConfig();
  const route = (summary: string) => ({ schema: { tags: ['organizations'], summary } });
  app.addHook('preHandler', async request => {
    const session = requireSession(await readSession(database, request));
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) checkMutation(request, session, config);
  });
  app.post('/api/v1/orgs', route('Create another organization as owner'), async (request, reply) => {
    const session = requireSession(await readSession(database, request)); const input = organizationSchema.parse(request.body);
    const result = await database.$transaction(async tx => {
      await assertLiveSession(tx, session);
      const user = await tx.user.findUniqueOrThrow({ where: { id: session.userId } }); requireVerifiedEmail(user, config);
      const org = await tx.organization.create({ data: input });
      await tx.membership.create({ data: { orgId: org.id, userId: session.userId, role: 'owner' } });
      await audit(tx, org.id, session.userId, 'organization_created', 'Organization created'); return org;
    });
    return reply.code(201).send(result);
  });
  app.get('/api/v1/orgs/:orgId', route('Read current organization and membership'), async request => {
    const { orgId } = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request));
    const member = await requireMembership(database, orgId, session.userId);
    return { organization: member.org, membership: { id: member.id, role: member.role, version: member.version } };
  });
  app.patch('/api/v1/orgs/:orgId', route('Update organization name and timezone'), async request => {
    const { orgId } = paramsSchema.parse(request.params); const input = organizationUpdateSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    return database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); requireAdmin(actor); checkVersion(actor.org.version, input.version);
      const result = await tx.organization.update({ where: { id: orgId }, data: { name: input.name, timezone: input.timezone, version: { increment: 1 } } });
      await audit(tx, orgId, session.userId, 'organization_updated', 'Organization settings updated', { name: input.name, timezone: input.timezone }); return result;
    });
  });
  app.get('/api/v1/orgs/:orgId/members', route('Search tenant members'), async request => {
    const { orgId } = paramsSchema.parse(request.params); const query = pageSchema.parse(request.query); const session = requireSession(await readSession(database, request));
    const actor = await requireMembership(database, orgId, session.userId);
    const where: Prisma.MembershipWhereInput = { orgId, ...(isAdmin(actor) ? {} : { active: true, user: { active: true } }), ...(query.search ? { OR: [{ user: { name: { contains: query.search, mode: 'insensitive' } } }, { user: { email: { contains: query.search, mode: 'insensitive' } } }] } : {}) };
    const [items, total] = await database.$transaction([database.membership.findMany({ where, include: memberInclude, orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }), database.membership.count({ where })]);
    return { items, total, page: query.page, limit: query.limit };
  });
  app.patch('/api/v1/orgs/:orgId/members/:id', route('Change membership role or activation'), async request => {
    const { orgId, id } = paramsSchema.parse(request.params); const input = memberUpdateSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    return database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); requireAdmin(actor);
      const target = await tx.membership.findFirst({ where: { orgId, id }, include: { user: { select: userSelect } } }); if (!target) throw notFound();
      if (target.role === 'owner' || input.role === 'owner') requireOwner(actor);
      checkVersion(target.version, input.version);
      if (input.active && !target.user.active) throw new ApiError(409, 'ACCOUNT_INACTIVE', 'The platform account is suspended');
      if (target.active && target.user.active && target.role === 'owner' && (!input.active || input.role !== 'owner')) {
        const owners = await tx.membership.count({ where: { orgId, active: true, role: 'owner', user: { active: true } } });
        if (owners <= 1) throw new ApiError(409, 'LAST_OWNER', 'Keep at least one active organization owner');
      }
      if (!input.active || input.role === 'viewer') await assertOffboarding(tx, orgId, target.id);
      if (!input.active || !['owner', 'admin', 'manager'].includes(input.role)) {
        const managed = await tx.teamMember.findMany({ where: { orgId, membershipId: target.id, manager: true } });
        await tx.teamMember.updateMany({ where: { orgId, membershipId: target.id, manager: true }, data: { manager: false } });
        await tx.team.updateMany({ where: { orgId, id: { in: managed.map(m => m.teamId) } }, data: { version: { increment: 1 } } });
      }
      const result = await tx.membership.update({ where: { id: target.id }, data: { role: input.role, active: input.active, version: { increment: 1 } }, include: memberInclude });
      await audit(tx, orgId, session.userId, 'membership_updated', `Membership updated for ${target.user.name}`, { membershipId: target.id, before: { role: target.role, active: target.active }, after: { role: input.role, active: input.active } }); return result;
    });
  });
  app.post('/api/v1/orgs/:orgId/transfer-ownership', route('Transfer your ownership to an active member'), async request => {
    const { orgId } = paramsSchema.parse(request.params); const input = ownershipTransferSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    await database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); requireOwner(actor); checkVersion(actor.version, input.version);
      const target = await requireAssignable(tx, orgId, input.membershipId, false); checkVersion(target.version, input.targetVersion);
      if (target.id === actor.id) throw new ApiError(400, 'INVALID_TARGET', 'Select another active member');
      await tx.membership.update({ where: { id: target.id }, data: { role: 'owner', version: { increment: 1 } } });
      await tx.membership.update({ where: { id: actor.id }, data: { role: 'admin', version: { increment: 1 } } });
      await audit(tx, orgId, session.userId, 'ownership_transferred', 'Ownership transferred; previous owner is now an administrator', { from: actor.id, to: target.id });
    }); return { message: 'Ownership transferred. You are now an administrator.' };
  });
  app.get('/api/v1/orgs/:orgId/invitations', route('List invitation status without bearer tokens'), async request => {
    const { orgId } = paramsSchema.parse(request.params); const query = pageSchema.parse(request.query); const session = requireSession(await readSession(database, request)); requireAdmin(await requireMembership(database, orgId, session.userId));
    const where = { orgId, email: { contains: query.search, mode: 'insensitive' as const } };
    const [items, total] = await database.$transaction([database.invitation.findMany({ where, select: { id: true, email: true, role: true, expiresAt: true, usedAt: true }, orderBy: [{ expiresAt: 'desc' }, { id: 'asc' }], take: query.limit, skip: (query.page - 1) * query.limit }), database.invitation.count({ where })]);
    return { items, total, page: query.page, limit: query.limit };
  });
  app.post('/api/v1/orgs/:orgId/invitations', route('Issue a copied invitation, optionally email it'), async (request, reply) => {
    const { orgId } = paramsSchema.parse(request.params); const input = invitationSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    const result = await database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); requireAdmin(actor);
      if (input.send && config.emailMode !== 'smtp') throw new ApiError(409, 'EMAIL_DISABLED', 'SMTP email delivery is disabled');
      const existing = await tx.membership.findFirst({ where: { orgId, user: { email: input.email } } });
      if (existing) throw new ApiError(409, 'ALREADY_MEMBER', 'This person already belongs to the organization. Update their membership instead.');
      const link = await issueInvitation(tx, orgId, input.email, input.role, config, input.send);
      await audit(tx, orgId, session.userId, 'invitation_issued', 'Invitation issued', { email: input.email, role: input.role, delivered: input.send }); return { link, message: input.send ? 'Invitation created and email queued' : 'Invitation created' };
    }); return reply.code(201).send(result);
  });
  app.delete('/api/v1/orgs/:orgId/invitations/:id', route('Revoke an unused invitation'), async request => {
    const { orgId, id } = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request));
    await database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); requireAdmin(actor);
      const invite = await tx.invitation.findFirst({ where: { orgId, id } }); if (!invite) throw notFound();
      if (invite.usedAt) throw new ApiError(409, 'INVITATION_CLOSED', 'This invitation was already accepted or revoked');
      await tx.invitation.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
      await audit(tx, orgId, session.userId, 'invitation_revoked', 'Invitation revoked', { invitationId: invite.id, email: invite.email });
    }); return { message: 'Invitation revoked' };
  });
  app.get('/api/v1/orgs/:orgId/teams', route('List teams and tenant members'), async request => {
    const { orgId } = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request)); await requireMembership(database, orgId, session.userId);
    return database.team.findMany({ where: { orgId }, include: teamInclude, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  });
  app.post('/api/v1/orgs/:orgId/teams', route('Create a team'), async (request, reply) => {
    const { orgId } = paramsSchema.parse(request.params); const input = teamSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    const result = await unique(() => database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); requireAdmin(actor);
      const team = await tx.team.create({ data: { orgId, name: input.name } }); await audit(tx, orgId, session.userId, 'team_created', `Team created: ${team.name}`, { teamId: team.id }); return team;
    })); return reply.code(201).send(result);
  });
  app.patch('/api/v1/orgs/:orgId/teams/:id', route('Rename a team you manage'), async request => {
    const { orgId, id } = paramsSchema.parse(request.params); const input = teamUpdateSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    return unique(() => database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); const team = await requireTeamManager(tx, actor, id!); checkVersion(team.version, input.version);
      const result = await tx.team.update({ where: { id: team.id }, data: { name: input.name, version: { increment: 1 } } });
      await audit(tx, orgId, session.userId, 'team_updated', `Team renamed to ${result.name}`, { teamId: team.id, before: team.name, after: result.name }); return result;
    }));
  });
  app.delete('/api/v1/orgs/:orgId/teams/:id', route('Delete a team without objectives'), async request => {
    const { orgId, id } = paramsSchema.parse(request.params); const input = versionSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    await database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); requireAdmin(actor); const team = await requireTeamManager(tx, actor, id!); checkVersion(team.version, input.version);
      if (await tx.objective.count({ where: { orgId, teamId: team.id } })) throw new ApiError(409, 'TEAM_IN_USE', 'Move this team’s objectives before deleting it');
      await tx.team.delete({ where: { id: team.id } }); await audit(tx, orgId, session.userId, 'team_deleted', `Team deleted: ${team.name}`, { teamId: team.id });
    }); return { message: 'Team deleted' };
  });
  app.put('/api/v1/orgs/:orgId/teams/:id/members/:membershipId', route('Add a team member or change manager designation'), async request => {
    const { orgId, id, membershipId } = paramsSchema.parse(request.params); const input = teamMemberSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    return database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); const team = await requireTeamManager(tx, actor, id!); checkVersion(team.version, input.version);
      const target = await requireAssignable(tx, orgId, membershipId!, false);
      const existing = await tx.teamMember.findUnique({ where: { teamId_membershipId: { teamId: team.id, membershipId: target.id } } });
      if (input.manager || existing?.manager) requireAdmin(actor);
      if (input.manager && !['owner', 'admin', 'manager'].includes(target.role)) throw new ApiError(400, 'INVALID_MANAGER', 'Designated managers need the manager, admin, or owner role');
      await tx.teamMember.upsert({ where: { teamId_membershipId: { teamId: team.id, membershipId: target.id } }, create: { orgId, teamId: team.id, membershipId: target.id, manager: input.manager }, update: { manager: input.manager } });
      const result = await tx.team.update({ where: { id: team.id }, data: { version: { increment: 1 } } });
      await audit(tx, orgId, session.userId, 'team_member_updated', 'Team membership updated', { teamId: team.id, membershipId: target.id, manager: input.manager }); return result;
    });
  });
  app.delete('/api/v1/orgs/:orgId/teams/:id/members/:membershipId', route('Remove a team member'), async request => {
    const { orgId, id, membershipId } = paramsSchema.parse(request.params); const input = versionSchema.parse(request.body); const session = requireSession(await readSession(database, request));
    await database.$transaction(async tx => {
      const actor = await writeAccess(tx, session, orgId, config); const team = await requireTeamManager(tx, actor, id!); checkVersion(team.version, input.version);
      const existing = await tx.teamMember.findFirst({ where: { orgId, teamId: team.id, membershipId } }); if (!existing) throw notFound(); if (existing.manager) requireAdmin(actor);
      await tx.teamMember.delete({ where: { teamId_membershipId: { teamId: team.id, membershipId: existing.membershipId } } });
      await tx.team.update({ where: { id: team.id }, data: { version: { increment: 1 } } });
      await audit(tx, orgId, session.userId, 'team_member_removed', 'Team member removed', { teamId: team.id, membershipId: existing.membershipId });
    }); return { message: 'Team member removed' };
  });
  app.get('/api/v1/orgs/:orgId/audit', route('Read administrative audit history'), async request => {
    const { orgId } = paramsSchema.parse(request.params); const query = pageSchema.parse(request.query); const session = requireSession(await readSession(database, request)); requireAdmin(await requireMembership(database, orgId, session.userId));
    const where = { orgId, objectiveId: null };
    const [items, total] = await database.$transaction([database.auditEvent.findMany({ where, include: { user: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit, skip: (query.page - 1) * query.limit }), database.auditEvent.count({ where })]);
    return { items, total, page: query.page, limit: query.limit };
  });
}
