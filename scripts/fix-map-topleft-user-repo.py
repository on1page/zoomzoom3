#!/usr/bin/env python3
"""Applica il fix .map-topleft al globals.css della repo dell'utente (clone)."""
import sys

path = "/tmp/zoomzoom-1/src/app/globals.css"
with open(path, encoding="utf-8") as f:
    css = f.read()

# 1. .map-loc: da assoluto a elemento della colonna .map-topleft
old_loc = ".map-loc { position: absolute; top: 10px; left: 10px; z-index: 650; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; background: rgba(255,255,255,.94); border: 1px solid var(--line); border-radius: 999px; padding: 4px 6px 4px 12px; box-shadow: var(--shadow-1); font-size: .78rem; }"
new_loc = (
    "/* ricerca città e pulsanti Criterio impilati in colonna in alto a sinistra:\n"
    "   il pannello ricerca può andare a capo e allargarsi quanto serve, i pulsanti\n"
    "   Criterio restano sempre SOTTO di lui — mai sovrapposti o coperti */\n"
    ".map-topleft { position: absolute; top: 10px; left: 10px; z-index: 650; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; max-width: min(76%, 700px); pointer-events: none; }\n"
    ".map-topleft > * { pointer-events: auto; }\n"
    ".map-loc { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; background: rgba(255,255,255,.94); border: 1px solid var(--line); border-radius: 999px; padding: 4px 6px 4px 12px; box-shadow: var(--shadow-1); font-size: .78rem; }"
)

# 2. .map-crit: da assoluto (offset fisso) a elemento in flusso nella colonna
old_crit = ".map-crit { position: absolute; top: 50px; left: 10px; z-index: 648; display: flex; gap: 5px; align-items: center; flex-wrap: wrap; max-width: min(74%, 680px); background: rgba(255,255,255,.94); border: 1px solid var(--line); border-radius: 12px; padding: 5px 8px; box-shadow: var(--shadow-1); }"
new_crit = ".map-crit { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; max-width: 100%; background: rgba(255,255,255,.94); border: 1px solid var(--line); border-radius: 12px; padding: 5px 8px; box-shadow: var(--shadow-1); }"

# 3. media query: la larghezza massima si governa sulla colonna
old_mq = "@media (max-width: 820px) { .map-zone-select { max-width: 130px; } .map-italy-btn { right: 56px; } .map-crit { top: 48px; max-width: calc(100% - 20px); } }"
new_mq = "@media (max-width: 820px) { .map-zone-select { max-width: 130px; } .map-italy-btn { right: 56px; } .map-topleft { max-width: calc(100% - 20px); } }"

for old, new, nome in [(old_loc, new_loc, ".map-loc"), (old_crit, new_crit, ".map-crit"), (old_mq, new_mq, "media query")]:
    if old not in css:
        sys.exit(f"ERRORE: regola {nome} non trovata — interrotto, nessuna scrittura")
    css = css.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(css)
print("OK: 3 sostituzioni applicate")
