# Aggiornamento home page ZoomZoom — guida all'installazione

Questo pacchetto contiene l'aggiornamento della home page concordato (punto 2 del piano),
testato con build di produzione (`next build` OK) e verifica visiva su 1440/1290/1100/950 px.

## Cosa cambia

1. **Titolo hero grande** — Nuovo H1 «La tua casa per la **prossima avventura**» (accento oro),
   dimensione responsive `clamp(2.4rem, 6vw, 6.25rem)`: ~86 px su schermo 1440 px, fino a 100 px
   su schermi ampi, ~33 px su smartphone. Il paragrafo sotto il titolo resta quello impostato
   nelle impostazioni del sito (heroSub): quando hai il testo definitivo, sostituiscilo lì.
2. **Card località al posto dei 3 rettangoli** — La sezione con i tre rettangoli è stata
   sostituita da «Le città Zoom»: tre card grandi (Roma, Milano, Napoli — top 3 della gerarchia)
   con recensioni e media reali della zona, più una riga di chip con le altre sette città
   (Torino, Bologna, Firenze, Genova, Bari, Cagliari, Catania). Catania non essendo ancora in
   catalogo mostra «in arrivo» e non è cliccabile. Le altre città già nel database
   (Venezia, Palermo, Reggio Calabria, Laveno-Mombello) restano raggiungibili.
3. **Menu di navigazione** — Nuova voce «Cerca casa» in testa al menu desktop e al menu mobile:
   apre la pagina `#/cerca-casa`.
4. **Pagina ponte `#/cerca-casa`** — Selezione delle 10 città Zoom in ordine alfabetico con
   statistiche reali, avviso «ricerca avanzata in arrivo» e collegamenti alla ricerca esistente
   e alla mappa. Quando realizzeremo il punto 3 (ricerca completa con mappa e filtri), questa
   vista verrà sostituita.
5. **Nuova sezione «Come funziona»** — Tre step orientati al percorso di scelta della casa
   (Esplora città e zone / Leggi chi c'è già stato / Decidi senza sorprese). **I testi sono
   provvisori**: sostituiscili con quelli definitivi appena li hai.
6. **Testo introduttivo sezione recensioni** — Nuova intestazione «Le recensioni della community»
   con conteggi reali (recensioni e schede). Anche questo testo è provvisorio.
7. **Footer** — Link «Cerca casa» in cima alla colonna «Il progetto».
8. **Migliorie tecniche** — Voci di menu sempre su una riga (`white-space: nowrap` + compattamento
   automatico tra 861 e 1290 px); note della hero con contrasto corretto sullo sfondo scuro;
   tipi TypeScript corretti nelle classifiche della home (campo `RankRow`).

## File coinvolti

| File | Stato |
| --- | --- |
| `src/lib/zoom-cities.ts` | nuovo — le 10 città Zoom (gerarchia, ordine alfabetico, coordinate) |
| `src/components/views/home.tsx` | modificato — hero, città Zoom, come funziona, intro recensioni |
| `src/components/views/cerca-casa.tsx` | nuovo — pagina ponte «Cerca casa» |
| `src/components/chrome.tsx` | modificato — menu desktop/mobile e footer |
| `src/app/page.tsx` | modificato — rotta `#/cerca-casa` |
| `src/app/globals.css` | modificato — titolo grande, card/chip città, fix menu |

## Come applicare le modifiche

Dalla cartella del progetto (dove c'è `package.json`), con il branch pulito:

```bash
# opzione A — patch (consigliata)
git apply zoomzoom-home-update.patch

# opzione B — copia dei file
# copia il contenuto di zoomzoom-home-update/src/ dentro src/ del progetto
```

Poi verifica in locale:

```bash
npm run dev   # o: bun run dev
# apri http://localhost:3000/ e http://localhost:3000/#/cerca-casa
```

Se tutto va bene, commit e push: Vercel ridistribuisce automaticamente.

## Note

- Nessuna modifica a database, schema Prisma o API: solo frontend.
- Catania è l'unica città Zoom senza scheda: appare come «in arrivo».
  Quando la aggiungerai al catalogo, la card/chip diventerà automaticamente cliccabile
  (la logica guarda le zone disponibili nel boot del sito).
- Il conteggio recensioni e le medie sulle card vengono dalle API delle classifiche:
  se una città non ha ancora recensioni, la card mostra un testo di cortesia.
- Testi ancora da definire da parte tua (marcati come provvisori): step della sezione
  «Come funziona», introduzione della sezione recensioni, testo sotto il titolo hero.
