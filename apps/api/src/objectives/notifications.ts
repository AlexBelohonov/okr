import type { Prisma } from '@prisma/client';
import type { LoadedObjective } from './domain.js';

export function participants(objective: LoadedObjective) {
  const roles = new Map<string, string>(); roles.set(objective.leadId, 'lead');
  for (const a of objective.assignments) roles.set(a.membershipId, a.role);
  for (const kr of objective.keyResults) if (kr.ownerId) roles.set(kr.ownerId, `${roles.get(kr.ownerId) || ''}|metric:${kr.id}`);
  return roles;
}
export async function notifyObjective(tx: Prisma.TransactionClient, objective: LoadedObjective, actorUserId: string, text: string, membershipIds = [...participants(objective).keys()]) {
  const muted = await tx.objectivePreference.findMany({ where: { orgId: objective.orgId, objectiveId: objective.id, enabled: false }, select: { userId: true } });
  const members = await tx.membership.findMany({ where: { orgId: objective.orgId, id: { in: membershipIds }, active: true, user: { active: true }, userId: { notIn: [actorUserId, ...muted.map(p => p.userId)] } }, select: { userId: true } });
  if (members.length) await tx.notification.createMany({ data: members.map(m => ({ orgId: objective.orgId, objectiveId: objective.id, userId: m.userId, text })) });
}
export async function notifyAssignments(tx: Prisma.TransactionClient, before: LoadedObjective | null, after: LoadedObjective, actorUserId: string) {
  const old = before ? participants(before) : new Map<string, string>(); const next = participants(after);
  const changed = [...new Set([...old.keys(), ...next.keys()])].filter(id => old.get(id) !== next.get(id));
  await notifyObjective(tx, after, actorUserId, `Your assignment changed: ${after.title}`, changed);
}
