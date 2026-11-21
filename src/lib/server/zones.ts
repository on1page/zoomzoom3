// ZoomZoom — gestione zone a copertura nazionale. Il catalogo non è più
// limitato alle città in seed: QUALSIASI comune, frazione o paese d'Italia
// entra a far parte del catalogo nel momento in cui qualcuno aggiunge un
// immobile o recensisce il posto (dati di confine: OpenStreetMap/Nominatim).
// La zona viene creata una sola volta: il riconoscimento degli omonimi usa
// nome normalizzato + provincia + distanza tra i centri (chilometri reali,
// non confronto di stringhe), così "Sesto San Giovanni" (MI) e un eventuale
// omonimo altrove restano due posti distinti.
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { Entity, Zone } from "@prisma/client";

// errori tipizzati di ensureZone: la route li distingue dagli errori
// interni (DB e simili) per restituire messaggi onesti invece di un generico
// "non risulta in Italia" che nasconde il vero problema
export class ZoneNameError extends Error {}
export class ZonePositionError extends Error {}

// normalizza un toponimo: maiuscole, accenti e punteggiatura non devono
// creare zone duplicate ("Corte de' Frati" ≡ "corte de frati")
export function normPlace(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// slug stabile per l'id zona (es. "Corte de' Frati" → "corte-de-frati")
export function slugifyPlace(s: string): string {
  const n = normPlace(s).replace(/ /g, "-");
  return (n || "zona").slice(0, 48).replace(/^-+|-+$/g, "") || "zona";
}

// confini approssimati dell'Italia (con margine, isole incluse)
export function inItalyBounds(lat: number, lng: number): boolean {
  return lat >= 34 && lat <= 48.5 && lng >= 5.5 && lng <= 19.5;
}

// distanza haversine in km tra due punti WGS84
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type ZoneSpec = {
  name: string;
  province?: string | null;
  region?: string | null;
  lat: number;
  lng: number;
  radiusM?: number | null;
};

export type EnsureZoneResult = { zone: Zone; created: boolean };

/* ---------- diagnosi onesta degli errori di salvataggio ---------- */

// Un errore interno in ensureZone NON è colpa dell'utente e quasi sempre ha
// una causa precisa: client Prisma generato da uno schema vecchio, database
// senza le colonne delle località nazionali, connessione caduta. Qui viene
// riconosciuta e tradotta in un messaggio che dice CHE COSA FARE, con un
// codice utile al log. (Il caso più frequente in locale: il pacchetto
// "territorio nazionale" copiato senza eseguire db:push — così findMany
// funziona, ma il create/update con province/region/source esplode.)
export type ZoneSaveIssue = { code: string; message: string };

export function classifyZoneSaveError(e: unknown): ZoneSaveIssue {
  if (e instanceof Prisma.PrismaClientValidationError) {
    return {
      code: "DB_CLIENT_VECCHIO",
      message: "Il software del sito non è aggiornato all'ultima versione (client del database generato da uno schema precedente): l'amministratore deve eseguire “bun run db:push” e riavviare il server, poi riprovare.",
    };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2022") {
      return {
        code: "DB_SCHEMA_VECCHIO",
        message: "Il database del sito non ha ancora le colonne delle nuove località nazionali (provincia, regione, provenienza): l'amministratore deve eseguire “bun run db:push”, poi riprovare.",
      };
    }
    if (e.code && e.code.startsWith("P1")) {
      return { code: e.code, message: "Il database non risponde: riprova tra poco." };
    }
    return { code: e.code, message: "Errore interno nel salvataggio della località: riprova tra poco." };
  }
  return { code: "INTERNO", message: "Errore interno nel salvataggio della località: riprova tra poco." };
}

/**
 * Cerca una zona già nota dal solo NOME (fallback quando le coordinate non
 * sono arrivate o non sono valide: il nome normalizzato + l'eventuale
 * provincia bastano per riconoscere un posto già sul catalogo). Ritorna
 * null se non c'è nessuna corrispondenza.
 */
export async function findZoneByName(name: string, province?: string | null): Promise<Zone | null> {
  const norm = normPlace(String(name || ""));
  if (!norm) return null;
  const all = await db.zone.findMany();
  const sameName = all.filter(z => normPlace(z.name) === norm);
  if (!sameName.length) return null;
  const provNorm = province ? normPlace(province) : null;
  if (provNorm) {
    const byProv = sameName.find(z => z.province && normPlace(z.province) === provNorm);
    if (byProv) return byProv;
  }
  // un solo omonimo: è lui; più omonimi senza provincia: ambiguo, meglio
  // lasciar decidere a ensureZone con coordinate valide
  return sameName.length === 1 ? sameName[0] : null;
}

/**
 * Restituisce la zona corrispondente al posto indicato, creandola se non
 * esiste. Regole di riconoscimento (in ordine):
 *  1. stesso nome normalizzato E distanza ≤ 30 km → stessa zona (il centro
 *     resta quello già noto, provincia/regione vengono completate se mancano);
 *  2. stesso nome E stessa provincia normalizzata → stessa zona (omònimi
 *     diversi restano distinti);
 *  3. altrimenti → nuova zona (id slug, con suffisso se l'id è occupato).
 * Se il create scontra il vincolo UNIQUE dell'id (doppio invio o richiesta
 * gemella), il riconoscimento si ripete una volta: la zona ormai esiste e
 * viene restituita — il doppio clic non diventa più un errore 500.
 */
export async function ensureZone(spec: ZoneSpec, source = "user"): Promise<EnsureZoneResult> {
  const name = String(spec.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (name.length < 2) throw new ZoneNameError("BAD_ZONE_NAME");
  const lat = Number(spec.lat), lng = Number(spec.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inItalyBounds(lat, lng)) throw new ZonePositionError("BAD_ZONE_POS");
  const province = spec.province ? String(spec.province).trim().slice(0, 60) : null;
  const region = spec.region ? String(spec.region).trim().slice(0, 60) : null;
  const norm = normPlace(name);
  const provNorm = province ? normPlace(province) : null;

  const resolve = async (attempt: number): Promise<EnsureZoneResult> => {
    const all = await db.zone.findMany();
    const sameName = all.filter(z => normPlace(z.name) === norm);

    // 1) omonimo vicino: stesso posto
    let best: { z: Zone; km: number } | null = null;
    for (const z of sameName) {
      const km = distanceKm({ lat: z.gpsLat, lng: z.gpsLng }, { lat, lng });
      if (km <= 30 && (!best || km < best.km)) best = { z, km };
    }
    if (best) {
      const zone = await db.zone.update({
        where: { id: best.z.id },
        data: {
          province: best.z.province || province,
          region: best.z.region || region,
        },
      });
      return { zone, created: false };
    }

    // 2) omonimo lontano ma stessa provincia: comunque stesso posto
    const byProv = provNorm
      ? sameName.find(z => z.province && normPlace(z.province) === provNorm)
      : undefined;
    if (byProv) {
      const zone = await db.zone.update({
        where: { id: byProv.id },
        data: { province: byProv.province || province, region: byProv.region || region },
      });
      return { zone, created: false };
    }

    // 3) posto nuovo: id slug, con dedup per omonimi lontani
    const base = slugifyPlace(name);
    let id = base;
    if (all.some(z => z.id === id)) {
      const provSlug = provNorm ? provNorm.replace(/ /g, "-").slice(0, 12) : null;
      id = provSlug && !all.some(z => z.id === `${base}-${provSlug}`)
        ? `${base}-${provSlug}`
        : `${base}-2`;
      let n = 2;
      while (all.some(z => z.id === id)) { n += 1; id = `${base}-${n}`; }
    }

    try {
      const zone = await db.zone.create({
        data: {
          id,
          name,
          province,
          region,
          source,
          gpsLat: Math.round(lat * 1e6) / 1e6,
          gpsLng: Math.round(lng * 1e6) / 1e6,
          radiusM: Math.min(Math.max(Number(spec.radiusM) || 3000, 1000), 20000),
        },
      });
      return { zone, created: true };
    } catch (e) {
      // doppio invio / richiesta gemella: la zona è nata nel frattempo —
      // un secondo giro di riconoscimento la trova e la restituisce
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 1) {
        return resolve(attempt + 1);
      }
      throw e;
    }
  };

  return resolve(0);
}

export type EnsureZoneEntityResult = { entity: Entity; created: boolean };

/**
 * Assicura che la zona abbia la sua scheda recensibile (categoria "zona").
 * La convenzione dell'id (ent_z_<zona>) è quella usata dal seed e dai link
 * interni esistenti (es. #/zona/ent_z_milano).
 */
export async function ensureZoneEntity(
  zone: Zone,
  actor: { userId: string; isDemo: boolean },
): Promise<EnsureZoneEntityResult> {
  const existing = await db.entity.findFirst({
    where: { categoryId: "zona", zoneId: zone.id, status: "published" },
  });
  if (existing) return { entity: existing, created: false };

  const wantedId = `ent_z_${zone.id}`;
  const idTaken = await db.entity.findUnique({ where: { id: wantedId } });
  const ent = await db.entity.create({
    data: {
      id: idTaken ? undefined : wantedId,
      categoryId: "zona",
      name: zone.name,
      subtitle: zone.province ? `${zone.province}${zone.region ? ` · ${zone.region}` : ""}` : null,
      zoneId: zone.id,
      status: "published",
      proposedBy: `user:${actor.userId}`,
      isDemo: actor.isDemo,
    },
  });
  return { entity: ent, created: true };
}
