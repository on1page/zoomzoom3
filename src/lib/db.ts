import { PrismaClient } from '@prisma/client'

// ZoomZoom — connessione al database.
// GUARDIA POOLER SUPABASE: quando l'URL punta al pooler in modalità
// transazione (porta 6543) Prisma deve disattivare i prepared statement
// (parametro pgbouncer=true). Senza questo parametro il pooler riaggancia
// le query a sessioni server diverse e ogni tanto risponde
// "42P05 prepared statement already exists": l'utente vede un generico
// "Errore interno" proprio nei flussi con più query consecutive
// (pubblicazione di una recensione, salvataggio di una nuova località).
// La guardia corregge l'URL a prescindere da dove arriva (file .env del
// progetto o variabile d'ambiente del deploy), così l'errore non si
// ripresenta nemmeno se la variabile configurata su Vercel resta vecchia.
function withPgbouncer(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (!/:6543\//.test(url) || /[?&]pgbouncer=/.test(url)) return undefined;
  return url + (url.includes('?') ? '&' : '?') + 'pgbouncer=true';
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const guardedUrl = withPgbouncer(process.env.DATABASE_URL);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // In sviluppo: log dettagliato. In produzione (Vercel): solo errori e warning.
    log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["query"],
    ...(guardedUrl ? { datasourceUrl: guardedUrl } : {}),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
