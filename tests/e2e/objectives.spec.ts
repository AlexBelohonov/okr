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

test('alignment collapse preserves card positions and shared children without main-objective stars', async ({ page, objectives }, info) => {
  const first = await objectives.create({ title: 'Main strategy one' });
  const second = await objectives.create({ title: 'Main strategy two' });
  const shared = await objectives.create({ title: 'Shared delivery branch' });
  const leaf = await objectives.create({ title: 'Nested delivery leaf' });
  await apiLink(page, objectives.orgId, first.id, shared.id);
  await apiLink(page, objectives.orgId, second.id, shared.id);
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
  await expect(node(shared.title)).toBeVisible(); await expect(node(leaf.title)).toBeVisible(); await expect(edges).toHaveCount(2);
  await expectFixed(titles);
  await node(shared.title).getByRole('button', { name: `Collapse children of ${shared.title}`, exact: true }).press('Space');
  await expect(node(leaf.title)).toHaveCount(0); await expect(node(shared.title)).toBeVisible();
  await expectFixed([first.title, second.title, shared.title]);
  await node(second.title).getByRole('button', { name: `Collapse children of ${second.title}`, exact: true }).click();
  await expect(node(shared.title)).toHaveCount(0); await expect(node(leaf.title)).toHaveCount(0); await expect(edges).toHaveCount(0);
  await expect(page.getByText('2 of 4 objectives visible', { exact: true })).toBeVisible();
  await expectFixed([first.title, second.title]);
  await node(first.title).getByRole('button', { name: `Expand children of ${first.title}`, exact: true }).click();
  await expect(node(shared.title)).toBeVisible(); await expect(node(leaf.title)).toHaveCount(0);
  await expectFixed([first.title, second.title, shared.title]);
  await page.getByRole('button', { name: 'Expand all children', exact: true }).click(); await expect(node(leaf.title)).toBeVisible();
  await expectFixed(titles);
  await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/r008-stable-expanded-${info.project.name}.png` });
  for (const title of [first.title, second.title]) await node(title).getByRole('button', { name: `Collapse children of ${title}`, exact: true }).click();
  await expect(node(shared.title)).toHaveCount(0); await expectFixed([first.title, second.title]);
  await page.locator('.graph-canvas').screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/r008-stable-collapsed-${info.project.name}.png` });
  await page.reload(); await expect(node(shared.title)).toHaveCount(0);
  await node(first.title).getByRole('button', { name: `Expand children of ${first.title}`, exact: true }).click();
  await expect(node(shared.title)).toBeVisible(); await expect(node(leaf.title)).toBeVisible();
  await page.getByRole('button', { name: 'Expand all children', exact: true }).click();
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
test('multiple alignment parents, weights, rollups, score modes and removal work through forms', async ({ page, objectives }, info) => {
  const parent = await objectives.create({ title: 'Strategic parent', progressMode: 'children' }); const second = await objectives.create({ title: 'Second parent', progressMode: 'children' });
  const low = await objectives.metric(await objectives.create({ title: 'Low child' }), { current: 20 }); const high = await objectives.metric(await objectives.create({ title: 'High child', startDate: '2026-04-01', endDate: '2026-06-30' }), { current: 80 });
  await page.goto(`/objectives/${parent.id}`); await uiLink(page, 'child', 'Low child'); await uiLink(page, 'child', 'High child', 3);
  await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '65');
  await expect(page.getByText('Different planning periods or dates', { exact: true })).toBeVisible();
  await page.goto(`/objectives/${low.id}`); await uiLink(page, 'parent', 'Second parent', 3); const panel = page.getByRole('region', { name: 'Relationships', exact: true });
  await expect(panel.getByRole('article', { name: 'Alignment parent: Strategic parent', exact: true })).toBeVisible(); await expect(panel.getByRole('article', { name: 'Alignment parent: Second parent', exact: true })).toBeVisible();
  await page.goto(`/objectives/${parent.id}`); const row = page.getByRole('article', { name: 'Aligned child: Low child', exact: true }); await row.getByLabel('Contribution weight').fill('3'); await row.getByRole('button', { name: 'Save weight', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Edit objective', exact: true }).click(); await page.getByLabel('Progress mode').selectOption('key_results'); await page.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Edit objective', exact: true }).click(); await page.getByLabel('Progress mode').selectOption('children'); await page.getByRole('button', { name: 'Save objective', exact: true }).click(); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '50');
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/relationships-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await row.getByRole('button', { name: 'Remove relationship', exact: true }).click(); await row.getByRole('button', { name: 'Confirm remove relationship', exact: true }).click(); await expect(row).toHaveCount(0); await expect(page.getByRole('progressbar', { name: 'Objective progress', exact: true })).toHaveAttribute('aria-valuenow', '80');
  expect((await page.request.get(`/api/v1/orgs/${objectives.orgId}/objective-summary`)).ok()).toBeTruthy(); expect((await getObjective(page, objectives.orgId, high.id)).progress).toBe(80); expect((await getObjective(page, objectives.orgId, second.id)).progress).toBe(20);
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
  await apiLink(page, objectives.orgId, parent.id, child.id); await apiLink(page, objectives.orgId, other.id, child.id, 'alignment', 3); await apiLink(page, objectives.orgId, child.id, parent.id, 'dependency');
  await openGraph(page); await expect(page.getByRole('heading', { name: 'Alignment and prerequisites', exact: true })).toBeVisible(); await expect(page.getByLabel('Objective Graph parent', { exact: true })).toBeVisible(); await expect(page.getByLabel('Objective Graph shared child', { exact: true })).toBeVisible();
  await page.getByLabel('Objective Graph parent', { exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Objective details', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Graph parent', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Close objective details', exact: true }).click(); await page.getByRole('button', { name: 'Zoom In', exact: true }).click(); await page.getByRole('button', { name: 'Zoom Out', exact: true }).click(); await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'artifacts'}/alignment-${info.project.name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByLabel('Search graph objectives').fill('Graph parent'); const list = page.getByRole('region', { name: 'Graph list alternative', exact: true }); await expect(list.getByText('1 connected objective(s) outside filters', { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByLabel('Search graph objectives')).toHaveValue('Graph parent');
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
