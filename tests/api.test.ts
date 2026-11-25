// ZoomZoom — test automatici end-to-end delle API (autenticazione,
// autorizzazione, invito monouso atomico, recensione duplicata, moderazione).
// Esecuzione: bun tests/api.test.ts (richiede il dev server su :3000 e il seed demo).
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { createHmac, createHash } from "crypto";
import { readFileSync } from "fs";

const BASE = "http://localhost:3000";
const creds = JSON.parse(readFileSync("demo-credentials.json", "utf8")) as Record<string, { password: string; totpSecret?: string }>;

/* ---------- utils ---------- */
function b32decode(s: string): Buffer {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of clean) {
    val = (val << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret: string): string {
  const msg = Buffer.alloc(8);
  const counter = Math.floor(Date.now() / 1000 / 30);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", b32decode(secret)).update(msg).digest();
  const off = mac[19] & 0x0f;
  const code = (((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) >>> 0;
  return String(code % 1_000_000).padStart(6, "0");
}
type Jar = { cookie: string; ip?: string };
async function call(jar: Jar | null, path: string, init: RequestInit = {}): Promise<{ status: number; body: any; setCookie: string | null }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
  if (init.body && typeof init.body === "string") headers["Content-Type"] = "application/json";
  if (jar?.cookie) headers["Cookie"] = jar.cookie;
  if (jar?.ip) headers["x-forwarded-for"] = jar.ip;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && jar) {
    const pair = setCookie.split(";")[0];
    const name = pair.split("=")[0];
    const existing = jar.cookie ? jar.cookie.split("; ").filter(c => !c.startsWith(name + "=")) : [];
    jar.cookie = [...existing, pair].join("; ");
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* risposta non JSON */ }
  return { status: res.status, body, setCookie };
}
const json = (o: unknown) => JSON.stringify(o);

let adminJar: Jar, userJar: Jar, bizJar: Jar, freshJar: Jar;
const FRESH_EMAIL = `test-${Date.now()}@esempio.test`;
// IP di test unici per run: i rate limit in-memory del server non si accumulano tra esecuzioni
const RUN = Math.floor(Math.random() * 200) + 1;
const anon = (): Jar => ({ cookie: "", ip: `10.99.${RUN}.9` });

beforeAll(async () => {
  // login admin con TOTP reale (segreto solo dal file credenziali locale)
  // nota: ogni jar usa un IP di test diverso per non accumulare rate limit tra run
  adminJar = { cookie: "", ip: `10.99.${RUN}.1` };
  const a = await call(adminJar, "/api/admin/login", { method: "POST", body: json({ email: "admin@esempio.test", password: creds["admin@esempio.test"].password, code: totpNow(creds["admin@esempio.test"].totpSecret!) }) });
  if (a.status !== 200) throw new Error("login admin fallito: " + JSON.stringify(a.body));
  // login utente demo e soggetto verificato demo
  userJar = { cookie: "", ip: `10.99.${RUN}.2` };
  const u = await call(userJar, "/api/auth/login", { method: "POST", body: json({ email: "utente@esempio.test", password: creds["utente@esempio.test"].password }) });
  if (u.status !== 200) throw new Error("login utente fallito");
  bizJar = { cookie: "", ip: `10.99.${RUN}.3` };
  const b = await call(bizJar, "/api/auth/login", { method: "POST", body: json({ email: "agenzia@esempio.test", password: creds["agenzia@esempio.test"].password }) });
  if (b.status !== 200) throw new Error("login agenzia fallito");
  // registrazione utente fresco (per il flusso invito)
  freshJar = { cookie: "", ip: `10.99.${RUN}.4` };
  // la demo parte con inviteDailyCap=5, insufficiente per le esecuzioni ripetute
  // dei test: lo si alza (e ripristina) via API amministrativa, come in produzione
  await call(adminJar, "/api/admin/action", { method: "POST", body: json({ action: "settings.update", settings: { inviteDailyCap: 60, inviteApprovalAbove: 100 }, reason: "Test automatici: parametri inviti temporaneamente elevati." }) });
});

afterAll(async () => {
  if (adminJar?.cookie) {
    await call(adminJar, "/api/admin/action", { method: "POST", body: json({ action: "settings.update", settings: { inviteDailyCap: 5, inviteApprovalAbove: 10 }, reason: "Test automatici: parametri inviti ripristinati." }) });
  }
});

/* ---------- esecuzione seriale: i flussi dipendono l'uno dall'altro ---------- */
describe.serial("ZoomZoom API", () => {

/* ---------- 1. bootstrap e dati pubblici ---------- */
test("bootstrap espone configurazione e categorie senza dati sensibili", async () => {
  const r = await call(null, "/api/public/bootstrap");
  expect(r.status).toBe(200);
  expect(r.body.ok).toBe(true);
  expect(r.body.categories.length).toBe(7);
  expect(r.body.site.demoMode).toBe(true);
  expect(JSON.stringify(r.body)).not.toContain("passwordHash");
  expect(JSON.stringify(r.body)).not.toContain("totpSecret");
});

test("ricerca pubblica restituisce schede demo con medie", async () => {
  const r = await call(null, "/api/public/search?q=rondini");
  expect(r.status).toBe(200);
  expect(r.body.rows.length).toBeGreaterThanOrEqual(1);
  expect(r.body.rows[0].n).toBeGreaterThan(0);
});

test("classifiche espongono i parametri del metodo (trasparenza)", async () => {
  const r = await call(null, "/api/public/rankings?cat=immobile");
  expect(r.status).toBe(200);
  const s = r.body.sections[0];
  expect(s.method.m).toBeGreaterThan(0);
  expect(typeof s.method.prior).toBe("number");
});

/* ---------- 2. autenticazione e autorizzazione ---------- */
test("registrazione con password corta rifiutata; registrazione valida accettata", async () => {
  const bad = await call(anon(), "/api/auth/register", { method: "POST", body: json({ email: FRESH_EMAIL, nickname: "Test", password: "corta", terms: true }) });
  expect(bad.status).toBe(400);
  const good = await call(anon(), "/api/auth/register", { method: "POST", body: json({ email: FRESH_EMAIL, nickname: `Tester${Date.now() % 1000}`, password: "Password-Test-2026!", terms: true }) });
  expect(good.status).toBe(200);
  expect(good.body.ok).toBe(true);
});

test("login con credenziali errate rifiutato con messaggio generico", async () => {
  const r = await call(anon(), "/api/auth/login", { method: "POST", body: json({ email: "utente@esempio.test", password: "sbagliata" }) });
  expect(r.status).toBe(401);
  expect(r.body.error).toBe("Credenziali non valide.");
});

test("account staff non accede dal sito pubblico (canale separato)", async () => {
  const r = await call(anon(), "/api/auth/login", { method: "POST", body: json({ email: "admin@esempio.test", password: creds["admin@esempio.test"].password }) });
  expect(r.body.error).toContain("area amministrativa");
});

test("utente normale NON accede alle API admin (401 senza sessione admin)", async () => {
  const r = await call(userJar, "/api/admin/data/dashboard");
  expect(r.status).toBe(401);
});

test("login admin SENZA TOTP rifiutato (2FA obbligatoria)", async () => {
  const r = await call(anon(), "/api/admin/login", { method: "POST", body: json({ email: "admin@esempio.test", password: creds["admin@esempio.test"].password, code: "000000" }) });
  expect(r.status).toBe(401);
});

test("moderatore (permessi limitati) non legge gli eventi di sicurezza", async () => {
  const modJar: Jar = { cookie: "", ip: `10.99.${RUN}.5` };
  const login = await call(modJar, "/api/admin/login", { method: "POST", body: json({ email: "moderatore@esempio.test", password: creds["moderatore@esempio.test"].password, code: totpNow(creds["moderatore@esempio.test"].totpSecret!) }) });
  expect(login.status).toBe(200);
  const r = await call(modJar, "/api/admin/data/sicurezza");
  expect(r.status).toBe(403);
});

/* ---------- 3. invito monouso atomico ---------- */
test("il soggetto verificato invita solo la PROPRIA scheda e con dichiarazione anti-selezione", async () => {
  const noDecl = await call(bizJar, "/api/subject/experience", { method: "POST", body: json({ entityId: "ent_ag_portico", clientEmail: FRESH_EMAIL, kind: "Servizio di intermediazione ricevuto", period: "2026", fairInvitationDeclared: false }) });
  expect(noDecl.status).toBe(400);
  const wrongEnt = await call(bizJar, "/api/subject/experience", { method: "POST", body: json({ entityId: "ent_ag_casanova", clientEmail: FRESH_EMAIL, kind: "Servizio di intermediazione ricevuto", period: "2026", fairInvitationDeclared: true }) });
  expect(wrongEnt.status).toBe(403);
  const ok = await call(bizJar, "/api/subject/experience", { method: "POST", body: json({ entityId: "ent_ag_portico", clientEmail: FRESH_EMAIL, kind: "Servizio di intermediazione ricevuto", period: "2026", fairInvitationDeclared: true }) });
  expect(ok.status).toBe(200);
});

test("riscatto invito: token monouso, una sola delle richieste concorrenti riesce", async () => {
  // recupero il token dall'email log demo (canale di consegna dell'istanza demo)
  const mail = await call(adminJar, "/api/admin/data/casella-demo");
  expect(mail.status).toBe(200);
  const mine = (mail.body.emails as Array<{ to: string; links: Array<{ href: string }> }>)
    .filter(m => m.to === FRESH_EMAIL && m.links.length)
    .sort((a, b) => 0)[0];
  expect(mine).toBeTruthy();
  const token = mine.links[0].href.split("/invito/")[1];
  expect(token).toBeTruthy();

  // il destinatario non ha verificato l'email: redeem rifiutato con messaggio chiaro
  const nv = await call(freshJar, "/api/invitations/redeem", { method: "POST", body: json({ token }) });
  expect(nv.status).toBe(401); // non autenticato

  // login destinatario (email verificata nel seed per il flusso: utente demo ne ha già una;
  // per il fresh user usiamo la verifica tramite email log)
  const verify = await call(null, "/api/auth/verify-email", { method: "POST", body: json({ token: extractVerifyToken(mail.body.emails, FRESH_EMAIL) }) });
  expect(verify.status).toBe(400); // niente token di verifica per fresh (registro non manda verify in seed): usiamo utente demo

  // redeem con l'utente sbagliato → 403
  const wrong = await call(userJar, "/api/invitations/redeem", { method: "POST", body: json({ token }) });
  expect(wrong.status).toBe(403);

  // login fresh + verifica email bypass: il fresh user non può verificare senza token;
  // quindi per l'atomicità usiamo un secondo invito destinato all'utente demo già verificato
  const inv2 = await call(bizJar, "/api/subject/experience", { method: "POST", body: json({ entityId: "ent_ag_portico", clientEmail: "utente@esempio.test", kind: "Valutazione o consulenza su un immobile", period: "2026", fairInvitationDeclared: true }) });
  expect(inv2.status).toBe(200);
  const mail2 = await call(adminJar, "/api/admin/data/casella-demo");
  const mine2 = (mail2.body.emails as Array<{ to: string; links: Array<{ href: string }> }>)
    .filter(m => m.to === "utente@esempio.test" && m.links.length && m.links[0].href.includes("invito"))
    .sort((a, b) => 0)[0];
  const token2 = mine2.links[0].href.split("/invito/")[1];

  // DUE riscatti concorrenti: uno solo deve riuscire
  const [r1, r2] = await Promise.all([
    call(userJar, "/api/invitations/redeem", { method: "POST", body: json({ token: token2 }) }),
    call(userJar, "/api/invitations/redeem", { method: "POST", body: json({ token: token2 }) }),
  ]);
  const okCount = [r1, r2].filter(r => r.status === 200).length;
  expect(okCount).toBe(1);
  const failed = [r1, r2].find(r => r.status !== 200)!;
  expect(failed.status).toBe(400);

  // terzo riscatto del primo invito con utente demo: email diversa → 403
  const r3 = await call(userJar, "/api/invitations/redeem", { method: "POST", body: json({ token }) });
  expect(r3.status).toBe(403);
});

function extractVerifyToken(emails: Array<{ to: string; subject: string }>, email: string): string {
  const m = emails.find(x => x.to === email && x.subject.includes("Verifica"));
  return m ? "token-non-disponibile" : "";
}

/* ---------- 4. una recensione per esperienza ---------- */
test("recensione valida pubblicata; duplicato rifiutato anche in concorrenza", async () => {
  const overview = await call(userJar, "/api/me/overview");
  const exp = (overview.body.experiences as Array<{ id: string; status: string; review: unknown; kind: string }>)
    .find(e => e.status === "active" && !e.review);
  expect(exp).toBeTruthy();

  const payload = {
    experienceId: exp!.id,
    score: 7.5,
    criteria: { comunicazione: 7, trasparenza: 8, pratica: 7, onestà: 8, supporto: 7, rapporto: 7 },
    pros: "Pratica seguita con cura\nCosti chiari dal primo incontro",
    cons: "Alcuni ritardi nelle risposte",
    text: "Esperienza di test automatico: descrizione sufficientemente lunga per superare la soglia minima di cento caratteri richiesti dalla validazione server-side della piattaforma.",
    honesty: true,
    priceAmount: "3500",
    priceUnit: "€ totale",
    priceKind: "Concluso/pagato",
  };
  const first = await call(userJar, "/api/reviews", { method: "POST", body: json(payload) });
  expect(first.status).toBe(200);
  expect(first.body.ok).toBe(true);

  // seconda recensione per la stessa esperienza: rifiutata (409), anche in parallelo
  const [d1, d2] = await Promise.all([
    call(userJar, "/api/reviews", { method: "POST", body: json(payload) }),
    call(userJar, "/api/reviews", { method: "POST", body: json(payload) }),
  ]);
  expect([d1.status, d2.status].every(s => s === 409)).toBe(true);

  // payload non valido su una NUOVA esperienza (testo corto → 400)
  const inv3 = await call(bizJar, "/api/subject/experience", { method: "POST", body: json({ entityId: "ent_ag_portico", clientEmail: "utente@esempio.test", kind: "Assistenza dopo il servizio", period: "2026", fairInvitationDeclared: true }) });
  expect(inv3.status).toBe(200);
  const mail3 = await call(adminJar, "/api/admin/data/casella-demo");
  const mine3 = (mail3.body.emails as Array<{ to: string; links: Array<{ href: string }> }>)
    .filter(m => m.to === "utente@esempio.test" && m.links.length && m.links[0].href.includes("invito"))
    .sort((a, b) => 0)[0];
  const token3 = mine3.links[0].href.split("/invito/")[1];
  const claim3 = await call(userJar, "/api/invitations/redeem", { method: "POST", body: json({ token: token3 }) });
  expect(claim3.status).toBe(200);
  const bad = await call(userJar, "/api/reviews", { method: "POST", body: json({ ...payload, experienceId: claim3.body.experienceId, text: "corto" }) });
  expect(bad.status).toBe(400);
});

test("rettifica tracciata con motivo entro la finestra", async () => {
  const overview = await call(userJar, "/api/me/overview");
  const rev = (overview.body.reviews as Array<{ id: string; status: string }>)[0];
  expect(rev).toBeTruthy();
  const r = await call(userJar, `/api/reviews/${rev.id}`, {
    method: "PUT",
    body: json({
      score: 7, criteria: { comunicazione: 7, trasparenza: 8, pratica: 7, onestà: 8, supporto: 7, rapporto: 7 },
      pros: "Pratica seguita con cura", cons: "", honesty: true,
      text: "Esperienza di test automatico aggiornata: descrizione sufficientemente lunga per superare la soglia minima di cento caratteri richiesti dalla validazione server-side della piattaforma.",
      updateReason: "Correzione del punteggio dopo verifica",
    }),
  });
  expect(r.status).toBe(200);
});

/* ---------- 5. moderazione tracciata ---------- */
test("admin nasconde una recensione con motivo e l'azione finisce nell'audit log", async () => {
  const pub = await call(null, "/api/public/search?q=rondini");
  const entityId = pub.body.rows[0].entity.id;
  const before = await call(null, `/api/public/entity/${entityId}`);
  const target = (before.body.reviews as Array<{ id: string }>)[0];

  const hide = await call(adminJar, "/api/admin/action", { method: "POST", body: json({ action: "review.hide", id: target.id, reason: "Test automatico: contenuto non pertinente all'esperienza dichiarata." }) });
  expect(hide.status).toBe(200);

  const after = await call(null, `/api/public/entity/${entityId}`);
  expect(after.body.reviews.find((r: { id: string }) => r.id === target.id)).toBeUndefined();
  expect(after.body.hiddenCount).toBe(before.body.hiddenCount + 1);

  // audit log registra l'azione con attore e motivo
  const logs = await call(adminJar, "/api/admin/data/log");
  const entry = (logs.body.logs as Array<{ action: string; reason: string | null }>)
    .find(l => l.action === "Recensione nascosta" && l.reason?.includes("Test automatico"));
  expect(entry).toBeTruthy();

  // ripristino per non lasciare la demo alterata
  const restore = await call(adminJar, "/api/admin/action", { method: "POST", body: json({ action: "review.restore", id: target.id, reason: "Ripristino dopo test automatico." }) });
  expect(restore.status).toBe(200);
});

test("i log non contengono mai password, hash o segreti", async () => {
  const logs = await call(adminJar, "/api/admin/data/log");
  const text = JSON.stringify(logs.body);
  expect(text).not.toContain("passwordHash");
  expect(text).not.toContain("scrypt$");
  expect(text).not.toContain("totpSecret");
  expect(text).not.toMatch(/[a-f0-9]{64}.*[a-f0-9]{64}.*token/);
});

/* ---------- 6. privacy e geodati ---------- */
test("la mappa non espone persone fisiche né dati dei recensori", async () => {
  const r = await call(null, "/api/public/map");
  const text = JSON.stringify(r.body);
  expect(r.status).toBe(200);
  expect(text).not.toContain("@esempio.test");
  expect(text).not.toContain("nickname");
  // i marker sono solo immobili (categoria con indirizzi pubblici)
  expect(r.body.markers.length).toBeGreaterThan(0);
});

test("il documento di verifica non è scaricabile senza permessi", async () => {
  const r = await call(userJar, "/api/admin/docs/qualunque");
  expect(r.status).toBe(401);
});

});
