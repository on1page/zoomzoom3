// Collaudo visivo: semina voti di utilità sul DB locale di sviluppo e
// ricalcola i punti, così scheda/profilo/back office mostrano dati reali.
// Solo per ambiente locale: non fa parte della patch.
process.env.DATABASE_URL = process.env.DATABASE_URL || "file:/home/z/my-project/db/custom.db";

async function main() {
  const { db } = await import("@/lib/db");
  const { recomputeUtility } = await import("@/lib/server/utility");

  const reviews = await db.review.findMany({
    where: { status: "published" },
    select: { id: true, userId: true, entity: { select: { name: true, categoryId: true } }, user: { select: { nickname: true } } },
    take: 6,
  });
  console.log("recensioni pubblicate:", reviews.length);
  if (!reviews.length) { console.log("Nessuna recensione: niente da seminare."); return; }

  // votanti: utenti esistenti diversi dagli autori
  const authors = new Set(reviews.map(r => r.userId));
  const voters = await db.user.findMany({
    where: { id: { notIn: [...authors] }, disabled: false },
    select: { id: true, nickname: true },
    take: 12,
  });
  console.log("votanti disponibili:", voters.map(v => v.nickname).join(", "));

  const DAY = 86400000;
  const now = Date.now();
  let seeded = 0;
  // pattern: voti sparsi su settimane diverse (bonus tempo) per le prime 2
  // recensioni; una piccola raffica sulla terza (2 voti anomali attesi)
  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i];
    const pattern = i < 2 ? [18, 12, 7, 3, 1, 0] : i === 2 ? [0, 0, 0, 0, 0, 0, 0, 0] : [9, 4, 1];
    for (let k = 0; k < pattern.length; k++) {
      const voter = voters[(i + k) % voters.length];
      if (!voter || voter.id === r.userId) continue;
      const exists = await db.reviewVote.findUnique({ where: { reviewId_userId: { reviewId: r.id, userId: voter.id } } });
      if (exists) continue;
      await db.reviewVote.create({
        data: { reviewId: r.id, userId: voter.id, value: 1, createdAt: new Date(now - pattern[k] * DAY - k * 3600000) },
      });
      seeded++;
    }
  }
  console.log(`voti seminati: ${seeded}`);

  // un ricorso di prova per il back office (dell'autore della prima recensione)
  const existingAppeal = await db.utilityAppeal.findFirst();
  if (!existingAppeal && reviews[0]) {
    await db.utilityAppeal.create({
      data: {
        userId: reviews[0].userId, reviewId: reviews[0].id,
        reason: "Ricorso di collaudo: ritengo che i voti esclusi sulla mia indagine provengano da lettori reali.",
      },
    });
    console.log("ricorso di prova creato");
  }

  const stats = await recomputeUtility();
  console.log("ricalcolo:", JSON.stringify(stats));
  const rows = await db.reviewUtility.findMany({ select: { points: true, validVotes: true, anomalousVotes: true, confirmed: true, review: { select: { entity: { select: { name: true } } } } } });
  for (const u of rows) console.log(`  ${u.review.entity.name}: ${u.points} punti, ${u.validVotes} validi, ${u.anomalousVotes} anomali, confermata=${u.confirmed}`);
  const badges = await db.utilityBadge.findMany();
  console.log("badge assegnati:", JSON.stringify(badges.map(b => ({ user: b.userId, code: b.code, points: b.points }))));
}

main().catch(e => { console.error(e); process.exit(1); });
