import { parseArgs } from 'node:util';
import { z } from 'zod';
import { email } from '@okr/shared';
import { db } from '../db.js';
import { mailStatus, retryMail } from './mail-operations.js';
import { accountConfig } from './security.js';

try {
  const { values } = parseArgs({ options: { retry: { type: 'string' }, actor: { type: 'string' } } });
  const config = accountConfig();
  if (values.retry) {
    if (config.emailMode !== 'smtp') throw new Error('SMTP required');
    console.log(JSON.stringify(await retryMail(db, z.string().uuid().parse(values.retry), email.parse(values.actor))));
  } else console.log(JSON.stringify({ deliveryEnabled: config.emailMode === 'smtp', ...await mailStatus(db) }));
} catch { process.stderr.write('Mail operation failed. Check database, SMTP mode, message ID, exhausted status and active actor.\n'); process.exitCode = 1; }
finally { await db.$disconnect(); }
