// GET /api/public/entity/[id] — scheda pubblica: entità, recensioni, criteri.
// Membership Premium: gli aggregati (medie, conteggi, criteri, prezzi mediani)
// restano sempre pubblici; i testi integrali delle recensioni sono riservati
// agli utenti Premium (contributori) e allo staff. Chi non ha l'accesso vede
// un'ANTEPRIMA: le ultime 3 recensioni in forma offuscata (estratto breve +
// maschera, calcolata QUI: il testo integrale non lascia mai il server).
// Le foto sono visibili ai Premium e a chi ha contribuito con una foto propria
// (i byte passano da /api/public/photo/[id], con controllo per utente).
// I voti di utilità (pollice su/giù) sono pubblici come conteggio; possono
// votare solo i Premium. Le proprie recensioni restano sempre visibili all'autore.
// Le recensioni nascoste dalla moderazione restano escluse e l'elenco
// mostra solo il conteggio delle nascoste.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCategory } from "@/lib/server/categories";
import { getSettings } from "@/lib/server/settings";
import { getCurrentUser } from "@/lib/server/auth";
import { hasPremiumAccess, premiumStateOf } from "@/lib/server/premium";
import { publicEntity, publicReviewsForEntity, photoMetaForEntity } from "@/lib/server/public-data";
import { obfuscateReviewText, photoAccessOf, voteSummariesForEntity, myVotesForEntity } from "@/lib/server/review-access";
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
    const [photoMeta, voteSum, myVotes, photoAccess] = await Promise.all([
      settings.photosEnabled ? photoMetaForEntity(id) : Promise.resolve(new Map<string, { id: string; width: number; height: number }[]>()),
      settings.votesEnabled ? voteSummariesForEntity(id) : Promise.resolve(new Map<string, { up: number; down: number }>()),
      user ? myVotesForEntity(id, user.id) : Promise.resolve(new Map<string, number>()),
      photoAccessOf(user, settings),
    ]);

    // arricchisce una recensione con foto (metadati) e voti; senza accesso
    // pieno i testi vengono offuscati e pro/contro omessi
    const enrich = (r: (typeof published)[number], teaser: boolean) => {
      const base = {
        id: r.id,
        author: r.author,
        score: r.score,
        criteria: r.criteria,
        criteriaLabels: r.criteriaLabels,
        price: r.price,
        verified: r.verified,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        updateReason: teaser ? null : r.updateReason,
        isDemo: r.isDemo,
        photos: photoMeta.get(r.id) || [],
        votes: voteSum.get(r.id) || { up: 0, down: 0 },
        myVote: myVotes.has(r.id) ? myVotes.get(r.id)! : null,
        teaser,
      };
      if (teaser) {
        return { ...base, text: obfuscateReviewText(r.text), pros: [], cons: [] };
      }
      return { ...base, text: r.text, pros: r.pros, cons: r.cons };
    };
    const strip = (o: Record<string, unknown>) => {
      const { userId: _u, ...rest } = o as { userId?: string };
      return rest;
    };

    // senza accesso pieno: all'utente restano le SUE recensioni (integrali)
    const own = fullAccess ? [] : published.filter(r => r.userId === user?.id);
    const visible = fullAccess ? published : own;
    const reviewsOut = visible.map(r => strip(enrich(r, false) as unknown as Record<string, unknown>));

    // anteprima offuscata per chi non ha l'accesso: ultime 3 recensioni
    // pubbliche non sue (le sue sono già visibili per intero)
    let teasers: unknown[] = [];
    if (!fullAccess) {
      const notOwn = published.filter(r => r.userId !== user?.id);
      teasers = notOwn.slice(0, 3).map(r => strip(enrich(r, true) as unknown as Record<string, unknown>));
    }

    return NextResponse.json({
      ok: true,
      entity: pub,
      category: cat,
      reviews: reviewsOut,
      teasers,
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
      photos: {
        enabled: settings.photosEnabled,
        canView: photoAccess.canView,
        viaContribution: photoAccess.viaContribution,
      },
      votes: {
        enabled: settings.votesEnabled,
        canVote: settings.votesEnabled && !!user && (["moderator", "admin", "superadmin"].includes(user.role) || premiumStateOf(user).active),
      },
      settings: { minReviews: settings.minReviews, rettificaDays: settings.rettificaDays },
    });
  } catch (e) {
    return handleError(e);
  }
}
