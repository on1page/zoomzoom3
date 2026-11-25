// GET /api/invitations/info/[token] — stato di un invito (pubblico, per la
// landing). Messaggio unificato invalid/used per non facilitare l'enumerazione.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/server/crypto";
import { getCurrentUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { handleError } from "@/lib/server/http";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const settings = await getSettings();
    const inv = await db.invite.findUnique({
      where: { tokenHash: sha256(String(token || "")) },
      include: { experience: { include: { entity: true } } },
    });
    const invalidOrUsed = { ok: true, state: "invalid" as const, message: "Il collegamento non è valido oppure è già stato utilizzato. Per sicurezza non specifichiamo quale dei due casi si è verificato (protezione contro l'enumerazione)." };
    if (!inv) return NextResponse.json(invalidOrUsed);
    if (inv.revoked) return NextResponse.json({ ok: true, state: "revoked", message: "L'invito è stato revocato dalla moderazione." });
    if (inv.usedAt) return NextResponse.json(invalidOrUsed);
    if (inv.expiresAt < new Date()) {
      return NextResponse.json({ ok: true, state: "expired", message: `L'invito è scaduto: i token hanno una durata limitata (${settings.inviteExpiryDays} giorni). Puoi chiedere al soggetto di registrare di nuovo l'esperienza.` });
    }
    if (inv.experience.status !== "active") {
      return NextResponse.json({ ok: true, state: "pending", message: "L'esperienza collegata è in attesa di approvazione della moderazione: riprova più avanti." });
    }
    const user = await getCurrentUser();
    const maskedEmail = maskEmail(inv.email);
    return NextResponse.json({
      ok: true,
      state: "valid",
      experience: {
        entityName: inv.experience.entity.name,
        categoryId: inv.experience.entity.categoryId,
        kind: inv.experience.kind,
        period: inv.experience.period,
      },
      maskedEmail,
      expiresAt: inv.expiresAt.toISOString(),
      loggedIn: !!user,
      emailMatches: !!user && user.email.toLowerCase() === inv.email,
    });
  } catch (e) {
    return handleError(e);
  }
}

function maskEmail(em: string): string {
  const p = String(em).split("@");
  return p.length === 2 ? `${p[0].slice(0, 1)}*****@${p[1]}` : "—";
}
