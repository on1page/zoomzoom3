#!/usr/bin/env python3
"""Aggiunge min-width:0 all'aside di .grid-zone (la mappa nel sidebar non
deve gonfiare la colonna oltre lo schermo sui telefoni)."""
import sys

OLD = ".grid-zone { grid-template-columns: 1fr 340px; align-items: start; gap: 26px; }\n"
NEW = (
    ".grid-zone { grid-template-columns: 1fr 340px; align-items: start; gap: 26px; }\n"
    "/* la mappa nell'aside ha una larghezza minima intrinseca (aspect-ratio +\n"
    "   min-height): senza min-width:0 la colonna del grid non può scendere\n"
    "   sotto quella larghezza e sui telefoni la sidebar esce dallo schermo */\n"
    ".grid-zone > aside { min-width: 0; }\n"
)

for base in ["/home/z/my-project", "/tmp/zoomzoom-1"]:
    full = base + "/src/app/globals.css"
    with open(full, encoding="utf-8") as f:
        css = f.read()
    if ".grid-zone > aside { min-width: 0; }" in css:
        print(f"già applicato: {full}")
        continue
    if OLD not in css:
        sys.exit(f"ERRORE: regola .grid-zone non trovata in {full}")
    css = css.replace(OLD, NEW, 1)
    with open(full, "w", encoding="utf-8") as f:
        f.write(css)
    print(f"OK: {full}")
