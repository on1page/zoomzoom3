// ZoomZoom — Membership Premium: logica server-side.
// Il Premium si guadagna contribuendo (una recensione verificata pubblicata =
// N giorni) o per concessione amministrativa. Lo stato NON è memorizzato a
// parte: premiumUntil è sempre il massimo expiresAt dei grant non revocati,
// così ogni revoca (es. recensione nascosta per frode) si riflette subito.
// Il gating è applicato QUI e nelle rotte API, mai solo nel client.
import { db } from "@/lib/db";
import type { AppSettings } from "./settings";

export type PremiumUserLike = {
  id: string;
  role: string;
  premiumUntil: Date | null;
};

export type PremiumState = {
  active: boolean;
  until: Date | null;
};

export function premiumStateOf(user: PremiumUserLike | null): PremiumState {
  if (!user) return { active: false, until: null };
  const until = user.premiumUntil && user.premiumUntil.getTime() > Date.now() ? user.premiumUntil : null;
  return { active: !!until, until };
}

// Accesso pieno alle recensioni integrali: Premium attivo, staff (che deve
// moderare) oppure funzione disattivata da back office (comportamento pre-Premium).
export function hasPremiumAccess(user: PremiumUserLike | null, settings: AppSettings): boolean {
  if (!settings.premiumEnabled) return true;
  if (!user) return false;
  if (["moderator", "admin", "superadmin"].includes(user.role)) return true;
  return premiumStateOf(user).active;
}

// Ricalcola User.premiumUntil = max(expiresAt) dei grant attivi (non revocati
// e non scaduti). Chiamata dopo ogni variazione dei grant.
export async function recomputePremiumUntil(userId: string): Promise<Date | null> {
  const grants = await db.premiumGrant.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { expiresAt: true },
  });
  const until = grants.reduce<Date | null>((acc, g) => (!acc || g.expiresAt > acc ? g.expiresAt : acc), null);
  await db.user.update({ where: { id: userId }, data: { premiumUntil: until } });
  return until;
}

export type PremiumGrantResult = {
  grantedDays: number;
  until: Date | null;
};

// Assegna i giorni Premium per una recensione pubblicata, rispettando il cap
// di accumulo (premiumUntil mai oltre adesso + premiumMaxDays).
export async function awardPremiumForReview(opts: {
  userId: string; reviewId: string; settings: AppSettings; grantedAt?: Date;
}): Promise<PremiumGrantResult> {
  const { userId, reviewId, settings } = opts;
  if (!settings.premiumEnabled || settings.premiumDaysPerReview <= 0) {
    return { grantedDays: 0, until: null };
  }
  const existing = await db.premiumGrant.findUnique({ where: { reviewId } });
  if (existing) return { grantedDays: 0, until: existing.revokedAt ? null : existing.expiresAt };

  const grantedAt = opts.grantedAt ?? new Date();
  const user = await db.user.findUnique({ where: { id: userId }, select: { premiumUntil: true } });
  const days = settings.premiumDaysPerReview;
  // base di accumulo: la scadenza attuale se ancora valida, altrimenti adesso
  const base = user?.premiumUntil && user.premiumUntil.getTime() > grantedAt.getTime() ? user.premiumUntil : grantedAt;
  // cap: mai oltre grantedAt + premiumMaxDays (l'orizzonte si sposta col tempo)
  const cappedExpiry = new Date(Math.min(
    base.getTime() + days * 86400000,
    grantedAt.getTime() + settings.premiumMaxDays * 86400000,
  ));
  const effectiveDays = Math.max(1, Math.round((cappedExpiry.getTime() - base.getTime()) / 86400000));
  const expiresAt = new Date(base.getTime() + effectiveDays * 86400000);

  await db.premiumGrant.create({
    data: { userId, reviewId, days: effectiveDays, origin: "review", grantedAt, expiresAt },
  });
  const until = await recomputePremiumUntil(userId);
  return { grantedDays: effectiveDays, until };
}

// Revoca mirata: la moderazione nasconde una recensione → il Premium ottenuto
// con quel contributo torna indietro (premiumUntil ricalcolato dai grant rimasti).
export async function revokePremiumForReview(reviewId: string, reason: string): Promise<void> {
  const g = await db.premiumGrant.findUnique({ where: { reviewId } });
  if (!g || g.revokedAt) return;
  await db.premiumGrant.update({
    where: { id: g.id },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 300) },
  });
  await recomputePremiumUntil(g.userId);
}

// Ripristino: recensione reinserita dopo appello → il grant torna attivo.
export async function restorePremiumForReview(reviewId: string): Promise<void> {
  const g = await db.premiumGrant.findUnique({ where: { reviewId } });
  if (!g || !g.revokedAt) return;
  await db.premiumGrant.update({ where: { id: g.id }, data: { revokedAt: null, revokedReason: null } });
  await recomputePremiumUntil(g.userId);
}

// Concessione manuale dal back office.
export async function grantPremiumManually(opts: {
  userId: string; days: number; reason: string;
}): Promise<PremiumGrantResult> {
  const now = new Date();
  const user = await db.user.findUnique({ where: { id: opts.userId }, select: { premiumUntil: true } });
  const base = user?.premiumUntil && user.premiumUntil.getTime() > now.getTime() ? user.premiumUntil : now;
  const expiresAt = new Date(base.getTime() + opts.days * 86400000);
  await db.premiumGrant.create({
    data: { userId: opts.userId, days: opts.days, origin: "admin", grantedAt: now, expiresAt },
  });
  const until = await recomputePremiumUntil(opts.userId);
  return { grantedDays: opts.days, until };
}

// Revoca di tutti i grant attivi di un utente (provvedimento amministrativo).
export async function revokeAllPremium(userId: string, reason: string): Promise<number> {
  const active = await db.premiumGrant.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
  const now = new Date();
  await db.premiumGrant.updateMany({
    where: { id: { in: active.map(g => g.id) } },
    data: { revokedAt: now, revokedReason: reason.slice(0, 300) },
  });
  await recomputePremiumUntil(userId);
  return active.length;
}
