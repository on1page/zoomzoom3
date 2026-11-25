// ZoomZoom — diagnostica dal vivo: GET /api/diagnostica
//
// Risponde il SERVER che riceve la richiesta (non i file su disco): dice se
// il client del database in uso in QUESTO processo conosce i campi della
// copertura nazionale (province/region/source), se la tabella Zone del
// database collegato ha le colonne, e da quale cartella il server gira.
// È lo strumento che distingue in un colpo solo i casi dell'errore
// "Il software del sito non è aggiornato…":
//   A) processo locale rimasto indietro (client vecchio in memoria);
//   B) server avviato da una copia diversa del progetto (confronta
//      "cartellaDelServer" con la cartella del progetto aggiornata);
//   C) sito pubblico (Vercel o build) costruito da un prisma/schema.prisma
//      precedente: là il client nasce dalla BUILD, e "bun run db:push"
//      eseguito dal proprio computer non può aggiornarlo.
// Sola lettura: nessun dato dell'utente, nessun segreto (né URL del
// database). Si può togliere in qualsiasi momento senza effetti.
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// il prisma/schema.prisma della cartella da cui gira il server contiene i
// campi? (nella build di produzione il file può non esserci: è normale)
function statoSchemaInCartella(): string {
  try {
    const s = readFileSync("prisma/schema.prisma", "utf8");
    const inizio = s.indexOf("model Zone");
    if (inizio < 0) return "non leggibile";
    const dopo = s.indexOf("model ", inizio + 10);
    const zona = dopo > 0 ? s.slice(inizio, dopo) : s.slice(inizio);
    const ok = ["province", "region", "source"].every(
      (c) => new RegExp(`^\\s*${c}\\s+[A-Z]`, "m").test(zona),
    );
    return ok
      ? "aggiornato (Zone con province/region/source)"
      : "VECCHIO (model Zone senza province/region/source): sostituirlo con quello del pacchetto aggiornato, poi bun run db:push e riavvio";
  } catch {
    return "non leggibile dalla cartella del server (normale nella build di produzione)";
  }
}

export async function GET() {
  const esito: Record<string, unknown> = {
    quando: new Date().toISOString(),
    ambiente: process.env.NODE_ENV ?? "sconosciuto",
    cartellaDelServer: process.cwd(),
    schemaPrismaNellaCartella: statoSchemaInCartella(),
    clientDatabase: "non verificato",
    tabellaZone: "non verificata",
  };

  // LA PROVA CHIAVE: la stessa lettura che fa il salvataggio della località.
  // Se il client è vecchio si ferma QUI, prima ancora di toccare il database
  // — esattamente come al click su "Aggiungi e Scrivi la Recensione".
  let verdetto = "";
  try {
    await db.zone.findFirst({
      select: { id: true, province: true, region: true, source: true },
    });
    esito.clientDatabase = "aggiornato (conosce province/region/source)";
    esito.tabellaZone = "aggiornata (lettura riuscita)";
    verdetto =
      "Questo server è a posto: client e database conoscono le nuove località. " +
      "Se l'errore compare comunque QUI, fai avere all'amministratore la riga " +
      "“[entities] errore interno in ensureZone” dal terminale del server.";
  } catch (e) {
    if (e instanceof Prisma.PrismaClientValidationError) {
      const m = /Unknown (?:argument|field) `([^`]+)`/.exec(e.message);
      esito.clientDatabase =
        `VECCHIO: non conosce il campo “${m?.[1] ?? "?"}” — è ESATTAMENTE la causa dell'errore “Il software del sito non è aggiornato…”`;
      esito.tabellaZone = "non verificabile (il client si ferma prima del database)";
      verdetto =
        process.env.NODE_ENV === "production"
          ? "QUESTO server (in produzione) ha in pancia un client VECCHIO. Se è il sito pubblico: il client nasce dalla build, quindi bisogna PUBBLICARE anche prisma/schema.prisma (git add + commit + push) e attendere il redeploy; il “bun run db:push” dal computer di casa aggiorna il database, non questo client. Se invece è una build locale: rifare “bun run build” e riavviare con “bun run start”."
          : "QUESTO server (sviluppo) ha in pancia un client VECCHIO. Spegni TUTTI i processi del server (Ctrl+C su ogni terminale, o riavvia il computer se serve), elimina la cartella .next, poi “bun run db:push” e “bun run dev”. Se l'errore persiste, il server non gira dalla cartella giusta: confronta “cartellaDelServer” con la cartella del progetto aggiornata.";
    } else if (e instanceof Prisma.PrismaClientKnownRequestError) {
      esito.clientDatabase = "aggiornato (conosce i campi)";
      if (e.code === "P2022") {
        esito.tabellaZone = "VECCHIA: mancano le colonne province/region/source";
        verdetto =
          "Il database collegato a QUESTO server non ha le colonne nuove: eseguire “bun run db:push” dalla cartella del progetto aggiornata (e, per il sito pubblico, puntare alle variabili del database di produzione).";
      } else if (e.code === "P2021") {
        esito.tabellaZone = "inesistente (tabella Zone assente)";
        verdetto = "Il database collegato non ha la tabella Zone: “bun run db:push” la crea.";
      } else if (e.code.startsWith("P1")) {
        esito.tabellaZone = `irraggiungibile (${e.code})`;
        verdetto =
          "Il database non risponde: controllare DATABASE_URL nell'ambiente di QUESTO server (può essere diverso da quello del computer di casa).";
      } else {
        esito.tabellaZone = `errore ${e.code}`;
        verdetto =
          `Errore Prisma ${e.code}: fai avere all'amministratore questa risposta insieme alla riga “[entities] errore interno in ensureZone” dal terminale del server.`;
      }
    } else {
      esito.tabellaZone = "errore inatteso";
      esito.dettaglioErrore = String((e as Error)?.message ?? e).slice(0, 300);
      verdetto = "Errore non previsto: fai avere all'amministratore questa risposta intera.";
    }
  }

  esito.verdetto = verdetto;
  return NextResponse.json(esito, { headers: { "cache-control": "no-store" } });
}
