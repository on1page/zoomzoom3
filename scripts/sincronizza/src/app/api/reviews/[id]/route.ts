// PUT /api/reviews/[id] — rettifica tracciata entro la finestra configurabile.
// Non sovrascrive la cronologia: aggiorna i campi e conserva data + motivo.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getCategory } from "@/lib/server/categories";
import { validateReviewPayload, type ReviewPayload } from "@/lib/server/validation";
import { getSettings } from "@/lib/server/settings";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    guard(req, "review-edit", 15, 3600);
    const rev = await db.review.findUnique({ where: { id } });
    if (!rev || rev.userId !== user.id) return fail("Recensione non trovata.", 404);
    if (rev.status !== "published") {
      return fail("La recensione non è modificabile in autonomia: è stata nascosta dalla moderazione. Scrivi dal modulo contatti per la procedura di correzione.", 409);
    }
    const settings = await getSettings();
    const days = (Date.now() - rev.createdAt.getTime()) / 86400000;
    if (days > settings.rettificaDays) {
      return fail(`Finestra di rettifica conclusa: puoi aggiornare autonomamente entro ${settings.rettificaDays} giorni. Dopo, le correzioni passano dalla moderazione.`, 409);
    }
    const p = await readJson<ReviewPayload & { updateReason?: string }>(req);
    const reason = String(p.updateReason || "").trim();
    if (reason.length < 10) return fail("Indica il motivo della rettifica (almeno 10 caratteri).");
    const ent = await db.entity.findUnique({ where: { id: rev.entityId } });
    const cat = await getCategory(ent!.categoryId);
    if (!cat) return fail("Categoria non trovata.", 400);
    const val = validateReviewPayload(p, cat);
    if (!val.ok) return fail(val.error);

    await db.review.update({
      where: { id: rev.id },
      data: {
        score: val.score, criteriaJson: JSON.stringify(val.criteria),
        prosJson: JSON.stringify(val.pros), consJson: JSON.stringify(val.cons),
        priceAmount: val.price?.amount ?? null, priceUnit: val.price?.unit ?? null, priceKind: val.price?.kind ?? null,
        text: val.text, updatedAt: new Date(), updateReason: reason,
      },
    });
    return NextResponse.json({ ok: true, entityId: rev.entityId });
  } catch (e) {
    return handleError(e);
  }
}
