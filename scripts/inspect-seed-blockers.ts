// Ispeziona (e con --fix rimuove) le entità NON-demo che referenziano zone
// demo: sono artefatti dei collaudi precedenti e bloccano il re-seeding.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const demoZones = await db.zone.findMany({ where: { isDemo: true }, select: { id: true } });
  const ids = demoZones.map(z => z.id);
  const blockers = await db.entity.findMany({
    where: { zoneId: { in: ids }, isDemo: false },
    select: { id: true, name: true, proposedBy: true, zoneId: true, status: true },
  });
  console.log("Entità non-demo in zone demo:", JSON.stringify(blockers, null, 1));
  const nonDemoZones = await db.zone.findMany({ where: { isDemo: false }, select: { id: true, name: true, source: true } });
  console.log("Zone non-demo:", JSON.stringify(nonDemoZones, null, 1));

  if (process.argv.includes("--fix")) {
    // artefatti di collaudo: esperienze e recensioni vanno prima (FK), poi le entità
    for (const b of blockers) {
      await db.review.deleteMany({ where: { entityId: b.id } });
      await db.experience.deleteMany({ where: { entityId: b.id } });
      await db.entity.delete({ where: { id: b.id } });
      console.log("rimossa entità:", b.id, b.name);
    }
    // profili consulente di collaudo collegati a zone demo (le perizie vanno
    // a cascata): bloccano la cancellazione delle zone demo nel seed
    const consultantBlockers = await db.consultantProfile.findMany({
      where: { zoneId: { in: ids } },
      select: { id: true, userId: true, firstName: true, lastName: true },
    });
    for (const c of consultantBlockers) {
      await db.consultantProfile.delete({ where: { id: c.id } });
      console.log("rimosso profilo consulente:", c.firstName, c.lastName);
    }
    // perizie orfane che puntano a zone demo
    await db.periziaRequest.deleteMany({ where: { zoneId: { in: ids } } });
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
