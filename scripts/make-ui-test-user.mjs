// Crea utente + sessione di test per il browser e stampa il token cookie.
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const EMAIL = "uitest@zoomzoom.test";
const PW = "test1234";

async function main() {
  const old = await db.user.findUnique({ where: { email: EMAIL } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const salt = randomBytes(16).toString("hex");
  const u = await db.user.create({
    data: {
      email: EMAIL, nickname: "uitest", role: "user", emailVerified: true,
      passwordHash: `scrypt$16384$8$1$${salt}$${scryptSync(PW, salt, 64).toString("hex")}`,
    },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId: u.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 4 * 3600_000) },
  });
  console.log("TOKEN=" + token);
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
