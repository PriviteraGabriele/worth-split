import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { registerAuth } from './auth.js';
import { registerBucketRoutes } from './routes/buckets.js';
import { registerOperationRoutes } from './routes/operations.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerBackupRoutes } from './routes/backup.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerAdminUserRoutes } from './routes/adminUsers.js';
import { registerPlannedExpenseRoutes } from './routes/plannedExpenses.js';
import { pool } from './db/pool.js';
import { registerOperationLogging } from './observability/operationLogging.js';
import { isDataException } from './http/errors.js';
import { createMailer } from './services/mailer.js';

// Fastify accepts a hop count at runtime but its typings do not, so a hop
// count is expressed as the equivalent proxy-addr trust function.
export const trustProxyOption = (trust: Config['TRUST_PROXY']) =>
  typeof trust === 'number' ? (_address: string, hop: number) => hop < trust : trust;

export async function buildApp(config: Config, options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true, trustProxy: trustProxyOption(config.TRUST_PROXY), bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(cors, { origin: config.APP_ORIGIN, credentials: true });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({ statusCode: context.statusCode, code: 'RATE_LIMITED', message: 'Rate limit exceeded' }),
  });
  registerOperationLogging(app, config);
  // API responses carry private financial data: browsers and intermediate
  // proxies must never store them.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });
  app.get('/health', async (_request, reply) => {
    try { await pool.query('SELECT 1'); return { status: 'ok' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  const mailer = createMailer(config, app.log);
  registerAuth(app, config, mailer);
  registerBucketRoutes(app);
  registerOperationRoutes(app);
  registerTemplateRoutes(app);
  registerSettingsRoutes(app);
  registerBackupRoutes(app);
  registerProfileRoutes(app, mailer);
  registerAdminUserRoutes(app, { mailer, appOrigin: config.APP_ORIGIN });
  registerPlannedExpenseRoutes(app);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.operationErrorCode = 'VALIDATION_ERROR';
      request.operationErrorClass = 'ValidationError';
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: error.issues });
    }
    if (isDataException(error)) {
      request.operationErrorCode = 'INVALID_INPUT';
      request.operationErrorClass = 'DatabaseDataError';
      return reply.code(400).send({ error: 'INVALID_INPUT' });
    }
    if ((error as any).code === '23505') {
      request.operationErrorCode = 'ALREADY_EXISTS';
      request.operationErrorClass = 'DatabaseConstraintError';
      return reply.code(409).send({ error: 'ALREADY_EXISTS' });
    }
    const httpError = error as { statusCode?: number; code?: string };
    if (httpError.statusCode && httpError.statusCode >= 400 && httpError.statusCode < 500) {
      request.operationErrorCode = httpError.code ?? 'BAD_REQUEST';
      request.operationErrorClass = 'HttpError';
      return reply.code(httpError.statusCode).send({ error: httpError.code ?? 'BAD_REQUEST' });
    }
    request.operationErrorCode = 'INTERNAL_ERROR';
    request.operationErrorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    app.log.error(error);
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });
  return app;
}
