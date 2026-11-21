// GET /api/public/map — dati per la mappa pubblica (territorio italiano reale).
// Regole privacy applicate qui, server-side:
//  - solo immobili con posizione (indirizzi di per sé pubblici) come punti;
//  - zone solo con aggregati (media, conteggio) e soglia minima;
//  - persone fisiche MAI geolocalizzate;
//  - nessun dato di autore, email o date sulle recensioni.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/server/settings";
import { statsForEntity } from "@/lib/server/score";
import { handleError } from "@/lib/server/http";

export async function GET() {
  try {
    const settings = await getSettings();
    const zones = await db.zone.findMany({ orderBy: { name: "asc" } });
    const zoneEnts = await db.entity.findMany({ where: { categoryId: "zona", status: "published" } });
    const immob = await db.entity.findMany({
      where: { categoryId: "immobile", status: "published", geoLat: { not: null }, geoLng: { not: null } },
    });

    const zoneData = [];
    for (const z of zones) {
      const zEnt = zoneEnts.find(e => e.zoneId === z.id);
      const st = zEnt ? await statsForEntity(zEnt.id, settings.minReviews) : null;
      // Soppressione selettiva: sotto la soglia minima non si pubblicano aggregati
      const showAggregate = st != null && st.n >= settings.mapMinAggregate;
      zoneData.push({
        id: z.id, name: z.name,
        lat: z.gpsLat, lng: z.gpsLng, radiusM: z.radiusM,
        aggregate: showAggregate
          ? { mean: Math.round(st!.mean! * 10) / 10, n: st!.n, sufficient: st!.sufficient }
          : null,
        suppressed: st != null && !showAggregate,
        entityId: zEnt?.id || null,
      });
    }

    const markers = [];
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
      notice: "Mappa reale del territorio italiano (cartografia OpenStreetMap) con dati aggregati: dalla mappa non si risale a chi ha scritto una recensione né a quando.",
      zones: zoneData,
      markers,
      thresholds: { mapMinAggregate: settings.mapMinAggregate, minReviews: settings.minReviews },
    });
  } catch (e) {
    return handleError(e);
  }
}
