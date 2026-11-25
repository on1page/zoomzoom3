// crea un utente di prova CON 2FA e una sessione pubblica valida per il
// collaudo visivo del modulo di iscrizione consulente nel browser
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const email = "ui.test@zoomzoom.test";
const old = await db.user.findUnique({ where: { email } });
if (old) await db.user.delete({ where: { id: old.id } });
const salt = randomBytes(16).toString("hex");
const u = await db.user.create({
  data: {
    email, nickname: "uitest", role: "user", emailVerified: true, totpEnabled: true,
    passwordHash: `scrypt$16384$8$1$${salt}$${scryptSync("test1234", salt, 64).toString("hex")}`,
  },
});
await db.consultantProfile.deleteMany({ where: { userId: u.id } });
const token = randomBytes(32).toString("hex");
await db.session.create({
  data: { userId: u.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 4 * 3600_000) },
});
console.log(token);
await db.$disconnect();
