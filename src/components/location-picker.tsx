"use client";
// ZoomZoom — selettore posizione su cartografia reale (MapLibre GL +
// MapTiler OMT, come la mappa principale) per l'aggiunta di un immobile:
// clic per piazzare o spostare il pin.
// Il pin è facoltativo: senza posizione la scheda resta recensibile, semplicemente
// non compare tra i punti della mappa. Nessun dato lascia il browser finché il
// modulo non viene inviato (il GPS serve solo al momento e la scelta è dell'utente).
import { useCallback, useEffect, useRef, useState } from "react";
import type * as MapLibreNS from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type LatLng = { lat: number; lng: number };

// chiave e stile MapTiler (OMT minimale), come nella mappa principale:
// senza chiave si usano i tile raster pubblici di OpenStreetMap
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";
const MAPTILER_STYLE = process.env.NEXT_PUBLIC_MAPTILER_STYLE || "backdrop-light";
const MAPTILER_STYLE_URL = `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${MAPTILER_KEY}`;

// worker di MapLibre servito dal progetto (vedi mappa principale)
const MAPLIBRE_WORKER_URL = "/maplibre-gl-worker.mjs";
function setupMapLibre(ML: typeof MapLibreNS): void {
  try { ML.setWorkerUrl(MAPLIBRE_WORKER_URL); } catch { /* già impostato */ }
}

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

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function LocationPicker({ value, onChange, note }: {
  value: LatLng | null;
  onChange: (v: LatLng | null) => void;
  note?: string;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const MLRef = useRef<typeof MapLibreNS | null>(null);
  const mapRef = useRef<MapLibreNS.Map | null>(null);
  const markerRef = useRef<MapLibreNS.Marker | null>(null);
  const live = useRef<{ value: LatLng | null; onChange: (v: LatLng | null) => void }>({ value, onChange });
  const [ready, setReady] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  useEffect(() => { live.current = { value, onChange }; }, [value, onChange]);

  // inizializzazione (una sola volta, lato client come nella mappa principale)
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    void (async () => {
      const maplibregl = await import("maplibre-gl");
      if (disposed || !holderRef.current) return;
      MLRef.current = maplibregl as unknown as typeof MapLibreNS;
      setupMapLibre(MLRef.current);

      // base: MapTiler se c'è la chiave (verificata), altrimenti OSM raster
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
          // ripiego silenzioso sui tile pubblici
        }
      }

      const map = new maplibregl.Map({
        container: holder,
        style,
        attributionControl: false,
        center: [12.5, 42.5],
        zoom: 5,
        maxZoom: 19,
        minZoom: 3.6,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(new maplibregl.AttributionControl({
        compact: true,
        customAttribution: MAPTILER_KEY
          ? '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
          : undefined,
      }));
      // come prima: niente zoom con la rotella (la mappa sta dentro un modulo)
      map.scrollZoom.disable();
      map.on("click", ev => {
        live.current.onChange({ lat: round6(ev.lngLat.lat), lng: round6(ev.lngLat.lng) });
      });
      ro = new ResizeObserver(() => map.resize());
      ro.observe(holder);
      setReady(true);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      MLRef.current = null;
    };
  }, []);

  // pin sincronizzato col valore esterno (GPS, geocoding, reset)
  useEffect(() => {
    const ML = MLRef.current;
    const map = mapRef.current;
    if (!ML || !map || !ready) return;
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (value) {
      const el = document.createElement("div");
      el.className = "zz-loc-pin-wrap";
      el.innerHTML = '<div class="zz-loc-pin"><span class="zz-loc-dot"></span></div>';
      el.title = "Posizione dell'immobile";
      const marker = new ML.Marker({ element: el, anchor: "center", draggable: true })
        .setLngLat([value.lng, value.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        live.current.onChange({ lat: round6(p.lat), lng: round6(p.lng) });
      });
      markerRef.current = marker;
      map.flyTo({ center: [value.lng, value.lat], zoom: Math.max(map.getZoom(), 15), duration: 500 });
    }
  }, [value, ready]);

  const useGps = useCallback(() => {
    if (!navigator.geolocation) return;
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGpsBusy(false);
        live.current.onChange({ lat: round6(pos.coords.latitude), lng: round6(pos.coords.longitude) });
      },
      () => setGpsBusy(false),
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false },
    );
  }, []);

  return (
    <div className="loc-picker-box">
      <div className="loc-picker" ref={holderRef} role="application"
        aria-label="Mappa per indicare la posizione dell'immobile: clicca per piazzare il segnaposto, trascina per correggerlo."></div>
      <div className="row" style={{ marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost btn-xs" onClick={useGps} disabled={gpsBusy}>
          {gpsBusy ? "Rilevo…" : "Usa la mia posizione"}
        </button>
        {value ? (
          <>
            <span className="small mono">{"lat " + value.lat.toFixed(5) + " · lng " + value.lng.toFixed(5)}</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => live.current.onChange(null)}>Rimuovi posizione</button>
          </>
        ) : (
          <span className="small muted">Posizione facoltativa: clicca sulla mappa oppure usa il GPS.</span>
        )}
      </div>
      {note ? <p className="small muted mb0" style={{ marginTop: 6 }}>{note}</p> : null}
    </div>
  );
}
