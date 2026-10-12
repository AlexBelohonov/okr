import { buildApp } from './app.js';
import { db } from './db.js';
import { validateEnvironment } from './operations/environment.js';

validateEnvironment();
const app = await buildApp();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.close();
  await db.$disconnect();
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
try {
  await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3000) });
} catch {
  app.log.error({ code: 'STARTUP_FAILED' }, 'Could not start API');
  await db.$disconnect();
  process.exitCode = 1;
}
