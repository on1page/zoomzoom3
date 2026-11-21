"use client";
// ZoomZoom — mappa reale del territorio italiano (Leaflet + cartografia
// OpenStreetMap): pan e zoom nativi, pin per le città con aggregati,
// punti per gli immobili, città di riferimento salvata come preferenza
// tecnica, GPS solo su richiesta esplicita (le coordinate servono al
// momento e vengono scartate).
// Privacy: punti solo per immobili; zone solo con aggregati sopra soglia;
// mai persone geolocalizzate, mai dati di autori o date.
import { useCallback, useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, fmt1 } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { navigate } from "@/lib/client/router";

type MapData = {
  demoMode: boolean;
  notice: string;
  zones: Array<{
    id: string; name: string; lat: number; lng: number; radiusM: number;
    aggregate: { mean: number; n: number; sufficient: boolean } | null;
    suppressed: boolean; entityId: string | null;
  }>;
  markers: Array<{
    id: string; name: string; lat: number; lng: number; zoneId: string | null;
    mean: number | null; n: number; isDemo: boolean;
  }>;
  thresholds: { mapMinAggregate: number; minReviews: number };
};

export function scoreBandColor(v: number | null): string {
  if (v == null) return "#9AA4AE";
  if (v >= 8) return "#2C6E49";
  if (v >= 6) return "#C9A227";
  if (v >= 4) return "#C07A2D";
  return "#A63A2B";
}

// Estensione dell'Italia continentale e insulare (Sicilia, Sardegna e isole
// minori comprese): è la vista di insieme iniziale della mappa.
const ITALY: LeafletNS.LatLngBoundsExpression = [[35.3, 6.6], [47.1, 18.6]];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function MapViewport({ mode = "immobili", activeZone }: { mode?: "immobili" | "zone"; activeZone?: string }) {
  const { myZone, setMyZone, toast } = useApp();
  const [data, setData] = useState<MapData | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const LRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const zonesLayerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const markersLayerRef = useRef<LeafletNS.LayerGroup | null>(null);
  // valori correnti per i ridisegni e i callback Leaflet (niente closure stantie)
  const live = useRef<{ data: MapData | null; mode: string; activeZone?: string; myZone: string | null }>({ data: null, mode, activeZone, myZone });

  useEffect(() => {
    void api<MapData>("/api/public/map").then(res => { if (res.ok) setData(res); });
  }, []);

  const redraw = useCallback(() => {
    const L = LRef.current;
    const lgZones = zonesLayerRef.current, lgMarkers = markersLayerRef.current;
    const map = mapRef.current;
    const d = live.current.data;
    if (!L || !lgZones || !lgMarkers || !map || !d) return;
    lgZones.clearLayers();
    lgMarkers.clearLayers();
    const az = live.current.activeZone, mz = live.current.myZone, md = live.current.mode;
    // a livello Italia (zoom basso) i pin diventano compatti: solo nome città,
    // per evitare sovrapposizioni tra città vicine (es. Milano, Torino, Genova)
    const zoom = map.getZoom();
    const compact = zoom < 7;
    // a livello cittadino (zoom alto) la chip della città si nasconde: restano
    // il punto colorato e l'area, così i punti immobile restano visibili e
    // cliccabili (il nome della città è già nella cartografia di base)
    const chipHidden = zoom >= 10;
    // i punti immobile sono attivi solo a zoom ravvicinato: a livello nazionale
    // restano sotto i pin delle città; appaiono ingrandendo la mappa
    const showProps = md !== "zone" && zoom >= 6;
    // etichettatura anti-collisione a zoom nazionale: le città troppo vicine a
    // una già etichettata mostrano solo il punto (il nome resta nel tooltip)
    let labeledIds: Set<string> | null = null;
    if (compact) {
      labeledIds = new Set<string>();
      const placed: Array<{ x: number; y: number }> = [];
      const byReviews = [...d.zones].sort((a, b) => (b.aggregate?.n ?? -1) - (a.aggregate?.n ?? -1));
      for (const z of byReviews) {
        const pt = map.latLngToContainerPoint([z.lat, z.lng]);
        // la chip misura ~96×22px sopra il punto: collide se i punti sono vicini
        // sia in orizzontale (larghezza chip) sia in verticale (altezza chip)
        const collides = placed.some(p => Math.abs(p.x - pt.x) < 98 && Math.abs(p.y - pt.y) < 26);
        if (!collides) { placed.push({ x: pt.x, y: pt.y }); labeledIds.add(z.id); }
      }
    }

    for (const z of d.zones) {
      const color = z.aggregate ? scoreBandColor(z.aggregate.mean) : "#9AA4AE";
      const isActive = az === z.id, isMine = mz === z.id;
      // area della città (decorativa: non intercetta i clic)
      L.circle([z.lat, z.lng], {
        radius: z.radiusM,
        color: isActive ? "#33658A" : color,
        weight: isActive ? 3 : isMine ? 2.4 : 1.4,
        opacity: isActive || isMine ? 0.95 : 0.55,
        fillColor: color,
        fillOpacity: z.aggregate ? 0.16 : 0.05,
        dashArray: z.suppressed ? "5 5" : undefined,
        interactive: false,
      }).addTo(lgZones);
      // pin: nome città + punteggio aggregato (o nota di soppressione)
      const scoreHtml = z.aggregate
        ? `${fmt1(z.aggregate.mean)}/10 · ${z.aggregate.n}`
        : `<span class="zz-muted">${z.suppressed ? "aggregati sospesi" : "n. d."}</span>`;
      const dotOnly = chipHidden || (compact && !labeledIds!.has(z.id));
      const icon = L.divIcon({
        className: "zz-zone-pin-wrap",
        html: `<div class="zz-zone-pin${compact ? " compact" : ""}${dotOnly ? " dotonly" : ""}${isActive ? " active" : ""}${isMine ? " mine" : ""}" style="--pin:${color}">
          <span class="zz-pin-chip">
            <span class="zz-pin-name">${esc(z.name)}</span>
            <span class="zz-pin-score">${scoreHtml}</span>
          </span>
          <span class="zz-pin-dot"></span>
        </div>`,
        iconSize: dotOnly ? [18, 18] : compact ? [104, 36] : [160, 52],
        iconAnchor: dotOnly ? [9, 9] : compact ? [52, 34] : [80, 50],
      });
      if (z.entityId) {
        L.marker([z.lat, z.lng], { icon, title: z.name, alt: `Città ${z.name}` })
          .on("click", () => { navigate(`#/zona/${z.entityId}`); })
          .addTo(lgZones);
      } else {
        L.marker([z.lat, z.lng], { icon, interactive: false }).addTo(lgZones);
      }
    }

    if (showProps) {
      for (const mk of d.markers) {
        const city = d.zones.find(z => z.id === mk.zoneId)?.name || "";
        const dot = L.circleMarker([mk.lat, mk.lng], {
          radius: 10 + Math.min(7, mk.n),
          color: "#fff", weight: 2,
          fillColor: scoreBandColor(mk.mean), fillOpacity: 0.96,
        });
        dot.bindPopup(
          `<div class="zz-pop">
            <strong>${esc(mk.name)}</strong>${mk.isDemo ? ' <span class="badge-demo">Dato fittizio</span>' : ""}
            <div class="zz-pop-sub">Immobile${city ? ` · ${esc(city)}` : ""}</div>
            <div class="zz-pop-score" style="color:${scoreBandColor(mk.mean)}">
              ${mk.mean == null ? "Nessuna recensione" : `${fmt1(mk.mean)}/10 · ${mk.n} ${mk.n === 1 ? "recensione" : "recensioni"}`}
            </div>
            <a href="#/scheda/${esc(mk.id)}" class="zz-pop-link">Apri la scheda</a>
          </div>`,
          { className: "zz-popup", autoPan: true, closeButton: true },
        );
        dot.addTo(lgMarkers);
      }
    }
  }, []);

  // inizializzazione Leaflet (una sola volta, all'arrivo dei dati).
  // Il modulo viene importato qui, lato client: a livello di modulo toccherebbe
  // `window` e romperebbe il prerender server-side.
  useEffect(() => {
    if (!data || !holderRef.current || mapRef.current) return;
    const holder = holderRef.current;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    void (async () => {
      const mod = await import("leaflet");
      const L = ((mod as unknown as { default?: typeof LeafletNS }).default) ?? mod;
      if (disposed || !holderRef.current) return;
      LRef.current = L;
      const map = L.map(holder, { zoomControl: false, scrollWheelZoom: true, zoomSnap: 0.5, zoomDelta: 0.5 });
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      }).addTo(map);
      L.control.zoom({ position: "topright" }).addTo(map);
      L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
      map.fitBounds(ITALY, { padding: [14, 14] });
      zonesLayerRef.current = L.layerGroup().addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);
      // i pin si adattano allo zoom (compatto a livello Italia)
      map.on("zoomend", () => redraw());
      // vista iniziale: zona attiva (pagina di zona) o città di riferimento
      const initial = activeZone || myZone;
      if (initial && data.zones.some(z => z.id === initial)) {
        const z = data.zones.find(zz => zz.id === initial)!;
        map.setView([z.lat, z.lng], 12, { animate: false });
      }
      redraw();
      // tiene la mappa allineata quando il contenitore cambia dimensione
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(holder);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      zonesLayerRef.current = null;
      markersLayerRef.current = null;
      LRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ridisegno quando cambiano dati, modalità, zona attiva o città di riferimento
  useEffect(() => {
    live.current = { data, mode, activeZone, myZone };
    redraw();
  }, [data, mode, activeZone, myZone, redraw]);

  const focusZone = useCallback((zoneId: string, animate = true) => {
    const map = mapRef.current;
    const z = live.current.data?.zones.find(zz => zz.id === zoneId);
    if (!map || !z) return;
    if (animate) map.flyTo([z.lat, z.lng], 12, { duration: 0.9 });
    else map.setView([z.lat, z.lng], 12, { animate: false });
  }, []);
  const italyView = useCallback(() => {
    mapRef.current?.fitBounds(ITALY, { padding: [14, 14] });
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
        let best: MapData["zones"][0] | null = null, bd = Infinity;
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
      aria-label="Mappa reale del territorio italiano (cartografia OpenStreetMap). Trascina per esplorare, usa la rotella o i pulsanti per lo zoom. I pin delle città aprono la loro scheda, i punti immobile aprono una scheda sintetica.">
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
        <button type="button" onClick={italyView} title="Torna alla vista dell'Italia intera">Vista Italia</button>
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
      <span className="small muted">Clicca una città o un punto immobile · i punti immobile compaiono a zoom ravvicinato · Cartografia © OpenStreetMap</span>
    </div>
  );
}
