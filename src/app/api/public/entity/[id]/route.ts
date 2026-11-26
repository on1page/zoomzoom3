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
import { publicEntity, publicReviewsForEntity, photoMetaForEntity, certifiedIndagineForEntity, entityLinksForEntity } from "@/lib/server/public-data";
import { obfuscateReviewText, photoAccessOf, voteSummariesForEntity, myVotesForEntity } from "@/lib/server/review-access";
import { utilitySummariesForEntity } from "@/lib/server/utility";
import { publicConsultantForEntity } from "@/lib/server/consultants";
import { handleError } from "@/lib/server/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await ctx.params;
    const [settings, user] = await Promise.all([getSettings(), getCurrentUser()]);
    let ent = await db.entity.findUnique({ where: { id: rawId } });
    // Fallback per i link alle zone che usano lo slug (es. #/zona/milano):
    // se l'id non corrisponde a nessuna scheda, prova a risolvere la scheda
    // città della zona con quell'id (una sola scheda "zona" pubblicata per
    // zona); da qui in avanti si usa l'id RISOLTO della scheda trovata.
    if (!ent) {
      ent = await db.entity.findFirst({ where: { zoneId: rawId, categoryId: "zona", status: "published" } });
    }
    const id = ent?.id ?? rawId;
    if (!ent || ent.status !== "published") {
      return NextResponse.json({ ok: false, error: "Scheda non trovata." }, { status: 404 });
    }
    const cat = await getCategory(ent.categoryId);
    const [pub, reviews, consultant, certified, links] = await Promise.all([
      publicEntity(id, settings.minReviews),
      publicReviewsForEntity(id),
      // scheda professionale (solo per la categoria Consulenti tecnici)
      ent.categoryId === "consulente" ? publicConsultantForEntity(id) : Promise.resolve(null),
      // indagine professionale certificata collegata a questa scheda (K7)
      certifiedIndagineForEntity(id),
      // collegamenti tra schede: condominio ↔ amministratore
      entityLinksForEntity(id, settings.minReviews),
    ]);
    const published = reviews.filter(r => r.status === "published");
    const hiddenCount = reviews.length - published.length;

    const fullAccess = hasPremiumAccess(user, settings);
    const [photoMeta, voteSum, myVotes, photoAccess, utilitySum] = await Promise.all([
      settings.photosEnabled ? photoMetaForEntity(id) : Promise.resolve(new Map<string, { id: string; width: number; height: number }[]>()),
      settings.votesEnabled ? voteSummariesForEntity(id) : Promise.resolve(new Map<string, { up: number; down: number }>()),
      user ? myVotesForEntity(id, user.id) : Promise.resolve(new Map<string, number>()),
      photoAccessOf(user, settings),
      // riconoscimento di utilità: «utilità confermata» sulla recensione
      settings.utilityEnabled ? utilitySummariesForEntity(id) : Promise.resolve(new Map<string, { confirmed: boolean; validVotes: number; anomalousVotes: number; points: number }>()),
    ]);

    // arricchisce una recensione con foto (metadati) e voti; senza accesso
    // pieno i testi vengono offuscati e pro/contro omessi. L'autore compare
    // per nome solo con il flag showIdentity: altrimenti al client arrivano
    // esclusivamente la categoria e il fatto che è la propria (mine).
    const enrich = (r: (typeof published)[number], teaser: boolean) => {
      const base = {
        id: r.id,
        author: r.author,
        authorCategory: r.authorCategory,
        showIdentity: r.showIdentity,
        mine: !!user && r.userId === user.id,
        avatarUrl: r.showIdentity && r.author
          ? `/api/public/avatar/${encodeURIComponent(r.author)}`
          : null,
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
        // riconoscimento di utilità (finestra 30 giorni, ricalcolo periodico)
        utility: {
          enabled: settings.utilityEnabled,
          confirmed: !!(utilitySum.get(r.id)?.confirmed),
        },
        // trasparenza: contributo che ha attivato giorni Premium per l'autore
        incentivized: !!r.incentivized,
        authorBadges: r.authorBadges || [],
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
      consultant,
      certified,
      // condominio ↔ amministratore: chi amministra e cosa si amministra
      links,
      reviews: reviewsOut,
      teasers,
      hiddenCount,
      publishedCount: published.length,
      // contributo semplificato: il client sa subito se l'utente ha già
      // recensito questa scheda (offerta di rettifica invece del modulo)
      myReviewCount: user ? published.filter(r => r.userId === user.id).length : 0,
      myReviewId: user ? (published.find(r => r.userId === user.id)?.id ?? null) : null,
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
      utility: { enabled: settings.utilityEnabled },
      settings: { minReviews: settings.minReviews, rettificaDays: settings.rettificaDays },
    });
  } catch (e) {
    return handleError(e);
  }
}
