// GET /api/consulente/bacheca — la bacheca di zona del consulente approvato:
// le richieste «open» (senza consulente incaricato) per immobili nelle zone
// che copre. K9 del modello D11: NESSUN dato identificativo del richiedente
// esce da questa rotta — né nickname né email — né ora né mai: il nickname
// diventa visibile al consulente solo dopo l'accettazione dell'incarico.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { handleError, fail } from "@/lib/server/http";
import { sweepPerizie } from "@/lib/server/perizie";
import { distanceKm } from "@/lib/server/zones";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const prof = await db.consultantProfile.findUnique({
      where: { userId: user.id },
      include: { zone: true },
    });
    if (!prof || prof.status !== "approved") {
      return fail("La bacheca di zona è riservata ai consulenti approvati.", 403);
    }

    const settings = await getSettings();
    await sweepPerizie(settings);

    const open = await db.periziaRequest.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { zone: true },
    });

    // copertura: il centro della zona della richiesta entro il raggio d'azione
    const rows = open
      .filter(r => r.zone && distanceKm(
        { lat: prof.zone.gpsLat, lng: prof.zone.gpsLng },
        { lat: r.zone.gpsLat, lng: r.zone.gpsLng },
      ) <= prof.radiusKm)
      .map(r => ({
        id: r.id,
        code: r.code,
        kind: r.kind,
        address: r.address,
        zoneName: r.zone!.name,
        province: r.zone!.province,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
        // richieste ripubblicate dopo un incarico nullo: tariffa già versata
        voidCount: r.voidCount,
        feeCents: r.voidCount > 0 ? r.feeCents : null,
        // MAI dati del richiedente (K9): nessun nickname, nessuna email
        requesterHidden: true,
      }));

    return NextResponse.json({
      ok: true,
      radiusKm: prof.radiusKm,
      zone: { name: prof.zone.name, province: prof.zone.province },
      rows,
    });
  } catch (e) {
    return handleError(e);
  }
}
