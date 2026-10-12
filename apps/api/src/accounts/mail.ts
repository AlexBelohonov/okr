import nodemailer from 'nodemailer';
import type { EmailOutbox, PrismaClient } from '@prisma/client';
import { db } from '../db.js';

export function smtpTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mailpit', port: Number(process.env.SMTP_PORT || 1025), secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.NODE_ENV === 'production' && process.env.SMTP_SECURE !== 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true
  });
}
export async function deliverOne(database: PrismaClient = db, send?: (row: EmailOutbox) => Promise<void>) {
  return database.$transaction(async tx => {
    // Retain the row lock through delivery so concurrent workers cannot claim the same email.
    const rows = await tx.$queryRaw<EmailOutbox[]>`SELECT * FROM "EmailOutbox" WHERE "sentAt" IS NULL AND attempts < 5 AND "nextAttemptAt" <= now() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
    const row = rows[0];
    if (!row) return false;
    try {
      if (send) await send(row);
      else {
        const transport = smtpTransport();
        try { await transport.sendMail({ from: process.env.MAIL_FROM || 'noreply@localhost', to: row.to, subject: row.subject, text: row.text, messageId: `<${row.id}@okr-workspace.local>` }); }
        finally { transport.close(); }
      }
      await tx.emailOutbox.update({ where: { id: row.id }, data: { attempts: row.attempts + 1, sentAt: new Date(), lastError: null, text: '[Delivered account message removed]' } });
    } catch {
      await tx.emailOutbox.update({ where: { id: row.id }, data: { attempts: row.attempts + 1, nextAttemptAt: new Date(Date.now() + 30000 * 2 ** row.attempts), lastError: 'SMTP delivery failed' } });
    }
    return true;
  }, { timeout: 20000, maxWait: 5000 });
}
