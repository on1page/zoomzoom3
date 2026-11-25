# Fix build Vercel — la repo zoomzoom-2 è incompleta

## Il problema (diagnosi certa)

La nuova repo `on1page/zoomzoom-2` contiene **solo 18 file** di configurazione
nella cartella radice (upload del 23/11, commit "Add files via upload").

Mancano **tutte le cartelle del progetto**:

| Cartella mancante | Conseguenza |
|---|---|
| `prisma/` (con `schema.prisma`) | **Il build si ferma qui**: `prisma generate` non trova lo schema |
| `src/` (169 file) | Tutta l'applicazione |
| `public/` (logo, geojson regioni, worker mappa) | Asset statici |
| `db/`, `scripts/`, ecc. | Utilità |

Quando hai caricato i file su GitHub via browser, il trascinamento ha preso
solo i file "sciolti" nella radice del progetto: le cartelle non sono entrate.
Vercel quindi clona una repo quasi vuota e fallisce al primo passo
(`bun install` → postinstall `prisma generate` → "Could not find Prisma Schema").

**La repo `on1page/zoomzoom-1` invece è completa** (ultimo commit 23/11
"Aggiornamento mappa-geografia") e il suo codice **compila senza errori**
(verificato: `bun install` + `prisma generate` + `next build` tutti OK).
Include anche la mappa suddivisa per comune (`map.tsx` con livelli `zz-comuni`
+ API `zone-outline`): non si perde nulla.

---

## Soluzione A — la più rapida (2 minuti, zero file da spostare)

Nel nuovo progetto Vercel:

1. Apri il progetto → **Settings** → **Git**
2. **Disconnect** dal repository attuale (zoomzoom-2)
3. **Connect Git Repository** → scegli `on1page/zoomzoom-1`
4. **Deployments** → **Deploy** (o qualsiasi push su zoomzoom-1)

Se il vecchio progetto Vercel esiste ancora, basta un **Redeploy** lì.

---

## Soluzione B — se vuoi continuare con la repo zoomzoom-2

Serve **GitHub Desktop** (gratuito): https://desktop.github.com

1. GitHub Desktop → **File → Clone repository** → scheda **URL** →
   `https://github.com/on1page/zoomzoom-2` → **Clone**
2. Estrai lo zip `zoomzoom-progetto-completo.zip`
   (è la copia esatta di zoomzoom-1: 332 file, verificata)
3. Copia **tutto** il contenuto estratto dentro la cartella del clone di
   zoomzoom-2 → "Sostituisci i file nella destinazione"
   ⚠️ **NON eliminare la cartella nascosta `.git`** dentro il clone
4. In GitHub Desktop scrivi un messaggio (es. "Progetto completo") →
   **Commit to main** → **Push origin**
5. Vercel ridistribuisce da solo: questa volta `prisma generate` troverà
   `prisma/schema.prisma` e il build passerà

I 3 file extra già presenti in zoomzoom-2 (`next-env.d.ts`,
`.gitattributes`, `demo-credentials.json`) restano lì e non danno fastidio.

---

## Nota sicurezza (importante)

Entrambe le repo sono **pubbliche** e contengono il file `.env` con le
credenziali del database e le chiavi di cifratura.

Consiglio: GitHub → repo → **Settings** → **General** → **Danger Zone** →
**Change visibility** → **Private** (per entrambe le repo).
Vercel continua a funzionare senza problemi con repo private.

---

## Perché ne sono sicuro

- Clonata e ispezionata `zoomzoom-2`: 18 file, nessuna cartella del codice.
- Clonata e ispezionata `zoomzoom-1`: completa, 332 file.
- Confrontati i 18 file in comune: identici (niente di più nuovo da salvare).
- Build completo di zoomzoom-1 eseguito in ambiente pulito: **successo**.
