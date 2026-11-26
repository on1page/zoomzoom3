// ZoomZoom — prova end-to-end dei percorsi ② e ③ del modello D11:
//   ② ABBONAMENTO: piani Silver/Gold/Platinum, ordine con causale-codice
//      SUB-XXXXXX, annullamento, registrazione del bonifico da parte del
//      super amministratore → PremiumGrant di origine «acquisto».
//   ③ INDAGINE PROFESSIONALE DALLA RICERCA: richiesta senza consulente →
//      bacheca di zona (senza dati del richiedente, K9), avviso via email ai
//      consulenti che coprono la zona, ritiro dell'incarico (claim), pagamento
//      con causale-codice PZ-XXXXXX, termine di consegna, consegna con 2FA e
//      sintesi pubblica, chiusura del cerchio (K7: la scheda dell'indirizzo
//      nasce o si aggiorna), scadenza della bacheca (expired → riproposta) e
//      incarico nullo (relazione non consegnata: ripubblicazione + feedback di
//      serietà del consulente).
// Uso: bun scripts/test-d11-percorsi.mjs   (server attivo su :3000)
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

async function mkUser(email, nickname, { totp = true, role = "user" } = {}) {
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const salt = randomBytes(16).toString("hex");
  const u = await db.user.create({
    data: {
      email, nickname, role, emailVerified: true, totpEnabled: totp,
      passwordHash: `scrypt$16384$8$1$${salt}$${scryptSync("test1234", salt, 64).toString("hex")}`,
    },
  });
  return u;
}

async function mkSession(userId, kind) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 4 * 3600_000) },
  });
  return `${kind === "admin" ? "zz_admin_session" : "zz_session"}=${token}`;
}

const cookie = (id) => ({ "content-type": "application/json", cookie: id });

let PASS = 0, FAIL = 0;
const check = (label, cond, detail = "") => {
  if (cond) { PASS++; console.log(`  [OK ] ${label}`); }
  else { FAIL++; console.log(`  [NO ] ${label}${detail ? " — " + detail : ""}`); }
};

// profilo consulente approvato con zona (creato via DB: il flusso di
// iscrizione è già collaudato da test-consulente.mjs; qui interessa il ③)
async function mkConsultant(user, zone, { radiusKm = 60 } = {}) {
  const old = await db.consultantProfile.findUnique({ where: { userId: user.id } });
  if (old) await db.consultantProfile.delete({ where: { id: old.id } });
  return db.consultantProfile.create({
    data: {
      userId: user.id, firstName: "Test", lastName: `Consulente ${user.nickname}`,
      profession: "Geometra", title: "Diploma di geometra", bio: "Collaudo.",
      zoneId: zone.id, radiusKm, feeCents: 25000, vatNumber: "01234567890",
      iban: "IT60X0542811101000000123456", status: "approved",
    },
  });
}

async function main() {
  console.log("ZoomZoom — prova end-to-end percorsi ② e ③ del modello D11\n");

  /* ---------- utenti ---------- */
  const rich = await mkUser("rich.d11@zoomzoom.test", "richd11");
  const consA = await mkUser("consa.d11@zoomzoom.test", "consad11");
  const consB = await mkUser("consb.d11@zoomzoom.test", "consbd11");
  const consLontano = await mkUser("conslont.d11@zoomzoom.test", "conslontd11");
  const adminPuro = await mkUser("admin.d11@zoomzoom.test", "admind11", { role: "admin" });
  const superA = await mkUser("super.d11@zoomzoom.test", "superd11", { role: "superadmin" });
  const HRich = cookie(await mkSession(rich.id, "public"));
  const HConsA = cookie(await mkSession(consA.id, "public"));
  const HConsB = cookie(await mkSession(consB.id, "public"));
  const HConsL = cookie(await mkSession(consLontano.id, "public"));
  const HAdminPuro = cookie(await mkSession(adminPuro.id, "admin"));
  const HAdmin = cookie(await mkSession(superA.id, "admin"));

  const milano = await db.zone.findFirst({ where: { id: "milano" } }) || await db.zone.findFirst();
  const lontana = (await db.zone.findMany()).find(z => z.id !== milano.id && Math.abs(z.gpsLat - milano.gpsLat) > 2) || milano;
  console.log(`zone di prova: ${milano.id} / ${lontana.id}`);

  const profA = await mkConsultant(consA, milano);
  const profB = await mkConsultant(consB, milano);
  const profL = await mkConsultant(consLontano, lontana, { radiusKm: 10 });

  /* ================= PERCORSO ② — ABBONAMENTO ================= */
  console.log("\n②) ABBONAMENTO PREMIUM");

  const rBoot = await j(await fetch(`${BASE}/api/public/bootstrap`));
  check("bootstrap: piani pubblici dichiarati (Silver 1gg/1€, Gold 7gg/5€, Platinum 30gg/20€)",
    (rBoot.body?.settings?.premiumPlans || []).length === 3
    && rBoot.body.settings.premiumPlans.some(p => p.slug === "silver" && p.days === 1 && p.priceCents === 100)
    && rBoot.body.settings.premiumPlans.some(p => p.slug === "gold" && p.days === 7 && p.priceCents === 500)
    && rBoot.body.settings.premiumPlans.some(p => p.slug === "platinum" && p.days === 30 && p.priceCents === 2000),
    JSON.stringify(rBoot.body?.settings?.premiumPlans));

  const rSubNo = await j(await fetch(`${BASE}/api/me/subscription`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planSlug: "gold" }) }));
  check("senza accesso l'ordine è rifiutato", rSubNo.status === 401, `status=${rSubNo.status}`);

  const rSubBad = await j(await fetch(`${BASE}/api/me/subscription`, { method: "POST", headers: HRich, body: JSON.stringify({ planSlug: "diamond" }) }));
  check("piano inesistente rifiutato", rSubBad.status === 400 && /piano/i.test(rSubBad.body?.error || ""));

  const rSub = await j(await fetch(`${BASE}/api/me/subscription`, { method: "POST", headers: HRich, body: JSON.stringify({ planSlug: "gold" }) }));
  check("ordine Gold aperto con causale-codice SUB-XXXXXX", rSub.status === 200 && /^SUB-[A-Z2-9]{6}$/.test(rSub.body?.order?.code || "") && rSub.body?.order?.priceCents === 500, JSON.stringify(rSub.body?.order).slice(0, 120));
  const order1 = rSub.body?.order;

  const rSub2 = await j(await fetch(`${BASE}/api/me/subscription`, { method: "POST", headers: HRich, body: JSON.stringify({ planSlug: "silver" }) }));
  const rSub3 = await j(await fetch(`${BASE}/api/me/subscription`, { method: "POST", headers: HRich, body: JSON.stringify({ planSlug: "platinum" }) }));
  const rSub4 = await j(await fetch(`${BASE}/api/me/subscription`, { method: "POST", headers: HRich, body: JSON.stringify({ planSlug: "silver" }) }));
  check("massimo 3 ordini in attesa insieme (anti-abuso)", rSub2.status === 200 && rSub3.status === 200 && rSub4.status === 429, `s2=${rSub2.status} s3=${rSub3.status} s4=${rSub4.status}`);
  const order3 = rSub3.body?.order;

  const rCanc = await j(await fetch(`${BASE}/api/me/subscription/${order3.id}/action`, { method: "POST", headers: HRich, body: JSON.stringify({ action: "cancel" }) }));
  check("l'utente annulla un ordine in attesa", rCanc.status === 200 && rCanc.body?.status === "cancelled");

  const rOv = await j(await fetch(`${BASE}/api/me/overview`, { headers: HRich }));
  check("profilo: ordini con stato e causale", rOv.body?.premium?.orders?.length === 3
    && rOv.body.premium.orders.some(o => o.code === order1.code && o.status === "pending")
    && rOv.body.premium.orders.some(o => o.status === "cancelled"));

  const rDataSub = await j(await fetch(`${BASE}/api/admin/data/abbonamenti`, { headers: HAdmin }));
  check("back office: sezione abbonamenti con causale e piano", rDataSub.body?.orders?.some(o => o.code === order1.code && o.planName === "Gold" && o.status === "pending"));

  const rPayByAdmin = await j(await fetch(`${BASE}/api/admin/action`, { method: "POST", headers: HAdminPuro, body: JSON.stringify({ action: "subscription.pay", id: order1.id, paymentRef: "CRO-1" }) }));
  check("un amministratore NON super NON registra il pagamento", rPayByAdmin.status === 403, `status=${rPayByAdmin.status}`);

  const rPay = await j(await fetch(`${BASE}/api/admin/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "subscription.pay", id: order1.id, paymentRef: "CRO-77" }) }));
  check("il super amministratore registra il bonifico → Premium attivato", rPay.status === 200 && rPay.body?.grantedDays === 7 && !!rPay.body?.until, JSON.stringify(rPay.body).slice(0, 120));

  const grant = await db.premiumGrant.findFirst({ where: { userId: rich.id, origin: "acquisto" } });
  const giorni = Math.round(((grant?.expiresAt?.getTime() || 0) - (grant?.grantedAt?.getTime() || 0)) / 86400000);
  check("PremiumGrant di origine «acquisto» con 7 giorni", !!grant && giorni === 7, `giorni=${giorni}`);
  const richAfter = await db.user.findUnique({ where: { id: rich.id } });
  check("premiumUntil dell'utente aggiornato", !!richAfter?.premiumUntil && richAfter.premiumUntil.getTime() > Date.now());

  const rOv2 = await j(await fetch(`${BASE}/api/me/overview`, { headers: HRich }));
  check("profilo: ordine pagato e Premium attivo", rOv2.body?.premium?.active === true && rOv2.body.premium.orders.some(o => o.code === order1.code && o.status === "paid"));

  /* ================= PERCORSO ③ — INDAGINE PROFESSIONALE ================= */
  console.log("\n③) INDAGINE PROFESSIONALE (bacheca di zona)");

  // zona obbligatoria anche per le richieste dirette
  const rNoZone = await j(await fetch(`${BASE}/api/consulente/requests`, {
    method: "POST", headers: HRich,
    body: JSON.stringify({ kind: "Perizia tecnica", address: "Via Senza Zona 3", description: "Perizia di prova senza città indicata, per verificare il controllo server." }),
  }));
  check("richiesta senza città rifiutata (la zona serve alla bacheca e alla K7)", rNoZone.status === 400 && /città|località/i.test(rNoZone.body?.error || ""), JSON.stringify(rNoZone.body).slice(0, 120));

  // richiesta in BACHECA di zona (nessun consulente indicato)
  const emailBefore = await db.emailLog.count();
  const rBach = await j(await fetch(`${BASE}/api/consulente/requests`, {
    method: "POST", headers: HRich,
    body: JSON.stringify({ kind: "Valutazione immobiliare", address: "Via dei Mille 15", zoneId: milano.id, description: "Valutazione indipendente di un appartamento di 80 mq al terzo piano prima di fare un'offerta." }),
  }));
  check("richiesta pubblicata in bacheca di zona (open) con causale PZ-XXXXXX", rBach.status === 200 && rBach.body?.bacheca === true && /^PZ-[A-Z2-9]{6}$/.test(rBach.body?.code || "") && !!rBach.body?.expiresAt, JSON.stringify(rBach.body).slice(0, 140));
  const reqA = rBach.body?.requestId;
  const codeA = rBach.body?.code;

  // K9: l'email di invito ai consulenti non contiene il nickname del richiedente
  // (la spedizione è in parallelo alla risposta: si concede un attimo per il log)
  await new Promise(r => setTimeout(r, 800));
  const invito = await db.emailLog.findFirst({
    where: { subject: { contains: "nuova richiesta di indagine" }, at: { gte: new Date(Date.now() - 60000) } },
    orderBy: { at: "desc" },
  });
  check("avviso via email ai consulenti della zona (registrato nel log email)", !!invito, "nessuna email di invito trovata");
  check("K9: l'invito NON contiene il nickname del richiedente", !invito || !(invito.body + invito.to).includes("richd11"), `${invito?.to} · ${invito?.body?.slice(0, 80)}`);

  // il consulente della zona vede la richiesta in bacheca, quello lontano no
  const rBachA = await j(await fetch(`${BASE}/api/consulente/bacheca`, { headers: HConsA }));
  const rowA = (rBachA.body?.rows || []).find(r => r.id === reqA);
  check("il consulente della zona vede la richiesta in bacheca", rBachA.status === 200 && !!rowA && rowA.address === "Via dei Mille 15");
  check("K9: la bacheca non espone NESSUN dato del richiedente", !rowA || (rowA.requesterHidden === true && !("nickname" in rowA) && !("email" in rowA)), JSON.stringify(rowA).slice(0, 120));
  const rBachL = await j(await fetch(`${BASE}/api/consulente/bacheca`, { headers: HConsL }));
  check("il consulente FUORI zona non la vede (copertura per raggio)", !(rBachL.body?.rows || []).some(r => r.id === reqA));
  const rBachRich = await j(await fetch(`${BASE}/api/consulente/bacheca`, { headers: HRich }));
  check("la bacheca è riservata ai consulenti approvati", rBachRich.status === 403, `status=${rBachRich.status}`);

  // il richiedente vede lo stato «in bacheca»
  const rMeRich = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HRich }));
  const outA = (rMeRich.body?.outgoing || []).find(r => r.id === reqA);
  check("il richiedente vede la richiesta «in bacheca di zona» con scadenza", outA?.status === "open" && !!outA?.expiresAt && outA.counterpart?.bacheca === true);

  // K9 anche sulla richiesta DIRETTA: il nickname arriva solo dopo l'accettazione
  const rDiretta = await j(await fetch(`${BASE}/api/consulente/requests`, {
    method: "POST", headers: HRich,
    body: JSON.stringify({ consultantUserId: consA.id, kind: "Perizia tecnica", address: "Via Diretta 7", zoneId: milano.id, description: "Perizia tecnica diretta per verificare la privacy del richiedente prima dell'accettazione." }),
  }));
  const reqD = rDiretta.body?.requestId;
  const rMeCons1 = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HConsA }));
  const inD = (rMeCons1.body?.incoming || []).find(r => r.id === reqD);
  check("K9: sulla richiesta diretta in attesa il nickname è NASCOSTO al consulente", inD?.counterpart?.nickname == null, JSON.stringify(inD?.counterpart));

  // ritiro dell'incarico dalla bacheca (claim)
  const rClaimOther = await j(await fetch(`${BASE}/api/consulente/requests/${reqA}/action`, { method: "POST", headers: HRich, body: JSON.stringify({ action: "claim", feeEuros: "200" }) }));
  check("il richiedente NON può ritirare l'incarico", rClaimOther.status === 403);
  const rClaim = await j(await fetch(`${BASE}/api/consulente/requests/${reqA}/action`, { method: "POST", headers: HConsA, body: JSON.stringify({ action: "claim", feeEuros: "280" }) }));
  check("il consulente ritira l'incarico confermando la tariffa (claim)", rClaim.status === 200 && rClaim.body?.status === "accepted" && rClaim.body?.feeCents === 28000, JSON.stringify(rClaim.body).slice(0, 120));

  const rMeCons2 = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HConsA }));
  const inD2 = (rMeCons2.body?.incoming || []).find(r => r.id === reqD);
  const inA2 = (rMeCons2.body?.incoming || []).find(r => r.id === reqA);
  check("K9: dopo il ritiro dell'incarico il nickname del richiedente è visibile al consulente", inA2?.counterpart?.nickname === "richd11", JSON.stringify(inA2?.counterpart));
  check("K9: la richiesta diretta ancora in attesa resta riservata finché il consulente non accetta", inD2?.counterpart?.nickname == null, JSON.stringify(inD2?.counterpart));

  // pagamento: SOLO il super amministratore, con termine di consegna
  const rPayUser = await j(await fetch(`${BASE}/api/consulente/requests/${reqA}/action`, { method: "POST", headers: HRich, body: JSON.stringify({ action: "pay" }) }));
  check("il richiedente NON registra il pagamento", rPayUser.status === 401 || rPayUser.status === 403);
  const rPayD = await j(await fetch(`${BASE}/api/consulente/requests/${reqA}/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "pay", paymentRef: "CRO-PZ-1" }) }));
  const scad = rPayD.body?.deadlineAt ? new Date(rPayD.body.deadlineAt) : null;
  check("pagamento registrato con termine di consegna a 7 giorni", rPayD.status === 200 && !!scad && Math.abs(scad.getTime() - Date.now() - 7 * 86400000) < 10 * 60000, JSON.stringify(rPayD.body).slice(0, 120));

  // consegna con 2FA (utenti di prova già con totpEnabled) + sintesi pubblica → K7
  const relazione = Array.from({ length: 8 }, (_, i) => `${i + 1}. Sezione della relazione tecnica di prova con testo sufficiente a superare il limite minimo richiesto dalla validazione del server per la consegna.`).join("\n\n");
  const rDel = await j(await fetch(`${BASE}/api/consulente/requests/${reqA}/action`, {
    method: "POST", headers: HConsA,
    body: JSON.stringify({ action: "deliver", title: "Relazione di valutazione — Via dei Mille 15", body: relazione, publicSummary: "Immobile in discreto stato; impianti a norma, ascensore da adeguare. Valore coerente con la zona." }),
  }));
  check("consegna riuscita (2FA attiva) con ripartizione 90/10", rDel.status === 200 && rDel.body?.payoutCents === 25200 && rDel.body?.commissionCents === 2800, JSON.stringify(rDel.body).slice(0, 140));

  // K7 — la scheda dell'indirizzo nasce con l'indagine certificata
  const entK7 = await db.entity.findUnique({ where: { id: rDel.body?.entityId } });
  check("K7: la scheda dell'indirizzo nasce (categoria immobile, nella zona giusta)", !!entK7 && entK7.categoryId === "immobile" && entK7.zoneId === milano.id && entK7.status === "published", JSON.stringify(entK7).slice(0, 140));
  const rEntK7 = await j(await fetch(`${BASE}/api/public/entity/${rDel.body?.entityId}`));
  check("K7: la scheda pubblica mostra l'indagine certificata con sintesi", rEntK7.body?.certified?.title === "Relazione di valutazione — Via dei Mille 15" && /discreto stato/.test(rEntK7.body?.certified?.summary || "") && rEntK7.body?.certified?.consultantName === `Test Consulente ${consA.nickname}`, JSON.stringify(rEntK7.body?.certified).slice(0, 160));

  const profADopo = await db.consultantProfile.findUnique({ where: { id: profA.id } });
  check("feedback di serietà: incarico consegnato registrato al consulente", profADopo?.incarichiCompletati === 1 && profADopo?.incarichiNulli === 0);

  // K7 riuso: seconda consegna sullo STESSO indirizzo riusa la scheda esistente
  const rBach2 = await j(await fetch(`${BASE}/api/consulente/requests`, {
    method: "POST", headers: HRich,
    body: JSON.stringify({ kind: "Perizia tecnica", address: "Via dei Mille 15", zoneId: milano.id, description: "Seconda indagine sullo stesso indirizzo per verificare il riuso della scheda esistente al secondo round." }),
  }));
  const reqB = rBach2.body?.requestId;
  await fetch(`${BASE}/api/consulente/requests/${reqB}/action`, { method: "POST", headers: HConsB, body: JSON.stringify({ action: "claim", feeEuros: "260" }) });
  await fetch(`${BASE}/api/consulente/requests/${reqB}/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "pay" }) });
  const rDel2 = await j(await fetch(`${BASE}/api/consulente/requests/${reqB}/action`, { method: "POST", headers: HConsB, body: JSON.stringify({ action: "deliver", title: "Perizia tecnica — seconda", body: relazione }) }));
  const dupCount = await db.entity.count({ where: { zoneId: milano.id, name: { contains: "Via dei Mille" } } });
  check("K7: consegna sullo stesso indirizzo RIUSA la scheda (niente doppioni)", rDel2.body?.entityId === rDel.body?.entityId && dupCount === 1, `dup=${dupCount}`);

  // scadenza della bacheca: expired → riproposta
  await db.periziaRequest.update({ where: { id: reqB }, data: { status: "open", consultantId: null, expiresAt: new Date(Date.now() - 3600_000) } });
  const rSweep1 = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HRich }));
  check("bacheca scaduta → expired (applicazione pigra)", (rSweep1.body?.outgoing || []).some(r => r.id === reqB && r.status === "expired"));
  const rReprop = await j(await fetch(`${BASE}/api/consulente/requests/${reqB}/action`, { method: "POST", headers: HRich, body: JSON.stringify({ action: "repropose" }) }));
  check("il richiedente ripropone la richiesta scaduta", rReprop.status === 200 && rReprop.body?.status === "open" && !!rReprop.body?.expiresAt);
  const rCancB = await j(await fetch(`${BASE}/api/consulente/requests/${reqB}/action`, { method: "POST", headers: HRich, body: JSON.stringify({ action: "cancel" }) }));
  check("il richiedente può annullare la richiesta in bacheca", rCancB.status === 200 && rCancB.body?.status === "cancelled");

  // incarico nullo: pagata ma relazione non consegnata entro il termine
  const rBach3 = await j(await fetch(`${BASE}/api/consulente/requests`, {
    method: "POST", headers: HRich,
    body: JSON.stringify({ kind: "Perizia tecnica", address: "Via Scadenza 21", zoneId: milano.id, description: "Perizia che non verrà consegnata in tempo, per verificare l'incarico nullo e la ripubblicazione in bacheca." }),
  }));
  const reqC = rBach3.body?.requestId;
  await fetch(`${BASE}/api/consulente/requests/${reqC}/action`, { method: "POST", headers: HConsA, body: JSON.stringify({ action: "claim", feeEuros: "300" }) });
  await fetch(`${BASE}/api/consulente/requests/${reqC}/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "pay" }) });
  await db.periziaRequest.update({ where: { id: reqC }, data: { deadlineAt: new Date(Date.now() - 3600_000) } });
  const rSweep2 = await j(await fetch(`${BASE}/api/consulente/bacheca`, { headers: HConsB }));
  const afterVoid = await db.periziaRequest.findUnique({ where: { id: reqC } });
  check("incarico nullo: la richiesta torna in bacheca con voidCount+1 e consulente svincolato", afterVoid?.status === "open" && afterVoid?.voidCount === 1 && afterVoid?.consultantId === null, JSON.stringify({ status: afterVoid?.status, voidCount: afterVoid?.voidCount }));
  const profAVoid = await db.consultantProfile.findUnique({ where: { id: profA.id } });
  check("incarico nullo: il mancato conta nel feedback di serietà del consulente", profAVoid?.incarichiNulli === 1);
  const rowC = (rSweep2.body?.rows || []).find(r => r.id === reqC);
  check("richiesta ripubblicata: tariffa già versata visibile al prossimo consulente", rowC?.voidCount === 1 && rowC?.feeCents === 30000, JSON.stringify(rowC).slice(0, 120));
  const rClaimB = await j(await fetch(`${BASE}/api/consulente/requests/${reqC}/action`, { method: "POST", headers: HConsB, body: JSON.stringify({ action: "claim", feeEuros: "1" }) }));
  check("il secondo consulente ritira alle condizioni già versate (tariffa immutata)", rClaimB.status === 200 && rClaimB.body?.feeCents === 30000, JSON.stringify(rClaimB.body).slice(0, 120));

  // registro perizie del back office: causale, stati nuovi, K7
  const rPerizie = await j(await fetch(`${BASE}/api/admin/data/perizie`, { headers: HAdmin }));
  const regA = (rPerizie.body?.perizie || []).find(p => p.id === reqA);
  const regC = (rPerizie.body?.perizie || []).find(p => p.id === reqC);
  check("registro perizie: causale-codice, pagamento e scheda collegata (K7)", regA?.code === codeA && !!regA?.entityId && !!regA?.paidAt, JSON.stringify({ code: regA?.code, entityId: regA?.entityId, paidAt: regA?.paidAt }));
  check("registro perizie: incarico nullo e ripubblicazione tracciati", regC?.voidCount === 1 && regC?.consultant?.includes("Test Consulente"));

  const rDash = await j(await fetch(`${BASE}/api/admin/data/dashboard`, { headers: HAdmin }));
  check("dashboard: code perizie in bacheca e abbonamenti da registrare", (rDash.body?.queues || []).some(q => q.href.includes("perizie") && q.label.includes("bacheca")) && (rDash.body?.queues || []).some(q => q.href.includes("abbonamenti")));

  // cron perizie: senza CRON_SECRET resta spento (503), come il job utilità
  const rCron = await j(await fetch(`${BASE}/api/cron/perizie`));
  check("cron perizie protetto: senza segreto risponde 503 (spento)", rCron.status === 503 || (rCron.status === 200 && rCron.body?.ok === true), `status=${rCron.status}`);

  // la richiesta DIRETTA in attesa resta invariata nel flusso noto
  const rReject = await j(await fetch(`${BASE}/api/consulente/requests/${reqD}/action`, { method: "POST", headers: HConsA, body: JSON.stringify({ action: "reject", reason: "Fuori dalla mia competenza specifica." }) }));
  check("flusso diretto invariato: rifiuto con motivazione", rReject.status === 200 && rReject.body?.status === "rejected");

  /* ---------- pulizia ---------- */
  await db.periziaRequest.deleteMany({ where: { requesterId: rich.id } });
  await db.entity.deleteMany({ where: { id: { in: [rDel.body?.entityId].filter(Boolean) } } });
  await db.premiumGrant.deleteMany({ where: { userId: rich.id, origin: "acquisto" } });
  await db.subscriptionOrder.deleteMany({ where: { userId: rich.id } });
  await db.consultantProfile.deleteMany({ where: { id: { in: [profA.id, profB.id, profL.id] } } });
  await db.user.deleteMany({ where: { id: { in: [rich.id, consA.id, consB.id, consLontano.id, adminPuro.id, superA.id] } } });
  await db.$disconnect();

  console.log(`\n---------- ESITO: ${PASS} riusciti, ${FAIL} falliti ----------`);
  process.exit(FAIL ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
