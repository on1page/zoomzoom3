// Test end-to-end Membership Premium: crea un utente SENZA premium con
// sessione nota, un'esperienza attiva, poi (via API) pubblica la recensione
// e verifica l'assegnazione; infine revoca come farebbe la moderazione.
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

const TOKEN = "test-premium-token-" + randomBytes(8).toString("hex");
const EMAIL = "test-nopremium@esempio.test";

async function main() {
  // pulizia preventiva (idempotente)
  const old = await db.user.findUnique({ where: { email: EMAIL } });
  if (old) await db.user.delete({ where: { id: old.id } });

  const u = await db.user.create({
    data: {
      email: EMAIL, nickname: "TestNoPremium", role: "user",
      emailVerified: true, passwordHash: hashPassword("x"), isDemo: true,
    },
  });
  await db.session.create({
    data: { userId: u.id, kind: "public", tokenHash: sha256(TOKEN), expiresAt: new Date(Date.now() + 3600_000) },
  });
  const exp = await db.experience.create({
    data: {
      entityId: "ent_i_rondini", kind: "Contratto di affitto in corso", period: "2026",
      origin: "seed", clientEmail: EMAIL, userId: u.id, status: "active", isDemo: true,
    },
  });
  console.log("UTENTE:", u.id);
  console.log("COOKIE:", TOKEN);
  console.log("ESPERIENZA:", exp.id);
  console.log("premiumUntil iniziale:", u.premiumUntil);
}
main().finally(() => db.$disconnect());
