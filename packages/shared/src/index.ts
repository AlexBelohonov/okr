import { z } from 'zod';

export const apiErrorSchema = z.object({ error: z.object({
  code: z.string(), message: z.string(), requestId: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional()
}) });
export const healthSchema = z.object({ status: z.literal('ok'), service: z.literal('okr-api'), version: z.string() });
export const readinessSchema = z.object({ status: z.literal('ready'), database: z.literal('connected'), version: z.string() });
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
export type HealthResponse = z.infer<typeof healthSchema>;
export type ReadinessResponse = z.infer<typeof readinessSchema>;

export const roles = ['owner', 'admin', 'manager', 'member', 'viewer'] as const;
export const states = ['draft', 'active', 'completed', 'cancelled'] as const;
export const healths = ['on_track', 'at_risk', 'off_track'] as const;
export const password = z.string().min(12, 'Use at least 12 characters').max(128);
export const email = z.string().trim().toLowerCase().email().max(254);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(v => Number(v.slice(0, 4)) >= 1 && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Invalid date');
export const actionToken = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid or expired link');
export const timezone = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose a valid timezone');
export const signupSchema = z.object({ name: z.string().trim().min(2).max(100), email, password, organization: z.string().trim().min(2).max(100).optional(), timezone: timezone.default('UTC'), inviteToken: actionToken.optional() }).refine(v => Boolean(v.organization) !== Boolean(v.inviteToken), 'Provide either an organization or invitation');
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const profileSchema = z.object({ name: z.string().trim().min(2).max(100) });
export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), password });
export const recoverySchema = z.object({ email });
export const tokenSchema = z.object({ token: actionToken });
export const resetSchema = z.object({ token: actionToken, password });
export const organizationSchema = z.object({ name: z.string().trim().min(2).max(100), timezone });
export const organizationUpdateSchema = organizationSchema.extend({ version: z.number().int().positive() });
export const memberUpdateSchema = z.object({ role: z.enum(roles), active: z.boolean(), version: z.number().int().positive() });
export const invitationSchema = z.object({ email, role: z.enum(['admin', 'manager', 'member', 'viewer']), send: z.boolean().default(false) });
export const ownershipTransferSchema = z.object({ membershipId: z.string().uuid(), version: z.number().int().positive(), targetVersion: z.number().int().positive() });
export const teamSchema = z.object({ name: z.string().trim().min(2).max(100) });
export const teamUpdateSchema = teamSchema.extend({ version: z.number().int().positive() });
export const teamMemberSchema = z.object({ manager: z.boolean(), version: z.number().int().positive() });
export const versionSchema = z.object({ version: z.number().int().positive() });
export const periodCreateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('quarter'), year: z.number().int().min(1).max(9999), quarter: z.number().int().min(1).max(4) }),
  z.object({ kind: z.literal('custom'), name: z.string().trim().min(2).max(100), startDate: date, endDate: date })
]).refine(v => v.kind === 'quarter' || v.startDate <= v.endDate, 'Start date must be before end date');
export const periodUpdateSchema = z.object({ name: z.string().trim().min(2).max(100), startDate: date, endDate: date, version: z.number().int().positive() }).refine(v => v.startDate <= v.endDate, 'Start date must be before end date');
export const accountSessionSchema = z.object({
  user: z.object({ id: z.string().uuid(), name: z.string(), email: z.string(), verified: z.boolean(), platformAdmin: z.boolean() }).nullable(),
  csrf: z.string(), emailMode: z.enum(['smtp', 'selfhosted']), signupEnabled: z.boolean(),
  memberships: z.array(z.object({ id: z.string().uuid(), role: z.enum(roles), org: z.object({ id: z.string().uuid(), name: z.string(), timezone: z.string() }) }))
});
export type AccountSession = z.infer<typeof accountSessionSchema>;
export const assignmentSchema = z.object({ membershipId: z.string().uuid(), role: z.enum(['coowner', 'contributor', 'follower']) });
export const objectiveSchema = z.object({
  title: z.string().trim().min(3).max(200), description: z.string().max(10000).default(''),
  scope: z.enum(['company', 'team', 'personal']).default('personal'), teamId: z.string().uuid().nullable().optional(),
  periodId: z.string().uuid().nullable().optional(), startDate: date, endDate: date,
  leadId: z.string().uuid(), assignments: z.array(assignmentSchema).max(100).default([]),
  progressMode: z.enum(['key_results', 'children']).default('key_results'), state: z.enum(states).default('active'),
  health: z.enum(healths).default('on_track'), version: z.number().int().positive().optional()
}).refine(v => v.startDate <= v.endDate, 'Start date must be before end date').refine(v => (v.scope === 'team') === Boolean(v.teamId), 'Choose a team only for team objectives')
  .refine(v => new Set(v.assignments.map(a => a.membershipId)).size === v.assignments.length, 'Assign each person once')
  .refine(v => !v.assignments.some(a => a.membershipId === v.leadId), 'The lead already has editing rights');
export const childObjectiveSchema = objectiveSchema.and(z.object({ parentVersion: z.number().int().positive() }));
export const ownershipSchema = z.object({ leadId: z.string().uuid(), assignments: z.array(assignmentSchema).max(100), version: z.number().int().positive() })
  .refine(v => new Set(v.assignments.map(a => a.membershipId)).size === v.assignments.length, 'Assign each person once')
  .refine(v => !v.assignments.some(a => a.membershipId === v.leadId), 'The lead already has editing rights');
export const metricUpdateSchema = z.object({ current: z.number().finite(), version: z.number().int().positive(), objectiveVersion: z.number().int().positive() });
export const metricOwnerSchema = z.object({ ownerId: z.string().uuid().nullable(), version: z.number().int().positive(), objectiveVersion: z.number().int().positive() });
export const archiveSchema = z.object({ archived: z.boolean(), version: z.number().int().positive() });
export const keyResultSchema = z.object({
  title: z.string().trim().min(3).max(200), type: z.enum(['number', 'binary']).default('number'),
  baseline: z.number().finite().default(0), target: z.number().finite().default(100), current: z.number().finite().default(0),
  unit: z.string().max(30).default('%'), weight: z.number().positive().max(100000).default(1),
  ownerId: z.string().uuid().nullable().optional(), version: z.number().int().positive().optional()
}).refine(v => v.type === 'binary' || v.baseline !== v.target, 'Target must differ from baseline').refine(v => v.type !== 'binary' || [0, 1].includes(v.current), 'Binary current value must be 0 or 1').transform(v => v.type === 'binary' ? { ...v, baseline: 0, target: 1 } : v);
export const linkSchema = z.object({ sourceId: z.string().uuid(), targetId: z.string().uuid(), type: z.enum(['alignment', 'dependency']), weight: z.number().positive().max(100000).default(1) });
export const linkWriteSchema = linkSchema.extend({ sourceVersion: z.number().int().positive(), targetVersion: z.number().int().positive() });
export const linkChangeSchema = z.object({ sourceVersion: z.number().int().positive(), targetVersion: z.number().int().positive(), weight: z.number().positive().max(100000).optional() });
export const checkInSchema = z.object({ note: z.string().trim().min(1).max(10000), health: z.enum(healths), metrics: z.array(z.object({ id: z.string().uuid(), current: z.number().finite(), version: z.number().int().positive() }).strict()).max(200).default([]), version: z.number().int().positive() }).strict().refine(v => new Set(v.metrics.map(m => m.id)).size === v.metrics.length, 'Update each metric once');
export const commentSchema = z.object({ text: z.string().trim().min(1).max(10000) }).strict();
export const notificationPreferenceSchema = z.object({ enabled: z.boolean() }).strict();
export const transitionSchema = z.object({ state: z.enum(states), note: z.string().trim().max(10000).default(''), overrideNote: z.string().trim().max(2000).default(''), version: z.number().int().positive() });
export type Role = typeof roles[number];
export type ObjectiveInput = z.infer<typeof objectiveSchema>;
export type KeyResultInput = z.infer<typeof keyResultSchema>;

export interface Person { id: string; name: string; email: string; verified: boolean; platformAdmin: boolean }
export interface Member { id: string; orgId: string; userId: string; role: Role; active: boolean; user: Person; teamMembers?: { teamId: string; manager: boolean }[] }
export interface Team { id: string; orgId: string; name: string; members: { membershipId: string; manager: boolean; membership: Member }[] }
export interface Period { id: string; name: string; startDate: string; endDate: string; version: number }
export interface Organization { id: string; name: string; timezone: string; active: boolean }
export interface KeyResult { id: string; title: string; type: 'number' | 'binary'; baseline: number; target: number; current: number; unit: string; weight: number; ownerId: string | null; version: number; progress: number }
export interface Link { id: string; sourceId: string; targetId: string; type: 'alignment' | 'dependency'; weight: number }
export interface Objective {
  id: string; orgId: string; title: string; description: string; scope: 'company' | 'team' | 'personal'; teamId: string | null;
  periodId: string | null; startDate: string; endDate: string; leadId: string; lead: Member;
  progressMode: 'key_results' | 'children'; state: typeof states[number]; health: typeof healths[number]; archivedAt: string | null;
  version: number; progress: number; finalScore: number | null; blocked: boolean; canEdit: boolean; canContribute: boolean;
  assignments: { membershipId: string; role: 'coowner' | 'contributor' | 'follower'; membership: Member }[];
  keyResults: KeyResult[]; createdAt: string; team: { name: string } | null; period: Period | null;
}
export interface Activity { id: string; type: string; text: string; createdAt: string; user: { name: string }; objectiveId?: string | null; objective?: { title: string } | null; data?: Record<string, unknown> }

export function metricProgress(metric: { type: string; baseline: number; target: number; current: number }): number {
  if (metric.type === 'binary') return metric.current === 1 ? 100 : 0;
  if (metric.target === metric.baseline) return 0;
  const increasing = metric.target > metric.baseline;
  if (increasing ? metric.current <= metric.baseline : metric.current >= metric.baseline) return 0;
  if (increasing ? metric.current >= metric.target : metric.current <= metric.target) return 100;
  let delta = metric.target - metric.baseline;
  let current = metric.current - metric.baseline;
  // Finite endpoints can still overflow during subtraction across zero.
  if (!Number.isFinite(delta)) { delta = metric.target / 2 - metric.baseline / 2; current = metric.current / 2 - metric.baseline / 2; }
  return Math.max(0, Math.min(100, current / delta * 100));
}
export function weightedProgress(items: { progress: number; weight: number }[]): number {
  const scale = items.reduce((largest, i) => Math.max(largest, i.weight), 0);
  if (!scale) return 0;
  const weight = items.reduce((sum, i) => sum + i.weight / scale, 0);
  return Math.max(0, Math.min(100, items.reduce((sum, i) => sum + i.progress * ((i.weight / scale) / weight), 0)));
}
export function createsCycle(links: Pick<Link, 'sourceId' | 'targetId'>[], source: string, target: string): boolean {
  if (source === target) return true;
  const outgoing = new Map<string, string[]>();
  for (const l of links) outgoing.set(l.sourceId, [...(outgoing.get(l.sourceId) || []), l.targetId]);
  const pending = [target]; const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === source) return true;
    if (!seen.has(id)) { seen.add(id); pending.push(...(outgoing.get(id) || [])); }
  }
  return false;
}

// Evaluate from leaves upward. Each parent's own edge weight applies to a shared child.
export function graphProgress(objectives: { id: string; state: string; archivedAt: unknown; finalScore: number | null; progressMode: string; keyResults: { type: string; baseline: number; target: number; current: number; weight: number }[] }[], links: { sourceId: string; targetId: string; type: string; weight: number }[]) {
  const nodes = new Map(objectives.map(o => [o.id, o]));
  const outgoing = new Map<string, typeof links>(); const parents = new Map<string, string[]>();
  for (const link of links) if (link.type === 'alignment' && nodes.has(link.sourceId) && nodes.has(link.targetId)) {
    outgoing.set(link.sourceId, [...(outgoing.get(link.sourceId) || []), link]);
    parents.set(link.targetId, [...(parents.get(link.targetId) || []), link.sourceId]);
  }
  const remaining = new Map(objectives.map(o => [o.id, outgoing.get(o.id)?.length || 0]));
  const ready = objectives.filter(o => !remaining.get(o.id)).map(o => o.id); const scores = new Map<string, number>();
  while (ready.length) {
    const id = ready.pop()!; const objective = nodes.get(id)!;
    const inputs = objective.progressMode === 'children'
      ? (outgoing.get(id) || []).filter(l => { const child = nodes.get(l.targetId)!; return !child.archivedAt && ['active', 'completed'].includes(child.state); }).map(l => ({ progress: scores.get(l.targetId)!, weight: l.weight }))
      : objective.keyResults.map(kr => ({ progress: metricProgress(kr), weight: kr.weight }));
    scores.set(id, objective.state === 'completed' ? objective.finalScore ?? 0 : weightedProgress(inputs));
    for (const parent of parents.get(id) || []) { const count = remaining.get(parent)! - 1; remaining.set(parent, count); if (!count) ready.push(parent); }
  }
  if (scores.size !== objectives.length) throw new Error('Alignment graph contains a cycle');
  return scores;
}
