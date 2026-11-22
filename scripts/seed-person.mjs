import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const ex = await db.entity.findFirst({ where: { name: "Giuseppe Verdi (proprietario)" } });
if (!ex) {
  await db.entity.create({
    data: { categoryId: "proprietario", name: "Giuseppe Verdi (proprietario)", subtitle: "Proprietario", address: null, zoneId: "milano", status: "published", isDemo: true, initialsOnly: false },
  });
  console.log("creato soggetto persona");
} else console.log("già presente");
await db.$disconnect();
