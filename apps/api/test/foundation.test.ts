import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { apiErrorSchema, healthSchema, readinessSchema } from '@okr/shared';
import { buildApp } from '../src/app.js';

test('liveness stays available when the database is unavailable', async t => {
  const app = await buildApp({ logger: false, checkDatabase: async () => { throw new Error('private connection information'); } });
  t.after(() => app.close());
  const live = await app.inject('/api/v1/health');
  assert.equal(live.statusCode, 200);
  healthSchema.parse(live.json());
  const ready = await app.inject('/api/v1/ready');
  assert.equal(ready.statusCode, 503);
  assert.equal(apiErrorSchema.parse(ready.json()).error.code, 'DATABASE_UNAVAILABLE');
  assert.ok(!ready.body.includes('private connection'));
});

test('readiness invokes the dependency check and matches the shared contract', async t => {
  let checks = 0;
  const app = await buildApp({ logger: false, checkDatabase: async () => { checks++; } });
  t.after(() => app.close());
  const result = await app.inject('/api/v1/ready');
  assert.equal(result.statusCode, 200);
  readinessSchema.parse(result.json());
  assert.equal(checks, 1);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('unknown API routes use the shared error envelope', async t => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());
  const result = await app.inject('/api/v1/not-a-route');
  assert.equal(result.statusCode, 404);
  assert.equal(apiErrorSchema.parse(result.json()).error.code, 'NOT_FOUND');
});

test('validation and unexpected errors do not expose submitted values or exception messages', async t => {
  const app = await buildApp({ logger: false });
  app.post('/api/v1/test-validation', async request => z.object({ name: z.string().min(3) }).parse(request.body));
  app.get('/api/v1/test-error', async () => { throw new Error('credential=secret'); });
  t.after(() => app.close());
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/test-validation', payload: { name: 'x' } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(apiErrorSchema.parse(invalid.json()).error.details?.[0].path, 'name');
  const failed = await app.inject('/api/v1/test-error');
  assert.equal(failed.statusCode, 500);
  assert.ok(!failed.body.includes('secret'));
});

test('OpenAPI describes the actual foundation routes', async t => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());
  const result = await app.inject('/api/docs/json');
  assert.equal(result.statusCode, 200);
  assert.ok(result.json().paths['/api/v1/health']);
  assert.ok(result.json().paths['/api/v1/ready']);
  assert.ok(result.json().paths['/api/v1/auth/login']);
});

test('Swagger security policy supports HTTP development and retains HTTPS upgrades for secure deployments', async t => {
  const previous = process.env.COOKIE_SECURE;
  t.after(() => { if (previous === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = previous; });
  for (const secure of ['false', 'true']) {
    process.env.COOKIE_SECURE = secure;
    const app = await buildApp({ logger: false, accountConfig: { appUrl: 'http://localhost:8080', secure: false, disableSignup: false, emailMode: 'selfhosted' } });
    t.after(() => app.close());
    const result = await app.inject('/api/docs/');
    assert.equal(result.statusCode, 200);
    const policy = String(result.headers['content-security-policy']);
    assert.ok(policy.includes("script-src 'self'"));
    assert.equal(policy.includes('upgrade-insecure-requests'), secure === 'true');
  }
});
