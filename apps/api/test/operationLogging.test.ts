import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/pool.js', () => ({ pool: { query: vi.fn() } }));

import {
  OperationLogPublisher,
  buildOperationDocument,
  operationFor,
  type OperationLogDocument,
  resolveOperationLogConfig,
  type ResolvedOperationLogConfig,
} from '../src/observability/operationLogging.js';

const publisherConfig: ResolvedOperationLogConfig = {
  enabled: true,
  elasticsearchUrl: 'http://elasticsearch:9200',
  elasticsearchAuthorization: null,
  indexPrefix: 'worth-split-operation-logs',
  retentionDays: 180,
  outboxRetentionDays: 7,
  flushIntervalMs: 5000,
  batchSize: 100,
};

const document: OperationLogDocument = {
  '@timestamp': '2026-09-20T10:00:00.000Z',
  event_dataset: 'worth-split.operation',
  service_name: 'worth-split-api',
  environment: 'test',
  operation: 'bucket.create',
  type: 'command',
  status: 'success',
  duration_ms: 12,
  request_id: 'req-1',
  http_method: 'POST',
  route: '/api/buckets',
  http_status: 201,
  user_id: '00000000-0000-4000-8000-000000000001',
  user_role: 'user',
  resource_id: null,
  query_keys: [],
  has_request_body: true,
  error_code: null,
  error_class: null,
};

describe('operation logging', () => {
  it('names every meaningful API route and excludes health checks', () => {
    expect(operationFor('POST', '/api/transfers')).toBe('funds.transfer');
    expect(operationFor('DELETE', '/api/planned-expenses/:id/permanent')).toBe('planned_expense.delete');
    expect(operationFor('GET', '/health')).toBeNull();
    expect(operationFor('GET', '/favicon.ico')).toBeNull();
  });

  it('records safe request metadata without retaining a password or response body', async () => {
    const app = Fastify();
    let captured: OperationLogDocument | null = null;
    app.addHook('onRequest', async (request) => {
      request.operationStartedAt = process.hrtime.bigint();
      request.operationTimestamp = '2026-09-20T10:00:00.000Z';
    });
    app.addHook('onResponse', async (request, reply) => {
      captured = buildOperationDocument(request, reply.statusCode);
    });
    app.post('/api/auth/login', async () => ({ password: 'must-not-be-recorded', balanceCents: '100000' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'person@example.com', password: 'super-secret-password' },
    });

    expect(response.statusCode).toBe(200);
    expect(captured).toMatchObject({
      operation: 'auth.login', type: 'command', status: 'success', has_request_body: true,
      user_id: null, query_keys: [], http_status: 200,
    });
    expect(JSON.stringify(captured)).not.toContain('super-secret-password');
    expect(JSON.stringify(captured)).not.toContain('person@example.com');
    expect(JSON.stringify(captured)).not.toContain('100000');
    await app.close();
  });

  it('marks rejected operations as failed with a non-sensitive error code', async () => {
    const app = Fastify();
    let captured: OperationLogDocument | null = null;
    app.addHook('onResponse', async (request, reply) => { captured = buildOperationDocument(request, reply.statusCode); });
    app.post('/api/buckets', async (_request, reply) => {
      _request.operationErrorCode = 'VALIDATION_ERROR';
      _request.operationErrorClass = 'ValidationError';
      return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    });

    await app.inject({ method: 'POST', url: '/api/buckets', payload: { amountCents: 'not-valid' } });

    expect(captured).toMatchObject({ status: 'failed', error_code: 'VALIDATION_ERROR', error_class: 'ValidationError' });
    await app.close();
  });

  it('publishes queued documents to the daily Elasticsearch index with a stable id', async () => {
    const database = { query: vi.fn() };
    const id = '00000000-0000-4000-8000-000000000010';
    database.query
      .mockResolvedValueOnce({ rows: [{ id, document }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: false, items: [{ index: { _id: id, status: 201 } }] }), { status: 200 }));
    const publisher = new OperationLogPublisher(publisherConfig, database as never, fetcher);

    await publisher.flush();

    expect(fetcher).toHaveBeenLastCalledWith(
      'http://elasticsearch:9200/_bulk',
      expect.objectContaining({ body: expect.stringContaining('worth-split-operation-logs-2026.09.20') }),
    );
    expect((fetcher.mock.calls[2]![1] as RequestInit).body).toContain(id);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('published_at=now()'),
      [[id]],
    );
  });

  it('authenticates every Elasticsearch request when credentials are configured', async () => {
    const resolved = resolveOperationLogConfig({
      NODE_ENV: 'production',
      ELASTICSEARCH_URL: 'http://observability-elasticsearch:9200',
      ELASTICSEARCH_USERNAME: 'worth-split',
      ELASTICSEARCH_PASSWORD: 'secret-password',
    } as never);
    expect(resolved.elasticsearchAuthorization).toBe(`Basic ${Buffer.from('worth-split:secret-password').toString('base64')}`);

    const database = { query: vi.fn() };
    const id = '00000000-0000-4000-8000-000000000011';
    database.query
      .mockResolvedValueOnce({ rows: [{ id, document }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: false, items: [{ index: { _id: id, status: 201 } }] }), { status: 200 }));
    const publisher = new OperationLogPublisher({ ...publisherConfig, elasticsearchAuthorization: resolved.elasticsearchAuthorization }, database as never, fetcher);

    await publisher.flush();

    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ authorization: resolved.elasticsearchAuthorization });
    }
  });

  it('sends no authorization header without credentials', () => {
    expect(resolveOperationLogConfig({ NODE_ENV: 'production' } as never).elasticsearchAuthorization).toBeNull();
  });
});
