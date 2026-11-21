// ZoomZoom — prova del ramo "client vecchio" della diagnostica
// (/api/diagnostica e classifyZoneSaveError): genera un client da uno schema
// SENZA province/region/source e gli fa fare la STESSA lettura della route.
// Se il test stampa "campo mancante: province", il riconoscimento funziona.
import { PrismaClient, Prisma } from "../client-vecchio/index.js";

async function main() {
  const db = new PrismaClient({ log: [] });
  try {
    await db.zone.findFirst({ select: { id: true, province: true, region: true, source: true } });
    console.log("ESITO: lettura riuscita (inaspettato — il client doveva essere vecchio!)");
  } catch (e) {
    if (e instanceof Prisma.PrismaClientValidationError) {
      const m = /Unknown (?:argument|field) `([^`]+)`/.exec(e.message);
      console.log("ESITO: errore client vecchio RICONOSCIUTO");
      console.log("  campo mancante estratto dal messaggio:", m?.[1] ?? "(nessuno)");
      console.log("  messaggio Prisma (inizio):", e.message.slice(0, 160).replace(/\n/g, " "));
      console.log("  → la route /api/diagnostica risponderebbe: clientDatabase = VECCHIO, campo “" + (m?.[1] ?? "?") + "”");
    } else {
      console.log("ESITO: ALTRO ERRORE (inaspettato):", (e as Error).constructor?.name, String((e as Error).message).slice(0, 200));
    }
  } finally {
    await db.$disconnect();
  }
}

main();
