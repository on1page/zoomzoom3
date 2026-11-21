// GET /api/public/geocode?q= — ricerca di un indirizzo o località sulla
// cartografia OpenStreetMap (servizio pubblico Nominatim), su TUTTO il
// territorio nazionale: comuni capoluoghi, paesi, frazioni, vie e civici.
// Il server fa da proxy: aggiunge lo User-Agent richiesto dalla policy di
// utilizzo, limita la frequenza per IP e restringe i risultati all'Italia.
// Ogni risultato ora include i dettagli dell'indirizzo (via, civico, comune,
// provincia, regione): il client può così riempire automaticamente città e
// zona della nuova scheda, non solo piazzare il pin.
// PRIVACY: la stringa digitata va al geocoder pubblico SOLO quando l'utente
// cerca; il piazzamento manuale del pin (clic o GPS senza ricerca) non
// coinvolge terzi. Una cache server-side (15 minuti) evita di ripetere le
// ricerche più frequenti, nel rispetto della policy Nominatim (max 1 req/s).
// Nessuna API key: il servizio pubblico è gratuito per traffico leggero.
import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

// dettagli Nominatim per l'Italia: city/town/village/hamlet/municipality a
// seconda del posto; county = provincia; state oppure region = regione
type NominatimRow = {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  addresstype?: string;
  name?: string;
  address?: {
    road?: string; house_number?: string; postcode?: string;
    city?: string; town?: string; village?: string; hamlet?: string; municipality?: string;
    county?: string; state?: string; region?: string; country?: string; country_code?: string;
  };
};

export type GeocodePlace = {
  label: string;
  name: string;
  lat: number;
  lng: number;
  kind: string;            // comune, paese, frazione, via, indirizzo…
  zoneName: string | null; // comune o località di riferimento
  province: string | null;
  region: string | null;
  road: string | null;     // via, se il risultato è un indirizzo
  houseNumber: string | null;
  postcode: string | null;
};

export function zoneNameOfAddress(a: NonNullable<NominatimRow["address"]>): string | null {
  return a.municipality || a.city || a.town || a.village || a.hamlet || null;
}

// cache condivisa nel processo: query normalizzata → risultati + timestamp
const searchCache = new Map<string, { at: number; results: GeocodePlace[] }>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 300;

function cacheGet(key: string): GeocodePlace[] | null {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { searchCache.delete(key); return null; }
  return hit.results;
}

function cacheSet(key: string, results: GeocodePlace[]) {
  if (searchCache.size >= CACHE_MAX) {
    // elimina la voce più vecchia
    let oldest: string | null = null, oldestAt = Infinity;
    for (const [k, v] of searchCache) if (v.at < oldestAt) { oldest = k; oldestAt = v.at; }
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(key, { at: Date.now(), results });
}

const KIND_IT: Record<string, string> = {
  administrative: "località", city: "città", town: "città", village: "paese",
  hamlet: "frazione", municipality: "comune", suburb: "quartiere",
  road: "via", pedestrian: "via", house: "indirizzo", building: "edificio",
  postcode: "cap",
};

export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    if (q.length < 3) return NextResponse.json({ ok: true, results: [] });
    // policy Nominatim: massimo 1 richiesta/secondo (qui 20/min per IP,
    // chiave condivisa con il reverse: le due ricerche pesano insieme)
    const rl = rateLimit(`geocode:${clientIp(req)}`, 20, 60);
    if (!rl.ok) return NextResponse.json({ ok: true, results: [], throttled: true });

    const key = q.toLowerCase().slice(0, 80);
    const cached = cacheGet(key);
    if (cached) return NextResponse.json({ ok: true, results: cached, cached: true });

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "8");
    url.searchParams.set("countrycodes", "it");
    url.searchParams.set("accept-language", "it");
    url.searchParams.set("addressdetails", "1");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ZoomZoom/1.0 (portale recensioni casa; uso interno geocoding)" },
        signal: ctrl.signal,
      });
      if (!res.ok) return NextResponse.json({ ok: true, results: [] });
      const rows = (await res.json()) as NominatimRow[];
      const results: GeocodePlace[] = rows.map(r => {
        const a = r.address || {};
        return {
          label: r.display_name,
          name: r.name || (zoneNameOfAddress(a) ?? r.display_name.split(",")[0]),
          lat: Number(r.lat),
          lng: Number(r.lon),
          kind: KIND_IT[r.addresstype || r.type || ""] || r.addresstype || r.type || "luogo",
          zoneName: zoneNameOfAddress(a),
          province: a.county || null,
          region: a.state || a.region || null,
          road: a.road || null,
          houseNumber: a.house_number || null,
          postcode: a.postcode || null,
        };
      }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
      cacheSet(key, results);
      return NextResponse.json({ ok: true, results });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // geocoder non raggiungibile: il client ripiega sul piazzamento manuale
    return NextResponse.json({ ok: true, results: [] });
  }
}
