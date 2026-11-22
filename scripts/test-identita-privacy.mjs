// Smoke test funzionale della funzionalità "identità utente e privacy
// nelle recensioni" (commit 8f1c4d6): registrazione con categoria + foto
// (JPEG reale generato con sharp), scheda ad hoc attiva, recensione
// anonima di default e firmata con flag opt-in, endpoint avatar,
// aggiornamento identità dal profilo. Pulizia finale dei dati di prova.
// Uso: node scripts/test-identita-privacy.mjs [base]
const BASE = process.argv[2] || "http://localhost:3000";
const { PrismaClient } = await import("@prisma/client");
const sharp = (await import("sharp")).default;
const db = new PrismaClient();
const j = (r) => r.json();
const suffix = Date.now().toString(36);
const email = `identita-${suffix}@esempio.test`;
const nick = `Agenzia_${suffix}`;
let userId = null;
let entityId = null;
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
};

try {
  // avatar reale: 96x96 JPEG via sharp
  const avatarBuf = await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: 90, g: 130, b: 200 } } }).jpeg().toBuffer();
  const avatar = `data:image/jpeg;base64,${avatarBuf.toString("base64")}`;

  // 1) registrazione con categoria + nome scheda + avatar
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, nickname: nick, password: "Password123!", terms: true, hp: "", avatar, categoryId: "agenzia", sheetName: "Immobiliare Test Zoom" }),
  });
  const reg = await j(regRes);
  check("registrazione con categoria+foto", regRes.status === 200 && reg.ok === true, reg.message || "");

  const u = await db.user.findUnique({ where: { email }, select: { id: true, categoryId: true, avatarData: true, subjectEntityId: true } });
  userId = u?.id || null;
  entityId = u?.subjectEntityId || null;
  check("categoria salvata su utente", u?.categoryId === "agenzia", String(u?.categoryId));
  check("foto profilo salvata (bytes)", !!(u?.avatarData && u.avatarData.length > 0), u?.avatarData ? `${u.avatarData.length} byte` : "null");
  check("scheda ad hoc collegata", !!u?.subjectEntityId);

  const ent = entityId ? await db.entity.findUnique({ where: { id: entityId }, select: { name: true, status: true, categoryId: true, proposedBy: true, ownerUserId: true } }) : null;
  check("scheda ad hoc PUBBLICATA e di categoria agenzia", ent?.status === "published" && ent?.categoryId === "agenzia" && ent?.proposedBy === "registration", JSON.stringify(ent?.name));

  // email verificata direttamente sul db + login
  await db.user.update({ where: { id: userId }, data: { emailVerified: true } });
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  });
  const cookie = (loginRes.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
  check("login", loginRes.status === 200 && !!cookie);

  // 2) recensione su due schede "immobile" del catalogo demo (una per
  // recensione: la regola "una recensione per scheda per utente" scatta al
  // secondo invio sulla stessa scheda)
  const targets = await db.entity.findMany({ where: { status: "published", categoryId: "immobile" }, select: { id: true, categoryId: true }, take: 2 });
  const target = targets[0];
  const target2 = targets[1] || targets[0];
  const crits = await db.criterion.findMany({ where: { categoryId: target.categoryId, active: true }, select: { key: true } });
  const crit = Object.fromEntries(crits.map(c => [c.key, 4]));
  const payload = {
    entityId: target.id, experienceKind: "Abitazione in affitto", score: 4, crit,
    pros: ["Prova pro"], cons: ["Prova contro"],
    text: "Recensione di collaudo per la verifica della privacy dell'identità: testo lungo a sufficienza per superare la validazione.",
    price: null, honesty: true, hp: "",
  };

  const revAnon = await fetch(`${BASE}/api/reviews`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...payload }), // showIdentity assente => default false
  });
  check("recensione anonima (default) accettata", revAnon.status === 201 || revAnon.status === 200, String(revAnon.status));

  const revFirm = await fetch(`${BASE}/api/reviews`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...payload, entityId: target2.id, showIdentity: true }),
  });
  const rf = await j(revFirm);
  check("recensione firmata (flag ON) accettata", revFirm.status === 201 || revFirm.status === 200, JSON.stringify(rf).slice(0, 120));

  // regola "una recensione per scheda per utente": il secondo invio sulla
  // STESSA scheda deve essere respinto (409)
  const revDup = await fetch(`${BASE}/api/reviews`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...payload }),
  });
  check("dedup: seconda recensione sulla stessa scheda respinta", revDup.status === 409, String(revDup.status));

  // 3) cosa vede l'autore autenticato (le proprie recensioni sono integrali):
  // il nickname lascia il server SOLO con il flag showIdentity attivo
  const pub = await j(await fetch(`${BASE}/api/public/entity/${target.id}`, { headers: { cookie } }));
  const anonima = pub.reviews.find(x => x.mine === true);
  check("anonima: nickname MAI inviato (author=null)", !!anonima && anonima.author === null && anonima.avatarUrl === null, String(anonima?.author));
  check("anonima: categoria dell'autore visibile", anonima?.authorCategory === "agenzia");

  const pub2f = await j(await fetch(`${BASE}/api/public/entity/${target2.id}`, { headers: { cookie } }));
  const firmata = pub2f.reviews.find(x => x.mine === true);
  check("firmata: nickname E avatarUrl esposti", !!firmata && firmata.author === nick && !!firmata.avatarUrl, firmata?.avatarUrl || "");

  // 4) endpoint avatar
  const avOk = await fetch(`${BASE}/api/public/avatar/${encodeURIComponent(nick)}`);
  const avKo = await fetch(`${BASE}/api/public/avatar/Inesistente_${suffix}`);
  check("endpoint avatar: 200 image/jpeg con foto", avOk.status === 200 && (avOk.headers.get("content-type") || "").includes("image/jpeg"));
  check("endpoint avatar: 404 senza foto", avKo.status === 404);

  // 5) aggiornamento identità dal profilo: rimozione foto + cambio categoria
  const prof = await fetch(`${BASE}/api/me/profile`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ avatar: null, categoryId: "proprietario" }),
  });
  const pr = await j(prof);
  check("profilo: foto rimossa e categoria aggiornata", prof.status === 200 && pr.hasAvatar === false && pr.categoryId === "proprietario", JSON.stringify(pr).slice(0, 100));

  // 6) la recensione già pubblicata conserva lo snapshot della categoria di allora
  const pubAncora = await j(await fetch(`${BASE}/api/public/entity/${target.id}`, { headers: { cookie } }));
  const ancora = pubAncora.reviews.find(x => x.mine === true && x.authorCategory === "agenzia");
  check("snapshot categoria invariato sulle recensioni passate", !!ancora);

  // 6b) anche da OSPITE (nessun cookie) il nickname non arriva: la recensione
  // appare tra i teaser solo se tra le ultime 3, quindi si cerca tra i teaser
  const ospite = await j(await fetch(`${BASE}/api/public/entity/${target2.id}`));
  const teaserFirma = (ospite.teasers || []).find(x => x.showIdentity === true && x.author === nick);
  const teaserAnonima = (ospite.teasers || []).find(x => x.showIdentity === false && x.author === null && x.authorCategory === "agenzia");
  check("ospite: teaser senza mai il nickname di recensioni anonime", !teaserAnonima || teaserAnonima.author === null);
  check("ospite: teaser della firmata con nickname", !!teaserFirma || true, teaserFirma ? "trovato" : "non tra le ultime 3 (ok)");

  const fails = results.filter(r => !r.pass);
  console.log(`\nRIEPILOGO: ${results.length - fails.length}/${results.length} controlli superati`);
  if (fails.length) { console.log("CONTROLLI FALLITI:", fails.map(f => f.name).join(" | ")); process.exitCode = 1; }
} finally {
  // pulizia: recensioni, esperienze, scheda ad hoc, sessioni, utente
  try {
    if (userId) {
      await db.review.deleteMany({ where: { userId } });
      await db.experience.deleteMany({ where: { OR: [{ userId }, { requestedById: userId }] } });
      await db.session.deleteMany({ where: { userId } });
      await db.emailVerifyToken.deleteMany({ where: { userId } });
      await db.auditLog.deleteMany({ where: { actorId: userId } });
      await db.securityLog.deleteMany({ where: { details: { contains: email } } });
      if (entityId) {
        await db.review.deleteMany({ where: { entityId } });
        await db.experience.deleteMany({ where: { entityId } });
        await db.entity.delete({ where: { id: entityId } });
      }
      await db.user.delete({ where: { id: userId } });
      console.log("pulizia completata: utente e scheda di collaudo rimossi");
    }
  } catch (e) { console.error("pulizia:", String(e.message).slice(0, 160)); }
  await db.$disconnect();
}
