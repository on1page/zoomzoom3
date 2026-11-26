"use client";
// ZoomZoom — auto-suggerimenti per il campo VIA della nuova scheda
// immobile: mentre si digita la via (o piazza o largo), il geocoder
// nazionale propone gli indirizzi reali della cartografia OpenStreetMap
// (via, civico, comune). Sceglierne uno conferma in un colpo solo via,
// civico, città e pin sulla mappa: niente più "località trovata ma non
// confermabile".
// DUE MODALITÀ:
//  · via (predefinita): nel campo resta SOLO la via; il civico scelto va
//    al campo dedicato (via onPick), perché in un civico possono esserci
//    più unità (condomini) e la via resta la base del confronto;
//  · fullAddress (campo unico): nel campo resta la via COL civico — è la
//    modalità della conferma scheda: un solo campo per l'indirizzo
//    intero, il civico resta comunque separato nei dati (onPick lo porta).
// Stessa condotta privacy di place-search: la stringa va al geocoder pubblico
// SOLO tramite il proxy del server, con debounce (450 ms), minimo 4
// caratteri e cache per query, nel rispetto della policy Nominatim.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";

export type AddressPlace = {
  label: string;          // etichetta completa (via, civico, comune, CAP)
  road: string | null;    // via
  houseNumber: string | null; // civico
  zoneName: string | null;    // comune
  province: string | null;
  region: string | null;
  lat: number;
  lng: number;
};

export function AddressSearch({ id, value, onChange, onPick, label, hint, placeholder, fullAddress }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (p: AddressPlace) => void;
  label?: string;
  hint?: string;
  placeholder?: string;
  // modalità campo unico: via + civico insieme nel campo (i dati restano
  // separati: onPick porta via e civico distinti)
  fullAddress?: boolean;
}) {
  const [remote, setRemote] = useState<AddressPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [throttled, setThrottled] = useState(false);
  const [open, setOpen] = useState(false);
  const cache = useRef(new Map<string, AddressPlace[]>());
  const seq = useRef(0);

  const search = useCallback(async (query: string) => {
    const key = query.toLowerCase();
    const hit = cache.current.get(key);
    if (hit) { setRemote(hit); setThrottled(false); setOpen(true); return; }
    const my = ++seq.current;
    setBusy(true);
    const res = await api<{ results: AddressPlace[]; throttled?: boolean }>(`/api/public/geocode?q=${encodeURIComponent(query)}`);
    if (my !== seq.current) return; // risposta sopraggiunta fuori tempo
    setBusy(false);
    if (!res.ok) { setRemote([]); return; }
    setThrottled(!!res.throttled);
    // per il campo indirizzo contano gli indirizzi (via o civico presenti);
    // i soli comuni restano al campo "Città, comune o paese"
    const rows = (res.results || []).filter(r => r.road || r.houseNumber).slice(0, 6);
    setRemote(rows);
    setOpen(true);
    if (!res.throttled) cache.current.set(key, rows);
  }, []);

  useEffect(() => {
    const t = value.trim().length >= 4 ? setTimeout(() => { void search(value.trim()); }, 450) : null;
    if (value.trim().length < 4) { setRemote(null); setOpen(false); setThrottled(false); }
    return () => { if (t) clearTimeout(t); };
  }, [value, search]);

  const results = remote || [];

  return (
    <div className="field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <input id={id} type="search" autoComplete="off" required role="combobox"
        aria-label={label || (fullAddress ? "Indirizzo (via e numero civico)" : "Via")}
        aria-expanded={open && results.length > 0}
        aria-controls={id ? `${id}-list` : undefined}
        placeholder={placeholder || (fullAddress ? "Es. Via dei Mille 15" : "Es. Via dei Mille")}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            // con i suggerimenti aperti, Enter conferma il primo risultato
            // (l'indirizzo reale); senza suggerimenti, il modulo si invia
            if (open && results.length) { e.preventDefault(); pick(results[0]); }
          }
        }} />
      {open && (busy || throttled || results.length > 0) ? (
        <ul className="geo-results" id={id ? `${id}-list` : undefined}>
          {busy ? <li className="small muted" style={{ padding: "8px 12px" }}>Cerco gli indirizzi sulla cartografia nazionale…</li> : null}
          {!busy && throttled && !results.length ? (
            <li className="small muted" style={{ padding: "8px 12px" }}>Troppe ricerche di fila: attendi qualche secondo e riprova.</li>
          ) : null}
          {results.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => pick(p)}>
                <strong>{[p.road, p.houseNumber].filter(Boolean).join(" ")}</strong>
                <span className="small muted">
                  {p.zoneName ? ` · ${p.zoneName}` : ""}{p.province ? ` (${p.province})` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );

  function pick(p: AddressPlace) {
    // nel campo resta la via (modalità dedicata) oppure l'indirizzo intero
    // (modalità campo unico): i DATI restano sempre distinti — onPick porta
    // via, civico, città e coordinate al chiamante
    const keep = fullAddress
      ? [p.road, p.houseNumber].filter(Boolean).join(" ") || p.road || value
      : p.road || [p.road, p.houseNumber].filter(Boolean).join(" ") || value;
    onChange(keep);
    setOpen(false);
    setRemote(null);
    onPick(p);
  }
}
