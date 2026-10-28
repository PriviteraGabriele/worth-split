import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { MailMessage } from './mailer.js';

export type PasswordTokenPurpose = 'invite' | 'reset';

// An invitation may wait a few days in the inbox; a reset link is used at once.
const lifetimes: Record<PasswordTokenPurpose, string> = { invite: '7 days', reset: '1 hour' };

export const passwordTokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');

/** Replaces any pending link of the user with a new one and returns its token. */
export async function issuePasswordToken(client: Pick<PoolClient, 'query'>, userId: string, purpose: PasswordTokenPurpose): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await client.query('DELETE FROM password_tokens WHERE user_id=$1', [userId]);
  await client.query(
    `INSERT INTO password_tokens(user_id,token_hash,purpose,expires_at) VALUES($1,$2,$3,now()+$4::interval)`,
    [userId, passwordTokenDigest(token), purpose, lifetimes[purpose]],
  );
  return token;
}

// The token travels in the fragment: browsers never send it to the server, so
// it cannot end up in proxy access logs or in a Referer header.
export const passwordLink = (appOrigin: string, token: string) => `${appOrigin.replace(/\/+$/, '')}/reimposta-password#token=${token}`;

type Recipient = { email: string; firstName: string | null };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const greeting = (recipient: Recipient) => recipient.firstName ? `Ciao ${recipient.firstName},` : 'Ciao,';

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }, footer?: string): string {
  const body = paragraphs.map((text) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(text)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#64748b">Se il pulsante non funziona, copia questo link nel browser:<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : '';
  const note = footer ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#94a3b8">${escapeHtml(footer)}</p>` : '';
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Worth Split</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">${escapeHtml(title)}</h1>${body}${button}${note}
</div></body></html>`;
}

function message(to: string, title: string, paragraphs: string[], action?: { label: string; url: string }, footer?: string): MailMessage {
  const text = [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : []), ...(footer ? [footer] : [])].join('\n\n');
  return { to, subject: `${title} — Worth Split`, text, html: layout(title, paragraphs, action, footer) };
}

export const inviteEmail = (recipient: Recipient, url: string) => message(
  recipient.email,
  'Il tuo account è pronto',
  [greeting(recipient), 'È stato creato per te un account su Worth Split. Scegli la tua password per iniziare: il link è valido per 7 giorni e può essere usato una sola volta.'],
  { label: 'Scegli la password', url },
  'Se non ti aspettavi questo invito, puoi ignorare questa email.',
);

export const resetEmail = (recipient: Recipient, url: string) => message(
  recipient.email,
  'Reimposta la password',
  [greeting(recipient), 'Abbiamo ricevuto una richiesta per reimpostare la password del tuo account. Il link è valido per 1 ora e può essere usato una sola volta.'],
  { label: 'Reimposta la password', url },
  'Se non hai richiesto tu il reset, ignora questa email: la tua password resta invariata.',
);

const changedAt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Rome' });

// Sent to the previous address: the new one is left out, so a mailbox that
// is no longer the owner's does not learn where the account went.
export const emailChangedEmail = (recipient: Recipient, when = new Date()) => message(
  recipient.email,
  'Email di accesso modificata',
  [
    greeting(recipient),
    `Il ${changedAt.format(when)} un amministratore ha cambiato l’indirizzo email con cui accedi al tuo account. Questo indirizzo non è più collegato all’account e tutte le sessioni sono state chiuse.`,
    'Se non te lo aspettavi, contatta subito l’amministratore.',
  ],
);

export const passwordChangedEmail = (recipient: Recipient, by: 'user' | 'admin', when = new Date()) => message(
  recipient.email,
  'Password modificata',
  [
    greeting(recipient),
    by === 'admin'
      ? `Il ${changedAt.format(when)} un amministratore ha reimpostato la password del tuo account con una password temporanea. Tutte le sessioni sono state chiuse.`
      : `Il ${changedAt.format(when)} la password del tuo account è stata modificata.`,
    'Se non sei stato tu, contatta subito l’amministratore.',
  ],
);
