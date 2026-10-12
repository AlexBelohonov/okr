import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { uniqueEmail, password, newPassword, createAccount, cleanupAccount, mutate } from './accounts.fixture';

test.afterEach(async ({}, testInfo) => {
  for (const annotation of testInfo.annotations.filter(a => a.type === 'fixture-email')) if (annotation.description) await cleanupAccount(annotation.description);
});
function track(testInfo: { annotations: { type: string; description?: string }[] }) { const email = uniqueEmail(); testInfo.annotations.push({ type: 'fixture-email', description: email }); return email; }
async function settings(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
}
test('protected routes, signup, profile, password change, login and logout work', async ({ page }, testInfo) => {
  const email = track(testInfo); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/settings'); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const evidence = process.env.EVIDENCE_DIR || 'artifacts';
  await page.screenshot({ path: `${evidence}/login-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('link', { name: 'Create account', exact: false }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Browser Account');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Organization name', { exact: true }).fill('Review Organization');
  await page.getByRole('combobox', { name: 'Timezone', exact: true }).selectOption('America/Toronto');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.screenshot({ path: `${evidence}/signup-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  if (process.env.TEST_EMAIL_MODE === 'smtp') await expect(page.getByText('Email verification required.', { exact: true })).toBeVisible();
  await settings(page, testInfo.project.name === 'mobile');
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByText('Email unverified', { exact: true })).toBeVisible();
  await page.getByLabel('Full name', { exact: true }).fill('Updated Account');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  await page.screenshot({ path: `${evidence}/account-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto('/overview'); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('recovery and reset forms accept a single-use self-hosted link', async ({ page }, testInfo) => {
  const email = track(testInfo); await createAccount(page.request, email); await mutate(page.request, 'logout', {});
  await page.goto('/forgot-password');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Request recovery', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('If recovery is available');
  const db = new PrismaClient(); const token = randomBytes(32).toString('hex');
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await db.authToken.create({ data: { userId: user.id, type: 'reset', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 30 * 60000) } });
  } finally { await db.$disconnect(); }
  await page.goto(`/reset-password#token=${token}`);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password reset');
  await page.goto(`/reset-password#token=${token}`);
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('invalid, expired, or already used');
});
test('invitation signup joins the intended organization and rejects replay', async ({ page }, testInfo) => {
  const ownerEmail = track(testInfo); const inviteEmail = track(testInfo);
  await createAccount(page.request, ownerEmail);
  const account = await (await page.request.get('/api/v1/auth/session')).json();
  const token = randomBytes(32).toString('hex'); const db = new PrismaClient();
  try { await db.invitation.create({ data: { orgId: account.memberships[0].org.id, email: inviteEmail, role: 'member', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86400000) } }); }
  finally { await db.$disconnect(); }
  await mutate(page.request, 'logout', {});
  await page.goto(`/invitation#token=${token}`);
  await expect(page.getByRole('heading', { name: 'Join organization', exact: true })).toBeVisible();
  await page.getByLabel('Full name', { exact: true }).fill('Invited Reviewer');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(inviteEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await settings(page, testInfo.project.name === 'mobile'); await expect(page.getByText('Email verified', { exact: true })).toBeVisible();
  await page.goto(`/invitation#token=${token}`);
  await expect(page.getByRole('alert')).toContainText('invalid, expired, or already used');
});
test('SMTP worker delivers verification and reset emails through Mailpit', async ({ page, request }, testInfo) => {
  test.skip(process.env.TEST_EMAIL_MODE !== 'smtp', 'SMTP acceptance runs separately');
  const email = track(testInfo); await createAccount(page.request, email);
  const findMail = async (subject: string) => {
    const list = await request.get('http://mailpit:8025/api/v1/messages');
    const body = await list.json();
    return body.messages.find((m: { Subject: string; To: { Address: string }[] }) => m.Subject === subject && m.To.some(to => to.Address === email))?.ID as string | undefined;
  };
  let verificationId: string | undefined;
  await expect.poll(async () => { verificationId = await findMail('Verify your OKR Workspace email'); return Boolean(verificationId); }, { timeout: 20000 }).toBeTruthy();
  const verification = await (await request.get(`http://mailpit:8025/api/v1/message/${verificationId}`)).json();
  const token = verification.Text.match(/#token=([a-f0-9]{64})/)[1];
  await page.goto(`/verify-email#token=${token}`); await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Email verified');
  await page.goto('/settings'); await expect(page.getByText('Email verified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto('/forgot-password'); await page.getByLabel('Email address', { exact: true }).fill(email); await page.getByRole('button', { name: 'Request recovery', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('If recovery is available');
  let resetId: string | undefined;
  await expect.poll(async () => { resetId = await findMail('Reset your OKR Workspace password'); return Boolean(resetId); }, { timeout: 20000 }).toBeTruthy();
  const reset = await (await request.get(`http://mailpit:8025/api/v1/message/${resetId}`)).json();
  const resetToken = reset.Text.match(/#token=([a-f0-9]{64})/)[1];
  await page.goto(`/reset-password#token=${resetToken}`);
  await page.getByLabel('New password', { exact: true }).fill(newPassword); await page.getByLabel('Confirm password', { exact: true }).fill(newPassword); await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password reset');
});
