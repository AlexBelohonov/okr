import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { checkInSchema, commentSchema, notificationPreferenceSchema } from '@okr/shared';
import { db } from '../db.js';
import { ApiError } from '../errors.js';
import { accountConfig, checkMutation, readSession, requireSession, type AccountConfig } from '../accounts/security.js';
import { checkVersion, notFound, requireMembership, writeAccess } from '../organizations/access.js';
import { invalidateRelated, loadGraph, loadObjective, presentObjective, requireLiveObjective } from './domain.js';
import { notifyObjective } from './notifications.js';
import { queueSlack } from '../slack/service.js';

const paramsSchema = z.object({ orgId: z.string().uuid(), id: z.string().uuid().optional() });
const pagination = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
const user = { select: { id: true, name: true } } as const;
export async function registerCollaboration(app: FastifyInstance, options: { database?: PrismaClient; config?: AccountConfig } = {}) {
  const database = options.database ?? db; const config = options.config ?? accountConfig();
  const route = (summary: string) => ({ schema: { tags: ['collaboration'], summary } });
  app.addHook('preHandler', async request => {
    const session = requireSession(await readSession(database, request));
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) checkMutation(request, session, config);
  });
  async function read(request: FastifyRequest) {
    const params = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request));
    const actor = await requireMembership(database, params.orgId, session.userId); return { params, actor };
  }
  async function write<T>(request: FastifyRequest, work: (tx: Prisma.TransactionClient, actor: Awaited<ReturnType<typeof writeAccess>>, params: z.infer<typeof paramsSchema>) => Promise<T>) {
    const params = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request));
    return database.$transaction(async tx => work(tx, await writeAccess(tx, session, params.orgId, config), params), { timeout: 10000 });
  }
  app.post('/api/v1/orgs/:orgId/objectives/:id/check-ins', route('Create an immutable, atomic progress check-in'), async (request, reply) => {
    const input = checkInSchema.parse(request.body);
    const result = await write(request, async (tx, actor, { orgId, id }) => {
      const objective = await loadObjective(tx, orgId, id!); const presented = await presentObjective(tx, actor, objective);
      if (!presented.canContribute && !presented.keyResults.some(kr => kr.canUpdate)) throw new ApiError(403, 'FORBIDDEN', 'A contribution or editing assignment is required');
      checkVersion(objective.version, input.version); requireLiveObjective(objective);
      for (const change of input.metrics) {
        const metric = presented.keyResults.find(kr => kr.id === change.id); if (!metric) throw notFound();
        if (!metric.canUpdate) throw new ApiError(403, 'FORBIDDEN', 'Update only metrics you own or contribute to');
        checkVersion(metric.version, change.version);
        if (metric.type === 'binary' && ![0, 1].includes(change.current)) throw new ApiError(400, 'BINARY_VALUE', 'Binary outcomes must be 0 or 1');
        await tx.keyResult.update({ where: { id: metric.id }, data: { current: change.current, version: { increment: 1 } } });
      }
      await tx.objective.update({ where: { id: objective.id }, data: { health: input.health, version: { increment: 1 } } });
      await invalidateRelated(tx, orgId, [objective.id]);
      const graph = await loadGraph(tx, orgId); const updated = graph.objectives.find(o => o.id === objective.id)!; const progress = graph.scores.get(objective.id)!;
      const metrics = { mode: updated.progressMode, keyResults: updated.keyResults.map(kr => ({ id: kr.id, title: kr.title, type: kr.type, baseline: kr.baseline, target: kr.target, current: kr.current, unit: kr.unit, weight: kr.weight, ownerId: kr.ownerId, version: kr.version })), children: graph.links.filter(l => l.type === 'alignment' && l.sourceId === objective.id).map(l => { const child = graph.objectives.find(o => o.id === l.targetId)!; return { id: child.id, title: child.title, weight: l.weight, state: child.state, archived: Boolean(child.archivedAt), progress: graph.scores.get(child.id)! }; }), changes: input.metrics.map(change => ({ ...change, before: objective.keyResults.find(kr => kr.id === change.id)!.current })) };
      const entry = await tx.checkIn.create({ data: { orgId, objectiveId: objective.id, userId: actor.userId, note: input.note, health: input.health, progress, metrics } });
      const audit = await tx.auditEvent.create({ data: { orgId, objectiveId: objective.id, userId: actor.userId, type: 'check_in_created', text: 'Progress check-in posted', data: { checkInId: entry.id, note: input.note, health: input.health, previousHealth: objective.health, progress, metrics } } });
      await queueSlack(tx, audit);
      await notifyObjective(tx, updated, actor.userId, `New check-in: ${objective.title}`);
      return entry;
    }); return reply.code(201).send(result);
  });
  app.post('/api/v1/orgs/:orgId/objectives/:id/comments', route('Post an immutable comment, including on archived work'), async (request, reply) => {
    const input = commentSchema.parse(request.body);
    const result = await write(request, async (tx, actor, { orgId, id }) => {
      const objective = await loadObjective(tx, orgId, id!);
      if (actor.role === 'viewer') throw new ApiError(403, 'FORBIDDEN', 'Viewers cannot comment');
      const entry = await tx.comment.create({ data: { orgId, objectiveId: objective.id, userId: actor.userId, text: input.text } });
      const audit = await tx.auditEvent.create({ data: { orgId, objectiveId: objective.id, userId: actor.userId, type: 'comment_created', text: 'Comment posted', data: { commentId: entry.id, note: entry.text } } });
      await queueSlack(tx, audit);
      await notifyObjective(tx, objective, actor.userId, `New comment: ${objective.title}`); return entry;
    }); return reply.code(201).send(result);
  });
  for (const kind of ['check-ins', 'comments'] as const) app.get(`/api/v1/orgs/:orgId/objectives/:id/${kind}`, route(`Read immutable ${kind}`), async request => {
    const { params: { orgId, id } } = await read(request); const query = pagination.parse(request.query);
    return database.$transaction(async tx => {
      await loadObjective(tx, orgId, id!); const where = { orgId, objectiveId: id! }; const args = { where, include: { user }, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], skip: (query.page - 1) * query.limit, take: query.limit };
      const items = kind === 'check-ins' ? await tx.checkIn.findMany(args) : await tx.comment.findMany(args);
      const total = kind === 'check-ins' ? await tx.checkIn.count({ where }) : await tx.comment.count({ where }); return { items, total, ...query };
    }, { isolationLevel: 'RepeatableRead' });
  });
  app.get('/api/v1/orgs/:orgId/activity', route('Paginated objective activity without administrative events'), async request => {
    const { params: { orgId } } = await read(request); const query = pagination.parse(request.query); const where = { orgId, objectiveId: { not: null } };
    const [items, total] = await database.$transaction([database.auditEvent.findMany({ where, include: { user, objective: { select: { id: true, title: true, archivedAt: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), database.auditEvent.count({ where })]); return { items, total, ...query };
  });
  app.put('/api/v1/orgs/:orgId/objectives/:id/notification-preference', route('Mute or enable notifications for yourself'), async request => {
    const input = notificationPreferenceSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id }) => {
      await loadObjective(tx, orgId, id!);
      return tx.objectivePreference.upsert({ where: { objectiveId_userId: { objectiveId: id!, userId: actor.userId } }, create: { orgId, objectiveId: id!, userId: actor.userId, enabled: input.enabled }, update: { enabled: input.enabled } });
    });
  });
  app.get('/api/v1/orgs/:orgId/notifications', route('List your notifications and unread count'), async request => {
    const { params: { orgId }, actor } = await read(request); const query = pagination.extend({ unread: z.enum(['true', 'false']).default('false') }).parse(request.query);
    const own = { orgId, userId: actor.userId }; const where = { ...own, ...(query.unread === 'true' ? { readAt: null } : {}) };
    const [items, total, unread] = await database.$transaction([database.notification.findMany({ where, include: { objective: { select: { id: true, title: true, archivedAt: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), database.notification.count({ where }), database.notification.count({ where: { ...own, readAt: null } })]); return { items, total, unread, page: query.page, limit: query.limit };
  });
  app.put('/api/v1/orgs/:orgId/notifications/:id/read', route('Mark your own notification read or unread'), async request => {
    const input = z.object({ read: z.boolean() }).strict().parse(request.body);
    return write(request, async (tx, actor, { orgId, id }) => {
      const entry = await tx.notification.findFirst({ where: { id, orgId, userId: actor.userId } }); if (!entry) throw notFound();
      if (entry.objectiveId) await loadObjective(tx, orgId, entry.objectiveId);
      return tx.notification.update({ where: { id: entry.id }, data: { readAt: input.read ? entry.readAt ?? new Date() : null } });
    });
  });
  app.put('/api/v1/orgs/:orgId/notifications/read-all', route('Mark your current organization notifications read'), async request => {
    z.object({}).strict().parse(request.body);
    return write(request, async (tx, actor, { orgId }) => tx.notification.updateMany({ where: { orgId, userId: actor.userId, readAt: null }, data: { readAt: new Date() } }));
  });
}
