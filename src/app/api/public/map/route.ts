// GET /api/public/map — dati per la mappa pubblica (territorio italiano reale).
// Regole privacy applicate qui, server-side:
//  - solo immobili con posizione (indirizzi di per sé pubblici) come punti;
//  - zone solo con aggregati (media, conteggio) e soglia minima;
//  - persone fisiche MAI geolocalizzate;
//  - nessun dato di autore, email o date sulle recensioni.
// Aggiunti per la mappa delle reputazioni (coropleti del territorio):
//  - admin.regions / admin.provinces: reputazione aggregata per regione e
//    provincia (media ponderata di TUTTE le recensioni pubbliche delle
//    schede pubblicate collocate in zone di quella regione/provincia);
//  - zones[].place: reputazione aggregata del comune (stessa base: tutte
//    le schede della zona), usata per colorare il poligono comunale.
//  Soppressione selettiva come per gli altri aggregati: sotto la soglia
//  mapMinAggregate non si pubblica nessun valore.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/server/settings";
import { statsForEntity } from "@/lib/server/score";
import { handleError } from "@/lib/server/http";
import { regionCanonical } from "@/lib/map-italy";

type Agg = { sum: number; n: number };
function pushAgg(map: Map<string, Agg>, key: string, mean: number, n: number) {
  const acc = map.get(key) || { sum: 0, n: 0 };
  acc.sum += mean * n;
  acc.n += n;
  map.set(key, acc);
}
function aggOut(map: Map<string, Agg>, minAggregate: number) {
  const out: Array<{ name: string; mean: number; n: number }> = [];
  for (const [name, a] of map) {
    if (a.n >= minAggregate && a.n > 0) {
      out.push({ name, mean: Math.round((a.sum / a.n) * 10) / 10, n: a.n });
    }
  }
  return out.sort((a, b) => b.n - a.n);
}

export async function GET() {
  try {
    const settings = await getSettings();
    const zones = await db.zone.findMany({ orderBy: { name: "asc" } });
    const zoneEnts = await db.entity.findMany({ where: { categoryId: "zona", status: "published" } });
    const immob = await db.entity.findMany({
      where: { categoryId: "immobile", status: "published", geoLat: { not: null }, geoLng: { not: null } },
    });

    // --- reputazione del territorio: tutte le recensioni pubbliche delle
    // schede pubblicate collocate in una zona, aggregate per zona, poi per
    // regione e provincia tramite i campi della zona (valorizzati dal
    // geocoder alla conferma della città)
    const zonedEnts = await db.entity.findMany({
      where: { status: "published", zoneId: { not: null } },
      select: { id: true, zoneId: true },
    });
    const entZone = new Map(zonedEnts.map(e => [e.id, e.zoneId as string]));
    const reviewStats = await db.review.groupBy({
      by: ["entityId"],
      _avg: { score: true },
      _count: { _all: true },
      where: { status: "published" },
    });
    const perZone = new Map<string, Agg>();
    for (const s of reviewStats) {
      const zid = entZone.get(s.entityId);
      const mean = s._avg.score;
      const n = s._count._all;
      if (!zid || mean == null || !n) continue;
      pushAgg(perZone, zid, mean, n);
    }
    const perRegion = new Map<string, Agg>();
    const perProvince = new Map<string, Agg>();
    const zoneById = new Map(zones.map(z => [z.id, z]));
    for (const [zid, a] of perZone) {
      const z = zoneById.get(zid);
      if (!z) continue;
      const reg = regionCanonical(z.region);
      if (reg) pushAgg(perRegion, reg, a.sum / a.n, a.n);
      const prov = String(z.province || "").trim();
      if (prov) pushAgg(perProvince, prov, a.sum / a.n, a.n);
    }

    const zoneData: Array<{
      id: string; name: string; province: string | null; region: string | null;
      lat: number; lng: number; radiusM: number;
      aggregate: { mean: number; n: number; sufficient: boolean } | null;
      place: { mean: number; n: number } | null;
      suppressed: boolean; entityId: string | null;
    }> = [];
    for (const z of zones) {
      const zEnt = zoneEnts.find(e => e.zoneId === z.id);
      const st = zEnt ? await statsForEntity(zEnt.id, settings.minReviews) : null;
      // Soppressione selettiva: sotto la soglia minima non si pubblicano aggregati
      const showAggregate = st != null && st.n >= settings.mapMinAggregate;
      const place = perZone.get(z.id);
      zoneData.push({
        id: z.id, name: z.name,
        province: z.province || null,
        region: z.region || null,
        lat: z.gpsLat, lng: z.gpsLng, radiusM: z.radiusM,
        aggregate: showAggregate
          ? { mean: Math.round(st!.mean! * 10) / 10, n: st!.n, sufficient: st!.sufficient }
          : null,
        suppressed: st != null && !showAggregate,
        // reputazione del COMUNE: tutte le schede della zona (immobili,
        // zona, agenzie, ditte…), con la stessa soglia di soppressione
        place: place && place.n >= settings.mapMinAggregate
          ? { mean: Math.round((place.sum / place.n) * 10) / 10, n: place.n }
          : null,
        entityId: zEnt?.id || null,
      });
    }

    const markers: Array<{
      id: string; name: string; lat: number; lng: number; zoneId: string | null;
      mean: number | null; n: number; isDemo: boolean;
    }> = [];
    for (const e of immob) {
      const st = await statsForEntity(e.id, settings.minReviews);
      markers.push({
        id: e.id, name: e.name, lat: e.geoLat!, lng: e.geoLng!, zoneId: e.zoneId,
        mean: st.mean == null ? null : Math.round(st.mean * 10) / 10,
        n: st.n, isDemo: e.isDemo,
      });
    }

    return NextResponse.json({
      ok: true,
      demoMode: process.env.DEMO_MODE === "true",
      notice: "Mappa reale del territorio italiano (cartografia MapTiler/OpenStreetMap) con dati aggregati: dalla mappa non si risale a chi ha scritto una recensione né a quando.",
      zones: zoneData,
      markers,
      admin: {
        regions: aggOut(perRegion, settings.mapMinAggregate),
        provinces: aggOut(perProvince, settings.mapMinAggregate),
      },
      thresholds: { mapMinAggregate: settings.mapMinAggregate, minReviews: settings.minReviews },
    });
  } catch (e) {
    return handleError(e);
  }
}
