import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Config } from '../config.js';
import { pool } from '../db/pool.js';

const operationNames: Record<string, string> = {
  'POST /api/auth/login': 'auth.login',
  'POST /api/auth/logout': 'auth.logout',
  'GET /api/auth/me': 'auth.session.read',
  'POST /api/auth/password-reset/request': 'auth.password_reset.request',
  'POST /api/auth/password-reset': 'auth.password_reset.complete',
  'GET /api/dashboard': 'dashboard.read',
  'GET /api/buckets': 'bucket.list',
  'POST /api/buckets': 'bucket.create',
  'PATCH /api/buckets/:id': 'bucket.update',
  'PATCH /api/buckets/:id/total-visibility': 'bucket.total_visibility.update',
  'DELETE /api/buckets/:id': 'bucket.archive',
  'PUT /api/buckets/order': 'bucket.order.update',
  'POST /api/buckets/:id/adjust': 'bucket.adjust',
  'POST /api/transfers': 'funds.transfer',
  'POST /api/distributions': 'funds.distribute',
  'POST /api/rebalances': 'funds.rebalance',
  'GET /api/operations': 'operation.list',
  'GET /api/trends': 'trend.read',
  'GET /api/templates': 'template.list',
  'POST /api/templates': 'template.create',
  'PUT /api/templates/:id': 'template.update',
  'DELETE /api/templates/:id': 'template.delete',
  'GET /api/settings': 'settings.read',
  'PUT /api/settings': 'settings.update',
  'PATCH /api/profile': 'profile.update',
  'PUT /api/profile/avatar': 'profile.avatar.update',
  'DELETE /api/profile/avatar': 'profile.avatar.delete',
  'GET /api/users/:id/avatar': 'profile.avatar.read',
  'POST /api/profile/password': 'profile.password.update',
  'GET /api/backup/export': 'backup.export',
  'GET /api/backup/exports': 'backup.export.history',
  'POST /api/backup/validate': 'backup.validate',
  'POST /api/backup/reset': 'backup.reset',
  'POST /api/backup/import': 'backup.import',
  'GET /api/planned-expenses/manage': 'planned_expense.manage.read',
  'GET /api/planned-expenses': 'planned_expense.list',
  'POST /api/planned-expenses': 'planned_expense.create',
  'PATCH /api/planned-expenses/:id': 'planned_expense.update',
  'POST /api/planned-expenses/:id/estimated-total-visibility': 'planned_expense.estimated_total_visibility.update',
  'DELETE /api/planned-expenses/:id': 'planned_expense.archive',
  'DELETE /api/planned-expenses/:id/permanent': 'planned_expense.delete',
  'POST /api/planned-expenses/:id/complete': 'planned_expense.complete',
  'POST /api/planned-expenses/:id/reopen': 'planned_expense.reopen',
  'POST /api/planned-expenses/:id/correct': 'planned_expense.correct',
  'POST /api/planned-expenses/:id/cancel-payments': 'planned_expense.payments.cancel',
  'POST /api/planned-expenses/:id/payments': 'planned_expense.payment.record',
  'GET /api/admin/users': 'admin.user.list',
  'POST /api/admin/users': 'admin.user.create',
  'PATCH /api/admin/users/:id': 'admin.user.update',
  'PATCH /api/admin/users/:id/role': 'admin.user.role.update',
  'PATCH /api/admin/users/:id/status': 'admin.user.status.update',
  'DELETE /api/admin/users/:id': 'admin.user.delete',
  'POST /api/admin/users/:id/reset-password': 'admin.user.password.reset',
  'POST /api/admin/users/:id/password-link': 'admin.user.password.link',
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OperationLogDocument = {
  '@timestamp': string;
  event_dataset: 'worth-split.operation';
  service_name: 'worth-split-api';
  environment: string;
  operation: string;
  type: 'command' | 'query';
  status: 'success' | 'failed';
  duration_ms: number;
  request_id: string;
  http_method: string;
  route: string;
  http_status: number;
  user_id: string | null;
  user_role: string | null;
  resource_id: string | null;
  query_keys: string[];
  has_request_body: boolean;
  error_code: string | null;
  error_class: string | null;
};

export type ResolvedOperationLogConfig = {
  enabled: boolean;
  elasticsearchUrl: string;
  // Basic authentication header for the shared Elasticsearch, if configured.
  elasticsearchAuthorization: string | null;
  indexPrefix: string;
  retentionDays: number;
  outboxRetentionDays: number;
  flushIntervalMs: number;
  batchSize: number;
};

type Queryable = Pick<Pool, 'query'>;
type Fetcher = typeof fetch;
type OutboxRow = { id: string; document: OperationLogDocument };
type Logger = Pick<FastifyBaseLogger, 'warn'>;

declare module 'fastify' {
  interface FastifyRequest {
    operationStartedAt?: bigint;
    operationTimestamp?: string;
    operationErrorCode?: string;
    operationErrorClass?: string;
  }
}

export function resolveOperationLogConfig(config: Config): ResolvedOperationLogConfig {
  return {
    enabled: config.OPERATION_LOG_ENABLED ?? config.NODE_ENV !== 'test',
    elasticsearchUrl: (config.ELASTICSEARCH_URL ?? 'http://elasticsearch:9200').replace(/\/+$/, ''),
    elasticsearchAuthorization: config.ELASTICSEARCH_USERNAME
      ? `Basic ${Buffer.from(`${config.ELASTICSEARCH_USERNAME}:${config.ELASTICSEARCH_PASSWORD ?? ''}`).toString('base64')}`
      : null,
    indexPrefix: config.ELASTICSEARCH_INDEX_PREFIX ?? 'worth-split-operation-logs',
    retentionDays: config.OPERATION_LOG_RETENTION_DAYS ?? 180,
    outboxRetentionDays: config.OPERATION_LOG_OUTBOX_RETENTION_DAYS ?? 7,
    flushIntervalMs: config.OPERATION_LOG_FLUSH_INTERVAL_MS ?? 5000,
    batchSize: config.OPERATION_LOG_BATCH_SIZE ?? 100,
  };
}

export function operationFor(method: string, route: string | undefined): string | null {
  if (route === '/health') return null;
  if (!route?.startsWith('/api/')) return null;
  return operationNames[`${method} ${route}`] ?? `api.${method.toLowerCase()}.unknown`;
}

// Query keys are chosen by the client, so only short identifier-like names
// reach the shared Elasticsearch, and at most a handful of them.
const queryKeyPattern = /^[A-Za-z0-9_]{1,32}$/;

function requestQueryKeys(request: FastifyRequest): string[] {
  if (!request.query || typeof request.query !== 'object' || Array.isArray(request.query)) return [];
  return Object.keys(request.query).filter((key) => queryKeyPattern.test(key)).sort().slice(0, 10);
}

function resourceId(request: FastifyRequest): string | null {
  if (!request.params || typeof request.params !== 'object') return null;
  const id = (request.params as Record<string, unknown>).id;
  return typeof id === 'string' && uuid.test(id) ? id : null;
}

export function buildOperationDocument(request: FastifyRequest, statusCode: number): OperationLogDocument | null {
  const route = request.routeOptions.url;
  const operation = operationFor(request.method, route);
  if (!operation) return null;

  const startedAt = request.operationStartedAt ?? process.hrtime.bigint();
  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  const failed = statusCode >= 400;

  return {
    '@timestamp': request.operationTimestamp ?? new Date().toISOString(),
    event_dataset: 'worth-split.operation',
    service_name: 'worth-split-api',
    environment: process.env.NODE_ENV ?? 'development',
    operation,
    type: request.method === 'GET' || request.method === 'HEAD' ? 'query' : 'command',
    status: failed ? 'failed' : 'success',
    duration_ms: durationMs,
    request_id: request.id,
    http_method: request.method,
    route: route ?? '/api/unknown',
    http_status: statusCode,
    user_id: request.userId || null,
    user_role: request.userId ? request.userRole : null,
    resource_id: resourceId(request),
    query_keys: requestQueryKeys(request),
    has_request_body: request.body !== undefined && request.body !== null,
    error_code: failed ? request.operationErrorCode ?? `HTTP_${statusCode}` : null,
    error_class: failed ? request.operationErrorClass ?? 'HttpError' : null,
  };
}

/**
 * PostgreSQL is used as a durable outbox while Elasticsearch is unavailable.
 * A failed telemetry delivery is retried with exponential backoff and never
 * changes the result of the operation being observed.
 */
export class OperationLogPublisher {
  private timer: NodeJS.Timeout | undefined;
  private flushing = false;
  private lastProvisionAttempt = 0;
  private lastPrune = 0;
  private lastWarning = 0;
  private infrastructureReady = false;

  constructor(
    private readonly config: ResolvedOperationLogConfig,
    private readonly database: Queryable = pool,
    private readonly fetcher: Fetcher = fetch,
    private readonly logger?: Logger,
  ) {}

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, this.config.flushIntervalMs);
    this.timer.unref();
    void this.flush();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  async enqueue(document: OperationLogDocument): Promise<void> {
    if (!this.config.enabled) return;
    try {
      await this.database.query('INSERT INTO operation_log_outbox(document) VALUES($1::jsonb)', [JSON.stringify(document)]);
    } catch (error) {
      this.warnOnce(error, 'Unable to enqueue an operation log');
    }
  }

  async flush(): Promise<void> {
    if (!this.config.enabled || this.flushing) return;
    this.flushing = true;
    try {
      // Do not let Elasticsearch dynamically create an index without our
      // keyword mappings: Grafana's terms panels depend on those mappings.
      if (!await this.ensureInfrastructure()) return;
      const result = await this.database.query<OutboxRow>(
        `WITH ready AS (
           SELECT id FROM operation_log_outbox
           WHERE published_at IS NULL AND available_at <= now()
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE operation_log_outbox outbox SET attempts=outbox.attempts+1
         FROM ready WHERE outbox.id=ready.id
         RETURNING outbox.id,outbox.document`,
        [this.config.batchSize],
      );
      if (!result.rows.length) {
        await this.prunePublished();
        return;
      }

      const response = await this.fetcher(`${this.config.elasticsearchUrl}/_bulk`, {
        method: 'POST',
        headers: this.headers('application/x-ndjson'),
        body: this.bulkBody(result.rows),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Elasticsearch bulk request failed with HTTP ${response.status}`);

      const payload = await response.json() as { errors?: boolean; items?: Array<{ index?: { _id?: string; status?: number; error?: unknown } }> };
      if (!payload.items || payload.items.length !== result.rows.length) {
        throw new Error('Elasticsearch bulk response did not contain every operation log');
      }
      const failed = new Map<string, string>();
      for (const item of payload.items ?? []) {
        const indexed = item.index;
        if (indexed?._id && (indexed.status ?? 500) >= 300) failed.set(indexed._id, this.errorText(indexed.error));
      }
      const publishedIds = result.rows.map((row) => row.id).filter((id) => !failed.has(id));
      if (publishedIds.length) {
        await this.database.query(
          'UPDATE operation_log_outbox SET published_at=now(),last_error=NULL WHERE id=ANY($1::uuid[])',
          [publishedIds],
        );
      }
      if (failed.size) await this.retry([...failed.keys()], [...failed.values()].join('; '));
      await this.prunePublished();
    } catch (error) {
      // The rows remain in the outbox; only their next retry time changes.
      // Do not throw from observability code into a user-facing request.
      try {
        const pending = await this.database.query<{ id: string }>(
          'SELECT id FROM operation_log_outbox WHERE published_at IS NULL AND available_at <= now() ORDER BY created_at LIMIT $1',
          [this.config.batchSize],
        );
        if (pending.rows.length) await this.retry(pending.rows.map((row) => row.id), this.errorText(error));
      } catch (retryError) {
        this.warnOnce(retryError, 'Unable to schedule operation-log retry');
      }
      this.warnOnce(error, 'Unable to publish operation logs to Elasticsearch');
    } finally {
      this.flushing = false;
    }
  }

  private async ensureInfrastructure(): Promise<boolean> {
    if (this.infrastructureReady) return true;
    const now = Date.now();
    if (now - this.lastProvisionAttempt < 30_000) return false;
    this.lastProvisionAttempt = now;
    const policyName = `${this.config.indexPrefix}-retention`;
    const templateName = `${this.config.indexPrefix}-template`;
    const request = async (path: string, body: unknown) => {
      const response = await this.fetcher(`${this.config.elasticsearchUrl}${path}`, {
        method: 'PUT',
        headers: this.headers('application/json'),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Elasticsearch setup request failed with HTTP ${response.status}`);
    };
    try {
      await request(`/_ilm/policy/${policyName}`, {
        policy: { phases: { hot: { actions: {} }, delete: { min_age: `${this.config.retentionDays}d`, actions: { delete: {} } } } },
      });
      await request(`/_index_template/${templateName}`, {
        index_patterns: [`${this.config.indexPrefix}-*`],
        template: {
          settings: { 'index.lifecycle.name': policyName, number_of_shards: 1, number_of_replicas: 0 },
          mappings: {
            dynamic: false,
            properties: {
              '@timestamp': { type: 'date' }, event_dataset: { type: 'keyword' }, service_name: { type: 'keyword' },
              environment: { type: 'keyword' }, operation: { type: 'keyword' }, type: { type: 'keyword' },
              status: { type: 'keyword' }, duration_ms: { type: 'long' }, request_id: { type: 'keyword' },
              http_method: { type: 'keyword' }, route: { type: 'keyword' }, http_status: { type: 'integer' },
              user_id: { type: 'keyword' }, user_role: { type: 'keyword' }, resource_id: { type: 'keyword' },
              query_keys: { type: 'keyword' }, has_request_body: { type: 'boolean' }, error_code: { type: 'keyword' },
              error_class: { type: 'keyword' },
            },
          },
        },
      });
      this.infrastructureReady = true;
      return true;
    } catch (error) {
      this.warnOnce(error, 'Unable to provision Elasticsearch operation-log retention');
      return false;
    }
  }

  private headers(contentType: string): Record<string, string> {
    const authorization = this.config.elasticsearchAuthorization;
    return authorization ? { 'content-type': contentType, authorization } : { 'content-type': contentType };
  }

  private bulkBody(rows: OutboxRow[]): string {
    return rows.flatMap((row) => [
      JSON.stringify({ index: { _index: this.indexFor(row.document), _id: row.id } }),
      JSON.stringify(row.document),
    ]).join('\n').concat('\n');
  }

  private indexFor(document: OperationLogDocument): string {
    const date = new Date(document['@timestamp']);
    const suffix = Number.isNaN(date.getTime()) ? new Date() : date;
    return `${this.config.indexPrefix}-${suffix.toISOString().slice(0, 10).replaceAll('-', '.')}`;
  }

  private async retry(ids: string[], error: string): Promise<void> {
    if (!ids.length) return;
    await this.database.query(
      `UPDATE operation_log_outbox
       SET available_at=now()+make_interval(secs => LEAST(3600, (5 * power(2, LEAST(attempts, 12)))::integer)),
           last_error=$2
       WHERE id=ANY($1::uuid[]) AND published_at IS NULL`,
      [ids, error.slice(0, 500)],
    );
  }

  private async prunePublished(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPrune < 60 * 60_000) return;
    this.lastPrune = now;
    await this.database.query(
      "DELETE FROM operation_log_outbox WHERE published_at < now()-($1 * interval '1 day')",
      [this.config.outboxRetentionDays],
    );
  }

  private errorText(error: unknown): string {
    if (typeof error === 'string') return error.slice(0, 500);
    if (error instanceof Error) return error.message.slice(0, 500);
    try { return JSON.stringify(error).slice(0, 500); }
    catch { return 'Unknown Elasticsearch publication error'; }
  }

  private warnOnce(error: unknown, message: string): void {
    const now = Date.now();
    if (now - this.lastWarning < 60_000) return;
    this.lastWarning = now;
    this.logger?.warn({ err: error }, message);
  }
}

// Throttled requests and anonymous calls rejected before any route logic say
// little each, yet nothing else bounds how many a client can produce: past a
// small budget per minute they are no longer written to the outbox, so its
// growth and the shared Elasticsearch ingest stay bounded. Failed logins are
// kept: they are the useful part of an attack trail and have their own limits.
export const rejectedDocumentsPerMinute = 120;

export function isRejectedNoise(document: OperationLogDocument): boolean {
  if (document.http_status === 429) return true;
  return document.http_status === 401 && document.user_id === null && !document.operation.startsWith('auth.');
}

export class RejectedRequestBudget {
  private windowStartedAt = 0;
  private used = 0;

  constructor(private readonly perMinute: number, private readonly now: () => number = Date.now) {}

  take(): boolean {
    const now = this.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.used = 0;
    }
    this.used += 1;
    return this.used <= this.perMinute;
  }
}

export function registerOperationLogging(app: FastifyInstance, config: Config): void {
  const publisher = new OperationLogPublisher(resolveOperationLogConfig(config), pool, fetch, app.log);
  app.addHook('onRequest', async (request) => {
    request.operationStartedAt = process.hrtime.bigint();
    request.operationTimestamp = new Date().toISOString();
  });
  // Some routes intentionally return a known domain error without throwing.
  // Capture only its stable `error` code while it is still an object; the
  // eventual serialized payload is never parsed or stored.
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (reply.statusCode >= 400 && payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const error = (payload as Record<string, unknown>).error;
      if (typeof error === 'string' && /^[A-Z0-9_]+$/.test(error)) {
        request.operationErrorCode ??= error;
        request.operationErrorClass ??= 'DomainError';
      }
    }
    return payload;
  });
  // onSend runs after the domain transaction has committed but before the
  // response leaves Fastify. This makes the outbox hand-off durable without
  // leaking response bodies or changing the API payload.
  const rejected = new RejectedRequestBudget(rejectedDocumentsPerMinute);
  app.addHook('onSend', async (request, reply, payload) => {
    const document = buildOperationDocument(request, reply.statusCode);
    if (document && (!isRejectedNoise(document) || rejected.take())) await publisher.enqueue(document);
    return payload;
  });
  app.addHook('onReady', async () => { publisher.start(); });
  app.addHook('onClose', async () => { await publisher.stop(); });
}
