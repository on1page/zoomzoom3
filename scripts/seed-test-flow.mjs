// Dati di test per la verifica del flusso contributo semplificato:
// 2 zone (una con scheda attiva), 2 immobili (uno con posizione vicino a
// un indirizzo noto, per testare la proposta di riuso entro 50 m).
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  // zone
  const milano = await db.zone.upsert({
    where: { id: "milano" },
    update: {},
    create: { id: "milano", name: "Milano", province: "MI", region: "Lombardia", source: "seed", gpsLat: 45.4642, gpsLng: 9.19, radiusM: 6000 },
  });
  const alassio = await db.zone.upsert({
    where: { id: "alassio" },
    update: {},
    create: { id: "alassio", name: "Alassio", province: "SV", region: "Liguria", source: "seed", gpsLat: 44.0122, gpsLng: 8.1639, radiusM: 3000 },
  });
  // scheda zona attiva per Milano
  let zonaEnt = await db.entity.findFirst({ where: { categoryId: "zona", zoneId: milano.id } });
  if (!zonaEnt) {
    zonaEnt = await db.entity.create({
      data: { categoryId: "zona", name: "Milano (città)", subtitle: null, address: null, zoneId: milano.id, status: "published", isDemo: true },
    });
  }
  // immobile esistente con posizione (Via dei Mille 12, Milano ~ centro)
  const imm1 = await db.entity.findFirst({ where: { name: "Via dei Mille 12, Milano" } });
  if (!imm1) {
    await db.entity.create({
      data: {
        categoryId: "immobile", name: "Via dei Mille 12, Milano", address: "Via dei Mille 12",
        zoneId: milano.id, geoLat: 45.4712, geoLng: 9.2065, status: "published", isDemo: true,
      },
    });
  }
  const imm2 = await db.entity.findFirst({ where: { name: "Via del Filatoio 4, Alassio" } });
  if (!imm2) {
    await db.entity.create({
      data: {
        categoryId: "immobile", name: "Via del Filatoio 4, Alassio", address: "Via del Filatoio 4",
        zoneId: alassio.id, geoLat: 44.0126, geoLng: 8.1704, status: "published", isDemo: true,
      },
    });
  }
  // un soggetto (agenzia) per il ramo "altro"
  const ag = await db.entity.findFirst({ where: { name: "Immobiliare Aurora" } });
  if (!ag) {
    await db.entity.create({
      data: { categoryId: "agenzia", name: "Immobiliare Aurora", subtitle: "Agenzia immobiliare", address: "Corso Buenos Aires 10", zoneId: milano.id, status: "published", isDemo: true },
    });
  }
  console.log("OK: zone Milano/Alassio, scheda zona Milano, 2 immobili, 1 agenzia");
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
