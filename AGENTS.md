# Memoria del progetto

## Prodotto e architettura

- Worth Split è un'app personale, mobile-first e multi-account per gestire l'allocazione virtuale del patrimonio: non è un'app di budgeting.
- Il monorepo npm contiene `apps/web` (React 19, Vite, React Router, TanStack Query e PWA) e `apps/api` (Node.js, Fastify, Zod e PostgreSQL). Entrambe le app sono compilabili e distribuibili separatamente.
- PostgreSQL è la fonte di verità. Gli importi sono sempre centesimi interi: `bigint` nel database e stringhe JSON ai confini dell'API. Non convertire importi in `number` per calcoli finanziari.
- Le migrazioni SQL in `apps/api/src/db/migrations` sono versionate e forward-only; per il deploy devono rimanere backward-compatible.
- Tutti i dati finanziari sono isolati per `user_id`. L'amministratore può gestire gli account, ma non leggere i dati finanziari degli altri utenti. È comunque un ruolo di fiducia: password temporanea e cambio dell'email di accesso gli danno il controllo dell'account, quindi ogni azione del genere chiude le sessioni, revoca i link in sospeso e avvisa l'utente.

## Invarianti di dominio

- I saldi dei bucket sono una cache: ogni mutazione aggiorna il saldo e registra operazioni/voci immutabili nella stessa transazione.
- Trasferimenti, distribuzioni e ribilanciamenti devono essere atomici; il server blocca i bucket interessati e ricalcola i valori critici, senza fidarsi delle anteprime client.
- I totali della dashboard considerano solo bucket attivi, non archiviati e con `include_in_total=true`.
- L'autenticazione usa cookie HttpOnly con token di sessione opaco; nel database è memorizzato solo l'hash SHA-256. Non esiste registrazione pubblica.

## Spese pianificate

- Le spese pianificate sono implementate nelle tabelle `planned_expenses`, `planned_expense_occurrences`, `planned_expense_payments` e `planned_expense_estimated_total_visibility`; devono essere incluse e validate in backup/import.
- Supportano importo fisso o stimato, categorie, frequenza mensile/bimestrale/trimestrale/semestrale/annuale/una tantum e regole di scadenza. Le occorrenze e i pagamenti sono separati per mantenere traccia degli addebiti effettivi.
- Una spesa può essere esclusa dal totale stimato a partire da un mese. La home mostra, per bucket, il saldo al netto delle spese pianificate aperte del mese.
- Per una spesa stimata aperta, il valore **da pagare** è il residuo `max(stima − addebiti già registrati, 0)`. Il riepilogo, il dettaglio per bucket e l'ordinamento usano il residuo; la card mostra il residuo in grande e, con un pallino verde, il totale già registrato. Non usare l'importo iniziale al posto del residuo in questi punti.
- Non eliminare un bucket che abbia spese pianificate attive: l'API restituisce `BUCKET_HAS_ACTIVE_PLANNED_EXPENSES`.

## Operatività

- Documentazione di riferimento: `README.md` per sviluppo/deploy e `docs/architecture.md` per le decisioni architetturali.
- In locale: `npm run dev`; migrazioni e bootstrap: `npm run migrate -w @worth-split/api` e `npm run bootstrap -w @worth-split/api`.
- La PWA memorizza soltanto la shell statica. Le API sono `NetworkOnly`: nessuna mutazione finanziaria offline o riconciliazione conflitti nell'MVP.

# Contribution checks

Before considering a feature complete, run `npm run check` from the repository root. This runs linting, type checks, tests, and production builds for both workspaces. Fix every failure before handing the feature off.
