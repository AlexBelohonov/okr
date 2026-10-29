import type { Prisma, PrismaClient } from '@prisma/client';
import { graphProgress, metricProgress, weightedProgress, type ObjectiveInput } from '@okr/shared';
import { ApiError } from '../errors.js';
import { isAdmin, notFound, requireAssignable } from '../organizations/access.js';

type Database = Prisma.TransactionClient | PrismaClient;
export const personSelect = { id: true, name: true, email: true, active: true, verified: true } as const;
export const memberInclude = { user: { select: personSelect } } as const;
export const objectiveInclude = { lead: { include: memberInclude }, team: true, period: true, assignments: { include: { membership: { include: memberInclude } } }, keyResults: { include: { owner: { include: memberInclude } }, orderBy: { id: 'asc' as const } } } as const;
export type LoadedObjective = Prisma.ObjectiveGetPayload<{ include: typeof objectiveInclude }>;
export type Actor = { id: string; orgId: string; role: string };

export function quarterDates(year: number, quarter: number) {
  const y = String(year).padStart(4, '0');
  return { name: `Q${quarter} ${y}`, startDate: `${y}-${String(quarter * 3 - 2).padStart(2, '0')}-01`, endDate: `${y}-${String(quarter * 3).padStart(2, '0')}-${quarter === 2 || quarter === 3 ? '30' : '31'}` };
}
export function objectiveProgress(objective: Pick<LoadedObjective, 'state' | 'finalScore' | 'progressMode' | 'keyResults'>) {
  if (objective.state === 'completed') return objective.finalScore ?? 0;
  if (objective.progressMode === 'children') return 0;
  return weightedProgress(objective.keyResults.map(kr => ({ progress: metricProgress(kr as Parameters<typeof metricProgress>[0]), weight: kr.weight })));
}
export async function canEditObjective(database: Database, actor: Actor, objective: Pick<LoadedObjective, 'leadId' | 'teamId' | 'assignments'>) {
  if (actor.role === 'viewer') return false;
  if (isAdmin(actor) || objective.leadId === actor.id || objective.assignments.some(a => a.membershipId === actor.id && a.role === 'coowner')) return true;
  return actor.role === 'manager' && Boolean(objective.teamId) && Boolean(await database.teamMember.findFirst({ where: { orgId: actor.orgId, teamId: objective.teamId!, membershipId: actor.id, manager: true } }));
}
export async function requireObjectiveEdit(database: Database, actor: Actor, objective: LoadedObjective) {
  if (!await canEditObjective(database, actor, objective)) throw new ApiError(403, 'FORBIDDEN', 'Objective lead, co-owner, or administrator access required');
}
export async function requireScopeCreation(database: Database, actor: Actor, scope: string, teamId: string | null, leadId: string, creating: boolean) {
  if (actor.role === 'viewer') throw new ApiError(403, 'FORBIDDEN', 'Viewers cannot create or edit objectives');
  if (scope === 'team') {
    if (!teamId || !await database.team.findFirst({ where: { id: teamId, orgId: actor.orgId } })) throw notFound();
    if (!isAdmin(actor) && !await database.teamMember.findFirst({ where: { orgId: actor.orgId, teamId, membershipId: actor.id } })) throw new ApiError(403, 'FORBIDDEN', 'Join this team before creating its objectives');
  }
  if (scope === 'company' && !isAdmin(actor) && actor.role !== 'manager') throw new ApiError(403, 'FORBIDDEN', 'Managers and administrators create company objectives');
  if (creating && scope === 'personal' && !isAdmin(actor) && leadId !== actor.id) throw new ApiError(403, 'FORBIDDEN', 'Create personal objectives with yourself as lead');
}
export async function validateOwnership(database: Database, orgId: string, input: { leadId: string; assignments: { membershipId: string; role: string }[] }) {
  await requireAssignable(database, orgId, input.leadId);
  for (const assignment of input.assignments) await requireAssignable(database, orgId, assignment.membershipId, assignment.role !== 'follower');
}
export async function validateReferences(database: Database, actor: Actor, input: ObjectiveInput) {
  await validateOwnership(database, actor.orgId, input);
  if (input.teamId && !await database.team.findFirst({ where: { orgId: actor.orgId, id: input.teamId } })) throw notFound();
  if (input.periodId) {
    const period = await database.period.findFirst({ where: { orgId: actor.orgId, id: input.periodId } }); if (!period) throw notFound();
    if (input.startDate < period.startDate || input.endDate > period.endDate) throw new ApiError(400, 'PERIOD_DATES', 'Objective dates must fall within the selected period');
  }
}
export function requireLiveObjective(objective: Pick<LoadedObjective, 'state' | 'archivedAt'>) {
  if (objective.archivedAt || objective.state === 'completed' || objective.state === 'cancelled') throw new ApiError(409, 'OBJECTIVE_LOCKED', 'Reopen and unarchive this objective before editing its structure or metrics. Ownership can still be reassigned.');
}
export async function loadObjective(database: Database, orgId: string, id: string) {
  const objective = await database.objective.findFirst({ where: { orgId, id }, include: objectiveInclude });
  if (!objective) throw notFound(); return objective;
}
export async function loadGraph(database: Database, orgId: string) {
  const objectives = await database.objective.findMany({ where: { orgId }, include: objectiveInclude });
  const links = await database.objectiveLink.findMany({ where: { orgId }, orderBy: { id: 'asc' } });
  return { objectives, links, scores: graphProgress(objectives, links) };
}
export type Graph = Awaited<ReturnType<typeof loadGraph>>;
export function prerequisites(graph: Graph, id: string) {
  const ids = new Set(graph.links.filter(l => l.type === 'dependency' && l.targetId === id).map(l => l.sourceId));
  return graph.objectives.filter(o => ids.has(o.id) && o.state !== 'completed');
}
// Invalidate ancestor snapshots and dependent blocker state in the same organization transaction.
export async function invalidateRelated(tx: Prisma.TransactionClient, orgId: string, changed: string[]) {
  const links = await tx.objectiveLink.findMany({ where: { orgId } }); const affected = new Set(changed); const pending = [...changed];
  while (pending.length) { const id = pending.pop()!; for (const l of links) if (l.type === 'alignment' && l.targetId === id && !affected.has(l.sourceId)) { affected.add(l.sourceId); pending.push(l.sourceId); } }
  for (const l of links) if (l.type === 'dependency' && changed.includes(l.sourceId)) affected.add(l.targetId);
  await tx.objective.updateMany({ where: { orgId, id: { in: [...affected].filter(id => !changed.includes(id)) } }, data: { version: { increment: 1 }, updatedAt: new Date() } });
}
export async function presentObjective(database: Database, actor: Actor, objective: LoadedObjective, graph?: Graph) {
  graph ??= await loadGraph(database, actor.orgId);
  const canEdit = await canEditObjective(database, actor, objective);
  const canContribute = actor.role !== 'viewer' && (canEdit || objective.assignments.some(a => a.membershipId === actor.id && a.role === 'contributor'));
  const member = await database.membership.findUniqueOrThrow({ where: { id: actor.id }, select: { userId: true } });
  const preference = await database.objectivePreference.findUnique({ where: { objectiveId_userId: { objectiveId: objective.id, userId: member.userId } } });
  const unresolvedPrerequisites = prerequisites(graph, objective.id).map(o => ({ id: o.id, title: o.title, state: o.state, archivedAt: o.archivedAt }));
  return { ...objective, alignmentParentCount: graph.links.filter(l => l.type === 'alignment' && l.targetId === objective.id).length, notificationsEnabled: preference?.enabled ?? true, progress: graph.scores.get(objective.id) ?? 0, blocked: unresolvedPrerequisites.length > 0, unresolvedPrerequisites, canEdit, canContribute, keyResults: objective.keyResults.map(kr => ({ ...kr, progress: metricProgress(kr as Parameters<typeof metricProgress>[0]), canUpdate: actor.role !== 'viewer' && (canContribute || kr.ownerId === actor.id) })) };
}
export function todayInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(kind => parts.find(p => p.type === kind)!.value).join('-');
}
