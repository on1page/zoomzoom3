// Test revoca/ripristino Premium (stessa logica invocata da review.hide/restore).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const REVIEW_ID = process.argv[2];
const USER_EMAIL = process.argv[3] || "test-nopremium@esempio.test";

async function state() {
  const u = await db.user.findUnique({ where: { email: USER_EMAIL }, select: { premiumUntil: true } });
  const g = await db.premiumGrant.findUnique({ where: { reviewId: REVIEW_ID } });
  return { premiumUntil: u?.premiumUntil ?? null, grant: g ? { revokedAt: g.revokedAt, revokedReason: g.revokedReason, expiresAt: g.expiresAt } : null };
}

async function main() {
  if (!REVIEW_ID) throw new Error("uso: bun scripts/test-premium-revoke.ts <reviewId> [email] [revoke-only]");
  const revokeOnly = process.argv[4] === "revoke-only";
  console.log("PRIMA  :", await state());

  // --- revoca (moderazione nasconde la recensione) ---
  const g1 = await db.premiumGrant.findUnique({ where: { reviewId: REVIEW_ID } });
  if (g1 && !g1.revokedAt) {
    await db.premiumGrant.update({ where: { id: g1.id }, data: { revokedAt: new Date(), revokedReason: "Test: recensione nascosta dalla moderazione." } });
    const active = await db.premiumGrant.findMany({ where: { userId: g1.userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { expiresAt: true } });
    const until = active.reduce<Date | null>((a, x) => (!a || x.expiresAt > a ? x.expiresAt : a), null);
    await db.user.update({ where: { id: g1.userId }, data: { premiumUntil: until } });
  }
  console.log("DOPO REVOCHE:", await state());
  if (revokeOnly) return;

  // --- ripristino (appello accolto) ---
  const g2 = await db.premiumGrant.findUnique({ where: { reviewId: REVIEW_ID } });
  if (g2 && g2.revokedAt) {
    await db.premiumGrant.update({ where: { id: g2.id }, data: { revokedAt: null, revokedReason: null } });
    const active = await db.premiumGrant.findMany({ where: { userId: g2.userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { expiresAt: true } });
    const until = active.reduce<Date | null>((a, x) => (!a || x.expiresAt > a ? x.expiresAt : a), null);
    await db.user.update({ where: { id: g2.userId }, data: { premiumUntil: until } });
  }
  console.log("DOPO RIPRISTINO:", await state());
}
main().finally(() => db.$disconnect());
