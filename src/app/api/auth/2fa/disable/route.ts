// POST /api/auth/2fa/disable — disattiva la 2FA con codice TOTP valido.
// Per lo staff (moderator/admin/superadmin) la disattivazione è rifiutata:
// la 2FA è obbligatoria sui ruoli di back office.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { verifyTotp, decryptTotpSecret } from "@/lib/server/totp";
import { securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "2fa-disable", 5, 3600);
    if (["moderator", "admin", "superadmin"].includes(user.role)) {
      return fail("La 2FA è obbligatoria per gli account di back office e non può essere disattivata.", 403);
    }
    const { code } = await readJson<{ code?: string }>(req);
    const u = await db.user.findUnique({ where: { id: user.id } });
    if (!u || !u.totpSecretEnc) return fail("2FA non attiva.");
    if (!verifyTotp(decryptTotpSecret(u.totpSecretEnc), String(code || ""))) return fail("Codice non valido.");
    await db.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecretEnc: null } });
    await db.backupCode.deleteMany({ where: { userId: user.id } });
    await securityLog("totp_disabled", "warn", `2FA disattivata per ${user.email}.`, u.isDemo);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
