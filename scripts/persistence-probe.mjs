import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const mode = process.argv[2];
const db = new PrismaClient();
const directory = process.env.EVIDENCE_DIR || '/workspace/artifacts';
const file = `${directory}/persistence-probe.json`;
const name = 'CH02 database persistence probe';
try {
  if (mode === 'create') {
    await mkdir(directory, { recursive: true });
    const id = randomUUID();
    await db.organization.create({ data: { id, name } });
    await writeFile(file, JSON.stringify({ id, name }, null, 2));
    console.log('Created isolated persistence probe. Restart the database, then run verify.');
  } else if (mode === 'verify') {
    const probe = JSON.parse(await readFile(file, 'utf8'));
    if (probe.name !== name || !/^[0-9a-f-]{36}$/.test(probe.id)) throw new Error('Unexpected probe metadata');
    const row = await db.organization.findUnique({ where: { id: probe.id } });
    if (row?.name !== name) throw new Error('Persistence probe not found after restart');
    const removed = await db.organization.deleteMany({ where: { id: probe.id, name } });
    if (removed.count !== 1) throw new Error('Could not remove the isolated probe');
    await unlink(file);
    console.log('PASS: database record survived restart. Isolated probe removed.');
  } else throw new Error('Usage: node scripts/persistence-probe.mjs create|verify');
} finally { await db.$disconnect(); }
