// POST /api/auth/login — accesso area pubblica (fattore 1; se 2FA attiva
// il client deve completare con /api/auth/login-2fa nella stessa richiesta logica).
// Se è il primo accesso 2FA mai completato, la risposta include (una sola
// volta, e solo dopo la verifica della password) il QR di registrazione app.
import { NextResponse } from "next/server";
import { publicLogin } from "@/lib/server/auth";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    guard(req, "login", 12, 600);
    const p = await readJson<{ email?: string; password?: string; hp?: string }>(req);
    if (String(p.hp || "").trim()) return fail("Richiesta rifiutata.", 400);
    const res = await publicLogin(String(p.email || ""), String(p.password || ""), "ip");
    if ("error" in res) {
      if (res.error === "invalid") return fail("Credenziali non valide.", 401);
      if (res.error === "locked") return fail("Troppi tentativi: accesso bloccato per 60 secondi.", 429);
      if (res.error === "disabled") return fail("Account sospeso: contatta la moderazione.", 403);
      return fail("Questo account è riservato all'area amministrativa.", 403);
    }
    if ("needs2fa" in res) {
      return NextResponse.json({ ok: true, needs2fa: true, ...(res.enrollment ? { enrollment: res.enrollment } : {}) });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
