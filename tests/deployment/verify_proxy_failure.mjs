import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import https from 'node:https';

// Run only while the isolated project's web container is deliberately stopped.
const status = await new Promise((resolve, reject) => {
  const request = https.get({ hostname: 'caddy', port: 443, servername: 'okr.example.org',
    ca: readFileSync('/workspace/artifacts/ec2-check/data/caddy-data/caddy/pki/authorities/local/root.crt'),
    path: '/api/v1/ready?token=EC2_QUERY_LOG_MARKER',
    headers: { Host: 'okr.example.org', Authorization: 'Bearer EC2_AUTH_LOG_MARKER', Cookie: 'fixture=EC2_COOKIE_LOG_MARKER' }
  }, response => { response.resume(); resolve(response.statusCode); });
  request.on('error', reject);
});
assert.equal(status, 502);
console.log('PASS: deliberate isolated upstream outage returns 502; inspect sanitized Caddy error log.');
