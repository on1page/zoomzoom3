// Pulizia dei dati creati dalla verifica browser del flusso territorio
// nazionale (scheda "Via del Paesino 4" a Corte de' Frati + recensione).
import { PrismaClient } from "@prisma/client";
import { recomputePremiumUntil } from "../src/lib/server/premium";
const db = new PrismaClient();

async function main() {
  const ent = await db.entity.findFirst({ where: { address: "Via del Paesino 4" } });
  if (ent) {
    console.log("Pulisco:", ent.id, ent.address, "zona:", ent.zoneId);
    const reviews = await db.review.findMany({ where: { entityId: ent.id }, select: { id: true, experienceId: true } });
    for (const r of reviews) {
      await db.premiumGrant.deleteMany({ where: { reviewId: r.id } });
      await db.review.delete({ where: { id: r.id } });
      await db.experience.deleteMany({ where: { id: r.experienceId } });
    }
    await db.entity.delete({ where: { id: ent.id } });
  }

  // scheda zona + zona di Corte de' Frati (creata dalla verifica)
  const zoneEnt = await db.entity.findUnique({ where: { id: "ent_z_corte-de-frati" } });
  if (zoneEnt) await db.entity.delete({ where: { id: zoneEnt.id } });
  await db.zone.deleteMany({ where: { id: "corte-de-frati" } });

  // ricalcolo lo stato Premium del demo user dopo la revoca del grant
  const u = await db.user.findUnique({ where: { email: "utente@esempio.test" } });
  if (u) { await recomputePremiumUntil(u.id); console.log("Premium del demo user ricalcolato."); }

  console.log("Pulizia completata.");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
