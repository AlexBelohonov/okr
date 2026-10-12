import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export function registerErrors(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: request.id } });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: {
        code: 'VALIDATION_ERROR', message: 'Check the submitted values', requestId: request.id,
        details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
      } });
    }
    const candidateStatus = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    const statusCode = error instanceof ApiError ? error.statusCode : candidateStatus >= 400 && candidateStatus < 500 ? candidateStatus : 500;
    const code = error instanceof ApiError ? error.code : statusCode === 429 ? 'RATE_LIMITED' : statusCode === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST';
    const message = error instanceof ApiError ? error.message : statusCode === 500 ? 'An unexpected error occurred' : statusCode === 429 ? 'Too many requests. Try again shortly.' : 'Invalid request';
    if (statusCode >= 500) request.log.error({ code, requestId: request.id }, 'Request failed');
    return reply.code(statusCode).send({ error: { code, message, requestId: request.id } });
  });
}
