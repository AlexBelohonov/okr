import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { db } from '../db.js';
import { ApiError } from '../errors.js';
import { accountConfig, checkMutation, readSession, requireSession, type AccountConfig } from '../accounts/security.js';
import { requireVerifiedEmail } from '../accounts/access.js';
import { assertOffboarding, checkVersion, lockOrganization, notFound } from '../organizations/access.js';
import { platformUserSelect, platformWrite, requirePlatform } from './access.js';

const querySchema = z.object({ search: z.string().trim().max(254).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
const paramsSchema = z.object({ id: z.string().uuid() });
const updateSchema = z.object({ active: z.boolean(), version: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }).strict();
async function audit(tx: Prisma.TransactionClient, actor: string, type: string, data: Prisma.InputJsonObject, text: string) {
  // Platform events remain separate from tenant history, even for organization activation.
  await tx.auditEvent.create({ data: { userId: actor, type, text, data } });
}
export async function registerPlatform(app: FastifyInstance, options: { database?: PrismaClient; config?: AccountConfig } = {}) {
  const database = options.database ?? db; const config = options.config ?? accountConfig();
  const sessionFor = async (request: Parameters<typeof readSession>[1]) => {
    const session = requireSession(await readSession(database, request)); requirePlatform(session.user); return session;
  };
  app.addHook('preHandler', async request => {
    const session = await sessionFor(request);
    if (request.method === 'PATCH') { checkMutation(request, session, config); requireVerifiedEmail(session.user, config); }
  });
  app.get('/api/v1/platform/users', async request => {
    const q = querySchema.parse(request.query);
    const where: Prisma.UserWhereInput = q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } : {};
    const [items, total] = await database.$transaction([database.user.findMany({ where, select: platformUserSelect, orderBy: [{ email: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit }), database.user.count({ where })]);
    return { items, total, page: q.page, limit: q.limit };
  });
  app.patch('/api/v1/platform/users/:id', async request => {
    const { id } = paramsSchema.parse(request.params); const input = updateSchema.parse(request.body); const session = await sessionFor(request);
    return database.$transaction(async tx => {
      const actor = await platformWrite(tx, session, id); requireVerifiedEmail(actor, config);
      const target = await tx.user.findUnique({ where: { id } }); if (!target) throw notFound(); checkVersion(target.version, input.version);
      if (!input.active && target.active) {
        if (target.platformAdmin && await tx.user.count({ where: { active: true, platformAdmin: true } }) <= 1) throw new ApiError(409, 'LAST_PLATFORM_ADMIN', 'Keep at least one active platform administrator');
        // Account lock prevents new memberships/invitation consumption while we obtain all tenant locks.
        const memberships = await tx.membership.findMany({ where: { userId: id }, orderBy: { orgId: 'asc' } });
        for (const member of memberships) await lockOrganization(tx, member.orgId);
        for (const member of memberships) {
          if (member.active && member.role === 'owner' && await tx.membership.count({ where: { orgId: member.orgId, active: true, role: 'owner', user: { active: true } } }) <= 1) throw new ApiError(409, 'LAST_OWNER', 'Keep at least one globally active owner in every organization, including suspended organizations');
          await assertOffboarding(tx, member.orgId, member.id);
        }
        const managed = await tx.teamMember.findMany({ where: { membership: { userId: id }, manager: true } });
        await tx.teamMember.updateMany({ where: { membership: { userId: id }, manager: true }, data: { manager: false } });
        await tx.team.updateMany({ where: { id: { in: [...new Set(managed.map(m => m.teamId))] } }, data: { version: { increment: 1 } } });
      }
      const result = await tx.user.update({ where: { id }, data: { active: input.active, version: { increment: 1 } }, select: platformUserSelect });
      if (!input.active) {
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
      }
      await audit(tx, actor.id, 'platform_account_activation', { targetUserId: id, before: target.active, after: input.active, reason: input.reason, version: result.version }, `Global account ${input.active ? 'activated' : 'suspended'}: ${target.email}`);
      return result;
    }, { timeout: 15000 });
  });
  app.get('/api/v1/platform/organizations', async request => {
    const q = querySchema.parse(request.query); const where: Prisma.OrganizationWhereInput = { name: { contains: q.search, mode: 'insensitive' } };
    const [items, total] = await database.$transaction([database.organization.findMany({ where, select: { id: true, name: true, timezone: true, active: true, version: true, createdAt: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit }), database.organization.count({ where })]);
    return { items, total, page: q.page, limit: q.limit };
  });
  app.patch('/api/v1/platform/organizations/:id', async request => {
    const { id } = paramsSchema.parse(request.params); const input = updateSchema.parse(request.body); const session = await sessionFor(request);
    return database.$transaction(async tx => {
      const actor = await platformWrite(tx, session); requireVerifiedEmail(actor, config); await lockOrganization(tx, id);
      const target = await tx.organization.findUnique({ where: { id } }); if (!target) throw notFound(); checkVersion(target.version, input.version);
      if (input.active && !await tx.membership.count({ where: { orgId: id, active: true, role: 'owner', user: { active: true } } })) throw new ApiError(409, 'LAST_OWNER', 'An organization needs a globally active owner before activation');
      const result = await tx.organization.update({ where: { id }, data: { active: input.active, version: { increment: 1 } } });
      await audit(tx, actor.id, 'platform_organization_activation', { targetOrgId: id, before: target.active, after: input.active, reason: input.reason, version: result.version }, `Organization ${input.active ? 'activated' : 'suspended'}: ${target.name}`);
      return result;
    });
  });
  app.get('/api/v1/platform/audit', async request => {
    const q = querySchema.parse(request.query); const where: Prisma.AuditEventWhereInput = { orgId: null, type: { startsWith: 'platform_' }, text: { contains: q.search, mode: 'insensitive' } };
    const [items, total] = await database.$transaction([database.auditEvent.findMany({ where, select: { id: true, type: true, text: true, data: true, createdAt: true, user: { select: { id: true, name: true, email: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit }), database.auditEvent.count({ where })]);
    return { items, total, page: q.page, limit: q.limit };
  });
}
