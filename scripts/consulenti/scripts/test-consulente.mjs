// ZoomZoom — prova end-to-end del Consulente Tecnico: iscrizione con 2FA,
// approvazione dello staff, scheda pubblica, richiesta di perizia, accettazione
// con tariffa, pagamento registrato dal super amministratore, consegna della
// relazione, PDF scaricabile, accredito 90/10 e chiusura.
// Uso: bun scripts/test-consulente.mjs   (server attivo su :3000)
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
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

const b64 = (buf, mime) => `data:${mime};base64,${buf.toString("base64")}`;

let PASS = 0, FAIL = 0;
const check = (label, cond, detail = "") => {
  if (cond) { PASS++; console.log(`  [OK ] ${label}`); }
  else { FAIL++; console.log(`  [NO ] ${label}${detail ? " — " + detail : ""}`); }
};

async function main() {
  console.log("ZoomZoom — prova end-to-end Consulente Tecnico\n");

  /* ---------- utenti ---------- */
  const cons = await mkUser("cons.test@zoomzoom.test", "constest", { totp: true });
  const rich = await mkUser("rich.test@zoomzoom.test", "richtest", { totp: false });
  const no2fa = await mkUser("no2fa.test@zoomzoom.test", "no2fatest", { totp: false });
  const superA = await mkUser("super.test@zoomzoom.test", "supertest", { totp: true, role: "superadmin" });
  const HCons = { "content-type": "application/json", cookie: await mkSession(cons.id, "public") };
  const HRich = { "content-type": "application/json", cookie: await mkSession(rich.id, "public") };
  const HNo2fa = { "content-type": "application/json", cookie: await mkSession(no2fa.id, "public") };
  const HAdmin = { "content-type": "application/json", cookie: await mkSession(superA.id, "admin") };

  const milano = await db.zone.findFirst({ where: { id: "milano" } }) || await db.zone.findFirst();
  console.log(`zona di prova: ${milano.id}`);

  /* ---------- 1. iscrizione senza 2FA → rifiutata ---------- */
  console.log("\n1) ISCRIZIONE");
  const photoB64 = b64(await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 90, g: 100, b: 140 } } }).jpeg().toBuffer(), "image/jpeg");
  const docQ = b64(Buffer.from("%PDF-1.4 fake qualifica"), "application/pdf");
  const docD = b64(Buffer.from("%PDF-1.4 fake documento"), "application/pdf");
  const applyBody = (over = {}) => ({
    firstName: "Giorgia", lastName: "Bianchi", profession: "Geometra",
    title: "Diploma di geometra", bio: "Perizie e valutazioni dal 2008.",
    zone: { name: "Milano", province: "Milano", region: "Lombardia", lat: 45.4642, lng: 9.19 },
    radiusKm: 40, feeEuros: "300", vatNumber: "01234567890",
    iban: "IT60X0542811101000000123456", phone: "02 123456",
    photo: photoB64,
    docs: [
      { kind: "qualifica", name: "diploma.pdf", mime: "application/pdf", data: docQ },
      { kind: "documento", name: "carta-identita.pdf", mime: "application/pdf", data: docD },
    ],
    ...over,
  });
  const rNo2fa = await j(await fetch(`${BASE}/api/consulente/apply`, { method: "POST", headers: HNo2fa, body: JSON.stringify(applyBody()) }));
  check("senza 2FA la domanda è rifiutata con messaggio chiaro", rNo2fa.status === 403 && /due passaggi/i.test(rNo2fa.body?.error || ""), JSON.stringify(rNo2fa.body).slice(0, 100));

  const rApply = await j(await fetch(`${BASE}/api/consulente/apply`, { method: "POST", headers: HCons, body: JSON.stringify(applyBody()) }));
  check("domanda con 2FA accettata (in attesa dello staff)", rApply.status === 200 && rApply.body?.status === "pending", JSON.stringify(rApply.body).slice(0, 100));

  const rMe = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HCons }));
  check("il consulente vede il proprio profilo PENDING con documenti", rMe.body?.profile?.status === "pending" && rMe.body?.profile?.docs?.length === 2);

  /* ---------- 2. richiesta a un consulente non ancora approvato ---------- */
  const profId = rMe.body?.profile?.id;
  const rEarly = await j(await fetch(`${BASE}/api/consulente/requests`, {
    method: "POST", headers: HRich,
    body: JSON.stringify({ consultantUserId: cons.id, kind: "Perizia tecnica", address: "Via Test 1, Milano", description: "Valutazione di un appartamento prima dell'acquisto, circa 80 mq con terrazzo." }),
  }));
  check("richiesta a consulente non approvato rifiutata", rEarly.status === 404, JSON.stringify(rEarly.body).slice(0, 100));

  /* ---------- 3. approvazione dello staff ---------- */
  console.log("\n2) APPROVAZIONE STAFF");
  const rData = await j(await fetch(`${BASE}/api/admin/data/consulenti`, { headers: HAdmin }));
  check("back office: la domanda compare tra i pending", rData.body?.consulenti?.some(c => c.id === profId && c.status === "pending" && c.totpEnabled));

  const rApprove = await j(await fetch(`${BASE}/api/admin/action`, {
    method: "POST", headers: HAdmin,
    body: JSON.stringify({ action: "consultant.approve", id: profId, reason: "Documenti in ordine." }),
  }));
  check("approvazione riuscita con creazione della scheda", rApprove.status === 200 && !!rApprove.body?.entityId, JSON.stringify(rApprove.body).slice(0, 120));
  const entityId = rApprove.body?.entityId;

  const rBoot = await j(await fetch(`${BASE}/api/public/bootstrap`));
  check("categoria Consulenti presente nel catalogo (self-healing)", rBoot.body?.categories?.some(c => c.id === "consulente"));

  const rEnt = await j(await fetch(`${BASE}/api/public/entity/${entityId}`));
  check("scheda pubblica con dati professionali", rEnt.body?.consultant?.firstName === "Giorgia" && rEnt.body?.consultant?.profession === "Geometra" && rEnt.body?.consultant?.twoFactor === true);
  check("scheda verificata e nel catalogo", rEnt.body?.entity?.verifiedBusiness === true && rEnt.body?.entity?.name === "Giorgia Bianchi");

  const rPhoto = await fetch(`${BASE}/api/consulente/photo/${profId}`);
  const photoOk = rPhoto.status === 200 && (rPhoto.headers.get("content-type") || "").includes("image/jpeg");
  check("foto profilo pubblica servita come JPEG", photoOk);

  /* ---------- 4. richiesta di perizia ---------- */
  console.log("\n3) RICHIESTA DI PERIZIA");
  const rReq = await j(await fetch(`${BASE}/api/consulente/requests`, {
    method: "POST", headers: HRich,
    body: JSON.stringify({ entityId, kind: "Valutazione immobiliare", address: "Via Test 1, Milano", description: "Valutazione indipendente di un appartamento di 80 mq al terzo piano prima di fare un'offerta." }),
  }));
  check("richiesta creata", rReq.status === 200 && !!rReq.body?.requestId, JSON.stringify(rReq.body).slice(0, 120));
  const reqId = rReq.body?.requestId;

  const rAcceptOther = await j(await fetch(`${BASE}/api/consulente/requests/${reqId}/action`, { method: "POST", headers: HRich, body: JSON.stringify({ action: "accept" }) }));
  check("il richiedente NON può accettare la propria richiesta", rAcceptOther.status === 403);

  const rDeliverEarly = await j(await fetch(`${BASE}/api/consulente/requests/${reqId}/action`, { method: "POST", headers: HCons, body: JSON.stringify({ action: "deliver", title: "Relazione", body: "x".repeat(400) }) }));
  check("consegna impossibile prima dell'accettazione/pagamento", rDeliverEarly.status === 409);

  const rAccept = await j(await fetch(`${BASE}/api/consulente/requests/${reqId}/action`, { method: "POST", headers: HCons, body: JSON.stringify({ action: "accept", feeEuros: "300" }) }));
  check("consulente accetta con tariffa 300 €", rAccept.status === 200 && rAccept.body?.feeCents === 30000, JSON.stringify(rAccept.body).slice(0, 120));

  const rPayByUser = await j(await fetch(`${BASE}/api/consulente/requests/${reqId}/action`, { method: "POST", headers: HRich, body: JSON.stringify({ action: "pay" }) }));
  check("il richiedente NON può registrare il pagamento", rPayByUser.status === 403 || rPayByUser.status === 401);

  /* ---------- 5. pagamento (super admin) ---------- */
  console.log("\n4) PAGAMENTO E CONSEGNA");
  const rPay = await j(await fetch(`${BASE}/api/consulente/requests/${reqId}/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "pay", paymentRef: "CRO-12345" }) }));
  check("super amministratore registra il pagamento", rPay.status === 200 && rPay.body?.status === "paid", JSON.stringify(rPay.body).slice(0, 120));

  const relazione = Array.from({ length: 8 }, (_, i) => `${i + 1}. Sezione della relazione tecnica di prova con testo sufficiente a superare il limite minimo richiesto dalla validazione del server per la consegna.`).join("\n\n");
  const rDeliver = await j(await fetch(`${BASE}/api/consulente/requests/${reqId}/action`, { method: "POST", headers: HCons, body: JSON.stringify({ action: "deliver", title: "Relazione di valutazione immobiliare", body: relazione }) }));
  check("consegna riuscita con ripartizione 90/10", rDeliver.status === 200 && rDeliver.body?.payoutCents === 27000 && rDeliver.body?.commissionCents === 3000, JSON.stringify(rDeliver.body).slice(0, 140));

  /* ---------- 6. PDF ---------- */
  const rPdf = await fetch(`${BASE}/api/consulente/requests/${reqId}/pdf`, { headers: HRich });
  const pdfBuf = Buffer.from(await rPdf.arrayBuffer());
  check("PDF scaricabile dal richiedente (firma %PDF)", rPdf.status === 200 && pdfBuf.subarray(0, 4).toString() === "%PDF" && pdfBuf.length > 1500, `status=${rPdf.status} byte=${pdfBuf.length}`);
  const pdfText = (() => { try { return pdfBuf.toString("latin1"); } catch { return ""; } })();
  check("PDF multi-pagina con piè di pagina", /Pagina 1 di/.test(pdfText));

  const intruder = await mkUser("intruso.test@zoomzoom.test", "intruso");
  const HIntr = { "content-type": "application/json", cookie: await mkSession(intruder.id, "public") };
  const rPdfNo = await fetch(`${BASE}/api/consulente/requests/${reqId}/pdf`, { headers: HIntr });
  check("PDF NON accessibile a estranei", rPdfNo.status === 403, `status=${rPdfNo.status}`);

  const rDocNo = await fetch(`${BASE}/api/consulente/doc/${(await db.consultantDoc.findFirst({ where: { consultantId: profId } })).id}`, { headers: HIntr });
  check("documenti del consulente NON accessibili a estranei", rDocNo.status === 403, `status=${rDocNo.status}`);
  const rDocSi = await fetch(`${BASE}/api/consulente/doc/${(await db.consultantDoc.findFirst({ where: { consultantId: profId } })).id}`, { headers: HAdmin });
  check("documenti accessibili allo staff", rDocSi.status === 200);

  /* ---------- 7. accredito e chiusura ---------- */
  console.log("\n5) ACCREDITO E CHIUSURA");
  const rPerizie = await j(await fetch(`${BASE}/api/admin/data/perizie`, { headers: HAdmin }));
  check("registro perizie: richiesta con accredito 270,00 € e commissione 30,00 €", rPerizie.body?.perizie?.some(p => p.id === reqId && p.payoutCents === 27000 && p.commissionCents === 3000));

  const rPayout = await j(await fetch(`${BASE}/api/consulente/requests/${reqId}/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "payout" }) }));
  check("super amministratore registra l'accredito (chiusura)", rPayout.status === 200 && rPayout.body?.status === "closed");

  const rMeRich = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HRich }));
  const myReq = rMeRich.body?.outgoing?.find(r => r.id === reqId);
  check("il richiedente vede la pratica conclusa", myReq?.status === "closed" && myReq?.reportTitle === "Relazione di valutazione immobiliare");

  /* ---------- pulizia ---------- */
  await db.periziaRequest.deleteMany({ where: { OR: [{ requesterId: rich.id }, { consultantId: profId }] } });
  await db.entity.deleteMany({ where: { id: entityId } });
  await db.consultantProfile.deleteMany({ where: { id: profId } });
  await db.user.deleteMany({ where: { id: { in: [cons.id, rich.id, no2fa.id, superA.id, intruder.id] } } });
  await db.$disconnect();

  console.log(`\n---------- ESITO: ${PASS} riusciti, ${FAIL} falliti ----------`);
  process.exit(FAIL ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
