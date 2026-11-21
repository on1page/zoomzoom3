// GET /api/public/geocode/reverse?lat=..&lng=.. — reverse geocoding: dalle
// coordinate GPS ricava l'INDIRIZZO REALE (via e civico, se mappati) insieme
// a comune, provincia e regione. È il complemento del GPS grezzo: l'utente
// che si trova davanti all'immobile preme "usa la mia posizione" e il modulo
// si riempie da solo, senza digitare niente.
// PRIVACY: le coordinate vanno al geocoder pubblico di OpenStreetMap solo
// quando l'utente chiede esplicitamente l'indirizzo (bottone dedicato);
// il semplice piazzamento del pin non coinvolge terzi. Cache server-side di
// 1 ora sulle coordinate arrotondate (~100 m) per rispettare la policy
// Nominatim; lo stesso limite per IP della ricerca diretta vale qui.
import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { inItalyBounds } from "@/lib/server/zones";

type NominatimReverse = {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: {
    road?: string; house_number?: string; postcode?: string;
    city?: string; town?: string; village?: string; hamlet?: string; municipality?: string;
    county?: string; state?: string; region?: string; country?: string; country_code?: string;
  };
};

export type ReverseResult = {
  label: string;
  road: string | null;
  houseNumber: string | null;
  postcode: string | null;
  zoneName: string | null; // comune o località
  province: string | null;
  region: string | null;
  country: string | null;
};

const reverseCache = new Map<string, { at: number; found: boolean; result: ReverseResult | null }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;

export async function GET(req: NextRequest) {
  try {
    const lat = Number(req.nextUrl.searchParams.get("lat"));
    const lng = Number(req.nextUrl.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inItalyBounds(lat, lng)) {
      return NextResponse.json({ ok: true, found: false, reason: "out-of-bounds" });
    }
    const rl = rateLimit(`geocode:${clientIp(req)}`, 20, 60);
    if (!rl.ok) return NextResponse.json({ ok: true, found: false, throttled: true });

    // arrotonda a 3 decimali (~100 m): la stessa via non genera voci diverse
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const hit = reverseCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return NextResponse.json({ ok: true, found: hit.found, address: hit.result });
    }

    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("zoom", "18"); // massimo dettaglio: strada e civico
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "it");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ZoomZoom/1.0 (portale recensioni casa; uso interno geocoding)" },
        signal: ctrl.signal,
      });
      if (!res.ok) return NextResponse.json({ ok: true, found: false });
      const data = (await res.json()) as NominatimReverse;
      const a = data.address || {};
      // solo l'Italia: un pin oltre confine non produce indirizzi
      if ((a.country_code || "").toLowerCase() !== "it") {
        return NextResponse.json({ ok: true, found: false, reason: "not-italy" });
      }
      const zoneName = a.municipality || a.city || a.town || a.village || a.hamlet || null;
      const found = !!(zoneName || a.road);
      const result: ReverseResult | null = found ? {
        label: data.display_name || "",
        road: a.road || null,
        houseNumber: a.house_number || null,
        postcode: a.postcode || null,
        zoneName,
        province: a.county || null,
        region: a.state || a.region || null,
        country: a.country || "Italia",
      } : null;

      if (reverseCache.size >= CACHE_MAX) reverseCache.clear();
      reverseCache.set(key, { at: Date.now(), found, result });
      return NextResponse.json({ ok: true, found, address: result });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return NextResponse.json({ ok: true, found: false });
  }
}
