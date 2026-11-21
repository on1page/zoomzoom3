// POST /api/reports — segnalazione di una recensione (solo utenti autenticati,
// misura anti-abuso). Nessuna azione automatica sul contenuto.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { REPORT_REASONS } from "@/lib/server/validation";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "report", 10, 3600);
    const p = await readJson<{ reviewId?: string; reason?: string; details?: string }>(req);
    const rev = await db.review.findUnique({ where: { id: String(p.reviewId || "") } });
    if (!rev) return fail("Recensione non trovata.", 404);
    if (!REPORT_REASONS.some(x => x.id === p.reason)) return fail("Motivo non valido.");
    if (String(p.details || "").trim().length < 20) return fail("Descrivi il problema con almeno 20 caratteri.");
    const open = await db.report.findFirst({
      where: {
        targetId: rev.id, reporterUserId: user.id,
        status: { in: ["received", "reviewing", "appeal"] },
      },
    });
    if (open) return fail("Hai già una segnalazione aperta per questa recensione.", 409);
    await db.report.create({
      data: {
        targetType: "review", targetId: rev.id, reporterUserId: user.id,
        reason: String(p.reason), details: String(p.details).trim(),
        status: "received", isDemo: rev.isDemo,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
