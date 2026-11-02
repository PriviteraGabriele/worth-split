# WorthSplit — README tecnico

Guida per eseguire, verificare, compilare e distribuire WorthSplit. Per una presentazione dell’app consulta il [README](README.it.md) ([in inglese](README.md)).

## Architettura

| Area | Tecnologie |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query, `vite-plugin-pwa` |
| Backend | Node.js 24, Fastify 5, Zod, Argon2 |
| Database | PostgreSQL 18, SQL esplicito, migrazioni versionate |
| Deploy | Docker Compose dietro un reverse proxy HTTPS |
| Osservabilità | Outbox PostgreSQL verso Elasticsearch (opzionale) |
| Test | Vitest, Testing Library, jsdom |

Il repository usa npm workspaces:

```text
apps/api/   API, dominio, migrazioni e test
apps/web/   interfaccia React, PWA e proxy interno
docs/       documentazione di architettura, deploy e stato
```

PostgreSQL è la fonte di verità. Gli importi sono salvati come centesimi interi (`bigint`) e passano come stringhe JSON quando necessario, evitando l’imprecisione dei numeri JavaScript.

## Requisiti

- Node.js 24 consigliato (il repository richiede Node.js 22 o successivo).
- npm 11 o successivo.
- PostgreSQL per l’esecuzione nativa, oppure Docker e Docker Compose per l’ambiente containerizzato.

## Installazione nativa

1. Crea il file di configurazione locale e inserisci segreti adeguati:

   ```bash
   cp .env.example .env
   ```

2. Installa le dipendenze:

   ```bash
   npm install
   ```

3. Con un database PostgreSQL disponibile e `DATABASE_URL` configurata, applica schema e account amministratore iniziale:

   ```bash
   npm run migrate -w @worth-split/api
   npm run bootstrap -w @worth-split/api
   ```

4. Avvia web e API:

   ```bash
   npm run dev
   ```

   Frontend: `http://localhost:5173`  
   API: `http://localhost:3000`

Vite inoltra le richieste `/api` all’API locale.

## Comandi principali

| Comando | Descrizione |
| --- | --- |
| `npm run dev` | Avvia frontend e API in sviluppo. |
| `npm run lint` | Esegue ESLint in entrambi i workspace. |
| `npm run typecheck` | Esegue i controlli TypeScript. |
| `npm test` | Esegue tutti i test. |
| `npm run build` | Crea le build production di API e web. |
| `npm run check` | Esegue lint, typecheck, test e build: è la verifica obbligatoria prima della consegna. |
| `npm run migrate -w @worth-split/api` | Applica le migrazioni SQL pendenti. |
| `npm run bootstrap -w @worth-split/api` | Crea l’amministratore iniziale se assente. |
| `npm run seed:demo -w @worth-split/api` | Carica i dati demo dell’account configurato. |

## Configurazione

Parti da `.env.example`. Le variabili rilevanti sono:

| Variabile | Scopo |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Credenziali del container PostgreSQL. |
| `DATABASE_URL` | Connessione dell’API al database. |
| `SESSION_SECRET` | Firma il cookie dei dispositivi riconosciuti al login; almeno 32 caratteri casuali. Cambiarlo fa dimenticare i dispositivi riconosciuti, ma non chiude le sessioni. |
| `APP_ORIGIN` | Origine pubblica esatta dell’app. |
| `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` | Primo account amministratore. La password deve avere almeno 12 caratteri. |
| `SESSION_DAYS` | Durata sessione, predefinita 30 giorni. |
| `COOKIE_SECURE` | Lasciare `true` in produzione; usare `false` solo in HTTP locale. |
| `TRUST_PROXY` | Proxy di cui l’API si fida per leggere l’IP reale da `X-Forwarded-For`, usato dal rate limit. Predefinito `loopback,linklocal,uniquelocal` (reti Docker private); accetta anche un numero di hop, per esempio `2` per Nginx Proxy Manager + container web. Non è accettato `true`, che permetterebbe di falsificare l’IP. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Server SMTP per inviti, link di reimpostazione e avvisi di cambio password. In produzione: Resend (`smtp.resend.com`, `587`, utente `resend`, password = API key del progetto). Con `SMTP_HOST` vuoto l’invio è disattivato e restano le password temporanee; in sviluppo (`NODE_ENV=development`) le email vengono stampate nel log dell’API. |
| `MAIL_FROM` | Mittente delle email, per esempio `Worth Split <worthsplit@example.com>`. Obbligatorio se è impostato `SMTP_HOST`. |
| `MAIL_HOURLY_LIMIT`, `MAIL_RECIPIENT_DAILY_LIMIT` | Budget di invio: email all’ora in totale (default `50`) e al giorno per destinatario (default `10`). Oltre il budget l’email non parte, così le richieste di reset anonime non possono esaurire la quota del provider né riempire una casella. |
| `WEB_PORT` | Porta pubblicata dallo stack production; predefinita `43128`. |
| `DEV_WEB_PORT` | Porta dello stack hot-reload; predefinita `43127`. |
| `ELASTICSEARCH_URL` | Solo per esecuzione nativa: endpoint Elasticsearch locale, predefinito `http://localhost:9200`. Compose usa sempre la rete interna. |
| `ELASTICSEARCH_USERNAME` / `ELASTICSEARCH_PASSWORD` | Credenziali dell’utente del progetto sull’Elasticsearch condiviso (in produzione `worth-split`). Vuote: nessuna autenticazione, come con il container locale di sviluppo. |
| `ELASTICSEARCH_INDEX_PREFIX` | Prefisso degli indici giornalieri di log; lasciare `worth-split-operation-logs`. |
| `OPERATION_LOG_*` | Attivazione, retention, intervallo e dimensione batch della pubblicazione asincrona; i default nell’esempio sono adatti alla produzione. |

Non versionare `.env` né `.env.local` e non usare i valori d’esempio in ambienti esposti.

## Docker Compose

### Verifica production locale

Le credenziali in `.env.local.example` sono esclusivamente per sviluppo.

```bash
cp .env.local.example .env.local
docker compose --env-file .env.local build
docker compose --env-file .env.local up -d db
docker compose --env-file .env.local run --rm api node apps/api/dist/db/migrate.js
docker compose --env-file .env.local run --rm api node apps/api/dist/db/bootstrap.js
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
```

Apri `http://localhost:43128` e accedi con `local@example.com` / `local-development-password`.
In locale viene avviato anche un Elasticsearch che riceve i log delle operazioni; Grafana e le dashboard non fanno parte di questo repository.

```bash
docker compose --env-file .env.local logs -f api web db
docker compose --env-file .env.local down
```

Non eseguire `docker compose down -v` se vuoi conservare il database locale.

### Sviluppo con hot reload

```bash
cp .env.local.example .env.local
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.dev.yml run --rm api npm run migrate -w @worth-split/api
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.dev.yml run --rm api npm run bootstrap -w @worth-split/api
```

Apri `http://localhost:43127`. Il frontend usa Vite HMR e l’API `tsx watch`; `node_modules` rimane nell’immagine. Dopo modifiche alle dipendenze, ripeti l’avvio con `--build`.

```bash
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.dev.yml logs -f api web
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.dev.yml down
```

## Migrazioni e integrità dati

Le migrazioni si trovano in `apps/api/src/db/migrations/`, sono SQL esplicito e vanno applicate in ordine. Devono essere esclusivamente forward-only e backward-compatible per il deploy.

Le operazioni finanziarie che toccano più bucket usano transazioni; trasferimenti, distribuzioni e ribilanciamenti si completano integralmente oppure vengono annullati. Il backend ricalcola i dati sensibili e non considera affidabili le anteprime del client.

Per le spese pianificate stimate con pagamenti parziali, il residuo è `max(importo stimato − totale degli addebiti registrati, 0)`. Questo valore alimenta il totale “Da pagare”, il dettaglio per bucket e il saldo disponibile mostrato nella dashboard; l’importo già addebitato resta comunque consultabile sulla card della spesa.

I backup includono bucket, movimenti, template, spese pianificate, impostazioni e relative associazioni. L’import è una sostituzione transazionale dopo validazione; account, credenziali e sessioni non vengono esportati.

## Deploy

Lo stack di produzione espone solo il servizio web su `127.0.0.1:${WEB_PORT}`. Configura un reverse proxy HTTPS (per esempio Nginx Proxy Manager) davanti al container, con WebSocket attivi e redirect da HTTP a HTTPS; imposta `APP_ORIGIN` sull’URL pubblico esatto.

Prima del primo avvio esegui nel container API:

```bash
node apps/api/dist/db/migrate.js
node apps/api/dist/db/bootstrap.js
```

Per gli aggiornamenti manuali, applica prima le migrazioni e poi riavvia l’API. Il volume `worth_split_db` è persistente e non va eliminato durante gli aggiornamenti.

### Log delle operazioni (Elasticsearch)

L’API deposita prima gli eventi sanitizzati nell’outbox PostgreSQL e li invia a Elasticsearch in batch. Un’indisponibilità del motore di ricerca non blocca né modifica una richiesta finanziaria: gli eventi restano in coda e vengono ritentati con backoff.

Configura `ELASTICSEARCH_URL` e, se Elasticsearch ha la sicurezza attiva, `ELASTICSEARCH_USERNAME` ed `ELASTICSEARCH_PASSWORD` di un utente che può scrivere e leggere solo gli indici `worth-split-operation-logs-*`. Raggiungi Elasticsearch da una rete Docker dedicata e non esporlo con una porta pubblica.

Gli indici giornalieri `worth-split-operation-logs-*` hanno retention ILM di 180 giorni per impostazione predefinita; policy e template li crea l’API al primo invio. L’outbox conserva le righe già consegnate per sette giorni, mentre quelle non consegnate non vengono eliminate. Modifica le due retention solo se hai valutato spazio disco e requisiti di conservazione. Non usare `docker compose down -v`, perché eliminerebbe dati persistenti.

Le immagini di produzione sono pubblicate da GitHub Actions (`.github/workflows/publish-images.yml`). Le decisioni architetturali sono in [docs/architecture.md](docs/architecture.md).

## Sicurezza

- Nessuna registrazione pubblica; il primo account è creato dal bootstrap.
- I dati finanziari sono sempre isolati per `user_id`; l’amministratore non può leggere il patrimonio degli altri utenti.
- Password con Argon2id; token di sessione casuali in cookie `HttpOnly`/`SameSite`, con solo l’hash SHA-256 nel database. Il login esegue la verifica Argon2 anche per e-mail inesistenti, così il tempo di risposta non rivela quali account esistono; le sessioni scadute vengono eliminate al login.
- Le guardie `authenticate`, `requireAuth` e `requireAdmin` restituiscono sempre la `reply` quando rifiutano una richiesta: in Fastify `reply.sent` diventa vero solo a risposta scritta, e gli hook `onSend` asincroni (log operativi) lo ritardano. Senza il `return` il controller della route verrebbe eseguito comunque, anche per richieste anonime. Il test `apps/api/test/security.test.ts` verifica ogni route con il logging attivo e un database con latenza.
- Tutte le query SQL usano parametri (`$1`, `$2`, …); un test impedisce di interpolare nel testo SQL valori diversi da costanti del codice.
- Importi limitati a 15 cifre, mesi tra il 1900 e il 2199, array e campi testo con dimensione massima; i valori che PostgreSQL non può memorizzare diventano `400 INVALID_INPUT`, mai `500`.
- Nginx limita per IP reale le richieste (`/api/` 20/s con burst 50, login 10/minuto con burst 10) e le connessioni simultanee, rispondendo `429` prima che il traffico raggiunga Node.js.
- Rate limit dell’API: 120 richieste/minuto per IP, limiti più stretti su import/export/validazione backup, reset dati e gestione utenti, e login: 5 tentativi/minuto per IP e, per singola e-mail, al massimo 10 tentativi ogni 15 minuti, poi blocco di 15 minuti (`429 TOO_MANY_LOGIN_ATTEMPTS` con `Retry-After`). Il blocco per e-mail ferma anche attacchi distribuiti su più IP, vale allo stesso modo per e-mail inesistenti e riserva il tentativo prima della verifica della password, così una raffica di richieste simultanee non lo aggira. I contatori sono in memoria e si azzerano al riavvio dell’API.
- L’IP del client è ricavato solo attraverso i proxy fidati (`TRUST_PROXY`): un header `X-Forwarded-For` inviato dal client non permette di cambiare IP ad ogni richiesta.
- In produzione usa sempre HTTPS e `COOKIE_SECURE=true`.
- Inviti e reimpostazione password usano link monouso inviati via email: nel database c’è solo l’hash SHA-256 del token, ogni utente ha al massimo un link valido (7 giorni per l’invito, 1 ora per il reset) e usarlo chiude tutte le sessioni. Il token viaggia nel frammento dell’URL (`#token=…`), quindi non arriva mai ai log di Nginx né nell’header `Referer`. La richiesta di reset risponde sempre `204` e lavora dopo la risposta, così né lo stato né i tempi rivelano quali email esistono; al massimo un link al minuto per account. Nginx applica a `/api/auth/password-reset*` lo stesso limite del login.
- Nginx invia Content-Security-Policy restrittiva (solo risorse same-origin, nessuno script inline, `frame-ancestors 'none'`), HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` e `Permissions-Policy` su pagine, asset e API, e nasconde la versione del server. Le risposte API sono `Cache-Control: no-store`.
- PWA cache-only per la shell statica; le API restano `NetworkOnly`, quindi non esistono mutazioni finanziarie offline.
- I log operativi non contengono payload o risposte: non sono registrati importi, nomi, note, backup, e-mail, password, cookie né token. L’accesso a Grafana resta riservato agli amministratori dell’infrastruttura.

## Qualità e contributi

Prima di consegnare una modifica, esegui dalla root:

```bash
npm run check
```

Correggi ogni errore di lint, tipi, test o build prima di proporre la modifica.

Per un penetration test black-box su uno stack Docker locale (crea account e dati di prova e invia raffiche di richieste, quindi rifiuta host non locali):

```bash
node scripts/security-pentest.mjs http://localhost:43128 local@example.com 'local-development-password'
```

Verifica autorizzazioni e accessi anonimi, isolamento tra account, SQL injection su PostgreSQL reale, validazione dell’input, sessioni, rate limit (inclusa una raffica di 4000 login simultanei e lo spoofing di `X-Forwarded-For`) e header HTTP.
