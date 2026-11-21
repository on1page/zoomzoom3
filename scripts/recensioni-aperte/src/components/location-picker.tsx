"use client";
// ZoomZoom — selettore posizione su cartografia reale (Leaflet/OpenStreetMap)
// per l'aggiunta di un immobile: clic per piazzare o spostare il pin.
// Il pin è facoltativo: senza posizione la scheda resta recensibile, semplicemente
// non compare tra i punti della mappa. Nessun dato lascia il browser finché il
// modulo non viene inviato (il GPS serve solo al momento e la scelta è dell'utente).
import { useCallback, useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import "leaflet/dist/leaflet.css";

export type LatLng = { lat: number; lng: number };

export function LocationPicker({ value, onChange, note }: {
  value: LatLng | null;
  onChange: (v: LatLng | null) => void;
  note?: string;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const LRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const markerRef = useRef<LeafletNS.Marker | null>(null);
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
      const mod = await import("leaflet");
      const L = ((mod as unknown as { default?: typeof LeafletNS }).default) ?? mod;
      if (disposed || !holderRef.current) return;
      LRef.current = L;
      const map = L.map(holder, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      }).addTo(map);
      map.setView([42.5, 12.5], 5);
      map.on("click", ev => {
        const { lat, lng } = ev.latlng;
        const rounded = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
        live.current.onChange(rounded);
      });
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(holder);
      setReady(true);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      LRef.current = null;
    };
  }, []);

  // pin sincronizzato col valore esterno (GPS, geocoding, reset)
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!L || !map || !ready) return;
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (value) {
      const icon = L.divIcon({
        className: "zz-loc-pin-wrap",
        html: '<div class="zz-loc-pin"><span class="zz-loc-dot"></span></div>',
        iconSize: [22, 22], iconAnchor: [11, 11],
      });
      markerRef.current = L.marker([value.lat, value.lng], { icon, draggable: true, title: "Posizione dell'immobile" })
        .on("dragend", ev => {
          const { lat, lng } = (ev.target as LeafletNS.Marker).getLatLng();
          live.current.onChange({ lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
        })
        .addTo(map);
      map.setView([value.lat, value.lng], Math.max(map.getZoom(), 15), { animate: true });
    }
  }, [value, ready]);

  const useGps = useCallback(() => {
    if (!navigator.geolocation) return;
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGpsBusy(false);
        live.current.onChange({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 });
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
