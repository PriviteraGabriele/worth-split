<p align="center">
  <img src="apps/web/public/branding/logo.svg" width="88" height="88" alt="Logo WorthSplit">
</p>

<h1 align="center">WorthSplit</h1>

<p align="center"><strong>I tuoi soldi. Finalmente chiari.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/stato-attivo-c6f24e?style=flat-square&labelColor=0f0f10" alt="Stato: attivo">
  <img src="https://img.shields.io/badge/PWA-installabile-c6f24e?style=flat-square&labelColor=0f0f10" alt="PWA installabile">
  <img src="https://img.shields.io/badge/uso-personale-c6f24e?style=flat-square&labelColor=0f0f10" alt="Uso personale">
</p>

WorthSplit è un’app web personale, mobile-first e installabile, per dividere il patrimonio in **bucket** e tenere sotto controllo dove si trova ogni euro. Non è un’app di budgeting: al centro ci sono i saldi, gli spostamenti tra bucket e le spese che arriveranno, con una panoramica chiara sia dal telefono sia dal computer.

<p align="center">
  <img src="docs/media/screenshots/dark-home.webp" width="250" alt="Home con patrimonio netto, spese del mese e bucket">
  <img src="docs/media/screenshots/dark-distribuisci.webp" width="250" alt="Distribuzione di uno stipendio con il template a percentuali">
  <img src="docs/media/screenshots/dark-previsioni.webp" width="250" alt="Spese previste del mese con il residuo da pagare">
</p>

## Perché WorthSplit

Il denaro ha destinazioni diverse: spese correnti, fondo emergenza, vacanze, investimenti. WorthSplit le rappresenta come bucket separati e ti mostra sempre tre cose: quanto hai, dove si trova e quanto ti resta davvero dopo le spese già previste.

- Un patrimonio leggibile a colpo d’occhio, con la composizione per bucket.
- Ogni spostamento tracciato in uno storico che non si riscrive.
- Le spese previste del mese sottratte in anticipo, bucket per bucket.
- Dati privati, sincronizzati tra dispositivi, senza analytics né pubblicità.

## Funzionalità

### Home

- Patrimonio netto con andamento recente, variazione del mese e barra di composizione.
- Riepilogo del mese: quanto resta da pagare e quanto ti rimane **poi**.
- Card dei bucket con saldo, quota sul totale e una barra che mostra la parte già impegnata dalle spese previste, con sotto quanto **resta** una volta pagate.
- Riordino dei bucket con trascinamento, anche da touch.
- Su desktop: vista a griglia con trasferimento rapido, ultimi movimenti e prossime scadenze.

### Spostare denaro

- **Trasferisci** tra due bucket con il tastierino, le scorciatoie 25%, 50% e Tutto, e i saldi prima e dopo per entrambi.
- **Distribuisci** un’entrata su più bucket a importi fissi o in percentuale, con la quota assegnata e la rimanenza in tempo reale.
- **Template** di distribuzione salvati, da applicare con un tocco (per esempio «Stipendio» o «Tredicesima»).
- **Ribilancia** i bucket con il saldo reale del conto: scegli l’ordine di utilizzo e vedi per ogni bucket il saldo prima, quello dopo e la variazione.
- Nel dettaglio di un bucket: aggiungi, sottrai o imposta direttamente il saldo.

### Spese previste

- Spese a importo fisso o stimato, ricorrenti o una tantum, divise per categoria: abbonamenti, rate, una tantum e altro.
- Frequenze mensile, bimestrale, trimestrale, semestrale e annuale, con scadenza a inizio, metà o fine mese oppure in un giorno preciso.
- Vista mese per mese di cosa è aperto e cosa è già pagato. Per le spese stimate il **da pagare** è sempre il residuo, e resta visibile quanto è già stato registrato.
- Pagamenti parziali, correzioni e riapertura di una spesa già chiusa.
- Possibilità di escludere una spesa dal totale stimato a partire da un mese.

### Movimenti e andamento

- Storico completo con filtri per tipo di operazione e ricerca, paginato su desktop.
- Andamento su 6 mesi, 1 anno o tutto lo storico, con la composizione e la variazione di ogni bucket.

### Impostazioni

- Profilo con **foto**, nome e cambio password.
- Gestione di bucket, spese previste e template da pagine dedicate (pannello laterale su desktop).
- Tema chiaro, scuro o automatico, e importi nascosti con un tocco.
- **Backup** completo esportabile in chiaro o cifrato sul dispositivo con AES-256-GCM, con lo storico delle esportazioni. L’import mostra cosa contiene il file e lo confronta con i dati attuali prima di sostituirli.
- **Azzera dati** con reset parziale (movimenti e saldi) o totale, protetto da una parola di conferma.

### Account e privacy

- Più account con patrimoni completamente separati e nessuna registrazione pubblica.
- L’amministratore crea gli account con nome e ruolo, mandando un **invito via email** (l’utente sceglie la password da un link valido 7 giorni) oppure consegnando una password temporanea generata.
- Modifica dei dati, cambio di ruolo, reinvio dell’invito o del link per la password, disattivazione ed eliminazione degli utenti. L’amministratore non vede mai i dati finanziari degli altri.
- Password dimenticata: un link monouso via email, valido un’ora. Un avviso via email segnala ogni cambio o reimpostazione della password.
- Password protette con Argon2id, sessioni in cookie HttpOnly e link salvati solo come impronta SHA-256.

### App installabile

- PWA installabile su iPhone e Android, con icona, schermata di avvio e aree sicure curate (anche la sfocatura che iOS 26 aggiunge in alto).
- La struttura dell’app resta disponibile anche offline; i dati finanziari sono sempre letti dal server, mai da una copia locale.

## Schermate

### Telefono

| Home | Movimenti | Andamento |
| :---: | :---: | :---: |
| <img src="docs/media/screenshots/dark-home.webp" width="240" alt="Home"> | <img src="docs/media/screenshots/dark-movimenti.webp" width="240" alt="Storico dei movimenti con filtri"> | <img src="docs/media/screenshots/dark-andamento.webp" width="240" alt="Andamento del patrimonio su un anno"> |

| Trasferisci | Dettaglio bucket | Impostazioni |
| :---: | :---: | :---: |
| <img src="docs/media/screenshots/dark-trasferisci.webp" width="240" alt="Trasferimento tra due bucket con saldi prima e dopo"> | <img src="docs/media/screenshots/dark-bucket.webp" width="240" alt="Dettaglio di un bucket con aggiunta al saldo"> | <img src="docs/media/screenshots/dark-impostazioni.webp" width="240" alt="Impostazioni"> |

| Tema chiaro | Previsioni (chiaro) | Accesso |
| :---: | :---: | :---: |
| <img src="docs/media/screenshots/light-home.webp" width="240" alt="Home in tema chiaro"> | <img src="docs/media/screenshots/light-previsioni.webp" width="240" alt="Spese previste in tema chiaro"> | <img src="docs/media/screenshots/dark-login.webp" width="240" alt="Pagina di accesso"> |

### Desktop

<img src="docs/media/screenshots/desktop-home.webp" alt="Home su desktop con patrimonio, bucket, trasferimento rapido e scadenze">

<p align="center">
  <img src="docs/media/screenshots/desktop-previsioni.webp" width="49%" alt="Spese previste su desktop">
  <img src="docs/media/screenshots/desktop-andamento.webp" width="49%" alt="Andamento su desktop">
</p>

<sub>Le schermate mostrano un account dimostrativo con dati fittizi.</sub>

## Principi del progetto

- **Precisione prima di tutto.** Gli importi sono gestiti in centesimi interi: nessun arrotondamento involontario nei calcoli.
- **Storico affidabile.** Ogni correzione diventa un nuovo movimento: la storia non viene riscritta.
- **Operazioni atomiche.** Trasferimenti, distribuzioni e ribilanciamenti si completano per intero oppure non avvengono; il server ricalcola tutto senza fidarsi delle anteprime.
- **Mobile prima di tutto.** Tastierino per gli importi, controlli touch ampi, aree sicure di iPhone e finestre pensate per la tastiera virtuale.
- **Autonomia.** Nessun tracker, font remoto, pubblicità o servizio esterno necessario al funzionamento.

## Tecnologie

React, TypeScript, Vite, Fastify, PostgreSQL, Docker Compose e PWA.

Per installazione locale, build, test, configurazione e deploy consulta il [README tecnico](README.tecnico.md).

## Licenza

Distribuito con licenza [MIT](LICENSE). Per segnalare una vulnerabilità segui [SECURITY.md](SECURITY.md).

---

WorthSplit è un progetto personale. Usalo come strumento di organizzazione: non costituisce consulenza finanziaria.
