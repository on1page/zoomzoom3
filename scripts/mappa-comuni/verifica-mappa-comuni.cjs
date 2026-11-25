// Collaudo della suddivisione comunale della mappa (mappa-comuni) — v3.
// Uso: NODE_PATH=/home/z/.npm-global/lib/node_modules node verifica-mappa-comuni.cjs
// Richiede il dev server su http://localhost:3000 (npm run dev).
//
// Novità della v3: i click sono GEO-DETERMINISTICI — si legge la barra
// della scala di MapLibre (metri per pixel) e si calcola il pixel esatto
// di una coordinata nota (es. il centro di Monza), così il test non dipende
// dallo zoom effettivo né dalla dimensione del contenitore.
const { chromium } = require("playwright");

const OUT = "/home/z/my-project/scripts/mappa-comuni/anteprime";
const BASE = "http://localhost:3000";
const esiti = [];
function log(oggetto, ok, dettaglio) {
  esiti.push({ oggetto, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${oggetto}${dettaglio ? ` — ${dettaglio}` : ""}`);
}

// coordinate note (WGS84)
const MILANO = [9.1900, 45.4643];
const MONZA = [9.2742, 45.5845];
const REGGIO = [15.6497, 38.1104];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const fileComuni = [];
  const erroriRete = [];
  page.on("response", r => {
    const u = r.url();
    if (u.includes("/comuni/r")) fileComuni.push(`${u.split("/").pop()}→${r.status()}`);
    if (r.status() >= 400) erroriRete.push(`${r.status()} ${u.replace(BASE, "")}`);
  });
  const erroriConsole = [];
  page.on("pageerror", e => erroriConsole.push(String(e)));

  const urlOra = () => page.url().replace(BASE, "");
  const testoPopup = async () => {
    const p = page.locator(".maplibregl-popup");
    const n = await p.count();
    if (!n) return "(nessun popup)";
    const testi = [];
    for (let i = 0; i < n; i++) testi.push((await p.nth(i).innerText()).replace(/\s+/g, " ").trim());
    return `${n} popup: [${testi.join(" || ")}]`;
  };
  const chiudiPopup = async () => {
    await page.evaluate(() => document.querySelectorAll(".maplibregl-popup").forEach(e => e.remove()));
    await page.waitForTimeout(250);
  };
  /** metri per pixel letti dalla barra della scala di MapLibre */
  const mPerPx = async () => {
    const el = page.locator(".maplibregl-ctrl-scale");
    const txt = (await el.innerText()).trim();
    const w = (await el.boundingBox()).width;
    const m = parseFloat(txt) * (txt.includes("km") ? 1000 : 1);
    return m / w;
  };
  /** click sul pixel che corrisponde a una coordinata nota, dato il centro
   *  corrente della mappa (coordinate della zona selezionata) */
  const clickGeo = async (centro, lng, lat) => {
    const h = await page.locator(".map-holder").boundingBox();
    const mpp = await mPerPx();
    const px = h.x + h.width / 2 + ((lng - centro[0]) * 78720) / mpp;
    const py = h.y + h.height / 2 - ((lat - centro[1]) * 111132) / mpp;
    if (px < h.x + 8 || px > h.x + h.width - 8 || py < h.y + 8 || py > h.y + h.height - 8) {
      console.log(`   (punto (${lng}, ${lat}) fuori vista: pixel ${Math.round(px)}, ${Math.round(py)})`);
      return false;
    }
    await page.mouse.click(px, py);
    await page.waitForTimeout(1000);
    return true;
  };
  const zoomOut = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.click(".maplibregl-ctrl-zoom-out");
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1200);
  };
  const attendiComuni = (regione) =>
    page.waitForResponse(r => r.url().endsWith(`/comuni/${regione}.geojson`), { timeout: 20000 }).catch(() => null);

  await page.goto(`${BASE}/#/mappa`, { waitUntil: "networkidle" });
  await page.waitForSelector(".map-crit", { timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/01-vista-italia.png` });
  console.log(`-- URL: ${urlOra()}`);
  log("vista Italia caricata", true);

  // --- Milano z12 ---
  const r3 = attendiComuni("r3");
  await page.selectOption(".map-zone-select", { label: "Milano" });
  await r3;
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/02-milano-z12-comuni.png` });
  console.log(`-- URL: ${urlOra()} | scala: ${(await mPerPx()).toFixed(1)} m/px | file: ${fileComuni.join(", ")}`);
  log("file comuni Lombardia scaricato", fileComuni.some(f => f.startsWith("r3.geojson→2")));

  // popup del comune nel catalogo: click ~1,5 km a est del centro (Milano)
  await clickGeo(MILANO, 9.214, 45.4643);
  const pop1 = await testoPopup();
  console.log(`-- popup1: ${pop1}`);
  log("popup Milano (catalogo, media+link)", /\/10/.test(pop1) && /recension/i.test(pop1), pop1);
  await page.screenshot({ path: `${OUT}/03-popup-milano.png` });
  await chiudiPopup();

  // zoom out ×2 → Monza visibile: popup del comune FUORI catalogo
  await zoomOut(2);
  await page.screenshot({ path: `${OUT}/04-z10-area-metropolitana.png` });
  const clickOk = await clickGeo(MILANO, MONZA[0], MONZA[1]);
  const pop2 = await testoPopup();
  console.log(`-- popup2: ${pop2}`);
  log("popup Monza (fuori catalogo)", clickOk && /Nessuna recensione pubblicata/i.test(pop2) && /prima recensione/i.test(pop2), pop2);
  await page.screenshot({ path: `${OUT}/05-popup-monza-fuori-catalogo.png` });
  await chiudiPopup();

  // zoom out ×2 → z~8: mosaico dei comuni della provincia
  await zoomOut(2);
  await page.screenshot({ path: `${OUT}/06-z8-suddivisione-comuni.png` });

  // --- filtro criterio Costi della vita: Milano passa a 5,7 → fascia
  //     4–6 ARANCIONE (complessiva 7,8 → gialla): ridisegno verificabile —
  //     si confronta il blob attorno a Milano prima/dopo il filtro
  const clipBlob = { x: 700, y: 640, width: 90, height: 60 };
  const prima = await page.screenshot({ clip: clipBlob });
  await page.click(".map-crit-chip:has-text('Costi della vita')");
  await page.waitForTimeout(1600);
  const dopo = await page.screenshot({ clip: clipBlob });
  await page.screenshot({ path: `${OUT}/07-criterio-costi.png` });
  log("filtro Costi ridisegna il coropleto", !prima.equals(dopo));
  await page.click(".map-crit-chip:has-text('Costi della vita')");
  await page.waitForTimeout(600);

  // --- alias ISTAT: Reggio Calabria → "Reggio di Calabria" ---
  const r18 = attendiComuni("r18");
  await page.selectOption(".map-zone-select", { label: "Reggio Calabria" });
  await r18;
  await page.waitForTimeout(2500);
  await clickGeo(REGGIO, REGGIO[0] + 0.008, REGGIO[1] + 0.004);
  const pop3 = await testoPopup();
  console.log(`-- popup3: ${pop3}`);
  log("alias Reggio di Calabria agganciato alla zona", /n\. d\.|Apri la scheda della città/i.test(pop3), pop3);
  await page.screenshot({ path: `${OUT}/08-alias-reggio-calabria.png` });
  await chiudiPopup();

  log("nessun errore di rete 4xx/5xx", erroriRete.length === 0, erroriRete.slice(0, 5).join(" ;; "));
  log("nessun errore di pagina", erroriConsole.length === 0, erroriConsole.slice(0, 3).join(" ;; "));

  await browser.close();
  const falliti = esiti.filter(e => !e.ok).length;
  console.log(`\n=== ESITI: ${esiti.length - falliti}/${esiti.length} OK ===`);
  process.exit(falliti ? 1 : 0);
})();
