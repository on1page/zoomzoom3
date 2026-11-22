// POST /api/consulente/requests/[id]/action — le transizioni di stato
// delle richieste di perizia, ognuna autorizzata dal ruolo giusto:
//   accept   — il CONSULENTE accetta e conferma la tariffa (in centesimi)
//   reject   — il CONSULENTE rifiuta (motivo obbligatorio)
//   cancel   — il RICHIEDENTE annulla (solo prima del pagamento)
//   pay      — il SUPER AMMINISTRATRICE registra il pagamento ricevuto
//   deliver  — il CONSULENTE consegna la relazione (solo dopo il pago):
//              qui si calcolano accredito (90%) e commissione (10%)
//   payout   — il SUPER AMMINISTRATRICE registra l'accredito eseguito
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, requireStaff } from "@/lib/server/auth";
import { assertSameOrigin, readJson, handleError, fail } from "@/lib/server/http";
import { auditLog } from "@/lib/server/audit";
import { eurosToCents, splitFee } from "@/lib/server/consultants";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const p = await readJson<{
      action?: string; feeEuros?: number | string; reason?: string;
      title?: string; body?: string; paymentRef?: string;
    }>(req);

    const r = await db.periziaRequest.findUnique({
      where: { id },
      include: { consultant: true, requester: { select: { id: true, nickname: true } } },
    });
    if (!r) return fail("Richiesta non trovata.", 404);

    /* ---------- azioni del consulente ---------- */
    if (p.action === "accept" || p.action === "reject") {
      const user = await requireUser();
      if (r.consultant.userId !== user.id) return fail("Solo il consulente incaricato può compiere questa azione.", 403);
      if (!r.consultant.status || r.consultant.status !== "approved") {
        return fail("Il tuo profilo consulente non è approvato.", 403);
      }
      if (r.status !== "requested") return fail("La richiesta non è più in attesa di risposta.", 409);

      if (p.action === "reject") {
        const reason = String(p.reason || "").trim().slice(0, 500);
        if (reason.length < 5) return fail("Indica brevemente il motivo del rifiuto.");
        await db.periziaRequest.update({
          where: { id: r.id },
          data: { status: "rejected", rejectReason: reason },
        });
        await auditLog({ actorId: user.id, actorRole: user.role, action: "perizia.reject", targetType: "periziaRequest", targetId: r.id, reason });
        return NextResponse.json({ ok: true, status: "rejected" });
      }

      // accept: la tariffa proposta dal consulente (default: quella del profilo)
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
      return NextResponse.json({ ok: true, status: "accepted", feeCents: cents });
    }

    /* ---------- annullamento del richiedente ---------- */
    if (p.action === "cancel") {
      const user = await requireUser();
      if (r.requesterId !== user.id) return fail("Solo chi ha fatto la richiesta può annullarla.", 403);
      if (!["requested", "accepted"].includes(r.status)) {
        return fail("La richiesta non può più essere annullata in questo stato.", 409);
      }
      await db.periziaRequest.update({ where: { id: r.id }, data: { status: "cancelled" } });
      await auditLog({ actorId: user.id, actorRole: user.role, action: "perizia.cancel", targetType: "periziaRequest", targetId: r.id });
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    /* ---------- consegna della relazione (consulente) ---------- */
    if (p.action === "deliver") {
      const user = await requireUser();
      if (r.consultant.userId !== user.id) return fail("Solo il consulente incaricato può consegnare la relazione.", 403);
      if (!user.totpEnabled) return fail("Attiva la verifica in due passaggi (2FA) per consegnare le relazioni.", 403);
      if (r.status !== "paid") return fail("La relazione si consegna dopo la registrazione del pagamento.", 409);

      const title = String(p.title || "").trim().replace(/\s+/g, " ").slice(0, 160);
      if (title.length < 5) return fail("Dai un titolo alla relazione.");
      const body = String(p.body || "").trim().slice(0, 30000);
      if (body.length < 300) return fail("La relazione deve essere di almeno 300 caratteri: è il documento che il richiedente porterà con sé.");

      const { payoutCents, commissionCents } = splitFee(r.feeCents ?? 0);
      await db.periziaRequest.update({
        where: { id: r.id },
        data: {
          status: "delivered", reportTitle: title, reportBody: body,
          deliveredAt: new Date(),
          payoutCents, commissionCents,
        },
      });
      await auditLog({ actorId: user.id, actorRole: user.role, action: "perizia.deliver", targetType: "periziaRequest", targetId: r.id, reason: `accredito ${payoutCents} cent, commissione ${commissionCents} cent` });
      return NextResponse.json({ ok: true, status: "delivered", payoutCents, commissionCents });
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
        await db.periziaRequest.update({
          where: { id: r.id },
          data: { status: "paid", paidAt: new Date(), paymentRef },
        });
        await auditLog({ actorId: admin.id, actorRole: admin.role, action: "perizia.pay", targetType: "periziaRequest", targetId: r.id, reason: paymentRef ?? null });
        return NextResponse.json({ ok: true, status: "paid" });
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
