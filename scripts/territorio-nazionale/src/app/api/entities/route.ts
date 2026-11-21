// POST /api/entities — contributo aperto: un utente registrato può aggiungere
// la scheda di un IMMOBILE a partire dal suo indirizzo reale (con posizione
// facoltativa da GPS o clic sulla mappa). È il modo in cui il catalogo cresce
// insieme ai contenuti: niente catalogo vuoto, ogni indirizzo è pubblico per
// natura. La scheda nasce pubblicata con proposta tracciata (proposedBy
// "user:<id>") ed è soggetta a moderazione come tutto il resto.
// COPERTURA NAZIONALE: la città può essere una qualsiasi località italiana
// (comune, paese o frazione, dalla ricerca geocodificata o dal reverse
// geocoding del GPS): se la zona non esiste ancora, viene creata al volo.
// Anti-abuso: limite giornaliero per utente, dedup dell'indirizzo nella
// stessa città (una scheda per indirizzo), validazione input.
// Le altre categorie NON si creano da qui: le persone passano dalla proposta
// revisionata dalla moderazione (proponi-soggetto); le zone si attivano con
// POST /api/zones.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { publicEntity } from "@/lib/server/public-data";
import { auditLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { ensureZone, ensureZoneEntity, inItalyBounds } from "@/lib/server/zones";

// normalizza un indirizzo per il confronto: maiuscole, accenti e punteggiatura
// non devono creare schede duplicate dello stesso luogo
function normAddress(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "newentity", 20, 3600);
    const settings = await getSettings();
    if (!settings.openReviewsEnabled) {
      return fail("Il contributo aperto è temporaneamente sospeso: le nuove schede arrivano dalle proposte revisionate dalla moderazione.", 403);
    }
    // limite per utente (allineato a quello delle recensioni aperte)
    const rl = rateLimit(`newentity:${user.id}`, settings.openReviewsPerDay, 86400);
    if (!rl.ok) return fail(`Limite di ${settings.openReviewsPerDay} nuove schede al giorno raggiunto: riprova domani.`, 429);

    const p = await readJson<{
      address?: string;
      zoneId?: string;
      zone?: { name?: string; province?: string | null; region?: string | null; lat?: number; lng?: number };
      geo?: { lat?: number; lng?: number };
    }>(req);
    const address = String(p.address || "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (address.length < 5) return fail("Indica l'indirizzo dell'immobile (almeno 5 caratteri).");

    // città: zona esistente (zoneId, retrocompatibile) OPPURE qualsiasi
    // località italiana da ricerca geocodificata o GPS (nome + coordinate)
    let zone: Awaited<ReturnType<typeof db.zone.findUnique>> | null = null;
    let zoneEntityCreated = false;
    if (p.zoneId) {
      zone = await db.zone.findUnique({ where: { id: String(p.zoneId) } });
    } else if (p.zone && String(p.zone.name || "").trim().length >= 2) {
      try {
        const r = await ensureZone({
          name: String(p.zone.name),
          province: p.zone.province || null,
          region: p.zone.region || null,
          lat: Number(p.zone.lat),
          lng: Number(p.zone.lng),
        }, "user");
        zone = r.zone;
        if (r.created) {
          await auditLog({
            actorId: user.id, actorRole: user.role,
            action: "Nuova zona creata dal contributo (copertura nazionale)",
            targetType: "zone", targetId: zone.id,
            reason: `${zone.name}${zone.province ? ` (${zone.province})` : ""} — primo immobile: ${address}`,
            isDemo: user.isDemo,
          });
        }
      } catch {
        return fail("La località indicata non risulta in Italia: cerca la città sulla mappa o digitane il nome.");
      }
    }
    if (!zone) return fail("Seleziona la città in cui si trova l'immobile (qualsiasi comune o paese d'Italia).");

    // ogni zona del catalogo ha la sua scheda recensibile: nasce insieme alla
    // zona (o al primo immobile che la menziona), così il link #/zona/… non
    // porta mai a una pagina inesistente
    const zoneSheet = await ensureZoneEntity(zone, { userId: user.id, isDemo: user.isDemo });
    zoneEntityCreated = zoneSheet.created;

    let geo: { lat: number; lng: number } | null = null;
    if (p.geo && Number.isFinite(Number(p.geo.lat)) && Number.isFinite(Number(p.geo.lng))) {
      const lat = Number(p.geo.lat), lng = Number(p.geo.lng);
      if (!inItalyBounds(lat, lng)) return fail("La posizione indicata non cade entro i confini dell'Italia.");
      geo = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    }

    // una scheda per indirizzo nella stessa città: se esiste già, si recensisce quella.
    // Il confronto tollera maiuscole/accenti/punteggiatura e il suffisso "città"
    // usato nelle schede storiche (es. "Via X 1, Milano" ≡ "Via X 1").
    const norm = normAddress(address);
    const zoneNorm = normAddress(zone.name);
    const matches = (a: string) => a === norm || a === `${norm} ${zoneNorm}`;
    const inZone = await db.entity.findMany({
      where: { zoneId: zone.id, categoryId: "immobile", status: "published" },
      select: { id: true, name: true, address: true },
    });
    const dup = inZone.find(e => matches(normAddress(e.address || e.name)));
    if (dup) {
      return fail("Questo immobile risulta già presente: puoi recensire la scheda esistente.", 409, { existingId: dup.id });
    }

    const ent = await db.entity.create({
      data: {
        categoryId: "immobile",
        name: address,
        subtitle: null,
        address,
        zoneId: zone.id,
        geoLat: geo ? geo.lat : null,
        geoLng: geo ? geo.lng : null,
        status: "published",
        proposedBy: `user:${user.id}`,
        isDemo: user.isDemo,
      },
    });
    await auditLog({
      actorId: user.id, actorRole: user.role,
      action: "Scheda immobile aggiunta dall'utente (contributo aperto)",
      targetType: "entity", targetId: ent.id,
      reason: `Indirizzo: ${address}, ${zone.name}${geo ? " con posizione indicata sulla mappa" : ""}.${zoneEntityCreated ? " Scheda zona attivata automaticamente." : ""}`,
      isDemo: ent.isDemo,
    });

    const pub = await publicEntity(ent.id, settings.minReviews);
    return NextResponse.json({ ok: true, entity: pub });
  } catch (e) {
    return handleError(e);
  }
}
