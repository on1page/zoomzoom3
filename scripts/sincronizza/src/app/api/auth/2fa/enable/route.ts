// POST /api/auth/2fa/enable — attiva la 2FA dopo verifica del primo codice;
// genera e restituisce UNA sola volta i codici di backup (hashati nel DB).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { verifyTotp } from "@/lib/server/totp";
import { decryptSecret, randomToken } from "@/lib/server/crypto";
import { sha256 } from "@/lib/server/crypto";
import { securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "2fa-enable", 5, 3600);
    const { code } = await readJson<{ code?: string }>(req);
    const u = await db.user.findUnique({ where: { id: user.id } });
    if (!u || !u.pendingTotpSecretEnc) return fail("Nessuna attivazione in corso: riparti dall'inizio.");
    const secret = decryptSecret(u.pendingTotpSecretEnc);
    if (!verifyTotp(secret, String(code || ""))) return fail("Codice non valido: controlla orologio e chiave.");
    const codes = Array.from({ length: 8 }, () => randomToken(5).toUpperCase().slice(0, 10));
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: {
          totpSecretEnc: u.pendingTotpSecretEnc,
          totpEnabled: true,
          pendingTotpSecretEnc: null,
          // il primo fattore è già attivo e provato: il QR non serve più al login
          ...(u.firstTotpLoginAt ? {} : { firstTotpLoginAt: new Date() }),
        },
      }),
      db.backupCode.deleteMany({ where: { userId: user.id } }),
      db.backupCode.createMany({ data: codes.map(c => ({ userId: user.id, codeHash: sha256(c) })) }),
    ]);
    await securityLog("totp_enabled", "info", `2FA attivata per ${user.email}.`, u.isDemo);
    return NextResponse.json({ ok: true, backupCodes: codes });
  } catch (e) {
    return handleError(e);
  }
}
