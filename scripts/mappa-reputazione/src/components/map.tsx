"use client";
// ZoomZoom — mappa delle reputazioni del territorio italiano (MapLibre GL +
// cartografia MapTiler OMT minimale): la reputazione si legge a prima vista.
//
//   BASEMAP    stile MapTiler "backdrop" (OpenMapTiles, minimale); senza la
//              chiave NEXT_PUBLIC_MAPTILER_KEY ripiega sui tile raster
//              pubblici di OpenStreetMap (la mappa resta pienamente usabile).
//   MASCHERA   tutto ciò che è fuori dall'Italia viene oscurato: livello di
//              poligoni dei Paesi (tileset Countries di MapTiler, layer
//              "administrative", level 0) filtrato ESCLUDENDO l'Italia, con
//              riempimento scuro semitrasparente — l'approccio di
//              mascheratura descritto nella guida MapTiler. Il confine
//              nazionale è evidenziato da una linea luminosa.
//   COROPLETI  il colore è la reputazione aggregata (media delle recensioni
//              presenti, con soglia minima di pubblicazione):
//     - vista Italia  → REGIONI (confini ISTAT in GeoJSON locale: il tileset
//       Countries per l'Italia non contiene le regioni);
//     - zoom intermedio → PROVINCE (tileset Countries, level 1 per IT);
//     - zoom ravvicinato / città cercata → COMUNI del catalogo (contorni
//       caricati on demand dal geocoder pubblico tramite il nostro proxy).
//   PIN E PUNTI pin delle città con aggregato della scheda città; a zoom
//              ravvicinato punti immobile cliccabili con popup.
// Privacy: punti solo per immobili; zone solo con aggregati sopra soglia;
// mai persone geolocalizzate, mai dati di autori o date; GPS solo su
// richiesta esplicita (le coordinate servono al momento e vengono scartate).
import { useCallback, useEffect, useRef, useState } from "react";
import type * as MapLibreNS from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, fmt1 } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { navigate } from "@/lib/client/router";
import { normName, regionCanonical, tilerProvinceOf } from "@/lib/map-italy";

type AdminRow = { name: string; mean: number; n: number };
type ZoneRow = {
  id: string; name: string; province: string | null; region: string | null;
  lat: number; lng: number; radiusM: number;
  aggregate: { mean: number; n: number; sufficient: boolean } | null;
  // reputazione del COMUNE: tutte le schede della zona (per il coropleto)
  place: { mean: number; n: number } | null;
  suppressed: boolean; entityId: string | null;
};
type MapData = {
  demoMode: boolean;
  notice: string;
  zones: ZoneRow[];
  markers: Array<{
    id: string; name: string; lat: number; lng: number; zoneId: string | null;
    mean: number | null; n: number; isDemo: boolean;
  }>;
  admin: { regions: AdminRow[]; provinces: AdminRow[] };
  thresholds: { mapMinAggregate: number; minReviews: number };
};

export function scoreBandColor(v: number | null): string {
  if (v == null) return "#9AA4AE";
  if (v >= 8) return "#2C6E49";
  if (v >= 6) return "#C9A227";
  if (v >= 4) return "#C07A2D";
  return "#A63A2B";
}

// chiave e stile MapTiler (OMT minimale): senza chiave si usa OSM raster
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";
const MAPTILER_STYLE = process.env.NEXT_PUBLIC_MAPTILER_STYLE || "backdrop-light";
const COUNTRIES_TILES = `https://api.maptiler.com/tiles/countries/tiles.json?key=${MAPTILER_KEY}`;
const MAPTILER_STYLE_URL = `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${MAPTILER_KEY}`;

// worker di MapLibre servito dal progetto: con i bundler (Next/Turbopack)
// l'URL derivato da import.meta.url non è raggiungibile, quindi lo si
// espone da /public e lo si dichiara una volta per tutte
const MAPLIBRE_WORKER_URL = "/maplibre-gl-worker.mjs";
function setupMapLibre(ML: typeof MapLibreNS): void {
  try { ML.setWorkerUrl(MAPLIBRE_WORKER_URL); } catch { /* già impostato */ }
}

// estensione dell'Italia (Sicilia, Sardegna e isole minori comprese):
// è la vista di insieme iniziale della mappa
const ITALY: MapLibreNS.LngLatBoundsLike = [[6.6, 35.3], [18.6, 47.1]];

// soglie di zoom dei livelli amministrativi (il colore segue la reputazione)
const Z_REGIONE_MAX = 6.5;   // fino a qui: coropleto delle regioni
const Z_PROVINCIA_MIN = 5.9; // da qui: province del tileset Countries
const Z_PROVINCIA_MAX = 9.6;
const Z_COMUNE_FETCH = 8.8;  // da qui si chiedono i contorni dei comuni
const Z_COMUNE_MIN = 8.4;    // il livello comunale è disegnato da qui

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Cerchio geodetico approssimato (WGS84) intorno a un centro: serve per
 *  l'area indicativa della città, come faceva L.circle di Leaflet. */
function circlePolygon(lat: number, lng: number, radiusM: number, segments = 48): GeoJSON.Polygon {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Ripiego senza chiave MapTiler: tile raster pubblici OpenStreetMap. */
function osmRasterStyle(): MapLibreNS.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}

export function MapViewport({ mode = "immobili", activeZone }: { mode?: "immobili" | "zone"; activeZone?: string }) {
  const { myZone, setMyZone, toast } = useApp();
  const [data, setData] = useState<MapData | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const MLRef = useRef<typeof MapLibreNS | null>(null);
  const mapRef = useRef<MapLibreNS.Map | null>(null);
  const markersRef = useRef<Array<MapLibreNS.Marker>>([]);
  const regioniRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const comuniFeatRef = useRef<Map<string, GeoJSON.Feature>>(new Map());
  const comuniAskedRef = useRef<Set<string>>(new Set());
  // valori correnti per i ridisegni e i callback (niente closure stantie)
  const live = useRef<{ data: MapData | null; mode: string; activeZone?: string; myZone: string | null }>({ data: null, mode, activeZone, myZone });

  useEffect(() => {
    void api<MapData>("/api/public/map").then(res => { if (res.ok) setData(res); });
  }, []);

  /* ---- espressioni colore dei coropleti (match sui nomi) ---- */

  // regioni: chiave = nome normalizzato (proprietà "n" del GeoJSON ISTAT)
  function regionMatch(): MapLibreNS.ExpressionSpecification | string {
    const d = live.current.data;
    const byNorm = new Map<string, string>();
    for (const r of d?.admin.regions || []) {
      const c = regionCanonical(r.name);
      if (c) byNorm.set(normName(c), scoreBandColor(r.mean));
    }
    const pairs: Array<string> = [];
    for (const f of regioniRef.current?.features || []) {
      const n = String((f.properties as { n?: string } | null)?.n || "");
      const col = byNorm.get(n);
      if (n && col) pairs.push(n, col);
    }
    // match senza coppie non è un'espressione valida: si usa il colore neutro
    return pairs.length
      ? ["match", ["get", "n"], ...pairs, "rgba(0,0,0,0)"] as unknown as MapLibreNS.ExpressionSpecification
      : "rgba(0,0,0,0)";
  }

  // province: chiave = nome ESATTO del poligono nel tileset Countries
  // (level 1 per l'Italia), tradotto dai nomi d'uso italiani
  function provinceMatch(): MapLibreNS.ExpressionSpecification | string {
    const d = live.current.data;
    const pairs: Array<string> = [];
    for (const p of d?.admin.provinces || []) {
      const t = tilerProvinceOf(p.name);
      if (t) pairs.push(t, scoreBandColor(p.mean));
    }
    return pairs.length
      ? ["match", ["get", "name"], ...pairs, "rgba(0,0,0,0)"] as unknown as MapLibreNS.ExpressionSpecification
      : "rgba(0,0,0,0)";
  }

  // comuni: chiave = nome normalizzato del comune (proprietà "n")
  function comuneMatch(): MapLibreNS.ExpressionSpecification | string {
    const d = live.current.data;
    const pairs: Array<string> = [];
    for (const z of d?.zones || []) {
      if (z.place) pairs.push(normName(z.name), scoreBandColor(z.place.mean));
    }
    return pairs.length
      ? ["match", ["get", "n"], ...pairs, "rgba(0,0,0,0)"] as unknown as MapLibreNS.ExpressionSpecification
      : "rgba(0,0,0,0)";
  }

  /* ---- installazione di sorgenti e livelli (idempotente) ---- */
  const installLayers = useCallback(() => {
    const map = mapRef.current;
    const ML = MLRef.current;
    if (!map || !ML || !live.current.data) return;
    // con stile ancora non caricato getStyle() può essere undefined: si
    // riproverà al prossimo evento style.load / cambio dati
    const style = map.getStyle();
    if (!style) return;
    const hasCountries = !!MAPTILER_KEY;
    // i coropleti vanno SOTTO le etichette della cartografia di base
    const symbol = style.layers?.find(l => l.type === "symbol")?.id;

    // sorgenti
    if (!map.getSource("zz-regioni")) {
      map.addSource("zz-regioni", { type: "geojson", data: regioniRef.current || EMPTY_FC });
    } else if (regioniRef.current) {
      (map.getSource("zz-regioni") as MapLibreNS.GeoJSONSource).setData(regioniRef.current);
    }
    if (hasCountries && !map.getSource("zz-countries")) {
      map.addSource("zz-countries", { type: "vector", url: COUNTRIES_TILES });
    }
    if (!map.getSource("zz-zone-areas")) map.addSource("zz-zone-areas", { type: "geojson", data: EMPTY_FC });
    if (!map.getSource("zz-comuni")) map.addSource("zz-comuni", { type: "geojson", data: EMPTY_FC });
    if (!map.getSource("zz-props")) map.addSource("zz-props", { type: "geojson", data: EMPTY_FC });

    // REGIONI — coropleto (vista Italia)
    if (!map.getLayer("zz-regioni-fill")) {
      map.addLayer({
        id: "zz-regioni-fill", type: "fill", source: "zz-regioni",
        maxzoom: Z_REGIONE_MAX,
        paint: { "fill-color": regionMatch(), "fill-opacity": 0.55 },
      }, symbol);
      map.addLayer({
        id: "zz-regioni-line", type: "line", source: "zz-regioni",
        maxzoom: Z_REGIONE_MAX,
        paint: { "line-color": "#ffffff", "line-opacity": 0.45, "line-width": 1.2 },
      }, symbol);
    } else {
      map.setPaintProperty("zz-regioni-fill", "fill-color", regionMatch());
    }

    // PROVINCE — coropleto dal tileset Countries (zoom intermedio)
    if (hasCountries && map.getSource("zz-countries")) {
      if (!map.getLayer("zz-province-fill")) {
        map.addLayer({
          id: "zz-province-fill", type: "fill",
          source: "zz-countries", "source-layer": "administrative",
          minzoom: Z_PROVINCIA_MIN, maxzoom: Z_PROVINCIA_MAX,
          filter: ["all", ["==", ["get", "level"], 1], ["==", ["get", "iso_a2"], "IT"]] as unknown as MapLibreNS.FilterSpecification,
          paint: { "fill-color": provinceMatch(), "fill-opacity": 0.55 },
        }, symbol);
        map.addLayer({
          id: "zz-province-line", type: "line",
          source: "zz-countries", "source-layer": "administrative",
          minzoom: Z_PROVINCIA_MIN, maxzoom: Z_PROVINCIA_MAX,
          filter: ["all", ["==", ["get", "level"], 1], ["==", ["get", "iso_a2"], "IT"]] as unknown as MapLibreNS.FilterSpecification,
          paint: { "line-color": "#ffffff", "line-opacity": 0.4, "line-width": 0.9 },
        }, symbol);
      } else {
        map.setPaintProperty("zz-province-fill", "fill-color", provinceMatch());
      }
    }

    // COMUNI — coropleto dei comuni del catalogo (zoom ravvicinato)
    if (!map.getLayer("zz-comuni-fill")) {
      map.addLayer({
        id: "zz-comuni-fill", type: "fill", source: "zz-comuni",
        minzoom: Z_COMUNE_MIN,
        paint: { "fill-color": comuneMatch(), "fill-opacity": 0.5 },
      }, symbol);
      map.addLayer({
        id: "zz-comuni-line", type: "line", source: "zz-comuni",
        minzoom: Z_COMUNE_MIN,
        paint: { "line-color": "#ffffff", "line-opacity": 0.55, "line-width": 1.4 },
      }, symbol);
    } else {
      map.setPaintProperty("zz-comuni-fill", "fill-color", comuneMatch());
    }

    // AREE CITTÀ (cerchi indicativi, decorativi) + PUNTI IMMOBILE
    if (!map.getLayer("zz-zone-areas-fill")) {
      map.addLayer({
        id: "zz-zone-areas-fill", type: "fill", source: "zz-zone-areas",
        paint: {
          "fill-color": ["get", "color"] as unknown as MapLibreNS.ExpressionSpecification,
          "fill-opacity": ["get", "fillOp"] as unknown as MapLibreNS.ExpressionSpecification,
        },
      }, symbol);
      map.addLayer({
        id: "zz-zone-areas-line", type: "line", source: "zz-zone-areas",
        filter: ["!", ["get", "suppressed"]] as unknown as MapLibreNS.FilterSpecification,
        paint: {
          "line-color": ["get", "lineColor"] as unknown as MapLibreNS.ExpressionSpecification,
          "line-width": ["get", "lineW"] as unknown as MapLibreNS.ExpressionSpecification,
          "line-opacity": ["get", "lineOp"] as unknown as MapLibreNS.ExpressionSpecification,
        },
      }, symbol);
      map.addLayer({
        id: "zz-zone-areas-line-off", type: "line", source: "zz-zone-areas",
        filter: ["get", "suppressed"] as unknown as MapLibreNS.FilterSpecification,
        paint: { "line-color": "#8B95A0", "line-width": 1.2, "line-opacity": 0.6, "line-dasharray": [3, 2] },
      }, symbol);
      map.addLayer({
        id: "zz-props", type: "circle", source: "zz-props",
        minzoom: 6,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, ["+", 5, ["min", 4, ["get", "n"]]],
            10, ["+", 8, ["min", 7, ["get", "n"]]],
          ] as unknown as MapLibreNS.ExpressionSpecification,
          "circle-color": [
            "case", [">=", ["coalesce", ["get", "mean"], -1], 0],
            ["step", ["coalesce", ["get", "mean"], 0], "#A63A2B", 4, "#C07A2D", 6, "#C9A227", 8, "#2C6E49"],
            "#9AA4AE",
          ] as unknown as MapLibreNS.ExpressionSpecification,
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-stroke-opacity": 0.95,
          "circle-opacity": 0.96,
        },
      }, symbol);
    }

    // MASCHERA: fuori dall'Italia tutto scuro (livello PAESI, level 0,
    // escludendo IT) — sopra ogni etichetta estera, come da guida MapTiler
    if (hasCountries && map.getSource("zz-countries")) {
      if (!map.getLayer("zz-mask")) {
        map.addLayer({
          id: "zz-mask", type: "fill",
          source: "zz-countries", "source-layer": "administrative",
          filter: ["all", ["==", ["get", "level"], 0], ["!=", ["get", "iso_a2"], "IT"]] as unknown as MapLibreNS.FilterSpecification,
          paint: { "fill-color": "#1B2A38", "fill-opacity": 0.62 },
        });
        map.addLayer({
          id: "zz-italy-border", type: "line",
          source: "zz-countries", "source-layer": "administrative",
          filter: ["all", ["==", ["get", "level"], 0], ["==", ["get", "iso_a2"], "IT"]] as unknown as MapLibreNS.FilterSpecification,
          paint: { "line-color": "#274B6D", "line-width": 1.8, "line-blur": 2, "line-opacity": 0.9 },
        });
      }
    }
  }, []);

  /* ---- pin delle città, aree, punti: ridisegno a zoom/dati ---- */
  const redraw = useCallback(() => {
    const ML = MLRef.current;
    const map = mapRef.current;
    const d = live.current.data;
    if (!ML || !map || !d || !map.isStyleLoaded()) return;
    const az = live.current.activeZone, mz = live.current.myZone, md = live.current.mode;
    const zoom = map.getZoom();
    // a livello Italia i pin diventano compatti; a zoom cittadino la chip si
    // nasconde (il nome della città è già nella cartografia di base)
    const compact = zoom < 7;
    const chipHidden = zoom >= 10;
    const showProps = md !== "zone" && zoom >= 6;
    // etichettatura anti-collisione a zoom nazionale
    let labeledIds: Set<string> | null = null;
    if (compact) {
      labeledIds = new Set<string>();
      const placed: Array<{ x: number; y: number }> = [];
      const byReviews = [...d.zones].sort((a, b) => (b.place?.n ?? b.aggregate?.n ?? -1) - (a.place?.n ?? a.aggregate?.n ?? -1));
      for (const z of byReviews) {
        const pt = map.project([z.lng, z.lat]);
        const collides = placed.some(p => Math.abs(p.x - pt.x) < 98 && Math.abs(p.y - pt.y) < 26);
        if (!collides) { placed.push({ x: pt.x, y: pt.y }); labeledIds.add(z.id); }
      }
    }

    // marker: si ricostruiscono (sono pochi)
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    for (const z of d.zones) {
      const color = z.aggregate ? scoreBandColor(z.aggregate.mean) : "#9AA4AE";
      const isActive = az === z.id, isMine = mz === z.id;
      const scoreHtml = z.aggregate
        ? `${fmt1(z.aggregate.mean)}/10 · ${z.aggregate.n}`
        : `<span class="zz-muted">${z.suppressed ? "aggregati sospesi" : "n. d."}</span>`;
      const dotOnly = chipHidden || (compact && !labeledIds!.has(z.id));
      const el = document.createElement("div");
      el.className = "zz-zone-pin-wrap";
      el.innerHTML = `<div class="zz-zone-pin${compact ? " compact" : ""}${dotOnly ? " dotonly" : ""}${isActive ? " active" : ""}${isMine ? " mine" : ""}" style="--pin:${color}">
          <span class="zz-pin-chip">
            <span class="zz-pin-name">${esc(z.name)}</span>
            <span class="zz-pin-score">${scoreHtml}</span>
          </span>
          <span class="zz-pin-dot"></span>
        </div>`;
      if (z.entityId) {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => { navigate(`#/zona/${z.entityId}`); });
      }
      const marker = new ML.Marker({ element: el, anchor: dotOnly ? "center" : "bottom" })
        .setLngLat([z.lng, z.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }

    // aree città: cerchi indicativi con le stesse regole di prima
    const areas: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: d.zones.map(z => {
        const color = z.aggregate ? scoreBandColor(z.aggregate.mean) : "#9AA4AE";
        const isActive = az === z.id, isMine = mz === z.id;
        return {
          type: "Feature",
          properties: {
            color, suppressed: z.suppressed && !z.aggregate,
            fillOp: z.aggregate ? 0.14 : 0.05,
            lineColor: isActive ? "#33658A" : color,
            lineW: isActive ? 2.6 : isMine ? 2.1 : 1.2,
            lineOp: isActive || isMine ? 0.9 : 0.5,
          },
          geometry: circlePolygon(z.lat, z.lng, z.radiusM),
        };
      }),
    };
    (map.getSource("zz-zone-areas") as MapLibreNS.GeoJSONSource | undefined)?.setData(areas);

    // punti immobile (solo a zoom ravvicinato, modalità immobili)
    const propsFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: showProps ? d.markers.map(mk => {
        const city = d.zones.find(z => z.id === mk.zoneId)?.name || "";
        return {
          type: "Feature",
          properties: { id: mk.id, name: mk.name, mean: mk.mean, n: mk.n, isDemo: mk.isDemo, city },
          geometry: { type: "Point", coordinates: [mk.lng, mk.lat] },
        };
      }) : [],
    };
    (map.getSource("zz-props") as MapLibreNS.GeoJSONSource | undefined)?.setData(propsFc);
  }, []);

  /* ---- comuni: contorni on demand quando si zooma/cerca ---- */
  const fetchComuni = useCallback(async () => {
    const map = mapRef.current;
    const d = live.current.data;
    if (!map || !d || map.getZoom() < Z_COMUNE_FETCH) return;
    // margine intorno alla vista (~15%): si chiedono i comuni visibili o in
    // arrivo, senza il metodo .pad() che LngLatBounds non ha
    const b = map.getBounds();
    const latSpan = Math.max(0.02, b.getNorth() - b.getSouth());
    const lngSpan = Math.max(0.02, b.getEast() - b.getWest());
    const margin = (v: number) => v * 0.15;
    const inView = (lng: number, lat: number) =>
      lng >= b.getWest() - margin(lngSpan) && lng <= b.getEast() + margin(lngSpan) &&
      lat >= b.getSouth() - margin(latSpan) && lat <= b.getNorth() + margin(latSpan);
    const pending = d.zones
      .filter(z => z.place && !comuniAskedRef.current.has(z.id))
      .filter(z => inView(z.lng, z.lat))
      .slice(0, 6);
    for (const z of pending) {
      comuniAskedRef.current.add(z.id);
      const q = new URLSearchParams({ name: z.name, province: z.province || "", region: z.region || "" });
      const res = await api<{ polygon: { type: string; coordinates: unknown } | null }>(`/api/public/zone-outline?${q.toString()}`);
      if (res.ok && res.polygon) {
        comuniFeatRef.current.set(z.id, {
          type: "Feature",
          properties: { id: z.id, nome: z.name, n: normName(z.name), mean: z.place!.mean, nrev: z.place!.n, entityId: z.entityId },
          geometry: res.polygon as GeoJSON.Geometry,
        });
      }
    }
    if (pending.length) {
      (map.getSource("zz-comuni") as MapLibreNS.GeoJSONSource | undefined)
        ?.setData({ type: "FeatureCollection", features: [...comuniFeatRef.current.values()] });
      // il match dei colori cambia solo se arrivano nuovi comuni
      if (map.getLayer("zz-comuni-fill")) {
        map.setPaintProperty("zz-comuni-fill", "fill-color", comuneMatch());
      }
    }
  }, []);

  // inizializzazione MapLibre (una sola volta, all'arrivo dei dati)
  useEffect(() => {
    if (!data || !holderRef.current || mapRef.current) return;
    const holder = holderRef.current;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let roFit: ResizeObserver | null = null;
    void (async () => {
      const maplibregl = await import("maplibre-gl");
      if (disposed || !holderRef.current) return;
      MLRef.current = maplibregl as unknown as typeof MapLibreNS;
      setupMapLibre(MLRef.current);

      // base: stile MapTiler OMT minimale se c'è la chiave (verificato con
      // una richiesta: chiave errata o stile assente → ripiego OSM raster)
      let style: string | MapLibreNS.StyleSpecification = osmRasterStyle();
      if (MAPTILER_KEY) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 6000);
          const r = await fetch(MAPTILER_STYLE_URL, { signal: ctrl.signal });
          clearTimeout(timer);
          if (!r.ok) throw new Error("stile MapTiler non disponibile");
          style = (await r.json()) as MapLibreNS.StyleSpecification;
        } catch {
          // nessun problema: la mappa funziona con i tile pubblici OSM
        }
      }

      const map = new maplibregl.Map({
        container: holder,
        style,
        // vista di ripiego già sull'Italia: se il contenitore non fosse
        // ancora dimensionato, la mappa non finirebbe mai altrove
        center: [12.5, 42.5],
        zoom: 4.6,
        attributionControl: false,
        maxZoom: 19,
        minZoom: 3.6,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 110 }), "bottom-left");
      map.addControl(new maplibregl.AttributionControl({
        compact: true,
        customAttribution: MAPTILER_KEY
          ? '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
          : undefined,
      }));
      // inquadra l'Italia quando la mappa è davvero pronta (contenitore
      // dimensionato e stile caricato): un fitBounds troppo presto, con il
      // contenitore ancora a zero pixel, porterebbe la camera altrove
      let fitted = false;
      const fitItaly = () => {
        if (fitted || !data) return;
        fitted = true;
        const initial = activeZone || myZone;
        if (initial && data.zones.some(z => z.id === initial)) {
          const z = data.zones.find(zz => zz.id === initial)!;
          map.jumpTo({ center: [z.lng, z.lat], zoom: 12 });
        } else {
          map.fitBounds(ITALY, { padding: 14 });
        }
      };
      map.once("load", () => fitItaly());
      // se il contenitore cambia dimensione prima del load (layout che si
      // assesta), l'inquadratura dell'Italia resta quella giusta
      const roFitLocal = new ResizeObserver(() => { if (!fitted && map.isStyleLoaded()) fitItaly(); });
      roFit = roFitLocal;
      roFitLocal.observe(holder);
      map.on("resize", () => { if (!fitted && map.isStyleLoaded()) fitItaly(); });

      // confini ISTAT delle regioni: GeoJSON locale semplificato (92 KB)
      void fetch("/regioni-italia.geojson").then(r => (r.ok ? r.json() : null)).then((gj: GeoJSON.FeatureCollection | null) => {
        if (!gj || disposed) return;
        regioniRef.current = {
          type: "FeatureCollection",
          features: gj.features.map(f => ({
            type: "Feature",
            properties: { nome: (f.properties as { nome?: string } | null)?.nome || "", n: normName((f.properties as { nome?: string } | null)?.nome) },
            geometry: f.geometry,
          })),
        };
        (map.getSource("zz-regioni") as MapLibreNS.GeoJSONSource | undefined)?.setData(regioniRef.current);
        if (map.getLayer("zz-regioni-fill")) {
          map.setPaintProperty("zz-regioni-fill", "fill-color", regionMatch());
        }
      });

      map.on("style.load", () => { installLayers(); redraw(); });
      map.on("zoomend", () => { redraw(); });
      map.on("moveend", () => { redraw(); void fetchComuni(); });

      // popup dei punti immobile
      map.on("click", "zz-props", e => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { name: string; city: string; mean: number | null; n: number; isDemo: boolean; id: string };
        const mean = p.mean == null ? null : Number(p.mean);
        new maplibregl.Popup({ className: "zz-popup", closeButton: true, maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="zz-pop">
              <strong>${esc(p.name)}</strong>${p.isDemo ? ' <span class="badge-demo">Dato fittizio</span>' : ""}
              <div class="zz-pop-sub">Immobile${p.city ? ` · ${esc(p.city)}` : ""}</div>
              <div class="zz-pop-score" style="color:${scoreBandColor(mean)}">
                ${mean == null ? "Nessuna recensione" : `${fmt1(mean)}/10 · ${p.n} ${p.n === 1 ? "recensione" : "recensioni"}`}
              </div>
              <a href="#/scheda/${esc(p.id)}" class="zz-pop-link">Apri la scheda</a>
            </div>`)
          .addTo(map);
      });
      // popup del comune (livello comunale)
      map.on("click", "zz-comuni-fill", e => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { nome: string; mean: number; nrev: number; entityId: string | null };
        new maplibregl.Popup({ className: "zz-popup", closeButton: true, maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="zz-pop">
              <strong>${esc(p.nome)}</strong>
              <div class="zz-pop-sub">Comune · reputazione del territorio</div>
              <div class="zz-pop-score" style="color:${scoreBandColor(p.mean)}">
                ${fmt1(p.mean)}/10 · ${p.nrev} ${p.nrev === 1 ? "recensione" : "recensioni"}
              </div>
              ${p.entityId ? `<a href="#/zona/${esc(p.entityId)}" class="zz-pop-link">Apri la scheda della città</a>` : ""}
            </div>`)
          .addTo(map);
      });
      for (const layerId of ["zz-props", "zz-comuni-fill"]) {
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      }

      installLayers();
      redraw();
      void fetchComuni();
      // tiene la mappa allineata quando il contenitore cambia dimensione
      ro = new ResizeObserver(() => map.resize());
      ro.observe(holder);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      roFit?.disconnect();
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      MLRef.current = null;
      comuniAskedRef.current = new Set();
      comuniFeatRef.current = new Map();
    };
  }, [data]);

  // ridisegno quando cambiano dati, modalità, zona attiva o città di riferimento
  useEffect(() => {
    live.current = { data, mode, activeZone, myZone };
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded() && map.getStyle()) {
      installLayers();
      redraw();
    }
  }, [data, mode, activeZone, myZone, installLayers, redraw]);

  const focusZone = useCallback((zoneId: string, animate = true) => {
    const map = mapRef.current;
    const z = live.current.data?.zones.find(zz => zz.id === zoneId);
    if (!map || !z) return;
    if (animate) map.flyTo({ center: [z.lng, z.lat], zoom: 12, duration: 0.9 });
    else map.jumpTo({ center: [z.lng, z.lat], zoom: 12 });
  }, []);
  const italyView = useCallback(() => {
    mapRef.current?.fitBounds(ITALY, { padding: 14 });
  }, []);

  const useGps = () => {
    if (!navigator.geolocation || !data) {
      toast("Geolocalizzazione non disponibile in questo browser: scegli la città dall'elenco.", "err");
      return;
    }
    toast("Rilevo la posizione… le coordinate servono solo al momento e non vengono salvate.");
    navigator.geolocation.getCurrentPosition(
      pos => {
        // città coperta più vicina (distanza locale approssimata)
        const R = 6371, rad = Math.PI / 180;
        const m = Math.cos(pos.coords.latitude * rad);
        let best: MapData["zones"][number] | null = null, bd = Infinity;
        for (const z of data.zones) {
          const dLat = (z.lat - pos.coords.latitude) * rad;
          const dLng = (z.lng - pos.coords.longitude) * rad;
          const d = R * Math.sqrt(dLat * dLat + (dLng * m) * (dLng * m));
          if (d < bd) { bd = d; best = z; }
        }
        if (best) {
          setMyZone(best.id);
          focusZone(best.id, true);
          toast(`Città di riferimento: ${best.name}. Coordinate scartate.`);
        }
      },
      err => {
        const why = err.code === 1 ? "autorizzazione negata" : err.code === 2 ? "posizione non disponibile" : "tempo scaduto";
        toast(`GPS non utilizzabile (${why}): scegli la città dall'elenco.`, "err");
      },
      { timeout: 8000, maximumAge: 600000, enableHighAccuracy: false }
    );
  };

  if (!data) {
    return (
      <div className="map-viewport" role="application" aria-label="Mappa in caricamento">
        <p className="map-loading">Caricamento della mappa…</p>
      </div>
    );
  }

  return (
    <div className="map-viewport" role="application"
      aria-label="Mappa delle reputazioni del territorio italiano (cartografia MapTiler/OpenStreetMap). Trascina per esplorare, usa la rotella o i pulsanti per lo zoom. A livello nazionale le regioni sono colorate per reputazione; zoomando passano province e comuni. I pin delle città aprono la loro scheda, i punti immobile aprono una scheda sintetica.">
      <div className="map-holder" ref={holderRef}></div>
      <div className="map-loc">
        <span aria-hidden="true">◎</span>
        <select className="map-zone-select" aria-label="La tua città di riferimento"
          value={myZone || ""}
          onChange={e => {
            const zid = e.target.value || null;
            setMyZone(zid);
            if (zid) {
              focusZone(zid, true);
              toast("Città di riferimento: " + (data.zones.find(z => z.id === zid)?.name || "") + ". Preferenza salvata solo su questo dispositivo.");
            } else {
              italyView();
              toast("Città di riferimento rimossa.");
            }
          }}>
          <option value="">La tua città…</option>
          {data.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <button className="btn btn-ghost btn-xs" onClick={useGps}
          title="Usa la mia posizione: le coordinate servono solo al momento e non vengono salvate">GPS</button>
      </div>
      <div className="map-italy-btn">
        <button type="button" onClick={italyView} title="Torna alla vista dell'Italia intera: regioni colorate per reputazione">Vista Italia</button>
      </div>
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="map-legend">
      <span className="leg-dot" style={{ background: scoreBandColor(9) }}></span> 8–10 ottimo
      <span className="leg-dot" style={{ background: scoreBandColor(7) }}></span> 6–8 discreto
      <span className="leg-dot" style={{ background: scoreBandColor(5) }}></span> 4–6 criticità
      <span className="leg-dot" style={{ background: scoreBandColor(2) }}></span> 0–4 gravi criticità
      <span className="small muted">Vista Italia: regioni colorate per reputazione · zoomando: province e comuni · fuori dall&apos;Italia oscurato · Cartografia © MapTiler, © OpenStreetMap contributors</span>
    </div>
  );
}
