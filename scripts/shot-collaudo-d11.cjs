// Screenshot di collaudo dei percorsi ② e ③ del modello D11: ricerca senza
// risultati (CTA indagine professionale), modulo indagine, abbonamento,
// richieste del richiedente (bacheca/causale/scaduta), bacheca del consulente,
// consegna con termine, scheda con indagine certificata (K7), scheda del
// consulente con feedback di serietà, back office (abbonamenti, perizie,
// impostazioni con i piani).
// Uso: node work/d11-percorsi/scripts/shot-collaudo-d11.cjs <rich> <cons> <admin> <entK7> <entCons>
const { chromium } = require("playwright-core");

const CHROME = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const T_RICH = process.argv[2];
const T_CONS = process.argv[3];
const T_ADMIN = process.argv[4];
const ENT_K7 = process.argv[5];
const ENT_CONS = process.argv[6];
const OUT = "/home/z/my-project/work/d11-percorsi/anteprime";
const BASE = "http://localhost:3000";

async function refuseCookies(page) {
  const refuse = page.locator("button", { hasText: /Rifiuta i non essenziali/i });
  if (await refuse.count()) { await refuse.first().click().catch(() => {}); await page.waitForTimeout(400); }
}

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });

  /* ---- sito pubblico (senza accesso): ricerca senza risultati + indagine ---- */
  const anon = await browser.newContext({ viewport: { width: 1280, height: 1150 } });
  const a = await anon.newPage();
  await a.goto(`${BASE}/#/cerca?q=Zzqqvvww99`, { waitUntil: "networkidle" });
  await a.waitForTimeout(1800);
  await refuseCookies(a);
  await a.screenshot({ path: `${OUT}/01-ricerca-senza-risultati.png` });
  await a.goto(`${BASE}/#/indagine?addr=Via%20Inesistente%2099`, { waitUntil: "networkidle" });
  await a.waitForTimeout(1200);
  await a.screenshot({ path: `${OUT}/02-indagine-accesso.png` });
  await anon.close();

  /* ---- richiedente: modulo indagine + abbonamento + richieste ---- */
  const pub = await browser.newContext({ viewport: { width: 1280, height: 1250 } });
  await pub.addCookies([{ name: "zz_session", value: T_RICH, url: BASE }]);
  const p = await pub.newPage();

  await p.goto(`${BASE}/#/indagine?addr=Via%20Inesistente%2099`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1300);
  await refuseCookies(p);
  await p.screenshot({ path: `${OUT}/03-indagine-modulo.png` });

  await p.goto(`${BASE}/#/abbonamento`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1300);
  // apre «I tuoi ordini»: la causale del bonifico deve vedersi
  const detOrdini = p.locator("details", { hasText: "I tuoi ordini" }).first();
  if (await detOrdini.count()) await detOrdini.evaluate(el => (el.open = true));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/04-abbonamento.png` });

  await p.goto(`${BASE}/#/consulente-richieste`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  // inquadra la richiesta scaduta (con Riproponi) e quella accettata (causale)
  const scaduta = p.locator("article.card", { hasText: "Scaduta in bacheca" }).first();
  if (await scaduta.count()) {
    await scaduta.scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -420));
    await p.waitForTimeout(400);
  }
  await p.screenshot({ path: `${OUT}/05-richieste-richiedente.png` });

  // profilo: storico concessioni con origine «acquisto»
  await p.goto(`${BASE}/#/profilo`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1300);
  const premCard = p.locator(".premium-card").first();
  if (await premCard.count()) {
    await premCard.scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -180));
    const det = premCard.locator("details").first();
    if (await det.count()) await det.evaluate(el => (el.open = true));
    await p.waitForTimeout(400);
  }
  await p.screenshot({ path: `${OUT}/06-profilo-premium.png` });
  await pub.close();

  /* ---- consulente: bacheca di zona + consegna con termine ---- */
  const ctxCons = await browser.newContext({ viewport: { width: 1280, height: 1250 } });
  await ctxCons.addCookies([{ name: "zz_session", value: T_CONS, url: BASE }]);
  const c = await ctxCons.newPage();
  await c.goto(`${BASE}/#/consulente`, { waitUntil: "networkidle" });
  await c.waitForTimeout(1800);
  const bacheca = c.locator("h2", { hasText: "Bacheca di zona" });
  if (await bacheca.count()) {
    await bacheca.first().scrollIntoViewIfNeeded();
    await c.evaluate(() => window.scrollBy(0, -80));
    await c.waitForTimeout(400);
  }
  await refuseCookies(c);
  await c.screenshot({ path: `${OUT}/07-bacheca-consulente.png` });
  const consegna = c.locator("article.card", { hasText: "Consegna la relazione" }).first();
  if (await consegna.count()) {
    await consegna.scrollIntoViewIfNeeded();
    await c.evaluate(() => window.scrollBy(0, -60));
    await c.waitForTimeout(400);
  }
  await c.screenshot({ path: `${OUT}/08-consegna-termine.png` });
  await ctxCons.close();

  /* ---- schede pubbliche: indagine certificata (K7) + serietà del consulente ---- */
  const pub2 = await browser.newContext({ viewport: { width: 1280, height: 1150 } });
  const s = await pub2.newPage();
  await s.goto(`${BASE}/#/scheda/${ENT_K7}`, { waitUntil: "networkidle" });
  await s.waitForTimeout(1500);
  const cert = s.locator("h2", { hasText: "Indagine professionale certificata" });
  if (await cert.count()) {
    await cert.first().scrollIntoViewIfNeeded();
    await s.evaluate(() => window.scrollBy(0, -110));
    await s.waitForTimeout(400);
  }
  await refuseCookies(s);
  await s.screenshot({ path: `${OUT}/09-scheda-indagine-certificata.png` });
  await s.goto(`${BASE}/#/scheda/${ENT_CONS}`, { waitUntil: "networkidle" });
  await s.waitForTimeout(1500);
  await s.evaluate(() => window.scrollTo(0, 0));
  await s.waitForTimeout(300);
  await s.screenshot({ path: `${OUT}/10-scheda-consulente-serieta.png` });
  await pub2.close();

  /* ---- back office: abbonamenti, perizie, impostazioni ---- */
  const adm = await browser.newContext({ viewport: { width: 1280, height: 1250 } });
  await adm.addCookies([{ name: "zz_admin_session", value: T_ADMIN, url: BASE }]);
  const ap = await adm.newPage();

  await ap.goto(`${BASE}/#/admin/abbonamenti`, { waitUntil: "networkidle" });
  await ap.waitForTimeout(2000);
  await ap.screenshot({ path: `${OUT}/11-back-office-abbonamenti.png` });

  await ap.goto(`${BASE}/#/admin/perizie`, { waitUntil: "networkidle" });
  await ap.waitForTimeout(2000);
  await ap.screenshot({ path: `${OUT}/12-back-office-perizie.png` });

  await ap.goto(`${BASE}/#/admin/impostazioni`, { waitUntil: "networkidle" });
  await ap.waitForTimeout(1800);
  const piani = ap.locator("label", { hasText: "Piani in vendita" });
  if (await piani.count()) {
    await piani.first().scrollIntoViewIfNeeded();
    await ap.evaluate(() => window.scrollBy(0, -260));
    await ap.waitForTimeout(400);
  }
  await ap.screenshot({ path: `${OUT}/13-back-office-impostazioni-piani.png` });
  await adm.close();

  await browser.close();
  console.log("Screenshot completati in", OUT);
})();
