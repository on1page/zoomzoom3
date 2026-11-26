// Screenshot di collaudo dei percorsi semplici: piè di pagina con il richiamo
// ai consulenti, profilo con la card consulente chiusa in fondo, scheda
// amministratore con i condomini che amministra, scheda condominio con
// «amministrato da», offerta post-pubblicazione «due righe
// sull'amministratore», mini-modulo, conferma scheda con il campo unico
// (indirizzo completo e variante con il numero mancante).
// Uso: node work/percorsi-schede-collegate/scripts/shot-collaudo-percorsi.cjs <t1> <t2> <admin> <cond1>
const { chromium } = require("playwright-core");

const CHROME = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const T1 = process.argv[2];
const T2 = process.argv[3];
const ADMIN = process.argv[4];
const COND1 = process.argv[5];
const OUT = "/home/z/my-project/work/percorsi-schede-collegate/anteprime";
const BASE = "http://localhost:3000";

async function refuseCookies(page) {
  const refuse = page.locator("button", { hasText: /Rifiuta i non essenziali/i });
  if (await refuse.count()) { await refuse.first().click().catch(() => {}); await page.waitForTimeout(400); }
}

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });

  /* ---- anonimo: piè di pagina ---- */
  const anon = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const a = await anon.newPage();
  await a.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
  await a.waitForTimeout(1500);
  await refuseCookies(a);
  await a.locator("footer .footer-grid").scrollIntoViewIfNeeded().catch(() => {});
  await a.waitForTimeout(400);
  await a.screenshot({ path: `${OUT}/01-footer-consulente.png` });
  await anon.close();

  /* ---- utente: profilo, schede collegate, offerta, campo unico ---- */
  const pub = await browser.newContext({ viewport: { width: 1280, height: 1150 } });
  await pub.addCookies([{ name: "zz_session", value: T1, url: BASE }]);
  const p = await pub.newPage();

  // profilo: card consulente in fondo, chiusa
  await p.goto(`${BASE}/#/profilo`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1600);
  await refuseCookies(p);
  await p.locator("footer .footer-grid").scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/02-profilo-consulente-in-fondo.png` });

  // scheda amministratore: condomini che amministra
  await p.goto(`${BASE}/#/scheda/${ADMIN}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/03-scheda-amministratore-condomini.png` });

  // scheda condominio: amministrato da
  await p.goto(`${BASE}/#/scheda/${COND1}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/04-scheda-condominio-amministrato.png` });

  // campo unico: passo 2 con ricerca dell'indirizzo completo
  await p.goto(`${BASE}/#/recensione`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1400);
  await p.locator("button.card-click", { hasText: /Un immobile|Appartamento o casa/i }).first().click();
  await p.waitForTimeout(700);
  await p.locator("input[aria-label='Cerca luogo o scheda']").fill("Via dei Mille 15 Milano");
  await p.waitForTimeout(2600); // debounce + geocoder nazionale
  const primaGeo = p.locator(".pick-card", { hasText: /Mille/i }).first();
  await primaGeo.click().catch(async () => {
    // se i suggerimenti non si sono aperti da soli, preme Cerca
    await p.locator("button[type=submit]", { hasText: /Cerca/i }).first().click();
    await p.waitForTimeout(2200);
    await p.locator(".pick-card", { hasText: /Mille/i }).first().click();
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/05-campo-unico-conferma.png` });

  // campo unico: via senza numero → ripiego «manca il numero»
  // (prima si torna alla home: stesso hash = nessun remont della vista)
  await p.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await p.goto(`${BASE}/#/recensione`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1400);
  await p.locator("button.card-click", { hasText: /Un immobile|Appartamento o casa/i }).first().click();
  await p.waitForTimeout(700);
  await p.locator("input[aria-label='Cerca luogo o scheda']").fill("Via dei Mille Milano");
  await p.waitForTimeout(2600);
  await p.locator(".pick-card", { hasText: /Mille/i }).first().click().catch(async () => {
    await p.locator("button[type=submit]", { hasText: /Cerca/i }).first().click();
    await p.waitForTimeout(2200);
    await p.locator(".pick-card", { hasText: /Mille/i }).first().click();
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/06-campo-unico-numero-mancante.png` });
  await pub.close();

  /* ---- secondo utente: offerta post-pubblicazione ---- */
  const pub2 = await browser.newContext({ viewport: { width: 1280, height: 1150 } });
  await pub2.addCookies([{ name: "zz_session", value: T2, url: BASE }]);
  const q = await pub2.newPage();
  await q.goto(`${BASE}/#/recensione?entity=${COND1}`, { waitUntil: "networkidle" });
  await q.waitForTimeout(1800);
  await refuseCookies(q);
  // compila il modulo: pregi, testo e dichiarazione (il resto va bene com'è)
  await q.locator("#rv-pros").fill("posizione comoda ai servizi");
  await q.locator("#rv-cons").fill("facciata da rinfrescare");
  await q.locator("#rv-text").fill("Appartamento in ordine e silenzioso, con un balcone ampio e una scala curata. La caldaia è recente e le bollette sono nella norma. Nel complesso una residenza tranquilla e ben tenuta.");
  await q.locator("label.checkline", { hasText: /Dichiarazione/i }).locator("input").first().check();
  await q.locator("button[type=submit]", { hasText: /Pubblica l/i }).first().click();
  await q.waitForTimeout(2400);
  await q.screenshot({ path: `${OUT}/07-offerta-due-righe.png` });
  await q.locator("button", { hasText: /due righe sull/i }).first().click();
  await q.waitForTimeout(900);
  await q.screenshot({ path: `${OUT}/08-mini-modulo-amministratore.png` });
  await pub2.close();

  await browser.close();
  console.log("Anteprime salvate in " + OUT);
})();
