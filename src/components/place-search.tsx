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

// ricerca località con conferma visibile: quando il genitore passa
// "selected" (la località già scelta), il valore RESTA NELLA CASELLA — come
// il campo indirizzo — invece di sparire dopo la scelta. Per cambiare si usa
// il tasto "Cambia" del genitore; l'Invio conferma il primo risultato.
export function PlaceSearch({ localZones, onPick, placeholder, label, hint, id, selected }:{
  localZones?: ZoneInfo[];
  onPick: (p: Place) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  id?: string;
  selected?: string | null;
}) {
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [throttled, setThrottled] = useState(false);
  const cache = useRef(new Map<string, Place[]>());
  const seq = useRef(0);
  const locked = !!(selected && selected.trim());

  // debounce: la ricerca parte 450 ms dopo che l'utente smette di digitare.
  // Ritorna i risultati della query così l'Invio può confermare il primo
  // della lista EFFETTIVA (non di una lista rimasta indietro).
  const search = useCallback(async (query: string): Promise<Place[]> => {
    const key = query.toLowerCase();
    const hit = cache.current.get(key);
    if (hit) { setRemote(hit); setThrottled(false); return hit; }
    const my = ++seq.current;
    setBusy(true);
    const res = await api<{ results: Place[]; throttled?: boolean }>(`/api/public/geocode?q=${encodeURIComponent(query)}`);
    if (my !== seq.current) return []; // risposta sopraggiunta fuori tempo
    setBusy(false);
    if (!res.ok) { setRemote([]); return []; }
    setThrottled(!!res.throttled);
    setRemote(res.results);
    if (!res.throttled) cache.current.set(key, res.results);
    return res.results;
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

  // conferma di un suggerimento: la località scelta va al genitore (che la
  // mostra nella casella via "selected") e la casella di ricerca si svuota
  // per un'eventuale ricerca successiva
  const pick = (p: Place) => {
    onPick(p);
    setQ("");
    setRemote(null);
  };

  return (
    <div className="field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <input id={id} type="search" autoComplete="off" role="combobox"
        readOnly={locked} aria-readonly={locked}
        aria-expanded={!locked && results.length > 0}
        aria-controls={id ? `${id}-list` : undefined}
        placeholder={locked ? "" : (placeholder || "Es. Corte de' Frati, Marciaga, Milano…")}
        value={locked ? selected : q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (locked || busy || q.trim().length < 3) return;
          // Invio: conferma il primo risultato della lista (come il campo
          // indirizzo) — così il nome digitato resta memorizzato nella casella
          void (async () => {
            const found = await search(q.trim());
            const first = localMatches[0] || found[0];
            if (first) pick(first);
          })();
        }} />
      {locked ? (
        <span className="hint"><b>Memorizzata.</b> Per cambiarla premi “Cambia”.</span>
      ) : null}
      {!locked && q.trim().length >= 2 ? (
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
              <button type="button" onClick={() => pick(p)}>
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
      {!locked && hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
