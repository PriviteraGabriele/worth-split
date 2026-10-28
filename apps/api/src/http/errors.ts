import type { FastifyReply } from 'fastify';

const statuses: Record<string, number> = {
  INVALID_AMOUNT: 400,
  AMOUNT_MUST_BE_POSITIVE: 400,
  INSUFFICIENT_BALANCE: 409,
  BUCKET_NOT_FOUND: 404,
  SAME_BUCKET: 400,
  INVALID_DISTRIBUTION: 400,
  INVALID_REBALANCE: 400,
  INVALID_REBALANCE_TOTAL: 400,
  EMAIL_OR_PASSWORD_INVALID: 401,
  INVALID_INPUT: 400,
};

// PostgreSQL reports values it cannot store (out-of-range numbers or dates,
// invalid timestamps) as SQLSTATE class 22. They are caused by the request,
// so they are a client error rather than an internal one.
export function isDataException(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^22[0-9A-Z]{3}$/.test(code);
}

export function sendDomainError(reply: FastifyReply, error: unknown): FastifyReply {
  const candidate = isDataException(error) ? 'INVALID_INPUT' : error instanceof Error ? error.message : 'INTERNAL_ERROR';
  // Only known domain codes can cross the API or enter telemetry. A database
  // or runtime error message could contain private application data.
  const code = Object.hasOwn(statuses, candidate) ? candidate : 'INTERNAL_ERROR';
  reply.request.operationErrorCode = code;
  reply.request.operationErrorClass = 'DomainError';
  return reply.code(statuses[code] ?? 500).send({ error: code });
}
