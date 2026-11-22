// POST /api/auth/register — registrazione con email da verificare.
// Password con scrypt, token di verifica hashato, rate limiting, honey pot.
// Identità pubblica: foto profilo facoltativa (ricompilata lato server senza
// EXIF/GPS) e categoria di appartenenza via combo (proprietario, affittuario,
// amministratore, agenzia, ditta, consulente). Chi dichiara una categoria
// ottiene subito la scheda ad hoc ATTIVA nel catalogo (persone fisiche con
// sole iniziali). Le recensioni restano anonime di default: categoria visibile,
// nickname e foto solo con il flag esplicito per recensione.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, randomToken, sha256 } from "@/lib/server/crypto";
import { sendMail } from "@/lib/server/mailer";
import { securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { validateEmail } from "@/lib/server/validation";
import { getSettings } from "@/lib/server/settings";
import { compileAvatar, ensureSubjectSheet, validSubjectCategory } from "@/lib/server/user-identity";

export async function POST(req: Request) {
  try {
    guard(req, "register", 10, 3600);
    const p = await readJson<{
      email?: string; nickname?: string; password?: string; terms?: boolean; hp?: string;
      avatar?: string; categoryId?: string; sheetName?: string;
    }>(req);
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
    // lo pseudonimo è la chiave pubblica dell'identità (foto profilo compresa):
    // deve essere univoco, come già richiesto dal cambio pseudonimo
    const nickClash = await db.user.findFirst({ where: { nickname: nick } });
    if (nickClash) return fail("Questo nome pubblico è già in uso: scegline un altro.");

    // categoria di appartenenza: slug valido tra quelli del combo, altrimenti niente
    const cat = await validSubjectCategory(p.categoryId);
    const sheetName = String(p.sheetName || "").trim();
    if (!cat && sheetName) return fail("Il nome della scheda richiede una categoria di appartenenza.");
    if (cat && !cat.isPerson && sheetName && (sheetName.length < 3 || sheetName.length > 80)) {
      return fail("Il nome della scheda deve avere tra 3 e 80 caratteri.");
    }
    // foto profilo facoltativa: ricompilata, mai un motivo di fallimento
    const avatar = await compileAvatar(p.avatar);

    const token = randomToken(24);
    const settings = await getSettings();
    const base = process.env.APP_BASE_URL || "";
    const user = await db.user.create({
      data: {
        email: em, nickname: nick, role: "user", emailVerified: false,
        passwordHash: hashPassword(pw),
        categoryId: cat?.id || null,
        avatarData: avatar,
        isDemo: settings.siteName ? false : false,
        emailVerifyTokens: {
          create: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + 48 * 3600 * 1000) },
        },
      },
    });

    // scheda ad hoc per la categoria dichiarata: creata e ATTIVATA subito
    let sheet: { entityId: string; created: boolean; name: string } | null = null;
    if (cat) {
      try {
        sheet = await ensureSubjectSheet(user.id, nick, cat, sheetName);
      } catch {
        sheet = null; // la registrazione non fallisce per la scheda: si può attivare dopo dal profilo
      }
    }

    const mailStatus = await sendMail(em, "Verifica il tuo indirizzo email",
      `Benvenuto su ${settings.siteName}. Conferma l'indirizzo email per attivare l'account. Il collegamento è valido una sola volta, per 48 ore.`,
      [{ label: "Verifica l'indirizzo email", href: `${base}/#/verifica-email/${token}` }]);
    await securityLog("account_created", "info",
      `Nuova registrazione: ${em}${cat ? ` (categoria: ${cat.id})` : ""}`, process.env.DEMO_MODE === "true");
    return NextResponse.json({
      ok: true,
      emailDelivery: mailStatus,
      sheet: sheet ? { name: sheet.name, created: sheet.created } : null,
      message: (mailStatus === "sent"
        ? "Registrazione avvenuta: apri l'email di verifica per attivare l'account."
        : process.env.DEMO_MODE === "true"
          ? "Registrazione avvenuta: in questa istanza demo il messaggio è consultabile dalla casella demo (back office)."
          : "Registrazione registrata, ma l'invio email non è configurato su questo server: contatta l'amministratore per completare la verifica.")
        + (sheet ? ` La scheda "${sheet.name}" è già attiva nel catalogo.` : ""),
    });
  } catch (e) {
    return handleError(e);
  }
}
