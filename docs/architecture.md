# Architecture decision

Worth Split is a synchronized, multi-account web application. The user interface and API are independently buildable and deployable, while sharing one repository.

## Components

- `apps/web`: React, Vite, TypeScript, React Router and TanStack Query.
- `apps/api`: Node.js, Fastify, PostgreSQL and explicit SQL migrations.
- PostgreSQL is the source of truth. Money is represented as integer cents (`bigint` in PostgreSQL and JSON strings at API boundaries when necessary).
- Authentication uses an opaque random session token in an HttpOnly cookie. Only its SHA-256 hash is stored in PostgreSQL.
- The initial account is bootstrapped from environment variables as an administrator. Public registration is not exposed.
- An administrator remains a normal user with private financial data and gains only account-management capabilities. Administrators can create, list, deactivate/reactivate and reset passwords for regular accounts, but cannot access their financial data through the API. The role is still trusted: a temporary password or a new login e-mail gives the administrator control of the account, so these actions close every session, revoke pending password links and notify the user (the previous address, for an e-mail change).
- Every financial query is scoped to the authenticated `user_id`. New accounts start empty and receive independent settings, buckets, operations, templates and backups.
- Administrator-created passwords are temporary. All application endpoints remain blocked until the user replaces the temporary password; personal password changes revoke every other session.

## Domain integrity

Balances are cached on buckets for fast reads. Every mutation updates balances and appends immutable operation/entry records in the same database transaction. Transfers, distributions and smart rebalances lock affected bucket rows and either commit completely or roll back. A rebalance receives the selected buckets, their real aggregate target and an ordered priority bucket; the API recalculates the required entries from locked current balances instead of trusting a client preview. Reductions spill over in selection order, while an increase is credited entirely to the first selected bucket.

Buckets have a persistent `include_in_total` flag, enabled by default. Dashboard totals and monthly changes include only active, non-archived buckets. The API also returns each bucket's monthly contribution so the web client can optimistically update every dashboard summary while visibility changes are saved in the background.

## Offline behavior

The web application is installable and caches its static shell. PostgreSQL remains authoritative, so financial mutations are disabled while offline. Conflict reconciliation is intentionally outside the MVP.

## Login brute-force protection

Login attempts are limited per client IP by `@fastify/rate-limit` and per e-mail by an in-memory `LoginThrottle` (10 attempts per 15 minutes, then a 15-minute lock). The per-e-mail lock stops distributed attacks, applies equally to unknown e-mails so it never reveals whether an account exists, and reserves each attempt before Argon2 verification so a concurrent burst cannot outrun it. So that strangers cannot use that lock to keep the owner out, a successful login leaves an HttpOnly `worth_device` cookie (path `/api/auth`, one year) signed with `SESSION_SECRET` and bound to the e-mail: attempts from that browser are counted in their own bucket with the same limits, so the owner still signs in from a known device while the account is locked for everyone else. Rotating `SESSION_SECRET` forgets every known device; it does not close sessions. The client IP is resolved only through the proxies listed in `TRUST_PROXY`; trusting every hop would let a forged `X-Forwarded-For` header give each request a fresh IP. In-memory counters are acceptable for the single API instance; multiple instances would need a shared store.

## E-mail and password links

The API sends e-mail through SMTP (Resend in production) with `nodemailer`; without `SMTP_HOST` the mailer is disabled and administrators keep using temporary passwords. Invitations and resets share the `password_tokens` table: single-use tokens whose SHA-256 digest is stored, one pending link per user, consumed together with every session when the password is set. Pending links are also revoked whenever the credential they could replace changes another way: a new login e-mail, a temporary password, a personal password change or a deactivation, so reactivating an account never revives an old link. Links carry the token in the URL fragment so it never reaches access logs or `Referer` headers. A reset request always answers `204` and performs the lookup after the response, so neither status nor timing reveals which accounts exist. Notices about a changed password are best-effort and never fail the request. Every message goes through a sending budget (`MAIL_HOURLY_LIMIT` overall, `MAIL_RECIPIENT_DAILY_LIMIT` per recipient, in memory): past it the message is refused, so anonymous reset requests cannot exhaust the provider quota shared by every account or flood one inbox.

## Request guards and HTTP hardening

Authentication guards run as async `preHandler` hooks and always `return reply` after rejecting a request. Fastify only skips the route handler once `reply.sent` is true, which happens when the response has been written; the asynchronous `onSend` hooks of operation logging delay that write, so a guard that only calls `reply.send()` lets the handler run for an anonymous request. Guards therefore decide on the session they loaded, never on `reply.sent`.

SQL is always parameterised. Inputs are bounded before they reach PostgreSQL (amounts to 15 digits, years 1900–2199, array and text lengths), and SQLSTATE class 22 data exceptions map to `400 INVALID_INPUT`. The web container sets a strict same-origin Content-Security-Policy and the other security headers on every response, recovers the client IP from private proxies only, and applies `limit_req`/`limit_conn` before traffic reaches the API.

Shared capacity is bounded per account and per request, not only per IP. `requireAuth` and `requireAdmin` allow 60 writes per account and minute whatever the client address. The PostgreSQL pool has explicit deadlines (10 connections, 10 s to obtain one, 30 s per statement and per idle transaction), so a slow query or a stalled transaction fails that request instead of queueing everybody else. Backup export, import and reset run one at a time per account (`409 BACKUP_IN_PROGRESS`); the export reads one consistent snapshot on a single connection, and the import inserts each table in one statement with ids generated by the API, so a 2 MiB backup no longer turns into thousands of round trips.

## Observability and audit trail

Every meaningful `/api` route is recorded as a semantic operation: authentication, dashboard and history reads, bucket and template management, financial movements, planned-expense lifecycle, profile/settings, backup/import/reset and user administration. Health checks and static assets are deliberately excluded.

The record is created in Fastify's `onSend` phase, after the domain transaction has completed and before the API response leaves the process. It contains a start timestamp, operation name, command/query type, status, duration, request id, HTTP method/status, route, actor id/role, optional UUID resource id and query-key names. Request and response bodies are never stored: this excludes amounts, bucket and expense names, free-form notes, backups, passwords, cookies, tokens and e-mail addresses. Failure logs retain only a stable application error code and error class, never a raw exception message.

Query-key names are kept only when they look like identifiers (at most 10, up to 32 characters). Throttled requests and anonymous calls rejected with 401 (failed logins excepted) are written up to 120 per minute; past that they are dropped, so a client cannot grow the outbox or the shared Elasticsearch ingest beyond what the publisher drains. The API writes the sanitized document to PostgreSQL's `operation_log_outbox`. A background publisher batches it to daily Elasticsearch indexes (`worth-split-operation-logs-YYYY.MM.DD`) with stable document IDs and exponential retry. Elasticsearch is non-critical for the product: an outage cannot fail or roll back a financial mutation, and rows remain in the outbox until Elasticsearch confirms them. The publisher provisions an ILM policy that retains Elasticsearch indexes for 180 days by default; successfully published outbox rows are retained for seven days only.

Dashboards are not part of this repository: any Grafana instance with a read-only Elasticsearch user can chart the indexes. Elasticsearch should be reached through a dedicated Docker network and never exposed with a public port; Grafana, if used, belongs behind an authenticated HTTPS proxy.

## Deferred decisions

- TOTP two-factor authentication (the user model is ready to be extended).
- Automated PostgreSQL backups.
- Full offline mutation queue and conflict resolution.
- Multi-currency conversion.
