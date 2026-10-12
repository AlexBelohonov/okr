import test from 'node:test';
import assert from 'node:assert/strict';
import { createsCycle, graphProgress, linkWriteSchema } from '@okr/shared';
import { randomUUID } from 'node:crypto';

const node = (id: string, current = 0, fields = {}) => ({ id, state: 'active', archivedAt: null, finalScore: null, progressMode: 'key_results', keyResults: [{ type: 'number', baseline: 0, target: 100, current, weight: 1 }], ...fields });
const link = (sourceId: string, targetId: string, weight = 1, type = 'alignment') => ({ sourceId, targetId, weight, type });
test('DAG reachability rejects self and indirect cycles, permits diamonds and separate graphs', () => {
  const links = [link('a', 'b'), link('a', 'c'), link('b', 'd'), link('c', 'd')];
  assert.equal(createsCycle(links, 'd', 'a'), true); assert.equal(createsCycle(links, 'a', 'a'), true);
  assert.equal(createsCycle(links, 'b', 'c'), false); assert.equal(createsCycle([], 'd', 'a'), false);
});
test('shared children use parent weights, recursive rollups and one scoring mode', () => {
  const nodes = [node('a', 99, { progressMode: 'children' }), node('b', 99, { progressMode: 'children' }), node('top', 0, { progressMode: 'children' }), node('low', 20), node('high', 80)];
  const scores = graphProgress(nodes, [link('a', 'low', 1), link('a', 'high', 3), link('b', 'low', 3), link('b', 'high', 1), link('top', 'a'), link('top', 'b'), link('high', 'low', 1, 'dependency')]);
  assert.equal(scores.get('a'), 65); assert.equal(scores.get('b'), 35); assert.equal(scores.get('top'), 50); assert.equal(scores.get('high'), 80); assert.equal(scores.size, 5);
});
test('draft cancelled archived children are excluded; completion stays frozen; empty mode scores zero', () => {
  const scores = graphProgress([node('p', 100, { progressMode: 'children' }), node('draft', 100, { state: 'draft' }), node('cancel', 100, { state: 'cancelled' }), node('archive', 100, { archivedAt: 'date' }), node('closed', 99, { state: 'completed', finalScore: 37 }), node('empty', 100, { progressMode: 'children' })], ['draft', 'cancel', 'archive', 'closed'].map(id => link('p', id)));
  assert.equal(scores.get('p'), 37); assert.equal(scores.get('closed'), 37); assert.equal(scores.get('empty'), 0);
});
test('iterative scoring handles deep DAGs and rejects corrupt cycles', () => {
  const nodes = Array.from({ length: 5000 }, (_, i) => node(String(i), 77, { progressMode: i === 4999 ? 'key_results' : 'children' }));
  const links = nodes.slice(1).map((o, i) => link(String(i), o.id)); assert.equal(graphProgress(nodes, links).get('0'), 77);
  assert.throws(() => graphProgress(nodes, [...links, link('4999', '0')]), /cycle/);
});
test('graph weights are positive finite and mutations require both endpoint versions', () => {
  const input = { sourceId: randomUUID(), targetId: randomUUID(), type: 'alignment', sourceVersion: 1, targetVersion: 1 };
  assert.equal(linkWriteSchema.safeParse(input).success, true);
  for (const weight of [0, -1, Infinity, NaN, 100001]) assert.equal(linkWriteSchema.safeParse({ ...input, weight }).success, false);
  assert.equal(linkWriteSchema.safeParse({ ...input, targetVersion: undefined }).success, false);
});
