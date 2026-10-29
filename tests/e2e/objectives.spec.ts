import { test as base, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createAccount, password, uniqueEmail } from './accounts.fixture';

type Member = { id: string; email: string };
const test = base.extend<{ objectives: { orgId: string; leadId: string; member: (role: string, name: string) => Promise<Member>; create: (fields?: Record<string, unknown>) => Promise<any>; metric: (objective: any, fields?: Record<string, unknown>) => Promise<any> } }>({
  objectives: async ({ page }, use) => {
    const db = new PrismaClient(); const email = uniqueEmail(); const emails = [email]; const orgs: string[] = [];
    try {
      await createAccount(page.request, email); const session = await (await page.request.get('/api/v1/auth/session')).json(); const orgId = session.memberships[0].org.id; const leadId = session.memberships[0].id; orgs.push(orgId);
      const owner = await db.user.update({ where: { email }, data: { verified: true } });
      const create = async (fields: Record<string, unknown> = {}) => { const result = await mutation(page, `orgs/${orgId}/objectives`, { title: 'Browser objective', leadId, startDate: '2026-01-01', endDate: '2026-03-31', ...fields }); expect(result.status(), await result.text()).toBe(201); return result.json(); };
      const metric = async (objective: any, fields: Record<string, unknown> = {}) => { const result = await mutation(page, `orgs/${orgId}/objectives/${objective.id}/key-results`, { title: 'Browser metric', type: 'number', baseline: 0, target: 100, current: 50, weight: 1, objectiveVersion: objective.version, ...fields }); expect(result.status(), await result.text()).toBe(201); return result.json(); };
      await use({ orgId, leadId, create, metric, member: async (role, name) => { const address = uniqueEmail(); emails.push(address); const user = await db.user.create({ data: { email: address, name, passwordHash: owner.passwordHash, verified: true } }); const member = await db.membership.create({ data: { orgId, userId: user.id, role } }); return { id: member.id, email: address }; } });
    } finally {
      const ids = (await db.user.findMany({ where: { email: { in: emails } } })).map(u => u.id);
      await db.emailOutbox.deleteMany({ where: { to: { in: emails } } }); await db.auditEvent.deleteMany({ where: { OR: [{ orgId: { in: orgs } }, { userId: { in: ids } }] } });
      await db.notification.deleteMany({ where: { orgId: { in: orgs } } }); await db.checkIn.deleteMany({ where: { orgId: { in: orgs } } }); await db.comment.deleteMany({ where: { orgId: { in: orgs } } });
      await db.objectiveLink.deleteMany({ where: { orgId: { in: orgs } } }); await db.objective.deleteMany({ where: { orgId: { in: orgs } } }); await db.organization.deleteMany({ where: { id: { in: orgs } } }); await db.membership.deleteMany({ where: { userId: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
    }
  }
});
async function mutation(page: Page, path: string, data: unknown, method = 'POST') {
  const session = await (await page.request.get('/api/v1/auth/session')).json(); return page.request.fetch(`/api/v1/${path}`, { method, data, headers: { Origin: 'http://web', 'X-CSRF-Token': session.csrf } });
}
async function login(page: Page, email: string) {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  if (session.user) expect((await mutation(page, 'auth/logout', {})).status()).toBe(200);
  await page.goto('/login'); await page.getByLabel('Email address', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}

test('review filters on members and notifications collapse without clearing real results', async ({ page, objectives }) => {
  const member = await objectives.member('member', 'Compact Reviewer');
  await objectives.create({ title: 'Compact assigned outcome', leadId: member.id });
  await page.goto('/members');
  await expect(page.getByLabel('Search members')).toBeHidden();
  await page.getByRole('button', { name: 'Show filters', exact: true }).press('Enter');
  await page.getByLabel('Search members').fill('Compact Reviewer');
  await expect(page.locator('.member-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
  await expect(page.getByLabel('Search members')).toBeHidden();
  await expect(page).toHaveURL(/search=Compact/);
  await expect(page.locator('.member-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show filters', exact: true }).click();
  await expect(page.getByLabel('Search members')).toHaveValue('Compact Reviewer');
  await page.reload(); await expect(page.getByLabel('Search members')).toHaveValue('Compact Reviewer');
  await login(page, member.email); await page.goto('/notifications');
  await expect(page.locator('.collaboration-list > li')).toHaveCount(1);
  await expect(page.getByLabel('Unread only')).toBeHidden();
  await page.getByRole('button', { name: 'Show filters', exact: true }).click();
  await page.getByLabel('Unread only').check();
  await expect(page).toHaveURL(/unread=true/);
  await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
  await expect(page.getByLabel('Unread only')).toBeHidden();
  await expect(page.locator('.collaboration-list > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show filters', exact: true }).click();
  await expect(page.getByLabel('Unread only')).toBeChecked();
  await page.reload(); await expect(page.getByLabel('Unread only')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('review graph cards are compact with icon scopes and dates available in details', async ({ page, objectives }, info) => {
  const title = 'A long objective title that remains available in details after exceeding the single visible title line';
  const personal = await objectives.create({ title });
  const company = await objectives.create({ title: 'Company outcome', scope: 'company' });
  await objectives.metric(company, { current: 99 });
  await apiLink(page, objectives.orgId, company.id, personal.id);
  await apiLink(page, objectives.orgId, company.id, personal.id, 'dependency');
  for (const type of ['alignment', 'dependency']) {
    await page.goto(`/alignment?type=${type}`);
    await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
    const node = page.getByLabel(`Objective ${title}`, { exact: true });
    await expect(node).toBeInViewport();
    const guide = page.getByText('How to read relationships', { exact: true });
    await guide.click(); await expect(page.locator('.graph-guide p')).toBeVisible();
    await guide.click(); await expect(page.locator('.graph-guide p')).toBeHidden();
    await expect(node.getByRole('img', { name: 'Personal objective', exact: true })).toBeVisible();
    await expect(node).not.toContainText('2026-01-01');
    await expect(node).not.toContainText('2026-03-31');
    await expect(node).not.toContainText('Personal objective');
    await expect(node).toHaveCSS('width', '253px');
    await expect(node).toHaveCSS('height', '80px');
    await expect(page.getByLabel('Objective Company outcome', { exact: true })).toHaveCSS('height', '80px');
    await expect(node.locator('.graph-node > *')).toHaveCount(3);
    await expect(node.locator('.graph-node-status')).toHaveCSS('justify-content', 'flex-end');
    await expect(node.getByRole('img', { name: 'Unfinished prerequisites', exact: true })).toHaveAttribute('title', 'Unfinished prerequisites');
    await expect(node.locator('.graph-node-title strong')).toHaveAttribute('title', title);
    expect(await node.locator('.graph-node-title strong').evaluate(el => el.clientHeight === 18 && el.scrollWidth > el.clientWidth)).toBeTruthy();
    await expect(page.getByLabel('Objective Company outcome', { exact: true }).getByRole('img', { name: 'Company objective', exact: true })).toBeVisible();
    expect(await page.locator('.graph-canvas').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(info.project.name === 'desktop' ? 600 : 480);
    expect(await node.locator('.graph-node').evaluate(el => Math.abs(el.scrollHeight - el.closest('.react-flow__node')!.clientHeight) <= 1)).toBeTruthy();
    await node.focus(); await node.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Objective details', exact: true });
    await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(panel.locator('.objective-detail-meta')).toContainText('2026-01-01');
    await expect(panel.locator('.objective-detail-meta')).toContainText('2026-03-31');
    await page.keyboard.press('Escape'); await expect(node).toBeFocused();
    const companyNode = page.getByLabel('Objective Company outcome', { exact: true });
    await expect(companyNode).toContainText('99%');
    const initialColor = await companyNode.evaluate(el => getComputedStyle(el).backgroundColor);
    for (const current of [100, 99]) {
      await companyNode.click();
      await panel.getByLabel('Update current value').fill(String(current));
      await panel.getByRole('button', { name: 'Update metric', exact: true }).click();
      await expect(panel.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', String(current));
      await page.keyboard.press('Escape');
      await expect(companyNode).toContainText(`${current}%`);
      if (current === 100) {
        await expect(companyNode.locator('.graph-node-status')).toContainText('100% · Achieved');
        expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives/${company.id}`)).json()).state).toBe('active');
        await expect(companyNode).not.toHaveCSS('background-color', initialColor);
        await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/r008-compact-${type}-${info.project.name}.png` });
      } else await expect(companyNode).toHaveCSS('background-color', initialColor);
    }
    await page.getByRole('button', { name: 'Show filters', exact: true }).click();
    await page.getByLabel('Search graph objectives').fill('A long objective title');
    const outside = node.getByRole('img', { name: '1 connected objective(s) outside filters', exact: true });
    await expect(outside).toHaveAttribute('title', '1 connected objective(s) outside filters');
    await expect(node.getByRole('img', { name: 'Unfinished prerequisites', exact: true })).toBeVisible();
    await expect(node.locator('.graph-node > *')).toHaveCount(3);
    await expect(node).toHaveCSS('height', '80px');
    expect(await node.locator('.graph-node').evaluate(el => Math.abs(el.scrollHeight - el.closest('.react-flow__node')!.clientHeight) <= 1)).toBeTruthy();
    await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/r008-three-row-warnings-${type}-${info.project.name}.png` });
  }
  await page.goto('/objectives');
  const row = page.locator('.objective-row').filter({ has: page.getByRole('link', { name: title, exact: true }) });
  await expect(row.getByRole('img', { name: 'Personal objective', exact: true })).toBeVisible();
  await expect(row).not.toContainText('2026-01-01');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('alignment collapse preserves card positions in independent single-parent branches', async ({ page, objectives }, info) => {
  const first = await objectives.create({ title: 'Main strategy one' });
  const second = await objectives.create({ title: 'Main strategy two' });
  const shared = await objectives.create({ title: 'Shared delivery branch' });
  const leaf = await objectives.create({ title: 'Nested delivery leaf' });
  await apiLink(page, objectives.orgId, first.id, shared.id);
  await apiLink(page, objectives.orgId, first.id, second.id);
  await apiLink(page, objectives.orgId, shared.id, leaf.id);
  await apiLink(page, objectives.orgId, first.id, shared.id, 'dependency');
  await page.goto('/alignment');
  const node = (name: string) => page.getByLabel(`Objective ${name}`, { exact: true });
  await expect(page.getByRole('img', { name: 'Main objective', exact: true })).toHaveCount(0);
  const edges = page.locator('.react-flow__edge-path'); await expect(edges).toHaveCount(3);
  for (const edge of await edges.all()) expect(await edge.getAttribute('marker-end')).toBeFalsy();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click(); await expect(node(leaf.title)).toBeInViewport();
  const titles = [first.title, second.title, shared.title, leaf.title];
  const withinCanvas = async (name: string) => {
    const card = (await node(name).boundingBox())!; const canvas = (await page.locator('.graph-canvas').boundingBox())!;
    return { x: card.x - canvas.x, y: card.y - canvas.y, width: card.width, height: card.height };
  };
  const initial = new Map(await Promise.all(titles.map(async title => [title, await withinCanvas(title)] as const)));
  const expectFixed = async (names: string[]) => {
    for (const name of names) await expect(async () => {
      const actual = await withinCanvas(name); const original = initial.get(name)!;
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[key] - original[key])).toBeLessThanOrEqual(0.5);
    }).toPass({ timeout: 5000 });
  };
  const firstToggle = node(first.title).getByRole('button', { name: `Collapse children of ${first.title}`, exact: true });
  await firstToggle.focus(); await firstToggle.press('Enter');
  await expect(node(first.title).getByRole('button', { name: `Expand children of ${first.title}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('dialog', { name: 'Objective details', exact: true })).toHaveCount(0);
  await expect(node(shared.title)).toHaveCount(0); await expect(node(leaf.title)).toHaveCount(0); await expect(edges).toHaveCount(0);
  await expectFixed([first.title]);
  await node(first.title).getByRole('button', { name: `Expand children of ${first.title}`, exact: true }).click();
  await node(shared.title).getByRole('button', { name: `Collapse children of ${shared.title}`, exact: true }).press('Space');
  await expect(node(leaf.title)).toHaveCount(0); await expect(node(shared.title)).toBeVisible();
  await expectFixed([first.title, second.title, shared.title]);
  await node(first.title).getByRole('button', { name: `Collapse children of ${first.title}`, exact: true }).click();
  await expect(node(shared.title)).toHaveCount(0); await expect(node(leaf.title)).toHaveCount(0); await expect(edges).toHaveCount(0);
  await expect(page.getByText('1 of 4 objectives visible', { exact: true })).toBeVisible();
  await expectFixed([first.title]);
  await node(first.title).getByRole('button', { name: `Expand children of ${first.title}`, exact: true }).click();
  await expect(node(shared.title)).toBeVisible(); await expect(node(leaf.title)).toHaveCount(0);
  await expectFixed([first.title, second.title, shared.title]);
  await page.getByRole('button', { name: 'Expand all children', exact: true }).click(); await expect(node(leaf.title)).toBeVisible();
  await expectFixed(titles);
  await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/r008-stable-expanded-${info.project.name}.png` });
  await node(first.title).getByRole('button', { name: `Collapse children of ${first.title}`, exact: true }).click();
  await expect(node(shared.title)).toHaveCount(0); await expectFixed([first.title]);
  await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/r008-stable-collapsed-${info.project.name}.png` });
  await page.reload(); await expect(node(shared.title)).toHaveCount(0);
  await node(first.title).getByRole('button', { name: `Expand children of ${first.title}`, exact: true }).click();
  await expect(node(shared.title)).toBeVisible(); await expect(node(leaf.title)).toBeVisible();
  await expect(node(leaf.title)).toBeVisible(); await expect(edges).toHaveCount(3);
  await page.getByRole('button', { name: 'Show filters', exact: true }).click();
  await page.getByLabel('Search graph objectives').fill(shared.title);
  await expect(page).toHaveURL(url => url.searchParams.get('search') === shared.title);
  await expect(page.getByText('1 unique objectives · 0 visible relationships', { exact: true })).toBeVisible();
  await expect(edges).toHaveCount(0);
  await expect(node(shared.title)).toBeVisible(); await expect(node(shared.title).getByRole('img', { name: 'Main objective', exact: true })).toHaveCount(0);
  await page.getByLabel('Search graph objectives').fill('');
  await expect(page).toHaveURL(url => !url.searchParams.has('search'));
  await expect(page.getByLabel('Search graph objectives')).toHaveValue('');
  await expect(page.getByText('4 unique objectives · 3 visible relationships', { exact: true })).toBeVisible();
  await expect(edges).toHaveCount(3);
  await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/r008-branches-${info.project.name}.png` });
  await page.getByLabel('Graph type').selectOption('dependency'); await expect(edges).toHaveCount(1);
  expect(await edges.first().getAttribute('marker-end')).toBeTruthy();
  await expect(page.locator('.graph-collapse')).toHaveCount(0); await expect(page.getByRole('img', { name: 'Main objective', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('graph cards show achieved separately from completion, health icons and stable team colors', async ({ page, objectives }, info) => {
  const team = await (await mutation(page, `orgs/${objectives.orgId}/teams`, { name: 'Graph delivery team' })).json();
  const otherTeam = await (await mutation(page, `orgs/${objectives.orgId}/teams`, { name: 'Graph operations team' })).json();
  const goal = await objectives.create({ title: 'Team graph outcome', scope: 'team', teamId: team.id, health: 'on_track' });
  const risk = await objectives.create({ title: 'Team graph risk', scope: 'team', teamId: team.id, health: 'at_risk' });
  const off = await objectives.create({ title: 'Other team graph delay', scope: 'team', teamId: otherTeam.id, health: 'off_track' });
  await apiLink(page, objectives.orgId, goal.id, risk.id); await objectives.metric(await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives/${goal.id}`)).json(), { current: 100 });
  const node = (name: string) => page.getByLabel(`Objective ${name}`, { exact: true });
  let teamHue = '';
  for (const type of ['alignment', 'dependency']) {
    await page.goto(`/alignment?type=${type}`);
    await expect(node(goal.title).locator('.graph-node-status')).toContainText('100% · Achieved');
    await expect(node(goal.title).getByRole('img', { name: 'On track', exact: true })).toHaveAttribute('title', 'On track');
    await expect(node(risk.title).getByRole('img', { name: 'At risk', exact: true })).toBeVisible();
    await expect(node(off.title).getByRole('img', { name: 'Off track', exact: true })).toBeVisible();
    for (const [title, label, color] of [[goal.title, 'On track', 'rgb(22, 118, 83)'], [risk.title, 'At risk', 'rgb(156, 105, 12)'], [off.title, 'Off track', 'rgb(179, 56, 67)']]) {
      const health = node(title).getByRole('img', { name: label, exact: true });
      await expect(health.locator('svg')).toHaveCount(0);
      await expect(health.locator('.objective-health-dot')).toHaveCSS('border-radius', '50%');
      await expect(health.locator('.objective-health-dot')).toHaveCSS('background-color', color);
    }
    const hue = await node(goal.title).evaluate(el => (el as HTMLElement).style.getPropertyValue('--team-hue'));
    expect(hue).not.toBe(''); if (teamHue) expect(hue).toBe(teamHue); teamHue = hue;
    expect(await node(risk.title).evaluate(el => (el as HTMLElement).style.getPropertyValue('--team-hue'))).toBe(teamHue);
    expect(await node(off.title).evaluate(el => (el as HTMLElement).style.getPropertyValue('--team-hue'))).not.toBe(teamHue);
    await node(goal.title).click();
    const panel = page.getByRole('dialog', { name: 'Objective details', exact: true });
    await panel.getByRole('combobox', { name: 'New lifecycle', exact: true }).selectOption('completed');
    await panel.getByLabel('Closing note', { exact: true }).fill('Outcome explicitly reviewed and completed.');
    await panel.getByRole('button', { name: 'Apply lifecycle', exact: true }).click();
    await expect(panel.locator('.objective-detail-meta')).toContainText('completed');
    await page.keyboard.press('Escape');
    await expect(node(goal.title).locator('.graph-node-status')).toContainText('100% · Completed');
    await expect(node(goal.title)).toHaveCSS('height', '80px');
    await expect(node(goal.title).locator('.graph-node > *')).toHaveCount(3);
    await page.reload(); await expect(node(goal.title).locator('.graph-node-status')).toContainText('100% · Completed');
    expect(await node(goal.title).evaluate(el => (el as HTMLElement).style.getPropertyValue('--team-hue'))).toBe(teamHue);
    await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/r008-status-team-${type}-${info.project.name}.png` });
    await node(goal.title).click(); await panel.getByRole('combobox', { name: 'New lifecycle', exact: true }).selectOption('active');
    await panel.getByRole('button', { name: 'Apply lifecycle', exact: true }).click(); await expect(panel.locator('.objective-detail-meta')).toContainText('active');
    await page.keyboard.press('Escape'); await expect(node(goal.title).locator('.graph-node-status')).toContainText('100% · Achieved');
  }
  await page.goto('/objectives');
  const row = page.locator('.objective-row').filter({ has: page.getByRole('link', { name: goal.title, exact: true }) });
  await expect(row.getByRole('img', { name: 'On track', exact: true })).toBeVisible();
  expect(await row.evaluate(el => (el as HTMLElement).style.getPropertyValue('--team-hue'))).toBe(teamHue);
  await page.goto('/teams');
  const teamCard = page.locator('.team-card').filter({ has: page.getByRole('heading', { name: team.name, exact: true }) });
  expect(await teamCard.evaluate(el => (el as HTMLElement).style.getPropertyValue('--team-hue'))).toBe(teamHue);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('CH08 explorer filters, sorting, page size and result return survive reload against the real API', async ({ page, objectives }, info) => {
  for (let n = 1; n <= 12; n++) await objectives.create({ title: `Portfolio ${String(n).padStart(2, '0')}`, health: 'at_risk', state: n === 12 ? 'draft' : 'active' });
  await objectives.create({ title: 'Portfolio company', scope: 'company', health: 'at_risk' });
  await objectives.create({ title: 'Portfolio healthy', health: 'on_track' });
  await page.goto('/objectives?search=Portfolio&health=at_risk&state=active&scope=personal&sort=title&direction=asc&limit=10');
  const rows = page.locator('.objective-list .objective-title');
  await expect(rows).toHaveText(Array.from({ length: 10 }, (_, i) => `Portfolio ${String(i + 1).padStart(2, '0')}`));
  await expect(page.getByText('11 matching objectives · 4 filters', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click(); await expect(rows).toHaveText(['Portfolio 11']);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled(); await page.reload(); await expect(rows).toHaveText(['Portfolio 11']);
  const resultsUrl = page.url(); await rows.first().click(); await page.getByRole('navigation', { name: 'Jump to objective section' }).getByRole('link', { name: 'History', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[id$="-history"]')).toBeFocused(); await expect(page.getByRole('heading', { name: 'Change history', exact: true })).toBeInViewport();
  await page.reload(); await page.getByRole('link', { name: 'Back to results', exact: true }).click(); await expect(page).toHaveURL(resultsUrl); await expect(rows).toHaveText(['Portfolio 11']);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await expect(rows).toHaveCount(10); await expect(page.getByText('14 matching objectives · 0 filters', { exact: true })).toBeVisible(); await expect(page.getByLabel('Objectives per page')).toHaveValue('10'); await expect(page.getByLabel('Sort objectives')).toHaveValue('title');
  await page.getByLabel('Sort direction').selectOption('desc'); await expect(rows.first()).toHaveText('Portfolio healthy');
  await page.getByLabel('Search objectives').fill('Missing outcome'); await expect(page.getByRole('heading', { name: 'No objectives match', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await page.getByLabel('Objectives per page').selectOption('25'); await expect(rows).toHaveCount(14);
  await page.getByRole('button', { name: 'Hide filters', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page.getByLabel('Search objectives')).toBeHidden(); await expect(rows).toHaveCount(14); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/ch08-explorer-${info.project.name}.png` }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await expect(page.getByLabel('Sort direction')).toHaveValue('desc');
  await page.goto('/objectives?page=999'); await expect(page.getByRole('heading', { name: 'This page has no objectives', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Go to first page', exact: true }).click(); await expect(rows).toHaveCount(14);
});

test('CH08 team links, combined period/lead/date filters and detail sections keep real work connected', async ({ page, objectives }, info) => {
  const teamResponse = await mutation(page, `orgs/${objectives.orgId}/teams`, { name: 'Frontend delivery' }); expect(teamResponse.status()).toBe(201); const team = await teamResponse.json();
  const periodResponse = await mutation(page, `orgs/${objectives.orgId}/periods`, { kind: 'custom', name: 'Delivery plan', startDate: '2026-01-01', endDate: '2026-03-31' }); expect(periodResponse.status()).toBe(201); const period = await periodResponse.json();
  const objective = await objectives.create({ title: 'Team launch', scope: 'team', teamId: team.id, periodId: period.id }); await objectives.metric(objective, { title: 'Adoption', current: 35 }); await objectives.create({ title: 'Outside team' });
  await page.goto('/teams'); const card = page.locator('.team-card').filter({ has: page.getByRole('heading', { name: 'Frontend delivery', exact: true }) });
  await card.getByRole('link', { name: 'View team objectives', exact: true }).click(); await expect(page.locator('.objective-list .objective-title')).toHaveText(['Team launch']);
  await page.getByLabel('Planning period').selectOption(period.id); await page.getByRole('button', { name: 'Filter by lead', exact: true }).click(); await page.getByRole('button', { name: /Browser Reviewer.*owner/ }).click();
  await page.getByLabel('From date').fill('2026-03-31'); await page.getByLabel('To date').fill('2026-03-31'); await page.reload(); await expect(page.locator('.objective-list .objective-title')).toHaveText(['Team launch']);
  await page.getByRole('link', { name: 'Team launch', exact: true }).click(); const jumps = page.getByRole('navigation', { name: 'Jump to objective section', exact: true });
  for (const [label, name] of [['Key results', 'metrics'], ['Relationships', 'relationships'], ['Check-ins and comments', 'collaboration'], ['Ownership', 'ownership'], ['Lifecycle', 'lifecycle'], ['History', 'history']]) { await jumps.getByRole('link', { name: label, exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page.locator(`[id$="-${name}"]`)).toBeFocused(); }
  await jumps.getByRole('link', { name: 'Key results', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Check-ins', exact: true })).toBeVisible(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/ch08-detail-${info.project.name}.png` });
  await page.goto('/teams'); await card.getByRole('link', { name: 'View team alignment', exact: true }).click(); await expect(page.getByLabel('Graph team')).toHaveValue(team.id); await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('region', { name: 'Graph list alternative', exact: true }).getByRole('button', { name: 'Team launch', exact: true }).click(); const panel = page.getByRole('dialog', { name: 'Objective details', exact: true });
  await panel.getByRole('navigation', { name: 'Jump to objective section', exact: true }).getByRole('link', { name: 'Key results', exact: true }).click(); await expect(panel.locator('[id$="-metrics"]')).toBeFocused(); await expect(panel.getByRole('heading', { name: 'Adoption', exact: true })).toBeInViewport();
  await panel.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/ch08-panel-${info.project.name}.png` }); await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('CH08 dashboard lifecycle and health shortcuts reflect unique server aggregates', async ({ page, objectives }, info) => {
  await objectives.metric(await objectives.create({ title: 'Active on track' }), { current: 80 }); await objectives.create({ title: 'Active at risk', health: 'at_risk' }); await objectives.create({ title: 'Draft plan', state: 'draft' });
  const completed = await objectives.create({ title: 'Completed outcome' }); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${completed.id}/lifecycle`, { state: 'completed', note: 'Delivered', version: completed.version })).status()).toBe(200);
  await page.goto('/overview'); const summary = page.getByRole('navigation', { name: 'Objective lifecycle summaries', exact: true });
  await expect(summary.getByRole('link', { name: 'active 2', exact: true })).toBeVisible(); await expect(summary.getByRole('link', { name: 'draft 1', exact: true })).toBeVisible(); await expect(summary.getByRole('link', { name: 'completed 1', exact: true })).toBeVisible();
  const data = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objective-summary`)).json(); expect(data.total).toBe(4); expect(data.averageProgress).toBe(40); expect(data.onTrack).toBe(1);
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/ch08-dashboard-${info.project.name}.png`, fullPage: true });
  await summary.getByRole('link', { name: 'View active on track', exact: true }).click(); await expect(page.locator('.objective-list .objective-title')).toHaveText(['Active on track']);
  await page.goto('/overview'); await summary.getByRole('link', { name: 'completed 1', exact: true }).click(); await expect(page.locator('.objective-list .objective-title')).toHaveText(['Completed outcome']); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('CH08 collaboration and directory pagination retain deep-link state on reload', async ({ page, objectives }, info) => {
  const viewer = await objectives.member('viewer', 'Frontend Viewer'); const o = await objectives.create({ title: 'Notification pagination', assignments: [{ membershipId: viewer.id, role: 'follower' }] });
  for (let n = 1; n <= 26; n++) expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${o.id}/comments`, { text: `Frontend comment ${String(n).padStart(2, '0')}` })).status()).toBe(201);
  await login(page, viewer.email); await page.goto('/notifications?unread=true&page=2'); const items = page.locator('.collaboration-list > li'); await expect(items).toHaveCount(2); await expect(page.getByLabel('Unread only')).toBeChecked();
  await page.reload(); await expect(items).toHaveCount(2); await items.first().getByRole('button', { name: 'Mark read', exact: true }).click(); await expect(items).toHaveCount(1); await expect(page).toHaveURL(/unread=true&page=2/);
  await page.getByRole('button', { name: 'Previous', exact: true }).click(); await expect(items).toHaveCount(25); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/ch08-notifications-${info.project.name}.png`, fullPage: true });
  await page.goto('/activity?page=2'); await expect(page.locator('.activity-list > li')).toHaveCount(2); await page.reload(); await expect(page.locator('.activity-list > li')).toHaveCount(2); await page.getByRole('button', { name: 'Previous', exact: true }).click(); await expect(page.locator('.activity-list > li')).toHaveCount(25);
  await page.goto('/notifications?unread=true&page=2'); await page.getByLabel('Unread only', { exact: true }).uncheck(); await expect(page).toHaveURL(/\/notifications$/); await expect(items).toHaveCount(25); await page.getByLabel('Unread only', { exact: true }).check(); await expect(page).toHaveURL(/\/notifications\?unread=true$/); await expect(items).toHaveCount(25);
  await page.goto('/members?search=Frontend'); await expect(page.locator('.member-card')).toHaveCount(1); await expect(page.getByLabel('Search members')).toHaveValue('Frontend'); await page.reload(); await expect(page.locator('.member-card')).toHaveCount(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('CH08 suspended membership shows recovery states without loading indefinitely or exposing content', async ({ page, objectives, browser }) => {
  const viewer = await objectives.member('viewer', 'Offboarded Viewer'); const context = await browser.newContext({ viewport: page.viewportSize()! }); const reader = await context.newPage();
  try {
    await login(reader, viewer.email); const directory = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/members`)).json(); const member = directory.items.find((m: any) => m.id === viewer.id);
    expect((await mutation(page, `orgs/${objectives.orgId}/members/${viewer.id}`, { role: 'viewer', active: false, version: member.version }, 'PATCH')).status()).toBe(200);
    await reader.goto('/notifications'); await expect(reader.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible(); await expect(reader.getByText('Select or create an organization to view notifications.', { exact: true })).toBeVisible(); await expect(reader.getByText('Loading…', { exact: true })).toHaveCount(0);
    await reader.goto('/activity'); await expect(reader.getByText('Select or create an organization to view activity.', { exact: true })).toBeVisible(); await expect(reader.getByText('Loading…', { exact: true })).toHaveCount(0);
    expect((await reader.request.get(`/api/v1/orgs/${objectives.orgId}/notifications`)).status()).toBe(404); await reader.goto('/organization'); await expect(reader.getByRole('heading', { name: 'Create another organization', exact: true })).toBeVisible(); expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally { await context.close(); }
});

test('check-ins persist metrics, health, immutable corrections and progress history through full page and graph panel', async ({ page, objectives }, info) => {
  const person = await objectives.member('member', 'Check-in Contributor'); let o = await objectives.create({ title: 'Collaborative outcome', assignments: [{ membershipId: person.id, role: 'contributor' }] }); o = await objectives.metric(o, { title: 'Customer adoption', current: 10 });
  await login(page, person.email); await page.goto(`/objectives/${o.id}`); const checks = page.getByRole('region', { name: 'Check-ins', exact: true });
  await expect(page.getByRole('button', { name: 'Edit objective', exact: true })).toHaveCount(0); await checks.getByRole('button', { name: 'New check-in', exact: true }).click();
  await checks.getByLabel('Check-in note', { exact: true }).fill('Pilot is progressing, with a training blocker.'); await checks.getByLabel('Check-in health', { exact: true }).selectOption('at_risk'); await checks.getByLabel('Check-in value: Customer adoption', { exact: true }).fill('60'); await checks.getByRole('button', { name: 'Post check-in', exact: true }).click();
  await expect(checks.getByText('Pilot is progressing, with a training blocker.', { exact: true })).toBeVisible(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '60'); await expect(checks.getByRole('img', { name: /Check-in progress chart/ })).toBeVisible();
  const saved = await getObjective(page, objectives.orgId, o.id); expect(saved.health).toBe('at_risk'); expect(saved.keyResults[0].current).toBe(60);
  await checks.getByText('Metric snapshot', { exact: true }).click(); await expect(checks.getByText('Customer adoption: 10 → 60', { exact: true })).toBeVisible();
  await checks.getByRole('button', { name: 'New check-in', exact: true }).click(); await checks.getByLabel('Check-in note', { exact: true }).fill('Training resolved; correction recorded as another entry.'); await checks.getByLabel('Check-in value: Customer adoption', { exact: true }).fill('70'); await checks.getByRole('button', { name: 'Post check-in', exact: true }).click();
  await expect(checks.getByText('Training resolved; correction recorded as another entry.', { exact: true })).toBeVisible(); await expect(checks.getByText('Pilot is progressing, with a training blocker.', { exact: true })).toBeVisible(); await expect(checks.getByText('60%', { exact: true })).toBeVisible();
  await checks.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/check-ins-${info.project.name}.png` }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.goto('/activity'); await expect(page.getByText('Pilot is progressing, with a training blocker.', { exact: true })).toBeVisible(); await page.goto('/overview'); await expect(page.getByText('Training resolved; correction recorded as another entry.', { exact: true })).toBeVisible();
  await page.goto('/alignment'); await page.getByRole('region', { name: 'Graph list alternative' }).getByRole('button', { name: 'Collaborative outcome', exact: true }).first().click(); const panel = page.getByRole('dialog', { name: 'Objective details', exact: true }); await expect(panel.getByRole('region', { name: 'Check-ins', exact: true }).getByText('Training resolved; correction recorded as another entry.', { exact: true })).toBeVisible();
});

test('comments notify followers, support unread states and mute preferences, and remain readable after archive', async ({ page, objectives, browser }, info) => {
  const viewer = await objectives.member('viewer', 'Collaboration Viewer'); const o = await objectives.create({ title: 'Followed outcome' });
  const context = await browser.newContext({ viewport: page.viewportSize()! }); const reader = await context.newPage();
  try {
    await login(reader, viewer.email); await reader.goto(`/objectives/${o.id}`); await reader.getByRole('button', { name: 'Follow objective', exact: true }).click(); await expect(reader.getByRole('button', { name: 'Unfollow objective', exact: true })).toBeVisible(); await expect(reader.getByRole('button', { name: 'Post comment', exact: true })).toHaveCount(0); await expect(reader.getByRole('button', { name: 'New check-in', exact: true })).toHaveCount(0);
    await page.goto(`/objectives/${o.id}`); const comments = page.getByRole('region', { name: 'Comments', exact: true }); await comments.getByLabel('Comment', { exact: true }).fill('Please review the proposed milestones.'); await comments.getByRole('button', { name: 'Post comment', exact: true }).click(); await expect(comments.getByRole('list').getByText('Please review the proposed milestones.', { exact: true })).toBeVisible();
    await reader.goto('/notifications'); await expect(reader.getByRole('heading', { name: '1 unread', exact: true })).toBeVisible(); await expect(reader.getByText('New comment: Followed outcome', { exact: true })).toBeVisible();
    await reader.getByRole('button', { name: 'Mark read', exact: true }).click(); await expect(reader.getByRole('heading', { name: '0 unread', exact: true })).toBeVisible(); await reader.getByRole('button', { name: 'Mark unread', exact: true }).click(); await expect(reader.getByRole('heading', { name: '1 unread', exact: true })).toBeVisible();
    await reader.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/notifications-${info.project.name}.png`, fullPage: true }); expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await reader.getByRole('button', { name: 'Show filters', exact: true }).click(); await reader.getByLabel('Unread only', { exact: true }).check(); await reader.getByRole('button', { name: 'Mark all read', exact: true }).click(); await expect(reader.getByText('No notifications awaiting your attention.', { exact: true })).toBeVisible(); await reader.getByLabel('Unread only', { exact: true }).uncheck(); await reader.getByRole('link', { name: 'Open objective', exact: true }).click(); await expect(reader.getByRole('heading', { name: 'Followed outcome', exact: true })).toBeVisible();
    await reader.getByRole('button', { name: 'Mute objective notifications', exact: true }).click(); await expect(reader.getByRole('button', { name: 'Enable objective notifications', exact: true })).toBeVisible();
    await comments.getByLabel('Comment', { exact: true }).fill('Muted follow-up'); await comments.getByRole('button', { name: 'Post comment', exact: true }).click(); await expect(comments.getByRole('list').getByText('Muted follow-up', { exact: true })).toBeVisible(); await reader.goto('/notifications'); await expect(reader.getByRole('heading', { name: '0 unread', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Archive objective', exact: true }).click(); await page.getByRole('button', { name: 'Confirm archive', exact: true }).click(); await expect(page.getByRole('button', { name: 'Unarchive objective', exact: true })).toBeVisible(); await comments.getByLabel('Comment', { exact: true }).fill('Retrospective on archived work'); await comments.getByRole('button', { name: 'Post comment', exact: true }).click(); await expect(comments.getByRole('list').getByText('Retrospective on archived work', { exact: true })).toBeVisible();
    await reader.goto(`/objectives/${o.id}`); await expect(reader.getByRole('region', { name: 'Comments', exact: true }).getByText('Retrospective on archived work', { exact: true })).toBeVisible(); await reader.getByRole('button', { name: 'Enable objective notifications', exact: true }).click(); await expect(reader.getByRole('button', { name: 'Mute objective notifications', exact: true })).toBeVisible();
    await comments.getByLabel('Comment', { exact: true }).fill('Notifications enabled again'); await comments.getByRole('button', { name: 'Post comment', exact: true }).click(); await expect(comments.getByRole('list').getByText('Notifications enabled again', { exact: true })).toBeVisible(); await reader.goto('/notifications'); await expect(reader.getByRole('heading', { name: '1 unread', exact: true })).toBeVisible(); await reader.getByRole('link', { name: 'Open objective · Archived', exact: true }).first().click(); await expect(reader.getByText('Archived', { exact: true }).first()).toBeVisible();
    await page.goto('/activity'); await expect(page.getByText('Retrospective on archived work', { exact: true })).toBeVisible(); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/activity-${info.project.name}.png`, fullPage: true });
  } finally { await context.close(); }
});

test('stale check-in values require reload and assignment notifications open the current objective', async ({ page, objectives }, info) => {
  const person = await objectives.member('member', 'Assigned Contributor'); let o = await objectives.create({ title: 'Assigned outcome', assignments: [{ membershipId: person.id, role: 'contributor' }] }); o = await objectives.metric(o, { title: 'Versioned result', current: 10 });
  await login(page, person.email); await page.goto('/notifications'); await expect(page.getByText('Your assignment changed: Assigned outcome', { exact: true })).toBeVisible(); await page.getByRole('link', { name: 'Open objective', exact: true }).click();
  const checks = page.getByRole('region', { name: 'Check-ins', exact: true }); await checks.getByRole('button', { name: 'New check-in', exact: true }).click(); await checks.getByLabel('Check-in note', { exact: true }).fill('Stale entry'); await checks.getByLabel('Check-in value: Versioned result', { exact: true }).fill('70');
  const fresh = await getObjective(page, objectives.orgId, o.id); const metric = fresh.keyResults[0]; const changed = await mutation(page, `orgs/${objectives.orgId}/objectives/${o.id}/key-results/${metric.id}/current`, { current: 20, version: metric.version, objectiveVersion: fresh.version }, 'PATCH'); expect(changed.status()).toBe(200);
  await checks.getByRole('button', { name: 'Post check-in', exact: true }).click(); await expect(checks.getByRole('alert')).toContainText('Reload'); const entries = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives/${o.id}/check-ins`)).json(); expect(entries.total).toBe(0);
  await checks.getByRole('button', { name: 'Reload check-in values', exact: true }).click(); await expect(checks.getByLabel('Check-in value: Versioned result', { exact: true })).toHaveValue('20'); await checks.getByLabel('Check-in note', { exact: true }).fill('Reloaded entry'); await checks.getByLabel('Check-in value: Versioned result', { exact: true }).fill('75'); await checks.getByRole('button', { name: 'Post check-in', exact: true }).click(); await expect(checks.getByText('Reloaded entry', { exact: true })).toBeVisible(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '75');
  await page.reload(); await expect(checks.getByText('Reloaded entry', { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

async function openGraph(page: Page) { await page.goto('/alignment'); const toggle = page.getByRole('button', { name: /^(Show|Hide) filters$/ }); await expect(toggle).toBeVisible(); if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click(); }
async function getObjective(page: Page, orgId: string, id: string) { return (await page.request.get(`/api/v1/orgs/${orgId}/objectives/${id}`)).json(); }
async function apiLink(page: Page, orgId: string, sourceId: string, targetId: string, type = 'alignment', weight = 1) {
  const source = await getObjective(page, orgId, sourceId); const target = await getObjective(page, orgId, targetId);
  const response = await mutation(page, `orgs/${orgId}/links`, { sourceId, targetId, type, weight, sourceVersion: source.version, targetVersion: target.version }); expect(response.status(), await response.text()).toBe(201); return response.json();
}
async function uiLink(page: Page, direction: string, title: string, weight = 1) {
  const panel = page.getByRole('region', { name: 'Relationships', exact: true });
  if (!await panel.getByRole('button', { name: 'Cancel relationship', exact: true }).count()) await panel.getByRole('button', { name: 'Connect objective', exact: true }).click();
  await panel.getByLabel('Relationship to add').selectOption(direction); await panel.getByLabel('Find related objective').fill(title);
  await panel.getByRole('button', { name: new RegExp(title) }).click(); if (['parent', 'child'].includes(direction)) await panel.getByLabel('New contribution weight').fill(String(weight));
  await panel.getByRole('button', { name: 'Add relationship', exact: true }).click(); await expect(panel.getByRole('article').filter({ hasText: title })).toBeVisible();
}
async function dragLineEnd(page: Page, linkId: string, end: 'source' | 'target', objectiveId: string) {
  const edge = page.locator(`.react-flow__edge[data-id="${linkId}"]`); await expect(edge).toBeAttached(); await edge.focus(); await edge.press('Enter'); await expect(edge).toHaveClass(/selected/);
  const updater = page.locator(`.react-flow__edge[data-id="${linkId}"] .react-flow__edgeupdater-${end}`);
  const handle = page.locator(`.react-flow__node[data-id="${objectiveId}"] .react-flow__handle-${end === 'source' ? 'right' : 'left'}`);
  await expect(updater).toBeAttached(); await expect(handle).toBeVisible(); await handle.scrollIntoViewIfNeeded();
  const start = await updater.boundingBox(); const finish = await handle.boundingBox(); expect(start).not.toBeNull(); expect(finish).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2); await page.mouse.down();
  await page.mouse.move(finish!.x + finish!.width / 2, finish!.y + finish!.height / 2, { steps: 15 }); await page.mouse.up();
}
async function dragNewLine(page: Page, fromId: string, fromSide: 'left' | 'right', toId: string) {
  const from = page.locator(`.react-flow__node[data-id="${fromId}"] .react-flow__handle-${fromSide}`);
  const to = page.locator(`.react-flow__node[data-id="${toId}"] .react-flow__handle-${fromSide === 'left' ? 'right' : 'left'}`);
  await expect(from).toBeVisible(); await expect(to).toBeVisible(); await page.locator('.graph-canvas').scrollIntoViewIfNeeded();
  const start = await from.boundingBox(); const finish = await to.boundingBox(); expect(start).not.toBeNull(); expect(finish).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2); await page.mouse.down(); await page.mouse.move(finish!.x + finish!.width / 2, finish!.y + finish!.height / 2, { steps: 15 }); await page.mouse.up();
}
async function clickGraphLine(page: Page, linkId: string) {
  const path = page.locator(`.react-flow__edge[data-id="${linkId}"] .react-flow__edge-interaction`); await expect(path).toBeAttached(); await page.locator('.graph-canvas').scrollIntoViewIfNeeded();
  const point = await path.evaluate(el => { const path = el as SVGPathElement; const middle = path.getPointAtLength(path.getTotalLength() / 2); const screen = new DOMPoint(middle.x, middle.y).matrixTransform(path.getScreenCTM()!); return { x: screen.x, y: screen.y }; });
  await page.mouse.click(point.x, point.y);
}
test('graph connection points create new alignment lines in either drag direction and prevent a second parent', async ({ page, objectives }, info) => {
  const parent = await objectives.create({ title: 'Drag new parent', progressMode: 'children' }); const other = await objectives.create({ title: 'Drag other parent' });
  const child = await objectives.metric(await objectives.create({ title: 'Drag new child' }), { current: 60 }); const second = await objectives.create({ title: 'Drag reverse child' });
  await page.goto('/alignment'); await expect(page.getByLabel(`Objective ${parent.title}`, { exact: true })).toBeVisible(); await expect(page.locator('.react-flow__edge-path')).toHaveCount(0);
  for (const objective of [parent, child]) for (const side of ['left', 'right']) {
    const point = page.locator(`.react-flow__node[data-id="${objective.id}"] .react-flow__handle-${side}`); await expect(point).toBeVisible(); await expect(point).toHaveCSS('width', '14px'); await expect(point).toHaveCSS('height', '14px');
  }
  const created = page.waitForResponse(r => r.url().endsWith(`/orgs/${objectives.orgId}/links`) && r.request().method() === 'POST'); await dragNewLine(page, parent.id, 'right', child.id); expect((await created).status()).toBe(201);
  await expect(page.getByRole('status').filter({ hasText: 'Alignment line created' })).toBeVisible(); await expect(page.getByLabel(`Objective ${parent.title}`, { exact: true })).toContainText('60%');
  const reverse = page.waitForResponse(r => r.url().endsWith(`/orgs/${objectives.orgId}/links`) && r.request().method() === 'POST'); await dragNewLine(page, second.id, 'left', other.id); expect((await reverse).status()).toBe(201);
  await expect(page.getByText('4 unique objectives · 2 visible relationships', { exact: true })).toBeVisible();
  await dragNewLine(page, other.id, 'right', child.id); await expect(page.locator('.react-flow__connection')).toHaveCount(0);
  const graph = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/graph`)).json(); expect(graph.links.filter((l: any) => l.targetId === child.id)).toHaveLength(1); expect(graph.links.find((l: any) => l.targetId === child.id)).toMatchObject({ sourceId: parent.id, weight: 1 }); expect(graph.links.find((l: any) => l.targetId === second.id)).toMatchObject({ sourceId: other.id });
  await page.goto(`/alignment?search=${encodeURIComponent(child.title)}`); await page.getByRole('button', { name: 'Connect objectives', exact: true }).click(); const form = page.getByRole('region', { name: 'New graph connection', exact: true });
  await expect(form.getByLabel('Child objective').getByRole('option', { name: child.title, exact: true })).toHaveCount(0); await form.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await page.goto(`/objectives/${child.id}`); await expect(page.getByRole('button', { name: 'Attach parent', exact: true })).toHaveCount(0);
  await page.goto('/alignment'); await expect(page.getByText('4 unique objectives · 2 visible relationships', { exact: true })).toBeVisible(); await expect(page.getByLabel(`Objective ${parent.title}`, { exact: true })).toBeVisible(); await expect(page.locator('.react-flow__edge-path')).toHaveCount(2); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/graph-new-lines-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
test('graph keyboard and touch connection controls reject cycles and stale creation then reload with current versions', async ({ page, objectives }) => {
  const parent = await objectives.create({ title: 'Connection ancestor' }); const child = await objectives.create({ title: 'Connection descendant' }); const free = await objectives.create({ title: 'Connection fresh child' }); await apiLink(page, objectives.orgId, parent.id, child.id);
  await page.goto('/alignment'); await page.getByRole('button', { name: 'Connect objectives', exact: true }).click(); const form = page.getByRole('region', { name: 'New graph connection', exact: true });
  await form.getByLabel('Parent objective').selectOption(child.id); await form.getByLabel('Child objective').selectOption(parent.id); await form.getByRole('button', { name: 'Create line', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('cycle');
  await form.getByLabel('Child objective').selectOption(free.id); const latest = await getObjective(page, objectives.orgId, free.id); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${free.id}`, { ...latest, health: 'at_risk' }, 'PATCH')).ok()).toBeTruthy();
  await form.getByRole('button', { name: 'Create line', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Reload'); expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/graph`)).json()).links).toHaveLength(1);
  await page.getByRole('button', { name: 'Reload alignment', exact: true }).click(); await expect(page.getByLabel(`Objective ${free.title}`, { exact: true }).getByRole('img', { name: 'At risk', exact: true })).toBeVisible();
  await form.getByLabel('Parent objective').selectOption(child.id); await form.getByLabel('Child objective').selectOption(free.id); await form.getByRole('button', { name: 'Create line', exact: true }).press('Enter'); await expect(page.getByRole('status').filter({ hasText: 'Alignment line created' })).toBeVisible(); await expect(form).toHaveCount(0); await expect(page.getByRole('region', { name: 'Alignment graph', exact: true })).toBeFocused();
});
test('dependency graph creates lines from a closed visible prerequisite and removes them with confirmation and conflict recovery', async ({ page, objectives }, info) => {
  const member = await objectives.member('member', 'Dependent editor'); const prerequisite = await objectives.create({ title: 'Visible completed prerequisite' }); const second = await objectives.create({ title: 'Other prerequisite' }); const dependent = await objectives.metric(await objectives.create({ title: 'Editable dependent', leadId: member.id }), { current: 50 });
  const latest = await getObjective(page, objectives.orgId, prerequisite.id); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${prerequisite.id}/lifecycle`, { state: 'completed', version: latest.version, note: 'Complete prerequisite fixture' })).ok()).toBeTruthy();
  await login(page, member.email); await page.goto('/alignment?type=dependency'); await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
  const created = page.waitForResponse(r => r.url().endsWith(`/orgs/${objectives.orgId}/links`) && r.request().method() === 'POST'); await dragNewLine(page, prerequisite.id, 'right', dependent.id); const response = await created; expect(response.status()).toBe(201); const link = await response.json();
  await page.getByRole('button', { name: 'Connect objectives', exact: true }).click(); const form = page.getByRole('region', { name: 'New graph connection', exact: true }); await form.getByLabel('Prerequisite objective').selectOption(second.id); await form.getByLabel('Dependent objective').selectOption(dependent.id); await form.getByRole('button', { name: 'Create line', exact: true }).click(); await expect(page.getByText('3 unique objectives · 2 visible relationships', { exact: true })).toBeVisible();
  const edge = page.locator(`.react-flow__edge[data-id="${link.id}"]`); await edge.focus(); await edge.press('Enter'); const editor = page.getByRole('region', { name: 'Dependency line', exact: true });
  await editor.getByRole('button', { name: 'Remove dependency line', exact: true }).click(); await editor.getByRole('button', { name: 'Cancel line removal', exact: true }).click(); await expect(edge).toBeAttached(); await editor.getByRole('button', { name: 'Remove dependency line', exact: true }).click();
  const current = await getObjective(page, objectives.orgId, dependent.id); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${dependent.id}`, { ...current, health: 'at_risk' }, 'PATCH')).ok()).toBeTruthy();
  await editor.getByRole('button', { name: 'Confirm remove dependency', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Reload'); await expect(edge).toBeAttached();
  await page.getByRole('button', { name: 'Reload alignment', exact: true }).click(); await expect(page.getByLabel(`Objective ${dependent.title}`, { exact: true }).getByRole('img', { name: 'At risk', exact: true })).toBeVisible(); await editor.getByRole('button', { name: 'Remove dependency line', exact: true }).click();
  await editor.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/dependency-line-remove-${info.project.name}.png` }); await editor.getByRole('button', { name: 'Confirm remove dependency', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Dependency line removed' })).toBeVisible(); await expect(edge).toHaveCount(0); expect((await getObjective(page, objectives.orgId, dependent.id)).progress).toBe(50);
  await page.reload(); await expect(page.getByText('3 unique objectives · 1 visible relationships', { exact: true })).toBeVisible(); await expect(edge).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
test('graph creation handles and line removal respect viewer and locked dependent permissions', async ({ page, objectives }) => {
  const viewer = await objectives.member('viewer', 'Line reader'); const prerequisite = await objectives.create({ title: 'Line prerequisite' }); const dependent = await objectives.create({ title: 'Line closed dependent' }); const link = await apiLink(page, objectives.orgId, prerequisite.id, dependent.id, 'dependency');
  const latest = await getObjective(page, objectives.orgId, dependent.id); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${dependent.id}/lifecycle`, { state: 'completed', version: latest.version, note: 'Lock dependent fixture', overrideNote: 'Approved independent fixture' })).ok()).toBeTruthy();
  await page.goto('/alignment?type=dependency'); const edge = page.locator(`.react-flow__edge[data-id="${link.id}"]`); await expect(edge).toBeAttached(); await clickGraphLine(page, link.id); await page.keyboard.press('Delete'); await expect(page.getByRole('button', { name: 'Remove dependency line', exact: true })).toHaveCount(0); await expect(page.getByRole('group', { name: 'Confirm line removal', exact: true })).toHaveCount(0);
  await login(page, viewer.email); await page.goto('/alignment?type=dependency'); await expect(edge).toBeAttached(); await expect(page.getByRole('button', { name: 'Connect objectives', exact: true })).toHaveCount(0); await expect(page.locator('.react-flow__handle.connectable.connectablestart')).toHaveCount(0); await clickGraphLine(page, link.id); await page.keyboard.press('Delete'); await expect(page.getByRole('region', { name: 'Dependency line', exact: true })).toHaveCount(0); await expect(edge).toBeAttached();
});
test('graph cards drag independently, retain positions across reloads and connections, and reset to automatic layout', async ({ page, objectives }, info) => {
  const parent = await objectives.create({ title: 'Movable parent' }); const child = await objectives.create({ title: 'Movable child' }); const loose = await objectives.create({ title: 'Loose movable card' }); await apiLink(page, objectives.orgId, parent.id, child.id);
  await page.goto('/alignment'); const node = page.getByLabel(`Objective ${loose.title}`, { exact: true }); await expect(node).toBeVisible(); await page.locator('.graph-canvas').scrollIntoViewIfNeeded();
  const transform = () => node.evaluate(el => (el as HTMLElement).style.transform); const automatic = await transform(); const before = await getObjective(page, objectives.orgId, loose.id);
  const move = async () => {
    await node.scrollIntoViewIfNeeded(); const title = await node.locator('.graph-node-title strong').boundingBox();
    await page.mouse.move(title!.x + title!.width / 2, title!.y + title!.height / 2); await page.mouse.down(); await page.mouse.move(title!.x + title!.width / 2 + 45, title!.y + title!.height / 2 - 35, { steps: 12 }); await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Objective details', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Reset card positions', exact: true })).toBeVisible();
  };
  await move(); const moved = await transform(); expect(moved).not.toBe(automatic);
  const parentNode = page.getByLabel(`Objective ${parent.title}`, { exact: true }); await parentNode.getByRole('button', { name: `Collapse children of ${parent.title}`, exact: true }).click(); expect(await transform()).toBe(moved);
  await parentNode.getByRole('button', { name: `Expand children of ${parent.title}`, exact: true }).click(); await page.getByRole('button', { name: 'Reload graphs', exact: true }).click(); await expect(async () => expect(await transform()).toBe(moved)).toPass();
  await page.reload(); await expect(node).toBeVisible(); expect(await transform()).toBe(moved); expect((await getObjective(page, objectives.orgId, loose.id)).version).toBe(before.version);
  await page.goto('/alignment?type=dependency'); await expect(node).toBeVisible(); await expect(page.getByRole('button', { name: 'Reset card positions', exact: true })).toHaveCount(0);
  await page.goto('/alignment'); await expect(node).toBeVisible(); expect(await transform()).toBe(moved); await page.getByRole('button', { name: 'Reset card positions', exact: true }).click(); await expect(async () => expect(await transform()).toBe(automatic)).toPass();
  await move(); const beforeConnection = await transform(); const requested = (await graphCardPositions(page))[loose.id]; const response = page.waitForResponse(r => r.url().endsWith(`/orgs/${objectives.orgId}/links`) && r.request().method() === 'POST'); await dragNewLine(page, child.id, 'right', loose.id); expect((await response).status()).toBe(201); await expect(page.getByRole('status').filter({ hasText: 'Alignment line created' })).toBeVisible();
  await expectSpacedCards(page, 3);
  const afterConnection = await graphCardPositions(page);
  const collision = Object.entries(afterConnection).some(([id, p]) => id !== loose.id && Math.abs(p.x - requested.x) < 285 && Math.abs(p.y - requested.y) < 112);
  if (!collision) expect(await transform()).toBe(beforeConnection);
  const movedAgain = await transform();
  await page.goto(`/alignment?search=${encodeURIComponent(loose.title)}`); await expect(node).toBeVisible(); expect(await transform()).toBe(movedAgain); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/canvas-moved-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
async function graphCardPositions(page: Page) {
  return page.locator('.react-flow__node').evaluateAll(elements => Object.fromEntries(elements.map(el => {
    const matrix = new DOMMatrixReadOnly((el as HTMLElement).style.transform);
    return [(el as HTMLElement).dataset.id!, { x: matrix.m41, y: matrix.m42 }];
  })));
}
async function expectSpacedCards(page: Page, count: number) {
  await expect(page.locator('.react-flow__node')).toHaveCount(count);
  await expect(async () => {
    const points = Object.values(await graphCardPositions(page));
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      expect(Math.abs(points[i].x - points[j].x) >= 285 - 0.01 || Math.abs(points[i].y - points[j].y) >= 112 - 0.01).toBeTruthy();
    }
  }).toPass();
}

test('overlapping card drops leave a clear gap and preserve stationary cards and objective records', async ({ page, objectives }, info) => {
  const cards = [];
  for (const title of ['Spacing anchor', 'Spacing second', 'Spacing moving', 'Spacing neighbor']) cards.push(await objectives.create({ title }));
  const before = await Promise.all(cards.map(o => getObjective(page, objectives.orgId, o.id)));
  for (const type of ['alignment', 'dependency']) {
    await page.goto(`/alignment?type=${type}`); await expectSpacedCards(page, 4);
    const original = await graphCardPositions(page);
    let changed = false;
    for (const target of [cards[0], cards[1], cards[0]]) {
      await page.getByRole('button', { name: 'Fit View', exact: true }).click();
      const moving = page.getByLabel(`Objective ${cards[2].title}`, { exact: true });
      const anchor = page.getByLabel(`Objective ${target.title}`, { exact: true });
      await page.locator('.graph-canvas').scrollIntoViewIfNeeded();
      await expect(moving).toBeInViewport(); await expect(anchor).toBeInViewport();
      const start = (await moving.locator('.graph-node-title strong').boundingBox())!;
      const end = (await anchor.locator('.graph-node-title strong').boundingBox())!;
      const previous = await graphCardPositions(page);
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
      await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 }); await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Reset card positions', exact: true })).toBeVisible();
      await expectSpacedCards(page, 4);
      const actual = await graphCardPositions(page);
      changed ||= JSON.stringify(actual[cards[2].id]) !== JSON.stringify(previous[cards[2].id]);
      for (const card of [cards[0], cards[1], cards[3]]) expect(actual[card.id]).toEqual(original[card.id]);
      await expect(page.getByRole('dialog', { name: 'Objective details', exact: true })).toHaveCount(0);
    }
    expect(changed).toBeTruthy();
    const corrected = await graphCardPositions(page);
    await page.reload(); await expectSpacedCards(page, 4); expect(await graphCardPositions(page)).toEqual(corrected);
    await page.getByRole('button', { name: 'Reload graphs', exact: true }).click(); await expectSpacedCards(page, 4); expect(await graphCardPositions(page)).toEqual(corrected);
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/spacing-drops-${type}-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Reset card positions', exact: true }).click(); await expectSpacedCards(page, 4); expect(await graphCardPositions(page)).toEqual(original);
  }
  for (let i = 0; i < cards.length; i++) expect(await getObjective(page, objectives.orgId, cards[i].id)).toEqual(before[i]);
});

test('crowded saved card positions recover through filters, collapse, new data and reload', async ({ page, objectives }, info) => {
  const cards = [];
  for (let i = 0; i < 6; i++) cards.push(await objectives.create({ title: `Restored spacing ${i}` }));
  await apiLink(page, objectives.orgId, cards[0].id, cards[1].id);
  await apiLink(page, objectives.orgId, cards[1].id, cards[2].id);
  await page.goto('/alignment'); await expectSpacedCards(page, 6);
  const key = `okr.alignment.collapsed.${objectives.orgId}.${objectives.leadId}.positions.alignment`;
  await page.evaluate(({ key, ids }) => sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(ids.map(id => [id, { x: 100, y: 100 }])))), { key, ids: cards.map(o => o.id) });
  await page.reload(); await expectSpacedCards(page, 6);
  const restored = await graphCardPositions(page);
  await expect(async () => expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), key)).toEqual(restored)).toPass();
  await page.getByRole('button', { name: `Collapse children of ${cards[0].title}`, exact: true }).click(); await expectSpacedCards(page, 4);
  await page.getByRole('button', { name: 'Expand all children', exact: true }).click(); await expectSpacedCards(page, 6); expect(await graphCardPositions(page)).toEqual(restored);
  await page.goto(`/alignment?search=${encodeURIComponent(cards[2].title)}`); await expectSpacedCards(page, 1);
  expect((await graphCardPositions(page))[cards[2].id]).toEqual(restored[cards[2].id]);
  await page.goto('/alignment'); await expectSpacedCards(page, 6); expect(await graphCardPositions(page)).toEqual(restored);
  await objectives.create({ title: 'New automatic card beside restored cards' });
  await page.getByRole('button', { name: 'Reload graphs', exact: true }).click(); await expectSpacedCards(page, 7);
  const updated = await graphCardPositions(page); await page.reload(); await expectSpacedCards(page, 7); expect(await graphCardPositions(page)).toEqual(updated);
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/spacing-restored-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('Delete removes selected alignment and dependency relationships through keyboard confirmation while keeping objectives', async ({ page, objectives }, info) => {
  const parent = await objectives.create({ title: 'Keyboard removal parent', progressMode: 'children' }); const child = await objectives.metric(await objectives.create({ title: 'Keyboard removal child' }), { current: 55 });
  const alignment = await apiLink(page, objectives.orgId, parent.id, child.id); const dependency = await apiLink(page, objectives.orgId, parent.id, child.id, 'dependency');
  for (const [type, link] of [['alignment', alignment], ['dependency', dependency]] as const) {
    await page.goto(`/alignment?type=${type}`); const edge = page.locator(`.react-flow__edge[data-id="${link.id}"]`); await expect(edge).toBeAttached(); await clickGraphLine(page, link.id); await page.keyboard.press('Delete');
    const confirm = page.getByRole('button', { name: `Confirm remove ${type}`, exact: true }); await expect(confirm).toBeFocused(); await confirm.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/canvas-delete-${type}-${info.project.name}.png` });
    const response = page.waitForResponse(r => r.url().endsWith(`/links/${link.id}`) && r.request().method() === 'DELETE'); await page.keyboard.press('Enter'); expect((await response).status()).toBe(200); await expect(edge).toHaveCount(0); await expect(page.getByRole('region', { name: type === 'alignment' ? 'Alignment graph' : 'Prerequisite graph', exact: true })).toBeFocused();
    expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives/${child.id}/relationships`)).json()).some((r: any) => r.id === link.id)).toBeFalsy();
  }
  expect((await getObjective(page, objectives.orgId, child.id)).progress).toBeCloseTo(55); expect((await getObjective(page, objectives.orgId, parent.id)).progress).toBe(0); await page.reload(); await expect(page.getByText('2 unique objectives · 0 visible relationships', { exact: true })).toBeVisible();
});
test('Delete ignores objective cards, cancellation keeps a line, and stale keyboard removal reloads safely', async ({ page, objectives }) => {
  const parent = await objectives.create({ title: 'Protected keyboard parent' }); const child = await objectives.create({ title: 'Protected keyboard child' }); const link = await apiLink(page, objectives.orgId, parent.id, child.id);
  await page.goto('/alignment'); const edge = page.locator(`.react-flow__edge[data-id="${link.id}"]`); await expect(edge).toBeAttached(); await edge.focus(); await edge.press('Enter');
  const childNode = page.getByLabel(`Objective ${child.title}`, { exact: true }); await childNode.focus(); await childNode.press('Delete'); await expect(page.getByRole('group', { name: 'Confirm line removal', exact: true })).toHaveCount(0); await expect(edge).toBeAttached();
  await edge.focus(); await edge.press('Delete'); await page.getByRole('button', { name: 'Cancel line removal', exact: true }).click(); await expect(page.getByRole('region', { name: 'Alignment graph', exact: true })).toBeFocused(); await expect(edge).toBeAttached();
  await edge.focus(); await edge.press('Delete'); const current = await getObjective(page, objectives.orgId, child.id); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${child.id}`, { ...current, health: 'at_risk' }, 'PATCH')).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Confirm remove alignment', exact: true }).press('Enter'); await expect(page.getByRole('alert')).toContainText('Reload'); await expect(edge).toBeAttached();
  await page.getByRole('button', { name: 'Reload alignment', exact: true }).click(); await expect(childNode.getByRole('img', { name: 'At risk', exact: true })).toBeVisible(); await edge.focus(); await edge.press('Delete'); await page.getByRole('button', { name: 'Confirm remove alignment', exact: true }).press('Enter'); await expect(page.getByRole('status').filter({ hasText: 'Alignment line removed' })).toBeVisible(); await expect(edge).toHaveCount(0); expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives/${child.id}/relationships`)).json()).some((r: any) => r.id === link.id)).toBeFalsy();
});
test('alignment lines drag either endpoint and preserve weight, other branches, prerequisites and progress', async ({ page, objectives }, info) => {
  const old = await objectives.create({ title: 'Tree original parent', progressMode: 'children' }); const next = await objectives.create({ title: 'Tree new parent', progressMode: 'children' }); const other = await objectives.create({ title: 'Tree shared parent', progressMode: 'children' });
  const child = await objectives.metric(await objectives.create({ title: 'Tree original child' }), { current: 25 }); const replacement = await objectives.metric(await objectives.create({ title: 'Tree new child' }), { current: 80 });
  const link = await apiLink(page, objectives.orgId, old.id, child.id, 'alignment', 3); const shared = await apiLink(page, objectives.orgId, other.id, old.id); const prerequisite = await apiLink(page, objectives.orgId, child.id, replacement.id, 'dependency');
  await page.goto('/alignment'); await expect(page.getByLabel(`Objective ${replacement.title}`, { exact: true })).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith(`/links/${link.id}/reconnect`) && r.request().method() === 'POST');
  await dragLineEnd(page, link.id, 'source', next.id); expect((await response).status()).toBe(200); await expect(page.getByRole('status').filter({ hasText: 'Alignment parent changed' })).toBeVisible();
  expect((await getObjective(page, objectives.orgId, old.id)).progress).toBe(0); await expect(page.getByLabel(`Objective ${next.title}`, { exact: true })).toContainText('25%');
  const childResponse = page.waitForResponse(r => r.url().endsWith(`/links/${link.id}/reconnect`) && r.request().method() === 'POST');
  await dragLineEnd(page, link.id, 'target', replacement.id); expect((await childResponse).status()).toBe(200); await expect(page.getByRole('status').filter({ hasText: 'Alignment child changed' })).toBeVisible(); await expect(page.getByLabel(`Objective ${next.title}`, { exact: true })).toContainText('80%');
  const relationships = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives/${replacement.id}/relationships`)).json();
  expect(relationships.find((r: any) => r.id === link.id)).toMatchObject({ sourceId: next.id, targetId: replacement.id, weight: 3 }); expect(relationships.find((r: any) => r.id === prerequisite.id)).toBeTruthy();
  expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives/${old.id}/relationships`)).json()).find((r: any) => r.id === shared.id)).toBeTruthy();
  await expect(page.getByRole('region', { name: 'Graph list alternative' }).locator(`article > button[data-objective-id="${next.id}"]`).locator('..')).toContainText(replacement.title);
  await page.reload(); await expect(page.locator(`.react-flow__edge[data-id="${link.id}"]`)).toHaveAttribute('aria-label', `Alignment: ${next.title} to ${replacement.title}`);
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/tree-reconnected-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
test('alignment line keyboard and touch controls retain originals on cycles and stale versions and reload to recover', async ({ page, objectives }, info) => {
  const parent = await objectives.create({ title: 'Tree stable parent' }); const child = await objectives.create({ title: 'Tree stable child' }); const ancestor = await objectives.create({ title: 'Tree ancestor' }); const next = await objectives.create({ title: 'Tree eligible replacement' }); const attached = await objectives.create({ title: 'Tree already attached' });
  const link = await apiLink(page, objectives.orgId, parent.id, child.id, 'alignment', 2); await apiLink(page, objectives.orgId, ancestor.id, parent.id); await apiLink(page, objectives.orgId, parent.id, attached.id);
  await page.goto('/alignment'); const edge = page.locator(`.react-flow__edge[data-id="${link.id}"]`); await expect(edge).toBeAttached();
  if (info.project.name === 'mobile') await edge.locator('.react-flow__edge-interaction').tap(); else { await edge.focus(); await edge.press('Enter'); }
  const editor = page.getByRole('region', { name: 'Reattach alignment', exact: true }); await expect(editor).toBeVisible(); await editor.getByLabel('End to move').selectOption('child');
  await expect(editor.getByLabel('Reattach to objective').getByRole('option', { name: attached.title, exact: true })).toHaveCount(0);
  await editor.getByLabel('Reattach to objective').selectOption(ancestor.id); await editor.getByRole('button', { name: 'Reattach line', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('cycle');
  let graph = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/graph`)).json(); expect(graph.links.find((l: any) => l.id === link.id)).toMatchObject({ sourceId: parent.id, targetId: child.id });
  await editor.getByLabel('Reattach to objective').selectOption(next.id); const fresh = await getObjective(page, objectives.orgId, next.id); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${next.id}`, { ...fresh, health: 'at_risk' }, 'PATCH')).ok()).toBeTruthy();
  await editor.getByRole('button', { name: 'Reattach line', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Reload');
  await page.getByRole('button', { name: 'Reload alignment', exact: true }).click(); await expect(page.getByLabel(`Objective ${next.title}`, { exact: true }).getByRole('img', { name: 'At risk', exact: true })).toBeVisible();
  await editor.getByLabel('Reattach to objective').selectOption(next.id); await editor.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/tree-controls-${info.project.name}.png` }); await editor.getByRole('button', { name: 'Reattach line', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Alignment child changed' })).toBeVisible(); await expect(editor).toHaveCount(0); await expect(page.getByRole('region', { name: 'Alignment graph', exact: true })).toBeFocused();
  graph = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/graph`)).json(); expect(graph.links.find((l: any) => l.id === link.id)).toMatchObject({ sourceId: parent.id, targetId: next.id, weight: 2 });
});
test('alignment line cancellation and empty drops retain links; locked and viewer edges and prerequisites cannot reconnect', async ({ page, objectives }) => {
  const viewer = await objectives.member('viewer', 'Tree viewer'); const parent = await objectives.create({ title: 'Tree permission parent' }); const child = await objectives.create({ title: 'Tree permission child' }); const next = await objectives.create({ title: 'Tree unused candidate' }); const closed = await objectives.create({ title: 'Tree completed child' });
  const link = await apiLink(page, objectives.orgId, parent.id, child.id); const locked = await apiLink(page, objectives.orgId, parent.id, closed.id); const dependency = await apiLink(page, objectives.orgId, parent.id, child.id, 'dependency');
  const current = await getObjective(page, objectives.orgId, closed.id); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${closed.id}/lifecycle`, { state: 'completed', note: 'Freeze tree fixture', version: current.version })).ok()).toBeTruthy();
  await page.goto('/alignment'); const edge = page.locator(`.react-flow__edge[data-id="${link.id}"]`); await expect(edge).toBeAttached(); await edge.focus(); await edge.press('Enter');
  const editor = page.getByRole('region', { name: 'Reattach alignment', exact: true }); await editor.getByLabel('Reattach to objective').selectOption(next.id); await editor.getByRole('button', { name: 'Cancel reattachment', exact: true }).click(); await expect(editor).toHaveCount(0);
  await edge.focus(); await edge.press('Enter'); await page.locator('.graph-canvas').scrollIntoViewIfNeeded(); const updater = edge.locator('.react-flow__edgeupdater-target'); const start = await updater.boundingBox(); const canvas = await page.locator('.graph-canvas').boundingBox();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2); await page.mouse.down(); await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height - 50, { steps: 12 }); await page.mouse.up();
  await expect(page.locator('.react-flow__connection')).toHaveCount(0); expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/graph`)).json()).links.find((l: any) => l.id === link.id)).toMatchObject({ sourceId: parent.id, targetId: child.id });
  await expect(page.locator(`.react-flow__edge[data-id="${locked.id}"] .react-flow__edgeupdater`)).toHaveCount(0);
  await page.goto('/alignment?type=dependency'); await expect(page.locator(`.react-flow__edge[data-id="${dependency.id}"] .react-flow__edge-path`)).toHaveAttribute('d', /^M/); await expect(page.locator('.react-flow__edgeupdater')).toHaveCount(0);
  await login(page, viewer.email); await page.goto('/alignment'); await expect(page.getByLabel(`Objective ${parent.title}`, { exact: true })).toBeVisible(); await expect(page.locator('.react-flow__edgeupdater')).toHaveCount(0); await edge.locator('.react-flow__edge-interaction').click(); await expect(editor).toHaveCount(0);
});
test('cancelled objective lines explain the lock and allow parent dragging after reopening in the panel', async ({ page, objectives }, info) => {
  const parent = await objectives.create({ title: 'test' }); const next = await objectives.create({ title: 'SECOND' });
  const child = await objectives.create({ title: 'test2 tets to be as as a sas as a s as sdas d as das das dasd asd as' });
  const link = await apiLink(page, objectives.orgId, parent.id, child.id, 'alignment', 3);
  const current = await getObjective(page, objectives.orgId, child.id);
  expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${child.id}/lifecycle`, { state: 'cancelled', version: current.version })).ok()).toBeTruthy();
  const cancelled = await getObjective(page, objectives.orgId, child.id);
  await page.goto('/alignment'); await clickGraphLine(page, link.id);
  const notice = page.getByRole('region', { name: 'Unavailable relationship', exact: true });
  await expect(notice).toContainText('This objective is cancelled. Reopen it before changing this line.'); await expect(notice).toContainText(child.title);
  await expect(page.locator('.react-flow__edgeupdater')).toHaveCount(0);
  await page.keyboard.press('Delete'); await expect(page.getByRole('group', { name: 'Confirm line removal', exact: true })).toHaveCount(0);
  expect(await getObjective(page, objectives.orgId, child.id)).toEqual(cancelled);
  await notice.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/parent-drag-cancelled-${info.project.name}.png` });
  expect(await notice.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await notice.getByRole('button', { name: `Open objective ${child.title}`, exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Objective details', exact: true });
  await expect(panel.getByRole('heading', { name: child.title, exact: true })).toBeVisible();
  await panel.getByRole('combobox', { name: 'New lifecycle', exact: true }).selectOption('active'); await panel.getByRole('button', { name: 'Apply lifecycle', exact: true }).click();
  await expect(panel.locator('.objective-detail-meta')).toContainText('active'); await expect(notice).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close objective details', exact: true }).click();
  const response = page.waitForResponse(r => r.url().endsWith(`/links/${link.id}/reconnect`) && r.request().method() === 'POST');
  await dragLineEnd(page, link.id, 'source', next.id); expect((await response).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Alignment parent changed' })).toBeVisible();
  const graph = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/graph`)).json();
  expect(graph.links.find((l: any) => l.id === link.id)).toMatchObject({ sourceId: next.id, targetId: child.id, weight: 3 });
  await page.reload(); await expect(page.locator(`.react-flow__edge[data-id="${link.id}"]`)).toBeAttached();
  expect((await getObjective(page, objectives.orgId, child.id)).state).toBe('active');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('unavailable line explanations cover archived parents and viewer access while allowing closed prerequisites', async ({ page, objectives }) => {
  const viewer = await objectives.member('viewer', 'Read-only graph reviewer');
  const parent = await objectives.create({ title: 'Archived completed parent' }); const child = await objectives.create({ title: 'Editable dependent child' });
  const alignment = await apiLink(page, objectives.orgId, parent.id, child.id); const dependency = await apiLink(page, objectives.orgId, parent.id, child.id, 'dependency');
  const current = await getObjective(page, objectives.orgId, parent.id);
  const completed = await mutation(page, `orgs/${objectives.orgId}/objectives/${parent.id}/lifecycle`, { state: 'completed', note: 'Lock notice fixture', version: current.version }); expect(completed.ok()).toBeTruthy();
  expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${parent.id}/archive`, { archived: true, version: (await completed.json()).version })).ok()).toBeTruthy();
  await page.goto('/alignment?archived=all'); const edge = page.locator(`.react-flow__edge[data-id="${alignment.id}"]`); await expect(edge).toBeAttached();
  await edge.focus(); await edge.press('Enter'); const notice = page.getByRole('region', { name: 'Unavailable relationship', exact: true });
  await expect(notice).toContainText('This objective is archived and completed. Unarchive and reopen it before changing this line.');
  await expect(notice.getByRole('button', { name: `Open objective ${parent.title}`, exact: true })).toBeVisible();
  await notice.getByRole('button', { name: 'Close line details', exact: true }).click(); await expect(notice).toHaveCount(0); await expect(page.getByRole('region', { name: 'Alignment graph', exact: true })).toBeFocused();
  await page.goto('/alignment?type=dependency&archived=all'); const dependentEdge = page.locator(`.react-flow__edge[data-id="${dependency.id}"]`); await expect(dependentEdge).toBeAttached(); await dependentEdge.focus(); await dependentEdge.press('Enter');
  await expect(notice).toHaveCount(0); await expect(page.getByRole('button', { name: 'Remove dependency line', exact: true })).toBeVisible();
  await login(page, viewer.email); await page.goto('/alignment?type=dependency&archived=all'); await expect(dependentEdge).toBeAttached(); await dependentEdge.focus(); await dependentEdge.press('Space');
  await expect(notice).toContainText('You do not have edit access.'); await expect(notice).not.toContainText('Reopen it');
  await expect(page.getByRole('button', { name: 'Remove dependency line', exact: true })).toHaveCount(0);
  await notice.getByRole('button', { name: `Open objective ${child.title}`, exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Objective details', exact: true }); await expect(panel.getByRole('heading', { name: child.title, exact: true })).toBeVisible(); await expect(panel.getByRole('button', { name: 'Apply lifecycle', exact: true })).toHaveCount(0);
});

test('alignment panel changes, detaches and attaches existing parents while retaining filters and other links', async ({ page, objectives }, info) => {
  const old = await objectives.create({ title: 'Original strategic parent', progressMode: 'children' }); const next = await objectives.create({ title: 'Replacement strategic parent', progressMode: 'children' }); const other = await objectives.create({ title: 'Shared strategic parent', progressMode: 'children' });
  const child = await objectives.metric(await objectives.create({ title: 'Moving delivery objective' }), { current: 75 });
  await apiLink(page, objectives.orgId, old.id, child.id, 'alignment', 3);
  await page.goto(`/alignment?search=${encodeURIComponent(child.title)}`);
  const list = page.getByRole('region', { name: 'Graph list alternative', exact: true }); const trigger = list.getByRole('button', { name: child.title, exact: true }); await trigger.focus(); await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Objective details', exact: true }); const panel = dialog.getByRole('region', { name: 'Relationships', exact: true }); const row = (title: string) => panel.getByRole('article', { name: `Alignment parent: ${title}`, exact: true });
  await row(old.title).getByRole('button', { name: 'Change parent', exact: true }).click(); await row(old.title).getByLabel('Find new parent').fill(next.title);
  await row(old.title).getByRole('button', { name: new RegExp(next.title) }).click(); await expect(row(old.title).getByText('Contribution weight 3', { exact: false })).toBeVisible();
  await row(old.title).screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/alignment-change-parent-${info.project.name}.png` });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await row(old.title).getByRole('button', { name: 'Save parent', exact: true }).click(); await expect(row(old.title)).toHaveCount(0); await expect(row(next.title)).toBeVisible(); await expect(row(other.title)).toHaveCount(0); await expect(row(next.title).getByLabel('Contribution weight')).toHaveValue('3');
  expect((await getObjective(page, objectives.orgId, old.id)).progress).toBe(0); expect((await getObjective(page, objectives.orgId, next.id)).progress).toBe(75);
  await row(next.title).getByRole('button', { name: 'Detach parent', exact: true }).click(); await row(next.title).getByRole('button', { name: 'Cancel removal', exact: true }).click(); await expect(row(next.title)).toBeVisible();
  await row(next.title).getByRole('button', { name: 'Detach parent', exact: true }).click(); await row(next.title).getByRole('button', { name: 'Confirm detach parent', exact: true }).click(); await expect(row(next.title)).toHaveCount(0);
  await expect(panel.getByText('No relationships yet.', { exact: true })).toBeVisible(); expect((await getObjective(page, objectives.orgId, child.id)).progress).toBe(75);
  await panel.getByRole('button', { name: 'Attach parent', exact: true }).click(); await panel.getByLabel('Find related objective').fill(old.title); await panel.getByRole('button', { name: new RegExp(old.title) }).click(); await panel.getByLabel('New contribution weight').fill('2'); await panel.getByRole('button', { name: 'Attach selected parent', exact: true }).click();
  await expect(row(old.title)).toBeVisible(); await expect(row(old.title).getByLabel('Contribution weight')).toHaveValue('2');
  await dialog.getByRole('button', { name: 'Close objective details', exact: true }).click(); await expect(trigger).toBeFocused(); await expect(page.getByLabel('Search graph objectives')).toHaveValue(child.title); await expect(list.getByText('1 connected objective(s) outside filters', { exact: true })).toBeVisible();
  await page.getByLabel('Search graph objectives').fill(''); await expect(page.getByText('4 unique objectives · 1 visible relationships', { exact: true })).toBeVisible(); await expect(list.getByText('Parent:', { exact: false })).toContainText(old.title);
  await page.reload(); await expect(page.getByText('4 unique objectives · 1 visible relationships', { exact: true })).toBeVisible(); await expect(page.getByLabel(`Objective ${child.title}`, { exact: true })).toBeVisible();
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/alignment-parents-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
test('alignment parent changes reject cycles and stale candidates, retain the original and recover on reload', async ({ page, objectives }) => {
  const old = await objectives.create({ title: 'Current parent' }); const child = await objectives.create({ title: 'Moving objective' }); const descendant = await objectives.create({ title: 'Descendant candidate' }); const next = await objectives.create({ title: 'Valid candidate' });
  await apiLink(page, objectives.orgId, old.id, child.id); await apiLink(page, objectives.orgId, child.id, descendant.id);
  await openGraph(page); await page.getByLabel(`Objective ${child.title}`, { exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Objective details', exact: true }); const row = dialog.getByRole('article', { name: `Alignment parent: ${old.title}`, exact: true });
  const choose = async (title: string) => { await row.getByLabel('Find new parent').fill(title); await row.getByRole('button', { name: new RegExp(title) }).click(); };
  await row.getByRole('button', { name: 'Change parent', exact: true }).click(); await choose(descendant.title); await row.getByRole('button', { name: 'Save parent', exact: true }).click(); await expect(row.getByRole('alert')).toContainText('cycle'); await expect(row).toBeVisible();
  await choose(next.title); const fresh = await getObjective(page, objectives.orgId, next.id); expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${next.id}`, { ...fresh, health: 'at_risk' }, 'PATCH')).ok()).toBeTruthy();
  await row.getByRole('button', { name: 'Save parent', exact: true }).click(); await expect(row.getByRole('alert')).toContainText('Reload'); expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives/${child.id}/relationships`)).json()).find((r: any) => r.sourceId === old.id)).toBeTruthy();
  await row.getByRole('button', { name: 'Reload relationships', exact: true }).click(); await expect(row.getByRole('button', { name: 'Change parent', exact: true })).toBeVisible(); await row.getByRole('button', { name: 'Change parent', exact: true }).click(); await choose(next.title); await row.getByRole('button', { name: 'Save parent', exact: true }).click();
  await expect(row).toHaveCount(0); await expect(dialog.getByRole('article', { name: `Alignment parent: ${next.title}`, exact: true })).toBeVisible(); await expect(dialog.getByRole('article', { name: `Aligned child: ${descendant.title}`, exact: true })).toBeVisible();
});
test('alignment parent controls respect endpoint editing rights and viewer access', async ({ page, objectives }) => {
  const member = await objectives.member('member', 'Child editor'); const viewer = await objectives.member('viewer', 'Alignment reader'); const old = await objectives.create({ title: 'Restricted parent' }); const next = await objectives.create({ title: 'Editable parent', leadId: member.id }); const child = await objectives.create({ title: 'Editable child', leadId: member.id }); await apiLink(page, objectives.orgId, old.id, child.id);
  await login(page, member.email); await openGraph(page); await page.getByLabel(`Objective ${child.title}`, { exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Objective details', exact: true }); const row = dialog.getByRole('article', { name: `Alignment parent: ${old.title}`, exact: true });
  await expect(row).toBeVisible(); await expect(row.getByRole('button', { name: 'Change parent', exact: true })).toHaveCount(0); await expect(row.getByRole('button', { name: 'Detach parent', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Attach parent', exact: true })).toHaveCount(0); await dialog.getByRole('button', { name: 'Connect objective', exact: true }).click(); await expect(dialog.getByLabel('Relationship to add').getByRole('option', { name: 'Alignment parent', exact: true })).toHaveAttribute('disabled', '');
  await dialog.getByRole('button', { name: 'Close objective details', exact: true }).click(); await login(page, viewer.email); await openGraph(page); await page.getByLabel(`Objective ${child.title}`, { exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Objective details', exact: true });
  await expect(dialog.getByRole('article', { name: `Alignment parent: ${old.title}`, exact: true })).toBeVisible(); for (const name of ['Attach parent', 'Detach parent', 'Change parent']) await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0);
});
test('one alignment parent, weighted children, rollups, score modes and removal work through forms', async ({ page, objectives }, info) => {
  const parent = await objectives.create({ title: 'Strategic parent', progressMode: 'children' }); const second = await objectives.create({ title: 'Second parent', progressMode: 'children' });
  const low = await objectives.metric(await objectives.create({ title: 'Low child' }), { current: 20 }); const high = await objectives.metric(await objectives.create({ title: 'High child', startDate: '2026-04-01', endDate: '2026-06-30' }), { current: 80 });
  await page.goto(`/objectives/${parent.id}`); await uiLink(page, 'child', 'Low child'); await uiLink(page, 'child', 'High child', 3);
  await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '65');
  await expect(page.getByText('Different planning periods or dates', { exact: true })).toBeVisible();
  await page.goto(`/objectives/${low.id}`); const panel = page.getByRole('region', { name: 'Relationships', exact: true });
  await expect(panel.getByRole('article', { name: 'Alignment parent: Strategic parent', exact: true })).toBeVisible(); await expect(panel.getByRole('button', { name: 'Attach parent', exact: true })).toHaveCount(0); await expect(panel.getByRole('article', { name: 'Alignment parent: Second parent', exact: true })).toHaveCount(0);
  await page.goto(`/objectives/${parent.id}`); const row = page.getByRole('article', { name: 'Aligned child: Low child', exact: true }); await row.getByLabel('Contribution weight').fill('3'); await row.getByRole('button', { name: 'Save weight', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Edit objective', exact: true }).click(); await page.getByLabel('Progress mode').selectOption('key_results'); await page.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Edit objective', exact: true }).click(); await page.getByLabel('Progress mode').selectOption('children'); await page.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '50');
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/relationships-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await row.getByRole('button', { name: 'Remove relationship', exact: true }).click(); await row.getByRole('button', { name: 'Confirm remove relationship', exact: true }).click(); await expect(row).toHaveCount(0); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '80');
  expect((await page.request.get(`/api/v1/orgs/${objectives.orgId}/objective-summary`)).ok()).toBeTruthy(); expect((await getObjective(page, objectives.orgId, high.id)).progress).toBe(80); expect((await getObjective(page, objectives.orgId, second.id)).progress).toBe(0);
});
test('prerequisites permit metric work and require completion override with persistent assessment', async ({ page, objectives }, info) => {
  const prerequisite = await objectives.create({ title: 'Unfinished prerequisite', state: 'draft' }); const dependent = await objectives.metric(await objectives.create({ title: 'Dependent delivery' }), { current: 60 });
  await page.goto(`/objectives/${dependent.id}`); await uiLink(page, 'prerequisite', 'Unfinished prerequisite'); await expect(page.getByRole('complementary', { name: 'Unfinished prerequisites', exact: true })).toBeVisible();
  await page.getByLabel('Update current value').fill('75'); await page.getByRole('button', { name: 'Update metric', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '75');
  let fresh = await getObjective(page, objectives.orgId, dependent.id); const denied = await mutation(page, `orgs/${objectives.orgId}/objectives/${dependent.id}/lifecycle`, { state: 'completed', note: 'Delivered', version: fresh.version }); expect(denied.status()).toBe(409);
  await page.getByLabel('New lifecycle').selectOption('completed'); await page.getByLabel('Closing note', { exact: true }).fill('Delivered the independent outcome'); await expect(page.getByLabel('Prerequisite override note')).toHaveAttribute('required', ''); await page.getByLabel('Prerequisite override note').fill('Prerequisite is deferred to next quarter');
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/blockers-${info.project.name}.png`, fullPage: true }); await page.getByRole('button', { name: 'Apply lifecycle', exact: true }).click(); await expect(page.getByText('Closing note · Frozen score 75%', { exact: true })).toBeVisible(); await expect(page.getByText('Prerequisite is deferred to next quarter', { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByText('Prerequisite is deferred to next quarter', { exact: true })).toBeVisible();
  fresh = await getObjective(page, objectives.orgId, prerequisite.id); await mutation(page, `orgs/${objectives.orgId}/objectives/${prerequisite.id}/lifecycle`, { state: 'active', version: fresh.version }); fresh = await getObjective(page, objectives.orgId, prerequisite.id); await mutation(page, `orgs/${objectives.orgId}/objectives/${prerequisite.id}/lifecycle`, { state: 'completed', note: 'Prerequisite completed', version: fresh.version });
  await page.getByRole('button', { name: 'Reload objective', exact: true }).click(); await expect(page.getByRole('complementary', { name: 'Unfinished prerequisites', exact: true })).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
test('graph layout, selection, zoom, filter indicators and keyboard list navigation show real connections', async ({ page, objectives }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const parent = await objectives.create({ title: 'Graph parent', progressMode: 'children' }); const other = await objectives.create({ title: 'Graph second parent', progressMode: 'children' }); const child = await objectives.metric(await objectives.create({ title: 'Graph shared child' }), { current: 80 });
  await apiLink(page, objectives.orgId, parent.id, child.id); await apiLink(page, objectives.orgId, other.id, parent.id, 'alignment', 3); await apiLink(page, objectives.orgId, child.id, parent.id, 'dependency');
  await openGraph(page); await expect(page.getByRole('heading', { name: 'Alignment and prerequisites', exact: true })).toBeVisible(); await expect(page.getByLabel('Objective Graph parent', { exact: true })).toBeVisible(); await expect(page.getByLabel('Objective Graph shared child', { exact: true })).toBeVisible();
  await page.getByLabel('Objective Graph parent', { exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Objective details', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Graph parent', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Close objective details', exact: true }).click(); await page.getByRole('button', { name: 'Zoom In', exact: true }).click(); await page.getByRole('button', { name: 'Zoom Out', exact: true }).click(); await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/alignment-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByLabel('Search graph objectives').fill('Graph parent'); const list = page.getByRole('region', { name: 'Graph list alternative', exact: true }); await expect(list.getByText('2 connected objective(s) outside filters', { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByLabel('Search graph objectives')).toHaveValue('Graph parent');
  await page.getByLabel('Search graph objectives').fill(''); await page.getByLabel('Graph type').selectOption('dependency'); await expect(page.getByLabel('Search graph objectives')).toHaveValue(''); await expect(list.getByText('Prerequisite:', { exact: false })).toBeVisible(); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/dependencies-${info.project.name}.png`, fullPage: true });
  const target = list.getByRole('button', { name: 'Graph parent', exact: true }).first(); await target.focus(); await expect(target).toBeFocused(); await target.press('Enter'); await expect(page.getByRole('dialog', { name: 'Objective details', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Graph parent', exact: true })).toBeVisible(); await page.keyboard.press('Escape'); await expect(target).toBeFocused(); expect(errors).toEqual([]);
});
test('graph objective panel shows lead and team, saves real edits, handles conflicts and restores keyboard focus', async ({ page, objectives }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const lead = await objectives.member('member', 'Team Lead');
  const response = await mutation(page, `orgs/${objectives.orgId}/teams`, { name: 'Delivery team', description: '' }); expect(response.status(), await response.text()).toBe(201); const team = await response.json();
  await objectives.metric(await objectives.create({ title: 'Team graph outcome', scope: 'team', teamId: team.id, leadId: lead.id, description: 'A measurable team outcome.' }));
  await openGraph(page); const node = page.getByLabel('Objective Team graph outcome', { exact: true });
  await expect(node.getByText('TL', { exact: true })).toBeVisible(); await expect(node.getByText('Lead: Team Lead', { exact: true })).toBeVisible(); await expect(node.getByRole('img', { name: 'Team objective: Delivery team', exact: true })).toBeVisible(); await expect(node.getByText('Team: Delivery team', { exact: true })).toHaveCount(0);
  await node.focus(); await node.press('Enter'); const panel = page.getByRole('dialog', { name: 'Objective details', exact: true });
  await expect(panel.getByRole('heading', { name: 'Team graph outcome', exact: true })).toBeVisible(); await expect(panel.getByText('A measurable team outcome.', { exact: true })).toBeVisible(); await expect(panel.getByRole('button', { name: 'Close objective details', exact: true })).toBeFocused();
  await panel.getByRole('button', { name: 'Edit objective', exact: true }).click(); await panel.getByLabel('Objective title', { exact: true }).fill('Updated team graph outcome'); await panel.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(panel.getByRole('heading', { name: 'Updated team graph outcome', exact: true })).toBeVisible();
  await panel.getByLabel('Update current value').fill('85'); await panel.getByRole('button', { name: 'Update metric', exact: true }).click(); await expect(panel.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '85');
  const id = (await panel.getByRole('link', { name: 'Open full objective page', exact: true }).getAttribute('href'))!.split('/').pop()!; let saved = await getObjective(page, objectives.orgId, id); expect(saved.title).toBe('Updated team graph outcome'); expect(saved.keyResults[0].current).toBe(85);
  await panel.getByRole('button', { name: 'Edit objective', exact: true }).click(); saved = await (await mutation(page, `orgs/${objectives.orgId}/objectives/${id}`, { ...saved, title: 'Concurrent team update' }, 'PATCH')).json();
  await panel.getByLabel('Objective title', { exact: true }).fill('Stale panel update'); await panel.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('This record changed'); await panel.getByRole('button', { name: 'Reload objective', exact: true }).click(); await expect(panel.getByLabel('Objective title', { exact: true })).toHaveValue('Concurrent team update'); await panel.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await expect(panel).toHaveCSS('position', 'fixed'); expect(await panel.evaluate(element => element.getBoundingClientRect().top)).toBe(0); await panel.getByRole('heading', { name: 'Change history', exact: true }).scrollIntoViewIfNeeded(); await expect(panel.getByRole('button', { name: 'Close objective details', exact: true })).toBeVisible(); await panel.getByRole('heading', { name: 'Concurrent team update', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/objective-panel-${info.project.name}.png` }); expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(page.getByLabel('Objective Concurrent team update', { exact: true })).toBeFocused(); await expect(page.getByRole('region', { name: 'Graph list alternative', exact: true })).toContainText('85%');
  await page.getByLabel('Search graph objectives').fill('Concurrent team update'); await page.getByRole('region', { name: 'Graph list alternative', exact: true }).getByRole('button', { name: 'Concurrent team update', exact: true }).click(); await panel.getByRole('button', { name: 'Edit objective', exact: true }).click(); await panel.getByLabel('Objective title', { exact: true }).fill('Outside current filter'); await panel.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(panel.getByRole('heading', { name: 'Outside current filter', exact: true })).toBeVisible(); await expect(page.getByText('No objectives match these filters.', { exact: true })).toBeVisible(); await panel.getByRole('button', { name: 'Close objective details', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Alignment and prerequisites', exact: true })).toBeFocused(); await page.getByLabel('Search graph objectives').fill('');
  await page.getByLabel('Graph type').selectOption('dependency'); const list = page.getByRole('region', { name: 'Graph list alternative', exact: true }); await list.getByRole('button', { name: 'Outside current filter', exact: true }).click(); await expect(panel.getByText('Lead: Team Lead', { exact: true })).toBeVisible(); await expect(panel.getByText('Team: Delivery team', { exact: true })).toBeVisible(); await panel.getByRole('link', { name: 'Open full objective page', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/objectives/${id}$`)); await expect(page.getByRole('heading', { name: 'Outside current filter', exact: true })).toBeVisible(); expect(errors).toEqual([]);
});

test('collapsed graph filters preserve query and both graphs read left to right without arrow labels', async ({ page, objectives }, info) => {
  const parent = await objectives.create({ title: 'Horizontal parent' }); const child = await objectives.create({ title: 'Horizontal child' }); await apiLink(page, objectives.orgId, parent.id, child.id, 'alignment', 3); await apiLink(page, objectives.orgId, parent.id, child.id, 'dependency');
  await page.goto('/alignment'); const toggle = page.getByRole('button', { name: 'Show filters', exact: true }); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(page.getByLabel('Search graph objectives')).toBeHidden(); await toggle.focus(); await toggle.press('Enter'); await expect(page.getByRole('button', { name: 'Hide filters', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const left = page.getByLabel('Objective Horizontal parent', { exact: true }); const right = page.getByLabel('Objective Horizontal child', { exact: true }); await expect(left).toBeVisible(); await expect(right).toBeVisible(); await expect(async () => { const a = await left.boundingBox(); const b = await right.boundingBox(); expect(a!.x + a!.width).toBeLessThan(b!.x); }).toPass({ timeout: 5000 }); await expect(page.locator('.react-flow__edge-text')).toHaveCount(0);
  await page.getByLabel('Search graph objectives').fill('Horizontal'); await expect(page).toHaveURL(/search=Horizontal/); await page.getByRole('button', { name: 'Hide filters', exact: true }).click(); await expect(page.getByText('Alignment · 1 active filter', { exact: true })).toBeVisible(); await expect(left).toBeVisible(); await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await expect(page.getByLabel('Search graph objectives')).toHaveValue('Horizontal'); await page.reload(); await expect(page.getByLabel('Search graph objectives')).toHaveValue('Horizontal');
  await page.getByLabel('Graph type').selectOption('dependency'); await expect(page.getByRole('region', { name: 'Graph list alternative', exact: true }).getByText('Dependent:', { exact: false })).toBeVisible(); await expect(async () => { const a = await left.boundingBox(); const b = await right.boundingBox(); expect(a!.x + a!.width).toBeLessThan(b!.x); }).toPass({ timeout: 5000 }); await expect(page.locator('.react-flow__edge-text')).toHaveCount(0); await page.getByRole('button', { name: 'Hide filters', exact: true }).click(); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/horizontal-graph-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('selected parent creates a linked child in its panel and stale creation recovers without an orphan', async ({ page, objectives }, info) => {
  const periodResponse = await mutation(page, `orgs/${objectives.orgId}/periods`, { kind: 'custom', name: 'Child creation period', startDate: '2026-01-01', endDate: '2026-03-31' }); expect(periodResponse.status()).toBe(201); const period = await periodResponse.json(); const parent = await objectives.create({ title: 'Selected child parent', periodId: period.id, progressMode: 'children' });
  await page.goto('/alignment'); await page.getByRole('region', { name: 'Graph list alternative', exact: true }).getByRole('button', { name: parent.title, exact: true }).click(); const panel = page.getByRole('dialog', { name: 'Objective details', exact: true }); await panel.getByRole('button', { name: 'Create child objective', exact: true }).click(); const form = panel.getByRole('region', { name: 'New child objective', exact: true }); await expect(form.getByLabel('Start date', { exact: true })).toHaveValue('2026-01-01'); await expect(form.getByLabel('End date', { exact: true })).toHaveValue('2026-03-31'); await expect(form.getByLabel('Objective planning period')).toHaveValue(period.id);
  await panel.getByRole('button', { name: 'Cancel child objective', exact: true }).click(); expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives`)).json()).total).toBe(1); await panel.getByRole('button', { name: 'Create child objective', exact: true }).click(); await form.getByLabel('Objective title', { exact: true }).fill('Linked child from panel');
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/create-child-${info.project.name}.png` }); await form.getByRole('button', { name: 'Create child objective', exact: true }).click(); await expect(panel.getByRole('status')).toContainText('Child objective created: Linked child from panel'); await expect(panel.getByRole('article', { name: 'Aligned child: Linked child from panel', exact: true })).toBeVisible();
  const graph = await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/graph`)).json(); const child = graph.nodes.find((o: any) => o.title === 'Linked child from panel'); expect(child).toBeTruthy(); expect(graph.links).toEqual([expect.objectContaining({ sourceId: parent.id, targetId: child.id, type: 'alignment', weight: 1 })]); await panel.getByRole('status').getByRole('button', { name: child.title, exact: true }).click(); await expect(panel.getByRole('heading', { name: child.title, exact: true })).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByLabel(`Objective ${child.title}`, { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await page.getByLabel('Graph type').selectOption('dependency'); await page.getByRole('button', { name: 'Hide filters', exact: true }).click(); await expect(page.getByText('Prerequisites · Unarchived objectives', { exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Graph list alternative', exact: true }).getByRole('button', { name: parent.title, exact: true }).first().click(); await panel.getByRole('button', { name: 'Create child objective', exact: true }).click(); const fresh = await getObjective(page, objectives.orgId, parent.id); await mutation(page, `orgs/${objectives.orgId}/objectives/${parent.id}`, { ...fresh, description: 'Concurrent parent edit' }, 'PATCH'); await form.getByLabel('Objective title', { exact: true }).fill('Recoverable child'); await form.getByRole('button', { name: 'Create child objective', exact: true }).click(); await expect(form.getByRole('alert')).toContainText('This record changed'); expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives`)).json()).total).toBe(2);
  await panel.getByRole('button', { name: 'Reload objective', exact: true }).click(); await expect(form.getByLabel('Objective title', { exact: true })).toHaveValue(''); await form.getByLabel('Objective title', { exact: true }).fill('Recoverable child'); await form.getByRole('button', { name: 'Create child objective', exact: true }).click(); await expect(panel.getByRole('status')).toContainText('Child objective created: Recoverable child'); expect((await (await page.request.get(`/api/v1/orgs/${objectives.orgId}/objectives`)).json()).total).toBe(3); expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
});

test('relationship weight conflicts recover on reload and viewers have read-only relationship views', async ({ page, objectives, browser }, info) => {
  const viewer = await objectives.member('viewer', 'Graph Viewer'); const parent = await objectives.create({ title: 'Conflict parent', progressMode: 'children' }); const child = await objectives.metric(await objectives.create({ title: 'Conflict child' })); await apiLink(page, objectives.orgId, parent.id, child.id);
  await page.goto(`/objectives/${parent.id}`); const row = page.getByRole('article', { name: 'Aligned child: Conflict child', exact: true }); await expect(row.getByLabel('Contribution weight')).toHaveValue('1');
  const fresh = await getObjective(page, objectives.orgId, child.id); await mutation(page, `orgs/${objectives.orgId}/objectives/${child.id}/key-results/${fresh.keyResults[0].id}/current`, { current: 90, version: fresh.keyResults[0].version, objectiveVersion: fresh.version }, 'PATCH');
  await row.getByLabel('Contribution weight').fill('2'); await row.getByRole('button', { name: 'Save weight', exact: true }).click(); await expect(row.getByRole('alert')).toContainText('This record changed'); await page.getByRole('button', { name: 'Reload objective', exact: true }).click(); await expect(row.getByLabel('Contribution weight')).toHaveValue('1'); await row.getByLabel('Contribution weight').fill('2'); await row.getByRole('button', { name: 'Save weight', exact: true }).click(); await expect(row.getByLabel('Contribution weight')).toHaveValue('2');
  const context = await browser.newContext({ viewport: info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 960 } }); const reader = await context.newPage();
  try { await login(reader, viewer.email); await reader.goto(`/objectives/${parent.id}`); await expect(reader.getByRole('article', { name: 'Aligned child: Conflict child', exact: true })).toBeVisible(); await expect(reader.getByRole('button', { name: 'Connect objective', exact: true })).toHaveCount(0); await expect(reader.getByRole('button', { name: 'Save weight', exact: true })).toHaveCount(0); await reader.goto('/alignment'); await expect(reader.getByRole('region', { name: 'Graph list alternative', exact: true })).toBeVisible(); await reader.getByRole('region', { name: 'Graph list alternative', exact: true }).getByRole('button', { name: 'Conflict parent', exact: true }).first().click(); const panel = reader.getByRole('dialog', { name: 'Objective details', exact: true }); await expect(panel.getByRole('heading', { name: 'Conflict parent', exact: true })).toBeVisible(); await expect(panel.getByRole('button', { name: 'Edit objective', exact: true })).toHaveCount(0); await expect(panel.getByRole('button', { name: 'Save weight', exact: true })).toHaveCount(0); await expect(panel.getByRole('button', { name: 'Remove relationship', exact: true })).toHaveCount(0); await expect(panel.getByRole('button', { name: 'Create child objective', exact: true })).toHaveCount(0); } finally { await context.close(); }
});

test('company co-owners retain scope while editing and assignments are created through the form', async ({ page, objectives, browser }) => {
  const coowner = await objectives.member('member', 'Company Co-owner'); const contributor = await objectives.member('member', 'Company Contributor');
  await page.goto('/objectives/new'); await page.getByLabel('Objective title', { exact: true }).fill('Company outcome'); await page.getByRole('combobox', { name: 'Scope', exact: true }).selectOption('company');
  await page.getByRole('button', { name: 'Add assignment', exact: true }).click(); await page.getByLabel('Find a member').fill(coowner.email); await page.getByRole('button', { name: /Company Co-owner/ }).click();
  await page.getByRole('button', { name: 'Add assignment', exact: true }).click(); await page.getByLabel('Find a member').fill(contributor.email); await page.getByRole('button', { name: /Company Contributor/ }).click(); await page.getByRole('combobox', { name: 'Assignment role for Company Contributor', exact: true }).selectOption('contributor');
  await page.getByRole('button', { name: 'Create objective', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Company outcome', exact: true })).toBeVisible(); const path = new URL(page.url()).pathname;
  const context = await browser.newContext(); const editor = await context.newPage();
  try { await login(editor, coowner.email); await editor.goto(path); await editor.getByRole('button', { name: 'Edit objective', exact: true }).click(); await expect(editor.getByRole('combobox', { name: 'Scope', exact: true })).toHaveValue('company'); await editor.getByLabel('Objective title', { exact: true }).fill('Company outcome revised'); await editor.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(editor.getByRole('heading', { name: 'Company outcome revised', exact: true })).toBeVisible(); const item = await (await editor.request.get(`/api/v1/orgs/${objectives.orgId}${path}`)).json(); expect(item.scope).toBe('company'); expect(item.assignments).toHaveLength(2); }
  finally { await context.close(); }
});

test('quarter planning, objective creation, weighted metrics, completion, archive and reopen', async ({ page, objectives }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/periods'); await page.getByLabel('Year', { exact: true }).fill('2026'); await page.getByRole('combobox', { name: 'Quarter', exact: true }).selectOption('1'); await page.getByRole('button', { name: 'Create period', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Q1 2026', exact: true })).toBeVisible();
  await page.goto('/objectives/new'); await page.getByLabel('Objective title', { exact: true }).fill('Improve customer outcomes'); await page.getByLabel('Description', { exact: true }).fill('Deliver measurable improvements for customers.'); await page.getByRole('combobox', { name: 'Objective planning period', exact: true }).selectOption({ label: 'Q1 2026' }); await expect(page.getByLabel('End date', { exact: true })).toHaveValue('2026-03-31');
  await page.getByRole('button', { name: 'Create objective', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Improve customer outcomes', exact: true })).toBeVisible(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Add key result', exact: true }).click(); await page.getByLabel('Key result title').fill('Increase activation'); await page.getByLabel('Current value', { exact: true }).fill('25'); await page.getByRole('button', { name: 'Save key result', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Increase activation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add key result', exact: true }).click(); await page.getByLabel('Key result title').fill('Reduce support wait'); await page.getByLabel('Baseline', { exact: true }).fill('100'); await page.getByLabel('Target', { exact: true }).fill('0'); await page.getByLabel('Current value', { exact: true }).fill('50'); await page.getByLabel('Weight', { exact: true }).fill('3'); await page.getByRole('button', { name: 'Save key result', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '43.75');
  const metric = page.getByRole('region', { name: 'Increase activation', exact: true }); await metric.getByLabel('Update current value').fill('100'); await metric.getByRole('button', { name: 'Update metric', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '62.5');
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/objectives-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByLabel('New lifecycle').selectOption('completed'); await page.getByLabel('Closing note', { exact: true }).fill('Improved activation; wait reduction continues next quarter.'); await page.getByRole('button', { name: 'Apply lifecycle', exact: true }).click(); await expect(page.getByText('Closing note · Frozen score 62.5%', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Update metric', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive objective', exact: true }).click(); await page.getByRole('button', { name: 'Confirm archive', exact: true }).click(); await expect(page.getByRole('button', { name: 'Unarchive objective', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unarchive objective', exact: true }).click(); await page.getByRole('button', { name: 'Confirm unarchive', exact: true }).click(); await expect(page.getByLabel('New lifecycle')).toHaveValue('active'); await page.getByRole('button', { name: 'Apply lifecycle', exact: true }).click(); await expect(metric.getByRole('button', { name: 'Update metric', exact: true })).toBeVisible(); await expect(page.getByText('Objective reopened', { exact: true })).toBeVisible(); expect(errors).toEqual([]);
});

test('explorer filters persist, totals stay unique and overview uses real active scores', async ({ page, objectives }, info) => {
  const objective = await objectives.create({ title: 'Unique planning objective' }); await objectives.metric(objective, { ownerId: objectives.leadId, current: 80 }); await objectives.create({ title: 'Draft plan', state: 'draft' });
  await page.goto('/overview'); await expect(page.getByText('80%', { exact: true }).first()).toBeVisible();
  await page.goto('/my-objectives'); await expect(page.getByRole('link', { name: 'Unique planning objective', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await page.getByLabel('Search objectives').fill('Unique'); await page.getByLabel('From date').fill('2026-03-31'); await page.getByLabel('To date').fill('2026-03-31'); await expect(page.getByRole('link', { name: 'Draft plan', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByLabel('Search objectives')).toHaveValue('Unique'); await expect(page.getByLabel('From date')).toHaveValue('2026-03-31'); await expect(page.getByRole('link', { name: 'Unique planning objective', exact: true })).toBeVisible();
  await page.getByLabel('Lifecycle filter').selectOption('completed'); await expect(page.getByRole('heading', { name: 'No objectives match', exact: true })).toBeVisible();
  await page.getByLabel('Lifecycle filter').selectOption('active'); await expect(page.getByRole('link', { name: 'Unique planning objective', exact: true })).toBeVisible(); await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/explorer-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('contributors update metrics and viewers follow without structural editing', async ({ page, objectives, browser }, info) => {
  const contributor = await objectives.member('member', 'Metric Contributor'); const viewer = await objectives.member('viewer', 'Read Only');
  const created = await objectives.create({ title: 'Shared outcome', assignments: [{ membershipId: contributor.id, role: 'contributor' }] }); const objective = await objectives.metric(created); const path = `/objectives/${objective.id}`;
  const context = await browser.newContext({ viewport: info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 960 } }); const member = await context.newPage();
  try {
    await login(member, contributor.email); await member.goto(path); await expect(member.getByRole('heading', { name: 'Shared outcome', exact: true })).toBeVisible(); await expect(member.getByRole('button', { name: 'Edit objective', exact: true })).toHaveCount(0); await expect(member.getByRole('button', { name: 'Add key result', exact: true })).toHaveCount(0); await member.getByLabel('Update current value').fill('70'); await member.getByRole('button', { name: 'Update metric', exact: true }).click(); await expect(member.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '70');
    await member.goto('/alignment'); await member.getByRole('region', { name: 'Graph list alternative', exact: true }).getByRole('button', { name: 'Shared outcome', exact: true }).click(); const panel = member.getByRole('dialog', { name: 'Objective details', exact: true }); await expect(panel.getByRole('button', { name: 'Edit objective', exact: true })).toHaveCount(0); await expect(panel.getByRole('button', { name: 'Create child objective', exact: true })).toHaveCount(0); await panel.getByLabel('Update current value').fill('75'); await panel.getByRole('button', { name: 'Update metric', exact: true }).click(); await expect(panel.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '75');
    expect((await mutation(member, `orgs/${objectives.orgId}/objectives/${objective.id}/ownership`, { leadId: contributor.id, assignments: [], version: 3 }, 'PATCH')).status()).toBe(403);
  } finally { await context.close(); }
  const readContext = await browser.newContext({ viewport: info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 960 } }); const reader = await readContext.newPage();
  try { await login(reader, viewer.email); await reader.goto(path); await expect(reader.getByRole('button', { name: 'Follow objective', exact: true })).toBeVisible(); await expect(reader.getByRole('button', { name: 'Update metric', exact: true })).toHaveCount(0); await reader.getByRole('button', { name: 'Follow objective', exact: true }).click(); await expect(reader.getByRole('button', { name: 'Unfollow objective', exact: true })).toBeVisible(); await reader.goto('/my-objectives'); await expect(reader.getByRole('link', { name: 'Shared outcome', exact: true })).toBeVisible(); await expect(reader.getByRole('link', { name: 'New objective', exact: true })).toHaveCount(0); } finally { await readContext.close(); }
});

test('closed and archived ownership reassignment allows tenant suspension', async ({ page, objectives }) => {
  const departing = await objectives.member('member', 'Departing Lead'); const replacement = await objectives.member('member', 'Replacement Lead'); const coowner = await objectives.member('member', 'Departing Co-owner');
  let objective = await objectives.metric(await objectives.create({ title: 'Historical outcome', leadId: departing.id, assignments: [{ membershipId: coowner.id, role: 'coowner' }] }), { ownerId: departing.id, current: 72 });
  objective = await (await mutation(page, `orgs/${objectives.orgId}/objectives/${objective.id}/lifecycle`, { state: 'completed', note: 'Preserve historical score', version: objective.version })).json(); objective = await (await mutation(page, `orgs/${objectives.orgId}/objectives/${objective.id}/archive`, { archived: true, version: objective.version })).json();
  await page.goto('/members'); await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await page.getByLabel('Search members').fill(departing.email); const card = page.getByRole('article').filter({ hasText: departing.email }); await expect(card.getByRole('checkbox', { name: 'Active', exact: true })).toBeChecked(); await card.getByRole('checkbox', { name: 'Active', exact: true }).uncheck(); await card.getByRole('button', { name: 'Save member', exact: true }).click(); await expect(card.getByRole('alert')).toContainText('Reassign objective leads');
  await page.goto(`/objectives/${objective.id}`); await expect(page.getByRole('heading', { name: 'Historical outcome', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Change lead', exact: true }).click(); await page.getByLabel('Find a member').fill(replacement.email); await page.getByRole('button', { name: /Replacement Lead/ }).click(); await page.getByRole('button', { name: 'Remove assignment for Departing Co-owner', exact: true }).click(); await page.getByRole('button', { name: 'Save ownership', exact: true }).click(); await expect(page.getByText(replacement.email, { exact: true })).toBeVisible();
  const metric = page.getByRole('region', { name: 'Browser metric', exact: true }); await metric.getByRole('button', { name: 'Reassign metric owner', exact: true }).click(); await metric.getByRole('button', { name: 'Choose metric owner', exact: true }).click(); await metric.getByLabel('Find a member').fill(replacement.email); await metric.getByRole('button', { name: /Replacement Lead/ }).click(); await metric.getByRole('button', { name: 'Save metric owner', exact: true }).click(); await expect(metric.getByText('Metric owner:')).toHaveCount(0); await expect(metric).toContainText('Replacement Lead'); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '72');
  await page.goto('/members'); await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await page.getByLabel('Search members').fill(departing.email); await expect(card.getByRole('checkbox', { name: 'Active', exact: true })).toBeChecked(); await card.getByRole('checkbox', { name: 'Active', exact: true }).uncheck(); await card.getByRole('button', { name: 'Save member', exact: true }).click(); await expect(card.getByRole('status')).toContainText('Membership saved');
});

test('stale objective and metric forms report conflicts and recover through reload', async ({ page, objectives }) => {
  let objective = await objectives.metric(await objectives.create({ title: 'Conflict outcome' })); await page.goto(`/objectives/${objective.id}`); await expect(page.getByRole('heading', { name: 'Conflict outcome', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Edit objective', exact: true }).click(); await expect(page.getByLabel('Objective title', { exact: true })).toHaveValue('Conflict outcome');
  objective = await (await mutation(page, `orgs/${objectives.orgId}/objectives/${objective.id}`, { ...objective, title: 'Concurrent title' }, 'PATCH')).json(); await page.getByLabel('Objective title', { exact: true }).fill('Stale title'); await page.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('This record changed'); await page.getByRole('button', { name: 'Reload objective', exact: true }).click(); await expect(page.getByLabel('Objective title', { exact: true })).toHaveValue('Concurrent title'); await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  const kr = objective.keyResults[0]; expect((await mutation(page, `orgs/${objectives.orgId}/objectives/${objective.id}/key-results/${kr.id}/current`, { current: 90, version: kr.version, objectiveVersion: objective.version }, 'PATCH')).status()).toBe(200); await page.getByLabel('Update current value').fill('10'); await page.getByRole('button', { name: 'Update metric', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('This record changed'); await page.getByRole('button', { name: 'Reload objective', exact: true }).click(); await expect(page.getByLabel('Update current value')).toHaveValue('90');
});

test('custom periods, binary metrics and draft child-mode feedback use real APIs', async ({ page, objectives }) => {
  await page.goto('/periods'); await page.getByLabel('Period type').selectOption('custom'); await page.getByLabel('New period name').fill('One day plan'); await page.getByLabel('New period start date').fill('2028-02-29'); await page.getByLabel('New period end date').fill('2028-02-29'); await page.getByRole('button', { name: 'Create period', exact: true }).click(); await expect(page.getByRole('heading', { name: 'One day plan', exact: true })).toBeVisible();
  await page.goto('/objectives/new'); await page.getByLabel('Objective title', { exact: true }).fill('Draft child plan'); await page.getByLabel('Initial lifecycle').selectOption('draft'); await page.getByLabel('Progress mode').selectOption('children'); await page.getByRole('button', { name: 'Create objective', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Draft child plan', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Apply lifecycle', exact: true }).click(); await expect(page.getByText('Objective active', { exact: true })).toBeVisible(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '0');
  const objective = await objectives.create({ title: 'Binary launch' }); await page.goto(`/objectives/${objective.id}`); await page.getByRole('button', { name: 'Add key result', exact: true }).click(); await page.getByLabel('Key result title').fill('Launch complete'); await page.getByLabel('Metric type').selectOption('binary'); await page.getByLabel('Current outcome').selectOption('1'); await page.getByRole('button', { name: 'Save key result', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('button', { name: 'Remove key result', exact: true }).click(); await page.getByRole('button', { name: 'Confirm remove key result', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '0'); await expect(page.getByText('Key result removed: Launch complete', { exact: true })).toBeVisible();
});
