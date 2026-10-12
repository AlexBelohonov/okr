import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../src/operations/environment.js';
import { smtpTransport } from '../src/accounts/mail.js';

const valid = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://okr:5892acf490837ec87a85d785cab49519@db:5432/okr', APP_URL: 'https://okr.company.test', COOKIE_SECURE: 'true', EMAIL_MODE: 'selfhosted' };
test('production requires explicit secure origins and a strong database secret', () => {
  validateEnvironment(valid);
  for (const fields of [ { DATABASE_URL: '' }, { DATABASE_URL: 'postgresql://okr:local-development-only@db/okr' }, { DATABASE_URL: 'postgresql://okr:change-me-before-deploying-123456789@db/okr' }, { APP_URL: 'http://okr.company.test' }, { APP_URL: 'https://localhost' }, { COOKIE_SECURE: 'false' }, { EMAIL_MODE: '' } ]) assert.throws(() => validateEnvironment({ ...valid, ...fields }));
});
test('production SMTP validates sender, relay, port and paired credentials; transport requires TLS', () => {
  const smtp = { ...valid, EMAIL_MODE: 'smtp', SMTP_HOST: 'smtp.company.test', SMTP_PORT: '587', MAIL_FROM: 'OKR <noreply@company.test>', SMTP_SECURE: 'false' };
  validateEnvironment(smtp);
  for (const fields of [{ SMTP_HOST: 'mailpit' }, { SMTP_PORT: '0' }, { SMTP_PORT: 'NaN' }, { MAIL_FROM: 'noreply@localhost' }, { SMTP_USER: 'user' }, { SMTP_PASSWORD: 'secret' }, { SMTP_PORT: '465' }]) assert.throws(() => validateEnvironment({ ...smtp, ...fields }));
  validateEnvironment({ ...smtp, SMTP_PORT: '465', SMTP_SECURE: 'true' });
  const previous = { node: process.env.NODE_ENV, secure: process.env.SMTP_SECURE };
  try {
    process.env.NODE_ENV = 'production'; process.env.SMTP_SECURE = 'false';
    const transport = smtpTransport(); assert.equal((transport.options as { requireTLS?: boolean }).requireTLS, true); transport.close();
  } finally {
    for (const [key, value] of [['NODE_ENV', previous.node], ['SMTP_SECURE', previous.secure]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
  }
});
test('environment errors identify settings without echoing secrets and reject misspelled modes/booleans', () => {
  assert.throws(() => validateEnvironment({ ...valid, DATABASE_URL: 'postgresql://okr:private-secret@db/okr' }), error => error instanceof Error && !error.message.includes('private-secret'));
  for (const fields of [{ NODE_ENV: 'prod' }, { COOKIE_SECURE: 'TRUE' }, { SMTP_SECURE: 'yes' }]) assert.throws(() => validateEnvironment({ ...valid, ...fields }));
  validateEnvironment({ NODE_ENV: 'development' });
});
