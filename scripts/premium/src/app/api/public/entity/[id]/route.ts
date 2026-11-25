// GET /api/public/entity/[id] — scheda pubblica: entità, recensioni, criteri.
// Membership Premium: gli aggregati (medie, conteggi, criteri, prezzi mediani)
// restano sempre pubblici; i testi integrali delle recensioni sono riservati
// agli utenti Premium (contributori con recensioni verificate) e allo staff.
// Le proprie recensioni restano sempre visibili al loro autore.
// Il gating è applicato QUI, lato server: il client riceve solo ciò che può
// vedere, senza eccezioni.
// Le recensioni nascoste dalla moderazione restano escluse dalle medie e
// l'elenco mostra solo il conteggio delle nascoste.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCategory } from "@/lib/server/categories";
import { getSettings } from "@/lib/server/settings";
import { getCurrentUser } from "@/lib/server/auth";
import { hasPremiumAccess, premiumStateOf } from "@/lib/server/premium";
import { publicEntity, publicReviewsForEntity } from "@/lib/server/public-data";
import { handleError } from "@/lib/server/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [settings, user] = await Promise.all([getSettings(), getCurrentUser()]);
    const ent = await db.entity.findUnique({ where: { id } });
    if (!ent || ent.status !== "published") {
      return NextResponse.json({ ok: false, error: "Scheda non trovata." }, { status: 404 });
    }
    const cat = await getCategory(ent.categoryId);
    const [pub, reviews] = await Promise.all([
      publicEntity(id, settings.minReviews),
      publicReviewsForEntity(id),
    ]);
    const published = reviews.filter(r => r.status === "published");
    const hiddenCount = reviews.length - published.length;

    const fullAccess = hasPremiumAccess(user, settings);
    // senza accesso pieno: all'utente restano solo le SUE recensioni pubblicate
    const visible = fullAccess ? published : published.filter(r => r.userId === user?.id);
    // mai inviare userId al client: serve solo per il filtro server-side
    const strip = (list: typeof published) => list.map(({ userId: _u, ...rest }) => rest);

    return NextResponse.json({
      ok: true,
      entity: pub,
      category: cat,
      reviews: strip(visible),
      hiddenCount,
      publishedCount: published.length,
      premium: {
        enabled: settings.premiumEnabled,
        daysPerReview: settings.premiumDaysPerReview,
        locked: !fullAccess,
        activeUntil: premiumStateOf(user).until ? premiumStateOf(user).until!.toISOString() : null,
        // l'utente vede quante recensioni NON sue gli sono riservate
        lockedCount: Math.max(0, published.length - visible.length),
      },
      settings: { minReviews: settings.minReviews, rettificaDays: settings.rettificaDays },
    });
  } catch (e) {
    return handleError(e);
  }
}
