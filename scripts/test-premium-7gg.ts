// Verifica del passaggio del premio Premium da 30 a 7 giorni per recensione.
// Uso (su una copia scratch del DB, mai sul database buono):
//   cp db/custom.db db/test7gg.db
//   DATABASE_URL="file:/home/z/my-project/db/test7gg.db" bun scripts/test-premium-7gg.ts
//   rm db/test7gg.db
import { db } from "../src/lib/db";
import { getSettings, updateSettings } from "../src/lib/server/settings";
import { awardPremiumForReview } from "../src/lib/server/premium";

async function main() {
  let failures = 0;
  const check = (label: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
    if (!ok) failures++;
  };

  // 1) default nuovo: riga Setting senza la chiave (caso del DB attuale)
  const s1 = await getSettings();
  check("default premiumDaysPerReview = 7", s1.premiumDaysPerReview === 7, `valore: ${s1.premiumDaysPerReview}`);

  // 2) un valore salvato nel DB vince sul default del codice
  //    (è il motivo del controllo post-deploy descritto nel LEGGIMI)
  await updateSettings({ premiumDaysPerReview: 30 });
  const s2 = await getSettings();
  check("valore salvato a 30 prevale sul default (comportamento documentato)", s2.premiumDaysPerReview === 30, `valore: ${s2.premiumDaysPerReview}`);

  // 3) salvataggio a 7 dal back office (cosa fare se sul sito resta 30)
  await updateSettings({ premiumDaysPerReview: 7 });
  const s3 = await getSettings();
  check("salvataggio a 7 via back office", s3.premiumDaysPerReview === 7, `valore: ${s3.premiumDaysPerReview}`);

  // 4) premio end-to-end: catena minima Categoria → Scheda → Esperienza → Recensione
  const u = await db.user.create({
    data: { email: "test-7gg@zoomzoom.test", nickname: "test-7gg", emailVerified: true },
  });
  const cat = await db.category.create({
    data: {
      id: "cat-test-7gg", name: "Test 7gg", shortName: "T7",
      description: "categoria di test", hexColor: "#3B82F6", icon: "home",
    },
  });
  const ent = await db.entity.create({
    data: { categoryId: cat.id, name: "Via Test 7", address: "Via Test 7", streetNumber: "7" },
  });
  const exp = await db.experience.create({
    data: {
      entityId: ent.id, kind: "proprietario", origin: "self",
      clientEmail: "test-7gg@zoomzoom.test", userId: u.id, status: "active",
    },
  });
  const rev = await db.review.create({
    data: {
      experienceId: exp.id, entityId: ent.id, userId: u.id, score: 6,
      criteriaJson: "{}", prosJson: "[]", consJson: "[]",
      text: "Test del premio Premium a 7 giorni per recensione pubblicata.",
    },
  });
  const res = await awardPremiumForReview({ userId: u.id, reviewId: rev.id, settings: s3 });
  check("award assegna 7 giorni", res.grantedDays === 7, `giorni: ${res.grantedDays}`);
  const diffDays = res.until ? (res.until.getTime() - Date.now()) / 86400000 : 0;
  check("scadenza a +7 giorni", Math.abs(diffDays - 7) < 0.01, `scade fra ${diffDays.toFixed(3)} giorni`);

  // 5) anti-abuso invariato: stesso contributo, niente doppio premio
  const res2 = await awardPremiumForReview({ userId: u.id, reviewId: rev.id, settings: s3 });
  check("secondo award sullo stesso contributo non duplica", res2.grantedDays === 0, `giorni: ${res2.grantedDays}`);

  // 6) cap di accumulo invariato (premiumMaxDays = 365)
  check("cap di accumulo premiumMaxDays = 365", s3.premiumMaxDays === 365, `valore: ${s3.premiumMaxDays}`);

  // pulizia dei soli dati di test (l'ordine rispetta le chiavi esterne)
  await db.premiumGrant.deleteMany({ where: { userId: u.id } });
  await db.entity.delete({ where: { id: ent.id } }); // a cascata: Esperienza e Recensione
  await db.category.delete({ where: { id: cat.id } });
  await db.user.delete({ where: { id: u.id } });
  await db.$disconnect();

  if (failures) {
    console.log(`\n${failures} controlli falliti su 7.`);
    process.exit(1);
  }
  console.log("\nTutti i 7 controlli superati.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
