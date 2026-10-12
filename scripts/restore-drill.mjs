import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire('/app/package.json'); const { PrismaClient } = require('@prisma/client');
const [action, sourceName, restoredName] = process.argv.slice(2);
if (!/^okr_ch(?:09|10)_test_[a-z0-9_]+$/.test(sourceName || '')) throw new Error('Drill source must be an isolated chapter acceptance database');
if (restoredName && !/^okr_restore_[a-z0-9_]+$/.test(restoredName)) throw new Error('Restore target must be isolated');
const urlFor = name => { const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + name; return url.href; };
const source = new PrismaClient({ datasources: { db: { url: urlFor(sourceName) } } });
const email = 'restore-drill@ch09.operations.example';
const tables = ['User', 'Session', 'AuthToken', 'Organization', 'Membership', 'Team', 'TeamMember', 'Period', 'Objective', 'Assignment', 'KeyResult', 'ObjectiveLink', 'CheckIn', 'Comment', 'AuditEvent', 'Invitation', 'Notification', 'ObjectivePreference', 'EmailOutbox', '_prisma_migrations'];
async function manifest(database) {
  const result = {};
  for (const table of tables) {
    const rows = await database.$queryRawUnsafe(`SELECT row_to_json(t)::text AS row FROM "${table}" t`);
    const values = rows.map(r => r.row).sort(); result[table] = { count: values.length, hash: createHash('sha256').update(values.join('\n')).digest('hex') };
  }
  return result;
}
try {
  if (action === 'seed') {
    if (await source.user.count()) throw new Error('Drill source must be empty after test cleanup');
    await source.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, name: 'Isolated restore fixture', passwordHash: 'not-a-real-account-password', platformAdmin: true, verified: true, version: 4 } });
      const org = await tx.organization.create({ data: { name: 'Restore drill organization', timezone: 'America/Toronto', version: 3 } });
      const member = await tx.membership.create({ data: { orgId: org.id, userId: user.id, role: 'owner' } });
      const team = await tx.team.create({ data: { orgId: org.id, name: 'Restore team' } });
      await tx.teamMember.create({ data: { orgId: org.id, teamId: team.id, membershipId: member.id, manager: true } });
      const period = await tx.period.create({ data: { orgId: org.id, name: '2026 Q4', startDate: '2026-10-01', endDate: '2026-12-31' } });
      const parent = await tx.objective.create({ data: { orgId: org.id, title: 'Restore parent', leadId: member.id, scope: 'team', teamId: team.id, periodId: period.id, progressMode: 'children', startDate: period.startDate, endDate: period.endDate } });
      const child = await tx.objective.create({ data: { orgId: org.id, title: 'Restore child', leadId: member.id, state: 'completed', finalScore: 75, closingNote: 'Retained snapshot', dependencyOverrideNote: 'Reviewed unfinished prerequisite for restore fixture', archivedAt: new Date(), startDate: period.startDate, endDate: period.endDate } });
      await tx.keyResult.create({ data: { orgId: org.id, objectiveId: child.id, title: 'Restore metric', baseline: 0, target: 100, current: 75, weight: 2, ownerId: member.id } });
      await tx.objectiveLink.create({ data: { orgId: org.id, sourceId: parent.id, targetId: child.id, type: 'alignment', weight: 2 } });
      await tx.objectiveLink.create({ data: { orgId: org.id, sourceId: parent.id, targetId: child.id, type: 'dependency' } });
      await tx.assignment.create({ data: { orgId: org.id, objectiveId: child.id, membershipId: member.id, role: 'follower' } });
      await tx.checkIn.create({ data: { orgId: org.id, objectiveId: child.id, userId: user.id, note: 'Restore progress', health: 'on_track', progress: 75, metrics: [{ current: 75 }] } });
      await tx.comment.create({ data: { orgId: org.id, objectiveId: child.id, userId: user.id, text: 'Restore permanent discussion' } });
      await tx.notification.create({ data: { orgId: org.id, objectiveId: child.id, userId: user.id, text: 'Restore notification' } });
      await tx.objectivePreference.create({ data: { orgId: org.id, objectiveId: child.id, userId: user.id, enabled: false } });
      await tx.auditEvent.create({ data: { userId: user.id, type: 'platform_admin_bootstrap', text: 'Isolated restore actor', data: { source: 'restore_drill' } } });
      await tx.auditEvent.create({ data: { orgId: org.id, objectiveId: child.id, userId: user.id, type: 'objective_completed', text: 'Restored history', data: { progress: 75 } } });
      await tx.session.create({ data: { userId: user.id, tokenHash: 'a'.repeat(64), csrf: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3600000) } });
      await tx.authToken.create({ data: { userId: user.id, type: 'reset', tokenHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 3600000) } });
      await tx.invitation.create({ data: { orgId: org.id, email: 'invited@ch09.operations.example', tokenHash: 'd'.repeat(64), expiresAt: new Date(Date.now() + 3600000) } });
      await tx.emailOutbox.create({ data: { to: email, subject: 'Restore delivery status', text: '[Delivered account message removed]', sentAt: new Date(), attempts: 1 } });
    });
    console.log(JSON.stringify({ event: 'restore_drill_seeded', tables: await manifest(source) }));
  } else if (action === 'verify' && restoredName) {
    const restored = new PrismaClient({ datasources: { db: { url: urlFor(restoredName) } } });
    try {
      const original = await manifest(source); const copy = await manifest(restored);
      if (JSON.stringify(original) !== JSON.stringify(copy)) throw new Error('Restored rows do not match original');
      const fixture = await restored.objective.findFirstOrThrow({ where: { title: 'Restore child' }, include: { keyResults: true, comments: true, checkIns: true, incoming: { include: { source: true } } } });
      const parents = fixture.incoming.filter(link => link.type === 'alignment');
      if (fixture.finalScore !== 75 || fixture.keyResults[0]?.current !== 75 || fixture.comments.length !== 1 || fixture.checkIns.length !== 1 || parents.length !== 1 || parents[0].source.title !== 'Restore parent' || !fixture.dependencyOverrideNote) throw new Error('Representative restore relationships are incomplete');
      console.log(JSON.stringify({ event: 'restore_drill_verified', matchingTables: tables.length, matchingRows: Object.values(copy).reduce((sum, t) => sum + t.count, 0), migrations: copy._prisma_migrations.count, completedScore: fixture.finalScore, comments: fixture.comments.length, checkIns: fixture.checkIns.length, alignmentLinks: parents.length, parentToChild: true }));
    } finally { await restored.$disconnect(); }
  } else throw new Error('Use seed SOURCE or verify SOURCE RESTORED');
} finally { await source.$disconnect(); }
