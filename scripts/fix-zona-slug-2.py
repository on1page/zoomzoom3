#!/usr/bin/env python3
"""Corregge il fallback slug: dopo la risoluzione si usa l'id della scheda."""
import sys

OLD_DESTRUCT = "    const { id } = await ctx.params;\n"
NEW_DESTRUCT = "    const { id: rawId } = await ctx.params;\n"

OLD_BLOCK = (
    '    let ent = await db.entity.findUnique({ where: { id } });\n'
    '    // Fallback per i link alle zone che usano lo slug (es. #/zona/milano):\n'
    "    // se l'id non corrisponde a nessuna scheda, prova a risolvere la scheda\n"
    '    // città della zona con quell\'id (una sola scheda "zona" pubblicata per zona).\n'
    '    if (!ent) {\n'
    '      ent = await db.entity.findFirst({ where: { zoneId: id, categoryId: "zona", status: "published" } });\n'
    '    }\n'
)
NEW_BLOCK = (
    '    let ent = await db.entity.findUnique({ where: { id: rawId } });\n'
    '    // Fallback per i link alle zone che usano lo slug (es. #/zona/milano):\n'
    "    // se l'id non corrisponde a nessuna scheda, prova a risolvere la scheda\n"
    '    // città della zona con quell\'id (una sola scheda "zona" pubblicata per\n'
    '    // zona); da qui in avanti si usa l\'id RISOLTO della scheda trovata.\n'
    '    if (!ent) {\n'
    '      ent = await db.entity.findFirst({ where: { zoneId: rawId, categoryId: "zona", status: "published" } });\n'
    '    }\n'
    '    const id = ent?.id ?? rawId;\n'
)

for base in ["/home/z/my-project", "/tmp/zoomzoom-1"]:
    full = base + "/src/app/api/public/entity/[id]/route.ts"
    with open(full, encoding="utf-8") as f:
        src = f.read()
    if NEW_DESTRUCT in src and NEW_BLOCK in src:
        print(f"già applicato: {full}")
        continue
    if OLD_DESTRUCT not in src or OLD_BLOCK not in src:
        sys.exit(f"ERRORE: blocchi non trovati in {full}")
    src = src.replace(OLD_DESTRUCT, NEW_DESTRUCT, 1).replace(OLD_BLOCK, NEW_BLOCK, 1)
    with open(full, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"OK: {full}")
