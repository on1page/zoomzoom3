// POST /api/consulente/requests — un utente registrato chiede una perizia
// tecnica o una valutazione immobiliare. Due ingressi (modello D11, percorso ③):
//   · DIRETTO: a un consulente approvato indicato per userId/entityId — la
//     richiesta nasce «requested» e quel consulente accetta o rifiuta;
//   · BACHECA DI ZONA: senza consulente — la richiesta nasce «open», la vedono
//     gli approvati che coprono la zona (avviso via email, senza dati
//     identificativi del richiedente, K9) e il primo che la ritira («claim»)
//     diventa il consulente incaricato. Se nessuno accetta entro
//     bachecaExpiryDays giorni la richiesta scade («expired») e il
//     richiedente può riproporla o annullarla.
// Nessun pagamento qui: l'utente paga DOPO l'accettazione, con bonifico
// tracciato usando la causale-codice della richiesta (PZ-XXXXXX); la
// piattaforma accredita il consulente (meno il 10%) solo a relazione consegnata.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { PERIZIA_KINDS } from "@/lib/server/consultants";
import {
  bachecaInviteBody, emailConsultantsOfZone, uniquePeriziaCode, sweepPerizie,
} from "@/lib/server/perizie";
import { sendMail } from "@/lib/server/mailer";
import { auditLog } from "@/lib/server/audit";

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
      zone?: { name?: string; province?: string | null; region?: string | null; lat?: number; lng?: number };
      description?: string;
    }>(req);

    // ingresso: diretto (consulente indicato) oppure bacheca di zona
    const where = p.consultantUserId
      ? { userId: String(p.consultantUserId) }
      : p.entityId
        ? { entityId: String(p.entityId) }
        : null;
    const bacheca = !where;
    if (bacheca && !settings.periziaBachecaEnabled) {
      return fail("La bacheca di zona è temporaneamente sospesa: indica un consulente dalla sua scheda.", 403);
    }
    let prof: { id: string; userId: string; status: string } | null = null;
    if (where) {
      prof = await db.consultantProfile.findUnique({ where });
      if (!prof || prof.status !== "approved") {
        return fail("Questo consulente non è al momento disponibile.", 404);
      }
      if (prof.userId === user.id) {
        return fail("Non puoi richiedere una perizia a te stesso.");
      }
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

    // la città è OBBLIGATORIA per ogni nuova richiesta: serve alla bacheca
    // (chi copre la zona?) e alla chiusura del cerchio (K7: la scheda
    // dell'indirizzo nasce nella zona giusta). Zona del catalogo o qualsiasi
    // località italiana geocodificata (come per i consulenti e gli immobili).
    let zoneId: string | null = null;
    let zone: { id: string; name: string; province: string | null; gpsLat: number; gpsLng: number } | null = null;
    if (p.zoneId) {
      const z = await db.zone.findUnique({ where: { id: String(p.zoneId) } });
      if (z) { zoneId = z.id; zone = z; }
    }
    if (!zoneId && p.zone) {
      const name = String(p.zone.name || "").trim().slice(0, 80);
      const lat = Number(p.zone.lat), lng = Number(p.zone.lng);
      if (name.length >= 2 && Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= 34 && lat <= 48.5 && lng >= 5.5 && lng <= 19.5) {
        const { ensureZone } = await import("@/lib/server/zones");
        try {
          const r = await ensureZone({
            name,
            province: p.zone.province || null,
            region: p.zone.region || null,
            lat, lng,
          }, "user");
          zoneId = r.zone.id; zone = r.zone;
        } catch { zoneId = null; }
      }
    }
    if (!zoneId || !zone) {
      return fail("Seleziona la città dell'immobile (cerca la località e scegli un suggerimento): serve per trovare i consulenti che coprono la zona.");
    }

    // anti-abuso bacheca: chi tiene troppe richieste aperte in bacheca
    if (bacheca) {
      const openCount = await db.periziaRequest.count({
        where: { requesterId: user.id, status: { in: ["open", "expired"] } },
      });
      if (openCount >= 3) {
        return fail("Hai già 3 richieste in bacheca in attesa: attendi un consulente o annullane qualcuna.", 429);
      }
    }

    await sweepPerizie(settings);

    const code = await uniquePeriziaCode();
    const r = await db.periziaRequest.create({
      data: {
        requesterId: user.id,
        consultantId: prof ? prof.id : null,
        kind, address, description, zoneId, code,
        status: bacheca ? "open" : "requested",
        expiresAt: bacheca ? new Date(Date.now() + settings.bachecaExpiryDays * 86400000) : null,
      },
      include: { zone: true },
    });

    // avvisi (K9: al consulente non arrivano MAI dati identificativi del
    // richiedente, né in bacheca né prima dell'accettazione)
    if (bacheca && r.zone) {
      void emailConsultantsOfZone(
        r.zone,
        "ZoomZoom — nuova richiesta di indagine nella tua zona",
        bachecaInviteBody({
          kind: r.kind, address: r.address, description: r.description,
          zone: { name: r.zone.name, province: r.zone.province },
          expiresAt: r.expiresAt!,
        }, settings.bachecaExpiryDays),
      );
    }
    void sendMail(
      user.email,
      bacheca ? "ZoomZoom — richiesta pubblicata in bacheca di zona" : "ZoomZoom — richiesta inviata al consulente",
      bacheca
        ? `La tua richiesta di ${kind.toLowerCase()} per «${address}» è in bacheca di zona: i consulenti che coprono ${r.zone!.name} sono stati avvisati.\nSe nessuno accetta entro ${settings.bachecaExpiryDays} giorni la richiesta scade e potrai riproporla o annullarla. Il pagamento si fa solo dopo l'accettazione di un consulente, con la causale-codice che ti verrà indicata.`
        : `La tua richiesta di ${kind.toLowerCase()} per «${address}» è stata inviata al consulente: se la accetta, pagherai la tariffa confermata con bonifico usando la causale-codice ${code}.\nPuoi seguire lo stato dalla pagina «Le mie richieste».`,
      [{ label: "Le mie richieste", href: "/#/consulente-richieste" }],
    );
    await auditLog({
      actorId: user.id, actorRole: user.role,
      action: bacheca ? "Richiesta di indagine pubblicata in bacheca di zona" : "Richiesta di perizia inviata a un consulente",
      targetType: "periziaRequest", targetId: r.id,
      reason: `${kind}: ${address}, ${r.zone!.name}`,
      isDemo: user.isDemo,
    });

    return NextResponse.json({
      ok: true,
      requestId: r.id,
      code,
      bacheca,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
