// Pulizia degli account di collaudo creati dai test E2E di questa sessione
// (AgenziaCollaudo + collaudo.prop + uitest): recensioni, esperienze, schede
// ad hoc e sessioni vanno rimosse in ordine per rispettare le FK. Il catalogo
// demo del seed resta intatto.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const EMAILS = [
  "collaudo.agenzia@zoomzoom.test",
  "collaudo.prop@zoomzoom.test",
  "uitest@zoomzoom.test",
];

async function main() {
  for (const email of EMAILS) {
    const u = await db.user.findUnique({ where: { email }, select: { id: true, nickname: true, subjectEntityId: true } });
    if (!u) { console.log("già assente:", email); continue; }
    await db.review.deleteMany({ where: { userId: u.id } });
    await db.experience.deleteMany({ where: { OR: [{ userId: u.id }, { requestedById: u.id }] } });
    await db.premiumGrant.deleteMany({ where: { userId: u.id } });
    await db.session.deleteMany({ where: { userId: u.id } });
    await db.emailVerifyToken.deleteMany({ where: { userId: u.id } });
    await db.auditLog.deleteMany({ where: { actorId: u.id } });
    await db.report.deleteMany({ where: { reporterUserId: u.id } });
    if (u.subjectEntityId) {
      const scheda = await db.entity.findUnique({ where: { id: u.subjectEntityId }, select: { id: true, name: true } });
      if (scheda) {
        await db.review.deleteMany({ where: { entityId: scheda.id } });
        await db.experience.deleteMany({ where: { entityId: scheda.id } });
        await db.entity.delete({ where: { id: scheda.id } });
        console.log("rimossa scheda ad hoc:", scheda.name);
      }
    }
    await db.user.delete({ where: { id: u.id } });
    console.log("rimosso utente:", email);
  }
  // controllo finale: le recensioni demo di Palazzo delle Rondini
  const n = await db.review.count({ where: { entityId: "ent_i_rondini", status: "published" } });
  console.log("Palazzo delle Rondini — recensioni pubblicate:", n);
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
