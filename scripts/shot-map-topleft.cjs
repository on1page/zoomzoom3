// Cattura screenshots della mappa con il fix .map-topleft (controlli impilati).
// Uso il progetto sandbox (stesso map.tsx e stesse regole CSS della patch,
// database demo con zone e recensioni). La cartografia è il ripiego OSM
// (in sandbox non c'è la chiave MapTiler) ma i CONTROLLI sono ciò che conta.
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch();
  const shots = [
    { w: 1440, h: 900, name: "mappa-controlli-1440.png", label: "desktop" },
    { w: 780, h: 900, name: "mappa-controlli-780.png", label: "tablet" },
    { w: 420, h: 860, name: "mappa-controlli-420.png", label: "mobile" },
  ];
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
    await page.goto("http://localhost:3000/#/mappa", { waitUntil: "networkidle" });
    // attende il tile della mappa e i controlli
    await page.waitForSelector(".map-crit", { timeout: 20000 });
    await page.waitForTimeout(2500);
    // ritaglio della zona superiore sinistra (controlli) + un po' di mappa
    await page.screenshot({ path: `/home/z/my-project/download/zoomzoom-fix-mappa-profilo/anteprime/${s.name}` });
    console.log(`OK ${s.label}: ${s.name}`);
    await page.close();
  }
  await browser.close();
})();
