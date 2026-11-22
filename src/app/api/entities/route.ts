// POST /api/entities — contributo aperto: un utente registrato può aggiungere
// la scheda di un IMMOBILE a partire dal suo indirizzo reale (con posizione
// facoltativa da GPS o clic sulla mappa). È il modo in cui il catalogo cresce
// insieme ai contenuti: niente catalogo vuoto, ogni indirizzo è pubblico per
// natura. La scheda nasce pubblicata con proposta tracciata (proposedBy
// "user:<id>") ed è soggetta a moderazione come tutto il resto.
// COPERTURA NAZIONALE: la città può essere una qualsiasi località italiana
// (comune, paese o frazione, dalla ricerca geocodificata o dal reverse
// geocoding del GPS): se la zona non esiste ancora, viene creata al volo.
// INDIRIZZO STRUTTURATO: via (address), civico (streetNumber) e interno/scala
// (unit). In una via ci sono più civici e in un civico più unità (condomini):
// la discriminante della scheda è via + civico + interno nella stessa città.
// Anti-abuso: limite giornaliero per utente, dedup dell'indirizzo nella
// stessa città, validazione input.
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
import { ensureZone, ensureZoneEntity, findZoneByName, inItalyBounds, classifyZoneSaveError, ZoneNameError, ZonePositionError } from "@/lib/server/zones";
import { normAddress, normUnit, splitStreetCivico, sameBuilding } from "@/lib/address-norm";

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
      address?: string;        // via, piazza o largo (senza civico)
      streetNumber?: string;   // civico: "15", "15/A", "12bis"
      unit?: string;           // interno/scala (facoltativo): "interno 4", "scala B"
      zoneId?: string;
      zone?: { name?: string; province?: string | null; region?: string | null; lat?: number; lng?: number };
      geo?: { lat?: number; lng?: number };
    }>(req);
    // indirizzo strutturato: la via da una parte, il civico dall'altra.
    // Retrocompatibilità: se il civico non arriva separato (client vecchi),
    // lo si stacca dalla coda dell'indirizzo scritto di fila.
    let address = String(p.address || "").trim().replace(/\s+/g, " ").slice(0, 120);
    let streetNumber = String(p.streetNumber || "").trim().replace(/\s+/g, " ").slice(0, 10);
    const unit = String(p.unit || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!streetNumber) {
      const sp = splitStreetCivico(address);
      address = sp.street;
      streetNumber = sp.civico;
    }
    if (address.length < 3) return fail("Indica la via dell'immobile (almeno 3 caratteri).");
    if (unit.length === 1) return fail("L'interno/scala è troppo corto: scrivilo per esteso (es. «interno 4»).");
    // indirizzo completo di display e nome della scheda: con l'interno, il
    // nome lo porta a vedere («Via dei Mille 15, interno 4»)
    const fullAddress = [address, streetNumber].filter(Boolean).join(" ");

    // città: zona esistente (zoneId) OPPURE qualsiasi località italiana da
    // ricerca geocodificata o GPS (nome + coordinate). La risoluzione è a
    // gradini, così una località trovata resta confermabile anche se le
    // coordinate si perdono per strada (client vecchi, cache, GPS debole):
    //  1. zoneId → zona già sul catalogo (se non risolve, prova col nome);
    //  2. nome + coordinate valide → ensureZone (crea al volo se manca);
    //  3. nome + coordinate assenti/non valide → zona già nota col nome,
    //     altrimenti coordinate del PIN (geo), se presente e in Italia;
    //  4. niente di tutto questo → messaggio onesto, con log del perché.
    let zone: Awaited<ReturnType<typeof db.zone.findUnique>> | null = null;
    let zoneEntityCreated = false;
    let zoneCreated = false;
    const zoneName = p.zone ? String(p.zone.name || "").trim().replace(/\s+/g, " ").slice(0, 80) : "";
    if (p.zoneId) {
      zone = await db.zone.findUnique({ where: { id: String(p.zoneId) } });
    }
    if (!zone && zoneName.length >= 2) {
      const zlat = Number(p.zone?.lat), zlng = Number(p.zone?.lng);
      const zoneCoordsOk = Number.isFinite(zlat) && Number.isFinite(zlng) && inItalyBounds(zlat, zlng);
      // coordinate valide → ensureZone (dedup per nome+provincia+distanza)
      if (zoneCoordsOk) {
        try {
          const r = await ensureZone({
            name: zoneName,
            province: p.zone!.province || null,
            region: p.zone!.region || null,
            lat: zlat,
            lng: zlng,
          }, "user");
          zone = r.zone;
          zoneCreated = r.created;
        } catch (e) {
          if (e instanceof ZoneNameError || e instanceof ZonePositionError) {
            // input irrecuperabile per la geolocalizzazione: si può ancora
            // recuperare col nome (punto 3, qui sotto)
            console.warn("[entities] zona non geolocalizzabile:", e.message, JSON.stringify({ name: zoneName, lat: p.zone?.lat, lng: p.zone?.lng }));
          } else {
            // errore interno (database e simili): non mascherarlo da "fuori
            // Italia" — log dettagliato lato server + diagnosi onesta con
            // il rimedio (spesso è il database da aggiornare con db:push)
            console.error("[entities] errore interno in ensureZone:", e);
            const issue = classifyZoneSaveError(e);
            return fail(issue.message, 500, { zoneCode: issue.code });
          }
        }
      }
      // coordinate perse/non valide (o scartate): zona già nota col nome,
      // altrimenti coordinate del pin sulla mappa
      if (!zone) {
        const known = await findZoneByName(zoneName, p.zone!.province || null);
        if (known) {
          zone = known;
        } else if (p.geo && Number.isFinite(Number(p.geo.lat)) && Number.isFinite(Number(p.geo.lng))
          && inItalyBounds(Number(p.geo.lat), Number(p.geo.lng))) {
          try {
            const r = await ensureZone({
              name: zoneName,
              province: p.zone!.province || null,
              region: p.zone!.region || null,
              lat: Number(p.geo.lat),
              lng: Number(p.geo.lng),
            }, "user");
            zone = r.zone;
            zoneCreated = r.created;
          } catch (e) {
            if (e instanceof ZoneNameError || e instanceof ZonePositionError) {
              console.warn("[entities] zona non geolocalizzabile nemmeno col pin:", e.message, JSON.stringify({ name: zoneName, geo: p.geo }));
            } else {
              console.error("[entities] errore interno in ensureZone (da pin):", e);
              const issue = classifyZoneSaveError(e);
              return fail(issue.message, 500, { zoneCode: issue.code });
            }
          }
        }
      }
      if (zone && zoneCreated) {
        await auditLog({
          actorId: user.id, actorRole: user.role,
          action: "Nuova zona creata dal contributo (copertura nazionale)",
          targetType: "zone", targetId: zone.id,
          reason: `${zone.name}${zone.province ? ` (${zone.province})` : ""} — primo immobile: ${address}`,
          isDemo: user.isDemo,
        });
      }
    }
    if (!zone) {
      return fail("Seleziona la città in cui si trova l'immobile (qualsiasi comune o paese d'Italia): digitane il nome e scegli un suggerimento, oppure usa la mappa.");
    }

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

    // una scheda per via + civico + interno nella stessa città: se esiste già,
    // si recensisce quella. In una via ci sono più civici e in un civico più
    // unità (condomini): stesso indirizzo ma interno diverso = scheda nuova.
    // Il confronto tollera maiuscole/accenti/punteggiatura, il suffisso "città"
    // delle schede storiche e le schede d'epoca col civico dentro address.
    const target = {
      street: address,
      civico: streetNumber,
      fullNorm: normAddress(fullAddress),
      zoneNorm: normAddress(zone.name),
    };
    const myUnit = normUnit(unit);
    const inZone = await db.entity.findMany({
      where: { zoneId: zone.id, categoryId: "immobile", status: "published" },
      select: { id: true, name: true, address: true, streetNumber: true, unit: true },
    });
    const dup = inZone.find(e => sameBuilding(e, target) && normUnit(e.unit || "") === myUnit);
    if (dup) {
      return fail("Questo immobile risulta già presente: puoi recensire la scheda esistente.", 409, { existingId: dup.id });
    }

    const ent = await db.entity.create({
      data: {
        categoryId: "immobile",
        name: unit ? `${fullAddress}, ${unit}` : fullAddress,
        subtitle: null,
        address,
        streetNumber: streetNumber || null,
        unit: unit || null,
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
      reason: `Indirizzo: ${fullAddress}${unit ? `, ${unit}` : ""}, ${zone.name}${geo ? " con posizione indicata sulla mappa" : ""}.${zoneEntityCreated ? " Scheda zona attivata automaticamente." : ""}`,
      isDemo: ent.isDemo,
    });

    const pub = await publicEntity(ent.id, settings.minReviews);
    return NextResponse.json({ ok: true, entity: pub });
  } catch (e) {
    return handleError(e);
  }
}
