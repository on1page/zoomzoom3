// ZoomZoom — collaudo end-to-end dei due pacchetti «percorsi semplici»:
//   B — ATTERRAGGIO E RICHIAMO CONSULENTI: link discreto nel piè di pagina,
//       accesso funzionante (il ritorno «dove eri» è client-side: si verifica
//       nel collaudo visivo con le anteprime).
//   C — CAMPO UNICO INDIRIZZO: client-side (si verifica con le anteprime);
//       qui si verifica che le rotte toccate rispondano.
//   A — SCHEDE COLLEGATE CONDOMINIO ↔ AMMINISTRATORE: dopo la pubblicazione
//       dell'indagine sull'immobile, la mini-indagine «due righe
//       sull'amministratore» crea (o riusa, dedup per nome normalizzato nella
//       stessa zona) la scheda amministratore, la collega al condominio e
//       assegna il Premium. Nella scheda dell'amministratore compaiono tutti
//       i condomini che amministra; in quella del condominio chi lo amministra.
// Uso: bun scripts/test-percorsi-ux.mjs   (server attivo su :3000)
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

// ogni utente simulato arriva da un IP diverso: i limiti per-IP (guard)
// restano rispettati senza falsarli
const IP = {};
const H = (user, extra = {}) => ({ "content-type": "application/json", "x-forwarded-for": IP[user], ...extra });

async function mkUser(email, nickname) {
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const salt = randomBytes(16).toString("hex");
  const u = await db.user.create({
    data: {
      email, nickname, role: "user", emailVerified: true,
      passwordHash: `scrypt$16384$8$1$${salt}$${scryptSync("test1234", salt, 64).toString("hex")}`,
    },
  });
  IP[u.id] = `10.77.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
  return u;
}

async function mkSession(userId) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 4 * 3600_000) },
  });
  return `zz_session=${token}`;
}

let PASS = 0, FAIL = 0;
const check = (label, cond, detail = "") => {
  if (cond) { PASS++; console.log(`  [OK ] ${label}`); }
  else { FAIL++; console.log(`  [NO ] ${label}${detail ? " — " + detail : ""}`); }
};

const TESTTXT = "Amministrazione presente e puntuale: bilanci consegnati con chiarezza, assemblee convocate con anticipo e verbali puntuali. Le parti comuni sono curate e gli interventi ordinari vengono gestiti senza ritardi eclatanti.";

async function mkImmobile(user, cookie, civico) {
  const res = await j(await fetch(`${BASE}/api/entities`, {
    method: "POST", headers: H(user.id, { cookie }), body: JSON.stringify({
      address: "Via Collaudo Percorsi", streetNumber: civico,
      zone: { name: "Milano", province: "MI", region: "Lombardia", lat: 45.4642, lng: 9.19 },
    }),
  }));
  return res.body?.entity || null;
}

async function mkParentReview(user, cookie, entityId) {
  const res = await j(await fetch(`${BASE}/api/reviews`, {
    method: "POST", headers: H(user.id, { cookie }), body: JSON.stringify({
      entityId, experienceKind: "Abitazione in affitto",
      score: 7, crit: { stato: 7 }, pros: "posizione silenziosa",
      cons: "portone da sistemare", text: TESTTXT, honesty: true, hp: "",
    }),
  }));
  return res.body?.ok ? res.body : null;
}

async function linked(user, cookie, body) {
  return j(await fetch(`${BASE}/api/reviews/linked`, {
    method: "POST", headers: H(user.id, { cookie }), body: JSON.stringify(body),
  }));
}

async function main() {
  console.log("ZoomZoom — collaudo percorsi semplici (B + C + A)\n");

  /* ---------- utenti ---------- */
  const userA = await mkUser("ux.a@zoomzoom.test", "uxa");
  const userB = await mkUser("ux.b@zoomzoom.test", "uxb");
  const userC = await mkUser("ux.c@zoomzoom.test", "uxc");
  const userV1 = await mkUser("ux.v1@zoomzoom.test", "uxv1");
  const userV2 = await mkUser("ux.v2@zoomzoom.test", "uxv2");
  const CA = await mkSession(userA.id);
  const CB = await mkSession(userB.id);
  const CC = await mkSession(userC.id);
  const CV1 = await mkSession(userV1.id);
  const CV2 = await mkSession(userV2.id);

  // pulizia di eventuali esecuzioni precedenti
  await db.entity.deleteMany({ where: { name: { contains: "Via Collaudo Percorsi" } } });
  await db.entity.deleteMany({ where: { name: { startsWith: "Studio Rossi Amministrazioni" } } });

  /* ---------- B: piè di pagina e accesso ---------- */
  console.log("B — atterraggio e richiamo consulenti");
  const home = await fetch(`${BASE}/`).then(r => r.text());
  check("Home: nel piè di pagina c'è il richiamo discreto ai consulenti", home.includes("Consulente tecnico (professionisti)"));
  const login = await j(await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: H(userA.id), body: JSON.stringify({ email: userA.email, password: "test1234" }),
  }));
  check("Accesso: le credenziali di prova funzionano", login.status === 200 && login.body?.ok !== false);

  /* ---------- A: il percorso collegato ---------- */
  console.log("\nA1 — scheda amministratore che nasce dall'indagine");
  const ent1 = await mkImmobile(userA, CA, "1");
  check("Immobile 1 creato (Via Collaudo Percorsi 1)", !!ent1?.id);
  const p1 = await mkParentReview(userA, CA, ent1.id);
  check("Indagine madre pubblicata sull'immobile", !!p1?.reviewId);
  check("L'indagine madre è su una scheda immobile", !!p1?.entityId && p1.entityId === ent1.id);

  const r1 = await linked(userA, CA, {
    parentReviewId: p1.reviewId, adminName: "Studio Rossi Amministrazioni",
    experienceKind: "Condominio in cui abito", score: 8,
    crit: { conti: 8 }, pros: "conti chiari e puntuali", cons: "verbali lunghi",
    text: TESTTXT, honesty: true, hp: "",
  });
  check("Mini-indagine pubblicata (created)", r1.status === 200 && r1.body?.ok === true && r1.body?.created === true, JSON.stringify(r1.body));
  const admin1 = r1.body?.entityId;
  check("Scheda amministratore nata dal collegamento", !!admin1);

  const schedaAdm = await j(await fetch(`${BASE}/api/public/entity/${admin1}`, { headers: H(userA.id, { cookie: CA }) }));
  check("Scheda amministratore: categoria «Amministratori di condominio»", schedaAdm.body?.entity?.categoryId === "amministratore");
  check("Scheda amministratore: il condominio 1 compare tra quelli amministrati",
    schedaAdm.body?.links?.buildings?.some(b => b.id === ent1.id) === true,
    JSON.stringify(schedaAdm.body?.links));
  check("Scheda amministratore: la mini-indagine è verificata (esperienza di chi ci vive)",
    (schedaAdm.body?.reviews || []).some(r => r.verified === true));

  const schedaCond = await j(await fetch(`${BASE}/api/public/entity/${ent1.id}`, { headers: H(userA.id, { cookie: CA }) }));
  check("Scheda condominio: compare chi lo amministra",
    schedaCond.body?.links?.administrator?.id === admin1 && schedaCond.body?.links?.administrator?.name === "Studio Rossi Amministrazioni");

  /* ---------- A2: riusa della scheda (dedup per nome) ---------- */
  console.log("\nA2 — riuso della scheda (dedup per nome, maiuscole comprese)");
  const ent2 = await mkImmobile(userB, CB, "2");
  const p2 = await mkParentReview(userB, CB, ent2.id);
  check("Immobile 2 e indagine madre (altro condomino)", !!ent2?.id && !!p2?.reviewId);
  const r2 = await linked(userB, CB, {
    parentReviewId: p2.reviewId, adminName: "STUDIO ROSSI amministrazioni",
    experienceKind: "Condominio in cui abito", score: 6,
    pros: "sempre raggiungibile", text: TESTTXT, honesty: true,
  });
  check("Secondo condomino: scheda riusata (created=false, stesso id)", r2.status === 200 && r2.body?.created === false && r2.body?.entityId === admin1, JSON.stringify(r2.body));
  const schedaAdm2 = await j(await fetch(`${BASE}/api/public/entity/${admin1}`, { headers: H(userB.id, { cookie: CB }) }));
  check("Scheda amministratore: ora amministra 2 condomini", schedaAdm2.body?.links?.buildings?.length === 2);

  /* ---------- A3: chi ha già recensito: collegamento comunque ---------- */
  console.log("\nA3 — chi ha già recensito: il collegamento nasce comunque");
  const ent3 = await mkImmobile(userA, CA, "3");
  const p3 = await mkParentReview(userA, CA, ent3.id);
  check("Immobile 3 e indagine madre (secondo condominio dello stesso utente)", !!ent3?.id && !!p3?.reviewId);
  const r3 = await linked(userA, CA, {
    parentReviewId: p3.reviewId, adminName: "Studio Rossi Amministrazioni",
    experienceKind: "Condominio in cui abito", score: 8,
    pros: "come sopra", text: TESTTXT, honesty: true,
  });
  check("Secondo condominio dello stesso utente: già recensito, collegamento comunque",
    r3.status === 200 && r3.body?.alreadyReviewed === true && r3.body?.entityId === admin1, JSON.stringify(r3.body));
  const schedaAdm3 = await j(await fetch(`${BASE}/api/public/entity/${admin1}`, { headers: H(userA.id, { cookie: CA }) }));
  check("Scheda amministratore: ora amministra 3 condomini", schedaAdm3.body?.links?.buildings?.length === 3);
  const nRecA = (schedaAdm3.body?.reviews || []).length;
  check("Nessuna indagine doppia: l'utente non ha riscritto sullo stesso amministratore", nRecA >= 2 && (await db.review.count({ where: { entityId: admin1, userId: userA.id, status: "published" } })) === 1);
  const scheda3 = await j(await fetch(`${BASE}/api/public/entity/${ent3.id}`, { headers: H(userA.id) }));
  check("Scheda condominio 3: «amministrato da» presente", scheda3.body?.links?.administrator?.id === admin1);

  /* ---------- A4: regole e garanzie ---------- */
  console.log("\nA4 — regole del server (le stesse dell'indagine aperta)");
  const v1 = await mkImmobile(userV1, CV1, "11");
  const pv1 = await mkParentReview(userV1, CV1, v1.id);
  check("Immobile di collaudo regole + indagine madre", !!v1?.id && !!pv1?.reviewId);

  const tCorto = await linked(userV1, CV1, {
    parentReviewId: pv1.reviewId, adminName: "Studio Corto", experienceKind: "Condominio in cui abito",
    score: 5, pros: "ok", text: "troppo corto", honesty: true,
  });
  check("Testo sotto i 100 caratteri rifiutato", tCorto.status === 400 && /100 caratteri/.test(tCorto.body?.error || ""));

  const noPros = await linked(userV1, CV1, {
    parentReviewId: pv1.reviewId, adminName: "Studio Senza Pregio", experienceKind: "Condominio in cui abito",
    score: 5, pros: "", text: TESTTXT, honesty: true,
  });
  check("Aspetto positivo mancante rifiutato", noPros.status === 400 && /aspetto positivo/.test(noPros.body?.error || ""));

  const nomeCorto = await linked(userV1, CV1, {
    parentReviewId: pv1.reviewId, adminName: "ab", experienceKind: "Condominio in cui abito",
    score: 5, pros: "ok", text: TESTTXT, honesty: true,
  });
  check("Nome amministratore troppo corto rifiutato", nomeCorto.status === 400 && /nome dell'amministratore/.test(nomeCorto.body?.error || ""));

  const v2 = await mkImmobile(userV2, CV2, "12");
  const pv2 = await mkParentReview(userV2, CV2, v2.id);
  const hp = await linked(userV2, CV2, {
    parentReviewId: pv2.reviewId, adminName: "Studio Honeypot", experienceKind: "Condominio in cui abito",
    score: 5, pros: "ok", text: TESTTXT, honesty: true, hp: "bot",
  });
  check("Honeypot compilato rifiutato", hp.status === 400 && /anti-bot/.test(hp.body?.error || ""));

  const noHonesty = await linked(userV2, CV2, {
    parentReviewId: pv2.reviewId, adminName: "Studio Senza Dichiarazione", experienceKind: "Condominio in cui abito",
    score: 5, pros: "ok", text: TESTTXT, honesty: false,
  });
  check("Dichiarazione mancante rifiutata", noHonesty.status === 400 && /dichiarazione/i.test(noHonesty.body?.error || ""));

  const kindKo = await linked(userB, CB, {
    parentReviewId: p2.reviewId, adminName: "Studio Tipo Sbagliato", experienceKind: "Tipo inesistente",
    score: 5, pros: "ok", text: TESTTXT, honesty: true,
  });
  check("Tipo di esperienza non valido rifiutato", kindKo.status === 400 && /tipo di esperienza/.test(kindKo.body?.error || ""));

  const altrui = await linked(userC, CC, {
    parentReviewId: p1.reviewId, adminName: "Studio Altrui", experienceKind: "Condominio in cui abito",
    score: 5, pros: "ok", text: TESTTXT, honesty: true,
  });
  check("L'indagine madre di un altro utente rifiutata", altrui.status === 403 && /non è la tua/.test(altrui.body?.error || ""));

  // madre su una scheda NON immobile: una recensione pubblica sulla scheda
  // amministratore non può fare da madre
  const revC = await j(await fetch(`${BASE}/api/reviews`, {
    method: "POST", headers: H(userC.id, { cookie: CC }), body: JSON.stringify({
      entityId: admin1, experienceKind: "Assemblea e gestione economica",
      score: 5, pros: "regolare", text: TESTTXT, honesty: true, hp: "",
    }),
  }));
  check("Recensione pubblica sulla scheda amministratore (per il test: madre non immobile)", revC.body?.ok === true);
  const madreKo = await linked(userC, CC, {
    parentReviewId: revC.body?.reviewId, adminName: "Studio Qualunque", experienceKind: "Condominio in cui abito",
    score: 5, pros: "ok", text: TESTTXT, honesty: true,
  });
  check("Madre non immobile rifiutata (niente catene di collegamenti)", madreKo.status === 400 && /immobile/.test(madreKo.body?.error || ""));

  /* ---------- A5: persistenza e trasparenza ---------- */
  console.log("\nA5 — persistenza e trasparenza");
  const nLinks = await db.entityLink.count({ where: { toEntityId: admin1, kind: "amministra" } });
  check("Tre collegamenti condominio → amministratore nel database", nLinks === 3, `trovati: ${nLinks}`);
  const audit = await db.auditLog.count({ where: { action: { in: ["Mini-indagine collegata: amministratore di condominio", "Condominio collegato a un amministratore già recensito"] } } });
  check("Audit log delle mini-indagini collegato scritto", audit >= 2, `trovati: ${audit}`);
  const schedaV1 = await j(await fetch(`${BASE}/api/public/entity/${v1.id}`, { headers: H(userV1.id) }));
  check("Scheda senza collegamenti: nessun amministratore, nessun errore",
    schedaV1.body?.ok === true && schedaV1.body?.links?.administrator == null && Array.isArray(schedaV1.body?.links?.buildings));
  const prem = await db.premiumGrant.findFirst({ where: { userId: userA.id, origin: "review" } });
  check("Premium assegnato per le indagini (madre e mini-indagine)", !!prem);

  console.log(`\nRisultato: ${PASS} passati, ${FAIL} falliti su ${PASS + FAIL}`);
  if (FAIL) process.exit(1);
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); process.exit(1); });
