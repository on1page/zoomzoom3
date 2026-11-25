// Collaudo offline della geometria della mappa: validazione dei layer
// (filtri + espressioni data-driven) con lo style-spec di MapLibre, prove
// del modulo di normalizzazione/alias dei nomi italiani e dei FILTRI PER
// CRITERIO (formula della media ponderata + espressioni colore generate).
// Uso: bun scripts/test-mappa-maptiler.ts
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { normName, regionCanonical, tilerProvinceOf, TILER_PROVINCE, REGIONI_ISTAT } from "../src/lib/map-italy";
import { critAggregate, criterionShortLabel, scoreBandColor, type CritMap } from "../src/lib/map-criteria";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
  if (cond) pass++; else fail++;
};

/* ---- 1) validazione style-spec dei layer come saranno inviati a MapLibre ---- */
const provinceMatchPairs: Array<string> = ["Torino", "#2C6E49", "Milano", "#C9A227"];
const maskFilter = ["all", ["==", ["get", "level"], 0], ["!=", ["get", "iso_a2"], "IT"]];
const provinceFilter = ["all", ["==", ["get", "level"], 1], ["==", ["get", "iso_a2"], "IT"]];
const layers: Array<Record<string, unknown>> = [
  {
    id: "zz-mask", type: "fill", source: "countries", "source-layer": "administrative",
    filter: maskFilter, paint: { "fill-color": "#1B2A38", "fill-opacity": 0.62 },
  },
  {
    id: "zz-italy-border", type: "line", source: "countries", "source-layer": "administrative",
    filter: ["all", ["==", ["get", "level"], 0], ["==", ["get", "iso_a2"], "IT"]],
    paint: { "line-color": "#274B6D", "line-width": 1.8, "line-blur": 2, "line-opacity": 0.9 },
  },
  {
    id: "zz-province-fill", type: "fill", source: "countries", "source-layer": "administrative",
    minzoom: 5.9, maxzoom: 9.6, filter: provinceFilter,
    paint: { "fill-color": ["match", ["get", "name"], ...provinceMatchPairs, "rgba(0,0,0,0)"], "fill-opacity": 0.55 },
  },
  {
    id: "zz-regioni-fill", type: "fill", source: "regioni", maxzoom: 6.5,
    paint: { "fill-color": ["match", ["get", "n"], "lombardia", "#2C6E49", "piemonte", "#C9A227", "rgba(0,0,0,0)"], "fill-opacity": 0.55 },
  },
  {
    id: "zz-comuni-fill", type: "fill", source: "comuni", minzoom: 8.4,
    paint: { "fill-color": ["match", ["get", "n"], "milano", "#C07A2D", "rgba(0,0,0,0)"], "fill-opacity": 0.5 },
  },
  {
    id: "zz-props", type: "circle", source: "props", minzoom: 6,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["+", 5, ["min", 4, ["get", "n"]]], 10, ["+", 8, ["min", 7, ["get", "n"]]]],
      "circle-color": ["case", [">=", ["coalesce", ["get", "mean"], -1], 0],
        ["step", ["coalesce", ["get", "mean"], 0], "#A63A2B", 4, "#C07A2D", 6, "#C9A227", 8, "#2C6E49"], "#9AA4AE"],
      "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
    },
  },
  {
    id: "zz-zone-areas-line-off", type: "line", source: "zone-areas",
    filter: ["get", "suppressed"],
    paint: { "line-color": "#8B95A0", "line-width": 1.2, "line-opacity": 0.6, "line-dasharray": [3, 2] },
  },
];
const style = {
  version: 8,
  sources: {
    countries: { type: "vector", tiles: ["https://esempio.test/{z}/{x}/{y}.pbf"] },
    regioni: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    comuni: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    props: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    "zone-areas": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
  layers: layers as never,
};
const errors = validateStyleMin(style as never);
check("style-spec: tutti i layer/filtri/espressioni sono validi", errors.length === 0,
  errors.length ? JSON.stringify(errors.slice(0, 3)) : "");

/* ---- 1b) coropleti con FILTRO PER CRITERIO attivo: l'espressione match
   viene generata da map.tsx con critAggregate → scoreBandColor: le righe
   senza dati per i criteri scelti restano fuori (area neutra) ---- */
const critRows: Array<{ name: string; mean: number; n: number; criteria?: CritMap }> = [
  { name: "Lombardia", mean: 7.8, n: 46, criteria: { servizi: [8.1, 12], trasporti: [8.6, 12], sicurezza: [7.7, 12], verde: [7.6, 12], costi: [6.2, 12] } },
  { name: "Campania", mean: 6.6, n: 21, criteria: { servizi: [6.0, 9], trasporti: [5.7, 9], sicurezza: [5.2, 9], verde: [6.7, 9], costi: [7.0, 9] } },
  { name: "Veneto", mean: 7.2, n: 8 }, // criteri sotto soglia: nessun colore
];
const critPairs: Array<string> = [];
for (const row of critRows) {
  const v = critAggregate(row.criteria, ["sicurezza", "verde"]);
  if (v) critPairs.push(normName(row.name), scoreBandColor(v.mean));
}
const styleFiltro = {
  version: 8,
  sources: { regioni: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
  layers: [{
    id: "zz-regioni-fill", type: "fill", source: "regioni", maxzoom: 6.5,
    paint: { "fill-color": ["match", ["get", "n"], ...critPairs, "rgba(0,0,0,0)"], "fill-opacity": 0.55 },
  }] as never,
};
const errFiltro = validateStyleMin(styleFiltro as never);
check("style-spec: coropleti con filtro criterio validi (aree senza voti escluse)",
  errFiltro.length === 0 && critPairs.length === 4,
  errFiltro.length ? JSON.stringify(errFiltro.slice(0, 3)) : `coppie generate: ${critPairs.length / 2}`);

/* ---- 2) normalizzazione e alias dei nomi ---- */
check("normName: accenti, apostrofi, trattini", normName("Forlì-Cesena") === "forli cesena" && normName("L'Aquila") === "l aquila");
check("normName: maiuscole e spazi multipli", normName("  Reggio  nell'Emilia ") === "reggio nell emilia");

// regioni: varianti Nominatim → nome canonico del GeoJSON ISTAT
check("regione: Valle d'Aosta (varianti)", regionCanonical("Valle d'Aosta") === REGIONI_ISTAT[18]
  && regionCanonical("Vallee d'Aoste") === REGIONI_ISTAT[18] && regionCanonical("Aosta") === REGIONI_ISTAT[18]);
check("regione: Trentino-Alto Adige (varianti)", regionCanonical("Trentino-Alto Adige") === REGIONI_ISTAT[16]
  && regionCanonical("Trentino-Alto Adige/Sudtirol") === REGIONI_ISTAT[16] && regionCanonical("Alto Adige") === REGIONI_ISTAT[16]);
check("regione: Emilia-Romagna", regionCanonical("Emilia-Romagna") === "Emilia-Romagna" && regionCanonical("emilia romagna") === "Emilia-Romagna");
check("regione: nome non valido → null", regionCanonical("") === null && regionCanonical("Toscana1") === null);

// province: nomi d'uso → nome ESATTO del tileset Countries (level 1 IT)
check("provincia: Torino → Turin (nome inglese nel tileset)", tilerProvinceOf("Torino") === "Turin");
check("provincia: Bolzano → Bozen", tilerProvinceOf("Bolzano") === "Bozen");
check("provincia: Aosta → Aoste", tilerProvinceOf("Aosta") === "Aoste");
check("provincia: Valle d'Aosta → Aoste", tilerProvinceOf("Valle d'Aosta") === "Aoste");
check("provincia: Crotone → Crotene (refuso nei dati MapTiler)", tilerProvinceOf("Crotone") === "Crotene");
check("provincia: Oristano → Oristrano (refuso nei dati MapTiler)", tilerProvinceOf("Oristano") === "Oristrano");
check("provincia: Reggio nell'Emilia → Reggio Emilia", tilerProvinceOf("Reggio nell'Emilia") === "Reggio Emilia");
check("provincia: prefissi Nominatim", tilerProvinceOf("Città metropolitana di Milano") === "Milano"
  && tilerProvinceOf("Provincia di Treviso") === "Treviso" && tilerProvinceOf("Città metropolitana di Roma Capitale") === "Roma");
check("provincia: Massa → Massa-Carrara", tilerProvinceOf("Massa") === "Massa-Carrara");
check("provincia: L'Aquila e La Spezia invariate", tilerProvinceOf("L'Aquila") === "L'Aquila" && tilerProvinceOf("La Spezia") === "La Spezia");
check("provincia: Monza e Brianza / Pesaro e Urbino", tilerProvinceOf("Monza e Brianza") === "Monza e Brianza" && tilerProvinceOf("Pesaro e Urbino") === "Pesaro e Urbino");
check("provincia: Sud Sardegna → null (assente nel tileset)", tilerProvinceOf("Sud Sardegna") === null);
check("provincia: nome assurdo → null", tilerProvinceOf("Pippo") === null);

// le 110 province del tileset sono tutte traducibili in se stesse
check("provincia: tutte le 110 del tileset risolvono", TILER_PROVINCE.every(p => tilerProvinceOf(p) === p));

// le regioni del GeoJSON locale sono tutte riconosciute
const fs = await import("node:fs");
const gj = JSON.parse(fs.readFileSync("public/regioni-italia.geojson", "utf8"));
check("regioni geojson: 20 feature, tutte con nome riconosciuto",
  gj.features.length === 20 && gj.features.every((f: { properties: { nome: string } }) => regionCanonical(f.properties.nome) === f.properties.nome));

/* ---- 3) filtri per criterio: formula, gestione dati mancanti, etichette ---- */
check("criteri: selezione vuota → complessivo (critAggregate null)", critAggregate(critRows[0].criteria, []) === null);
check("criteri: nessun dato per criterio → null", critAggregate(undefined, ["servizi"]) === null && critAggregate({}, ["servizi"]) === null);
const vSing = critAggregate(critRows[0].criteria, ["sicurezza"]);
check("criteri: criterio singolo → la sua media (7,7 · 12 voti)",
  !!vSing && Math.abs(vSing.mean - 7.7) < 1e-9 && vSing.n === 12 && !vSing.multi);
const CM: CritMap = { a: [8, 4], b: [6, 2] };
const vPond = critAggregate(CM, ["a", "b"]);
check("criteri: media ponderata per voti ((8·4+6·2)/6 = 7,33)",
  !!vPond && Math.abs(vPond.mean - 44 / 6) < 1e-9 && vPond.multi);
const vParz = critAggregate(CM, ["a", "inesistente"]);
check("criteri: chiavi senza dati ignorate (restano solo i voti presenti)",
  !!vParz && Math.abs(vParz.mean - 8) < 1e-9 && vParz.n === 4 && !vParz.multi);
const vMulti = critAggregate(critRows[1].criteria, ["sicurezza", "verde"]);
check("criteri: due criteri insieme (Campania (5,2·9+6,7·9)/18 = 5,95)",
  !!vMulti && Math.abs(vMulti.mean - (5.2 * 9 + 6.7 * 9) / 18) < 1e-9 && vMulti.multi);
const vFuori = critAggregate(critRows[2].criteria, ["servizi"]);
check("criteri: riga senza criteri pubblicati → nessun colore", vFuori === null);
check("criteri: fascia colore invariata (6–8 giallo, 4–6 arancio)",
  scoreBandColor(7.7) === "#C9A227" && scoreBandColor(5.95) === "#C07A2D" && scoreBandColor(null) === "#9AA4AE");
check("criteri: etichette corte dei criteri zona",
  criterionShortLabel("servizi", "Servizi alla persona e vivibilità") === "Servizi"
  && criterionShortLabel("verde", "Verde, aria e ambiente") === "Verde e aria"
  && criterionShortLabel("costi", "Costi della vita nella zona") === "Costi della vita");
const lblLunga = criterionShortLabel("criterio_nuovo", "Criterio aggiunto dal back office");
check("criteri: chiave ignota → etichetta completa tagliata", lblLunga.startsWith("Criterio aggiunto") && lblLunga.endsWith("…"));

console.log(`\nRIEPILOGO: ${pass}/${pass + fail} controlli superati`);
if (fail) process.exit(1);
