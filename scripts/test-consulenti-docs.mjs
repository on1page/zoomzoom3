// ZoomZoom — prova end-to-end dei NUOVI controlli del Consulente Tecnico:
// limiti di dimensione dei documenti (2 MB per file, 3 MB in totale, guardia
// sul peso della richiesta), verifica del contenuto reale (magic bytes),
// validazione dell'IBAN (lunghezza per paese + codice di controllo mod-97),
// dichiarazione d'intestazione obbligatoria, gestione dei documenti durante
// l'esame (sostituisci/aggiungi/elimina), stato IBAN nel back office e
// ri-domanda che conserva i documenti validi.
// Uso: bun scripts/test-consulenti-docs.mjs   (server attivo su :3000,
// consigliato un riavvio del server prima della prova: la domanda di
// iscrizione è limitata a 10 invii all'ora per IP)
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
const MB = 1024 * 1024;

let PASS = 0, FAIL = 0;
const check = (label, cond, detail = "") => {
  if (cond) { PASS++; console.log(`  [OK ] ${label}`); }
  else { FAIL++; console.log(`  [NO ] ${label}${detail ? " — " + detail : ""}`); }
};

async function main() {
  console.log("ZoomZoom — prova end-to-end: limiti documenti, IBAN, gestione documenti\n");

  const cons = await mkUser("docs.test@zoomzoom.test", "docstest", { totp: true });
  const altro = await mkUser("altro.test@zoomzoom.test", "altrot", { totp: true });
  const superA = await mkUser("docsuper.test@zoomzoom.test", "docsuper", { totp: true, role: "superadmin" });
  const HCons = { "content-type": "application/json", cookie: await mkSession(cons.id, "public") };
  const HAltro = { "content-type": "application/json", cookie: await mkSession(altro.id, "public") };
  const HAdmin = { "content-type": "application/json", cookie: await mkSession(superA.id, "admin") };

  const photoB64 = b64(await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 90, g: 100, b: 140 } } }).jpeg().toBuffer(), "image/jpeg");
  const pdfQ = b64(Buffer.from("%PDF-1.4 fake qualifica"), "application/pdf");
  const pdfD = b64(Buffer.from("%PDF-1.4 fake documento"), "application/pdf");

  const applyBody = (over = {}) => ({
    firstName: "Marco", lastName: "Rossi", profession: "Ingegnere",
    title: "Laurea in ingegneria edile",
    bio: "Perizie dal 2012.",
    zone: { name: "Roma", province: "Roma", region: "Lazio", lat: 41.9, lng: 12.5 },
    radiusKm: 50, feeEuros: "400", vatNumber: "01234567891",
    iban: "IT60X0542811101000000123456", ibanSelfDeclared: true,
    photo: photoB64,
    docs: [
      { kind: "qualifica", name: "laurea.pdf", mime: "application/pdf", data: pdfQ },
      { kind: "documento", name: "carta-identita.pdf", mime: "application/pdf", data: pdfD },
    ],
    ...over,
  });
  // la domanda è limitata a 10 invii/ora per IP: ogni invio della prova usa
  // un IP diverso (x-forwarded-for) per non consumare il limite del server
  let ipSeq = 0;
  const apply = async (over) => j(await fetch(`${BASE}/api/consulente/apply`, {
    method: "POST",
    headers: { ...HCons, "x-forwarded-for": `192.0.2.${++ipSeq}` },
    body: JSON.stringify(applyBody(over)),
  }));

  /* ---------- 1. validazione IBAN ---------- */
  console.log("1) IBAN");
  const rIban1 = await apply({ iban: "IT61X0542811101000000123456" });
  check("codice di controllo errato rifiutato con messaggio specifico", rIban1.status === 400 && /codice di controllo/.test(rIban1.body?.error || ""), JSON.stringify(rIban1.body).slice(0, 120));

  const rIban2 = await apply({ iban: "IT60X054281110100000012345" });
  check("lunghezza errata rifiutata (26 caratteri invece di 27)", rIban2.status === 400 && /Lunghezza IBAN errata/.test(rIban2.body?.error || ""), JSON.stringify(rIban2.body).slice(0, 120));

  const rIban3 = await apply({ iban: "XX60X0542811101000000123456" });
  check("paese non previsto nel registro rifiutato", rIban3.status === 400 && /paese/.test(rIban3.body?.error || ""), JSON.stringify(rIban3.body).slice(0, 120));

  const rIban4 = await apply({ ibanSelfDeclared: undefined });
  check("senza dichiarazione d'intestazione la domanda non parte", rIban4.status === 400 && /Dichiarazione obbligatoria/.test(rIban4.body?.error || ""), JSON.stringify(rIban4.body).slice(0, 120));

  const rIban5 = await apply({ iban: "it60 x054 2811 1010 0000 0123 456" });
  check("IBAN valido con spazi e minuscole accettato (normalizzato)", rIban5.status === 200 && rIban5.body?.status === "pending", JSON.stringify(rIban5.body).slice(0, 120));

  // pulizia per ripetere la prova: elimino il profilo appena creato
  await db.consultantProfile.deleteMany({ where: { userId: cons.id } });

  /* ---------- 2. limiti di dimensione ---------- */
  console.log("\n2) LIMITI DI DIMENSIONE");
  const bigPdf = (mb, tag) => b64(Buffer.concat([Buffer.from("%PDF-1.4 " + tag), Buffer.alloc(Math.round(mb * MB), 0x41)]), "application/pdf");

  const rBig1 = await apply({ docs: [{ kind: "qualifica", name: "gigante.pdf", mime: "application/pdf", data: bigPdf(2.5, "A") }, { kind: "documento", name: "carta-identita.pdf", mime: "application/pdf", data: pdfD }] });
  check("documento singolo oltre 2 MB rifiutato", rBig1.status === 400 && /supera i 2 MB/.test(rBig1.body?.error || ""), JSON.stringify(rBig1.body).slice(0, 120));

  const rBig2 = await apply({ docs: [
    { kind: "qualifica", name: "a.pdf", mime: "application/pdf", data: bigPdf(1.6, "B") },
    { kind: "documento", name: "b.pdf", mime: "application/pdf", data: bigPdf(1.6, "C") },
  ] });
  check("documenti oltre 3 MB in totale rifiutati con messaggio chiaro", rBig2.status === 400 && /3 MB in totale/.test(rBig2.body?.error || ""), JSON.stringify(rBig2.body).slice(0, 120));

  const rBig3 = await apply({ docs: [
    { kind: "qualifica", name: "a.pdf", mime: "application/pdf", data: bigPdf(1.9, "D") },
    { kind: "documento", name: "b.pdf", mime: "application/pdf", data: bigPdf(1.9, "E") },
  ] });
  check("richiesta troppo pesante nel complesso respinta con messaggio comprensibile (non un errore criptico)", rBig3.status === 413 && /superano il limite/.test(rBig3.body?.error || ""), `status=${rBig3.status} ${JSON.stringify(rBig3.body).slice(0, 100)}`);

  const jpegBuf = await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
  const rMime = await apply({ docs: [
    { kind: "qualifica", name: "finto.pdf", mime: "application/pdf", data: b64(jpegBuf, "application/pdf") },
    { kind: "documento", name: "carta-identita.pdf", mime: "application/pdf", data: pdfD },
  ] });
  check("PDF dichiarato ma contenuto JPEG rifiutato (controllo byte reali)", rMime.status === 400 && /il contenuto è un altro|non è un PDF/.test(rMime.body?.error || ""), JSON.stringify(rMime.body).slice(0, 120));

  /* ---------- 3. domanda valida e stato IBAN ---------- */
  console.log("\n3) DOMANDA VALIDA E STATO IBAN");
  const rOk = await apply();
  check("domanda valida accettata", rOk.status === 200 && rOk.body?.status === "pending", JSON.stringify(rOk.body).slice(0, 120));

  const me1 = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HCons }));
  const profId = me1.body?.profile?.id;
  check("profilo PENDING con 2 documenti", me1.body?.profile?.status === "pending" && me1.body?.profile?.docs?.length === 2);
  check("IBAN salvato normalizzato (senza spazi)", me1.body?.profile?.iban === "IT60X0542811101000000123456", String(me1.body?.profile?.iban));
  check("stato IBAN = autocertificato", me1.body?.profile?.ibanCheck === "self", String(me1.body?.profile?.ibanCheck));

  const docs0 = me1.body?.profile?.docs || [];
  const idQualifica = docs0.find(d => d.kind === "qualifica")?.id;
  const idDocumento = docs0.find(d => d.kind === "documento")?.id;

  /* ---------- 4. gestione documenti durante l'esame ---------- */
  console.log("\n4) GESTIONE DOCUMENTI (finché la domanda è in esame)");
  const docApi = async (method, body, headers = HCons) =>
    j(await fetch(`${BASE}/api/consulente/docs`, { method, headers, body: JSON.stringify(body) }));

  const rDelUltimo = await docApi("DELETE", { docId: idDocumento });
  check("eliminazione dell'unico documento d'identificazione bloccata", rDelUltimo.status === 400 && /unico documento d'identificazione/.test(rDelUltimo.body?.error || ""), JSON.stringify(rDelUltimo.body).slice(0, 120));

  const rAdd = await docApi("PATCH", { kind: "esperienza", name: "curriculum.pdf", data: b64(Buffer.from("%PDF-1.4 curriculum aggiornato con esperienze"), "application/pdf") });
  check("aggiunta di un documento di esperienza", rAdd.status === 200, JSON.stringify(rAdd.body).slice(0, 120));

  const rRepl = await docApi("PATCH", { docId: idQualifica, name: "laurea-nuova.pdf", data: b64(Buffer.from("%PDF-1.4 laurea sostituita con versione leggibile"), "application/pdf") });
  check("sostituzione del documento di qualifica", rRepl.status === 200, JSON.stringify(rRepl.body).slice(0, 120));

  const dl = await fetch(`${BASE}/api/consulente/doc/${idQualifica}`, { headers: HCons });
  const dlName = (dl.headers.get("content-disposition") || "").match(/filename="(.+)"/)?.[1];
  check("documento sostituito scaricabile con il NUOVO nome file", dl.status === 200 && dlName === "laurea-nuova.pdf", `disposition=${dl.headers.get("content-disposition")}`);

  const rRecl = await docApi("PATCH", { docId: idQualifica, kind: "documento" });
  check("riclassificazione rifiutata se svuota le qualifiche", rRecl.status === 400 && /almeno un documento di qualifica/.test(rRecl.body?.error || ""), JSON.stringify(rRecl.body).slice(0, 120));

  const rBigDoc = await docApi("PATCH", { kind: "esperienza", name: "enorme.pdf", data: bigPdf(2.2, "F") });
  check("aggiunta oltre i 2 MB per file rifiunta", rBigDoc.status === 400 && /supera i 2 MB/.test(rBigDoc.body?.error || ""), JSON.stringify(rBigDoc.body).slice(0, 120));

  const rStranger = await docApi("PATCH", { docId: idQualifica, name: "hacker.pdf" }, HAltro);
  check("un altro utente non può toccare i documenti altrui", rStranger.status === 404, `status=${rStranger.status}`);

  const me2 = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HCons }));
  const docs2 = me2.body?.profile?.docs || [];
  check("documento d'esperienza aggiunto e qualifica sostituita (3 documenti)", docs2.length === 3 && docs2.some(d => d.kind === "esperienza") && docs2.some(d => d.originalName === "laurea-nuova.pdf"), JSON.stringify(docs2.map(d => `${d.kind}:${d.originalName}`)));

  const rDelExp = await docApi("DELETE", { docId: docs2.find(d => d.kind === "esperienza")?.id });
  check("eliminazione del documento facoltativo consentita", rDelExp.status === 200, JSON.stringify(rDelExp.body).slice(0, 120));

  /* ---------- 5. back office: stato IBAN e conferma ---------- */
  console.log("\n5) BACK OFFICE: IBAN");
  const adm1 = await j(await fetch(`${BASE}/api/admin/data/consulenti`, { headers: HAdmin }));
  const row = (adm1.body?.consulenti || []).find(c => c.id === profId);
  check("lo staff vede lo stato IBAN autocertificato", row?.ibanCheck === "self", JSON.stringify(row?.ibanCheck));

  const rConf = await j(await fetch(`${BASE}/api/admin/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "consultant.ibanConfirm", id: profId, reason: "Verificato a mano sul documento d'identità." }) }));
  check("conferma IBAN da parte dello staff", rConf.status === 200, JSON.stringify(rConf.body).slice(0, 120));

  const adm2 = await j(await fetch(`${BASE}/api/admin/data/consulenti`, { headers: HAdmin }));
  const row2 = (adm2.body?.consulenti || []).find(c => c.id === profId);
  check("stato aggiornato a verificato nel back office", row2?.ibanCheck === "confirmed", JSON.stringify(row2?.ibanCheck));

  /* ---------- 6. ri-domanda che conserva i documenti ---------- */
  console.log("\n6) RI-DOMANDA CON DOCUMENTI CONSERVATI");
  const rReject = await j(await fetch(`${BASE}/api/admin/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "consultant.reject", id: profId, reason: "Il documento d'identificazione è illeggibile." }) }));
  check("rifiuto della domanda con motivazione", rReject.status === 200, JSON.stringify(rReject.body).slice(0, 120));

  const me3 = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HCons }));
  const docsPrima = (me3.body?.profile?.docs || []).map(d => d.id).sort();
  const idDocDaSostituire = (me3.body?.profile?.docs || []).find(d => d.kind === "documento")?.id;
  const idQualificaDaTenere = (me3.body?.profile?.docs || []).find(d => d.kind === "qualifica")?.id;

  const rRiapply = await apply({
    docs: [{ kind: "documento", name: "carta-identita-nuova.pdf", mime: "application/pdf", data: b64(Buffer.from("%PDF-1.4 carta d'identità rifotografata leggibile"), "application/pdf") }],
    keepDocIds: [idQualificaDaTenere],
  });
  check("ri-domanda accettata (reapplied)", rRiapply.status === 200 && rRiapply.body?.reapplied === true, JSON.stringify(rRiapply.body).slice(0, 120));

  const me4 = await j(await fetch(`${BASE}/api/consulente/me`, { headers: HCons }));
  const docsDopo = me4.body?.profile?.docs || [];
  check("il documento CONSERVATO resta in archivio con lo stesso id", docsDopo.some(d => d.id === idQualificaDaTenere), JSON.stringify(docsDopo.map(d => d.id)));
  check("il documento SOSTITUITO è stato eliminato", !docsDopo.some(d => d.id === idDocDaSostituire));
  check("il documento NUOVO è presente (2 documenti in tutto)", docsDopo.length === 2 && docsDopo.some(d => d.originalName === "carta-identita-nuova.pdf"), JSON.stringify(docsDopo.map(d => d.originalName)));

  /* ---------- 7. dopo l'approvazione i documenti non si toccano più ---------- */
  console.log("\n7) DOPO L'APPROVAZIONE");
  const rApprove = await j(await fetch(`${BASE}/api/admin/action`, { method: "POST", headers: HAdmin, body: JSON.stringify({ action: "consultant.approve", id: profId, reason: "Ora è tutto leggibile." }) }));
  check("approvazione dopo la ri-domanda", rApprove.status === 200 && !!rApprove.body?.entityId, JSON.stringify(rApprove.body).slice(0, 120));

  const rDocApproved = await docApi("DELETE", { docId: docsDopo[0]?.id });
  check("con il profilo approvato i documenti non si modificano più", rDocApproved.status === 409, `status=${rDocApproved.status}`);

  /* ---------- fine ---------- */
  console.log(`\n---------- ESITO: ${PASS} riusciti, ${FAIL} falliti ----------`);
  await db.$disconnect();
  process.exit(FAIL ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
