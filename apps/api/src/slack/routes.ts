import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient, SlackIntegration } from '@prisma/client';
import { z } from 'zod';
import { db } from '../db.js';
import { ApiError } from '../errors.js';
import { accountConfig, checkMutation, readSession, requireSession, type AccountConfig } from '../accounts/security.js';
import { checkVersion, requireAdmin, requireMembership, writeAccess } from '../organizations/access.js';
import { encryptWebhook, slackKey, slackMessage } from './service.js';

const params = z.object({ orgId: z.string().uuid() });
const version = z.object({ version: z.number().int().min(0) }).strict();
const settings = z.object({ version: z.number().int().min(0), enabled: z.boolean(), objectiveUpdates: z.boolean(), notifications: z.boolean(),
  channelLabel: z.string().trim().min(1).max(80), webhookUrl: z.string().max(500).optional() }).strict();
function present(integration: SlackIntegration | null) {
  return { available: Boolean(slackKey()), configured: Boolean(integration?.webhookCiphertext), version: integration?.version ?? 0,
    enabled: integration?.enabled ?? false, channelLabel: integration?.channelLabel ?? '', objectiveUpdates: integration?.objectiveUpdates ?? true,
    notifications: integration?.notifications ?? true, lastSentAt: integration?.lastSentAt ?? null, lastError: integration?.lastError ?? null };
}
export async function registerSlack(app: FastifyInstance, options: { database?: PrismaClient; config?: AccountConfig } = {}) {
  const database = options.database ?? db; const config = options.config ?? accountConfig();
  app.addHook('preHandler', async request => {
    const session = requireSession(await readSession(database, request));
    if (['PUT', 'POST', 'DELETE'].includes(request.method)) checkMutation(request, session, config);
  });
  async function write<T>(request: FastifyRequest, work: (tx: Prisma.TransactionClient, orgId: string, userId: string) => Promise<T>) {
    const { orgId } = params.parse(request.params); const session = requireSession(await readSession(database, request));
    return database.$transaction(async tx => { const actor = await writeAccess(tx, session, orgId, config); requireAdmin(actor); return work(tx, orgId, actor.userId); }, { timeout: 15000 });
  }
  const route = (summary: string) => ({ schema: { tags: ['slack'], summary } });
  app.get('/api/v1/orgs/:orgId/integrations/slack', route('Read redacted Slack settings and delivery status; administrators only'), async request => {
    const { orgId } = params.parse(request.params); const session = requireSession(await readSession(database, request));
    requireAdmin(await requireMembership(database, orgId, session.userId));
    return database.$transaction(async tx => {
      const integration = await tx.slackIntegration.findUnique({ where: { orgId } });
      const where = { orgId, integrationVersion: integration?.version ?? 0, sentAt: null };
      const [pending, failed] = await Promise.all([tx.slackDelivery.count({ where: { ...where, attempts: { lt: 5 } } }), tx.slackDelivery.count({ where: { ...where, attempts: 5 } })]);
      return { ...present(integration), pending, failed };
    });
  });
  app.put('/api/v1/orgs/:orgId/integrations/slack', route('Configure encrypted organization Slack delivery with optimistic versions'), async request => {
    const input = settings.parse(request.body);
    return write(request, async (tx, orgId, userId) => {
      if (!slackKey()) throw new ApiError(503, 'SLACK_UNAVAILABLE', 'Slack integration is unavailable. Contact your host administrator.');
      const existing = await tx.slackIntegration.findUnique({ where: { orgId } }); checkVersion(existing?.version ?? 0, input.version);
      const webhookCiphertext = input.webhookUrl ? encryptWebhook(orgId, input.webhookUrl) : existing?.webhookCiphertext;
      if (input.enabled && !webhookCiphertext) throw new ApiError(400, 'SLACK_WEBHOOK_REQUIRED', 'Add a Slack incoming webhook before enabling delivery');
      if (input.enabled && !input.notifications && !input.objectiveUpdates) throw new ApiError(400, 'SLACK_EVENTS_REQUIRED', 'Select at least one kind of Slack update');
      const fields = { enabled: input.enabled, channelLabel: input.channelLabel, objectiveUpdates: input.objectiveUpdates, notifications: input.notifications,
        webhookCiphertext: webhookCiphertext ?? null, version: input.version + 1, nextSendAt: new Date(), lastError: null };
      const result = await tx.slackIntegration.upsert({ where: { orgId }, create: { orgId, ...fields }, update: fields });
      // Never send stale queued content to a replacement destination or after pause.
      await tx.slackDelivery.deleteMany({ where: { orgId, sentAt: null } });
      await tx.auditEvent.create({ data: { orgId, userId, type: 'slack_configured', text: 'Slack integration settings updated',
        data: { version: result.version, enabled: result.enabled, channelLabel: result.channelLabel, objectiveUpdates: result.objectiveUpdates, notifications: result.notifications, webhookChanged: Boolean(input.webhookUrl) } } });
      return present(result);
    });
  });
  app.delete('/api/v1/orgs/:orgId/integrations/slack', route('Disconnect Slack and discard unsent deliveries'), async request => {
    const input = version.parse(request.body);
    return write(request, async (tx, orgId, userId) => {
      const integration = await tx.slackIntegration.findUnique({ where: { orgId } }); checkVersion(integration?.version ?? 0, input.version);
      if (integration) await tx.slackIntegration.update({ where: { orgId }, data: { enabled: false, webhookCiphertext: null, channelLabel: '', version: { increment: 1 }, lastError: null } });
      await tx.slackDelivery.deleteMany({ where: { orgId } });
      await tx.auditEvent.create({ data: { orgId, userId, type: 'slack_disconnected', text: 'Slack integration disconnected', data: {} } });
      return { message: 'Slack disconnected' };
    });
  });
  for (const action of ['test', 'retry'] as const) app.post(`/api/v1/orgs/:orgId/integrations/slack/${action}`, route(action === 'test' ? 'Queue an explicit Slack connection test' : 'Retry exhausted Slack deliveries'), async request => {
    const input = version.parse(request.body);
    return write(request, async (tx, orgId, userId) => {
      const integration = await tx.slackIntegration.findUnique({ where: { orgId } }); checkVersion(integration?.version ?? 0, input.version);
      if (!slackKey() || !integration?.enabled || !integration.webhookCiphertext) throw new ApiError(409, 'SLACK_DISABLED', 'Enable a configured Slack integration first');
      if (action === 'test') {
        const actor = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
        await tx.slackDelivery.create({ data: { orgId, integrationVersion: integration.version, kind: 'test',
          payload: slackMessage({ orgId, title: 'Slack connection test', event: 'OKR Workspace is connected', actor: actor.name }) as Prisma.InputJsonObject } });
      } else await tx.slackDelivery.updateMany({ where: { orgId, integrationVersion: integration.version, sentAt: null, attempts: 5 }, data: { attempts: 0, nextAttemptAt: new Date(), lastError: null } });
      await tx.auditEvent.create({ data: { orgId, userId, type: `slack_${action}`, text: action === 'test' ? 'Slack connection test queued' : 'Failed Slack deliveries retried', data: {} } });
      return { message: action === 'test' ? 'Test message queued. Check your Slack channel and delivery status.' : 'Failed deliveries queued for retry' };
    });
  });
}
