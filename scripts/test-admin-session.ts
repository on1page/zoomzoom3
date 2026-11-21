import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
const db = new PrismaClient();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
async function main() {
  const adm = await db.user.findUnique({ where: { email: "admin@esempio.test" } });
  if (!adm) throw new Error("admin demo non trovato");
  const token = "test-admin-token-" + randomBytes(8).toString("hex");
  await db.session.create({ data: { userId: adm.id, kind: "admin", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) } });
  console.log("COOKIE:", token);
}
main().finally(() => db.$disconnect());
