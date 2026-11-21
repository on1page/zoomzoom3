// POST /api/entities — contributo aperto: un utente registrato può aggiungere
// la scheda di un IMMOBILE a partire dal suo indirizzo reale (con posizione
// facoltativa da GPS o clic sulla mappa). È il modo in cui il catalogo cresce
// insieme ai contenuti: niente catalogo vuoto, ogni indirizzo è pubblico per
// natura. La scheda nasce pubblicata con proposta tracciata (proposedBy
// "user:<id>") ed è soggetta a moderazione come tutto il resto.
// Anti-abuso: limite giornaliero per utente, dedup dell'indirizzo nella
// stessa città (una scheda per indirizzo), validazione input.
// Le altre categorie NON si creano da qui: le persone passano dalla proposta
// revisionata dalla moderazione (proponi-soggetto), le zone esistono già.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { publicEntity } from "@/lib/server/public-data";
import { auditLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

// normalizza un indirizzo per il confronto: maiuscole, accenti e punteggiatura
// non devono creare schede duplicate dello stesso luogo
function normAddress(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// confini approssimati dell'Italia (con margine) per le posizioni dichiarate
function inItaly(lat: number, lng: number): boolean {
  return lat >= 34 && lat <= 48.5 && lng >= 5.5 && lng <= 19.5;
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

    const p = await readJson<{ address?: string; zoneId?: string; geo?: { lat?: number; lng?: number } }>(req);
    const address = String(p.address || "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (address.length < 5) return fail("Indica l'indirizzo dell'immobile (almeno 5 caratteri).");
    const zone = await db.zone.findUnique({ where: { id: String(p.zoneId || "") } });
    if (!zone) return fail("Seleziona la città in cui si trova l'immobile.");
    let geo: { lat: number; lng: number } | null = null;
    if (p.geo && Number.isFinite(Number(p.geo.lat)) && Number.isFinite(Number(p.geo.lng))) {
      const lat = Number(p.geo.lat), lng = Number(p.geo.lng);
      if (!inItaly(lat, lng)) return fail("La posizione indicata non cade entro i confini dell'Italia.");
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
      reason: `Indirizzo: ${address}, ${zone.name}${geo ? " con posizione indicata sulla mappa" : ""}.`,
      isDemo: ent.isDemo,
    });

    const pub = await publicEntity(ent.id, settings.minReviews);
    return NextResponse.json({ ok: true, entity: pub });
  } catch (e) {
    return handleError(e);
  }
}
