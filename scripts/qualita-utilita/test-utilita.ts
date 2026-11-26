// Collaudo del riconoscimento di utilità su un database di prova isolato.
// Copre: ponderazione dei voti, finestra 30 giorni, bonus nel tempo, tetto,
// penalità voti anomali (raffica), scambi reciproci, badge per soglie e
// varietà, ricorso accolto (trustOverride) e idempotenza del ricalcolo.
//
// Uso: DB di prova già creato (vedi istruzione bash nel LEGGIMI):
//   DATABASE_URL=file:./db/test-utilita.db bunx prisma db push --skip-generate
//   DATABASE_URL=file:./db/test-utilita.db bun scripts/qualita-utilita/test-utilita.ts
process.env.DATABASE_URL = "file:/home/z/my-project/db/test-utilita.db";

const DAY = 86400000;
const now = Date.now();
let failures = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ottenuto ${JSON.stringify(got)}${ok ? "" : ` (atteso ${JSON.stringify(want)})`}`);
}

async function main() {
  const { db } = await import("@/lib/db");
  const { recomputeUtility, voterWeight, utilitySummariesForEntity } = await import("@/lib/server/utility");

  /* ---------- dati di prova ---------- */
  const mk = (id: string, name: string, color: string) =>
    db.category.create({ data: { id, name, shortName: name, description: name, hexColor: color, icon: "home" } });
  await mk("immobile", "Immobili", "#2C6E49");
  await mk("zona", "Zone", "#17457A");

  await db.zone.create({
    data: { id: "milano-test", name: "Milano (test)", gpsLat: 45.46, gpsLng: 9.19, source: "seed" },
  });

  const user = (id: string, nickname: string, ageDays: number, verified = true) =>
    db.user.create({
      data: {
        id, email: `${id}@test.local`, nickname,
        emailVerified: verified, isDemo: true, // isDemo: niente email all'assegnazione dei badge
        createdAt: new Date(now - ageDays * DAY),
      },
    });
  // A = autore candidato al badge; V1-V8 = votanti anziani verificati;
  // F = votante fresco (5 giorni); B, P, Q = autori per raffica/reciproco
  await user("A", "autore-badge", 400);
  await user("B", "autore-raffica", 400);
  await user("P", "votante-reciproco-1", 400);
  await user("Q", "votante-reciproco-2", 400);
  for (const v of ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"]) await user(v, `votante-${v}`, 120);
  await user("F", "votante-fresco", 5);

  const entity = (id: string, categoryId: string, name: string) =>
    db.entity.create({ data: { id, categoryId, name, status: "published", zoneId: "milano-test" } });
  const ent1 = await entity("ent-casa", "immobile", "Via Test 1");
  const ent2 = await entity("ent-zona", "zona", "Zona Test");
  const ent3 = await entity("ent-raffica", "immobile", "Via Raffica 2");
  const entP = await entity("ent-p", "immobile", "Via Reciproco 3");
  const entQ = await entity("ent-q", "immobile", "Via Reciproco 4");

  const review = async (id: string, authorId: string, entityId: string) => {
    await db.experience.create({
      data: { id: `exp-${id}`, entityId, kind: "affitto", origin: "self", clientEmail: `${authorId}@test.local`, userId: authorId, status: "active", isDemo: true },
    });
    return db.review.create({
      data: {
        id, experienceId: `exp-${id}`, entityId, userId: authorId,
        score: 6.5, criteriaJson: "[]", prosJson: "[]", consJson: "[]",
        text: "Indagine di prova per il collaudo dei punti di utilità.", status: "published", isDemo: true,
      },
    });
  };
  const r1 = await review("rev-1", "A", ent1.id);  // immobile
  const r2 = await review("rev-2", "A", ent2.id);  // zona
  const r3 = await review("rev-3", "B", ent3.id);  // raffica
  const rP1 = await review("rev-p1", "P", entP.id);
  const rP2 = await review("rev-p2", "P", entP.id);
  const rQ1 = await review("rev-q1", "Q", entQ.id);
  const rQ2 = await review("rev-q2", "Q", entQ.id);

  const vote = (reviewId: string, userId: string, ageDays: number, value = 1) =>
    db.reviewVote.create({ data: { reviewId, userId, value, createdAt: new Date(now - ageDays * DAY) } });

  // R1: 4 voti anziani verificati (peso 1,1) su 3 settimane + 1 voto fresco (0,7)
  // atteso: weighted 5,1 → bonus ×1,2 (5 voti, 3 settimane) → 6,12 punti, confermata
  await vote(r1.id, "V1", 20);
  await vote(r1.id, "V2", 13);
  await vote(r1.id, "V3", 6);
  await vote(r1.id, "V4", 2);
  await vote(r1.id, "F", 0);

  // R2: 4 voti anziani su 2 settimane → 4,4 → bonus → 5,28, confermata
  await vote(r2.id, "V1", 15);
  await vote(r2.id, "V2", 10);
  await vote(r2.id, "V3", 4);
  await vote(r2.id, "V4", 1);

  // R3: raffica — 8 voti nella stessa ora → 6 validi + 2 anomali
  for (let i = 0; i < 8; i++) await vote(r3.id, `V${i + 1}`, 0);

  // reciproci: P vota le 2 indagini di Q e Q le 2 di P → tutti anomali
  await vote(rQ1.id, "P", 3); await vote(rQ2.id, "P", 2);
  await vote(rP1.id, "Q", 3); await vote(rP2.id, "Q", 2);

  /* ---------- verifica della ponderazione ---------- */
  check("peso: account fresco non verificato", voterWeight({ createdAt: new Date(now - 5 * DAY), emailVerified: false, hasUtilityBadge: false }), 0.6);
  check("peso: account fresco verificato", voterWeight({ createdAt: new Date(now - 5 * DAY), emailVerified: true, hasUtilityBadge: false }), 0.7);
  check("peso: account anziano verificato", voterWeight({ createdAt: new Date(now - 120 * DAY), emailVerified: true, hasUtilityBadge: false }), 1.1);
  check("peso: tetto massimo con badge", voterWeight({ createdAt: new Date(now - 120 * DAY), emailVerified: true, hasUtilityBadge: true }), 1.25);

  /* ---------- ricalcolo ---------- */
  const stats = await recomputeUtility();
  console.log("stats:", JSON.stringify(stats));

  const u1 = await db.reviewUtility.findUnique({ where: { reviewId: r1.id } });
  const u2 = await db.reviewUtility.findUnique({ where: { reviewId: r2.id } });
  const u3 = await db.reviewUtility.findUnique({ where: { reviewId: r3.id } });
  const uP1 = await db.reviewUtility.findUnique({ where: { reviewId: rP1.id } });
  const uQ1 = await db.reviewUtility.findUnique({ where: { reviewId: rQ1.id } });

  check("R1 voti validi", u1?.validVotes, 5);
  check("R1 settimane distinte", u1?.weeksSpread, 4);
  check("R1 punti (bonus nel tempo)", u1?.points, 6.12);
  check("R1 utilità confermata", u1?.confirmed, true);
  check("R2 punti", u2?.points, 5.28);
  check("R2 confermata", u2?.confirmed, true);
  check("R3 voti anomali (raffica)", u3?.anomalousVotes, 2);
  check("R3 punti (6,6 - 2)", u3?.points, 4.6);
  check("R3 confermata (6 voti validi, senza bonus tempo)", u3?.confirmed, true);
  check("scambio reciproco P→Q anomalo", uQ1?.anomalousVotes, 1);
  check("scambio reciproco Q→P anomalo", uP1?.anomalousVotes, 1);
  check("scambio reciproco: zero punti", uQ1?.points, 0);

  /* ---------- badge: 6,12 + 5,28 = 11,4 punti, 2 categorie confermate ---------- */
  const badges = await db.utilityBadge.findMany({ where: { userId: "A" } });
  check("badge A: solo «contributo utile»", badges.map(b => b.code), ["contributo-utile"]);
  check("badge A: categorie confermate registrate", badges[0]?.categories, 2);
  check("badge A: punti registrati", badges[0]?.points, 11.4);
  const badgeB = await db.utilityBadge.findMany({ where: { userId: "B" } });
  check("badge B: nessuno (sotto soglia)", badgeB.length, 0);

  /* ---------- riepilogo per entità (scheda pubblica) ---------- */
  const sum1 = await utilitySummariesForEntity(ent1.id);
  check("riepilogo entità 1: confermata", sum1.get(r1.id)?.confirmed, true);

  /* ---------- idempotenza ---------- */
  const again = await recomputeUtility();
  const u1b = await db.reviewUtility.findUnique({ where: { reviewId: r1.id } });
  check("idempotenza: punti invariati", u1b?.points, 6.12);
  check("idempotenza: badge non duplicati", (await db.utilityBadge.findMany({ where: { userId: "A" } })).length, 1);
  void again;

  /* ---------- ricorso accolto: trustOverride sulla raffica ---------- */
  await db.reviewUtility.update({ where: { reviewId: r3.id }, data: { trustOverride: true } });
  await recomputeUtility();
  const u3b = await db.reviewUtility.findUnique({ where: { reviewId: r3.id } });
  check("ricorso accolto: raffica riammessa", u3b?.anomalousVotes, 0);
  check("ricorso accolto: override conservato", u3b?.trustOverride, true);
  check("ricorso accolto: tutti i voti riammessi (8×1,1)", u3b?.points, 8.8);

  /* ---------- finestra mobile: i voti vecchi escono dal conteggio ---------- */
  // sposto i voti di R1 a 40 giorni fa → nessun voto nella finestra → riga tolta
  await db.reviewVote.updateMany({ where: { reviewId: r1.id }, data: { createdAt: new Date(now - 40 * DAY) } });
  await recomputeUtility();
  check("finestra mobile: R1 senza punteggio", await db.reviewUtility.findUnique({ where: { reviewId: r1.id } }), null);
  // e il badge «contributo utile» non è più raggiunto (restano 5,28 punti)
  const badgesAfter = await db.utilityBadge.findMany({ where: { userId: "A" } });
  check("finestra mobile: badge perso sotto soglia", badgesAfter.map(b => b.code), []);

  console.log(failures ? `\n${failures} CONTROLLI FALLITI` : "\nTUTTI I CONTROLLI SUPERATI");
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
