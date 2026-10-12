import type { Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { assertLiveSession, lockUser, type ActiveSession } from '../accounts/security.js';

// Every platform mutation/bootstrap takes this gate before account and tenant locks.
// It serializes last-admin checks and cross-account suspensions without lock inversion.
export async function lockPlatform(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(903109)::text`;
}
export async function platformWrite(tx: Prisma.TransactionClient, session: ActiveSession, targetId?: string) {
  await lockPlatform(tx);
  for (const id of [...new Set([session.userId, ...(targetId ? [targetId] : [])])].sort()) await lockUser(tx, id);
  await assertLiveSession(tx, session);
  const actor = await tx.user.findUniqueOrThrow({ where: { id: session.userId } });
  requirePlatform(actor);
  return actor;
}
export function requirePlatform(user: { platformAdmin: boolean }) {
  if (!user.platformAdmin) throw new ApiError(403, 'PLATFORM_FORBIDDEN', 'Platform administrator access required');
}
export const platformUserSelect = { id: true, email: true, name: true, active: true, verified: true, platformAdmin: true, version: true, createdAt: true } as const;
