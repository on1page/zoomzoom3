# ZoomZoom — Mappa suddivisa per comune — guida rapida

La mappa ora si suddivide per comune su TUTTO il territorio italiano
(confini ISTAT, 7.895 comuni): ogni comune del catalogo con recensioni
sopra soglia è colorato per reputazione, gli altri mostrano il confine e
un invito a scrivere la prima recensione. I filtri «Criterio» ricolorano
anche i comuni. Dettagli e collaudo (8/8) in
AGGIORNAMENTO-mappa-comuni.txt.

## Installazione

```powershell
# opzione A — copia (consigliata: porta anche i 20 file dei confini)
cd C:\Users\Carlo\sito\zoomzoom
Copy-Item -Force -Recurse "pacchetto\src\*" "src\"
Copy-Item -Force -Recurse "pacchetto\public\*" "public\"

# opzione B — patch per i file src + copia dei soli confini
git apply percorso\zoomzoom-mappa-comuni.patch
Copy-Item -Force -Recurse "pacchetto\public\comuni" "public\"
```

Poi commit e push: Vercel ridistribuisce. Nessuna migrazione database,
nessuna nuova dipendenza.

## Prova rapida

- `#/mappa` → scegli una città e zooma un po' fuori: il territorio si
  divide in comuni (bordi blu); la tua città resta colorata.
- Clicca un comune vicino senza recensioni: «Nessuna recensione
  pubblicata» + invito ad aggiungerlo.
- Attiva un «Criterio» (es. Costi della vita): i comuni si ricolorano.
- Vista Italia: regioni colorate come prima (nulla è cambiato).
