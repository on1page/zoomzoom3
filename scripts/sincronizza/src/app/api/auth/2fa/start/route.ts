// POST /api/auth/2fa/start — avvia l'attivazione 2FA: genera il segreto
// (non ancora attivo), lo mostra UNA sola volta all'utente con l'URI otpauth.
// Il segreto non è mai più esposto dopo l'attivazione.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { generateTotpSecret, otpauthUri } from "@/lib/server/totp";
import { encryptSecret } from "@/lib/server/crypto";
import { totpEnrollment } from "@/lib/server/qr";
import { getSettings } from "@/lib/server/settings";
import { guard, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "2fa-start", 5, 3600);
    const u = await db.user.findUnique({ where: { id: user.id } });
    if (u?.totpEnabled) return fail("La 2FA è già attiva su questo account.");
    const secret = generateTotpSecret();
    // segreto "in attesa" cifrato e non attivo: si attiva con /2fa/enable
    await db.user.update({ where: { id: user.id }, data: { pendingTotpSecretEnc: encryptSecret(secret) } });
    const settings = await getSettings();
    // QR (data URL PNG) + URI testuale: entrambi mostrati una sola volta
    const enrollment = await totpEnrollment(secret, user.email, settings.siteName);
    return NextResponse.json({ ok: true, secret, otpauth: otpauthUri(secret, user.email, settings.siteName), qr: enrollment.qr });
  } catch (e) {
    return handleError(e);
  }
}
