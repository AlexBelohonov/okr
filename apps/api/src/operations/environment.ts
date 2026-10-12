// Errors contain setting names only; never connection strings or supplied secrets.
export function validateEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.SLACK_ENCRYPTION_KEY && !/^[a-f0-9]{64}$/.test(env.SLACK_ENCRYPTION_KEY)) throw new Error('SLACK_ENCRYPTION_KEY must contain 64 lowercase hexadecimal characters');
  if (!['development', 'test', 'production'].includes(env.NODE_ENV || 'development')) throw new Error('NODE_ENV must be development, test or production');
  for (const key of ['COOKIE_SECURE', 'SMTP_SECURE']) if (env[key] !== undefined && !['true', 'false'].includes(env[key]!)) throw new Error(`${key} must be true or false`);
  if (env.NODE_ENV !== 'production') return;
  let url: URL;
  try { url = new URL(env.DATABASE_URL || ''); } catch { throw new Error('Production DATABASE_URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error('Production DATABASE_URL must address PostgreSQL');
  const secret = decodeURIComponent(url.password);
  if (secret.length < 32 || /change.?me|local-development|example|password|replace/i.test(secret)) throw new Error('Production DATABASE_URL requires a strong database password of at least 32 characters');
  let origin: URL;
  try { origin = new URL(env.APP_URL || ''); } catch { throw new Error('Production APP_URL is required'); }
  if (origin.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || env.COOKIE_SECURE !== 'true') throw new Error('Production requires public HTTPS APP_URL and COOKIE_SECURE=true');
  if (!['smtp', 'selfhosted'].includes(env.EMAIL_MODE || '')) throw new Error('Production EMAIL_MODE must be explicit');
  if (env.EMAIL_MODE === 'smtp') {
    if (!env.SMTP_HOST || ['mailpit', 'localhost', '127.0.0.1'].includes(env.SMTP_HOST)) throw new Error('Production SMTP_HOST must be explicit');
    const port = Number(env.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Production SMTP_PORT must be explicit and valid');
    if (!env.MAIL_FROM || !/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/.test(env.MAIL_FROM) || /@localhost[>\s]*$/.test(env.MAIL_FROM)) throw new Error('Production MAIL_FROM must use a real sender domain');
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) throw new Error('SMTP_USER and SMTP_PASSWORD must be supplied together');
    if (port === 465 && env.SMTP_SECURE !== 'true') throw new Error('SMTP port 465 requires SMTP_SECURE=true');
  }
}
