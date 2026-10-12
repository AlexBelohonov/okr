import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { db } from '../db.js';
import { accountConfig } from '../accounts/security.js';
import { validateEnvironment } from '../operations/environment.js';
import { bootstrapAdministrator } from './bootstrap.js';

try {
  validateEnvironment(); accountConfig();
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, 'password-stdin': { type: 'boolean', default: false } } });
  if (!values.email) throw new Error('--email is required');
  const password = values['password-stdin'] ? readFileSync(0, 'utf8').replace(/\r?\n$/, '') : undefined;
  const result = await bootstrapAdministrator(db, { email: values.email, name: values.name, password });
  process.stdout.write(JSON.stringify({ event: 'platform_admin_bootstrap', id: result.id, changed: result.changed, membershipsGranted: 0 }) + '\n');
} catch {
  process.stderr.write('Administrator bootstrap failed. Supply a valid email; new accounts require --name and a 12–128 character password on stdin. Existing active accounts require only --email. Check production configuration. Credentials were not changed.\n');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
