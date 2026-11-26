// GET  /api/consulente/me — profilo del consulente (se iscritto) con le
//   richieste ricevute (come consulente) e quelle inviate (come utente).
// PATCH /api/consulente/me — aggiorna i soli campi modificabili dopo
//   l'approvazione (presentazione, tariffa, raggio, telefono): i dati
//   anagrafici e professionali richiedono una nuova domanda approvata.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { readJson, handleError, fail } from "@/lib/server/http";
import { eurosToCents } from "@/lib/server/consultants";
import { sweepPerizie } from "@/lib/server/perizie";

export const dynamic = "force-dynamic";

async function serializeRequests(view: "consultant" | "requester", userId: string, settings: Awaited<ReturnType<typeof getSettings>>) {
  const rows = await db.periziaRequest.findMany({
    where: view === "consultant" ? { consultant: { userId } } : { requesterId: userId },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: {
      consultant: { include: { zone: true } },
      requester: { select: { nickname: true } },
      zone: true,
    },
  });
  return rows.map(r => {
    // K9 (modello D11, impostazione periziaHideRequesterUntilAccept): il
    // nickname del richiedente arriva al consulente solo DOPO l'accettazione
    // (accepted/paid/delivered/closed); finché è in attesa resta riservato
    const requesterVisibleToConsultant = !settings.periziaHideRequesterUntilAccept
      || ["accepted", "paid", "delivered", "closed"].includes(r.status);
    return {
      id: r.id,
      code: r.code,
      kind: r.kind,
      address: r.address,
      zoneId: r.zoneId,
      zoneName: r.zone ? r.zone.name : null,
      description: r.description,
      status: r.status,
      feeCents: r.feeCents,
      rejectReason: r.rejectReason,
      reportTitle: r.reportTitle,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      paidAt: r.paidAt?.toISOString() ?? null,
      deadlineAt: r.deadlineAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      voidCount: r.voidCount,
      entityId: r.entityId,
      payoutCents: r.payoutCents,
      commissionCents: r.commissionCents,
      createdAt: r.createdAt.toISOString(),
      // lato consulente il nickname del richiedente (dopo l'accettazione, se
      // K9 attivo); lato richiedente il nome del consulente (mai l'email).
      // La richiesta in bacheca (consulente NULL) per il richiedente dice
      // «bacheca di zona», per il consulente non compare affatto (sta nella
      // bacheca dedicata, senza dati del richiedente).
      counterpart: view === "consultant"
        ? { nickname: requesterVisibleToConsultant ? r.requester.nickname : null }
        : r.consultant
          ? { name: `${r.consultant.firstName} ${r.consultant.lastName}`, profession: r.consultant.profession }
          : { name: null, profession: null, bacheca: true },
      canDeliver: view === "consultant" && r.status === "paid",
      canAccept: view === "consultant" && r.status === "requested",
      canReject: view === "consultant" && r.status === "requested",
      canCancel: view === "requester" && ["requested", "accepted", "open", "expired"].includes(r.status),
      canRepropose: view === "requester" && r.status === "expired",
    };
  });
}

export async function GET() {
  try {
    const user = await requireUser();
    const settings = await getSettings();
    // scadenze maturate (bacheca scaduta, incarico nullo) applicate prima di
    // leggere: l'utente vede sempre lo stato reale
    await sweepPerizie(settings);
    const prof = await db.consultantProfile.findUnique({
      where: { userId: user.id },
      include: { zone: true, docs: { select: { id: true, kind: true, originalName: true, sizeBytes: true, createdAt: true } } },
    });
    const [incoming, outgoing] = await Promise.all([
      serializeRequests("consultant", user.id, settings),
      serializeRequests("requester", user.id, settings),
    ]);
    return NextResponse.json({
      ok: true,
      profile: prof ? {
        id: prof.id,
        firstName: prof.firstName, lastName: prof.lastName,
        hasPhoto: prof.photoData != null,
        profession: prof.profession, title: prof.title, bio: prof.bio,
        zone: { id: prof.zone.id, name: prof.zone.name, province: prof.zone.province, region: prof.zone.region },
        radiusKm: prof.radiusKm, feeCents: prof.feeCents,
        vatNumber: prof.vatNumber, iban: prof.iban, phone: prof.phone,
        ibanCheck: prof.ibanCheck, ibanCheckedAt: prof.ibanCheckedAt?.toISOString() ?? null,
        status: prof.status, rejectReason: prof.rejectReason,
        entityId: prof.entityId,
        incarichiCompletati: prof.incarichiCompletati,
        incarichiNulli: prof.incarichiNulli,
        docs: prof.docs,
        createdAt: prof.createdAt.toISOString(),
      } : null,
      incoming, outgoing,
      payment: {
        iban: settings.platformIban,
        instructions: settings.paymentInstructions,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const prof = await db.consultantProfile.findUnique({ where: { userId: user.id } });
    if (!prof || prof.status !== "approved") {
      return fail("Profilo consulente non approvato: impossibile modificare.", 403);
    }
    const p = await readJson<{ bio?: string; feeEuros?: number | string; radiusKm?: number; phone?: string }>(req);

    const data: Record<string, unknown> = {};
    if (p.bio !== undefined) data.bio = String(p.bio).trim().slice(0, 2000) || null;
    if (p.feeEuros !== undefined) {
      const cents = eurosToCents(p.feeEuros);
      if (cents == null || cents > 100_000_00) return fail("Tariffa non valida (max 100.000 €).", 400);
      data.feeCents = cents;
    }
    if (p.radiusKm !== undefined) {
      const r = Math.round(Number(p.radiusKm));
      if (!Number.isFinite(r) || r < 5 || r > 300) return fail("Il raggio di azione deve essere tra 5 e 300 km.", 400);
      data.radiusKm = r;
    }
    if (p.phone !== undefined) data.phone = String(p.phone).trim().slice(0, 40) || null;

    if (!Object.keys(data).length) return fail("Nessun campo modificabile indicato.", 400);
    await db.consultantProfile.update({ where: { id: prof.id }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
