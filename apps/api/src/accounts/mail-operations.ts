import type { PrismaClient, EmailOutbox } from '@prisma/client';
import { lockUser } from './security.js';

// Global mail is available only through trusted host access, never tenant HTTP routes.
export async function mailStatus(database: PrismaClient) {
  return database.$transaction(async tx => {
    const select = { id: true, attempts: true, nextAttemptAt: true, sentAt: true, createdAt: true } as const;
    const [sent, pending, retrying, failed, latest, failures] = await Promise.all([
      tx.emailOutbox.count({ where: { sentAt: { not: null } } }),
      tx.emailOutbox.count({ where: { sentAt: null, attempts: 0 } }),
      tx.emailOutbox.count({ where: { sentAt: null, attempts: { gt: 0, lt: 5 } } }),
      tx.emailOutbox.count({ where: { sentAt: null, attempts: { gte: 5 } } }),
      tx.emailOutbox.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, select }),
      tx.emailOutbox.findMany({ where: { sentAt: null, attempts: { gte: 5 } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50, select })
    ]);
    return { sent, pending, retrying, failed, latest, failures };
  }, { isolationLevel: 'RepeatableRead' });
}
export async function retryMail(database: PrismaClient, id: string, actorEmail: string) {
  return database.$transaction(async tx => {
    const actor = await tx.user.findUniqueOrThrow({ where: { email: actorEmail } }); await lockUser(tx, actor.id);
    const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id } }); if (!current.active) throw new Error('Inactive actor');
    const rows = await tx.$queryRaw<EmailOutbox[]>`SELECT * FROM "EmailOutbox" WHERE id = ${id}::uuid FOR UPDATE`;
    const row = rows[0]; if (!row || row.sentAt || row.attempts < 5) throw new Error('Only exhausted, unsent messages can be retried');
    await tx.emailOutbox.update({ where: { id }, data: { attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    await tx.auditEvent.create({ data: { userId: actor.id, type: 'operator_mail_retry', text: 'Trusted host operator retried an exhausted message', data: { outboxId: id, previousAttempts: row.attempts } } });
    return { id, status: 'queued' };
  });
}
