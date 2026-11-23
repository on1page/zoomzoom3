# ZoomZoom — Mappa: geografia delle città + verifica allineamento

## In sintesi
La mappa «Reputazione su Mappa» sul tuo sito non colorava le regioni NON per
un difetto di codice (tutto aggiornato e funzionante, verificato sul sito
pubblico) ma perché le 12 città del catalogo, nate col vecchio seed, non hanno
provincia e regione nel database. Senza quei campi la mappa non può aggregare.
Questo pacchetto aggiunge un pulsante amministrativo che li completa.

## Applica (5 minuti)
1. Patch: `git apply percorso\zoomzoom-mappa-geografia.patch` (progetto pulito
   al commit «fix mappa»), oppure copia i 3 file di `src\` e cancella
   `src\app\api\auth\me\profile\`.
2. `bun install` — necessaria: risolve anche l'errore locale
   «Can't resolve 'maplibre-gl'» (le dipendenze erano aggiornate su
   package.json ma non installate nel tuo computer).
3. `bun run dev` → controlla home, `#/mappa`, `#/admin/entita`.
4. `git add -A` → `git commit -m "mappa: completamento geografia delle città (pulsante admin) e pulizia rotta profilo"` → `git push`.
   Nessuna migrazione né db push.

## Dopo il deploy (il passo che ACCENDE la mappa)
Area amministrativa → «Schede e proposte» → in fondo →
**«Completa provincia e regione delle città»**. Un click, e la mappa
(`#/mappa`) mostra le regioni colorate. Ripetibile senza rischi.

## Verifica l'allineamento (quanto sono uguali i progetti?)
```powershell
powershell -ExecutionPolicy Bypass -File .\verifica-allineamento.ps1
```
Confronta tutti i 169 file di `src\` con la versione collaudata (manifest
SHA-256). «TUTTO ALLINEATO» = codice identico al byte; ogni altra differenza
è nei dati o nell'ambiente (schema Postgres, .env), non nei file.

## Contenuto
- `AGGIORNAMENTO-mappa-geografia.txt` — diagnosi completa e istruzioni
- `src/…` — 3 file (nuovo `zone-geo.ts`, rotta admin, pannello admin)
- `zoomzoom-mappa-geografia.patch` — le modifiche (elimina anche la vecchia
  rotta `auth/me/profile` rimasta nella repository)
- `MANIFEST-src.sha256` + `verifica-allineamento.ps1` — misura dell'allineamento
- `anteprime/` — mappa prima/dopo, pulsante, rapporto del completamento
