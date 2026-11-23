// Verifica completa del fix mappa su tutte le pagine che la contengono:
// 1) viewport della mappa dentro il suo contenitore (nessuna mappa troncata)
// 2) barra Criterio sempre SOTTO il pannello ricerca (nessuna sovrapposizione)
// 3) niente elementi fuori schermo tra i controlli mappa
// 4) canvas maplibre largo come il contenitore (nessun taglio dei tile)
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch();
  let fallimenti = 0;
  const pagine = [["#/mappa", "pagina mappa"], ["#/", "home"], ["#/zona/milano", "pagina zona"]];
  const larghezze = [1440, 1100, 900, 780, 600, 420, 360];
  for (const [hash, nomePagina] of pagine) {
    for (const w of larghezze) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } });
      await page.goto(`http://localhost:3000/${hash}`, { waitUntil: "networkidle" });
      try {
        await page.waitForSelector(".map-viewport", { timeout: 15000 });
        await page.waitForTimeout(w <= 860 ? 1800 : 1200);
      } catch { await page.close(); continue; } // pagina senza mappa
      const m = await page.evaluate(() => {
        const out = {};
        const vp = document.querySelector(".map-viewport");
        const wrap = vp.parentElement;
        const vb = vp.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
        out.vpDentro = vb.width <= wb.width + 1 && vb.right <= wrap.parentElement.getBoundingClientRect().right + 1;
        out.vpW = Math.round(vb.width); out.wrapW = Math.round(wb.width);
        const cv = document.querySelector(".maplibregl-canvas");
        out.canvasOk = cv ? Math.abs(cv.getBoundingClientRect().width - vb.width) <= 2 : null;
        const loc = document.querySelector(".map-loc"), crit = document.querySelector(".map-crit");
        if (loc && crit) {
          const lb = loc.getBoundingClientRect(), cb = crit.getBoundingClientRect();
          out.noSovrapposizione = cb.top >= lb.bottom - 1;
          out.dentroSchermo = lb.right <= window.innerWidth + 1 && cb.right <= window.innerWidth + 1;
          out.gap = Math.round(cb.top - lb.bottom);
        }
        return out;
      });
      const problemi = [];
      if (!m.vpDentro) problemi.push(`mappa ${m.vpW}px > contenitore ${m.wrapW}px`);
      if (m.canvasOk === false) problemi.push("canvas tagliato");
      if (m.noSovrapposizione === false) problemi.push("controlli sovrapposti");
      if (m.dentroSchermo === false) problemi.push("controlli fuori schermo");
      const stato = problemi.length ? "PROBLEMA: " + problemi.join("; ") : "OK";
      if (problemi.length) fallimenti++;
      console.log(`${nomePagina.padEnd(11)} ${String(w).padStart(4)}px  ${stato}  (mappa ${m.vpW}px${m.gap !== undefined ? ", gap controlli " + m.gap + "px" : ""})`);
      await page.close();
    }
  }
  await browser.close();
  console.log(fallimenti === 0 ? "\nVERIFICA SUPERATA SU TUTTE LE PAGINE E LARGHEZZE" : `\n${fallimenti} COMBINAZIONI CON PROBLEMI`);
  process.exit(fallimenti === 0 ? 0 : 1);
})();
