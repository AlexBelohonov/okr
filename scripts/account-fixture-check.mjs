import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
try {
  const fixtureUsers = await db.user.count({ where: { email: { endsWith: '.accounts.example' } } });
  const fixtureOutbox = await db.emailOutbox.count({ where: { to: { endsWith: '.accounts.example' } } });
  console.log(JSON.stringify({ fixtureUsers, fixtureOutbox }));
  if (fixtureUsers || fixtureOutbox) process.exitCode = 1;
} finally { await db.$disconnect(); }
