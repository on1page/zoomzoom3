// GET /api/public/map — dati per la mappa pubblica (territorio italiano reale).
// Regole privacy applicate qui, server-side:
//  - solo immobili con posizione (indirizzi di per sé pubblici) come punti;
//  - zone solo con aggregati (media, conteggio) e soglia minima;
//  - persone fisiche MAI geolocalizzate;
//  - nessun dato di autore, email o date sulle recensioni.
// Aggregati del territorio (coropleti della mappa delle reputazioni):
//  - admin.regions / admin.provinces: reputazione aggregata per regione e
//    provincia (media ponderata di TUTTE le recensioni pubbliche delle
//    schede pubblicate collocate in zone di quella regione/provincia);
//  - zones[].place: reputazione aggregata del comune (stessa base: tutte
//    le schede della zona), usata per colorare il poligono comunale.
// FILTRI PER CRITERIO (dalla mappa si può colorare il territorio in
// funzione dei criteri della categoria "zone"):
//  - criteriaList: i criteri attivi del catalogo [{key,label}];
//  - accanto a ogni aggregato (regione, provincia, comune e scheda città)
//    viene pubblicato "criteria": {chiave: [media, n]} con gli stessi
//    vincoli di soppressione — i voti per criterio arrivano dalle
//    recensioni che li esprimono (oggi: le schede città), quindi il valore
//    complessivo e quello per criterio possono contare recensioni diverse.
//  Soppressione selettiva come per gli altri aggregati: sotto la soglia
//  mapMinAggregate non si pubblica nessun valore.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/server/settings";
import { getCategories } from "@/lib/server/categories";
import { statsForEntity } from "@/lib/server/score";
import { handleError } from "@/lib/server/http";
import { regionCanonical } from "@/lib/map-italy";
import type { CritMap } from "@/lib/map-criteria";

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

/** Pubblica gli aggregati per criterio sopra soglia (undefined se non c'è niente). */
function critOut(byKey: Map<string, Agg> | undefined, minAggregate: number): CritMap | undefined {
  if (!byKey) return undefined;
  const out: CritMap = {};
  for (const [k, a] of byKey) {
    if (a.n >= minAggregate && a.n > 0) out[k] = [Math.round((a.sum / a.n) * 10) / 10, a.n];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Righe di aggregato (regioni o province) con l'eventuale aggregato per criterio. */
function rowsOut(agg: Map<string, Agg>, crit: Map<string, Map<string, Agg>>, minAggregate: number) {
  return aggOut(agg, minAggregate).map(r => {
    const c = critOut(crit.get(r.name), minAggregate);
    return c ? { ...r, criteria: c } : r;
  });
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

    // --- voti per CRITERIO (filtri della mappa): una sola passata sulle
    // recensioni pubbliche delle schede collocate; ogni voto espresso su un
    // criterio del catalogo zone entra negli aggregati per zona (tutte le
    // schede del territorio) e, se la scheda è una scheda città, anche
    // nell'aggregato della scheda stessa (i pin delle città)
    const zonaCriteria = (await getCategories()).find(c => c.id === "zona")?.criteria || [];
    const critKeys = new Set(zonaCriteria.map(c => c.key));
    const zonaEntIds = new Set(zoneEnts.map(e => e.id));
    const critZone = new Map<string, Map<string, Agg>>();   // zoneId → criterio → voti
    const critSheet = new Map<string, Map<string, Agg>>();  // scheda città → criterio → voti
    const placedReviews = await db.review.findMany({
      where: { status: "published", entity: { zoneId: { not: null } } },
      select: { entityId: true, criteriaJson: true },
    });
    for (const rv of placedReviews) {
      const zid = entZone.get(rv.entityId);
      if (!zid) continue;
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(rv.criteriaJson) as Record<string, unknown>; } catch { continue; }
      const isSheet = zonaEntIds.has(rv.entityId);
      let zoneAgg = critZone.get(zid);
      let sheetAgg = isSheet ? critSheet.get(rv.entityId) : undefined;
      for (const [k, v] of Object.entries(parsed)) {
        if (!critKeys.has(k) || typeof v !== "number" || !Number.isFinite(v)) continue;
        if (!zoneAgg) { zoneAgg = new Map(); critZone.set(zid, zoneAgg); }
        const za = zoneAgg.get(k) || { sum: 0, n: 0 };
        za.sum += v; za.n += 1;
        zoneAgg.set(k, za);
        if (isSheet) {
          if (!sheetAgg) { sheetAgg = new Map(); critSheet.set(rv.entityId, sheetAgg); }
          const sa = sheetAgg.get(k) || { sum: 0, n: 0 };
          sa.sum += v; sa.n += 1;
          sheetAgg.set(k, sa);
        }
      }
    }
    // roll-up per regione e provincia, criterio per criterio (media della
    // zona pesata per il numero di voti, come per il complessivo)
    const critRegion = new Map<string, Map<string, Agg>>();
    const critProvince = new Map<string, Map<string, Agg>>();
    for (const [zid, byKey] of critZone) {
      const z = zoneById.get(zid);
      if (!z) continue;
      const reg = regionCanonical(z.region);
      const prov = String(z.province || "").trim();
      for (const [k, a] of byKey) {
        const mean = a.sum / a.n;
        if (reg) {
          let m = critRegion.get(reg);
          if (!m) { m = new Map(); critRegion.set(reg, m); }
          const acc = m.get(k) || { sum: 0, n: 0 };
          acc.sum += mean * a.n; acc.n += a.n;
          m.set(k, acc);
        }
        if (prov) {
          let m = critProvince.get(prov);
          if (!m) { m = new Map(); critProvince.set(prov, m); }
          const acc = m.get(k) || { sum: 0, n: 0 };
          acc.sum += mean * a.n; acc.n += a.n;
          m.set(k, acc);
        }
      }
    }

    const zoneData: Array<{
      id: string; name: string; province: string | null; region: string | null;
      lat: number; lng: number; radiusM: number;
      aggregate: { mean: number; n: number; sufficient: boolean } | null;
      place: { mean: number; n: number; criteria?: CritMap } | null;
      // voti per criterio della SCHEDA CITTÀ (pin e chip sulla mappa)
      crit?: CritMap;
      suppressed: boolean; entityId: string | null;
    }> = [];
    for (const z of zones) {
      const zEnt = zoneEnts.find(e => e.zoneId === z.id);
      const st = zEnt ? await statsForEntity(zEnt.id, settings.minReviews) : null;
      // Soppressione selettiva: sotto la soglia minima non si pubblicano aggregati
      const showAggregate = st != null && st.n >= settings.mapMinAggregate;
      const place = perZone.get(z.id);
      const placeCrit = critOut(critZone.get(z.id), settings.mapMinAggregate);
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
        // zona, agenzie, ditte…), con la stessa soglia di soppressione;
        // criteria = voti per criterio espressi dalle recensioni della zona
        place: place && place.n >= settings.mapMinAggregate
          ? { mean: Math.round((place.sum / place.n) * 10) / 10, n: place.n, ...(placeCrit ? { criteria: placeCrit } : {}) }
          : null,
        crit: zEnt ? critOut(critSheet.get(zEnt.id), settings.mapMinAggregate) : undefined,
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
      // criteri della categoria "zone" per i pulsanti di filtro della mappa
      criteriaList: zonaCriteria,
      admin: {
        regions: rowsOut(perRegion, critRegion, settings.mapMinAggregate),
        provinces: rowsOut(perProvince, critProvince, settings.mapMinAggregate),
      },
      thresholds: { mapMinAggregate: settings.mapMinAggregate, minReviews: settings.minReviews },
    });
  } catch (e) {
    return handleError(e);
  }
}
