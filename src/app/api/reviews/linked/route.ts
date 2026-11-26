// POST /api/reviews/linked — mini-indagine collegata «due righe
// sull'amministratore di condominio» (raggruppare schede e chiudere i
// percorsi). Chi ha APPENA pubblicato l'indagine sull'immobile dove abita
// ha l'esperienza diretta con chi lo amministra: la mini-indagine nasce
// VERIFICATA (la verifica deriva dall'indagine pubblicata sulla scheda
// immobile collegata — scelta consapevole: zero passaggi extra), crea o
// riusa la scheda dell'amministratore (dedup per nome normalizzato nella
// stessa zona) e il collegamento condominio —amministra→ amministratore.
// In un colpo solo: una recensione in più, la scheda amministratore, il
// collegamento (nella scheda dell'amministratore compaiono tutti i
// condomini che amministra).
// Stesse regole dell'indagine aperta (il server resta l'autorità): testo
// >= 100 caratteri, almeno un aspetto positivo, punteggio 0–10, budget
// giornaliero condiviso con le indagini aperte, honeypot, Premium per il
// contributo pubblicato. La scheda dell'amministratore non è una persona
// fisica (privacy/diffamazione come per agenzie e ditte).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getCategory, snapshotCategoryVersion } from "@/lib/server/categories";
import { getSettings } from "@/lib/server/settings";
import { awardPremiumForReview } from "@/lib/server/premium";
import { validateReviewPayload, type ReviewPayload } from "@/lib/server/validation";
import { auditLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

type LinkedPayload = ReviewPayload & {
  // indagine appena pubblicata sulla scheda immobile (il condominio)
  parentReviewId?: string;
  // nome dello studio/dell'amministratore di condominio
  adminName?: string;
  experienceKind?: string;
};

// nome normalizzato per il confronto: maiuscole, accenti e punteggiatura
// non distinguono uno studio dall'altro («Studio Rossi» = «studio rossi»)
const normName = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "review", 10, 3600);
    const settings = await getSettings();
    if (!settings.openReviewsEnabled) {
      return fail("Il contributo aperto è temporaneamente sospeso.", 403);
    }
    // stesso budget giornaliero delle indagini aperte: la mini-indagine è un
    // contributo a tutti gli effetti (anti-frode: niente raffiche)
    const rl = rateLimit(`openreview:${user.id}`, settings.openReviewsPerDay, 86400);
    if (!rl.ok) return fail(`Limite di ${settings.openReviewsPerDay} recensioni aperte al giorno raggiunto: riprova domani.`, 429);

    const p = await readJson<LinkedPayload>(req);

    /* ---- l'indagine madre: pubblica, dell'utente, su un immobile ---- */
    const parent = await db.review.findUnique({
      where: { id: String(p.parentReviewId || "") },
      include: { entity: true },
    });
    if (!parent || parent.status !== "published") return fail("Indagine di riferimento non trovata.", 404);
    if (parent.userId !== user.id) return fail("L'indagine di riferimento non è la tua.", 403);
    if (parent.entity.categoryId !== "immobile" || parent.entity.status !== "published") {
      return fail("Le mini-indagini collegate nascono solo da un'indagine pubblicata su un immobile.", 400);
    }

    /* ---- la categoria Amministratori di condominio ---- */
    const cat = await getCategory("amministratore");
    if (!cat) return fail("Categoria non trovata.", 400);
    if (cat.isPerson) return fail("La categoria non ammette contributi aperti.", 400);
    const kindLabel = String(p.experienceKind || "");
    if (!cat.experienceKinds.includes(kindLabel)) {
      return fail("Indica il tipo di esperienza che hai vissuto.", 400);
    }

    /* ---- nome dell'amministratore e scheda (creata o riusata) ---- */
    const adminName = String(p.adminName || "").trim().replace(/\s+/g, " ").slice(0, 80).trim();
    if (adminName.length < 3 || adminName.length > 80) {
      return fail("Indica il nome dell'amministratore di condominio (tra 3 e 80 caratteri).");
    }
    const zoneId = parent.entity.zoneId;
    const wanted = normName(adminName);
    const candidates = await db.entity.findMany({
      where: { categoryId: "amministratore", status: "published", zoneId },
      select: { id: true, name: true },
    });
    const existing = candidates.find(c => normName(c.name) === wanted);
    // una sola indagine per utente per scheda: se l'utente ha già scritto
    // su questa scheda amministratore, il COLLEGAMENTO del condominio si
    // crea comunque (vale per tutti) e la risposta lo dichiara (nessuna
    // nuova indagine: l'utente può rettificare quella che ha già)
    let dup: { id: string } | null = null;
    if (existing) {
      dup = await db.review.findFirst({
        where: { entityId: existing.id, userId: user.id, status: "published" },
        select: { id: true },
      });
    }

    /* ---- transazione: scheda + esperienza + indagine + collegamento ---- */
    // caso «già recensito»: solo il collegamento, senza nuova indagine
    if (dup && existing) {
      await db.entityLink.upsert({
        where: { fromEntityId_toEntityId_kind: { fromEntityId: parent.entityId, toEntityId: existing.id, kind: "amministra" } },
        create: { fromEntityId: parent.entityId, toEntityId: existing.id, kind: "amministra", source: "indagine", createdById: user.id },
        update: {},
      });
      await auditLog({
        actorId: user.id, actorRole: user.role,
        action: "Condominio collegato a un amministratore già recensito",
        targetType: "entity", targetId: existing.id,
        reason: `condominio ${parent.entity.name} · amministratore ${existing.name} · indagine già presente: solo collegamento`,
        isDemo: user.isDemo,
      });
      return NextResponse.json({ ok: true, alreadyReviewed: true, reviewId: dup.id, entityId: existing.id, condominioId: parent.entityId, created: false });
    }
    /* ---- validazione: stesse regole del contributo aperto ---- */
    const val = validateReviewPayload(p, cat);
    if (!val.ok) return fail(val.error);
    const created = await db.$transaction(async (tx) => {
      const admin = existing
        ? await tx.entity.findUniqueOrThrow({ where: { id: existing.id } })
        : await tx.entity.create({
            data: {
              categoryId: "amministratore",
              name: adminName,
              subtitle: null,
              address: null,
              zoneId,
              status: "published",
              proposedBy: `user:${user.id}`,
              isDemo: user.isDemo,
            },
          });
      // la verifica deriva dall'indagine pubblicata sull'immobile dove
      // l'utente vive (scelta «automatica»): l'esperienza con chi amministra
      // la casa dove si abita è diretta come quella con la casa stessa
      const exp = await tx.experience.create({
        data: {
          entityId: admin.id, kind: kindLabel, origin: "self",
          clientEmail: user.email, userId: user.id, status: "active",
          note: `Verifica derivata dall'indagine pubblicata sulla scheda immobile ${parent.entityId}.`,
          isDemo: user.isDemo,
        },
      });
      const versionId = await snapshotCategoryVersion(cat.id);
      const review = await tx.review.create({
        data: {
          experienceId: exp.id, entityId: admin.id, userId: user.id,
          score: val.score, criteriaJson: JSON.stringify(val.criteria), criteriaVersionId: versionId,
          prosJson: JSON.stringify(val.pros), consJson: JSON.stringify(val.cons),
          priceAmount: val.price?.amount ?? null, priceUnit: val.price?.unit ?? null, priceKind: val.price?.kind ?? null,
          text: val.text, status: "published", verified: true, isDemo: user.isDemo,
          authorCategory: user.categoryId, showIdentity: false,
        },
      });
      // il collegamento condominio —amministra→ amministratore: idempotente
      // (unique su from+to+kind: un altro condomino può averlo già creato)
      await tx.entityLink.upsert({
        where: { fromEntityId_toEntityId_kind: { fromEntityId: parent.entityId, toEntityId: admin.id, kind: "amministra" } },
        create: { fromEntityId: parent.entityId, toEntityId: admin.id, kind: "amministra", source: "indagine", createdById: user.id },
        update: {},
      });
      return { admin, review, reused: !!existing };
    });

    /* ---- Premium per il contributo (come ogni indagine pubblicata) ---- */
    const premium = await awardPremiumForReview({
      userId: user.id, reviewId: created.review.id, settings, grantedAt: created.review.createdAt,
    });

    await auditLog({
      actorId: user.id, actorRole: user.role,
      action: "Mini-indagine collegata: amministratore di condominio",
      targetType: "review", targetId: created.review.id,
      reason: `scheda ${created.admin.name} ${created.reused ? "riusata" : "creata"} · collegata all'immobile ${parent.entity.name}${premium.grantedDays > 0 ? ` · Premium +${premium.grantedDays} gg` : ""}`,
      isDemo: created.review.isDemo,
    });

    return NextResponse.json({
      ok: true, reviewId: created.review.id,
      entityId: created.admin.id, condominioId: parent.entityId,
      created: !created.reused,
      premium: premium.grantedDays > 0
        ? { grantedDays: premium.grantedDays, until: premium.until ? premium.until.toISOString() : null }
        : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
