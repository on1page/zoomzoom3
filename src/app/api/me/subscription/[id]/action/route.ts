// POST /api/me/subscription/[id]/action — azioni del proprietario
// sull'ordine di abbonamento. Oggi: «cancel», annulla un ordine ancora in
// attesa del bonifico (prima della registrazione dello staff: dopo, il
// Premium è già attivo e si gestisce con i normali strumenti di account).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, readJson, handleError, fail } from "@/lib/server/http";
import { auditLog } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const user = await requireUser();
    const p = await readJson<{ action?: string }>(req);

    const order = await db.subscriptionOrder.findUnique({ where: { id } });
    if (!order || order.userId !== user.id) return fail("Ordine non trovato.", 404);

    if (p.action === "cancel") {
      if (order.status !== "pending") return fail("L'ordine non è più annullabile in questo stato.", 409);
      await db.subscriptionOrder.update({ where: { id: order.id }, data: { status: "cancelled" } });
      await auditLog({
        actorId: user.id, actorRole: user.role,
        action: "Ordine di abbonamento annullato dall'utente",
        targetType: "subscriptionOrder", targetId: order.id,
        reason: `piano ${order.planName}`,
        isDemo: user.isDemo,
      });
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    return fail("Azione non riconosciuta.", 400);
  } catch (e) {
    return handleError(e);
  }
}
