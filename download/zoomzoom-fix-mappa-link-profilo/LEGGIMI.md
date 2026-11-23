# ZoomZoom — Fix mappa, link città, rotta profilo — guida rapida

Quattro fix in un pacchetto (dettagli e verifiche in
AGGIORNAMENTO-fix-mappa-link-profilo.txt):

1. **Controlli mappa** — pannello ricerca e barra «Criterio» impilati in
   colonna: mai sovrapposti, a qualsiasi larghezza.
2. **Mappa mobile** — su telefoni la mappa usciva dallo schermo (531px
   fissi): ora segue il contenitore; da 780px in su non cambia nulla.
3. **Link città** — le card/chip della home puntavano a #/zona/roma e
   finivano su «Pagina non trovata»: la API risolve ora anche lo slug
   (+ reset dello stato pagina al cambio zona).
4. **Rotta profilo** — src/app/api/me/profile/route.ts era in
   api/auth/me/profile/: categoria e foto del profilo non si salvavano.
   File spostato nel percorso giusto.

## Installazione

```powershell
# opzione A — patch (consigliata)
cd C:\Users\Carlo\sito\zoomzoom
git apply percorso\zoomzoom-fix-mappa-link-profilo.patch

# opzione B — copia dei file, poi elimina la vecchia cartella:
Copy-Item -Force -Recurse "src\*" "C:\Users\Carlo\sito\zoomzoom\src\"
Remove-Item -Recurse -Force "C:\Users\Carlo\sito\zoomzoom\src\app\api\auth\me\profile"
```

Poi commit e push: Vercel ridistribuisce. Nessuna migrazione database.

## Prova rapida

- Telefono: home e #/mappa — mappa intera, pulsanti «Criterio» visibili.
- Home: clic su Roma / Milano / Napoli e sui chip → pagina zona (non 404).
- Profilo: categoria e foto si salvano.

## Urgente (sicurezza)

Il file `.env` con le credenziali del database è nella repository GitHub
pubblica: leggi l'ultima sezione dell'AGGIORNAMENTO — cambia la password
del database Supabase e poi togli `.env` dalla repository.
