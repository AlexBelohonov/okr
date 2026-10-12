import { spawnSync } from 'node:child_process';
const name = process.argv[2];
if (!/^okr_ch(?:09|10|12)_test_[a-z0-9_]+$/.test(name || '')) throw new Error('Use a dedicated chapter acceptance database');
const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + name;
const env = { ...process.env, DATABASE_URL: url.href, NODE_ENV: 'development' };
for (const args of [['run', 'migrate', '-w', '@okr/api'], ['test'], ['run', 'test:integration']]) {
  const result = spawnSync('npm', args, { env, stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status || 1);
}
