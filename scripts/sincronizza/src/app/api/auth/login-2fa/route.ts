// POST /api/auth/login-2fa — completamento accesso con codice TOTP.
import { NextResponse } from "next/server";
import { publicLoginSecondFactor } from "@/lib/server/auth";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    guard(req, "login2fa", 12, 600);
    const p = await readJson<{ email?: string; password?: string; code?: string }>(req);
    const res = await publicLoginSecondFactor(String(p.email || ""), String(p.password || ""), String(p.code || ""));
    if ("error" in res) {
      if (res.error === "locked") return fail("Troppi tentativi: accesso bloccato per 60 secondi.", 429);
      return fail("Credenziali o codice non validi.", 401);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
