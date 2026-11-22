// POST /api/consulente/requests — un utente registrato chiede una perizia
// tecnica o una valutazione immobiliare a un consulente APPROVATO. La
// richiesta nasce "requested": sarà il consulente ad accettarla (confer-
// mando la tariffa) o rifiutarla. Nessun pagamento qui: l'utente paga DOPO
// l'accettazione e la piattaforma accredita il consulente (meno il 10%)
// solo a relazione consegnata.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { PERIZIA_KINDS } from "@/lib/server/consultants";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "consulente-request", 20, 3600);
    const settings = await getSettings();
    if (!settings.consulentiEnabled) {
      return fail("Il servizio di perizie dei Consulenti Tecnici è temporaneamente sospeso.", 403);
    }
    // anti-abuso: max 5 richieste/giorno per utente
    const rl = rateLimit(`perizia:${user.id}`, 5, 86400);
    if (!rl.ok) return fail("Hai già inviato 5 richieste nelle ultime 24 ore: riprova domani.", 429);

    const p = await readJson<{
      consultantUserId?: string; entityId?: string;
      kind?: string; address?: string; zoneId?: string;
      description?: string;
    }>(req);

    // il consulente si indica per userId o per scheda pubblica
    const where = p.consultantUserId
      ? { userId: String(p.consultantUserId) }
      : p.entityId
        ? { entityId: String(p.entityId) }
        : null;
    if (!where) return fail("Indica il consulente a cui rivolgi la richiesta.");
    const prof = await db.consultantProfile.findUnique({ where });
    if (!prof || prof.status !== "approved") {
      return fail("Questo consulente non è al momento disponibile.", 404);
    }
    if (prof.userId === user.id) {
      return fail("Non puoi richiedere una perizia a te stesso.");
    }

    const kind = String(p.kind || "");
    if (!(PERIZIA_KINDS as readonly string[]).includes(kind)) {
      return fail("Scegli il tipo di richiesta (perizia tecnica o valutazione immobiliare).");
    }
    const address = String(p.address || "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (address.length < 5) return fail("Indica l'indirizzo dell'immobile oggetto della richiesta.");
    const description = String(p.description || "").trim().slice(0, 4000);
    if (description.length < 30) {
      return fail("Descrivi la richiesta con almeno 30 caratteri: servirà al consulente per valutarla.");
    }
    let zoneId: string | null = null;
    if (p.zoneId) {
      const z = await db.zone.findUnique({ where: { id: String(p.zoneId) } });
      if (z) zoneId = z.id;
    }

    const r = await db.periziaRequest.create({
      data: {
        requesterId: user.id,
        consultantId: prof.id,
        kind, address, description, zoneId,
      },
    });
    return NextResponse.json({ ok: true, requestId: r.id });
  } catch (e) {
    return handleError(e);
  }
}
