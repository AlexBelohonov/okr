import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const db = new PrismaClient();
after(() => db.$disconnect());
class FixtureRollback extends Error {}

async function fixture(run: (tx: Prisma.TransactionClient, ids: { orgId: string; otherOrgId: string; memberId: string; otherMemberId: string; userId: string; objectiveId: string; otherObjectiveId: string }) => Promise<void>) {
  try {
    await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `foundation-${randomUUID()}@example.test`, name: 'Test user', passwordHash: 'not-a-real-password-hash' } });
      const other = await tx.user.create({ data: { email: `foundation-${randomUUID()}@example.test`, name: 'Other user', passwordHash: 'not-a-real-password-hash' } });
      const org = await tx.organization.create({ data: { name: 'Foundation test A' } });
      const otherOrg = await tx.organization.create({ data: { name: 'Foundation test B' } });
      const member = await tx.membership.create({ data: { orgId: org.id, userId: user.id, role: 'owner' } });
      const otherMember = await tx.membership.create({ data: { orgId: otherOrg.id, userId: other.id, role: 'owner' } });
      const objective = await tx.objective.create({ data: { orgId: org.id, leadId: member.id, title: 'Foundation objective A', startDate: '2026-10-01', endDate: '2026-12-31' } });
      const otherObjective = await tx.objective.create({ data: { orgId: otherOrg.id, leadId: otherMember.id, title: 'Foundation objective B', startDate: '2026-10-01', endDate: '2026-12-31' } });
      await run(tx, { orgId: org.id, otherOrgId: otherOrg.id, memberId: member.id, otherMemberId: otherMember.id, userId: user.id, objectiveId: objective.id, otherObjectiveId: otherObjective.id });
      throw new FixtureRollback();
    }, { timeout: 15000 });
  } catch (error) { if (!(error instanceof FixtureRollback)) throw error; }
}

test('database accepts a valid tenant-scoped objective and key result', async () => {
  await fixture(async (tx, ids) => {
    const kr = await tx.keyResult.create({ data: { orgId: ids.orgId, objectiveId: ids.objectiveId, title: 'Valid metric', ownerId: ids.memberId, baseline: 0, target: 100, current: 25 } });
    assert.equal(kr.current, 25);
    assert.equal(await tx.objective.count({ where: { orgId: ids.orgId } }), 1);
  });
});

test('database rejects an objective lead from another organization', async () => {
  await fixture(async (tx, ids) => {
    await assert.rejects(tx.objective.create({ data: { orgId: ids.orgId, leadId: ids.otherMemberId, title: 'Invalid lead', startDate: '2026-10-01', endDate: '2026-12-31' } }), { code: 'P2003' });
  });
});

test('database rejects a relationship to another organization', async () => {
  await fixture(async (tx, ids) => {
    await assert.rejects(tx.objectiveLink.create({ data: { orgId: ids.orgId, sourceId: ids.objectiveId, targetId: ids.otherObjectiveId, type: 'alignment' } }), { code: 'P2003' });
  });
});

test('database rejects an assignment from another organization', async () => {
  await fixture(async (tx, ids) => {
    await assert.rejects(tx.assignment.create({ data: { orgId: ids.orgId, objectiveId: ids.objectiveId, membershipId: ids.otherMemberId, role: 'coowner' } }), { code: 'P2003' });
  });
});

test('database rejects a comment author who is not in the organization', async () => {
  await fixture(async (tx, ids) => {
    const otherUser = await tx.membership.findUniqueOrThrow({ where: { id: ids.otherMemberId } });
    await assert.rejects(tx.comment.create({ data: { orgId: ids.orgId, objectiveId: ids.objectiveId, userId: otherUser.userId, text: 'Cross-tenant comment' } }), { code: 'P2003' });
  });
});

test('database rejects invalid roles', async () => {
  await fixture(async (tx, ids) => {
    await assert.rejects(tx.membership.update({ where: { id: ids.memberId }, data: { role: 'superuser' } }), /constraint/i);
  });
});

test('database rejects reversed dates and preserves canonical date strings', async () => {
  await fixture(async (tx, ids) => {
    const objective = await tx.objective.findUniqueOrThrow({ where: { id: ids.objectiveId } });
    assert.equal(objective.startDate, '2026-10-01');
    await assert.rejects(tx.objective.update({ where: { id: ids.objectiveId }, data: { endDate: '2026-09-30' } }), /constraint/i);
  });
});

test('database rejects equal numeric targets', async () => {
  await fixture(async (tx, ids) => {
    await assert.rejects(tx.keyResult.create({ data: { orgId: ids.orgId, objectiveId: ids.objectiveId, title: 'Invalid target', baseline: 5, target: 5 } }), /constraint/i);
  });
});

test('database rejects nonbinary values for binary metrics', async () => {
  await fixture(async (tx, ids) => {
    await assert.rejects(tx.keyResult.create({ data: { orgId: ids.orgId, objectiveId: ids.objectiveId, title: 'Invalid binary', type: 'binary', baseline: 0, target: 1, current: 0.5 } }), /constraint/i);
  });
});

test('database rejects objective self-links', async () => {
  await fixture(async (tx, ids) => {
    await assert.rejects(tx.objectiveLink.create({ data: { orgId: ids.orgId, sourceId: ids.objectiveId, targetId: ids.objectiveId, type: 'dependency' } }), /constraint/i);
  });
});
