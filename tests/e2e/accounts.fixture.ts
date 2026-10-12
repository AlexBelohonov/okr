import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

export const password = 'Secure browser password 2026';
export const newPassword = 'New secure browser password 2026';
export const uniqueEmail = () => `${randomUUID()}@browser.accounts.example`;
export async function mutate(request: APIRequestContext, path: string, payload: unknown) {
  const session = await request.get('/api/v1/auth/session');
  return request.post(`/api/v1/auth/${path}`, { data: payload, headers: { Origin: 'http://web', 'X-CSRF-Token': (await session.json()).csrf } });
}
export async function createAccount(request: APIRequestContext, email: string) {
  const result = await mutate(request, 'signup', { name: 'Browser Reviewer', email, password, organization: 'Review Organization', timezone: 'America/Toronto' });
  if (result.status() !== 201) throw new Error(`Fixture signup failed: ${await result.text()}`);
}
export async function cleanupAccount(email: string) {
  const db = new PrismaClient();
  try {
    const user = await db.user.findUnique({ where: { email } });
    await db.emailOutbox.deleteMany({ where: { to: email } });
    if (!user) return;
    const memberships = await db.membership.findMany({ where: { userId: user.id } });
    const orgs = memberships.filter(m => m.role === 'owner').map(m => m.orgId);
    await db.auditEvent.deleteMany({ where: { OR: [{ userId: user.id }, { orgId: { in: orgs } }] } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.membership.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  } finally { await db.$disconnect(); }
}
