# ZoomZoom — portale di recensioni verificate su case, zone e servizi della casa

Implementazione reale (backend + database + controlli server-side) del prototipo
statico fornito nel PDF di riferimento. Nome provvisorio **ZoomZoom**:
configurabile da back office, da sottoporre a verifica di disponibilità del
marchio prima del lancio.

> **Avvertenza onesta**: questo software non è "immune da attacchi", non
> garantisce che le recensioni siano "vere", e la presenza di informative e
> banner non costituisce conformità legale. Le sezioni "Limiti dichiarati" e
> "Verifiche professionali pre-lancio" elencano esattamente cosa è implementato
> e cosa resta da verificare.

---

## 1. Cosa è stato mantenuto, corretto, escluso rispetto al PDF

### Mantenuto
- Identità visiva: palette blu notte/avorio/oro, titoli serif, testo sans,
  chip di categoria, badge "Esperienza verificata", stelle oro con valore /10,
  card, footer, barra demo (solo ambiente demo), toast, modali accessibili.
- Struttura responsive: navbar sticky con menu categorie, hero con ricerca,
  mappa interattiva (pan/zoom/rotella/tastiera/GPS facoltativo), classifiche a
  tab, schede, zona con top-3 per categoria, back office.
- Le 7 categorie con criteri dedicati e configurabili (DB), tipi di esperienza,
  unità prezzo per categoria.
- Recensioni: voto 0–10 step 0,5, criteri per categoria, pro/contro, testo,
  periodo, dichiarazione, prezzi in tre nature (richiesto / proposto-offerta /
  concluso-pagato) trattati come dichiarati, rettifiche tracciate con finestra
  configurabile, badge "dato fittizio" sui contenuti demo.
- Inviti monouso con scadenza configurabile, verifica documentale, una
  recensione per esperienza, segnalazioni/contestate/appelli, classifiche con
  `PC = (n·M + m·C)/(n+m)` e parametri esposti, cookie con consenso granulare,
  AdSense condizionale, ruoli (user/moderator/admin/superadmin) e permessi,
  audit log e security log, casella email demo (solo DEMO_MODE).

### Corretto (dal prototipo al server-side)
| Prototipo (PDF) | Implementazione reale |
|---|---|
| Tutto in JavaScript nel browser | Ogni regola in API route server-side; il client riflette, non decide |
| `localStorage` come "database" | Prisma + SQLite; `localStorage` solo per la preferenza di zona (non sensibile) |
| Password SHA-1 lato client | scrypt con sale per utente, confronto a tempo costante |
| TOTP calcolato nel browser, codice mostrato nella pagina admin | TOTP server-side, segreto cifrato AES-256-GCM, codici mostrati **solo** via script CLI locale |
| Token invito conservato in chiaro (`tokenPlain`) | Solo hash SHA-256 nel DB; in chiaro soltanto nel link email |
| Riscatto invito non atomico | Transazione condizionale (`updateMany where usedAt: null`): richieste concorrenti → una sola riesce |
| Sessioni in `localStorage` | Cookie httpOnly SameSite=Lax, token hashed in tabella `Session`, sessioni pubblica (7 g) e admin (30 min) separate |
| Controllo permessi nel client | `requireStaff(perm)` server-side su ogni API di back office |
| Upload "simulato" (solo nome file) | Upload reale in area privata (`db/uploads`), tipi/limiti/magic-byte, download solo staff, cancellazione dopo decisione |
| Supabase con chiave nel client | Nessuna chiave nel client; flag di funzionalità dal server |
| Password demo e codici TOTP nel front-end | Credenziali demo solo in `demo-credentials.json` (gitignored) e nel README |

### Escluso (perimetro v1)
Annunci di vendita/affitto, appuntamenti, prenotazioni, messaggistica privata,
pagamenti, servizi premium, vendita di posizioni. Il pannello di configurazione
Supabase lato client del PDF è stato sostituito dall'architettura server-first.

---

## 2. Architettura

```
Next.js 16 (App Router, TypeScript) — unica pagina pubblica `/` (SPA con hash routing)
├── API routes server-side (src/app/api/**)  ← TUTTE le regole di dominio qui
│   ├── public/    bootstrap, search, entity, rankings, map (solo lettura)
│   ├── auth/      register, login(+2FA, backup), logout, me, verify-email,
│   │              change-password, 2fa/start|enable|disable|backup-login, google/*
│   ├── me/        overview, export, delete-request, nickname
│   ├── subject/   experience (registra esperienza + invito), overview
│   ├── invitations/ info/[token], redeem (transazione atomica)
│   ├── experiences/ verify-request (upload multipart in area privata)
│   ├── reviews/   POST (creazione), [id] PUT (rettifica tracciata)
│   ├── reports/ (+appeal), disputes, proposals, contact, consent
│   └── admin/     login (TOTP obbligatorio), data/[section], action, docs/[id]
├── Librerie server (src/lib/server/**)
│   ├── crypto.ts    scrypt, token 256 bit, SHA-256, AES-256-GCM
│   ├── totp.ts      RFC 6238 server-side, cifratura del segreto
│   ├── auth.ts      sessioni httpOnly separate, lockout, ruoli/permessi
│   ├── rate-limit.ts  contatori in-memory per IP+azione (vedi limiti)
│   ├── mailer.ts    SMTP reale se configurato; registro email altrimenti
│   ├── audit.ts     audit log (moderazione) e security log
│   ├── settings.ts  impostazioni modificabili dal back office
│   ├── categories.ts categorie/criteri da DB + snapshot di versione
│   ├── score.ts     medie, prior di categoria, PC = (n·M + m·C)/(n+m)
│   ├── validation.ts validazione recensioni, motivi segnalazione
│   ├── public-data.ts serializzazioni pubbliche (niente dati sensibili)
│   └── http.ts      risposte JSON, guard (rate limit + origine), errori generici
├── Frontend (src/components/**)  design system fedele al PDF, viste pubbliche,
│   area personale, flussi di recensione, back office
└── Prisma + SQLite (prisma/schema.prisma, db/custom.db)
```

### Schema dati (19 tabelle)
`User` (scrypt, TOTP cifrato, ruoli) · `Session` (public/admin, hash) ·
`BackupCode` · `EmailVerifyToken` · `Category` + `Criterion` + `CategoryVersion`
(snapshot dei criteri al momento della recensione: le modifiche amministrative
non alterano i punteggi storici) · `Zone` · `Entity` · `EntityProposal` ·
`Experience` · `Invite` (solo hash) · `VerificationDoc` (area privata, retention) ·
`Review` (criteri JSON + versione) · `Report` + `ReportDecision` · `Dispute` +
`DisputeDecision` · `AuditLog` · `SecurityLog` · `Setting` · `Consent` ·
`EmailLog` · `PrivacyRequest` · `ContactRequest`.

### Ruoli e permessi
- **user**: consultazione pubblica; recensioni solo con esperienza registrata.
- **moderator**: `mod.reports`, `mod.reviews`, `mod.experiences`, `mod.disputes`, `audit.own`.
- **admin**: + `admin.users/entities/invites/contents/settings/security`, `audit.full`.
- **superadmin**: + `admin.roles`, `admin.demo`.

TOTP **obbligatoria** per lo staff: il login amministrativo la richiede, la
promozione a ruolo staff è rifiutata senza 2FA attiva, e la disattivazione è
bloccata per i ruoli di back office. Le sessioni admin scadono dopo 30 minuti
di inattività e sono separate da quelle pubbliche.

### Flussi principali
- **Invito**: soggetto verificato (account collegato alla propria scheda)
  registra esperienza → email con token monouso (hash nel DB, scadenza
  configurabile, legato a destinatario+esperienza) → riscatto atomico →
  recensione (UNIQUE su `experienceId` = una recensione per esperienza).
  Limiti: inviti/giorno per scheda, approvazione sopra soglia, dichiarazione
  obbligatoria di invito a tutti i clienti (non solo i soddisfatti), revoca.
- **Verifica documentale**: upload privato (PDF/PNG/JPG/WebP ≤ 8 MB, magic
  byte) → revisione umana → approvazione collega l'esperienza all'utente →
  documento cancellato (retention configurabile).
- **Moderazione**: segnalazione → presa in carico → decisione motivata (audit)
  → appello entro 15 giorni → chiusura. Nessuna rimozione automatica; la
  sospensione della visibilità di una scheda è un provvedimento motivato.
- **Classifiche**: `PC = (n·M + m·C)/(n+m)` con `m` = soglia recensioni e `C` =
  media della categoria, parametri esposti nell'API e nella pagina; sotto
  soglia le schede restano consultabili ma segnate "dati insufficienti".

---

## 3. Configurazione

`.env` (variabili d'ambiente):

| Variabile | Uso | Se manca |
|---|---|---|
| `DATABASE_URL` | SQLite (es. `file:/percorso/db/custom.db`) | errore avvio |
| `APP_SECRET` | chiave AES-256-GCM per i segreti TOTP | errore su 2FA |
| `DEMO_MODE` | `true` = dati demo + barra avviso + casella demo | di fatto `false` |
| `APP_BASE_URL` | URL pubblico per i link nelle email | link relativi |
| `SMTP_HOST/PORT/USER/PASS/FROM` | invio email reale (nodemailer) | email registrate e NON inviate (dichiarato in UI) |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth (code flow con state) | bottone non mostrato, API risponde 503 esplicita |
| `NODE_ENV=production` | cookie `Secure` | — |

Impostazioni modificabili da back office (`/api/admin/action settings.update`):
`siteName`, `minReviews` (m della formula), `rettificaDays`, `inviteDailyCap`,
`inviteApprovalAbove`, `inviteExpiryDays`, `proofRetentionDays`,
`mapMinAggregate`, `adsEnabled`, `adsClient`, testi hero e avviso demo.

## 4. Avvio

```bash
bun install
bun run db:push        # crea/aggiorna lo schema SQLite
bun scripts/seed.ts    # SOLO demo: dati fittizi su città italiane reali, marcati isDemo
bun run dev            # sviluppo (qui il server è già attivo sulla porta 3000)
```

### Account dell'istanza demo
Creati dal seed, con dominio riservato `esempio.test` (RFC 6761): **non sono
credenziali valide su alcun sistema reale**. Password e segreti TOTP sono in
`demo-credentials.json` (gitignored, mai nel front-end):

- `utente@esempio.test` — utente con esperienze e invito attivo
- `agenzia@esempio.test` — soggetto verificato (Il Portico Immobiliare)
- `moderatore@ / admin@ / superadmin@esempio.test` — staff (2FA obbligatoria)

Codice TOTP corrente per i test (solo CLI, mai via API):
```bash
bun scripts/totp.ts admin@esempio.test
```
Il back office è raggiungibile su `#/admin` (non linkato pubblicamente; la
sicurezza è l'autenticazione server-side, non l'URL nascosto).

## 5. Test automatici

```bash
bun tests/api.test.ts    # richiede dev server attivo e seed demo
```
17 test end-to-end su: bootstrap senza dati sensibili, ricerca/classifiche con
parametri esposti, registrazione/login (anche errati), canale staff separato,
2FA obbligatoria admin, permessi distinti (moderatore ≠ admin), inviti solo
alla propria scheda + dichiarazione anti-selezione, **riscatto invito atomico
sotto richieste concorrenti**, una recensione per esperienza (duplicato 409),
payload invalido rifiutato, rettifica tracciata, moderazione con audit +
ripristino, assenza di segreti nei log, privacy mappa, documenti non
scaricabili senza permessi.

## 6. Deploy e backup (produzione)

1. `DEMO_MODE=false` (o assente), DB nuovo senza dati demo (il superadmin può
   eliminarli anche a runtime dal back office → sezione "Dati dimostrativi").
2. HTTPS ovunque (cookie `Secure` automatici con `NODE_ENV=production`),
   `APP_BASE_URL` pubblico, SMTP configurato, credenziali Google/AdSense se usate.
3. Migrazioni: `bun run db:migrate` (o `db:push` iniziale).
4. **Backup**: il database è un file SQLite — backup consistenti con
   `sqlite3 db/custom.db ".backup backup/custom-$(date +%F).db"` (o copia a
   servizio fermo), da cifrare a riposo; includere `db/uploads` o escluderla
   se si sceglie retention breve. Testare il ripristino.
5. Aggiornamento dipendenze: `bun update` + revisione delle advisory;
   rieseguire `bun tests/api.test.ts` dopo ogni aggiornamento.
6. Monitoraggio e risposta agli incidenti: vigilare `SecurityLog`
   (`login_failed_repeat`, `invite_token_invalid`, …), definire runbook per
   sospensioni account/schede e revoca inviti, conservare i log con durata
   definita dal professionista.

---

## 7. Limiti dichiarati (ambiente attuale)

- **SMTP non configurato** → le email non partono: i flussi lo dichiarano in UI
  ("email non configurata") e in demo i messaggi restano nella casella del back
  office. Nessuna simulazione occulta.
- **Google OAuth non configurato** → bottone assente, endpoint esplicita 503.
- **Mappa reale del territorio italiano**: cartografia OpenStreetMap via Leaflet,
  con vista di insieme sull'intera Italia (continente, Sicilia e Sardegna) e 12
  città reali distribuite su tutto il territorio. Regole privacy applicate
  (solo immobili come punti, aggregati di città con soglia e soppressione,
  mai persone geolocalizzate); i pin hanno etichettatura anti-collisione e i
  punti immobile compaiono a zoom ravvicinato. L'endpoint `/api/public/map`
  resta l'unica sorgente dei dati; per un tile provider commerciale bastano
  poche righe in `src/components/map.tsx`.
- **Antivirus sui caricamenti non disponibile** qui: validazione di tipo, dimensione
  e magic byte sì; scansione virale = requisito pre-lancio.
- **Rate limiting in-memory**: per istanza singola; in multi-istanza spostare
  su Redis o equivalente.
- **SQLite**: adeguato al MVP; per carichi maggiori migrare a PostgreSQL
  (schema Prisma portabile).
- **AdSense**: slot caricati solo con consenso marketing + attivazione admin +
  ID client configurato; senza questi, nessuno script pubblicitario parte.

## 8. Verifiche professionali pre-lancio (bozze con segnaposto 【…】)

1. **Legale**: privacy, cookie, termini, regole recensioni, moderazione —
   titolare, basi giuridiche, durate conservazione, giurisdizione, DSA,
   normativa consumatori; etichettatura pubblicità.
2. **Marchio**: disponibilità di "ZoomZoom" (configurabile in
   Contenuti → Nome del sito).
3. **Fornitore mappe reali**: licenza, attribuzione, termini, informativa
   sull'invio di coordinate al provider.
4. **Retention documenti di verifica e backup**: durate e cifratura.
5. **Pentest / code review di sicurezza esterna** + test di carico.
6. **Procedura incident response** e registro dei responsabili.
7. **Verifica anti-selettività inviti**: audit dei volumi per soggetto
   (disponibile nel back office → Inviti).

## 9. Demo / MVP / requisiti pre-lancio

| Livello | Stato |
|---|---|
| **Demo** (`DEMO_MODE=true`, quest'istanza) | Dati fittizi su città italiane reali (coordinate vere, contenuti inventati) marcati `isDemo`, barra avviso, casella email demo staff-only, credenziali di test solo locali |
| **MVP** | Tutte le funzioni con SMTP reale, `DEMO_MODE=false`, HTTPS, backup verificati |
| **Pre-lancio** | Revisione legale dei testi, verifica di licenze/limiti del tile provider per il traffico di produzione, pentest, procedure di incident response, monitoraggio, verifica marchio |
