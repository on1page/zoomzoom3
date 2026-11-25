// ZoomZoom — prova della tolleranza server per le valutazioni mancanti:
//   1. recensione SENZA crit (slider mai toccati) → ora si PUBBLICA, con i
//      criteri assenti salvati a 5 (ciò che il cursore mostra a schermo);
//   2. recensione con un valore PROPRIO non valido (7.3, 12) → rifiutata
//      ("Valutazione non valida per: …"): la qualità dei dati resta garantita;
//   3. recensione con tutti i criteri → pubblicata con i valori inviati.
// Uso: bun scripts/test-crit-mancante.mjs
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const EMAIL = "crittest@zoomzoom.test";

const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

async function main() {
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
  const H = { "content-type": "application/json", cookie: `zz_session=${token}` };

  const rEnt = await j(await fetch(`${BASE}/api/entities`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      address: "Via di Prova Crit 12",
      zone: { name: "Milano", province: "Milano", region: "Lombardia", lat: 45.4642, lng: 9.19 },
    }),
  }));
  const entityId = rEnt.body?.entity?.id;
  console.log("1) creazione immobile:", rEnt.status, entityId ? "OK (id " + entityId + ")" : JSON.stringify(rEnt.body).slice(0, 200));

  // una scheda DIVERSA per ogni prova: l'utente può scrivere una sola
  // recensione per scheda (il 409 dei test precedenti era proprio quella
  // regola di buon senso, non un errore)
  const nuovaScheda = async (n) => {
    const r = await j(await fetch(`${BASE}/api/entities`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        address: `Via di Prova Crit ${n}`,
        zone: { name: "Milano", province: "Milano", region: "Lombardia", lat: 45.4642, lng: 9.19 },
      }),
    }));
    return r.body?.entity?.id;
  };
  const creaRecensione = async (entityId, extra) => j(await fetch(`${BASE}/api/reviews`, {
    method: "POST", headers: H,
    body: JSON.stringify({ ...base, entityId, ...extra }),
  }));

  const base = {
    entityId, experienceKind: "Abitazione in affitto", score: 7,
    priceAmount: "", priceUnit: "", priceKind: "Concluso/pagato",
    pros: "Casa in ordine\nSpazi ampi",
    cons: "Portone rumoroso",
    text: "Descrizione dell'esperienza abbastanza lunga per superare il limite dei cento caratteri richiesto dalla validazione del server, raccontando il soggiorno.",
    honesty: true, hp: "",
  };

  // 2. SENZA crit → ora deve pubblicarsi (criteri a 5 di default)
  const rNo = await creaRecensione(entityId, { crit: {} });
  console.log("2) senza crit (slider mai toccati):", rNo.status, rNo.body?.reviewId ? "PUBBLICATA (review " + rNo.body.reviewId + ")" : JSON.stringify(rNo.body).slice(0, 160));

  // verifica che i criteri assenti siano stati salvati a 5
  let salvati5 = false;
  if (rNo.body?.reviewId) {
    const rv = await db.review.findUnique({ where: { id: rNo.body.reviewId } });
    const crit = rv?.criteriaJson ? JSON.parse(rv.criteriaJson) : null;
    salvati5 = !!crit && crit.stato === 5 && crit.rapporto === 5;
    console.log("   criteri salvati nella recensione:", JSON.stringify(crit));
  }

  // 3. valore non valido → rifiutato
  const e3 = await nuovaScheda(13);
  const rBad = await creaRecensione(e3, { crit: { stato: 7.3, descrizione: 5, spazi: 5, rumori: 5, impianti: 5, rapporto: 5 } });
  console.log("3) crit con 7.3 (non valido):", rBad.status, "→", JSON.stringify(rBad.body?.error || rBad.body).slice(0, 120));

  const e4 = await nuovaScheda(14);
  const rBad2 = await creaRecensione(e4, { crit: { stato: 12, descrizione: 5, spazi: 5, rumori: 5, impianti: 5, rapporto: 5 } });
  console.log("4) crit con 12 (fuori scala):", rBad2.status, "→", JSON.stringify(rBad2.body?.error || rBad2.body).slice(0, 120));

  // 5. tutti i criteri validi → pubblicata con i valori inviati
  const e5 = await nuovaScheda(15);
  const rSi = await creaRecensione(e5, { crit: { stato: 8, descrizione: 7, spazi: 6, rumori: 5, impianti: 7.5, rapporto: 8 } });
  console.log("5) crit completi e validi:", rSi.status, rSi.body?.reviewId ? "PUBBLICATA (review " + rSi.body.reviewId + ")" : JSON.stringify(rSi.body).slice(0, 160));

  const pubblicataNo = !!rNo.body?.reviewId && salvati5;
  const rifiutati = rBad.status === 400 && rBad2.status === 400;
  const pubblicataSi = !!rSi.body?.reviewId;
  console.log("\nVERDETTO:");
  console.log("  recensione SENZA punteggi pubblicata (criteri a 5):", pubblicataNo ? "SÌ" : "NO");
  console.log("  valori non validi ancora rifiutati:", rifiutati ? "SÌ" : "NO");
  console.log("  recensione con punteggi completi pubblicata:", pubblicataSi ? "SÌ" : "NO");

  await db.review.deleteMany({ where: { entity: { proposedBy: `user:${u.id}` } } }).catch(() => {});
  await db.entity.deleteMany({ where: { proposedBy: `user:${u.id}` } }).catch(() => {});
  await db.user.delete({ where: { id: u.id } }).catch(() => {});
  await db.$disconnect();
  process.exit(pubblicataNo && rifiutati && pubblicataSi ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
