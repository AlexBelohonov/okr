import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptWebhook, encryptWebhook, sendSlack, SlackFailure, slackMessage, validateWebhook } from '../src/slack/service.js';

process.env.SLACK_ENCRYPTION_KEY = 'b'.repeat(64);
const webhook = 'https://hooks.slack.com/services/TTEST/BTEST/fixtureSecretOnly';
test('Slack credentials are authenticated, randomized and bound to their organization', () => {
  const first = encryptWebhook('org-a', webhook); const second = encryptWebhook('org-a', webhook);
  assert.notEqual(first, second); assert.ok(!first.includes('fixtureSecretOnly')); assert.equal(decryptWebhook('org-a', first), webhook);
  assert.throws(() => decryptWebhook('org-b', first)); assert.throws(() => decryptWebhook('org-a', first.slice(0, -4) + 'AAAA'));
});
test('Slack rejects non-Slack destinations, embedded credentials, queries and alternate ports', () => {
  for (const url of ['http://hooks.slack.com/services/T/B/S', 'https://localhost/services/T/B/S', 'https://hooks.slack.com.evil.test/services/T/B/S',
    'https://user@hooks.slack.com/services/T/B/S', webhook + '?token=secret', 'https://hooks.slack.com:444/services/T/B/S', webhook + '/extra']) assert.throws(() => validateWebhook(url));
  assert.equal(validateWebhook(webhook), webhook);
});
test('Slack payload uses plain text and a tenant-specific link; 100% stays explicitly active', () => {
  const message = slackMessage({ orgId: 'tenant-a', objectiveId: 'objective-a', title: '<!channel> Title', actor: '<@U123>', event: 'Updated', health: 'off_track', state: 'active', progress: 100, note: 'x'.repeat(5000) });
  assert.ok(message.text.includes('&lt;!channel&gt;')); const payload = JSON.stringify(message);
  assert.ok(payload.includes('Achieved (active)')); assert.ok(payload.includes('Off track')); assert.ok(payload.includes('/orgs/tenant-a/objectives/objective-a'));
  assert.ok(!payload.includes('"type":"mrkdwn"')); assert.ok(payload.includes('"mrkdwn":false')); assert.ok(payload.length < 6000);
});
test('Slack transport requires ok, never follows redirects, and does not expose response contents', async () => {
  await sendSlack(webhook, { text: 'test' }, async (_url, options) => { assert.equal(options?.redirect, 'manual'); assert.ok(options?.signal); return new Response('ok', { status: 200 }); });
  for (const status of [302, 400, 403, 404]) await assert.rejects(sendSlack(webhook, {}, async () => new Response('secret response', { status })), error => error instanceof SlackFailure && error.permanent && !error.message.includes('secret'));
  await assert.rejects(sendSlack(webhook, {}, async () => new Response('not_ok')), error => error instanceof SlackFailure && error.permanent);
});
test('Slack transport respects rate-limit delays and retries server failures', async () => {
  await assert.rejects(sendSlack(webhook, {}, async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })), error => error instanceof SlackFailure && !error.permanent && error.retryAfter === 120000);
  await assert.rejects(sendSlack(webhook, {}, async () => new Response('', { status: 503 })), error => error instanceof SlackFailure && !error.permanent);
});
