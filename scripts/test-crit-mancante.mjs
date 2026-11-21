// ZoomZoom — prova del bug "Valutazione mancante o non valida per: Stato di
// manutenzione": riproduce via API la sequenza reale (creazione immobile +
// recensione) con e senza i punteggi per criterio, per dimostrare che:
//   1. senza crit → il server risponde l'errore IDENTICO a quello visto
//      dall'utente (primo criterio non inviato = "Stato di manutenzione");
//   2. con tutti i criteri (come ora li invia il form corretto, slider mai
//      toccati = 5) → la recensione si pubblica.
// Uso: bun scripts/test-crit-mancante.mjs
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const EMAIL = "crittest@zoomzoom.test";

const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

async function main() {
  // utente verificato + sessione (come make-ui-test-user)
  const old = await db.user.findUnique({ where: { email: EMAIL } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const salt = randomBytes(16).toString("hex");
  const u = await db.user.create({
    data: {
      email: EMAIL, nickname: "crittest", role: "user", emailVerified: true,
      passwordHash: `scrypt$16384$8$1$${salt}$${scryptSync("test1234", salt, 64).toString("hex")}`,
    },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId: u.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 4 * 3600_000) },
  });
  const cookie = `zz_session=${token}`;
  const H = { "content-type": "application/json", cookie };

  // 1. crea l'immobile (come il tasto "Aggiungi e Scrivi la Recensione")
  const rEnt = await j(await fetch(`${BASE}/api/entities`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      address: "Via di Prova Crit 12",
      zone: { name: "Milano", province: "Milano", region: "Lombardia", lat: 45.4642, lng: 9.19 },
    }),
  }));
  console.log("1) creazione immobile:", rEnt.status, rEnt.body?.entity?.id ? "OK (id " + rEnt.body.entity.id + ")" : JSON.stringify(rEnt.body).slice(0, 200));
  const entityId = rEnt.body?.entity?.id;

  const base = {
    entityId, experienceKind: "Abitazione in affitto", score: 7,
    priceAmount: "", priceUnit: "", priceKind: "Concluso/pagato",
    pros: "Casa in ordine\nSpazi ampi",
    cons: "Portone rumoroso",
    text: "Descrizione dell'esperienza abbastanza lunga per superare il limite dei cento caratteri richiesto dalla validazione del server, raccontando il soggiorno.",
    honesty: true, hp: "",
  };

  // 2. recensione SENZA crit (slider mai toccati, form PRIMA del fix)
  const rNo = await j(await fetch(`${BASE}/api/reviews`, {
    method: "POST", headers: H,
    body: JSON.stringify({ ...base, crit: {} }),
  }));
  console.log("2) senza crit (form vecchio):", rNo.status, "→", JSON.stringify(rNo.body?.error || rNo.body).slice(0, 140));

  // 3. recensione CON tutti i criteri a 5 (form DOPO il fix: slider mai toccati = 5)
  const crit5 = { stato: 5, descrizione: 5, spazi: 5, rumori: 5, impianti: 5, rapporto: 5 };
  const rSi = await j(await fetch(`${BASE}/api/reviews`, {
    method: "POST", headers: H,
    body: JSON.stringify({ ...base, crit: crit5 }),
  }));
  console.log("3) con crit a 5 (form corretto):", rSi.status, rSi.body?.reviewId ? "PUBBLICATA (review " + rSi.body.reviewId + ")" : JSON.stringify(rSi.body).slice(0, 200));

  // esito
  const riprodotto = /Valutazione mancante o non valida per: Stato di manutenzione/.test(String(rNo.body?.error));
  const pubblicata = rSi.status === 200 || rSi.status === 201 || !!rSi.body?.reviewId;
  console.log("\nVERDETTO:");
  console.log("  bug riprodotto con crit assente:", riprodotto ? "SÌ (identico all'errore dell'utente)" : "no: " + JSON.stringify(rNo.body).slice(0, 120));
  console.log("  recensione pubblicata con crit completi:", pubblicata ? "SÌ" : "no");

  // pulizia: rimuovo l'utente di test (cascade su sessioni/recensioni) e l'entità
  await db.review.deleteMany({ where: { entityId } }).catch(() => {});
  await db.entity.deleteMany({ where: { id: entityId } }).catch(() => {});
  await db.user.delete({ where: { id: u.id } }).catch(() => {});
  await db.$disconnect();
  process.exit(riprodotto && pubblicata ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
