// GET /api/me/export — esportazione dati personali (JSON). Esclude i segreti.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { handleError } from "@/lib/server/http";

export async function GET() {
  try {
    const user = await requireUser();
    const [exps, revs, reports, grants] = await Promise.all([
      db.experience.findMany({ where: { OR: [{ userId: user.id }, { requestedById: user.id }] } }),
      db.review.findMany({ where: { userId: user.id } }),
      db.report.findMany({ where: { reporterUserId: user.id } }),
      db.premiumGrant.findMany({ where: { userId: user.id }, orderBy: { grantedAt: "asc" } }),
    ]);
    const payload = {
      esportatoIl: new Date().toISOString(),
      profilo: {
        email: user.email, pseudonimo: user.nickname, registrazione: user.createdAt,
        ruolo: user.role, due_fattori: user.totpEnabled,
        premium_attivo_fino_a: user.premiumUntil,
      },
      nota: "Il segreto 2FA non è incluso per sicurezza.",
      esperienze: exps, recensioni: revs, segnalazioni: reports,
      premium_concessioni: grants,
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="zoomzoom-dati-${user.nickname.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.json"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
