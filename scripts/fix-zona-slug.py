#!/usr/bin/env python3
"""Fix link zone: fallback slug nella API entity + reset stato in ZoneView.
Applicato sia alla sandbox sia al clone della repo dell'utente."""
import sys

# --- 1. API: /api/public/entity/[id] risolve anche lo slug della zona ---
API = "src/app/api/public/entity/[id]/route.ts"
OLD_API = '    const ent = await db.entity.findUnique({ where: { id } });\n'
NEW_API = (
    '    let ent = await db.entity.findUnique({ where: { id } });\n'
    '    // Fallback per i link alle zone che usano lo slug (es. #/zona/milano):\n'
    '    // se l\'id non corrisponde a nessuna scheda, prova a risolvere la scheda\n'
    '    // città della zona con quell\'id (una sola scheda "zona" pubblicata per zona).\n'
    '    if (!ent) {\n'
    '      ent = await db.entity.findFirst({ where: { zoneId: id, categoryId: "zona", status: "published" } });\n'
    '    }\n'
)

# --- 2. ZoneView: reset dello stato quando cambia l'id (404 "appiccicoso") ---
VW = "src/components/views/entity-zone.tsx"
OLD_VW = (
    '  useEffect(() => {\n'
    '    void api<EntityPayload>(`/api/public/entity/${entityId}`).then(res => {\n'
    '      if (res.ok) setData(res); else setNotFound(true);\n'
    '    });\n'
    '  }, [entityId]);\n'
)
NEW_VW = (
    '  useEffect(() => {\n'
    '    // Reset dello stato per il nuovo id: senza questo, una scheda non\n'
    '    // trovata restava "Pagina non trovata" anche dopo aver cambiato zona.\n'
    '    setNotFound(false);\n'
    '    setData(null);\n'
    '    void api<EntityPayload>(`/api/public/entity/${entityId}`).then(res => {\n'
    '      if (res.ok) setData(res); else setNotFound(true);\n'
    '    });\n'
    '  }, [entityId]);\n'
)

for base in ["/home/z/my-project", "/tmp/zoomzoom-1"]:
    for path, old, new in [(API, OLD_API, NEW_API), (VW, OLD_VW, NEW_VW)]:
        full = base + "/" + path
        with open(full, encoding="utf-8") as f:
            src = f.read()
        if new in src:
            print(f"già applicato: {full}")
            continue
        if old not in src:
            sys.exit(f"ERRORE: blocco non trovato in {full}")
        src = src.replace(old, new, 1)
        with open(full, "w", encoding="utf-8") as f:
            f.write(src)
        print(f"OK: {full}")
