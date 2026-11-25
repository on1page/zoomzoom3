// POST /api/invitations/redeem — riscatto atomico dell'invito.
// Transazione: il token viene marcato usato SOLO se ancora libero
// (updateMany condizionale) e l'esperienza viene assegnata SOLO se priva
// di utente. Richieste concorrenti: una sola riesce, le altre ricevono
// il messaggio unificato invalid/used (anti-enumerazione).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { sha256 } from "@/lib/server/crypto";
import { securityLog } from "@/lib/server/audit";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "redeem", 10, 3600);
    const { token } = await readJson<{ token?: string }>(req);
    const h = sha256(String(token || ""));
    const inv = await db.invite.findUnique({ where: { tokenHash: h }, include: { experience: true } });
    if (!inv || inv.revoked || inv.usedAt || inv.expiresAt < new Date()) {
      await securityLog("invite_token_invalid", "warn", "Tentativo di riscatto invito non valido, scaduto o già usato.", process.env.DEMO_MODE === "true");
      return fail("Invito non più valido (uso singolo o scaduto).", 400);
    }
    if (inv.experience.status !== "active") {
      return fail("L'esperienza collegata è in attesa di approvazione della moderazione.", 409);
    }
    if (inv.email !== user.email.toLowerCase()) {
      return fail("Questo invito è destinato a un altro indirizzo email.", 403);
    }
    const result = await db.$transaction(async (tx) => {
      // marca l'invito usato solo se ancora libero: blocca i riutilizzi concorrenti
      const claimed = await tx.invite.updateMany({
        where: { id: inv.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return null;
      // assegna l'esperienza solo se non ancora assegnata
      const assigned = await tx.experience.updateMany({
        where: { id: inv.experienceId, userId: null },
        data: { userId: user.id, claimedAt: new Date() },
      });
      if (assigned.count === 0) {
        // esperienza già reclamata da questo utente in una richiesta concorrente:
        // l'invito resta usato una sola volta — nessuna assegnazione doppia
        return { already: true };
      }
      return { already: false };
    });
    if (result === null) return fail("Invito non più valido (uso singolo o scaduto).", 400);
    return NextResponse.json({ ok: true, experienceId: inv.experienceId, alreadyLinked: result.already });
  } catch (e) {
    return handleError(e);
  }
}
