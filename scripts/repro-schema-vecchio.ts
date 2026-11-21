// Riproduzione della diagnosi "DB_CLIENT_VECCHIO": il client Prisma generato
// da un file prisma/schema.prisma VECCHIO (senza province/region/source nel
// model Zone) rifiuta le scritture della copertura nazionale con
// PrismaClientValidationError — lo STESSO errore che l'utente vede premendo
// "Aggiungi e Scrivi la Recensione". Un semplice "bun run db:push" NON lo
// risolve: rigenera il client dallo stesso file vecchio.
//
// Uso:
//   bun scripts/repro-schema-vecchio.ts
// (funziona sia col client aggiornato sia con quello vecchio: dice quale dei
// due sta girando e quale messaggio vedrebbe l'utente)
import { PrismaClient, Prisma } from "@prisma/client";
import { classifyZoneSaveError } from "../src/lib/server/zones";

const db = new PrismaClient({ log: ["error"] });

async function main() {
  console.log("Prova: lettura Zone con le colonne della copertura nazionale");
  console.log("(equivalente client-side della scrittura che fa ensureZone)\n");
  try {
    await db.zone.findFirst({ select: { id: true, province: true, region: true, source: true } });
    console.log("ESITO: CLIENT OK — il client conosce province/region/source.");
    console.log("       Con questo client il salvataggio della località FUNZIONA.");
  } catch (e) {
    if (e instanceof Prisma.PrismaClientValidationError) {
      const unknown = /Unknown (?:argument|field) `([^`]+)`/.exec(e.message);
      console.log("ESITO: PRISMA CLIENT VALIDATION ERROR — campo ignoto dal client:",
        unknown ? `"${unknown[1]}"` : "(non indicato)");
      console.log("       → è esattamente l'errore dell'utente (il db:push non lo risolve");
      console.log("         finché prisma/schema.prisma resta quello vecchio).\n");
      const issue = classifyZoneSaveError(e);
      console.log("Messaggio che vedrebbe l'utente (codice " + issue.code + "):");
      console.log("  " + issue.message);
    } else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2022") {
      console.log("ESITO: P2022 — client OK ma il DATABASE non ha le colonne (db:push lo risolve).");
    } else {
      console.log("ESITO: errore inatteso:", e);
    }
  } finally {
    await db.$disconnect();
  }
}

main();
