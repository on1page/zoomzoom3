// Collaudo offline della geometria della mappa: validazione dei layer
// (filtri + espressioni data-driven) con lo style-spec di MapLibre e prove
// del modulo di normalizzazione/alias dei nomi italiani.
// Uso: bun scripts/test-mappa-maptiler.ts
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { normName, regionCanonical, tilerProvinceOf, TILER_PROVINCE, REGIONI_ISTAT } from "../src/lib/map-italy";

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

console.log(`\nRIEPILOGO: ${pass}/${pass + fail} controlli superati`);
if (fail) process.exit(1);
