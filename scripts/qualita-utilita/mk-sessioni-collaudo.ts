// Sessioni di collaudo per il browser: un utente con indagini votate (per la
// scheda profilo) e una sessione amministrativa (per il back office).
// Stampa i token dei cookie e gli id delle schede da visitare.
process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";

import { createHash, randomBytes, scryptSync } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  const { db } = await import("@/lib/db");
  const { recomputeUtility } = await import("@/lib/server/utility");

  /* ---------- utente di collaudo con indagini votate ---------- */
  const email = "utilita.test@zoomzoom.test";
  const old = await db.user.findUnique({ where: { email } });
  if (old) {
    // il cascade cancella le recensioni, ma le esperienze (relazione opzionale)
    // sopravvivono orfane: vanno rimosse a mano prima di ricrearle
    await db.experience.deleteMany({ where: { OR: [{ id: { in: ["exp-uti-a", "exp-uti-b"] } }, { clientEmail: email }] } });
    await db.reviewVote.deleteMany({ where: { review: { userId: old.id } } });
    await db.user.delete({ where: { id: old.id } });
  }
  const salt = randomBytes(16).toString("hex");
  const me = await db.user.create({
    data: {
      email, nickname: "collaudo-utilita", role: "user", emailVerified: true,
      passwordHash: `scrypt$16384$8$1$${salt}$${scryptSync("test1234", salt, 64).toString("hex")}`,
      createdAt: new Date(Date.now() - 200 * 86400000), // account anziano: peso pieno
    },
  });

  // due indagini su schede esistenti di categorie diverse (varietà)
  const targets = await db.entity.findMany({
    where: { status: "published" },
    select: { id: true, name: true, categoryId: true },
    take: 8,
  });
  const immobile = targets.find(t => t.categoryId === "immobile") || targets[0];
  const zona = targets.find(t => t.categoryId === "zona") || targets[1];
  const mkReview = async (suffix: string, entityId: string) => {
    const expId = `exp-uti-${suffix}`;
    await db.experience.create({
      data: { id: expId, entityId, kind: "affitto", origin: "self", clientEmail: email, userId: me.id, status: "active", isDemo: true },
    });
    return db.review.create({
      data: {
        id: `rev-uti-${suffix}`, experienceId: expId, entityId, userId: me.id,
        score: 7.5, criteriaJson: "[]", prosJson: "[]", consJson: "[]",
        text: "Indagine di collaudo: ascensore rifatto nel 2023, rumori isolati, amministrazione trasparente sulle spese.", status: "published", isDemo: true,
      },
    });
  };
  const rA = await mkReview("a", immobile.id);
  const rB = await mkReview("b", zona.id);

  // voti di altri utenti, sparsi su settimane (bonus tempo) → badge previsto
  const voters = (await db.user.findMany({
    where: { id: { not: me.id }, disabled: false }, select: { id: true }, take: 10,
  })).map(v => v.id);
  const DAY = 86400000;
  const now = Date.now();
  const patterns = [
    [rA.id, [17, 11, 6, 2, 0]],
    [rB.id, [14, 9, 5, 1]],
  ] as const;
  let n = 0;
  for (const [reviewId, days] of patterns) {
    for (const d of days) {
      const voter = voters[n++ % voters.length];
      await db.reviewVote.create({ data: { reviewId, userId: voter, value: 1, createdAt: new Date(now - d * DAY) } });
    }
  }
  await recomputeUtility();
  const myBadges = await db.utilityBadge.findMany({ where: { userId: me.id } });
  console.log("LOG utente:", email, "password: test1234");
  console.log("LOG badge dell'utente di collaudo:", JSON.stringify(myBadges.map(b => ({ code: b.code, points: b.points, categories: b.categories }))));

  // grant Premium come farebbe la pubblicazione via API (in collaudo le
  // recensioni sono inserite direttamente: senza questo passaggio l'utente
  // vedrebbe solo i teaser offuscati) — e attiva l'etichetta «incentivato»
  await db.premiumGrant.create({
    data: {
      userId: me.id, reviewId: rA.id, days: 7, origin: "review",
      grantedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  const until = await db.user.update({
    where: { id: me.id }, data: { premiumUntil: new Date(Date.now() + 7 * 86400000) }, select: { premiumUntil: true },
  });
  console.log("LOG premium attivo fino a:", until.premiumUntil?.toISOString());

  /* ---------- sessione pubblica ---------- */
  const publicToken = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId: me.id, kind: "public", tokenHash: sha256(publicToken), expiresAt: new Date(Date.now() + 4 * 3600_000) },
  });

  /* ---------- sessione amministrativa (superadmin esistente) ---------- */
  const admin = await db.user.findFirst({ where: { role: "superadmin" }, select: { id: true, email: true } });
  let adminToken: string | null = null;
  if (admin) {
    await db.session.deleteMany({ where: { userId: admin.id, kind: "admin" } });
    adminToken = randomBytes(32).toString("hex");
    await db.session.create({
      data: { userId: admin.id, kind: "admin", tokenHash: sha256(adminToken), expiresAt: new Date(Date.now() + 4 * 3600_000) },
    });
  }

  console.log("PUBLIC_TOKEN=" + publicToken);
  console.log("ADMIN_TOKEN=" + adminToken);
  console.log("ENTITY_IMMOBILE=" + immobile.id + " (" + immobile.name + ")");
  console.log("ENTITY_REVIEWED=" + (targets.find(t => ["Palazzo delle Rondini", "Condomini Sereni"].includes(t.name))?.id || targets[0].id));
}
main().catch(e => { console.error(e); process.exit(1); });
