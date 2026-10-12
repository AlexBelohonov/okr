import type { PrismaClient } from '@prisma/client';
import { email, password as passwordSchema } from '@okr/shared';
import { z } from 'zod';
import { hashPassword, lockUser } from '../accounts/security.js';
import { lockPlatform, platformUserSelect } from './access.js';

// Trusted host operation only; never called from signup or an HTTP endpoint.
export async function bootstrapAdministrator(database: PrismaClient, input: { email: string; name?: string; password?: string }) {
  const address = email.parse(input.email);
  const name = input.name === undefined ? undefined : z.string().trim().min(2).max(100).parse(input.name);
  const passwordHash = input.password === undefined ? undefined : await hashPassword(passwordSchema.parse(input.password));
  return database.$transaction(async tx => {
    await lockPlatform(tx);
    const existing = await tx.user.findUnique({ where: { email: address } });
    if (existing) {
      await lockUser(tx, existing.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: existing.id } });
      if (!current.active) throw new Error('Reactivate the account before promoting it');
      if (passwordHash || name) throw new Error('Existing account promotion does not change credentials or name; omit --name/--password-stdin');
      if (current.platformAdmin) return { ...await tx.user.findUniqueOrThrow({ where: { id: current.id }, select: platformUserSelect }), changed: false };
      const result = await tx.user.update({ where: { id: current.id }, data: { platformAdmin: true, version: { increment: 1 } }, select: platformUserSelect });
      await tx.auditEvent.create({ data: { userId: current.id, type: 'platform_admin_bootstrap', text: 'Trusted host operator explicitly promoted an existing platform administrator', data: { targetUserId: current.id, source: 'trusted_host', created: false } } });
      return { ...result, changed: true };
    }
    if (!name || !passwordHash) throw new Error('Creating an account requires --name and --password-stdin');
    const result = await tx.user.create({ data: { email: address, name, passwordHash, platformAdmin: true, verified: true }, select: platformUserSelect });
    await tx.auditEvent.create({ data: { userId: result.id, type: 'platform_admin_bootstrap', text: 'Trusted host operator explicitly created a platform administrator', data: { targetUserId: result.id, source: 'trusted_host', created: true } } });
    return { ...result, changed: true };
  });
}
