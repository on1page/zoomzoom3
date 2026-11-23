// Collaudo: crea un superadmin di test (password e TOTP noti) nel db di test.
// Uso interno al collaudo: non fa parte del pacchetto.
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

// stesso APP_SECRET del server di collaudo
const APP_SECRET = process.env.APP_SECRET || "test-secret-collaudo";
const { encryptTotpSecret } = await import("../src/lib/server/totp");

const EMAIL = "collaudo-admin@zoomzoom.test";
const PASSWORD = "Collaudo-ZoomZoom-2026";
// segreto base32 fisso di test (30 caratteri base32)
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXJ";

const existing = await db.user.findUnique({ where: { email: EMAIL } });
const data = {
  email: EMAIL,
  nickname: "Collaudo Admin",
  role: "superadmin",
  emailVerified: true,
  passwordHash: hashPassword(PASSWORD),
  totpEnabled: true,
  totpSecretEnc: encryptTotpSecret(TOTP_SECRET),
  firstTotpLoginAt: new Date("2026-01-01T00:00:00Z"),
};
if (existing) {
  await db.user.update({ where: { id: existing.id }, data });
} else {
  await db.user.create({ data });
}
await db.$disconnect();
console.log("superadmin di collaudo pronto:", EMAIL);
