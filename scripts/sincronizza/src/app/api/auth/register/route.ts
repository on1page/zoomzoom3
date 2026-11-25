// POST /api/auth/register — registrazione con email da verificare.
// Password con scrypt, token di verifica hashato, rate limiting, honey pot.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, randomToken, sha256 } from "@/lib/server/crypto";
import { sendMail } from "@/lib/server/mailer";
import { securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { validateEmail } from "@/lib/server/validation";
import { getSettings } from "@/lib/server/settings";

export async function POST(req: Request) {
  try {
    guard(req, "register", 10, 3600);
    const p = await readJson<{ email?: string; nickname?: string; password?: string; terms?: boolean; hp?: string }>(req);
    if (String(p.hp || "").trim()) return fail("Richiesta rifiutata (controllo anti-bot).", 400);
    const em = String(p.email || "").trim().toLowerCase();
    const nick = String(p.nickname || "").trim();
    const pw = String(p.password || "");
    if (!validateEmail(em)) return fail("L'indirizzo email non sembra valido.");
    if (nick.length < 3) return fail("Il nome pubblico deve avere almeno 3 caratteri.");
    if (/[\u0000-\u001f<>]/.test(nick)) return fail("Il nome pubblico contiene caratteri non ammessi.");
    if (pw.length < 10) return fail("La password deve avere almeno 10 caratteri.");
    if (!p.terms) return fail("Devi accettare termini, privacy e regole delle recensioni.");
    const exists = await db.user.findUnique({ where: { email: em } });
    if (exists) return fail("Esiste già un account con questo indirizzo email.");

    const token = randomToken(24);
    const settings = await getSettings();
    const base = process.env.APP_BASE_URL || "";
    await db.user.create({
      data: {
        email: em, nickname: nick, role: "user", emailVerified: false,
        passwordHash: hashPassword(pw),
        isDemo: settings.siteName ? false : false,
        emailVerifyTokens: {
          create: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + 48 * 3600 * 1000) },
        },
      },
    });
    const mailStatus = await sendMail(em, "Verifica il tuo indirizzo email",
      `Benvenuto su ${settings.siteName}. Conferma l'indirizzo email per attivare l'account. Il collegamento è valido una sola volta, per 48 ore.`,
      [{ label: "Verifica l'indirizzo email", href: `${base}/#/verifica-email/${token}` }]);
    await securityLog("account_created", "info", `Nuova registrazione: ${em}`, process.env.DEMO_MODE === "true");
    return NextResponse.json({
      ok: true,
      emailDelivery: mailStatus,
      message: mailStatus === "sent"
        ? "Registrazione avvenuta: apri l'email di verifica per attivare l'account."
        : process.env.DEMO_MODE === "true"
          ? "Registrazione avvenuta: in questa istanza demo il messaggio è consultabile dalla casella demo (back office)."
          : "Registrazione registrata, ma l'invio email non è configurato su questo server: contatta l'amministratore per completare la verifica.",
    });
  } catch (e) {
    return handleError(e);
  }
}
