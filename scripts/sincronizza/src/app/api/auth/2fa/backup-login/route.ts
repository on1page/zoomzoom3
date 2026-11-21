// POST /api/auth/2fa/backup-login — accesso con codice di backup (monouso).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sha256, safeEqualHex, randomToken } from "@/lib/server/crypto";
import { securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  try {
    guard(req, "backup-login", 8, 600);
    const p = await readJson<{ email?: string; code?: string }>(req);
    const em = String(p.email || "").trim().toLowerCase();
    const u = await db.user.findUnique({ where: { email: em } });
    if (!u || u.disabled || !u.totpEnabled) return fail("Credenziali non valide.", 401);
    if (["moderator", "admin", "superadmin"].includes(u.role)) return fail("Questo account è riservato all'area amministrativa.", 403);
    const code = String(p.code || "").trim().toUpperCase();
    const rows = await db.backupCode.findMany({ where: { userId: u.id, usedAt: null } });
    const match = rows.find(r => safeEqualHex(r.codeHash, sha256(code)));
    if (!match) {
      await securityLog("backup_code_failed", "warn", `Codice di backup non valido per ${em}.`, u.isDemo);
      return fail("Codice di backup non valido o già usato.", 401);
    }
    await db.$transaction([
      db.backupCode.update({ where: { id: match.id }, data: { usedAt: new Date() } }),
      db.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } }),
    ]);
    const token = randomToken(32);
    await db.session.create({
      data: { userId: u.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    });
    const jar = await cookies();
    jar.set("zz_session", token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 7 * 24 * 3600,
    });
    await securityLog("backup_code_used", "info", `Accesso con codice di backup per ${em}.`, u.isDemo);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
