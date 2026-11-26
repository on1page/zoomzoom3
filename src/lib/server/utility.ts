// ZoomZoom — riconoscimento di utilità della community.
// Premia quanto un contributo AIUTA gli altri a decidere, non le stelle e
// non il volume: i punti derivano dai soli voti «utile» (value=1) espressi
// da chi legge, dentro una finestra mobile di 30 giorni, ricalcolati
// periodicamente (job giornaliero). Nessun picco iniziale conquista subito
// il massimo: il bonus arriva solo se l'utilità si conferma nel tempo.
//
// Formula per recensione (documentata nella pagina «Come funziona»):
//   punti = [ min(Σ pesi dei voti validi, tetto) − voti anomali ] × bonus
//   bonus = 1,2 se i voti validi coprono ≥ 2 settimane distinte (≥ 3 voti)
//   MAI input dalle stelle: il giudizio (alto o basso) è fuori dalla formula.
//
// Controlli anti-abuso sui voti:
//   - scambi reciproci: se A vota le indagini di B e B quelle di A almeno
//     RECIPROCAL_MIN volte ciascuno, quei voti sono anomali;
//   - raffiche: oltre BURST_PER_DAY voti sulla stessa indagine in 24 ore,
//     l'eccesso è anomalo;
//   - account disabilitati non contano;
//   - ponderazione prudente: un voto vale 0,6–1,25 in base all'anzianità
//     e all'affidabilità del votante (mai un voto sulla persona).
//
// Ricorsi: se lo staff accoglie il ricorso (trustOverride), al ricalcolo
// successivo i controlli di reciprocità/raffica su quella indagine vengono
// sospesi e i voti esclusi tornano a contare.
import { db } from "@/lib/db";
import { sendMail } from "./mailer";

/* ---------- Regole (costanti documentate, modificabili solo nel codice) ---------- */

export const UTILITY_RULES = {
  // finestra mobile del riconoscimento
  windowDays: 30,
  // tetto di punti per recensione prima del bonus (anti-raffica strutturale)
  capPerReview: 20,
  // tetto assoluto dopo il bonus temporale
  capAfterBonus: 24,
  // bonus moderato per utilità confermata nel tempo
  bonusFactor: 1.2,
  bonusMinVotes: 3,
  bonusMinWeeks: 2,
  // indagine «a utilità confermata» (etichetta pubblica)
  confirmedMinVotes: 5,
  // anti-abuso
  reciprocalMin: 2,      // scambio A↔B oltre il quale i voti reciproci sono anomali
  burstPerDay: 6,        // voti oltre questo numero in 24h sulla stessa indagine
  anomalousPenalty: 1,   // punti tolti per ogni voto anomalo rilevato
  // ponderazione prudente del voto
  weightFresh: 0.6,      // account con meno di 30 giorni
  weightEstablished: 0.8,// 30–89 giorni
  weightMature: 1.0,     // 90 giorni o più
  weightVerifiedBonus: 0.1,   // email verificata
  weightBadgeBonus: 0.15,     // il votante ha già un riconoscimento di utilità
  weightMax: 1.25,
  // validità del badge oltre il ricalcolo (grazia se il job salta un giorno)
  badgeGraceDays: 2,
} as const;

export type UtilityBadgeCode = "contributo-utile" | "voce-affidabile" | "guida-community";

export const UTILITY_BADGES: Array<{
  code: UtilityBadgeCode;
  label: string;
  description: string;
  threshold: number;     // punti complessivi nella finestra
  minCategories: number; // categorie con utilità confermata
}> = [
  {
    code: "contributo-utile",
    label: "Contributo utile",
    description: "Le tue indagini hanno aiutato concretamente chi doveva decidere (≥ 10 punti di utilità nella finestra).",
    threshold: 10,
    minCategories: 1,
  },
  {
    code: "voce-affidabile",
    label: "Voce affidabile",
    description: "Utilità confermata su più fronti: ≥ 25 punti e utilità confermata in almeno 2 categorie diverse.",
    threshold: 25,
    minCategories: 2,
  },
  {
    code: "guida-community",
    label: "Guida della community",
    description: "Un punto di riferimento: ≥ 60 punti e utilità confermata in almeno 3 categorie diverse.",
    threshold: 60,
    minCategories: 3,
  },
];

export function utilityBadgeLabel(code: string): string {
  return UTILITY_BADGES.find(b => b.code === code)?.label || code;
}

/* ---------- Ponderazione prudente del voto ---------- */

export type VoterStanding = {
  createdAt: Date;
  emailVerified: boolean;
  hasUtilityBadge: boolean;
};

// Peso del voto: gli account affidabili contano «un po' più» di quelli
// appena creati, senza trasformare la reputazione in un voto sulla persona.
export function voterWeight(v: VoterStanding, now: Date = new Date()): number {
  const ageDays = (now.getTime() - v.createdAt.getTime()) / 86400000;
  let w = ageDays >= 90 ? UTILITY_RULES.weightMature
    : ageDays >= 30 ? UTILITY_RULES.weightEstablished
    : UTILITY_RULES.weightFresh;
  if (v.emailVerified) w += UTILITY_RULES.weightVerifiedBonus;
  if (v.hasUtilityBadge) w += UTILITY_RULES.weightBadgeBonus;
  return Math.min(UTILITY_RULES.weightMax, Math.round(w * 100) / 100);
}

/* ---------- Ricalcolo periodico ---------- */

export type UtilityStats = {
  calculatedAt: string;
  reviewsScored: number;      // indagini con punteggio nella finestra
  votesConsidered: number;    // voti «utile» nella finestra
  votesAnomalous: number;     // voti esclusi dai controlli
  confirmedReviews: number;   // indagini a utilità confermata
  badgesAssigned: number;     // badge attivi dopo il ricalcolo
};

type VoteRow = {
  reviewId: string;
  userId: string;
  createdAt: Date;
  review: { userId: string; entity: { categoryId: string } };
};

function weekKey(d: Date): string {
  // settimana ISO-like: anno + numero settimana (basta distinguere settimane)
  const t = new Date(d.getTime());
  const day = (t.getUTCDay() + 6) % 7; // lunedì = 0
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${t.getUTCFullYear()}-W${week}`;
}

// Ricalcola i punti di utilità di TUTTE le indagini pubblicate con voti
// nella finestra, poi i badge degli autori. Idempotente: può essere
// rieseguito a mano dal back office o chiamato dal job giornaliero.
export async function recomputeUtility(opts: { now?: Date } = {}): Promise<UtilityStats> {
  const now = opts.now ?? new Date();
  const windowStart = new Date(now.getTime() - UTILITY_RULES.windowDays * 86400000);

  // voti «utile» della finestra su indagini pubblicate di account attivi
  const votes = await db.reviewVote.findMany({
    where: {
      value: 1,
      createdAt: { gte: windowStart, lte: now },
      review: { status: "published" },
      user: { disabled: false },
    },
    select: {
      reviewId: true, userId: true, createdAt: true,
      review: { select: { userId: true, entity: { select: { categoryId: true } } } },
    },
  }) as VoteRow[];

  // stato precedente: badge attivi (per il peso) e override da ricorso accolto
  const [activeBadges, prevUtility] = await Promise.all([
    db.utilityBadge.findMany({ where: { expiresAt: { gt: now } }, select: { userId: true } }),
    db.reviewUtility.findMany({ select: { reviewId: true, trustOverride: true } }),
  ]);
  const badgeUsers = new Set(activeBadges.map(b => b.userId));
  const overrides = new Set(prevUtility.filter(u => u.trustOverride).map(u => u.reviewId));

  // informazioni dei votanti per la ponderazione (una sola query)
  const voterIds = [...new Set(votes.map(v => v.userId))];
  const voters = voterIds.length
    ? await db.user.findMany({ where: { id: { in: voterIds } }, select: { id: true, createdAt: true, emailVerified: true } })
    : [];
  const weightOf = new Map<string, number>();
  for (const v of voters) {
    weightOf.set(v.id, voterWeight(
      { createdAt: v.createdAt, emailVerified: v.emailVerified, hasUtilityBadge: badgeUsers.has(v.id) },
      now,
    ));
  }

  // mappa votante → autore → numero di voti: per gli scambi reciproci
  const given = new Map<string, Map<string, number>>();
  for (const v of votes) {
    const inner = given.get(v.userId) || new Map<string, number>();
    inner.set(v.review.userId, (inner.get(v.review.userId) || 0) + 1);
    given.set(v.userId, inner);
  }

  // raggruppa i voti per indagine
  const byReview = new Map<string, VoteRow[]>();
  for (const v of votes) {
    const arr = byReview.get(v.reviewId) || [];
    arr.push(v);
    byReview.set(v.reviewId, arr);
  }

  const perUser = new Map<string, { points: number; categories: Set<string> }>();
  let votesAnomalous = 0;
  let confirmedReviews = 0;

  for (const [reviewId, list] of byReview) {
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const authorId = sorted[0].review.userId;
    const skipAnomaly = overrides.has(reviewId);

    // raffiche: per ogni voto conta i voti nelle 24h precedenti sulla stessa
    // indagine; l'eccesso oltre BURST_PER_DAY è anomalo
    const burstIdx = new Set<number>();
    for (let i = 0; i < sorted.length; i++) {
      let inWindow = 0;
      for (let j = 0; j <= i; j++) {
        if (sorted[i].createdAt.getTime() - sorted[j].createdAt.getTime() <= 86400000) inWindow++;
      }
      if (inWindow > UTILITY_RULES.burstPerDay) burstIdx.add(i);
    }

    // scambi reciproci: A e B si votano a vicenda oltre la soglia
    const reciprocal = new Set<string>();
    if (!skipAnomaly) {
      for (const v of sorted) {
        const aToB = given.get(v.userId)?.get(authorId) || 0;
        const bToA = given.get(authorId)?.get(v.userId) || 0;
        if (aToB >= UTILITY_RULES.reciprocalMin && bToA >= UTILITY_RULES.reciprocalMin) {
          reciprocal.add(v.userId);
        }
      }
    }

    const anomalous = new Set<number>();
    if (!skipAnomaly) {
      sorted.forEach((v, i) => {
        if (burstIdx.has(i) || reciprocal.has(v.userId)) anomalous.add(i);
      });
    }
    votesAnomalous += anomalous.size;

    const valid = sorted.filter((_, i) => !anomalous.has(i));
    const weighted = valid.reduce((acc, v) => acc + (weightOf.get(v.userId) || UTILITY_RULES.weightFresh), 0);
    const weeks = new Set(valid.map(v => weekKey(v.createdAt))).size;

    const capped = Math.min(Math.round(weighted * 100) / 100, UTILITY_RULES.capPerReview);
    const penalized = Math.max(0, capped - anomalous.size * UTILITY_RULES.anomalousPenalty);
    const bonus = valid.length >= UTILITY_RULES.bonusMinVotes && weeks >= UTILITY_RULES.bonusMinWeeks;
    const points = Math.min(
      UTILITY_RULES.capAfterBonus,
      Math.round((bonus ? penalized * UTILITY_RULES.bonusFactor : penalized) * 100) / 100,
    );
    const confirmed = valid.length >= UTILITY_RULES.confirmedMinVotes
      || (valid.length >= UTILITY_RULES.bonusMinVotes && weeks >= UTILITY_RULES.bonusMinWeeks);
    if (confirmed) confirmedReviews++;

    await db.reviewUtility.upsert({
      where: { reviewId },
      create: {
        reviewId, validVotes: valid.length, anomalousVotes: anomalous.size,
        weightedVotes: Math.round(weighted * 100) / 100, points, weeksSpread: weeks,
        confirmed, trustOverride: overrides.has(reviewId), calculatedAt: now,
      },
      update: {
        validVotes: valid.length, anomalousVotes: anomalous.size,
        weightedVotes: Math.round(weighted * 100) / 100, points, weeksSpread: weeks,
        confirmed, calculatedAt: now,
      },
    });

    // aggregato per autore: punti di tutte le indagini, categorie confermate
    if (points > 0 || confirmed) {
      const agg = perUser.get(authorId) || { points: 0, categories: new Set<string>() };
      agg.points += points;
      if (confirmed) agg.categories.add(sorted[0].review.entity.categoryId);
      perUser.set(authorId, agg);
    }
  }

  // pulizia: indagini senza voti validi nella finestra non hanno punteggio
  const keepIds = [...byReview.keys()];
  if (keepIds.length) {
    await db.reviewUtility.deleteMany({ where: { reviewId: { notIn: keepIds } } });
  } else {
    await db.reviewUtility.deleteMany({});
  }

  /* ---------- badge ---------- */
  const expiresAt = new Date(now.getTime() + (UTILITY_RULES.windowDays + UTILITY_RULES.badgeGraceDays) * 86400000);
  let badgesAssigned = 0;
  const newlyBadged: Array<{ userId: string; code: UtilityBadgeCode }> = [];

  for (const badge of UTILITY_BADGES) {
    const earned = [...perUser.entries()]
      .filter(([, agg]) => agg.points >= badge.threshold && agg.categories.size >= badge.minCategories)
      .map(([userId, agg]) => ({ userId, agg }));
    const earnedIds = earned.map(e => e.userId);

    for (const { userId, agg } of earned) {
      const existing = await db.utilityBadge.findUnique({ where: { userId_code: { userId, code: badge.code } } });
      await db.utilityBadge.upsert({
        where: { userId_code: { userId, code: badge.code } },
        create: { userId, code: badge.code, points: Math.round(agg.points * 100) / 100, categories: agg.categories.size, awardedAt: now, expiresAt },
        update: { points: Math.round(agg.points * 100) / 100, categories: agg.categories.size, expiresAt },
      });
      if (!existing) newlyBadged.push({ userId, code: badge.code });
    }
    // chi non raggiunge più la soglia perde il riconoscimento (finestra mobile)
    if (earnedIds.length) {
      await db.utilityBadge.deleteMany({ where: { code: badge.code, userId: { notIn: earnedIds } } });
    } else {
      await db.utilityBadge.deleteMany({ where: { code: badge.code } });
    }
    badgesAssigned += earned.length;
  }

  // email solo per i NUOVI riconoscimenti (niente spam sui rinnovi)
  for (const nb of newlyBadged) {
    const u = await db.user.findUnique({ where: { id: nb.userId }, select: { email: true, isDemo: true, nickname: true } });
    if (!u || u.isDemo) continue;
    const meta = UTILITY_BADGES.find(b => b.code === nb.code)!;
    await sendMail(
      u.email,
      `Hai ottenuto il riconoscimento «${meta.label}»`,
      `La community ha trovato utili le tue indagini: hai ottenuto «${meta.label}». ${meta.description} ` +
      `Il riconoscimento è visibile sul tuo profilo e accanto alle tue indagini, e si riconferma finché l'utilità delle tue indagini resta nella finestra di ${UTILITY_RULES.windowDays} giorni. ` +
      `Cosa viene premiato: quanto un'indagine aiuta a decidere, mai le stelle né il numero di contributi.`,
    );
  }

  return {
    calculatedAt: now.toISOString(),
    reviewsScored: byReview.size,
    votesConsidered: votes.length,
    votesAnomalous,
    confirmedReviews,
    badgesAssigned,
  };
}

/* ---------- Letture per le API ---------- */

export type UtilitySummary = {
  confirmed: boolean;
  validVotes: number;
  anomalousVotes: number;
  points: number;
};

// Riepilogo di utilità per le indagini di un'entità (per la scheda pubblica).
export async function utilitySummariesForEntity(entityId: string): Promise<Map<string, UtilitySummary>> {
  const rows = await db.reviewUtility.findMany({
    where: { review: { entityId, status: "published" } },
    select: { reviewId: true, confirmed: true, validVotes: true, anomalousVotes: true, points: true },
  });
  return new Map(rows.map(r => [r.reviewId, {
    confirmed: r.confirmed, validVotes: r.validVotes, anomalousVotes: r.anomalousVotes, points: r.points,
  }]));
}

// Badge attivi per una lista di utenti (per le schede pubbliche: il badge
// accanto all'autore è un segnale di qualità, non un dato personale).
export async function activeUtilityBadges(userIds: string[]): Promise<Map<string, string[]>> {
  if (!userIds.length) return new Map();
  const rows = await db.utilityBadge.findMany({
    where: { userId: { in: userIds }, expiresAt: { gt: new Date() } },
    select: { userId: true, code: true },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.userId) || [];
    arr.push(r.code);
    map.set(r.userId, arr);
  }
  return map;
}
