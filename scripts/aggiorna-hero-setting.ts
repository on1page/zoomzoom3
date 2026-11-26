// Aggiorna la riga Setting "app" del DB locale portando heroTitle/heroSub
// al nuovo copy «indagini della community» (Fase 1, D11).
// Uso: bun scripts/aggiorna-hero-setting.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const KEY = "app";

const NUOVO_HERO = {
  heroTitle: "Indagini della community su case, zone e servizi della casa",
  heroSub:
    "Un portale indipendente, niente annunci né compravendita: indagini sugli immobili grazie alla community, contributi verificati, prezzi dichiarati e avvertenze esplicite, per scegliere casa senza sorprese.",
};

const row = await db.setting.findUnique({ where: { key: KEY } });
if (!row) {
  console.log("Nessuna riga Setting: il nuovo default del codice è già attivo.");
} else {
  const current = JSON.parse(row.value) as Record<string, unknown>;
  const next = { ...current, ...NUOVO_HERO };
  await db.setting.update({ where: { key: KEY }, data: { value: JSON.stringify(next) } });
  console.log("Riga Setting aggiornata (heroTitle/heroSub):");
  console.log("  heroTitle =", next.heroTitle);
  console.log("  heroSub   =", next.heroSub);
}
await db.$disconnect();
