import { test as base, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createAccount, password, uniqueEmail } from './accounts.fixture';

const webhook = 'https://hooks.slack.com/services/TBROWSER/BBROWSER/fixtureSecretOnly';
const test = base.extend<{ slack: { orgId: string; leadId: string; email: string; db: PrismaClient; orgs: string[]; emails: string[] } }>({
  slack: async ({ page }, use) => {
    const db = new PrismaClient(); const email = uniqueEmail(); const emails = [email]; const orgs: string[] = [];
    try {
      await createAccount(page.request, email); const session = await (await page.request.get('/api/v1/auth/session')).json();
      const orgId = session.memberships[0].org.id; orgs.push(orgId); await db.user.update({ where: { email }, data: { verified: true } });
      await use({ orgId, leadId: session.memberships[0].id, email, db, orgs, emails });
    } finally {
      const ids = (await db.user.findMany({ where: { email: { in: emails } } })).map(user => user.id);
      await db.slackDelivery.deleteMany({ where: { orgId: { in: orgs } } });
      await db.emailOutbox.deleteMany({ where: { to: { in: emails } } }); await db.auditEvent.deleteMany({ where: { orgId: { in: orgs } } });
      await db.notification.deleteMany({ where: { orgId: { in: orgs } } }); await db.checkIn.deleteMany({ where: { orgId: { in: orgs } } }); await db.comment.deleteMany({ where: { orgId: { in: orgs } } });
      await db.objectiveLink.deleteMany({ where: { orgId: { in: orgs } } }); await db.objective.deleteMany({ where: { orgId: { in: orgs } } });
      await db.organization.deleteMany({ where: { id: { in: orgs } } }); await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
    }
  }
});
async function mutation(page: Page, path: string, data: unknown, method = 'POST') {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  return page.request.fetch(`/api/v1/${path}`, { method, data, headers: { Origin: 'http://web', 'X-CSRF-Token': session.csrf } });
}
async function connect(page: Page) {
  const panel = page.getByRole('region', { name: 'Slack integration', exact: true });
  await panel.getByLabel('Slack incoming webhook', { exact: true }).fill(webhook);
  await panel.getByLabel('Enable Slack delivery', { exact: true }).check();
  await panel.getByRole('button', { name: 'Save Slack settings', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Slack settings saved');
  await expect(panel.getByLabel('Replace Slack webhook (optional)', { exact: true })).toHaveValue('');
  return panel;
}
test('Slack admin connects, hides the credential, queues real objective/test messages and retains settings', async ({ page, slack }, info) => {
  await page.goto('/organization'); const panel = await connect(page);
  const objective = await mutation(page, `orgs/${slack.orgId}/objectives`, { title: 'Slack browser outcome', leadId: slack.leadId, startDate: '2026-01-01', endDate: '2026-12-31' }); expect(objective.status()).toBe(201);
  await panel.getByRole('button', { name: 'Send test message', exact: true }).click(); await expect(panel.getByRole('status')).toContainText('Test message queued');
  await expect(panel.getByLabel('Slack delivery status')).toContainText('2 pending');
  const settings = await page.request.get(`/api/v1/orgs/${slack.orgId}/integrations/slack`); expect(await settings.text()).not.toContain('fixtureSecretOnly');
  await page.reload(); await expect(panel.getByText('Sending to #okr-updates', { exact: true })).toBeVisible(); await expect(panel.getByLabel('Replace Slack webhook (optional)')).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const evidence = process.env.EVIDENCE_DIR || 'artifacts'; await mkdir(evidence, { recursive: true }); await panel.screenshot({ path: `${evidence}/slack-${info.project.name}.png` });
});
test('Slack settings handle concurrent changes, pause queued messages and confirm disconnect', async ({ page, slack }) => {
  await page.goto('/organization'); const panel = await connect(page);
  expect((await mutation(page, `orgs/${slack.orgId}/integrations/slack`, { version: 1, enabled: true, channelLabel: '#concurrent', notifications: true, objectiveUpdates: true }, 'PUT')).status()).toBe(200);
  await panel.getByRole('button', { name: 'Save Slack settings', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('changed');
  await page.getByRole('button', { name: 'Reload', exact: true }).click(); await expect(panel.getByLabel('Slack channel label')).toHaveValue('#concurrent');
  await panel.getByLabel('Enable Slack delivery').uncheck(); await panel.getByRole('button', { name: 'Save Slack settings', exact: true }).click(); await expect(panel.getByText('Slack delivery paused', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send test message', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Disconnect Slack', exact: true }).click(); await panel.getByRole('button', { name: 'Confirm disconnect', exact: true }).click();
  await expect(panel.getByText('Slack is not connected', { exact: true })).toBeVisible(); await expect(panel.getByLabel('Slack incoming webhook', { exact: true })).toHaveValue('');
});
test('Slack settings remain hidden from ordinary members and the API refuses access', async ({ page, slack }) => {
  const email = uniqueEmail(); slack.emails.push(email); const owner = await slack.db.user.findUniqueOrThrow({ where: { email: slack.email } });
  const user = await slack.db.user.create({ data: { email, name: 'Slack viewer', passwordHash: owner.passwordHash, verified: true } });
  await slack.db.membership.create({ data: { orgId: slack.orgId, userId: user.id, role: 'viewer' } });
  expect((await mutation(page, 'auth/logout', {})).status()).toBe(200); await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible(); await page.goto('/organization');
  await expect(page.getByRole('heading', { name: 'Organization settings', exact: true })).toBeVisible(); await expect(page.getByRole('region', { name: 'Slack integration' })).toHaveCount(0);
  expect((await page.request.get(`/api/v1/orgs/${slack.orgId}/integrations/slack`)).status()).toBe(403);
});
test('Slack objective links select the right organization and reject unavailable tenants', async ({ page, slack }, info) => {
  const mobile = info.project.name === 'mobile';
  const created = await mutation(page, 'orgs', { name: 'Slack linked tenant', timezone: 'UTC' }); expect(created.status()).toBe(201); const org = await created.json(); slack.orgs.push(org.id);
  const session = await (await page.request.get('/api/v1/auth/session')).json(); const membership = session.memberships.find((m: any) => m.org.id === org.id);
  const response = await mutation(page, `orgs/${org.id}/objectives`, { title: 'Correct Slack tenant outcome', leadId: membership.id, startDate: '2026-01-01', endDate: '2026-12-31' }); expect(response.status()).toBe(201); const objective = await response.json();
  await page.goto('/overview');
  if (mobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByLabel('Switch organization').selectOption(slack.orgId);
  await page.goto(`/orgs/${org.id}/objectives/${objective.id}`); await expect(page).toHaveURL(new RegExp(`/objectives/${objective.id}$`));
  await expect(page.getByRole('heading', { name: 'Correct Slack tenant outcome', exact: true })).toBeVisible();
  if (mobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByLabel('Switch organization')).toHaveValue(org.id);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Correct Slack tenant outcome', exact: true })).toBeVisible();
  await page.goto(`/orgs/${randomUUID()}/objectives/${objective.id}`); await expect(page.getByRole('alert')).toContainText('unavailable to your account');
  if (mobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByLabel('Switch organization')).toHaveValue(org.id);
});
