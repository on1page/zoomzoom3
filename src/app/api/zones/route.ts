// POST /api/zones — attiva la scheda recensibile di una città/zona su TUTTO
// il territorio nazionale: se il posto (comune, paese, frazione) non è ancora
// nel catalogo, viene creato in questo momento con nome, provincia, regione
// e coordinate reali dalla geocodifica OpenStreetMap. È la porta d'ingresso
// per recensire posti fuori dalle città di partenza: "la mia città non c'è"
// smette di essere un vicolo cieco.
// La zona viene creata una sola volta (dedup per nome+provincia+distanza,
// vedi lib/server/zones.ts): chiamate ripetute restituiscono la stessa scheda.
// Anti-abuso: richiede utente verificato, contributo aperto attivo, stesso
// budget giornaliero delle nuove schede immobile.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { auditLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { ensureZone, ensureZoneEntity } from "@/lib/server/zones";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "newzone", 20, 3600);
    const settings = await getSettings();
    if (!settings.openReviewsEnabled) {
      return fail("Il contributo aperto è temporaneamente sospeso: le nuove zone tornano disponibili appena riattivato.", 403);
    }
    // stesso budget giornaliero delle nuove schede immobile
    const rl = rateLimit(`newentity:${user.id}`, settings.openReviewsPerDay, 86400);
    if (!rl.ok) return fail(`Limite di ${settings.openReviewsPerDay} nuove schede al giorno raggiunto: riprova domani.`, 429);

    const p = await readJson<{
      name?: string;
      province?: string | null;
      region?: string | null;
      lat?: number;
      lng?: number;
    }>(req);
    const name = String(p.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (name.length < 2) return fail("Indica il nome della località (almeno 2 caratteri).");

    let zoneRes;
    try {
      zoneRes = await ensureZone({
        name,
        province: p.province || null,
        region: p.region || null,
        lat: Number(p.lat),
        lng: Number(p.lng),
      }, "user");
    } catch {
      return fail("Non riesco a collocare questa località in Italia: cercala sulla mappa o prova con il nome del comune.");
    }

    const zone = zoneRes.zone;
    const entRes = await ensureZoneEntity(zone, { userId: user.id, isDemo: user.isDemo });

    if (zoneRes.created || entRes.created) {
      await auditLog({
        actorId: user.id, actorRole: user.role,
        action: entRes.created
          ? "Scheda zona attivata dall'utente (copertura nazionale)"
          : "Zona creata dal contributo (copertura nazionale)",
        targetType: "entity", targetId: entRes.entity.id,
        reason: `${zone.name}${zone.province ? ` (${zone.province})` : ""}${zone.region ? ` · ${zone.region}` : ""}`,
        isDemo: user.isDemo,
      });
    }

    return NextResponse.json({
      ok: true,
      zoneId: zone.id,
      name: zone.name,
      province: zone.province,
      entityId: entRes.entity.id,
      created: entRes.created,
    });
  } catch (e) {
    return handleError(e);
  }
}
