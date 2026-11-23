#!/usr/bin/env python3
"""Aggiunge width: 100% a .map-viewport (fix overflow mobile) in entrambi i css."""
import sys

RULE_OLD = ".map-viewport { position: relative; overflow: hidden; aspect-ratio: 1000 / 640; min-height: 340px; outline: none; border-radius: 0; background: #DCE6EA; }"
RULE_NEW = (
    "/* width:100% impedisce al min-height di trasformarsi in larghezza minima\n"
    "   attraverso l'aspect-ratio: sotto ~530px di contenitore il box veniva\n"
    "   allargato a 531px e la mappa usciva dallo schermo (veniva troncata) */\n"
    ".map-viewport { position: relative; overflow: hidden; width: 100%; aspect-ratio: 1000 / 640; min-height: 340px; outline: none; border-radius: 0; background: #DCE6EA; }"
)

for path in ["/home/z/my-project/src/app/globals.css", "/tmp/zoomzoom-1/src/app/globals.css"]:
    with open(path, encoding="utf-8") as f:
        css = f.read()
    if RULE_NEW.splitlines()[-1] in css:
        print(f"già applicato: {path}")
        continue
    if RULE_OLD not in css:
        sys.exit(f"ERRORE: regola .map-viewport non trovata in {path}")
    css = css.replace(RULE_OLD, RULE_NEW, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(css)
    print(f"OK: {path}")
