// Test: sessione pubblica per il moderatore (lo staff vede tutto senza Premium).
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const db = new PrismaClient();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  const mod = await db.user.findUnique({ where: { email: "moderatore@esempio.test" } });
  if (!mod) throw new Error("moderatore demo non trovato");
  const token = "test-mod-token-" + randomBytes(8).toString("hex");
  await db.session.create({
    data: { userId: mod.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) },
  });
  console.log("COOKIE:", token);
}
main().finally(() => db.$disconnect());
