import { createHash } from 'node:crypto';
import { createTransport } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';

export type MailMessage = { to: string; subject: string; text: string; html: string };

export type Mailer = {
  /** False when no SMTP server is configured: nothing can be delivered. */
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
};

export const disabledMailer: Mailer = {
  enabled: false,
  send: async () => { throw new Error('MAIL_NOT_CONFIGURED'); },
};

// Without SMTP settings a development server prints the messages, so the
// links can be opened locally. Production never does: a password link in the
// application log would be readable by anyone with access to the logs.
export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  const budget = { hourly: config.MAIL_HOURLY_LIMIT ?? 50, perRecipientDaily: config.MAIL_RECIPIENT_DAILY_LIMIT ?? 10 };
  if (!config.SMTP_HOST) {
    if (config.NODE_ENV !== 'development') return disabledMailer;
    return withSendBudget({
      enabled: true,
      send: async (message) => { log.info({ mail: { to: message.to, subject: message.subject } }, `E-mail not sent (no SMTP configured):\n${message.text}`); },
    }, budget);
  }
  const port = config.SMTP_PORT ?? 587;
  const transport = createTransport({
    host: config.SMTP_HOST,
    port,
    // Port 465 speaks TLS from the start; the others upgrade with STARTTLS,
    // which is then mandatory so credentials never travel in clear text.
    secure: port === 465,
    requireTLS: port !== 465,
    // A slow provider must not hold sockets for the library default of minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    ...(config.SMTP_USERNAME ? { auth: { user: config.SMTP_USERNAME, pass: config.SMTP_PASSWORD ?? '' } } : {}),
  });
  return withSendBudget({
    enabled: true,
    send: async (message) => { await transport.sendMail({ from: config.MAIL_FROM, ...message }); },
  }, budget);
}

export class MailBudgetExceededError extends Error {}

export type SendBudget = { hourly: number; perRecipientDaily: number; now?: () => number };

// Every account shares the provider quota, and anonymous reset requests can
// trigger messages: past the budget a message is refused instead of sent, so
// no caller can exhaust the quota or flood one inbox. Counters live in memory
// with the single API instance; recipients are kept only as SHA-256 digests.
export function withSendBudget(mailer: Mailer, budget: SendBudget): Mailer {
  const now = budget.now ?? Date.now;
  const hour = 60 * 60_000;
  const day = 24 * hour;
  let sent: number[] = [];
  const perRecipient = new Map<string, number[]>();
  return {
    enabled: mailer.enabled,
    send: async (message) => {
      const at = now();
      sent = sent.filter((time) => at - time < hour);
      for (const [key, times] of perRecipient) {
        const recent = times.filter((time) => at - time < day);
        if (recent.length) perRecipient.set(key, recent);
        else perRecipient.delete(key);
      }
      const recipient = createHash('sha256').update(message.to.toLowerCase()).digest('hex');
      const recipientTimes = perRecipient.get(recipient) ?? [];
      if (sent.length >= budget.hourly || recipientTimes.length >= budget.perRecipientDaily) throw new MailBudgetExceededError('MAIL_BUDGET_EXCEEDED');
      sent.push(at);
      perRecipient.set(recipient, [...recipientTimes, at]);
      await mailer.send(message);
    },
  };
}

// Notifications must not delay or fail the request that triggered them. The
// error is logged by class only: SMTP errors can echo the recipient address.
export function sendInBackground(mailer: Mailer, log: FastifyBaseLogger, message: MailMessage): void {
  if (!mailer.enabled) return;
  mailer.send(message).catch((error: unknown) => {
    log.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'E-mail delivery failed');
  });
}
