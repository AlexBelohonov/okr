import { db } from './db.js';
import { accountConfig } from './accounts/security.js';
import { deliverOne } from './accounts/mail.js';
import { validateEnvironment } from './operations/environment.js';
import { deliverSlack, slackKey } from './slack/service.js';

validateEnvironment();
const config = accountConfig();
let stopping = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
console.log(JSON.stringify({ event: 'worker_ready', deliveryEnabled: config.emailMode === 'smtp', slackEnabled: Boolean(slackKey()) }));
async function tick() {
  running = true;
  let delay = 3000;
  try {
    if (config.emailMode === 'smtp' && await deliverOne()) delay = 50;
    if (await deliverSlack()) delay = 50;
  } catch {
    console.error(JSON.stringify({ event: 'worker_database_unavailable' }));
  }
  running = false;
  if (!stopping) timer = setTimeout(() => { timer = undefined; void tick(); }, delay);
  else await db.$disconnect();
}
async function stop() {
  stopping = true;
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (!running) await db.$disconnect();
}
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
await tick();
