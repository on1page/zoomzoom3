// GET /api/public/geocode?q= — ricerca di un indirizzo sulla cartografia
// OpenStreetMap (servizio pubblico Nominatim), per posizionare sulla mappa
// l'immobile da recensire. Il server fa da proxy: aggiunge lo User-Agent
// richiesto dalla policy di utilizzo, limita la frequenza per IP e restringe
// i risultati all'Italia. PRIVACY: la stringa digitata viene inviata al
// geocoder di OpenStreetMap SOLO quando l'utente preme "Cerca sulla mappa";
// il piazzamento manuale del pin (clic o GPS) non involve terzi.
// Nessuna API key: il servizio pubblico è gratuito per traffico leggero
// (policy: max 1 richiesta/secondo, User-Agent identificato).
import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    if (q.length < 3) return NextResponse.json({ ok: true, results: [] });
    // policy Nominatim: massimo 1 richiesta/secondo per IP (qui 10/min)
    const rl = rateLimit(`geocode:${clientIp(req)}`, 10, 60);
    if (!rl.ok) return NextResponse.json({ ok: true, results: [], throttled: true });

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "it");
    url.searchParams.set("accept-language", "it");
    url.searchParams.set("addressdetails", "0");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ZoomZoom/1.0 (portale recensioni casa; uso interno geocoding)" },
        signal: ctrl.signal,
      });
      if (!res.ok) return NextResponse.json({ ok: true, results: [] });
      const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
      const results = rows.map(r => ({
        label: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
      })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
      return NextResponse.json({ ok: true, results });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // geocoder non raggiungibile: il client ripiega sul piazzamento manuale
    return NextResponse.json({ ok: true, results: [] });
  }
}
