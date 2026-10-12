import { test, expect } from '@playwright/test';
import { createAccount, cleanupAccount, uniqueEmail, mutate, password } from './accounts.fixture';

test.beforeEach(async ({ page }, testInfo) => {
  const email = uniqueEmail();
  testInfo.annotations.push({ type: 'fixture-email', description: email });
  await createAccount(page.request, email);
});
test.afterEach(async ({}, testInfo) => {
  const email = testInfo.annotations.find(a => a.type === 'fixture-email')?.description;
  if (email) await cleanupAccount(email);
});

test('workspace shell renders real connectivity and navigates to settings', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const readiness = await request.get('/api/v1/ready');
  expect(readiness.ok()).toBeTruthy();
  expect((await readiness.json()).database).toBe('connected');
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('All systems connected')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No objectives', exact: true })).toBeVisible();
  const evidence = process.env.EVIDENCE_DIR || 'artifacts';
  await page.screenshot({ path: `${evidence}/overview-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('PostgreSQL', { exact: true })).toBeVisible();
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/settings-${testInfo.project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('connection errors recover through retry without replacing the real API', async ({ page, context }, testInfo) => {
  await page.goto('/overview');
  await expect(page.getByText('All systems connected')).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Refresh connection' }).click();
  await expect(page.getByRole('alert')).toContainText('Workspace connection unavailable');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Online', { exact: true })).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Retry', exact: false }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
});

test('unknown deep links show a recoverable not-found view', async ({ page }) => {
  await page.goto('/not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to overview' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});

test('keyboard navigation manages mobile focus, route titles and skip-to-content', async ({ page }, info) => {
  await page.goto('/overview'); await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#main-content')).toBeFocused();
  if (info.project.name === 'mobile') {
    const opener = page.getByRole('button', { name: 'Open navigation', exact: true });
    await opener.focus(); await page.keyboard.press('Enter');
    const nav = page.getByRole('dialog', { name: 'Workspace navigation', exact: true }); await expect(nav).toBeVisible();
    const close = nav.getByRole('button', { name: 'Close navigation', exact: true }); await expect(close).toBeFocused();
    await expect(nav.getByRole('link', { name: /^Notifications/ })).toBeVisible(); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/ch08-navigation-mobile.png` });
    await page.keyboard.press('Shift+Tab'); await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.keyboard.press('Escape'); await expect(nav).toHaveCount(0); await expect(opener).toBeFocused();
    await opener.press('Enter'); await nav.getByRole('link', { name: 'All objectives', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'All objectives', exact: true })).toBeVisible(); await expect(nav).toHaveCount(0); await expect(page.locator('#main-content')).toBeFocused();
    await opener.click(); await page.setViewportSize({ width: 1024, height: 768 }); await expect(nav).toHaveCount(0);
  }
  await page.getByRole('link', { name: 'Settings', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible(); await expect(page.locator('#main-content')).toBeFocused();
  await expect(page).toHaveTitle('Settings · Review Organization'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('OpenAPI UI loads through the proxy', async ({ page }) => {
  await page.goto('/api/docs/');
  await expect(page.getByRole('heading', { name: 'OKR Workspace API' })).toBeVisible();
  await expect(page.getByText('/api/v1/health', { exact: true }).first()).toBeVisible();
});

test('CH08 protected deep links retain query and hash through sign-in', async ({ page }, info) => {
  const email = info.annotations.find(a => a.type === 'fixture-email')!.description!;
  expect((await mutate(page.request, 'logout', {})).status()).toBe(200);
  await page.goto('/objectives?health=at_risk&scope=team&sort=title&direction=asc#main-content'); await expect(page).toHaveTitle('Sign in · OKR Workspace');
  await page.getByLabel('Email address', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/objectives\?health=at_risk&scope=team&sort=title&direction=asc#main-content$/); await expect(page.getByLabel('Health filter')).toHaveValue('at_risk'); await expect(page.getByLabel('Scope filter')).toHaveValue('team'); await expect(page.getByRole('heading', { name: 'No objectives match', exact: true })).toBeVisible();
});
