// Test end-to-end "Territorio nazionale": copertura completa di comuni, paesi
// e frazioni + reverse geocoding dall GPS. Verifica:
//  1. ricerca geocodificata con dettagli (comune/provincia/regione) per posto;
//  2. reverse geocoding: coordinate → via, civico, comune, provincia, regione;
//  3. creazione immobile in una località NUOVA (la zona nasce al volo);
//  4. dedup: stessa località scritta diversamente → stessa zona (nessun doppione);
//  5. attivazione scheda zona per un paese nuovo (POST /api/zones) + idempotenza;
//  6. riuso della zona già nota per nome vicino (es. "Milano");
//  7. recensione pubblicabile sulla scheda del paese nuovo;
//  8. bootstrap e mappa pubblica espongono le nuove zone;
//  9. robustezza: coordinate fuori Italia rifiutate.
// Uso: avviare il server (PORT=3100 bun .next/standalone/server.js) e poi
//      bun scripts/test-territorio-nazionale.ts
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();
const BASE = process.env.TEST_BASE || "http://localhost:3100";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

async function makeUser(email: string) {
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const u = await db.user.create({
    data: { email, nickname: email.split("@")[0], role: "user", emailVerified: true, passwordHash: hashPassword("x"), isDemo: true },
  });
  const token = "tok-" + email + "-" + randomBytes(8).toString("hex");
  await db.session.create({ data: { userId: u.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) } });
  return { id: u.id, token };
}

type R = Record<string, unknown> & { ok?: boolean; status?: number };
async function api(path: string, init: RequestInit = {}): Promise<R> {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  return { ...body, status: res.status, ok: body.ok ?? res.ok } as R;
}
const post = (token: string | null, path: string, body: unknown) => api(path, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Cookie: `zz_session=${token}`, Origin: BASE } : { Origin: BASE }) },
  body: JSON.stringify(body),
});
const get = (token: string | null, path: string) => api(path, { headers: token ? { Cookie: `zz_session=${token}` } : {} });

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? (cond ? " — " + extra : " — ATTESO: " + extra) : ""}`);
  if (!cond) failures++;
}

const REVIEW_BODY = "Recensione di prova del test territorio nazionale: testo sufficientemente lungo per superare la validazione minima di cento caratteri richiesti dal sistema prima della pubblicazione.";

// dati di paesi reali (coordinate verificate su OpenStreetMap)
const CORTE_DE_FRATI = { name: "Corte de' Frati", province: "Cremona", region: "Lombardia", lat: 45.2200, lng: 10.0967 };
const MARCIAGA = { name: "Marciaga", province: "Verona", region: "Veneto", lat: 45.5892, lng: 10.7012 };

async function main() {
  console.log("Test copertura territorio nazionale su", BASE, "\n");
  const U = await makeUser("test-territorio@esempio.test");

  /* 1) ricerca geocodificata con dettagli posto */
  let r = await get(null, "/api/public/geocode?q=" + encodeURIComponent("corte de frati"));
  const results = (r.results as Array<{ label: string; zoneName: string | null; province: string | null; region: string | null; lat: number }>) || [];
  const cdf = results.find(x => (x.zoneName || "").toLowerCase().includes("corte de"));
  check("geocode: paese trovato con comune/provincia/regione", !!cdf && cdf.province === "Cremona" && cdf.region === "Lombardia",
    `${results.length} risultati`);

  /* 2) reverse geocoding: coordinate → indirizzo reale */
  r = await get(null, `/api/public/geocode/reverse?lat=${CORTE_DE_FRATI.lat}&lng=${CORTE_DE_FRATI.lng}`);
  const addr = r.address as { road: string | null; zoneName: string | null; province: string | null; region: string | null } | null;
  check("reverse: indirizzo reale trovato", r.found === true && !!addr?.zoneName, addr ? `${addr.road || "?"} — ${addr.zoneName} (${addr.province})` : "");
  r = await get(null, "/api/public/geocode/reverse?lat=48.8584&lng=2.2945"); // Parigi
  check("reverse: fuori Italia → found=false", r.found === false);
  r = await get(null, "/api/public/geocode/reverse?lat=0&lng=0");
  check("reverse: coordinate assurde → found=false", r.found === false);

  /* 3) immobile in località NUOVA: la zona nasce al volo */
  const zonesBefore = await db.zone.count();
  r = await post(U.token, "/api/entities", {
    address: "Via del Test Paese 1",
    zone: { name: CORTE_DE_FRATI.name, province: CORTE_DE_FRATI.province, region: CORTE_DE_FRATI.region, lat: CORTE_DE_FRATI.lat, lng: CORTE_DE_FRATI.lng },
    geo: { lat: CORTE_DE_FRATI.lat, lng: CORTE_DE_FRATI.lng },
  });
  const ent1 = r.entity as { id: string } | undefined;
  check("immobile creato in località nuova", r.ok === true && !!ent1?.id);
  const zonesAfter1 = await db.zone.count();
  const zCdf = await db.zone.findFirst({ where: { name: { contains: "Corte de" } } });
  check("zona creata al volo con provincia/regione", zonesAfter1 === zonesBefore + 1 && zCdf?.province === "Cremona" && zCdf?.region === "Lombardia",
    zCdf ? `${zCdf.id} (${zCdf.source})` : "non trovata");
  check("immobile collegato alla zona nuova", !!ent1 && (await db.entity.findUnique({ where: { id: ent1.id } }))?.zoneId === zCdf?.id);

  /* 4) dedup: stessa località scritta diversamente → stessa zona */
  r = await post(U.token, "/api/entities", {
    address: "Via del Test Paese 2",
    zone: { name: "corte de frati", province: "Cremona", region: "Lombardia", lat: 45.221, lng: 10.097 },
  });
  const zonesAfter2 = await db.zone.count();
  check("dedup località: nessuna zona doppia", r.ok === true && zonesAfter2 === zonesAfter1, `${zonesAfter1} → ${zonesAfter2}`);

  /* 5) scheda zona per un PAESE nuovo + idempotenza */
  r = await post(U.token, "/api/zones", { name: MARCIAGA.name, province: MARCIAGA.province, region: MARCIAGA.region, lat: MARCIAGA.lat, lng: MARCIAGA.lng });
  const z1 = { entityId: r.entityId as string, created: r.created as boolean };
  check("paese nuovo: scheda zona attivata", r.ok === true && !!z1.entityId && z1.created === true, `${r.name} → ${r.entityId}`);
  check("convenzione id rispettata (ent_z_<slug>)", z1.entityId === "ent_z_marciaga", z1.entityId);
  r = await post(U.token, "/api/zones", { name: "Marciaga", province: "Verona", region: "Veneto", lat: 45.59, lng: 10.70 });
  check("idempotenza: stessa scheda, created=false", r.ok === true && r.entityId === z1.entityId && r.created === false);

  /* 6) riuso zona nota: "Milano" con coordinate del Duomo → zona seed */
  r = await post(U.token, "/api/zones", { name: "Milano", province: "Milano", region: "Lombardia", lat: 45.4642, lng: 9.19 });
  check("Milano: riuso della zona esistente (ent_z_milano)", r.ok === true && r.entityId === "ent_z_milano" && r.created === false, String(r.entityId));

  /* 7) recensione sulla scheda del paese nuovo */
  r = await post(U.token, "/api/reviews", {
    entityId: z1.entityId, experienceKind: "Residenza attuale (oltre 6 mesi)",
    score: 7, criteria: { servizi: 6, trasporti: 5, sicurezza: 7, verde: 8, costi: 7 },
    pros: "Paese tranquillo", text: REVIEW_BODY, honesty: true,
  });
  check("recensione pubblicata sul paese nuovo", r.ok === true && r.verified === false);

  /* 8) bootstrap + mappa espongono le nuove zone */
  r = await get(null, "/api/public/bootstrap");
  const bz = (r.zones as Array<{ id: string; name: string; lat?: number; province?: string | null }>) || [];
  const bzCdf = bz.find(z => z.id === zCdf?.id), bzMi = bz.find(z => z.id === "milano");
  check("bootstrap: zone nuove con coordinate e provincia", !!bzCdf?.lat && bzCdf?.province === "Cremona" && !!bzMi?.lat, `${bz.length} zone totali`);
  r = await get(null, "/api/public/map");
  const mz = (r.zones as Array<{ id: string; entityId: string | null }>) || [];
  check("mappa pubblica: scheda del paese presente", mz.some(z => z.id === "marciaga" && z.entityId === z1.entityId));

  /* 9) robustezza (secondo utente: budget giornaliero pulito) */
  const U2 = await makeUser("test-territorio-b@esempio.test");
  r = await post(U2.token, "/api/entities", {
    address: "Via Impossibile 99",
    zone: { name: "Bogotà", province: null, region: null, lat: 4.711, lng: -74.0721 },
  });
  check("località fuori Italia rifiutata", r.ok === false && r.status === 400, `status ${r.status}`);
  r = await post(U2.token, "/api/entities", { address: "Via Corta 1", zone: { name: "", lat: 45, lng: 9 } });
  check("zona senza nome rifiutata", r.ok === false && r.status === 400, `status ${r.status}`);
  r = await post(U2.token, "/api/zones", { name: "Bogotà", lat: 4.711, lng: -74.0721 });
  check("attivazione zona fuori Italia rifiutata", r.ok === false && r.status === 400, `status ${r.status}`);
  r = await post(null, "/api/zones", { name: "Anonimo", lat: 45, lng: 9 });
  check("attivazione zona richiede l'accesso", r.status === 401);
  await db.user.delete({ where: { id: U2.id } });

  /* pulizia: il catalogo demo resta pulito */
  await db.review.deleteMany({ where: { user: { email: "test-territorio@esempio.test" } } });
  await db.experience.deleteMany({ where: { user: { email: "test-territorio@esempio.test" } } });
  const ents = await db.entity.findMany({ where: { zoneId: { in: [zCdf?.id || "x", "marciaga"] } }, select: { id: true } });
  await db.entity.deleteMany({ where: { id: { in: ents.map(e => e.id) } } });
  await db.zone.deleteMany({ where: { id: { in: [zCdf?.id || "x", "marciaga"] } } });
  await db.user.delete({ where: { id: U.id } }); // a cascata: sessioni, recensioni superstiti
  console.log("\nPulizia dei dati di test completata.");

  console.log(`\n${failures === 0 ? "TUTTI I TEST SUPERATI" : failures + " TEST FALLITI"}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
