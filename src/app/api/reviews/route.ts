// POST /api/reviews — pubblicazione recensione su un'esperienza attiva
// collegata all'utente. Transazione atomica: il vincolo UNIQUE su
// experienceId nel DB impedisce duplicati anche sotto richieste concorrenti.
// Ogni recensione verificata pubblicata assegna anche la Membership Premium
// (N giorni, vedi impostazioni): l'incentivo è legato al contributo, non al
// voto espresso, e viene revocato se la moderazione accerta la frode.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getCategory, snapshotCategoryVersion } from "@/lib/server/categories";
import { getSettings } from "@/lib/server/settings";
import { awardPremiumForReview } from "@/lib/server/premium";
import { auditLog } from "@/lib/server/audit";
import { validateReviewPayload, type ReviewPayload } from "@/lib/server/validation";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "review", 10, 3600);
    const p = await readJson<ReviewPayload & { experienceId?: string }>(req);
    const expId = String(p.experienceId || "");
    const exp = await db.experience.findUnique({ where: { id: expId }, include: { entity: true } });
    if (!exp || exp.status !== "active" || exp.userId !== user.id) {
      return fail("Questa esperienza non è attiva o non è collegata al tuo account.", 403);
    }
    const existing = await db.review.findUnique({ where: { experienceId: expId } });
    if (existing) return fail("Hai già scritto questa recensione: puoi aggiornarla con una rettifica motivata.", 409);

    const cat = await getCategory(exp.entity.categoryId);
    if (!cat) return fail("Categoria non trovata.", 400);
    const val = validateReviewPayload(p, cat);
    if (!val.ok) return fail(val.error);

    const versionId = await snapshotCategoryVersion(cat.id);
    const review = await db.review.create({
      data: {
        experienceId: exp.id, entityId: exp.entityId, userId: user.id,
        score: val.score, criteriaJson: JSON.stringify(val.criteria), criteriaVersionId: versionId,
        prosJson: JSON.stringify(val.pros), consJson: JSON.stringify(val.cons),
        priceAmount: val.price?.amount ?? null, priceUnit: val.price?.unit ?? null, priceKind: val.price?.kind ?? null,
        text: val.text, status: "published", verified: true, isDemo: exp.isDemo,
      },
    });

    // Membership Premium: giorni per il contributo (idempotente: un grant per
    // recensione; qui la recensione è appena stata creata, quindi è la prima)
    const settings = await getSettings();
    const premium = await awardPremiumForReview({
      userId: user.id, reviewId: review.id, settings, grantedAt: review.createdAt,
    });
    if (premium.grantedDays > 0) {
      await auditLog({
        actorId: user.id, actorRole: user.role, action: `Premium assegnato: ${premium.grantedDays} giorni per recensione pubblicata`,
        targetType: "review", targetId: review.id, reason: "Contributo verificato: esperienza attiva collegata.", isDemo: review.isDemo,
      });
    }

    return NextResponse.json({
      ok: true, reviewId: review.id, entityId: exp.entityId,
      premium: premium.grantedDays > 0
        ? { grantedDays: premium.grantedDays, until: premium.until ? premium.until.toISOString() : null }
        : null,
    });
  } catch (e) {
    // violazione dell'unique su experienceId: richiesta concorrente già servita
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return fail("Hai già scritto questa recensione.", 409);
    }
    return handleError(e);
  }
}
