// POST /api/reviews — pubblicazione recensione.
// Due vie, entrambe con la stessa validazione e lo stesso incentivo Premium:
// 1) su invito/verifica: esperienza attiva collegata all'utente (experienceId)
//    → recensione "verificata" (badge Verificata);
// 2) contributo aperto (entityId + experienceKind): senza invito, per
//    immobili e zone → recensione "dichiarata" (badge Esperienza dichiarata),
//    con limiti anti-abuso. Le persone fisiche restano fuori: per loro serve
//    l'invito del soggetto o la verifica documentale (tutela privacy/diffamazione).
// Transazione atomica: il vincolo UNIQUE su experienceId nel DB impedisce
// duplicati anche sotto richieste concorrenti; nel contributo aperto vale
// una sola recensione per utente per scheda.
// Ogni recensione pubblicata assegna la Membership Premium (N giorni, vedi
// impostazioni): l'incentivo è legato al contributo, non al voto espresso,
// e viene revocato se la moderazione accerta la frode.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getCategory, snapshotCategoryVersion } from "@/lib/server/categories";
import { getSettings } from "@/lib/server/settings";
import { awardPremiumForReview } from "@/lib/server/premium";
import { attachReviewPhotos } from "@/lib/server/review-access";
import { auditLog } from "@/lib/server/audit";
import { validateReviewPayload, type ReviewPayload } from "@/lib/server/validation";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

type OpenReviewPayload = ReviewPayload & {
  experienceId?: string;
  // contributo aperto
  entityId?: string;
  experienceKind?: string;
  photos?: unknown;
};

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "review", 10, 3600);
    const settings = await getSettings();
    const p = await readJson<OpenReviewPayload>(req);

    let entityId: string;
    let verified: boolean;
    let isDemo: boolean;
    // via invito: esperienza già esistente; contributo aperto: viene creata
    // DOPO la validazione del payload, così un errore di input non lascia
    // esperienze orfane nel database
    let experienceId: string | null = null;
    let kindLabel = "";

    if (p.experienceId) {
      /* ---- via invito / verifica documentale ---- */
      const expId = String(p.experienceId);
      const exp = await db.experience.findUnique({ where: { id: expId }, include: { entity: true } });
      if (!exp || exp.status !== "active" || exp.userId !== user.id) {
        return fail("Questa esperienza non è attiva o non è collegata al tuo account.", 403);
      }
      const existing = await db.review.findUnique({ where: { experienceId: expId } });
      if (existing) return fail("Hai già scritto questa recensione: puoi aggiornarla con una rettifica motivata.", 409);
      entityId = exp.entityId;
      verified = true;
      isDemo = exp.isDemo;
      experienceId = exp.id;
      kindLabel = exp.kind;
    } else {
      /* ---- contributo aperto (immobili e zone) ---- */
      if (!settings.openReviewsEnabled) {
        return fail("Il contributo aperto è temporaneamente sospeso: usa l'invito o la verifica documentale.", 403);
      }
      // limite per utente (anti-frode: niente raffiche di recensioni dichiarate)
      const rl = rateLimit(`openreview:${user.id}`, settings.openReviewsPerDay, 86400);
      if (!rl.ok) return fail(`Limite di ${settings.openReviewsPerDay} recensioni aperte al giorno raggiunto: riprova domani.`, 429);
      entityId = String(p.entityId || "");
      kindLabel = String(p.experienceKind || "");
      const ent = await db.entity.findUnique({ where: { id: entityId } });
      if (!ent || ent.status !== "published") return fail("Scheda non trovata.", 404);
      const cat = await getCategory(ent.categoryId);
      if (!cat) return fail("Categoria non trovata.", 400);
      // le persone fisiche non si recensiscono senza verifica: la scheda con
      // il nominativo va protetta (privacy e rischio diffamazione)
      if (cat.isPerson) {
        return fail("Per recensire una persona serve l'invito del soggetto o la verifica documentale dell'esperienza.", 403);
      }
      if (!cat.experienceKinds.includes(kindLabel)) {
        return fail("Indica il tipo di esperienza che hai vissuto.", 400);
      }
      const dup = await db.review.findFirst({ where: { entityId, userId: user.id, status: "published" }, select: { id: true } });
      if (dup) return fail("Hai già scritto una recensione su questa scheda: puoi aggiornarla con una rettifica motivata.", 409);
      // l'esperienza dichiarata viene creata dopo la validazione (più sotto)
      entityId = ent.id;
      verified = false;
      isDemo = user.isDemo;
    }

    const ent = await db.entity.findUnique({ where: { id: entityId } });
    if (!ent) return fail("Scheda non trovata.", 404);
    const cat = await getCategory(ent.categoryId);
    if (!cat) return fail("Categoria non trovata.", 400);
    const val = validateReviewPayload(p, cat);
    if (!val.ok) return fail(val.error);

    // contributo aperto: ora che il payload è valido, l'esperienza dichiarata
    // nasce attiva e resta legata all'utente
    if (!experienceId) {
      const exp = await db.experience.create({
        data: {
          entityId, kind: kindLabel, origin: "self",
          clientEmail: user.email, userId: user.id, status: "active", isDemo: user.isDemo,
        },
      });
      experienceId = exp.id;
    }

    const versionId = await snapshotCategoryVersion(cat.id);
    const review = await db.review.create({
      data: {
        experienceId, entityId, userId: user.id,
        score: val.score, criteriaJson: JSON.stringify(val.criteria), criteriaVersionId: versionId,
        prosJson: JSON.stringify(val.pros), consJson: JSON.stringify(val.cons),
        priceAmount: val.price?.amount ?? null, priceUnit: val.price?.unit ?? null, priceKind: val.price?.kind ?? null,
        text: val.text, status: "published", verified, isDemo,
      },
    });

    // foto allegate (facoltative): ricompilate lato server, metadati rimossi
    const photos = settings.photosEnabled
      ? await attachReviewPhotos(review.id, review.isDemo, p.photos)
      : { added: 0, skipped: 0 };

    // Membership Premium: giorni per il contributo (idempotente: un grant per
    // recensione; qui la recensione è appena stata creata, quindi è la prima)
    const premium = await awardPremiumForReview({
      userId: user.id, reviewId: review.id, settings, grantedAt: review.createdAt,
    });
    if (premium.grantedDays > 0) {
      await auditLog({
        actorId: user.id, actorRole: user.role,
        action: `Premium assegnato: ${premium.grantedDays} giorni per recensione ${verified ? "verificata" : "dichiarata"} pubblicata`,
        targetType: "review", targetId: review.id,
        reason: verified ? "Contributo verificato: esperienza attiva collegata." : "Contributo aperto (esperienza dichiarata) su immobile o zona.",
        isDemo: review.isDemo,
      });
    }

    return NextResponse.json({
      ok: true, reviewId: review.id, entityId,
      verified,
      photos: { added: photos.added, skipped: photos.skipped },
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
