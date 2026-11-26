// Screenshot di collaudo del riconoscimento di utilità: scheda pubblica
// (voti, chip, ordinamento), profilo (riconoscimenti + ricorsi), pagina
// «Come funziona» (trasparenza) e back office (ricalcolo + ricorsi).
// Uso: dev server attivo su :3000 + token stampati da mk-sessioni-collaudo.ts
const { chromium } = require("playwright-core");

const CHROME = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";

const PUBLIC_TOKEN = process.argv[2];
const ADMIN_TOKEN = process.argv[3];
const ENTITY_ID = process.argv[4] || "ent_i_rondini";
const OUT = "/home/z/my-project/work/qualita-utilita/anteprime";

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });

  /* ---- sito pubblico, utente Premium di collaudo ---- */
  const pub = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  await pub.addCookies([{ name: "zz_session", value: PUBLIC_TOKEN, url: "http://localhost:3000" }]);
  const page = await pub.newPage();

  // scheda con indagini votate: barra voti, chip, selettore ordinamento
  await page.goto(`http://localhost:3000/#/scheda/${ENTITY_ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".review", { timeout: 20000 });
  await page.waitForTimeout(1200);
  // chiude il banner cookie per non coprire barra voti e chip
  const refuse = page.locator("button", { hasText: /Rifiuta i non essenziali/i });
  if (await refuse.count()) { await refuse.first().click(); await page.waitForTimeout(600); }
  // attiva l'ordinamento «più utili» per mostrare il vantaggio di evidenza
  const sel = page.locator("#ordina-indagini");
  if (await sel.count()) await sel.selectOption("useful");
  await page.waitForTimeout(600);
  // inquadra la prima recensione completa: barra voti + chip sotto il testo
  const chips = page.locator(".utility-chips").first();
  if (await chips.count()) {
    await chips.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -560));
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/01-scheda-indagini-utili.png` });

  // profilo: riconoscimenti della community + ricorso
  await page.goto("http://localhost:3000/#/profilo", { waitUntil: "networkidle" });
  await page.waitForSelector(".premium-card, .card", { timeout: 20000 });
  await page.waitForTimeout(1200);
  const recCard = page.locator(".card", { hasText: "Riconoscimenti della community" });
  if (await recCard.count()) {
    await recCard.first().scrollIntoViewIfNeeded();
    // apre il pannello del ricorso
    const det = recCard.locator("details").first();
    if (await det.count()) await det.evaluate(el => (el.open = true));
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/02-profilo-riconoscimenti.png` });

  // come funziona: sezione trasparenza del riconoscimento
  await page.goto("http://localhost:3000/#/come-funziona", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const h = page.locator("h2", { hasText: "Community: i voti di utilità" });
  if (await h.count()) {
    await h.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/03-come-funziona-trasparenza.png` });
  await pub.close();

  /* ---- back office ---- */
  const adm = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  await adm.addCookies([{ name: "zz_admin_session", value: ADMIN_TOKEN, url: "http://localhost:3000" }]);
  const apage = await adm.newPage();
  await apage.goto("http://localhost:3000/#/admin/utilita", { waitUntil: "networkidle" });
  await apage.waitForTimeout(1800);
  await apage.screenshot({ path: `${OUT}/04-back-office-utilita.png` });
  await adm.close();

  await browser.close();
  console.log("Screenshot completati in", OUT);
})();
