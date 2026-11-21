// ZoomZoom — helper HTTP per le API route: risposte JSON, controllo origine
// (anti-CSRF per i form), parsing sicuro del body, gestione errori senza
// rivelare dettagli interni.
import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { clientIp, rateLimit } from "./rate-limit";

export function ok<T>(data: T, init?: number) {
  return NextResponse.json({ ok: true, ...(data as object) }, { status: init ?? 200 });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** Blocca le scritture cross-origin (difesa CSRF insieme a SameSite=Lax). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // richieste same-origin senza Origin (es. form navigazione)
  const host = req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new Error("cross-origin");
  } catch {
    throw new AuthError("BAD_ORIGIN", 403);
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AuthError("BAD_JSON", 400);
  }
}

/** Rate limit + origine per le rotte di scrittura. */
export function guard(req: Request, action: string, limit: number, windowSec: number) {
  assertSameOrigin(req);
  const res = rateLimit(`${action}:${clientIp(req)}`, limit, windowSec);
  if (!res.ok) {
    throw new AuthError(`RATE_LIMITED:${res.retryAfterSec}`, 429);
  }
}

/** Converte gli errori in risposte generiche, loggando lato server. */
export function handleError(e: unknown) {
  if (e instanceof AuthError) {
    if (e.message.startsWith("RATE_LIMITED:")) {
      const secs = e.message.split(":")[1];
      return fail("Troppe richieste: riprova tra poco.", 429, { retryAfter: Number(secs) });
    }
    const map: Record<string, [string, number]> = {
      AUTH_REQUIRED: ["Autenticazione necessaria.", 401],
      ADMIN_REQUIRED: ["Sessione amministrativa assente o scaduta.", 401],
      FORBIDDEN: ["Permesso negato per il tuo ruolo.", 403],
      BAD_ORIGIN: ["Richiesta non consentita.", 403],
      BAD_JSON: ["Richiesta non valida.", 400],
    };
    const [msg, code] = map[e.message] || ["Operazione non consentita.", e.status];
    return fail(msg, code);
  }
  // errore interno: log server-side, messaggio generico al client
  console.error("[api-error]", e);
  return fail("Errore interno: riprova più tardi.", 500);
}
