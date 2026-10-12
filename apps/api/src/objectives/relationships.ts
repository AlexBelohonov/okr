import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createsCycle, date, linkChangeSchema, linkWriteSchema, states } from '@okr/shared';
import { db } from '../db.js';
import { queueSlack } from '../slack/service.js';
import { ApiError } from '../errors.js';
import { accountConfig, checkMutation, readSession, requireSession, type AccountConfig } from '../accounts/security.js';
import { checkVersion, notFound, requireMembership, writeAccess } from '../organizations/access.js';
import { canEditObjective, invalidateRelated, loadGraph, loadObjective, presentObjective, requireLiveObjective, requireObjectiveEdit, type Actor, type LoadedObjective } from './domain.js';

const paramsSchema = z.object({ orgId: z.string().uuid(), id: z.string().uuid().optional(), linkId: z.string().uuid().optional() });
const filters = z.object({ type: z.enum(['alignment', 'dependency']).default('alignment'), search: z.string().trim().max(200).default(''), periodId: z.string().uuid().optional(), teamId: z.string().uuid().optional(), leadId: z.string().uuid().optional(), state: z.enum(states).optional(), archived: z.enum(['false', 'true', 'all']).default('false'), from: date.optional(), to: date.optional() }).refine(v => !v.from || !v.to || v.from <= v.to, 'From date must be before to date');
const live = (o: LoadedObjective) => !o.archivedAt && ['active', 'draft'].includes(o.state);
const brief = (o: LoadedObjective) => ({ id: o.id, title: o.title, state: o.state, archivedAt: o.archivedAt, version: o.version, periodId: o.periodId, period: o.period, startDate: o.startDate, endDate: o.endDate });
export async function finishRelationship(tx: Prisma.TransactionClient, actor: Actor & { userId: string }, source: LoadedObjective, target: LoadedObjective, type: string, action: string, data: Prisma.InputJsonObject) {
    const changed = type === 'alignment' ? [source.id, target.id] : [target.id];
    await tx.objective.updateMany({ where: { orgId: actor.orgId, id: { in: changed } }, data: { version: { increment: 1 }, updatedAt: new Date() } });
    await invalidateRelated(tx, actor.orgId, changed);
    for (const objectiveId of [source.id, target.id]) {
      const entry = await tx.auditEvent.create({ data: { orgId: actor.orgId, userId: actor.userId, objectiveId, type: `relationship_${action}`, text: `${type === 'alignment' ? 'Alignment' : 'Prerequisite'} ${action}: ${source.title} → ${target.title}`, data } });
      await queueSlack(tx, entry);
    }
  }

export async function registerRelationships(app: FastifyInstance, options: { database?: PrismaClient; config?: AccountConfig } = {}) {
  const database = options.database ?? db; const config = options.config ?? accountConfig();
  const route = (summary: string) => ({ schema: { tags: ['relationships'], summary } });
  app.addHook('preHandler', async request => { const session = requireSession(await readSession(database, request)); if (['POST', 'PATCH', 'DELETE'].includes(request.method)) checkMutation(request, session, config); });
  async function read(request: FastifyRequest) { const params = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request)); return { params, actor: await requireMembership(database, params.orgId, session.userId) }; }
  async function write<T>(request: FastifyRequest, work: (tx: Prisma.TransactionClient, actor: Awaited<ReturnType<typeof writeAccess>>, params: z.infer<typeof paramsSchema>) => Promise<T>) {
    const params = paramsSchema.parse(request.params); const session = requireSession(await readSession(database, request));
    return database.$transaction(async tx => work(tx, await writeAccess(tx, session, params.orgId, config), params), { timeout: 10000 });
  }
  async function endpoints(tx: Prisma.TransactionClient, actor: Actor, input: { sourceId: string; targetId: string; type: string; sourceVersion: number; targetVersion: number }) {
    const source = await loadObjective(tx, actor.orgId, input.sourceId); const target = await loadObjective(tx, actor.orgId, input.targetId);
    await requireObjectiveEdit(tx, actor, target); requireLiveObjective(target);
    if (input.type === 'alignment') { await requireObjectiveEdit(tx, actor, source); requireLiveObjective(source); }
    checkVersion(source.version, input.sourceVersion); checkVersion(target.version, input.targetVersion);
    return { source, target };
  }
  app.get('/api/v1/orgs/:orgId/graph', route('Filter alignment or prerequisite graph with outside-filter connection counts'), async request => {
    const { params: { orgId }, actor } = await read(request); const query = filters.parse(request.query);
    return database.$transaction(async tx => {
      const graph = await loadGraph(tx, orgId); const links = graph.links.filter(l => l.type === query.type);
      const visible = graph.objectives.filter(o => (query.archived === 'all' || Boolean(o.archivedAt) === (query.archived === 'true')) && (!query.search || `${o.title} ${o.description}`.toLowerCase().includes(query.search.toLowerCase())) && (!query.periodId || o.periodId === query.periodId) && (!query.teamId || o.teamId === query.teamId) && (!query.leadId || o.leadId === query.leadId) && (!query.state || o.state === query.state) && (!query.from || o.endDate >= query.from) && (!query.to || o.startDate <= query.to));
      const ids = new Set(visible.map(o => o.id));
      const alignmentParents = new Map<string, number>();
      for (const link of graph.links) if (link.type === 'alignment') alignmentParents.set(link.targetId, (alignmentParents.get(link.targetId) || 0) + 1);
      const nodes = await Promise.all(visible.map(async o => ({ ...await presentObjective(tx, actor, o, graph), alignmentParentCount: alignmentParents.get(o.id) || 0, outsideConnections: new Set(links.filter(l => l.sourceId === o.id && !ids.has(l.targetId) || l.targetId === o.id && !ids.has(l.sourceId)).map(l => l.sourceId === o.id ? l.targetId : l.sourceId)).size })));
      return { nodes, links: links.filter(l => ids.has(l.sourceId) && ids.has(l.targetId)), total: nodes.length, type: query.type };
    }, { isolationLevel: 'RepeatableRead' });
  });
  app.get('/api/v1/orgs/:orgId/objectives/:id/relationships', route('Read parents, children, prerequisites and dependents with edit permissions'), async request => {
    const { params: { orgId, id }, actor } = await read(request);
    return database.$transaction(async tx => {
      await loadObjective(tx, orgId, id!); const graph = await loadGraph(tx, orgId); const nodes = new Map(graph.objectives.map(o => [o.id, o]));
      return Promise.all(graph.links.filter(l => l.sourceId === id || l.targetId === id).map(async l => {
        const source = nodes.get(l.sourceId)!; const target = nodes.get(l.targetId)!;
        const canChange = live(target) && await canEditObjective(tx, actor, target) && (l.type !== 'alignment' || live(source) && await canEditObjective(tx, actor, source));
        return { ...l, source: { ...brief(source), progress: graph.scores.get(source.id) }, target: { ...brief(target), progress: graph.scores.get(target.id) }, canChange, crossPeriod: source.periodId !== target.periodId || source.startDate !== target.startDate || source.endDate !== target.endDate };
      }));
    }, { isolationLevel: 'RepeatableRead' });
  });
  app.post('/api/v1/orgs/:orgId/links', route('Create a versioned alignment or prerequisite link; reject cycles under organization lock'), async (request, reply) => {
    const input = linkWriteSchema.parse(request.body);
    const result = await write(request, async (tx, actor, { orgId }) => {
      const { source, target } = await endpoints(tx, actor, input);
      const existing = await tx.objectiveLink.findMany({ where: { orgId, type: input.type } });
      if (existing.some(l => l.sourceId === input.sourceId && l.targetId === input.targetId)) throw new ApiError(409, 'DUPLICATE_LINK', 'These objectives are already connected in this graph');
      if (createsCycle(existing, input.sourceId, input.targetId)) throw new ApiError(409, 'GRAPH_CYCLE', 'This relationship would create a cycle');
      const link = await tx.objectiveLink.create({ data: { orgId, sourceId: input.sourceId, targetId: input.targetId, type: input.type, weight: input.type === 'alignment' ? input.weight : 1 } });
      await finishRelationship(tx, actor, source, target, link.type, 'created', { linkId: link.id, sourceId: source.id, targetId: target.id, type: link.type, weight: link.weight }); return link;
    }); return reply.code(201).send(result);
  });
  for (const method of ['PATCH', 'DELETE'] as const) app.route({ method, url: '/api/v1/orgs/:orgId/links/:linkId', ...route(method === 'PATCH' ? 'Change a parent-specific alignment weight' : 'Remove a relationship'), handler: async request => {
    const input = linkChangeSchema.parse(request.body);
    return write(request, async (tx, actor, { orgId, linkId }) => {
      const link = await tx.objectiveLink.findFirst({ where: { orgId, id: linkId } }); if (!link) throw notFound();
      const { source, target } = await endpoints(tx, actor, { ...link, ...input });
      if (method === 'PATCH' && (link.type !== 'alignment' || input.weight === undefined)) throw new ApiError(400, 'ALIGNMENT_WEIGHT_REQUIRED', 'Only alignment links have editable contribution weights');
      if (method === 'DELETE') await tx.objectiveLink.delete({ where: { id: link.id } });
      else await tx.objectiveLink.update({ where: { id: link.id }, data: { weight: input.weight! } });
      await finishRelationship(tx, actor, source, target, link.type, method === 'PATCH' ? 'updated' : 'removed', { linkId: link.id, sourceId: source.id, targetId: target.id, type: link.type, beforeWeight: link.weight, ...(method === 'PATCH' ? { weight: input.weight! } : {}) });
      return { message: method === 'PATCH' ? 'Contribution weight saved' : 'Relationship removed' };
    });
  } });
}
