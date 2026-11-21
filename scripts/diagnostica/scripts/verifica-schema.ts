// ZoomZoom — diagnostica completa dell'errore
// "Il software del sito non è aggiornato all'ultima versione (client del
// database generato da uno schema precedente)".
//
// Controlla, in un colpo solo, le SEI cose che possono essere disallineate
// quando si crea una località nuova (copertura nazionale):
//   1. il FILE prisma/schema.prisma del progetto;
//   2. il CLIENT Prisma generato in node_modules (quello che usa "bun run dev");
//   3. il CLIENT incorporato nella build di produzione .next/standalone
//      (quello che usa "bun run start" — bun run db:push NON lo tocca!);
//   4. le COLONNE della tabella Zone nel DATABASE (prova concreta a runtime);
//   5. IL SERVER CHE STA RISPONDENDO ADESSO sulla porta 3000: quale processo
//      è in ascolto, da quale cartella gira e — la prova decisiva — se il
//      client che ha IN MEMORIA è aggiornato (chiama /api/diagnostica);
//   6. gli ULTIMI ERRORI registrati nei log del server (dev.log / server.log).
//
// Uso, dalla cartella del progetto:
//       bun scripts/verifica-schema.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const CAMPI: readonly string[] = ["province", "region", "source"];

// il model Zone di un testo schema contiene i campi della copertura nazionale?
function zoneHaCampi(testo: string): boolean {
  const inizio = testo.indexOf("model Zone");
  if (inizio < 0) return false;
  const dopo = testo.indexOf("model ", inizio + 10);
  const zona = dopo > 0 ? testo.slice(inizio, dopo) : testo.slice(inizio);
  return CAMPI.every(c => new RegExp(`^\\s*${c}\\s+[A-Z]`, "m").test(zona));
}

type Stato = "OK" | "VECCHIO" | "ASSENTE" | "ERRORE";

function riga(etichetta: string, stato: Stato, dettaglio: string) {
  const simbolo: Record<Stato, string> = {
    OK: "[ OK ]",
    VECCHIO: "[VECCHIO]",
    ASSENTE: "[MANCA]",
    ERRORE: "[ERRORE]",
  };
  console.log(`  ${simbolo[stato]}  ${etichetta} — ${dettaglio}`);
}

function esegui(cmd: string[]): string {
  try {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return new TextDecoder().decode(r.stdout).trim();
  } catch {
    return "";
  }
}

const problemi: string[] = [];

async function main() {
  console.log("ZoomZoom — verifica schema / client / database / server vivo");
  console.log("(diagnostica dell'errore \"Il software del sito non è aggiornato…\")\n");

  /* ---------- 1. FILE prisma/schema.prisma ---------- */
  console.log("1. FILE DI CONFIGURAZIONE DEL DATABASE");
  let fileOk = false;
  try {
    const s = readFileSync("prisma/schema.prisma", "utf8");
    fileOk = zoneHaCampi(s);
    riga("prisma/schema.prisma", fileOk ? "OK" : "VECCHIO",
      fileOk
        ? "il model Zone contiene province/region/source (copertura nazionale)"
        : "al model Zone MANCANO province/region/source: è la causa dell'errore. Sostituiscilo con quello del pacchetto aggiornato");
    if (!fileOk) {
      problemi.push("sostituisci prisma/schema.prisma con quello del pacchetto aggiornato (NON basta rieseguire db:push col file vecchio)");
    }
  } catch (e) {
    riga("prisma/schema.prisma", "ASSENTE",
      `non leggibile (${(e as Error).message}): esegui lo script dalla cartella del progetto`);
    problemi.push("esegui lo script dalla cartella del progetto (quella che contiene prisma/schema.prisma)");
  }

  /* ---------- 2. CLIENT del progetto (node_modules) ---------- */
  console.log("\n2. CLIENT PRIMA (quello che usa \"bun run dev\")");
  try {
    const s = readFileSync("node_modules/.prisma/client/schema.prisma", "utf8");
    const ok = zoneHaCampi(s);
    riga("node_modules/.prisma/client", ok ? "OK" : "VECCHIO",
      ok
        ? "generato dallo schema aggiornato"
        : "generato da uno schema VECCHIO: \"bun run db:push\" lo rigenera (una volta messo il prisma/schema.prisma nuovo)");
    if (!ok) problemi.push("rigenera il client: bun run db:push (dopo aver sostituito prisma/schema.prisma)");
  } catch {
    riga("node_modules/.prisma/client", "ASSENTE",
      "client mai generato: rimedio «bun install» e poi «bunx prisma generate»");
    problemi.push("genera il client: bun install && bunx prisma generate");
  }

  /* ---------- 3. CLIENT della build di produzione (.next/standalone) ---------- */
  console.log("\n3. BUILD DI PRODUZIONE (quella che usa \"bun run start\")");
  const standalone = ".next/standalone/node_modules/.prisma/client/schema.prisma";
  if (existsSync(standalone)) {
    const s = readFileSync(standalone, "utf8");
    const ok = zoneHaCampi(s);
    riga(".next/standalone", ok ? "OK" : "VECCHIO",
      ok
        ? "la build contiene il client aggiornato"
        : "la build contiene un client VECCHIO: «bun run db:push» NON lo tocca. Rimedio: «bun run build» (e poi riavvia)");
    if (!ok) problemi.push("rifai la build di produzione: bun run build (il client è incorporato nella build, db:push non basta)");
  } else {
    console.log("  [  ---  ]  nessuna build di produzione locale trovata (.next/standalone): controllo saltato");
  }

  /* ---------- 4. DATABASE: prova concreta a runtime ---------- */
  console.log("\n4. DATABASE (prova reale: lettura Zone con le colonne nuove)");
  try {
    const mod = await import("@prisma/client");
    const db = new mod.PrismaClient({ log: [] });
    try {
      await db.zone.findFirst({ select: { id: true, province: true, region: true, source: true } });
      riga("tabella Zone", "OK", "connessione riuscita e colonne province/region/source presenti");
    } catch (e) {
      if (e instanceof mod.Prisma.PrismaClientValidationError) {
        const m = /Unknown (?:argument|field) `([^`]+)`/.exec((e as Error).message);
        riga("client in uso", "VECCHIO",
          `non conosce il campo “${m?.[1] ?? "?"}” — è ESATTAMENTE l'errore visto dal sito`);
        if (!problemi.some(p => p.includes("bun run db:push"))) {
          problemi.push("il client che gira è vecchio: sostituisci prisma/schema.prisma, poi bun run db:push, poi riavvia (e bun run build se usi la modalità produzione)");
        }
      } else if (e instanceof mod.Prisma.PrismaClientKnownRequestError && e.code === "P2022") {
        riga("tabella Zone", "ASSENTE",
          "le colonne province/region/source mancano nel database: «bun run db:push» le aggiunge");
        problemi.push("aggiorna il database: bun run db:push (dal progetto aggiornato)");
      } else if (e instanceof mod.Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
        riga("tabella Zone", "ASSENTE",
          "la tabella Zone non esiste (database mai inizializzato): «bun run db:push» la crea");
        problemi.push("inizializza il database: bun run db:push");
      } else if (e instanceof mod.Prisma.PrismaClientKnownRequestError && e.code.startsWith("P1")) {
        riga("connessione", "ERRORE",
          `${e.code}: il database non risponde (controlla DATABASE_URL nel file .env)`);
        problemi.push("controlla la connessione al database (DATABASE_URL / DIRECT_URL nel file .env)");
      } else {
        riga("lettura Zone", "ERRORE", (e as Error).message);
      }
    } finally {
      await db.$disconnect();
    }
  } catch (e) {
    riga("client Prisma", "ERRORE", `impossibile avviarlo: ${(e as Error).message}`);
    problemi.push("client Prisma non avviabile: bun install && bunx prisma generate");
  }

  /* ---------- 5. IL SERVER CHE STA RISPONDENDO ADESSO (prova dal vivo) ---------- */
  // Le prove 1–4 certificano i FILE e il DATABASE di QUESTA cartella. Ma
  // l'errore lo produce il PROCESSO che risponde al click: se è rimasto
  // indietro (o gira da un'altra cartella, o è il sito pubblico), qui si
  // vede subito.
  console.log("\n5. IL SERVER CHE STA RISPONDENDO ADESSO (prova dal vivo, porta 3000)");
  const win = process.platform === "win32";

  // chi è in ascolto sulla porta 3000?
  const netstat = win
    ? esegui(["cmd.exe", "/c", "netstat -ano | findstr :3000"])
    : esegui(["sh", "-c", "lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null || ss -tln 2>/dev/null | grep :3000 || true"]);
  const righeAscolto = netstat ? netstat.split(/\r?\n/).filter(l => /:3000/.test(l) && /LISTEN/i.test(l)).slice(0, 4) : [];
  if (righeAscolto.length) {
    for (const l of righeAscolto) console.log(`  [INFO ]  in ascolto: ${l.trim().replace(/\s+/g, " ").slice(0, 150)}`);
    if (win) {
      // su Windows: nome del processo per ogni PID in ascolto
      const pids = [...new Set(righeAscolto.map(l => l.trim().split(/\s+/).pop() ?? "").filter(p => /^\d+$/.test(p)))].slice(0, 3);
      for (const pid of pids) {
        const t = esegui(["cmd.exe", "/c", `tasklist /FI "PID eq ${pid}" /FO CSV /NH`]);
        if (t && !/INFO:/.test(t)) console.log(`  [INFO ]  processo PID ${pid}: ${t.split(/\r?\n/)[0].slice(0, 120)}`);
      }
    }
  } else {
    console.log("  [  ---  ]  nessun processo locale in ascolto sulla porta 3000");
  }

  // il server risponde? e soprattutto: che client ha IN MEMORIA?
  // (serve la route /api/diagnostica del pacchetto aggiornato)
  let vivo: {
    ambiente?: string; cartellaDelServer?: string;
    clientDatabase?: string; tabellaZone?: string; verdetto?: string;
  } | null = null;
  try {
    const r = await fetch("http://localhost:3000/api/diagnostica", { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      vivo = await r.json();
      const clientVecchio = String(vivo?.clientDatabase ?? "").includes("VECCHIO");
      riga("http://localhost:3000/api/diagnostica", clientVecchio ? "VECCHIO" : "OK",
        clientVecchio
          ? "il server locale ATTIVO ha un client VECCHIO in memoria (processo rimasto indietro)"
          : "il server locale ATTIVO ha client e database aggiornati");
      console.log(`  [INFO ]  ambiente: ${vivo?.ambiente ?? "?"} · cartella del server: ${vivo?.cartellaDelServer ?? "?"}`);
      console.log(`  [INFO ]  tabella Zone vista dal server: ${vivo?.tabellaZone ?? "?"}`);
      if (vivo?.verdetto) console.log(`  [INFO ]  verdetto del server: ${String(vivo.verdetto).slice(0, 200)}`);
      // gira dalla cartella giusta?
      if (vivo?.cartellaDelServer) {
        try {
          if (resolvePath(vivo.cartellaDelServer) !== resolvePath(process.cwd())) {
            console.log("  [ATTENZIONE]  il server attivo gira da una cartella DIVERSA da questa!");
            problemi.push(`il server attivo gira da “${vivo.cartellaDelServer}” e non da questa cartella: spegnilo e riavvia “bun run dev” dalla cartella del progetto aggiornata`);
          }
        } catch { /* confronto sole informativo */ }
      }
      if (clientVecchio) {
        problemi.push("il processo del server locale ha un client VECCHIO: chiudi TUTTI i terminali del server (Ctrl+C), eventualmente riavvia il computer, elimina la cartella .next, poi «bun run db:push» e «bun run dev»");
      }
    } else {
      riga("server locale", "ERRORE",
        `risponde sulla porta 3000 ma /api/diagnostica dà errore ${r.status}: copia nel progetto anche src/app/api/diagnostica/route.ts (pacchetto aggiornato) e riesegui questa verifica`);
    }
  } catch {
    console.log("  [  ---  ]  nessun server attivo su http://localhost:3000");
    console.log("             Se l'errore lo vedi lo stesso, lo stai guardando su un ALTRO");
    console.log("             server (il SITO PUBBLICO o un'altra copia del progetto):");
    console.log("             apri nel browser  https://TUO-SITO/api/diagnostica  per");
    console.log("             la stessa diagnosi, fatta là dove il sito risponde davvero.");
  }

  /* ---------- 6. ULTIMI ERRORI NEI LOG DEL SERVER ---------- */
  console.log("\n6. LOG DEL SERVER (ultimi errori di salvataggio località)");
  for (const f of ["dev.log", "server.log"]) {
    try {
      const s = readFileSync(f, "utf8");
      const stat = statSync(f);
      console.log(`  [INFO ]  ${f} (ultimo aggiornamento: ${stat.mtime.toLocaleString("it-IT")})`);
      const trovate = s.split(/\r?\n/)
        .filter(l => /\[entities\] errore interno|Unknown (argument|field)|P2022|DB_CLIENT_VECCHIO/.test(l))
        .slice(-3);
      if (!trovate.length) {
        console.log("             nessun errore di salvataggio località registrato");
      } else {
        for (const l of trovate) console.log(`             ${l.trim().slice(0, 220)}`);
      }
    } catch {
      console.log(`  [  ---  ]  ${f} assente (server avviato senza log su file: normale)`);
    }
  }

  /* ---------- verdetto ---------- */
  console.log("\n---------- VERDETTO ----------");
  if (!problemi.length) {
    const serverVivoOk = vivo && !String(vivo.clientDatabase ?? "").includes("VECCHIO");
    if (serverVivoOk) {
      console.log("Tutto allineato: file, client, database E il server locale attivo.");
      console.log("Se il messaggio compare comunque, lo stai vedendo su un ALTRO server:");
      console.log("quasi certamente il SITO PUBBLICO. Conferma subito: apri nel browser");
      console.log("    https://TUO-SITO/api/diagnostica");
      console.log("Se là il client risulta VECCHIO, il rimedio è PUBBLICARE il file");
      console.log("prisma/schema.prisma (git add + commit + push, poi attendi il redeploy):");
      console.log("il “bun run db:push” dal tuo computer aggiorna il DATABASE, ma il client");
      console.log("dentro il sito pubblico nasce dalla BUILD, dai file pubblicati.");
    } else {
      console.log("Tutto allineato: file, client e database sono a posto.");
      console.log("Se il messaggio compare ancora, il server che risponde NON è questa cartella");
      console.log("(vecchio processo ancora attivo? altra copia del progetto? sito pubblico");
      console.log("con il file non ancora pubblicato? in quel caso: git add prisma/schema.prisma,");
      console.log("commit, push e attendere il redeploy di Vercel).");
    }
  } else {
    console.log("Da fare, nell'ordine:");
    problemi.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log("\nAlla fine riavvia: «bun run dev» — oppure «bun run build» e poi «bun run start».");
    console.log("Se l'errore compare sul SITO PUBBLICO, pubblica anche prisma/schema.prisma");
    console.log("(git add + commit + push): su Vercel il client nasce dalla build.");
  }
}

main();
