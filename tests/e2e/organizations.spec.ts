import { test as base, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createAccount, password, uniqueEmail } from './accounts.fixture';

const test = base.extend<{ organization: { orgId: string; email: string; member: (role: string, name: string) => Promise<{ id: string; email: string }>; trackOrg: (id: string) => void; trackEmail: (email: string) => void } }>({
  organization: async ({ page }, use) => {
    const db = new PrismaClient(); const email = uniqueEmail(); const emails = [email]; const orgs: string[] = [];
    try {
      await createAccount(page.request, email); const session = await (await page.request.get('/api/v1/auth/session')).json(); const orgId = session.memberships[0].org.id; orgs.push(orgId);
      // Verified fixture owners allow admin tests in both modes; account browser tests
      // separately exercise verification delivery and the unverified state.
      const owner = await db.user.update({ where: { email }, data: { verified: true } });
      await use({ orgId, email, trackOrg: id => orgs.push(id), trackEmail: address => emails.push(address), member: async (role, name) => {
        const address = uniqueEmail(); emails.push(address); const user = await db.user.create({ data: { email: address, name, passwordHash: owner.passwordHash, verified: true } });
        const membership = await db.membership.create({ data: { orgId, userId: user.id, role } }); return { id: membership.id, email: address };
      } });
    } finally {
      const users = await db.user.findMany({ where: { email: { in: emails } } }); const ids = users.map(u => u.id);
      await db.emailOutbox.deleteMany({ where: { to: { in: emails } } });
      await db.auditEvent.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { userId: { in: ids } }] } });
      await db.organization.deleteMany({ where: { id: { in: orgs } } });
      await db.membership.deleteMany({ where: { userId: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
    }
  }
});
async function navigate(page: Page, name: string, mobile: boolean) {
  if (mobile && await page.getByRole('button', { name: 'Open navigation' }).isVisible()) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name, exact: true }).click();
}
async function mutation(page: Page, path: string, data: unknown, method = 'POST') {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  return page.request.fetch(`/api/v1/${path}`, { method, data, headers: { Origin: 'http://web', 'X-CSRF-Token': session.csrf } });
}
test('organization creation, keyboard switching, tenant content and reload persistence', async ({ page, organization }, info) => {
  const mobile = info.project.name === 'mobile'; const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/organization');
  await page.getByLabel('Organization name', { exact: true }).fill('Original organization');
  await page.getByRole('button', { name: 'Save organization', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Organization settings saved');
  await page.getByLabel('New organization name', { exact: true }).fill('Second organization');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Second organization');
  const session = await (await page.request.get('/api/v1/auth/session')).json(); const secondId = session.memberships.find((m: { org: { name: string } }) => m.org.name === 'Second organization').org.id; organization.trackOrg(secondId);
  await navigate(page, 'Teams', mobile);
  await page.getByLabel('New team name').fill('Second tenant team'); await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second tenant team', exact: true })).toBeVisible();
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  const switcher = page.getByRole('combobox', { name: 'Switch organization' });
  await switcher.focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  if (mobile) { await expect(page.getByRole('dialog', { name: 'Workspace navigation', exact: true })).toHaveCount(0); await expect(page.locator('#main-content')).toBeFocused(); await page.getByRole('button', { name: 'Open navigation' }).click(); }
  await expect(switcher).toHaveValue(organization.orgId);
  if (mobile) await page.getByRole('link', { name: 'Teams', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second tenant team', exact: true })).toHaveCount(0);
  await expect(page.getByText('No teams yet.', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('No teams yet.', { exact: true })).toBeVisible();
  await navigate(page, 'Organization', mobile); await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Original organization');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); expect(errors).toEqual([]);
});

test('member search, roles, suspension/reactivation, last-owner feedback and admin history', async ({ page, organization }, info) => {
  const member = await organization.member('member', 'Admin Review Member');
  await page.goto('/members'); await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await page.getByLabel('Search members').fill(member.email);
  const card = page.getByRole('article').filter({ hasText: member.email });
  await card.getByRole('combobox', { name: 'Role', exact: true }).selectOption('viewer');
  await card.getByRole('checkbox', { name: 'Active', exact: true }).uncheck();
  await card.getByRole('button', { name: 'Save member', exact: true }).click();
  await expect(card.getByText('Inactive membership', { exact: true })).toBeVisible();
  await card.getByRole('checkbox', { name: 'Active', exact: true }).check();
  await card.getByRole('button', { name: 'Save member', exact: true }).click(); await expect(card.getByText('Active membership', { exact: true })).toBeVisible();
  await page.getByLabel('Search members').fill(organization.email);
  const owner = page.getByRole('article').filter({ hasText: organization.email });
  await owner.getByRole('combobox', { name: 'Role', exact: true }).selectOption('admin');
  await owner.getByRole('button', { name: 'Save member', exact: true }).click(); await expect(owner.getByRole('alert')).toContainText('Keep at least one active organization owner');
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/members-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await navigate(page, 'Administration history', info.project.name === 'mobile');
  await expect(page.getByRole('listitem').filter({ hasText: 'Membership updated for Admin Review Member' })).toHaveCount(2);
  await expect(page.getByText('Browser Reviewer', { exact: false }).first()).toBeVisible();
});

test('copied invitations create real membership, reject replay, and can be revoked', async ({ page, organization, browser }, info) => {
  const email = uniqueEmail(); organization.trackEmail(email); await page.goto('/members');
  await page.getByLabel('Invite email address').fill(email); await page.getByRole('combobox', { name: 'Role', exact: true }).last().selectOption('viewer');
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const input = page.getByLabel('Invitation link', { exact: true }); await expect(input).toBeVisible(); const link = await input.inputValue();
  if (process.env.TEST_EMAIL_MODE === 'smtp') {
    let messageId: string | undefined;
    await expect.poll(async () => {
      const inbox = await (await page.request.get('http://mailpit:8025/api/v1/messages')).json();
      messageId = inbox.messages.find((m: { Subject: string; ID: string; To: { Address: string }[] }) => m.Subject === 'Your OKR Workspace invitation' && m.To.some(to => to.Address === email))?.ID;
      return Boolean(messageId);
    }, { timeout: 20000 }).toBeTruthy();
    const mail = await (await page.request.get(`http://mailpit:8025/api/v1/message/${messageId}`)).json(); expect(mail.Text).toContain(link);
  }
  const context = await browser.newContext(); const invited = await context.newPage();
  try {
    await invited.goto(`/invitation${new URL(link).hash}`); await invited.getByLabel('Full name', { exact: true }).fill('Invited Browser Viewer');
    await invited.getByLabel('Password', { exact: true }).fill(password); await invited.getByLabel('Confirm password', { exact: true }).fill(password);
    await invited.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(invited.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await invited.goto('/members'); await expect(invited.getByRole('button', { name: 'Save member', exact: true })).toHaveCount(0); await expect(invited.getByRole('button', { name: 'Create invitation', exact: true })).toHaveCount(0);
    await invited.goto(`/invitation${new URL(link).hash}`); await expect(invited.getByRole('alert')).toContainText('invalid, expired, or already used');
  } finally { await context.close(); }
  const revokeEmail = `${randomUUID()}@browser.accounts.example`; organization.trackEmail(revokeEmail);
  await page.getByLabel('Invite email address').fill(revokeEmail); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(page.getByLabel('Invitation link', { exact: true })).not.toHaveValue(link);
  const revokeLink = await page.getByLabel('Invitation link', { exact: true }).inputValue(); const row = page.getByRole('article').filter({ hasText: revokeEmail });
  await row.getByRole('button', { name: 'Revoke', exact: true }).click(); await expect(row).toContainText('Closed');
  const response = await mutation(page, 'auth/invitation', { token: new URL(revokeLink).hash.split('=')[1] }); expect(response.status()).toBe(400);
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/invitations-${info.project.name}.png`, fullPage: true });
});

test('team roster and designated manager workflows enforce boundaries in the UI and API', async ({ page, organization, browser }, info) => {
  const manager = await organization.member('manager', 'Design Manager'); await organization.member('member', 'Design Contributor');
  await page.goto('/teams'); await page.getByLabel('New team name').fill('Product design'); await page.getByRole('button', { name: 'Create team', exact: true }).click();
  // Sections without an accessible label are located by their stable heading.
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Product design', exact: true }) });
  await card.getByRole('button', { name: 'Add team member', exact: true }).click(); await card.getByLabel('Find a member').fill(manager.email);
  await card.getByRole('button', { name: /Design Manager.*manager/ }).click(); await card.getByRole('checkbox', { name: 'Designated manager', exact: true }).check();
  await card.getByRole('button', { name: 'Confirm team member', exact: true }).click(); await expect(card.getByText('manager · Designated manager', { exact: true })).toBeVisible();
  await page.getByLabel('New team name').fill('Unrelated team'); await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/teams-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const context = await browser.newContext({ viewport: info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 960 } }); const managed = await context.newPage();
  try {
    await managed.goto('/login'); await managed.getByLabel('Email address', { exact: true }).fill(manager.email); await managed.getByLabel('Password', { exact: true }).fill(password); await managed.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(managed.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible(); await managed.goto('/teams');
    const designated = managed.locator('section').filter({ has: managed.getByRole('heading', { name: 'Product design', exact: true }) });
    const unrelated = managed.locator('section').filter({ has: managed.getByRole('heading', { name: 'Unrelated team', exact: true }) });
    await expect(unrelated.getByRole('button', { name: 'Rename team', exact: true })).toHaveCount(0); await expect(managed.getByRole('button', { name: 'Create team', exact: true })).toHaveCount(0);
    await designated.getByRole('button', { name: 'Add team member', exact: true }).click(); await designated.getByLabel('Find a member').fill('Design Contributor'); await designated.getByRole('button', { name: /Design Contributor/ }).click();
    await expect(designated.getByRole('checkbox', { name: 'Designated manager', exact: true })).toHaveCount(0);
    await designated.getByRole('button', { name: 'Confirm team member', exact: true }).click(); await expect(designated.getByRole('listitem').filter({ hasText: 'Design Contributor' })).toBeVisible();
    await designated.getByLabel('Team name', { exact: true }).fill('Managed design'); await designated.getByRole('button', { name: 'Rename team', exact: true }).click(); await expect(managed.getByRole('heading', { name: 'Managed design', exact: true })).toBeVisible();
    const teams = await (await managed.request.get(`/api/v1/orgs/${organization.orgId}/teams`)).json(); const other = teams.find((entry: { name: string }) => entry.name === 'Unrelated team');
    expect((await mutation(managed, `orgs/${organization.orgId}/teams/${other.id}`, { name: 'Forbidden', version: other.version }, 'PATCH')).status()).toBe(403);
  } finally { await context.close(); }
});

test('stale administration writes show conflicts and ownership transfer preserves access', async ({ page, organization }) => {
  const target = await organization.member('member', 'Next Owner'); await page.goto('/organization');
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Review Organization');
  const external = await mutation(page, `orgs/${organization.orgId}`, { name: 'Concurrent rename', timezone: 'UTC', version: 1 }, 'PATCH'); expect(external.status()).toBe(200);
  await page.getByLabel('Organization name', { exact: true }).fill('Stale rename'); await page.getByRole('button', { name: 'Save organization', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This record changed. Reload and try again.'); await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Concurrent rename');
  await page.getByLabel('Find a member').fill(target.email); await page.getByRole('button', { name: /Next Owner/ }).click();
  await page.getByRole('button', { name: 'Confirm ownership transfer', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Transfer ownership', exact: true })).toHaveCount(0);
  const session = await (await page.request.get('/api/v1/auth/session')).json(); expect(session.memberships[0].role).toBe('admin');
  await page.reload(); await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Concurrent rename');
  await page.goto('/members'); await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await page.getByLabel('Search members').fill(target.email); const card = page.getByRole('article').filter({ hasText: target.email });
  await expect(card.getByText('owner', { exact: true })).toBeVisible(); await expect(card.getByRole('button', { name: 'Save member', exact: true })).toHaveCount(0);
});
