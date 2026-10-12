import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { db } from './db.js';
import { ApiError, registerErrors } from './errors.js';
import { registerAccounts } from './accounts/routes.js';
import { registerOrganizations } from './organizations/routes.js';
import { registerObjectives } from './objectives/routes.js';
import { registerRelationships } from './objectives/relationships.js';
import { registerCollaboration } from './objectives/collaboration.js';
import { registerPlatform } from './platform/routes.js';
import { registerSlack } from './slack/routes.js';
import type { AccountConfig } from './accounts/security.js';
import type { PrismaClient } from '@prisma/client';

const version = '1.0.0';
const errorResponse = {
  type: 'object', required: ['error'], properties: { error: {
    type: 'object', required: ['code', 'message', 'requestId'], properties: {
      code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' }
    }
  } }
};

export async function buildApp(options: { logger?: boolean; checkDatabase?: () => Promise<void>; database?: PrismaClient; accountConfig?: AccountConfig } = {}) {
  const app = Fastify({
    trustProxy: (_address, hop) => hop === 0,
    logger: options.logger === false ? false : {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      serializers: { req: request => ({ method: request.method, url: request.url?.split('?')[0], remoteAddress: request.ip }) }
    },
    bodyLimit: 1024 * 1024,
    requestTimeout: 15000
  });
  registerErrors(app);
  await app.register(cookie);
  await app.register(rateLimit, { max: process.env.NODE_ENV === 'test' ? 2400 : 120, timeWindow: '1 minute' });
  await app.register(swagger, { openapi: {
    info: { title: 'OKR Workspace API', version, description: 'System, account, organization, team, period, objective and key-result endpoints.' },
    tags: [{ name: 'system', description: 'Service availability' }, { name: 'accounts', description: 'Same-origin account flows; fetch session first and send X-CSRF-Token on mutations' }]
  } });
  await app.register(swaggerUi, {
    routePrefix: '/api/docs', staticCSP: true,
    transformStaticCSP: header => process.env.COOKIE_SECURE === 'true' ? header : header.replace(/upgrade-insecure-requests;?/g, '')
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
  });
  app.get('/api/v1/health', {
    config: { rateLimit: false },
    schema: { tags: ['system'], summary: 'API liveness (does not query the database)', response: { 200: {
      type: 'object', required: ['status', 'service', 'version'], properties: {
        status: { type: 'string', enum: ['ok'] }, service: { type: 'string', enum: ['okr-api'] }, version: { type: 'string' }
      }
    } } }
  }, async () => ({ status: 'ok', service: 'okr-api', version }));

  const checkDatabase = options.checkDatabase ?? (async () => { await db.$queryRaw`SELECT 1`; });
  app.get('/api/v1/ready', {
    config: { rateLimit: false },
    schema: { tags: ['system'], summary: 'Readiness including database connectivity', response: {
      200: { type: 'object', required: ['status', 'database', 'version'], properties: {
        status: { type: 'string', enum: ['ready'] }, database: { type: 'string', enum: ['connected'] }, version: { type: 'string' }
      } }, 503: errorResponse
    } }
  }, async () => {
    try { await checkDatabase(); }
    catch { throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Database connection unavailable'); }
    return { status: 'ready', database: 'connected', version };
  });
  await app.register(registerAccounts, { database: options.database, config: options.accountConfig });
  await app.register(registerOrganizations, { database: options.database, config: options.accountConfig });
  await app.register(registerObjectives, { database: options.database, config: options.accountConfig });
  await app.register(registerRelationships, { database: options.database, config: options.accountConfig });
  await app.register(registerCollaboration, { database: options.database, config: options.accountConfig });
  await app.register(registerPlatform, { database: options.database, config: options.accountConfig });
  await app.register(registerSlack, { database: options.database, config: options.accountConfig });
  return app;
}
