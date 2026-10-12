import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { date, keyResultSchema, metricProgress, objectiveSchema, periodCreateSchema, weightedProgress } from '@okr/shared';
import { objectiveProgress, quarterDates } from '../src/objectives/domain.js';

test('increasing, decreasing and binary metrics clamp scores, including extreme finite values', () => {
  for (const [baseline, target, current, expected] of [[0, 100, 30, 30], [100, 0, 25, 75], [0, 10, 99, 100], [100, 50, 110, 0], [100, 50, 20, 100], [0, 100, -1, 0], [-1e308, 1e308, 0, 50], [1e308, -1e308, 0, 50], [1e-320, 2e-320, 1e308, 100]]) {
    assert.equal(metricProgress({ type: 'number', baseline, target, current }), expected);
  }
  assert.equal(metricProgress({ type: 'binary', baseline: 0, target: 1, current: 0 }), 0);
  assert.equal(metricProgress({ type: 'binary', baseline: 0, target: 1, current: 1 }), 100);
});
test('weighted progress uses positive weights and returns zero without inputs', () => {
  assert.equal(weightedProgress([]), 0);
  assert.equal(weightedProgress([{ progress: 100, weight: 1 }, { progress: 0, weight: 3 }]), 25);
  assert.equal(weightedProgress([{ progress: 20, weight: 1 }, { progress: 80, weight: 1 }]), 50);
  assert.equal(weightedProgress([{ progress: 33, weight: Number.MIN_VALUE }]), 33);
  assert.equal(weightedProgress([{ progress: 100, weight: 1e-320 }, { progress: 0, weight: 3e-320 }]), 25);
});
test('completion freezes scores and child mode does not combine key results', () => {
  const keyResults = [keyResultSchema.parse({ title: 'Numeric metric', baseline: 0, target: 100, current: 60 })] as Parameters<typeof objectiveProgress>[0]['keyResults'];
  assert.equal(objectiveProgress({ state: 'active', finalScore: null, progressMode: 'key_results', keyResults }), 60);
  assert.equal(objectiveProgress({ state: 'completed', finalScore: 30, progressMode: 'key_results', keyResults }), 30);
  assert.equal(objectiveProgress({ state: 'draft', finalScore: null, progressMode: 'children', keyResults }), 0);
});
test('quarter and custom dates are inclusive and validate leap years/year boundaries', () => {
  assert.deepEqual(quarterDates(2028, 1), { name: 'Q1 2028', startDate: '2028-01-01', endDate: '2028-03-31' });
  assert.equal(quarterDates(2026, 2).endDate, '2026-06-30');
  assert.equal(quarterDates(2026, 4).endDate, '2026-12-31');
  assert.equal(quarterDates(1, 1).startDate, '0001-01-01');
  assert.equal(date.safeParse('0000-01-01').success, false);
  assert.equal(date.safeParse('2026-02-29').success, false);
  assert.equal(date.safeParse('2028-02-29').success, true);
  assert.equal(periodCreateSchema.safeParse({ kind: 'custom', name: 'One day', startDate: '2026-10-04', endDate: '2026-10-04' }).success, true);
  assert.equal(periodCreateSchema.safeParse({ kind: 'custom', name: 'Invalid', startDate: '2026-10-05', endDate: '2026-10-04' }).success, false);
});
test('metric and assignment schemas reject invalid targets, weights, dates and duplicate people', () => {
  assert.equal(keyResultSchema.safeParse({ title: 'Equal target', baseline: 5, target: 5 }).success, false);
  assert.equal(keyResultSchema.safeParse({ title: 'Bad weight', weight: 0 }).success, false);
  assert.equal(keyResultSchema.safeParse({ title: 'Nonfinite', current: Infinity }).success, false);
  assert.equal(keyResultSchema.safeParse({ title: 'Binary', type: 'binary', current: 0.5 }).success, false);
  const leadId = randomUUID(); const membershipId = randomUUID(); const input = { title: 'Valid objective', leadId, startDate: '2026-01-01', endDate: '2026-03-31' };
  assert.equal(objectiveSchema.safeParse({ ...input, assignments: [{ membershipId, role: 'coowner' }, { membershipId, role: 'follower' }] }).success, false);
  assert.equal(objectiveSchema.safeParse({ ...input, assignments: [{ membershipId: leadId, role: 'coowner' }] }).success, false);
  assert.equal(objectiveSchema.safeParse({ ...input, teamId: randomUUID() }).success, false);
});
