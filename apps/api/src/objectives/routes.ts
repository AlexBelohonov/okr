import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { archiveSchema, childObjectiveSchema, date, healths, keyResultSchema, metricOwnerSchema, metricUpdateSchema, objectiveSchema, ownershipSchema, periodCreateSchema, periodUpdateSchema, states, transitionSchema, versionSchema, type ObjectiveInput } from '@okr/shared';
import { db } from '../db.js';
import { finishRelationship } from './relationships.js';
import { notifyAssignments } from './notifications.js';
import { queueSlack } from '../slack/service.js';
import { ApiError } from '../errors.js';
import { accountConfig, checkMutation, readSession, requireSession, type AccountConfig } from '../accounts/security.js';
import { checkVersion, notFound, requireAdmin, requireAssignable, requireMembership, writeAccess } from '../organizations/access.js';
import { canEditObjective, invalidateRelated, loadGraph, loadObjective, objectiveInclude, objectiveProgress, prerequisites, presentObjective, quarterDates, requireLiveObjective, requireObjectiveEdit, requireScopeCreation, todayInTimezone, validateOwnership, validateReferences, type Actor, type LoadedObjective } from './domain.js';

const paramsSchema = z.object({ orgId: z.string().uuid(), id: z.string().uuid().optional(), metricId: z.string().uuid().optional() });
const pagination = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
const filterSchema = pagination.extend({ from: date.optional(), to: date.optional(), search: z.string().trim().max(200).default(''), periodId: z.string().uuid().optional(), teamId: z.string().uuid().optional(), leadId: z.string().uuid().optional(), state: z.enum(states).optional(), health: z.enum(healths).optional(), scope: z.enum(['company', 'team', 'personal']).optional(), archived: z.enum(['false', 'true', 'all']).default('false'), mine: z.enum(['true', 'false']).default('false'), sort: z.enum(['updatedAt', 'title', 'startDate', 'endDate']).default('updatedAt'), direction: z.enum(['asc', 'desc']).default('desc') }).refine(v => !v.from || !v.to || v.from <= v.to, 'From date must be before to date');
const objectiveVersionSchema = z.object({ objectiveVersion: z.number().int().positive() });
const followSchema = z.object({ follow: z.boolean(), version: z.number().int().positive() });
async function audit(tx: Prisma.TransactionClient, orgId: string, userId: string, type: string, text: string, data: Prisma.InputJsonObject, objectiveId?: string) {
  const entry = await tx.auditEvent.create({ data: { orgId, userId, type, text, data, objectiveId } });
  await queueSlack(tx, entry);
}
async function periodUnique<T>(work: () => Promise<T>) {
  try { return await work(); } catch (e) { if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') throw new ApiError(409, 'DUPLICATE_PERIOD', 'A period already uses that name'); throw e; }
}
function objectiveSnapshot(objective: LoadedObjective) {
  return { title: objective.title, description: objective.description, scope: objective.scope, teamId: objective.teamId, periodId: objective.periodId, startDate: objective.startDate, endDate: objective.endDate, leadId: objective.leadId, health: objective.health, progressMode: objective.progressMode, assignments: objective.assignments.map(a => ({ membershipId: a.membershipId, role: a.role })) };
}
export async function registerObjectives(app: FastifyInstance, options: { database?: PrismaClient; config?: AccountConfig } = {}) {
  const database = options.database ?? db; const config = options.config ?? accountConfig();
  const route = (summary: string) => ({ schema: { tags: ['objectives'], summary } });
  app.addHook('preHandler', async request => {
    const session = requireSession(await readSession(database, request));
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) checkMutation(request, session, config);
  });
  async function read(request: FastifyRequest) {
    const params = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request));
    const actor = await requireMembership(database, params.orgId, session.userId); return { params, actor };
  }
  async function write<T>(request: FastifyRequest, work: (tx: Prisma.TransactionClient, actor: Awaited<ReturnType<typeof writeAccess>>, params: z.infer<typeof paramsSchema>) => Promise<T>) {
    const params = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request));
    return database.$transaction(async tx => { const actor = await writeAccess(tx, session, params.orgId, config); return work(tx, actor, params); }, { timeout: 10000 });
  }
  async function finish(tx: Prisma.TransactionClient, actor: Actor & { userId: string }, objective: LoadedObjective, type: string, text: string, data: Prisma.InputJsonObject) {
    await tx.objective.update({ where: { id: objective.id }, data: { version: { increment: 1 } } });
    await invalidateRelated(tx, actor.orgId, [objective.id]);
    await audit(tx, actor.orgId, actor.userId, type, text, data, objective.id);
    const updated = await loadObjective(tx, actor.orgId, objective.id);
    await notifyAssignments(tx, objective, updated, actor.userId);
    return presentObjective(tx, actor, updated);
  }
  app.get('/api/v1/orgs/:orgId/periods', route('List planning periods'), async request => {
    const { params } = await read(request); return database.period.findMany({ where: { orgId: params.orgId }, orderBy: [{ startDate: 'desc' }, { id: 'asc' }] });
  });
  app.post('/api/v1/orgs/:orgId/periods', route('Create a calendar quarter or custom period'), async (request, reply) => {
    const input = periodCreateSchema.parse(request.body);
    const result = await periodUnique(() => write(request, async (tx, actor, { orgId }) => {
      requireAdmin(actor); const fields = input.kind === 'quarter' ? quarterDates(input.year, input.quarter) : { name: input.name, startDate: input.startDate, endDate: input.endDate };
      const period = await tx.period.create({ data: { orgId, ...fields } }); await audit(tx, orgId, actor.userId, 'period_created', `Planning period created: ${period.name}`, { periodId: period.id, ...fields }); return period;
    })); return reply.code(201).send(result);
  });
  app.patch('/api/v1/orgs/:orgId/periods/:id', route('Update an unused planning period or rename a used one'), async request => {
    const input = periodUpdateSchema.parse(request.body);
    return periodUnique(() => write(request, async (tx, actor, { orgId, id }) => {
      requireAdmin(actor); const period = await tx.period.findFirst({ where: { orgId, id } }); if (!period) throw notFound(); checkVersion(period.version, input.version);
      if ((period.startDate !== input.startDate || period.endDate !== input.endDate) && await tx.objective.count({ where: { orgId, periodId: period.id } })) throw new ApiError(409, 'PERIOD_IN_USE', 'Move this period’s objectives before changing its dates');
      const result = await tx.period.update({ where: { id: period.id }, data: { name: input.name, startDate: input.startDate, endDate: input.endDate, version: { increment: 1 } } });
      await audit(tx, orgId, actor.userId, 'period_updated', `Planning period updated: ${result.name}`, { periodId: period.id, before: { name: period.name, startDate: period.startDate, endDate: period.endDate }, after: { name: result.name, startDate: result.startDate, endDate: result.endDate } }); return result;
    }));
  });
  app.delete('/api/v1/orgs/:orgId/periods/:id', route('Delete a planning period without objective references'), async request => {
    const input = versionSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id }) => {
      requireAdmin(actor); const period = await tx.period.findFirst({ where: { orgId, id } }); if (!period) throw notFound(); checkVersion(period.version, input.version);
      if (await tx.objective.count({ where: { orgId, periodId: period.id } })) throw new ApiError(409, 'PERIOD_IN_USE', 'Move this period’s objectives before deleting it');
      await tx.period.delete({ where: { id: period.id } }); await audit(tx, orgId, actor.userId, 'period_deleted', `Planning period deleted: ${period.name}`, { periodId: period.id }); return { message: 'Period deleted' };
    });
  });
  app.get('/api/v1/orgs/:orgId/objectives', route('Search, filter, sort and paginate objectives'), async request => {
    const { params: { orgId }, actor } = await read(request); const query = filterSchema.parse(request.query);
    const where: Prisma.ObjectiveWhereInput = { orgId, ...(query.from ? { endDate: { gte: query.from } } : {}), ...(query.to ? { startDate: { lte: query.to } } : {}), ...(query.archived === 'all' ? {} : { archivedAt: query.archived === 'true' ? { not: null } : null }), ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }] } : {}), ...(query.periodId ? { periodId: query.periodId } : {}), ...(query.teamId ? { teamId: query.teamId } : {}), ...(query.leadId ? { leadId: query.leadId } : {}), ...(query.state ? { state: query.state } : {}), ...(query.health ? { health: query.health } : {}), ...(query.scope ? { scope: query.scope } : {}) };
    if (query.mine === 'true') where.AND = [{ OR: [{ leadId: actor.id }, { assignments: { some: { membershipId: actor.id } } }, { keyResults: { some: { ownerId: actor.id } } }] }];
    return database.$transaction(async tx => {
      const items = await tx.objective.findMany({ where, include: objectiveInclude, orderBy: [{ [query.sort]: query.direction }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit });
      const total = await tx.objective.count({ where }); const graph = await loadGraph(tx, orgId);
      return { items: await Promise.all(items.map(o => presentObjective(tx, actor, o, graph))), total, page: query.page, limit: query.limit };
    }, { isolationLevel: 'RepeatableRead' });
  });
  app.get('/api/v1/orgs/:orgId/objective-summary', route('Unique nonarchived counts and active objective progress'), async request => {
    const { params: { orgId }, actor } = await read(request);
    return database.$transaction(async tx => { const graph = await loadGraph(tx, orgId); const objectives = graph.objectives.filter(o => !o.archivedAt);
    const active = objectives.filter(o => o.state === 'active'); const today = todayInTimezone(actor.org.timezone);
    return { total: objectives.length, active: active.length, completed: objectives.filter(o => o.state === 'completed').length, draft: objectives.filter(o => o.state === 'draft').length, cancelled: objectives.filter(o => o.state === 'cancelled').length, onTrack: active.filter(o => o.health === 'on_track').length, overdue: active.filter(o => o.endDate < today).length, averageProgress: active.length ? active.reduce((sum, o) => sum + graph.scores.get(o.id)!, 0) / active.length : 0 };
    }, { isolationLevel: 'RepeatableRead' });
  });
  async function createObjective(tx: Prisma.TransactionClient, actor: Actor & { userId: string }, orgId: string, input: ObjectiveInput) {
    if (!['draft', 'active'].includes(input.state)) throw new ApiError(400, 'INVALID_STATE', 'Create a draft or active objective; close it using a lifecycle action');
    await requireScopeCreation(tx, actor, input.scope, input.teamId ?? null, input.leadId, true); await validateReferences(tx, actor, input);
    const { assignments, version: _version, ...fields } = input;
    const created = await tx.objective.create({ data: { ...fields, teamId: input.teamId ?? null, periodId: input.periodId ?? null, orgId } });
    if (assignments.length) await tx.assignment.createMany({ data: assignments.map(a => ({ ...a, orgId, objectiveId: created.id })) });
    const objective = await loadObjective(tx, orgId, created.id);
    await audit(tx, orgId, actor.userId, 'objective_created', `Objective created: ${objective.title}`, { ...objectiveSnapshot(objective), state: objective.state, progress: 0 }, objective.id);
    await notifyAssignments(tx, null, objective, actor.userId);
    return objective;
  }
  app.post('/api/v1/orgs/:orgId/objectives', route('Create a draft or active objective'), async (request, reply) => {
    const input = objectiveSchema.parse(request.body);
    const result = await write(request, async (tx, actor, { orgId }) => presentObjective(tx, actor, await createObjective(tx, actor, orgId, input)));
    return reply.code(201).send(result);
  });
  app.post('/api/v1/orgs/:orgId/objectives/:id/children', route('Atomically create an objective and its alignment to a versioned parent'), async (request, reply) => {
    const { parentVersion, ...input } = childObjectiveSchema.parse(request.body);
    const result = await write(request, async (tx, actor, { orgId, id }) => {
      const parent = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, parent); requireLiveObjective(parent); checkVersion(parent.version, parentVersion);
      const child = await createObjective(tx, actor, orgId, input); await requireObjectiveEdit(tx, actor, child);
      // A fresh child has no links, so adding its first incoming alignment cannot create a cycle.
      const link = await tx.objectiveLink.create({ data: { orgId, sourceId: parent.id, targetId: child.id, type: 'alignment', weight: 1 } });
      await finishRelationship(tx, actor, parent, child, 'alignment', 'created', { linkId: link.id, sourceId: parent.id, targetId: child.id, type: 'alignment', weight: 1 });
      return presentObjective(tx, actor, await loadObjective(tx, orgId, child.id));
    });
    return reply.code(201).send(result);
  });
  app.get('/api/v1/orgs/:orgId/objectives/:id', route('Read objective, metrics, ownership and current permissions'), async request => {
    const { params, actor } = await read(request); return database.$transaction(async tx => presentObjective(tx, actor, await loadObjective(tx, params.orgId, params.id!)), { isolationLevel: 'RepeatableRead' });
  });
  app.patch('/api/v1/orgs/:orgId/objectives/:id', route('Edit objective structure with its version'), async request => {
    const input = objectiveSchema.parse(request.body); versionSchema.parse(input);
    return write(request, async (tx, actor, { orgId, id }) => {
      const objective = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, objective); checkVersion(objective.version, input.version!); requireLiveObjective(objective);
      if (input.state !== objective.state) throw new ApiError(400, 'LIFECYCLE_REQUIRED', 'Change lifecycle using the lifecycle action');
      if (input.scope !== objective.scope || (input.teamId ?? null) !== objective.teamId) await requireScopeCreation(tx, actor, input.scope, input.teamId ?? null, input.leadId, false);
      await validateReferences(tx, actor, input); const before = objectiveSnapshot(objective);
      const { assignments, version: _version, ...fields } = input;
      await tx.assignment.deleteMany({ where: { orgId, objectiveId: objective.id } });
      await tx.objective.update({ where: { id: objective.id }, data: { ...fields, teamId: input.teamId ?? null, periodId: input.periodId ?? null } });
      if (assignments.length) await tx.assignment.createMany({ data: assignments.map(a => ({ ...a, orgId, objectiveId: objective.id })) });
      return finish(tx, actor, objective, 'objective_updated', 'Objective structure updated', { before, after: { ...fields, teamId: input.teamId ?? null, periodId: input.periodId ?? null, assignments } });
    });
  });
  app.patch('/api/v1/orgs/:orgId/objectives/:id/ownership', route('Reassign ownership even for closed or archived objectives'), async request => {
    const input = ownershipSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id }) => {
      const objective = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, objective); checkVersion(objective.version, input.version); await validateOwnership(tx, orgId, input);
      await tx.assignment.deleteMany({ where: { orgId, objectiveId: objective.id } });
      await tx.objective.update({ where: { id: objective.id }, data: { leadId: input.leadId } });
      if (input.assignments.length) await tx.assignment.createMany({ data: input.assignments.map(a => ({ ...a, orgId, objectiveId: objective.id })) });
      return finish(tx, actor, objective, 'ownership_updated', 'Objective ownership reassigned', { before: { leadId: objective.leadId, assignments: objectiveSnapshot(objective).assignments }, after: { leadId: input.leadId, assignments: input.assignments } });
    });
  });
  app.post('/api/v1/orgs/:orgId/objectives/:id/lifecycle', route('Activate, complete with frozen score, cancel, or reopen'), async request => {
    const input = transitionSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id }) => {
      const objective = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, objective); checkVersion(objective.version, input.version);
      if (objective.archivedAt) throw new ApiError(409, 'OBJECTIVE_ARCHIVED', 'Unarchive the objective before changing its lifecycle');
      const allowed: Record<string, string[]> = { draft: ['active', 'cancelled'], active: ['draft', 'completed', 'cancelled'], completed: ['active'], cancelled: ['active'] };
      if (!allowed[objective.state].includes(input.state)) throw new ApiError(400, 'INVALID_TRANSITION', 'Choose a valid lifecycle change. Reopen closed objectives to active.');
      if (input.state === 'completed' && !input.note) throw new ApiError(400, 'CLOSING_NOTE_REQUIRED', 'Add a closing note before completing this objective');
      const graph = await loadGraph(tx, orgId); const unresolved = prerequisites(graph, objective.id);
      if (input.state === 'completed' && unresolved.length && !input.overrideNote) throw new ApiError(409, 'PREREQUISITES_UNRESOLVED', 'Add a prerequisite override note before completing with unfinished prerequisites');
      const progress = graph.scores.get(objective.id)!;
      const overrideNote = input.state === 'completed' && unresolved.length ? input.overrideNote : '';
      await tx.objective.update({ where: { id: objective.id }, data: { state: input.state, finalScore: input.state === 'completed' ? progress : null, closingNote: input.state === 'completed' ? input.note : '', dependencyOverrideNote: overrideNote } });
      return finish(tx, actor, objective, 'objective_lifecycle', `Objective ${input.state === 'active' && ['completed', 'cancelled'].includes(objective.state) ? 'reopened' : input.state}`, { before: objective.state, after: input.state, note: input.note, overrideNote, unresolvedPrerequisites: unresolved.map(o => ({ id: o.id, title: o.title, state: o.state })), progress, finalScore: input.state === 'completed' ? progress : null });
    });
  });
  app.post('/api/v1/orgs/:orgId/objectives/:id/archive', route('Archive or unarchive without deleting history'), async request => {
    const input = archiveSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id }) => {
      const objective = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, objective); checkVersion(objective.version, input.version);
      if (Boolean(objective.archivedAt) === input.archived) throw new ApiError(409, 'ARCHIVE_UNCHANGED', 'The archive status already matches this request');
      await tx.objective.update({ where: { id: objective.id }, data: { archivedAt: input.archived ? new Date() : null } });
      const progress = (await loadGraph(tx, orgId)).scores.get(objective.id)!;
      return finish(tx, actor, objective, input.archived ? 'objective_archived' : 'objective_unarchived', input.archived ? 'Objective archived' : 'Objective unarchived', { archived: input.archived, progress });
    });
  });
  app.put('/api/v1/orgs/:orgId/objectives/:id/follow', route('Manage your own follower preference'), async request => {
    const input = followSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id }) => {
      const objective = await loadObjective(tx, orgId, id!); checkVersion(objective.version, input.version); const existing = objective.assignments.find(a => a.membershipId === actor.id);
      if (objective.leadId === actor.id || existing && existing.role !== 'follower') throw new ApiError(409, 'ASSIGNED_MEMBER', 'You already participate through your ownership or contribution role');
      if (input.follow) await tx.assignment.upsert({ where: { objectiveId_membershipId: { objectiveId: objective.id, membershipId: actor.id } }, create: { orgId, objectiveId: objective.id, membershipId: actor.id, role: 'follower' }, update: {} });
      else await tx.assignment.deleteMany({ where: { orgId, objectiveId: objective.id, membershipId: actor.id, role: 'follower' } });
      return finish(tx, actor, objective, 'follow_updated', input.follow ? 'Objective followed' : 'Objective unfollowed', { membershipId: actor.id, follow: input.follow });
    });
  });
  app.post('/api/v1/orgs/:orgId/objectives/:id/key-results', route('Create a measurable key result'), async (request, reply) => {
    const input = keyResultSchema.parse(request.body); const expected = objectiveVersionSchema.parse(request.body);
    const result = await write(request, async (tx, actor, { orgId, id }) => {
      const objective = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, objective); checkVersion(objective.version, expected.objectiveVersion); requireLiveObjective(objective);
      if (objective.keyResults.length >= 200) throw new ApiError(400, 'METRIC_LIMIT', 'Use at most 200 key results per objective');
      if (input.ownerId) await requireAssignable(tx, orgId, input.ownerId); const { version: _version, ...fields } = input;
      await tx.keyResult.create({ data: { ...fields, ownerId: input.ownerId ?? null, orgId, objectiveId: objective.id } });
      return finish(tx, actor, objective, 'key_result_created', `Key result created: ${input.title}`, { ...fields, ownerId: input.ownerId ?? null });
    }); return reply.code(201).send(result);
  });
  app.patch('/api/v1/orgs/:orgId/objectives/:id/key-results/:metricId', route('Edit key result structure with metric and objective versions'), async request => {
    const input = keyResultSchema.parse(request.body); versionSchema.parse(input); const expected = objectiveVersionSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id, metricId }) => {
      const objective = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, objective); checkVersion(objective.version, expected.objectiveVersion); requireLiveObjective(objective);
      const metric = objective.keyResults.find(kr => kr.id === metricId); if (!metric) throw notFound(); checkVersion(metric.version, input.version!);
      if (input.ownerId) await requireAssignable(tx, orgId, input.ownerId); const { version: _version, ...fields } = input;
      await tx.keyResult.update({ where: { id: metric.id }, data: { ...fields, ownerId: input.ownerId ?? null, version: { increment: 1 } } });
      return finish(tx, actor, objective, 'key_result_updated', `Key result structure updated: ${input.title}`, { metricId: metric.id, before: { title: metric.title, type: metric.type, baseline: metric.baseline, target: metric.target, current: metric.current, weight: metric.weight, unit: metric.unit, ownerId: metric.ownerId }, after: { ...fields, ownerId: input.ownerId ?? null } });
    });
  });
  app.patch('/api/v1/orgs/:orgId/objectives/:id/key-results/:metricId/current', route('Update a metric as lead, co-owner, contributor, manager, admin, or metric owner'), async request => {
    const input = metricUpdateSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id, metricId }) => {
      const objective = await loadObjective(tx, orgId, id!); const metric = objective.keyResults.find(kr => kr.id === metricId); if (!metric) throw notFound();
      const canContribute = actor.role !== 'viewer' && (await canEditObjective(tx, actor, objective) || metric.ownerId === actor.id || objective.assignments.some(a => a.membershipId === actor.id && a.role === 'contributor'));
      if (!canContribute) throw new ApiError(403, 'FORBIDDEN', 'A contribution or editing assignment is required');
      checkVersion(objective.version, input.objectiveVersion); checkVersion(metric.version, input.version); requireLiveObjective(objective);
      if (metric.type === 'binary' && ![0, 1].includes(input.current)) throw new ApiError(400, 'BINARY_VALUE', 'Binary outcomes must be 0 or 1');
      await tx.keyResult.update({ where: { id: metric.id }, data: { current: input.current, version: { increment: 1 } } });
      const progress = (await loadGraph(tx, orgId)).scores.get(objective.id)!;
      return finish(tx, actor, objective, 'metric_updated', `Metric updated: ${metric.title}`, { metricId: metric.id, before: metric.current, after: input.current, progress });
    });
  });
  app.patch('/api/v1/orgs/:orgId/objectives/:id/key-results/:metricId/owner', route('Reassign key result owner even for closed or archived work'), async request => {
    const input = metricOwnerSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id, metricId }) => {
      const objective = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, objective); checkVersion(objective.version, input.objectiveVersion);
      const metric = objective.keyResults.find(kr => kr.id === metricId); if (!metric) throw notFound(); checkVersion(metric.version, input.version); if (input.ownerId) await requireAssignable(tx, orgId, input.ownerId);
      await tx.keyResult.update({ where: { id: metric.id }, data: { ownerId: input.ownerId, version: { increment: 1 } } });
      return finish(tx, actor, objective, 'key_result_owner_updated', `Key result owner reassigned: ${metric.title}`, { metricId: metric.id, before: metric.ownerId, after: input.ownerId });
    });
  });
  app.delete('/api/v1/orgs/:orgId/objectives/:id/key-results/:metricId', route('Remove a key result with metric and objective versions'), async request => {
    const expected = objectiveVersionSchema.parse(request.body); const input = versionSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, id, metricId }) => {
      const objective = await loadObjective(tx, orgId, id!); await requireObjectiveEdit(tx, actor, objective); checkVersion(objective.version, expected.objectiveVersion); requireLiveObjective(objective);
      const metric = objective.keyResults.find(kr => kr.id === metricId); if (!metric) throw notFound(); checkVersion(metric.version, input.version);
      await tx.keyResult.delete({ where: { id: metric.id } });
      return finish(tx, actor, objective, 'key_result_deleted', `Key result removed: ${metric.title}`, { metricId: metric.id, title: metric.title, type: metric.type, baseline: metric.baseline, target: metric.target, current: metric.current, weight: metric.weight, unit: metric.unit, ownerId: metric.ownerId });
    });
  });
  app.get('/api/v1/orgs/:orgId/objectives/:id/history', route('Read immutable objective change history'), async request => {
    const { params: { orgId, id } } = await read(request); await loadObjective(database, orgId, id!); const query = pagination.parse(request.query); const where = { orgId, objectiveId: id! };
    const [items, total] = await database.$transaction([database.auditEvent.findMany({ where, include: { user: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), database.auditEvent.count({ where })]); return { items, total, ...query };
  });
}
