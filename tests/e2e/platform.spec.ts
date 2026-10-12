import { test as base, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createAccount, password, uniqueEmail } from './accounts.fixture';

const test = base.extend<{ platform: { db: PrismaClient; adminEmail: string; ownerEmail: string; orgId: string; orgName: string; userId: string; targetEmail: string } }>({
  platform: async ({ page }, use) => {
    const db = new PrismaClient(); const adminEmail = uniqueEmail(); const ownerEmail = uniqueEmail(); const targetEmail = uniqueEmail(); const emails = [adminEmail, ownerEmail, targetEmail]; let orgId = '';
    try {
      await createAccount(page.request, ownerEmail); const session = await (await page.request.get('/api/v1/auth/session')).json(); orgId = session.memberships[0].org.id;
      const owner = await db.user.update({ where: { email: ownerEmail }, data: { verified: true } });
      const target = await db.user.create({ data: { email: targetEmail, name: 'Platform target', passwordHash: owner.passwordHash, verified: true } });
      await db.membership.create({ data: { userId: target.id, orgId } });
      execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'apps/api/src/platform/bootstrap-command.ts', '--email', adminEmail, '--name', 'Platform Reviewer', '--password-stdin'], { input: password + '\n', env: { ...process.env, NODE_ENV: 'test', APP_URL: 'http://web', COOKIE_SECURE: 'false' } });
      const login = await mutation(page, 'auth/login', { email: adminEmail, password }, 'POST'); expect(login.status()).toBe(200);
      await use({ db, adminEmail, ownerEmail, orgId, orgName: session.memberships[0].org.name, userId: target.id, targetEmail });
    } finally {
      const users = await db.user.findMany({ where: { email: { in: emails } } }); const ids = users.map(u => u.id);
      await db.emailOutbox.deleteMany({ where: { to: { in: emails } } });
      await db.auditEvent.deleteMany({ where: { OR: [{ userId: { in: ids } }, ...(orgId ? [{ orgId }] : [])] } });
      if (orgId) { await db.keyResult.deleteMany({ where: { orgId } }); await db.objective.deleteMany({ where: { orgId } }); await db.organization.delete({ where: { id: orgId } }); }
      await db.membership.deleteMany({ where: { userId: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
    }
  }
});
async function mutation(page: Page, path: string, data: unknown, method = 'PATCH') {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  return page.request.fetch(`/api/v1/${path}`, { method, data, headers: { Origin: 'http://web', 'X-CSRF-Token': session.csrf } });
}
test('explicit host bootstrap signs in without tenant membership; ordinary accounts cannot use platform controls', async ({ page, platform }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/platform'); await expect(page.getByRole('heading', { name: 'Platform administration', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/v1/auth/session')).json()).memberships).toHaveLength(0);
  expect((await page.request.get(`/api/v1/orgs/${platform.orgId}/objectives`)).status()).toBe(404);
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('link', { name: 'Platform administration', exact: true })).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Close navigation' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/platform-${info.project.name}.png`, fullPage: true });
  await mutation(page, 'auth/login', { email: platform.ownerEmail, password }, 'POST'); await page.reload();
  await expect(page).toHaveURL(/\/overview$/); expect((await page.request.get('/api/v1/platform/users')).status()).toBe(403);
  expect(errors).toEqual([]);
});
test('global account suspension/activation requires confirmation and reason and produces visible audit history', async ({ page, platform }) => {
  await page.goto(`/platform?search=${encodeURIComponent(platform.targetEmail)}`);
  const row = page.getByRole('article', { name: platform.targetEmail, exact: true });
  await row.getByRole('button', { name: 'Suspend', exact: true }).click(); await row.getByLabel('Reason for suspension').fill('Offboarding completed by reviewer');
  await row.getByRole('button', { name: 'Confirm suspension' }).click(); await expect(row.getByText('Suspended', { exact: true })).toBeVisible();
  expect((await platform.db.user.findUniqueOrThrow({ where: { id: platform.userId } })).active).toBe(false);
  await row.getByRole('button', { name: 'Activate', exact: true }).click(); await row.getByLabel('Reason for activation').fill('Account access approved'); await row.getByRole('button', { name: 'Confirm activation' }).click();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Platform history', exact: true }).click();
  await expect(page).toHaveURL(/section=audit/); await expect(page.getByLabel('Search platform records')).toHaveValue('');
  await page.getByLabel('Search platform records').fill(platform.targetEmail); await expect(page).toHaveURL(new RegExp(`search=${encodeURIComponent(platform.targetEmail)}`));
  await expect(page.getByText('Account access approved', { exact: true })).toBeVisible(); await expect(page.getByText('Offboarding completed by reviewer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide filters' }).click(); await expect(page.getByText('Account access approved', { exact: true })).toBeVisible(); await page.reload();
  await expect(page.getByLabel('Search platform records')).toHaveValue(platform.targetEmail);
});
test('platform UI refuses a last owner suspension and handles stale versions with reload', async ({ page, platform }) => {
  await page.goto(`/platform?search=${encodeURIComponent(platform.ownerEmail)}`); const row = page.getByRole('article', { name: platform.ownerEmail });
  await row.getByRole('button', { name: 'Suspend', exact: true }).click(); await row.getByLabel('Reason for suspension').fill('Owner suspension test'); await row.getByRole('button', { name: 'Confirm suspension' }).click();
  await expect(row.getByRole('alert')).toContainText('globally active owner'); await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Search platform records').fill(platform.targetEmail); const target = page.getByRole('article', { name: platform.targetEmail }); await expect(target.getByText('Active', { exact: true })).toBeVisible();
  expect((await mutation(page, `platform/users/${platform.userId}`, { active: false, version: 1, reason: 'Concurrent administrator edit' })).status()).toBe(200);
  await target.getByRole('button', { name: 'Suspend', exact: true }).click(); await target.getByLabel('Reason for suspension').fill('Stale platform edit'); await target.getByRole('button', { name: 'Confirm suspension' }).click();
  await expect(target.getByRole('alert')).toContainText('changed'); await page.getByRole('button', { name: 'Reload', exact: true }).click(); await expect(target.getByText('Suspended', { exact: true })).toBeVisible();
});
test('organization activation works through platform UI and never exposes foreign tenant objectives', async ({ page, platform }) => {
  await page.goto(`/platform?section=organizations&search=${encodeURIComponent(platform.orgName)}`);
  // Other parallel fixtures use the same human name, so identify this exact organization row by its API ID through a distinct name.
  const name = `Reviewed organization ${platform.orgId}`; await platform.db.organization.update({ where: { id: platform.orgId }, data: { name } });
  await page.getByLabel('Search platform records').fill(name); const row = page.getByRole('article', { name, exact: true });
  await row.getByRole('button', { name: 'Suspend', exact: true }).click(); await row.getByLabel('Reason for suspension').fill('Scheduled maintenance'); await row.getByRole('button', { name: 'Confirm suspension' }).click(); await expect(row.getByText('Suspended', { exact: true })).toBeVisible();
  expect((await page.request.get(`/api/v1/orgs/${platform.orgId}/objectives`)).status()).toBe(404);
  await row.getByRole('button', { name: 'Activate', exact: true }).click(); await row.getByLabel('Reason for activation').fill('Maintenance complete'); await row.getByRole('button', { name: 'Confirm activation' }).click(); await expect(row.getByText('Active', { exact: true })).toBeVisible();
  expect((await page.request.get(`/api/v1/orgs/${platform.orgId}/objectives`)).status()).toBe(404);
});
