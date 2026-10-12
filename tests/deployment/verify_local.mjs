import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';

const directory = '/workspace/artifacts/ec2-check';
const expectedMigrations = readdirSync(`${directory}/build-context/apps/api/prisma/migrations`, { withFileTypes: true }).filter(entry => entry.isDirectory()).length;
const configBytes = readFileSync(`${directory}/compose.json`);
const configText = configBytes.toString(configBytes[0] === 255 && configBytes[1] === 254 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
const compose = JSON.parse(configText);
const expected = JSON.parse(readFileSync(`${directory}/expected.json`, 'utf8'));
for (const [name, value] of Object.entries(expected)) {
  assert.equal(compose.services.api.environment[name], value.replaceAll('$', () => '$$'), `Compose serialization mismatch: ${name}`);
  assert.equal(process.env[name], value, `SMTP value did not round-trip: ${name}`);
}
assert.equal(compose.services.migrate.environment.NODE_ENV, 'production');
assert.equal(compose.services.migrate.environment.COOKIE_SECURE, 'true');
assert.equal(compose.services.api.environment.DISABLE_SIGNUP, 'true');
assert.equal(compose.services.web.ports[0].host_ip, '127.0.0.1');
assert.equal(compose.services.db.volumes.length, 1);
assert.equal(compose.services.db.volumes[0].type, 'bind');
const ready = await fetch('http://web/api/v1/ready');
assert.equal(ready.status, 200); assert.equal((await ready.json()).database, 'connected');
const sessionResponse = await fetch('http://web/api/v1/auth/session');
const session = await sessionResponse.json();
assert.equal(session.signupEnabled, false); assert.equal(session.emailMode, 'smtp');
assert.match(sessionResponse.headers.get('set-cookie'), /Secure/i);
const ca = readFileSync(`${directory}/data/caddy-data/caddy/pki/authorities/local/root.crt`);
function secureRequest(path, method = 'GET', headers = {}, body) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: 'caddy', port: 443, servername: 'okr.example.org', ca,
      path, method, headers: { Host: 'okr.example.org', ...headers } }, response => {
      let text = '';
      response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.on('error', reject); request.end(body);
  });
}
const redirect = await new Promise((resolve, reject) => {
  const request = http.get({ hostname: 'caddy', path: '/api/v1/ready', headers: { Host: 'okr.example.org' } }, response => {
    response.resume(); resolve({ status: response.statusCode, location: response.headers.location });
  });
  request.on('error', reject);
});
assert.equal(redirect.status, 308); assert.equal(redirect.location, 'https://okr.example.org/api/v1/ready');
const secureReady = await secureRequest('/api/v1/ready');
assert.equal(secureReady.status, 200); assert.equal(JSON.parse(secureReady.text).database, 'connected');
const page = await secureRequest('/');
assert.equal(page.status, 200); assert.match(page.text, /id="root"/);
const secureSession = await secureRequest('/api/v1/auth/session');
assert.equal(secureSession.status, 200); assert.equal(JSON.parse(secureSession.text).signupEnabled, false);
assert.match(secureSession.headers['set-cookie'].join(';'), /Secure/i);
const { PrismaClient } = createRequire('/app/package.json')('@prisma/client');
const db = new PrismaClient();
try {
  assert.equal(await db.user.count(), 0);
  const migrations = await db.$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(migrations[0].count, expectedMigrations);
  const probePath = `${directory}/persistence.json`;
  const probeName = 'EC2 isolated persistence probe';
  if (process.argv[2] === 'create') {
    const probe = await db.organization.create({ data: { name: probeName } });
    writeFileSync(probePath, JSON.stringify({ id: probe.id }));
    console.log('Created isolated persistence probe.');
  } else if (process.argv[2] === 'verify') {
    const { id } = JSON.parse(readFileSync(probePath, 'utf8'));
    assert.equal((await db.organization.findUnique({ where: { id } }))?.name, probeName);
    assert.equal((await db.organization.deleteMany({ where: { id, name: probeName } })).count, 1);
    unlinkSync(probePath);
    console.log('PASS: database bind mount survives container recreation; probe removed.');
  }
} finally { await db.$disconnect(); }
console.log(JSON.stringify({ composeSecretsRoundTrip: true, databaseBindMount: true, readiness: 'connected', trustedLocalHttps: true, httpsRedirect: true, secureCookies: true, signupEnabled: false, migrations: expectedMigrations, emptyUserDatabase: true }));
