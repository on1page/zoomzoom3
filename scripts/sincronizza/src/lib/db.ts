import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // In sviluppo: log dettagliato. In produzione (Vercel): solo errori e warning.
    log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["query"],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db