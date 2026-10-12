import { createRequire } from 'node:module';

const { PrismaClient } = createRequire('/app/package.json')('@prisma/client');
const db = new PrismaClient();
const base = process.env.BASE_URL || 'http://web';
const expectedMode = process.env.EXPECT_EMAIL_MODE || 'selfhosted';
const expectedSignup = process.env.EXPECT_SIGNUP_ENABLED === 'true';
async function json(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`Release smoke: ${path} returned ${response.status}`);
  return response.json();
}
try {
  const frontend = await fetch(base);
  const [health, readiness, session] = await Promise.all([
    json('/api/v1/health'), json('/api/v1/ready'), json('/api/v1/auth/session')
  ]);
  const [fixtureUsers, fixtureOutbox, migrations] = await Promise.all([
    db.user.count({ where: { email: { endsWith: '.accounts.example' } } }),
    db.emailOutbox.count({ where: { to: { endsWith: '.accounts.example' } } }),
    db.$queryRaw`SELECT count(*)::int AS applied FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  ]);
  const result = { frontend: frontend.status, health: health.status, database: readiness.database,
    emailMode: session.emailMode, signupEnabled: session.signupEnabled, migrations: migrations[0].applied,
    fixtureUsers, fixtureOutbox };
  console.log(JSON.stringify(result));
  if (frontend.status !== 200 || health.status !== 'ok' || readiness.database !== 'connected' ||
      session.emailMode !== expectedMode || session.signupEnabled !== expectedSignup ||
      result.migrations !== 9 || fixtureUsers || fixtureOutbox) process.exitCode = 1;
} finally { await db.$disconnect(); }
