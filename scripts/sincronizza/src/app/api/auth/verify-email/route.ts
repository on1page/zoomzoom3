// POST /api/auth/verify-email — riscatto del token di verifica email (monouso).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/server/crypto";
import { securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    guard(req, "verify-email", 20, 3600);
    const { token } = await readJson<{ token?: string }>(req);
    const h = sha256(String(token || ""));
    const row = await db.emailVerifyToken.findUnique({ where: { tokenHash: h }, include: { user: true } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      await securityLog("verify_token_invalid", "warn", "Tentativo di verifica email con token non valido.", process.env.DEMO_MODE === "true");
      return fail("Collegamento non valido o già utilizzato.", 400);
    }
    await db.$transaction([
      db.emailVerifyToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      db.user.update({ where: { id: row.userId }, data: { emailVerified: true } }),
    ]);
    return NextResponse.json({ ok: true, email: row.user.email });
  } catch (e) {
    return handleError(e);
  }
}
