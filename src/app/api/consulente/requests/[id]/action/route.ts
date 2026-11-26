// POST /api/consulente/requests/[id]/action — le transizioni di stato
// delle richieste di perizia, ognuna autorizzata dal ruolo giusto:
//   accept   — il CONSULENTE accetta e conferma la tariffa (in centesimi)
//   claim    — il CONSULENTE ritira l'incarico dalla BACHECA DI ZONA
//              (confermando la tariffa; se la richiesta è ripubblicata dopo
//              un incarico nullo, la tariffa resta quella già versata)
//   reject   — il CONSULENTE rifiuta (motivo obbligatorio)
//   cancel   — il RICHIEDENTE annulla (prima del pagamento: anche dalla
//              bacheca, aperta o scaduta)
//   repropose— il RICHIEDENTE ripropone una richiesta scaduta in bacheca
//              (nuova scadenza + nuovo invito ai consulenti della zona)
//   pay      — il SUPER AMMINISTRATORE registra il pagamento ricevuto:
//              parte il termine di periziaDeadlineDays giorni per la consegna
//   deliver  — il CONSULENTE consegna la relazione (solo dopo il pagamento,
//              con 2FA attiva): qui si calcolano accredito (90%) e
//              commissione (10%) e la scheda dell'indirizzo nasce o si
//              aggiorna con l'indagine certificata (chiusura del cerchio, K7)
//   payout   — il SUPER AMMINISTRATORE registra l'accredito eseguito
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, requireStaff } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { assertSameOrigin, readJson, handleError, fail } from "@/lib/server/http";
import { auditLog } from "@/lib/server/audit";
import { eurosToCents, splitFee } from "@/lib/server/consultants";
import { ensureEntityForPerizia, sweepPerizie } from "@/lib/server/perizie";
import { sendMail } from "@/lib/server/mailer";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const p = await readJson<{
      action?: string; feeEuros?: number | string; reason?: string;
      title?: string; body?: string; publicSummary?: string; paymentRef?: string;
    }>(req);

    const settings = await getSettings();
    await sweepPerizie(settings);

    const r = await db.periziaRequest.findUnique({
      where: { id },
      include: {
        consultant: { include: { user: { select: { email: true } }, zone: true } },
        requester: { select: { id: true, nickname: true, email: true, isDemo: true } },
        zone: true,
      },
    });
    if (!r) return fail("Richiesta non trovata.", 404);

    /* ---------- azioni del consulente ---------- */
    if (p.action === "accept" || p.action === "reject" || p.action === "claim") {
      const user = await requireUser();
      // profilo del consulente che agisce: serve sempre, approvato
      const myProf = await db.consultantProfile.findUnique({ where: { userId: user.id } });
      if (!myProf || myProf.status !== "approved") {
        return fail("Il tuo profilo consulente non è approvato.", 403);
      }

      if (p.action === "claim") {
        // ritiro dalla BACHECA DI ZONA: la richiesta non ha ancora un
        // consulente (r.consultant è NULL) ed è «open»; la ritira chi agisce
        if (r.consultant) return fail("L'incarico è già stato ritirato da un consulente.", 409);
        if (r.status !== "open") return fail("L'incarico non è più disponibile in bacheca.", 409);
        // tariffa: per le richieste ripubblicate dopo un incarico nullo resta
        // quella GIÀ VERSATA dal richiedente; per le nuove la conferma il
        // consulente (default: quella del profilo)
        let cents: number | null;
        if (r.voidCount > 0) {
          cents = r.feeCents ?? null;
          if (cents == null) return fail("Tariffa già versata non disponibile: contatta l'amministrazione.", 409);
        } else {
          cents = p.feeEuros === undefined || p.feeEuros === ""
            ? myProf.feeCents
            : eurosToCents(p.feeEuros);
        }
        if (cents == null || cents < 100) {
          return fail("Conferma una tariffa di almeno 1 € per ritirare l'incarico.", 400);
        }
        if (cents > 100_000_00) return fail("Tariffa non valida (max 100.000 €).", 400);
        await db.periziaRequest.update({
          where: { id: r.id },
          data: { status: "accepted", consultantId: myProf.id, feeCents: cents, expiresAt: null },
        });
        await auditLog({ actorId: user.id, actorRole: user.role, action: "perizia.claim", targetType: "periziaRequest", targetId: r.id, reason: `incarico ritirato dalla bacheca · tariffa ${cents} cent` });
        void sendMail(
          r.requester.email,
          "ZoomZoom — un consulente ha accettato la tua richiesta",
          `Il consulente ${myProf.firstName} ${myProf.lastName} (${myProf.profession}) ha ritirato l'incarico dalla bacheca${r.voidCount > 0 ? ", alle condizioni già versate" : ""}.\nTariffa confermata: € ${(cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}.\nOra puoi saldare: usa la causale-codice ${r.code} nel bonifico (la trovi anche nella pagina «Le mie richieste»). La relazione arriva entro ${settings.periziaDeadlineDays} giorni dal pagamento registrato.`,
          [{ label: "Le mie richieste", href: "/#/consulente-richieste" }],
        );
        return NextResponse.json({ ok: true, status: "accepted", feeCents: cents });
      }

      // accept / reject: richieste DIRETTE, già assegnate a questo consulente
      if (!r.consultant || r.consultant.userId !== user.id) {
        return fail("Solo il consulente incaricato può compiere questa azione.", 403);
      }

      if (p.action === "reject") {
        if (r.status !== "requested") return fail("La richiesta non è più in attesa di risposta.", 409);
        const reason = String(p.reason || "").trim().slice(0, 500);
        if (reason.length < 5) return fail("Indica brevemente il motivo del rifiuto.");
        await db.periziaRequest.update({
          where: { id: r.id },
          data: { status: "rejected", rejectReason: reason },
        });
        await auditLog({ actorId: user.id, actorRole: user.role, action: "perizia.reject", targetType: "periziaRequest", targetId: r.id, reason });
        return NextResponse.json({ ok: true, status: "rejected" });
      }

      // accept (richiesta diretta): la tariffa proposta dal consulente
      if (r.status !== "requested") return fail("La richiesta non è più in attesa di risposta.", 409);
      const cents = p.feeEuros === undefined || p.feeEuros === ""
        ? r.consultant.feeCents
        : eurosToCents(p.feeEuros);
      if (cents == null || cents < 100) {
        return fail("Conferma una tariffa di almeno 1 € per accettare l'incarico.", 400);
      }
      if (cents > 100_000_00) return fail("Tariffa non valida (max 100.000 €).", 400);
      await db.periziaRequest.update({
        where: { id: r.id },
        data: { status: "accepted", feeCents: cents },
      });
      await auditLog({ actorId: user.id, actorRole: user.role, action: "perizia.accept", targetType: "periziaRequest", targetId: r.id, reason: `tariffa ${cents} cent` });
      void sendMail(
        r.requester.email,
        "ZoomZoom — richiesta accettata: puoi saldare la tariffa",
        `Il consulente ${r.consultant.firstName} ${r.consultant.lastName} ha accettato l'incarico.\nTariffa confermata: € ${(cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}.\nPer saldare usa la causale-codice ${r.code} nel bonifico (la trovi anche nella pagina «Le mie richieste»).`,
        [{ label: "Le mie richieste", href: "/#/consulente-richieste" }],
      );
      return NextResponse.json({ ok: true, status: "accepted", feeCents: cents });
    }

    /* ---------- azioni del richiedente ---------- */
    if (p.action === "cancel" || p.action === "repropose") {
      const user = await requireUser();
      if (r.requesterId !== user.id) return fail("Solo chi ha fatto la richiesta può compiere questa azione.", 403);

      if (p.action === "cancel") {
        if (!["requested", "accepted", "open", "expired"].includes(r.status)) {
          return fail("La richiesta non può più essere annullata in questo stato.", 409);
        }
        await db.periziaRequest.update({ where: { id: r.id }, data: { status: "cancelled", expiresAt: null } });
        await auditLog({ actorId: user.id, actorRole: user.role, action: "perizia.cancel", targetType: "periziaRequest", targetId: r.id });
        return NextResponse.json({ ok: true, status: "cancelled" });
      }

      // repropose: una richiesta scaduta in bacheca torna disponibile
      if (r.status !== "expired") return fail("Si ripropone solo una richiesta scaduta in bacheca.", 409);
      const expiresAt = new Date(Date.now() + settings.bachecaExpiryDays * 86400000);
      await db.periziaRequest.update({
        where: { id: r.id },
        data: { status: "open", expiresAt },
      });
      await auditLog({
        actorId: user.id, actorRole: user.role, action: "perizia.repropose",
        targetType: "periziaRequest", targetId: r.id,
        reason: `ripubblicata in bacheca fino al ${expiresAt.toLocaleDateString("it-IT")}`,
      });
      if (r.zone) {
        const { emailConsultantsOfZone, bachecaInviteBody } = await import("@/lib/server/perizie");
        void emailConsultantsOfZone(
          r.zone,
          "ZoomZoom — nuova richiesta di indagine nella tua zona",
          bachecaInviteBody({
            kind: r.kind, address: r.address, description: r.description,
            zone: { name: r.zone.name, province: r.zone.province },
            expiresAt,
          }, settings.bachecaExpiryDays),
        );
      }
      return NextResponse.json({ ok: true, status: "open", expiresAt: expiresAt.toISOString() });
    }

    /* ---------- consegna della relazione (consulente) ---------- */
    if (p.action === "deliver") {
      const user = await requireUser();
      if (!r.consultant || r.consultant.userId !== user.id) return fail("Solo il consulente incaricato può consegnare la relazione.", 403);
      if (!user.totpEnabled) return fail("Attiva la verifica in due passaggi (2FA) per consegnare le relazioni.", 403);
      if (r.status !== "paid") return fail("La relazione si consegna dopo la registrazione del pagamento.", 409);
      if (r.deadlineAt && r.deadlineAt.getTime() < Date.now()) {
        return fail("Il termine per consegnare è scaduto: l'incarico risulta nullo. Contatta l'amministrazione se è un errore.", 409);
      }

      const title = String(p.title || "").trim().replace(/\s+/g, " ").slice(0, 160);
      if (title.length < 5) return fail("Dai un titolo alla relazione.");
      const body = String(p.body || "").trim().slice(0, 30000);
      if (body.length < 300) return fail("La relazione deve essere di almeno 300 caratteri: è il documento che il richiedente porterà con sé.");
      // sintesi pubblica facoltativa: compare sulla scheda dell'indirizzo
      // (chiusura del cerchio). Nessun dato personale di terzi.
      const publicSummary = String(p.publicSummary || "").trim().slice(0, 600) || null;

      const { payoutCents, commissionCents } = splitFee(r.feeCents ?? 0);
      // K7 — la relazione consegnata crea o aggiorna la scheda dell'indirizzo:
      // il database cresce e il prossimo che cerca quell'indirizzo trova la scheda
      const entityId = await ensureEntityForPerizia({
        id: r.id, address: r.address, zoneId: r.zoneId,
        requester: { id: r.requesterId, isDemo: r.requester.isDemo },
      });
      await db.periziaRequest.update({
        where: { id: r.id },
        data: {
          status: "delivered", reportTitle: title, reportBody: body,
          publicSummary, entityId,
          deliveredAt: new Date(), deadlineAt: null,
          payoutCents, commissionCents,
        },
      });
      await db.consultantProfile.update({
        where: { id: r.consultant.id },
        data: { incarichiCompletati: { increment: 1 } },
      });
      await auditLog({
        actorId: user.id, actorRole: user.role, action: "perizia.deliver",
        targetType: "periziaRequest", targetId: r.id,
        reason: `accredito ${payoutCents} cent, commissione ${commissionCents} cent${entityId ? `; scheda ${entityId} aggiornata con l'indagine certificata` : ""}`,
      });
      void sendMail(
        r.requester.email,
        "ZoomZoom — la relazione è pronta",
        `Il consulente ${r.consultant.firstName} ${r.consultant.lastName} ha consegnato la relazione «${title}».\nPuoi scaricarla in PDF dalla pagina «Le mie richieste».`,
        [{ label: "Scarica la relazione (le mie richieste)", href: "/#/consulente-richieste" }],
      );
      return NextResponse.json({ ok: true, status: "delivered", payoutCents, commissionCents, entityId });
    }

    /* ---------- registrazioni del super amministratore ---------- */
    if (p.action === "pay" || p.action === "payout") {
      const admin = await requireStaff();
      if (admin.role !== "superadmin") {
        return fail("Solo il super amministratore gestisce i pagamenti delle perizie.", 403);
      }

      if (p.action === "pay") {
        if (r.status !== "accepted") return fail("Si registra il pagamento di una richiesta accettata.", 409);
        const paymentRef = String(p.paymentRef || "").trim().slice(0, 160) || null;
        const paidAt = new Date();
        const deadlineAt = new Date(paidAt.getTime() + settings.periziaDeadlineDays * 86400000);
        await db.periziaRequest.update({
          where: { id: r.id },
          data: { status: "paid", paidAt, paymentRef, deadlineAt },
        });
        await auditLog({ actorId: admin.id, actorRole: admin.role, action: "perizia.pay", targetType: "periziaRequest", targetId: r.id, reason: `${paymentRef ?? "senza riferimento"} · termine consegna ${deadlineAt.toLocaleDateString("it-IT")}` });
        if (r.consultant) {
          void sendMail(
            r.consultant.user.email,
            "ZoomZoom — pagamento registrato: consegna la relazione",
            `Il pagamento della richiesta di ${r.kind.toLowerCase()} per «${r.address}» è stato registrato.\nConsegna la relazione entro il ${deadlineAt.toLocaleDateString("it-IT")} (entro ${settings.periziaDeadlineDays} giorni): oltre quel termine l'incarico risulta nullo e la richiesta torna in bacheca.`,
            [{ label: "Dashboard del consulente", href: "/#/consulente" }],
          );
        }
        return NextResponse.json({ ok: true, status: "paid", deadlineAt: deadlineAt.toISOString() });
      }

      if (r.status !== "delivered") return fail("L'accredito avviene dopo la consegna della relazione.", 409);
      await db.periziaRequest.update({
        where: { id: r.id },
        data: { status: "closed", payoutDoneAt: new Date() },
      });
      await auditLog({ actorId: admin.id, actorRole: admin.role, action: "perizia.payout", targetType: "periziaRequest", targetId: r.id, reason: `accreditati ${r.payoutCents} cent al consulente` });
      return NextResponse.json({ ok: true, status: "closed" });
    }

    return fail("Azione non riconosciuta.", 400);
  } catch (e) {
    return handleError(e);
  }
}
