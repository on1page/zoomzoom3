#!/usr/bin/env python3
"""Adatta lo schema Prisma del sandbox (SQLite) alla versione dell'utente
(PostgreSQL/Supabase con url + directUrl), mantenendo invariati i modelli."""
import pathlib

SCHEMA = pathlib.Path("/home/z/my-project/scripts/mappa-italia/prisma/schema.prisma")
text = SCHEMA.read_text(encoding="utf-8")

# Intestazione corrente (sandbox, SQLite) da sostituire
old_header = """// ZoomZoom — schema del database (Prisma + SQLite)
// Nota: SQLite non supporta array o enum nativi: i valori enumerati sono
// validati a livello applicativo (src/lib/validation.ts) e i JSON sono serializzati.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
"""

# Intestazione della versione utente (identica a quella del pacchetto qr-2fa)
new_header = """// ZoomZoom — schema del database (Prisma + PostgreSQL/Supabase).
// I valori enumerati sono validati a livello applicativo
// (src/lib/server/validation.ts) e i JSON sono serializzati.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
"""

if not text.startswith(old_header):
    raise SystemExit("ERRORE: intestazione inattesa nello schema, nessuna modifica fatta")

text = new_header + text[len(old_header):]
SCHEMA.write_text(text, encoding="utf-8")
print("Schema convertito in versione PostgreSQL:")
print("\n".join(text.splitlines()[:13]))
