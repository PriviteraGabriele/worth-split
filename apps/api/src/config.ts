import { z } from 'zod';

// Compose passes unset variables as empty strings.
const optionalText = z.string().trim().transform((value) => value || undefined).optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  APP_ORIGIN: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  // Proxies whose X-Forwarded-For entry is trusted when resolving the client
  // IP used by rate limiting: a hop count or a comma-separated list of
  // addresses, CIDR ranges and proxy-addr keywords. Trusting every hop would
  // let a client spoof its IP with a forged header and bypass the limits.
  TRUST_PROXY: z.string().trim().min(1).default('loopback,linklocal,uniquelocal')
    .refine((value) => !['true', 'false'].includes(value), 'Use a hop count or a list of trusted proxy addresses')
    .transform((value) => /^\d+$/.test(value) ? Number(value) : value),
  // Observability is deliberately optional here so an existing installation
  // continues to start while Elasticsearch is being provisioned. Production
  // defaults are resolved by the operation-log publisher.
  ELASTICSEARCH_URL: z.string().url().optional(),
  ELASTICSEARCH_INDEX_PREFIX: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).optional(),
  // Credentials of the project user on the shared Elasticsearch. Both empty
  // means no authentication, as with the local development container.
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  OPERATION_LOG_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  OPERATION_LOG_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).optional(),
  OPERATION_LOG_OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().max(365).optional(),
  OPERATION_LOG_FLUSH_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).optional(),
  OPERATION_LOG_BATCH_SIZE: z.coerce.number().int().min(1).max(500).optional(),
  // Outgoing e-mail (invitations, password links and notices). Optional so an
  // installation without SMTP keeps working with temporary passwords only.
  SMTP_HOST: optionalText,
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USERNAME: optionalText,
  SMTP_PASSWORD: optionalText,
  MAIL_FROM: optionalText,
  // Sending budget, so anonymous reset requests cannot exhaust the provider
  // quota shared by every account: messages per hour overall and per
  // recipient per day. Defaults are resolved by the mailer.
  MAIL_HOURLY_LIMIT: z.coerce.number().int().positive().optional(),
  MAIL_RECIPIENT_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
}).refine((config) => !config.SMTP_HOST || config.MAIL_FROM, { message: 'MAIL_FROM is required with SMTP_HOST', path: ['MAIL_FROM'] });

export type Config = z.infer<typeof schema>;
export const loadConfig = (): Config => schema.parse(process.env);
