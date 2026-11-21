// Riparazione one-off: ogni zona del catalogo senza la propria scheda
// recensibile (ent_z_<id>) la ottiene adesso, con la stessa convenzione di
// ensureZoneEntity. Idempotente: rieseguirlo non cambia nulla.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const zones = await db.zone.findMany({ include: { entities: { where: { categoryId: "zona", status: "published" } } } });
  let created = 0;
  for (const z of zones) {
    if (z.entities.length > 0) continue;
    const wantedId = `ent_z_${z.id}`;
    const taken = await db.entity.findUnique({ where: { id: wantedId } });
    await db.entity.create({
      data: {
        id: taken ? undefined : wantedId,
        categoryId: "zona",
        name: z.name,
        subtitle: z.province ? `${z.province}${z.region ? ` · ${z.region}` : ""}` : null,
        zoneId: z.id,
        status: "published",
        proposedBy: "system:repair-zone-sheets",
        isDemo: false,
      },
    });
    created += 1;
    console.log(`creata scheda zona: ${z.name} (${z.id})`);
  }
  console.log(`Fatto: ${created} schede zona create su ${zones.length} zone totali.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
