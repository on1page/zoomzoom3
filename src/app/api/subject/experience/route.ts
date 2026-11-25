// POST /api/subject/experience — il soggetto verificato registra
// un'esperienza sulla PROPRIA scheda e invita il cliente via email.
// Controlli server-side: titolarità scheda, limiti giornalieri, dichiarazione
// anti-selezione obbligatoria, token monouso con hash, rate limiting.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { randomToken, sha256 } from "@/lib/server/crypto";
import { getSettings } from "@/lib/server/settings";
import { getCategory } from "@/lib/server/categories";
import { sendMail } from "@/lib/server/mailer";
import { auditLog, securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { validateEmail } from "@/lib/server/validation";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "subject-exp", 20, 3600);
    const p = await readJson<{
      entityId?: string; clientEmail?: string; kind?: string; period?: string;
      fairInvitationDeclared?: boolean; hp?: string;
    }>(req);
    if (String(p.hp || "").trim()) return fail("Richiesta rifiutata.", 400);

    const u = await db.user.findUnique({ where: { id: user.id } });
    if (!u?.subjectEntityId) return fail("L'account non è collegato a una scheda di soggetto verificato.", 403);
    if (p.entityId !== u.subjectEntityId) return fail("Puoi registrare esperienze solo per la tua scheda.", 403);
    if (!validateEmail(p.clientEmail)) return fail("Indirizzo email del cliente non valido.");
    // dichiarazione obbligatoria: invitare tutti i clienti pertinenti, non solo i soddisfatti
    if (!p.fairInvitationDeclared) {
      return fail("Devi dichiarare di invitare tutti i clienti coinvolti nell'interazione, non solo quelli soddisfatti.");
    }
    const ent = await db.entity.findUnique({ where: { id: u.subjectEntityId } });
    if (!ent || !ent.verifiedBusiness) return fail("Scheda soggetto non trovata o non verificata.", 404);
    const cat = await getCategory(ent.categoryId);
    if (!cat) return fail("Categoria non valida.");
    if (p.kind && !cat.experienceKinds.includes(String(p.kind))) return fail("Tipo di esperienza non valido per questa categoria.");

    const settings = await getSettings();
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const sentToday = await db.invite.count({
      where: { quotaOwner: ent.id, createdAt: { gte: t0 } },
    });
    if (sentToday >= settings.inviteDailyCap) {
      return fail(`Raggiunto il limite di ${settings.inviteDailyCap} inviti al giorno per questa scheda (protezione anti-abuso). Riprova domani.`, 429);
    }
    const needsApproval = sentToday + 1 > settings.inviteApprovalAbove;

    const token = randomToken(32);
    const base = process.env.APP_BASE_URL || "";
    const exp = await db.experience.create({
      data: {
        entityId: ent.id, kind: String(p.kind || cat.experienceKinds[0]), period: String(p.period || ""),
        origin: "business", clientEmail: String(p.clientEmail).toLowerCase(),
        status: needsApproval ? "pending" : "active",
        note: "Esperienza registrata dal soggetto verificato.",
        isDemo: ent.isDemo,
      },
    });
    await db.invite.create({
      data: {
        experienceId: exp.id, email: exp.clientEmail, tokenHash: sha256(token),
        quotaOwner: ent.id,
        expiresAt: new Date(Date.now() + settings.inviteExpiryDays * 86400000),
        isDemo: ent.isDemo,
      },
    });
    await sendMail(exp.clientEmail, `${ent.name} ti invita a recensire la tua esperienza`,
      `Hai ricevuto un invito collegato a un'esperienza registrata sulla piattaforma: '${exp.kind}' con ${ent.name}. ` +
      `Il collegamento è valido ${settings.inviteExpiryDays} giorni e per un solo uso. ` +
      `La verifica attesta l'esistenza dell'interazione registrata, non la veridicità delle affermazioni.` +
      (needsApproval ? " Nota: l'esperienza è in attesa di approvazione perché sopra la soglia giornaliera." : ""),
      [{ label: "Apri l'invito e scrivi la recensione", href: `${base}/#/invito/${token}` }]);

    if (needsApproval) {
      await auditLog({
        actorId: user.id, actorRole: user.role,
        action: "Esperienza in coda di approvazione (soglia inviti)", targetType: "experience", targetId: exp.id,
        reason: "Oltre la soglia giornaliera di inviti.", isDemo: ent.isDemo,
      });
    }
    await securityLog("invite_issued", "info", `Invito emesso da ${ent.name} per ${exp.clientEmail}.`, ent.isDemo);
    return NextResponse.json({ ok: true, needsApproval, experienceId: exp.id });
  } catch (e) {
    return handleError(e);
  }
}
