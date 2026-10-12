import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { uniqueEmail, password, mutate, cleanupAccount } from './accounts.fixture';
import { hashPassword } from '../../apps/api/src/accounts/security';

test('startup flag controls public signup links, direct routes and API registration', async ({ page }, info) => {
  const disabled = process.env.TEST_DISABLE_SIGNUP === 'true';
  const email = uniqueEmail();
  try {
    const session = await (await page.request.get('/api/v1/auth/session')).json();
    expect(session.signupEnabled).toBe(!disabled);
    await page.goto('/login');
    const link = page.getByRole('link', { name: 'Create account', exact: true });
    if (disabled) {
      await expect(link).toHaveCount(0);
      await page.goto('/signup');
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
      const response = await mutate(page.request, 'signup', { name: 'Public Signup', email, password, organization: 'Blocked registration' });
      expect(response.status()).toBe(403);
      expect((await response.json()).error.code).toBe('SIGNUP_DISABLED');
      const db = new PrismaClient();
      try { expect(await db.user.count({ where: { email } })).toBe(0); } finally { await db.$disconnect(); }
    } else {
      await expect(link).toBeVisible(); await link.click();
      await expect(page.getByRole('heading', { name: 'Create account', exact: true })).toBeVisible();
      await page.getByLabel('Full name', { exact: true }).fill('Public Signup');
      await page.getByLabel('Email address', { exact: true }).fill(email);
      await page.getByLabel('Organization name', { exact: true }).fill('Enabled registration');
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/signup-${disabled ? 'disabled' : 'enabled'}-${info.project.name}.png` });
  } finally { await cleanupAccount(email); }
});

test('disabled public signup preserves existing login and invitation-based account creation', async ({ page }, info) => {
  test.skip(process.env.TEST_DISABLE_SIGNUP !== 'true', 'Exercises the disabled startup configuration');
  const ownerEmail = uniqueEmail(); const invitedEmail = uniqueEmail();
  const db = new PrismaClient();
  try {
    // Existing-account fixture; the workflows below use the real UI and API.
    const owner = await db.user.create({ data: { email: ownerEmail, name: 'Existing Owner', passwordHash: await hashPassword(password), verified: true } });
    const org = await db.organization.create({ data: { name: 'Invitation-only workspace' } });
    await db.membership.create({ data: { userId: owner.id, orgId: org.id, role: 'owner' } });
    await page.goto('/login');
    await page.getByLabel('Email address', { exact: true }).fill(ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    const session = await (await page.request.get('/api/v1/auth/session')).json();
    expect(session.signupEnabled).toBe(false);
    const response = await page.request.post(`/api/v1/orgs/${org.id}/invitations`, { data: { email: invitedEmail, role: 'member', send: false }, headers: { Origin: 'http://web', 'X-CSRF-Token': session.csrf } });
    expect(response.status()).toBe(201); const invitation = await response.json();
    await mutate(page.request, 'logout', {});
    await page.goto(`/invitation${new URL(invitation.link).hash}`);
    await expect(page.getByRole('heading', { name: 'Join organization', exact: true })).toBeVisible();
    await page.getByLabel('Full name', { exact: true }).fill('Invited Member');
    await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(invitedEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    const joined = await (await page.request.get('/api/v1/auth/session')).json();
    expect(joined.signupEnabled).toBe(false);
    expect(joined.user.email).toBe(invitedEmail);
    expect(joined.memberships[0].org.id).toBe(org.id);
    await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/disabled-invitation-${info.project.name}.png` });
  } finally { await db.$disconnect(); await cleanupAccount(ownerEmail); await cleanupAccount(invitedEmail); }
});
