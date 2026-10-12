import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AuditEvent, Prisma, PrismaClient } from '@prisma/client';
import { db } from '../db.js';
import { ApiError } from '../errors.js';
import { loadGraph } from '../objectives/domain.js';

export function slackKey() {
  const value = process.env.SLACK_ENCRYPTION_KEY;
  if (!value) return null;
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('SLACK_ENCRYPTION_KEY must contain 64 lowercase hexadecimal characters');
  return Buffer.from(value, 'hex');
}
export function validateWebhook(value: string) {
  // Reject credentials, query strings, alternate hosts/ports and redirects.
  if (!/^https:\/\/hooks\.slack(?:-gov)?\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value))
    throw new ApiError(400, 'INVALID_SLACK_WEBHOOK', 'Use a Slack incoming webhook URL from your Slack app settings');
  return value;
}
export function encryptWebhook(orgId: string, value: string) {
  const key = slackKey(); if (!key) throw new ApiError(503, 'SLACK_UNAVAILABLE', 'Slack integration is unavailable. Contact your host administrator.');
  validateWebhook(value);
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(orgId));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.');
}
export function decryptWebhook(orgId: string, value: string) {
  const key = slackKey(); if (!key) throw new Error('Slack credentials unavailable');
  const parts = value.split('.'); if (parts.length !== 3) throw new Error('Invalid Slack credential');
  const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(orgId)); cipher.setAuthTag(tag);
  return validateWebhook(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8'));
}
const plain = (text: string) => ({ type: 'plain_text', text: text.slice(0, 2900), emoji: false });
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function slackMessage(input: { orgId: string; objectiveId?: string; title: string; event: string; actor: string; state?: string; health?: string; progress?: number; note?: string }) {
  const health: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
  const state = input.state === 'active' && input.progress === 100 ? 'Achieved (active)' : input.state;
  const summary = `${input.event}\n${input.title}\nBy ${input.actor}`;
  const details = [input.progress === undefined ? '' : `${Math.round(input.progress * 10) / 10}%`, state, input.health && health[input.health]].filter(Boolean).join(' · ');
  const blocks: object[] = [{ type: 'section', text: plain(summary) }];
  if (details) blocks.push({ type: 'section', text: plain(details) });
  if (input.note) blocks.push({ type: 'section', text: plain(input.note.slice(0, 1000)) });
  if (input.objectiveId) {
    const origin = new URL(process.env.APP_URL || 'http://localhost:8080').origin;
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: plain('Open objective'), url: `${origin}/orgs/${input.orgId}/objectives/${input.objectiveId}` }] });
  }
  return { text: escape(summary.slice(0, 2900)), mrkdwn: false, unfurl_links: false, unfurl_media: false, blocks };
}
export async function queueSlack(tx: Prisma.TransactionClient, event: AuditEvent) {
  if (!event.orgId || !event.objectiveId || event.type === 'follow_updated') return;
  const integration = await tx.slackIntegration.findUnique({ where: { orgId: event.orgId } });
  if (!integration?.enabled || !integration.webhookCiphertext) return;
  const data = event.data as Record<string, any>;
  const assignmentChange = ['ownership_updated', 'key_result_owner_updated'].includes(event.type) ||
    event.type === 'objective_updated' && (data.before?.leadId !== data.after?.leadId || JSON.stringify(data.before?.assignments) !== JSON.stringify(data.after?.assignments));
  const notification = assignmentChange || ['check_in_created', 'comment_created'].includes(event.type);
  const update = event.type !== 'comment_created';
  if (!(integration.notifications && notification || integration.objectiveUpdates && update)) return;
  const graph = await loadGraph(tx, event.orgId); const objective = graph.objectives.find(o => o.id === event.objectiveId);
  if (!objective) return;
  const actor = await tx.user.findUniqueOrThrow({ where: { id: event.userId }, select: { name: true } });
  const payload = slackMessage({ orgId: event.orgId, objectiveId: objective.id, title: objective.title, event: event.text,
    actor: actor.name, state: objective.state, health: objective.health, progress: graph.scores.get(objective.id), note: typeof data.note === 'string' ? data.note : undefined });
  await tx.slackDelivery.create({ data: { orgId: event.orgId, integrationVersion: integration.version, objectiveId: objective.id, auditId: event.id,
    kind: notification ? 'notification' : 'objective', payload: payload as Prisma.InputJsonObject } });
}

export class SlackFailure extends Error {
  constructor(public readonly safeMessage: string, public readonly permanent = false, public readonly retryAfter = 0) { super(safeMessage); }
}
export async function sendSlack(webhook: string, payload: Prisma.JsonValue, request: typeof fetch = fetch) {
  validateWebhook(webhook);
  const response = await request(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    throw new SlackFailure('Slack rate limit; delivery deferred', false, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) * 1000 : 30000);
  }
  if (response.status !== 200) throw new SlackFailure(`Slack delivery failed (HTTP ${response.status})`, response.status < 500);
  if ((await response.text()).trim() !== 'ok') throw new SlackFailure('Slack rejected the message', true);
}
export async function deliverSlack(database: PrismaClient = db, send: typeof sendSlack = sendSlack) {
  if (!slackKey()) return false;
  return database.$transaction(async tx => {
    // Lock the integration to serialize delivery/configuration, but permit FK inserts
    // from ordinary objective writes. Never hold an organization lock during HTTP.
    const rows = await tx.$queryRaw<{ id: string; orgId: string }[]>`
      SELECT d.id, d."orgId" FROM "SlackDelivery" d
      JOIN "SlackIntegration" i ON i."orgId" = d."orgId"
      JOIN "Organization" o ON o.id = d."orgId"
      WHERE d."sentAt" IS NULL AND d.attempts < 5 AND d."nextAttemptAt" <= now()
        AND i.enabled AND o.active AND i."webhookCiphertext" IS NOT NULL
        AND d."integrationVersion" = i.version AND i."nextSendAt" <= now()
      ORDER BY d."createdAt", d.id FOR NO KEY UPDATE OF i SKIP LOCKED LIMIT 1`;
    if (!rows.length) return false;
    const row = await tx.slackDelivery.findUniqueOrThrow({ where: { id: rows[0].id } });
    const integration = await tx.slackIntegration.findUniqueOrThrow({ where: { orgId: row.orgId } });
    let nextSendAt = new Date(Date.now() + 1100);
    try {
      let webhook: string;
      try { webhook = decryptWebhook(row.orgId, integration.webhookCiphertext!); }
      catch { throw new SlackFailure('Slack credentials unavailable; reconnect the integration', true); }
      await send(webhook, row.payload);
      await tx.slackDelivery.update({ where: { id: row.id }, data: { sentAt: new Date(), attempts: row.attempts + 1, lastError: null, payload: { delivered: true } } });
      await tx.slackIntegration.update({ where: { orgId: row.orgId }, data: { lastSentAt: new Date(), lastError: null, nextSendAt } });
    } catch (error) {
      const failure = error instanceof SlackFailure ? error : new SlackFailure('Slack delivery unavailable');
      const delay = Math.max(failure.retryAfter, 30000 * 2 ** row.attempts);
      if (failure.retryAfter) nextSendAt = new Date(Date.now() + delay);
      await tx.slackDelivery.update({ where: { id: row.id }, data: { attempts: failure.permanent ? 5 : row.attempts + 1,
        nextAttemptAt: new Date(Date.now() + delay), lastError: failure.safeMessage } });
      await tx.slackIntegration.update({ where: { orgId: row.orgId }, data: { lastError: failure.safeMessage, nextSendAt } });
    }
    return true;
  }, { timeout: 15000, maxWait: 5000 });
}
