import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, opaqueToken, hashToken, equalToken, accountConfig } from '../src/accounts/security.js';
import { signupSchema, resetSchema } from '@okr/shared';
import { requireVerifiedEmail } from '../src/accounts/access.js';

test('passwords use salted Argon2id and opaque tokens store only hashes', async () => {
  const hash = await hashPassword('a secure test password');
  assert.ok(hash.startsWith('$argon2id$v=19$m=65536,t=3,p=1$'));
  assert.equal(await verifyPassword(hash, 'a secure test password'), true);
  assert.equal(await verifyPassword(hash, 'wrong password'), false);
  const raw = opaqueToken();
  assert.equal(raw.length, 64);
  assert.notEqual(hashToken(raw), raw);
  assert.equal(equalToken(raw, raw), true);
  assert.equal(equalToken(raw, 'x'), false);
  assert.notEqual(opaqueToken(), raw);
});
test('signup normalizes emails and validates exclusive onboarding, timezone, passwords and tokens', () => {
  const valid = { email: ' Owner@Example.COM ', name: 'Owner', password: 'twelve-characters', organization: 'Test' };
  assert.equal(signupSchema.parse(valid).email, 'owner@example.com');
  assert.equal(signupSchema.safeParse({ ...valid, timezone: 'Not/AZone' }).success, false);
  assert.equal(signupSchema.safeParse({ ...valid, inviteToken: opaqueToken() }).success, false);
  assert.equal(signupSchema.safeParse({ ...valid, password: 'short' }).success, false);
  assert.equal(resetSchema.safeParse({ token: '../bad', password: valid.password }).success, false);
});
test('production rejects insecure account configuration', () => {
  const old = { node: process.env.NODE_ENV, url: process.env.APP_URL, secure: process.env.COOKIE_SECURE };
  try {
    process.env.NODE_ENV = 'production'; process.env.APP_URL = 'http://localhost:8080'; process.env.COOKIE_SECURE = 'false';
    assert.throws(accountConfig);
    process.env.APP_URL = 'https://okr.example.com'; process.env.COOKIE_SECURE = 'true';
    assert.equal(accountConfig().secure, true);
  } finally {
    for (const [key, value] of [['NODE_ENV', old.node], ['APP_URL', old.url], ['COOKIE_SECURE', old.secure]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
test('public signup is disabled by default and its startup flag accepts only explicit booleans', () => {
  const previous = process.env.DISABLE_SIGNUP;
  try {
    delete process.env.DISABLE_SIGNUP;
    assert.equal(accountConfig().disableSignup, true);
    process.env.DISABLE_SIGNUP = 'true'; assert.equal(accountConfig().disableSignup, true);
    process.env.DISABLE_SIGNUP = 'false'; assert.equal(accountConfig().disableSignup, false);
    for (const value of ['', '0', '1', 'FALSE', 'no']) {
      process.env.DISABLE_SIGNUP = value;
      assert.throws(accountConfig, /DISABLE_SIGNUP must be true or false/);
    }
  } finally { if (previous === undefined) delete process.env.DISABLE_SIGNUP; else process.env.DISABLE_SIGNUP = previous; }
});

test('organization content requires verified email in SMTP mode, not self-hosted mode', () => {
  const config = { appUrl: 'http://localhost:8080', secure: false, disableSignup: false, emailMode: 'smtp' as const };
  assert.throws(() => requireVerifiedEmail({ verified: false }, config));
  requireVerifiedEmail({ verified: true }, config);
  requireVerifiedEmail({ verified: false }, { ...config, emailMode: 'selfhosted' });
});
