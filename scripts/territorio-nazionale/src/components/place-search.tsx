"use client";
// ZoomZoom — ricerca località su TUTTO il territorio nazionale: comuni,
// paesi, frazioni, quartieri (cartografia OpenStreetMap via proxy server).
// Usata dove prima c'era l'elenco fisso delle poche città di partenza.
// Due fonti fuse in un'unica lista:
//  1. suggerimenti LOCALI (zone già presenti su ZoomZoom): immediati,
//     zero rete, marcati "già su ZoomZoom";
//  2. risultati NAZIONALI dal geocoder (con debounce 450 ms e cache per
//     query, nel rispetto della policy del servizio pubblico).
// Nessun dato lascia il browser finché l'utente non digita: la stringa va
// al geocoder solo tramite il proxy del server, come per la ricerca mappa.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { ZoneInfo } from "@/lib/client/store";

export type Place = {
  label: string;          // etichetta completa (per la lista)
  name: string;           // nome corto della località
  lat: number;
  lng: number;
  kind: string;           // città, paese, frazione, via…
  zoneName: string | null; // comune/località di riferimento
  province: string | null;
  region: string | null;
  localId?: string;       // id zona ZoomZoom, se già presente nel catalogo
  local?: boolean;
};

const deaccent = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function PlaceSearch({ localZones, onPick, placeholder, label, hint, id }:{
  localZones?: ZoneInfo[];
  onPick: (p: Place) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  id?: string;
}) {
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [throttled, setThrottled] = useState(false);
  const cache = useRef(new Map<string, Place[]>());
  const seq = useRef(0);

  // debounce: la ricerca parte 450 ms dopo che l'utente smette di digitare
  const search = useCallback(async (query: string) => {
    const key = query.toLowerCase();
    const hit = cache.current.get(key);
    if (hit) { setRemote(hit); setThrottled(false); return; }
    const my = ++seq.current;
    setBusy(true);
    const res = await api<{ results: Place[]; throttled?: boolean }>(`/api/public/geocode?q=${encodeURIComponent(query)}`);
    if (my !== seq.current) return; // risposta sopraggiunta fuori tempo
    setBusy(false);
    if (!res.ok) { setRemote([]); return; }
    setThrottled(!!res.throttled);
    setRemote(res.results);
    if (!res.throttled) cache.current.set(key, res.results);
  }, []);

  useEffect(() => {
    const t = q.trim().length >= 3 ? setTimeout(() => { void search(q.trim()); }, 450) : null;
    if (q.trim().length < 3) { setRemote(null); setThrottled(false); }
    return () => { if (t) clearTimeout(t); };
  }, [q, search]);

  // suggerimenti locali: match sul nome, senza passare dalla rete
  const ql = deaccent(q.trim());
  const localMatches = (q.trim().length >= 2 && localZones
    ? localZones.filter(z => deaccent(z.name).includes(ql)).slice(0, 4)
    : []
  ).map<Place>(z => ({
    label: `${z.name}${z.province ? `, ${z.province}` : ""}${z.region ? ` · ${z.region}` : ""}`,
    name: z.name,
    lat: z.lat ?? 0,
    lng: z.lng ?? 0,
    kind: "su ZoomZoom",
    zoneName: z.name,
    province: z.province ?? null,
    region: z.region ?? null,
    localId: z.id,
    local: true,
  }));

  const results = [
    ...localMatches,
    ...(remote || []).filter(r => !localMatches.some(l =>
      deaccent(l.name) === deaccent(r.zoneName || r.name))),
  ].slice(0, 9);

  return (
    <div className="field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <input id={id} type="search" autoComplete="off" role="combobox" aria-expanded={results.length > 0}
        aria-controls={id ? `${id}-list` : undefined}
        placeholder={placeholder || "Es. Corte de' Frati, Marciaga, Milano…"}
        value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (q.trim().length >= 3 && !busy) void search(q.trim());
          }
        }} />
      {q.trim().length >= 2 ? (
        <ul className="geo-results" id={id ? `${id}-list` : undefined}>
          {busy ? <li className="small muted" style={{ padding: "8px 12px" }}>Cerco su tutto il territorio nazionale…</li> : null}
          {!busy && throttled && !results.length ? (
            <li className="small muted" style={{ padding: "8px 12px" }}>Troppe ricerche di fila: attendi qualche secondo e riprova.</li>
          ) : null}
          {!busy && !throttled && results.length === 0 && q.trim().length >= 3 ? (
            <li className="small muted" style={{ padding: "8px 12px" }}>
              Nessuna località trovata{remote && remote.length === 0 ? ": controlla il nome o prova con il comune" : ""}.
            </li>
          ) : null}
          {results.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => { onPick(p); setQ(""); setRemote(null); }}>
                <strong>{p.zoneName || p.name}</strong>
                <span className="small muted">
                  {" · " + p.kind + (p.province ? ` · ${p.province}` : "") + (p.region && p.province !== p.region ? ` (${p.region})` : "")}
                  {p.local ? " — già su ZoomZoom" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
