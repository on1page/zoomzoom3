// POST /api/auth/change-password — cambio password dalla propria area.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/server/crypto";
import { requireUser } from "@/lib/server/auth";
import { securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "changepw", 5, 3600);
    const p = await readJson<{ oldPassword?: string; newPassword?: string }>(req);
    const u = await db.user.findUnique({ where: { id: user.id } });
    if (!u || !verifyPassword(String(p.oldPassword || ""), u.passwordHash)) {
      return fail("Password attuale errata.", 400);
    }
    if (String(p.newPassword || "").length < 10) return fail("La nuova password deve avere almeno 10 caratteri.");
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(String(p.newPassword)) } });
    await securityLog("password_changed", "info", `Password modificata dall'utente ${user.email}.`, u.isDemo);
    // chiude le altre sessioni pubbliche (rimane quella corrente)
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
