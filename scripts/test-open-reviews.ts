// Test end-to-end "Recensioni aperte": copre il flusso completo del nuovo
// contributo aperto con foto e voti, più le regressioni della via invito.
// Uso: avviare il server (bun .next/standalone/server.js, PORT=3100) e poi
//      bun scripts/test-open-reviews.ts
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync, createHmac, createDecipheriv } from "crypto";
import sharp from "sharp";

const db = new PrismaClient();
const BASE = process.env.TEST_BASE || "http://localhost:3100";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0; const out: number[] = [];
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}
function totpCode(secretB32: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const off = mac[19] & 0x0f;
  const code = (((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) >>> 0;
  return String(code % 1_000_000).padStart(6, "0");
}
function decryptSecret(payload: string): string {
  const APP_SECRET = process.env.APP_SECRET || "";
  const [ivH, tagH, dataH] = payload.split(".");
  const key = createHash("sha256").update(APP_SECRET).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivH, "hex"));
  decipher.setAuthTag(Buffer.from(tagH, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataH, "hex")), decipher.final()]).toString("utf8");
}

async function makeUser(email: string, opts: { premiumDays?: number } = {}) {
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const u = await db.user.create({
    data: { email, nickname: email.split("@")[0], role: "user", emailVerified: true, passwordHash: hashPassword("x"), isDemo: true },
  });
  if (opts.premiumDays) {
    const expiresAt = new Date(Date.now() + opts.premiumDays * 86400000);
    await db.premiumGrant.create({ data: { userId: u.id, days: opts.premiumDays, origin: "admin", expiresAt } });
    await db.user.update({ where: { id: u.id }, data: { premiumUntil: expiresAt } });
  }
  const token = "tok-" + email + "-" + randomBytes(8).toString("hex");
  await db.session.create({ data: { userId: u.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) } });
  return { id: u.id, token };
}

function api(path: string, init: RequestInit = {}): Promise<Record<string, unknown> & { ok?: boolean; status?: number }> {
  return fetch(BASE + path, init).then(async r => {
    const body = await r.json().catch(() => ({}));
    return { ...body, status: r.status, ok: body.ok ?? r.ok } as Record<string, unknown> & { ok?: boolean; status?: number };
  });
}
const post = (token: string | null, path: string, body: unknown) => api(path, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Cookie: `zz_session=${token}`, Origin: BASE } : { Origin: BASE }) },
  body: JSON.stringify(body),
});
const get = (token: string | null, path: string) => api(path, { headers: token ? { Cookie: `zz_session=${token}` } : {} });

// mini JPEG di test (gradiente 320x240: abbastanza ricco da superare i controlli) → dataURL
async function testPhoto(rgb: [number, number, number]): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${rgb.join(",")})"/><stop offset="1" stop-color="rgb(${Math.max(0, rgb[0] - 80)},${Math.max(0, rgb[1] - 60)},${Math.max(0, rgb[2] - 40)})"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="160" cy="120" r="60" fill="rgba(255,255,255,0.35)"/></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  return "data:image/jpeg;base64," + buf.toString("base64");
}

const REVIEW_BODY = "Recensione di prova scritta dal test automatico per verificare il contributo aperto: esperienza dichiarata, testo sufficientemente lungo per superare la validazione minima di cento caratteri.";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra && !cond ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function main() {
  console.log("Test contributo aperto su", BASE, "\n");

  /* setup utenti */
  const A = await makeUser("test-aperto-a@esempio.test");                 // parte senza premium
  const B = await makeUser("test-aperto-b@esempio.test", { premiumDays: 30 }); // premium
  const C = await makeUser("test-aperto-c@esempio.test");                 // mai premium, contribuirà con foto

  /* 1) creazione immobile */
  let r = await post(A.token, "/api/entities", { address: "Via dei Test Automatici 42", zoneId: "milano", geo: { lat: 45.4612, lng: 9.1520 } });
  check("creazione immobile (contributo aperto)", r.ok === true && !!(r.entity as { id?: string })?.id);
  const entId = (r.entity as { id: string }).id;

  /* 2) dedup indirizzo */
  r = await post(A.token, "/api/entities", { address: "via dei test automatici 42", zoneId: "milano" });
  check("dedup: stesso indirizzo → 409 con existingId", r.status === 409 && typeof r.existingId === "string" && r.existingId === entId);

  /* 3) recensione aperta con foto (utente A, no premium) */
  const photo1 = await testPhoto([51, 101, 138]);
  r = await post(A.token, "/api/reviews", {
    entityId: entId, experienceKind: "Abitazione in affitto",
    score: 7, criteria: { stato: 7, descrizione: 7, spazi: 8, rumori: 6, impianti: 7, rapporto: 7 },
    pros: "Ambiente luminoso", cons: "Portone difficile", text: REVIEW_BODY,
    honesty: true, photos: [photo1],
  });
  check("recensione aperta pubblicata (badge dichiarata)", r.ok === true && r.verified === false);
  check("foto allegata e ricompilata", (r.photos as { added: number })?.added === 1);
  check("premium assegnato per il contributo", (r.premium as { grantedDays: number })?.grantedDays === 30);
  const revA = r.reviewId as string;

  /* 4) seconda recensione sulla stessa scheda → blocco */
  r = await post(A.token, "/api/reviews", {
    entityId: entId, experienceKind: "Visita e sopralluogo",
    score: 5, criteria: { stato: 5, descrizione: 5, spazi: 5, rumori: 5, impianti: 5, rapporto: 5 },
    pros: "x", text: REVIEW_BODY, honesty: true,
  });
  check("una sola recensione per scheda (via dichiarativa)", r.status === 409);

  /* 5) persona fisica → blocco */
  r = await post(A.token, "/api/reviews", {
    entityId: "ent_p_gm", experienceKind: "Contratto di affitto in corso",
    score: 5, criteria: { contratto: 5, risposta: 5, manutenzione: 5, deposito: 5, privacy: 5, rapporto: 5 },
    pros: "x", text: REVIEW_BODY, honesty: true,
  });
  check("persone fisiche fuori dal contributo aperto", r.status === 403);

  /* 6) scheda pubblica anonima: teaser offuscato + foto bloccate */
  r = await get(null, `/api/public/entity/${entId}`);
  const teasers = (r.teasers as Array<{ text: string; teaser: boolean; photos: Array<{ id: string }>; pros: string[]; votes: { up: number; down: number } }>) || [];
  check("anonimo: teaser presente e marcato", teasers.length === 1 && teasers[0].teaser === true);
  check("anonimo: testo offuscato (contiene maschera •)", teasers[0]?.text?.includes("•") === true);
  check("anonimo: pro/contro omessi nel teaser", teasers[0]?.pros?.length === 0);
  check("anonimo: foto elencate ma bloccate", teasers[0]?.photos?.length === 1 && (r.photos as { canView: boolean }).canView === false);
  const photoId = (teasers[0].photos as Array<{ id: string }>)[0].id;

  /* 7) endpoint foto: gating per utente */
  let img = await fetch(`${BASE}/api/public/photo/${photoId}`);
  check("foto: anonimo → 403", img.status === 403);
  img = await fetch(`${BASE}/api/public/photo/${photoId}`, { headers: { Cookie: `zz_session=${C.token}` } });
  check("foto: utente senza premium e senza contributi → 403", img.status === 403);
  img = await fetch(`${BASE}/api/public/photo/${photoId}`, { headers: { Cookie: `zz_session=${A.token}` } });
  check("foto: premium (A, ora attivo) → 200 image/jpeg", img.status === 200 && (img.headers.get("content-type") || "").includes("image/jpeg"));
  const bytes = Buffer.from(await img.arrayBuffer());
  check("foto: ricompilata server-side (JPEG valido)", bytes.length > 1000 && bytes[0] === 0xff && bytes[1] === 0xd8);

  /* 8) bootstrap: flag foto di A */
  r = await get(A.token, "/api/public/bootstrap");
  check("bootstrap: A ora premium + foto sbloccate", (r.user as { premium: { active: boolean } })?.premium?.active === true && (r.user as { photoAccess: boolean })?.photoAccess === true);

  /* 9) recensione aperta di C con foto → C ottiene il premium dal contributo;
     lo si revoca come farebbe la moderazione per simulare la scadenza: resta
     solo lo sblocco FOTO da contribuzione (duraturo, indipendente dal premium) */
  const photo2 = await testPhoto([166, 91, 63]);
  r = await post(C.token, "/api/reviews", {
    entityId: entId, experienceKind: "Visita e sopralluogo",
    score: 6, criteria: { stato: 6, descrizione: 6, spazi: 6, rumori: 6, impianti: 6, rapporto: 6 },
    pros: "Sopralluogo tranquillo", text: REVIEW_BODY, honesty: true, photos: [photo2],
  });
  const revC = r.reviewId as string;
  check("C pubblica recensione aperta con foto", r.ok === true);
  // revoca dei grant di C (come da moderazione/scadenza): photoAccess resta
  await db.premiumGrant.updateMany({ where: { userId: C.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "revoca di test" } });
  await db.user.update({ where: { id: C.id }, data: { premiumUntil: null } });
  r = await get(C.token, "/api/public/bootstrap");
  check("C: premium scaduto/revocato", (r.user as { premium: { active: boolean } })?.premium?.active === false);
  r = await get(C.token, `/api/public/entity/${entId}`);
  check("C: foto sbloccate via contributo", (r.photos as { canView: boolean; viaContribution: boolean }).canView === true && (r.photos as { viaContribution: boolean }).viaContribution === true);
  const cTeasers = (r.teasers as unknown[]) || [];
  check("C: testi integrali ancora riservati (teaser presenti)", cTeasers.length === 1);
  const cReviews = (r.reviews as Array<{ id: string; text: string }>) || [];
  check("C: la propria recensione è integrale", cReviews.some(x => x.id === revC && x.text === REVIEW_BODY));

  /* 10) voti */
  r = await post(C.token, `/api/reviews/${revA}/vote`, { value: 1 });
  check("voto: C senza premium → 403", r.status === 403);
  r = await post(B.token, `/api/reviews/${revA}/vote`, { value: 1 });
  check("voto: B premium → ok", r.ok === true && r.up === 1 && r.mine === 1);
  r = await post(B.token, `/api/reviews/${revA}/vote`, { value: -1 });
  check("voto: cambio in giù (toggle)", r.ok === true && (r as { down: number }).down === 1 && (r as { mine: number }).mine === -1);
  r = await post(B.token, `/api/reviews/${revC}/vote`, { value: 1 });
  check("voto: B vota la recensione di C", r.ok === true);
  // il voto non può andare sulla propria
  r = await post(A.token, `/api/reviews/${revA}/vote`, { value: 1 });
  check("voto: mai sulla propria recensione", r.status === 403);

  /* 11) riepilogo voti nella scheda (conteggi pubblici, per recensione) */
  r = await get(null, `/api/public/entity/${entId}`);
  const allTeasers = (r.teasers as Array<{ id: string; votes: { up: number; down: number } }>) || [];
  const tA = allTeasers.find(x => x.id === revA);
  const tC = allTeasers.find(x => x.id === revC);
  check("conteggi voti pubblici nella scheda", tA?.votes?.down === 1 && tA?.votes?.up === 0 && tC?.votes?.up === 1);

  /* 12) recensione di zona (aperta) */
  const mapRes = await get(null, "/api/public/map");
  const milanoEnt = ((mapRes.zones as Array<{ id: string; entityId: string | null }>).find(z => z.id === "milano") || {}).entityId;
  r = await post(A.token, "/api/reviews", {
    entityId: milanoEnt, experienceKind: "Residenza attuale (oltre 6 mesi)",
    score: 7, criteria: { servizi: 7, trasporti: 7, sicurezza: 6, verde: 7, costi: 6 },
    pros: "Servizi completi", text: REVIEW_BODY, honesty: true,
  });
  check("recensione aperta su zona", r.ok === true && r.verified === false);

  /* 13) geocoding (dipende dalla rete: informativo) */
  r = await get(null, "/api/public/geocode?q=corso%20buenos%20aires%20milano");
  console.log(`INFO  geocode: ${(r.results as unknown[])?.length ?? 0} risultati (dipende dalla rete verso Nominatim)`);

  /* 14) back office: sezione foto + rimozione con sessione admin (TOTP demo) */
  const adminUser = await db.user.findUnique({ where: { email: "admin@esempio.test" } });
  if (adminUser?.totpSecretEnc) {
    const code = totpCode(decryptSecret(adminUser.totpSecretEnc));
    const login = await fetch(BASE + "/api/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ email: "admin@esempio.test", password: "ZoomZoom-Demo-2026", code }),
    });
    const setCookie = login.headers.getSetCookie?.().find(c => c.startsWith("zz_admin_session="));
    const adminCookie = setCookie ? setCookie.split(";")[0] : null;
    check("admin: login con TOTP", login.ok && !!adminCookie);
    if (adminCookie) {
      const hdr = { Cookie: adminCookie };
      const fotos = await fetch(BASE + "/api/admin/data/foto", { headers: hdr }).then(x => x.json());
      check("admin: sezione foto con foto demo + test", Array.isArray(fotos.photos) && fotos.photos.length >= 9);
      const rem = await fetch(BASE + "/api/admin/action", {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie, Origin: BASE },
        body: JSON.stringify({ action: "photo.remove", id: photoId, reason: "Rimozione di prova dal test automatico." }),
      }).then(x => x.json());
      check("admin: rimozione foto con motivazione", rem.ok === true);
      const gone = await fetch(`${BASE}/api/public/photo/${photoId}`, { headers: { Cookie: `zz_session=${A.token}` } });
      check("foto rimossa non più disponibile", gone.status === 404);
    }
  } else {
    console.log("SKIP  admin: segreti TOTP demo non disponibili");
  }

  /* 15) regressione via invito: recensione verificata con foto */
  const expInv = await db.experience.create({
    data: { entityId: "ent_i_rondini", kind: "Abitazione in affitto", period: "2026", origin: "seed", clientEmail: "test-aperto-b@esempio.test", userId: B.id, status: "active", isDemo: true },
  });
  r = await post(B.token, "/api/reviews", {
    experienceId: expInv.id,
    score: 8, criteria: { stato: 8, descrizione: 8, spazi: 8, rumori: 7, impianti: 8, rapporto: 8 },
    pros: "Casa solida", text: REVIEW_BODY, honesty: true, photos: [await testPhoto([78, 125, 91])],
  });
  check("via invito: recensione verificata con foto", r.ok === true && r.verified === true && (r.photos as { added: number })?.added === 1);

  console.log(`\n${failures === 0 ? "TUTTI I TEST SUPERATI" : failures + " TEST FALLITI"}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
