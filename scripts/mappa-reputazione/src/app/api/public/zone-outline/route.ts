// GET /api/public/zone-outline?name=&province=&region= — poligono del
// COMUNE (confine amministrativo) per il livello comunale della mappa
// delle reputazioni. Il tileset Countries di MapTiler non include i comuni
// italiani: il contorno viene chiesto al geocoder pubblico Nominatim
// (stesso servizio già usato dalla ricerca di una località), che restituisce
// la geometria del confine. Il server fa da proxy con cache condivisa
// (24 ore) e rate limiting: per Nominatim un comune viene chiesto al più
// una volta al giorno, nel rispetto della policy (max 1 req/s).
// PRIVACY: si chiede il contorno di un comune DEL CATALOGO, mai la
// posizione dell'utente; nessun dato personale coinvolto.
import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

type NominatimRow = {
  lat: string;
  lon: string;
  geojson?: { type: string; coordinates: unknown };
  category?: string;
  type?: string;
  addresstype?: string;
  name?: string;
};

// cache condivisa nel processo: chiave normalizzata → geometria + timestamp
const outlineCache = new Map<string, { at: number; geometry: { type: string; coordinates: unknown } | null }>();
const CACHE_TTL_MS = 24 * 3600 * 1000;
const CACHE_MAX = 120;

function cacheGet(key: string): { type: string; coordinates: unknown } | null | undefined {
  const hit = outlineCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) { outlineCache.delete(key); return undefined; }
  return hit.geometry;
}
function cacheSet(key: string, geometry: { type: string; coordinates: unknown } | null) {
  if (outlineCache.size >= CACHE_MAX) {
    let oldest: string | null = null, oldestAt = Infinity;
    for (const [k, v] of outlineCache) if (v.at < oldestAt) { oldest = k; oldestAt = v.at; }
    if (oldest) outlineCache.delete(oldest);
  }
  outlineCache.set(key, { at: Date.now(), geometry });
}

// tipi Nominatim che indicano un confine di comune/località amministrativa
const PLACE_TYPES = new Set(["administrative", "municipality", "city", "town", "village"]);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const name = (sp.get("name") || "").trim().slice(0, 80);
    const province = (sp.get("province") || "").trim().slice(0, 60);
    const region = (sp.get("region") || "").trim().slice(0, 60);
    if (name.length < 2) return NextResponse.json({ ok: false, error: "Nome comune mancante." }, { status: 400 });

    const key = `${name.toLowerCase()}|${province.toLowerCase()}|${region.toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached !== undefined) {
      if (!cached) return NextResponse.json({ ok: true, polygon: null, cached: true });
      return NextResponse.json({ ok: true, polygon: cached, cached: true });
    }

    // rate limit: condivide la chiave del geocoder (le richieste verso
    // Nominatim pesano insieme, policy 1 req/s)
    const rl = rateLimit(`geocode:${clientIp(req)}`, 20, 60);
    if (!rl.ok) return NextResponse.json({ ok: true, polygon: null, throttled: true });

    const q = [name, province, region, "Italia"].filter(Boolean).join(", ");
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "3");
    url.searchParams.set("countrycodes", "it");
    url.searchParams.set("accept-language", "it");
    url.searchParams.set("polygon_geojson", "1");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ZoomZoom/1.0 (portale recensioni casa; uso interno geocoding)" },
        signal: ctrl.signal,
      });
      if (!res.ok) { cacheSet(key, null); return NextResponse.json({ ok: true, polygon: null }); }
      const rows = (await res.json()) as NominatimRow[];
      // primo risultato che sia davvero un confine amministrativo di luogo
      const hit = rows.find(r => r.geojson && PLACE_TYPES.has(r.addresstype || r.type || "administrative"));
      const geometry = hit?.geojson || null;
      cacheSet(key, geometry);
      return NextResponse.json({ ok: true, polygon: geometry });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // geocoder non raggiungibile: la mappa resta senza contorno comunale
    return NextResponse.json({ ok: true, polygon: null });
  }
}
