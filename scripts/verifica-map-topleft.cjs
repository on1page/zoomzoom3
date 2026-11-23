// Verifica geometrica del fix .map-topleft: la barra Criterio deve stare
// SOTTO il pannello ricerca (nessuna sovrapposizione) a ogni larghezza,
// e il pannello ricerca non deve uscire dal viewport.
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch();
  let tuttoOk = true;
  for (const w of [1440, 1100, 900, 780, 600, 420, 360]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.goto("http://localhost:3000/#/mappa", { waitUntil: "networkidle" });
    await page.waitForSelector(".map-crit", { timeout: 20000 });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const loc = document.querySelector(".map-loc").getBoundingClientRect();
      const crit = document.querySelector(".map-crit").getBoundingClientRect();
      return { loc: { top: loc.top, bottom: loc.bottom, left: loc.left, right: loc.right },
               crit: { top: crit.top, bottom: crit.bottom, left: crit.left, right: crit.right },
               vw: window.innerWidth };
    });
    const sovrapposti = m.crit.top < m.loc.bottom - 1;
    const fuori = m.loc.right > m.vw + 1 || m.crit.right > m.vw + 1;
    const gap = Math.round(m.crit.top - m.loc.bottom);
    const stato = sovrapposti || fuori ? "PROBLEMA" : "OK";
    if (stato === "PROBLEMA") tuttoOk = false;
    console.log(`${String(w).padStart(4)}px  ${stato}  ricerca y=${Math.round(m.loc.top)}–${Math.round(m.loc.bottom)}  criterio y=${Math.round(m.crit.top)}–${Math.round(m.crit.bottom)}  gap=${gap}px  ${sovrapposti ? "SOVRAPPOSTI" : ""}${fuori ? " FUORI SCHERMO" : ""}`);
    await page.close();
  }
  await browser.close();
  console.log(tuttoOk ? "\nVERIFICA SUPERATA: nessuna sovrapposizione a nessuna larghezza" : "\nVERIFICA FALLITA");
  process.exit(tuttoOk ? 0 : 1);
})();
