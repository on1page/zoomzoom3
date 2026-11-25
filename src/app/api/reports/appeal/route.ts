// POST /api/reports/appeal — appello su una decisione, entro 15 giorni,
// presentato dall'autore della recensione o dal segnalatore.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { guard, readJson, handleError, fail } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "appeal", 5, 3600);
    const p = await readJson<{ reportId?: string; appealReason?: string }>(req);
    const reason = String(p.appealReason || "").trim();
    if (reason.length < 20) return fail("Descrivi l'appello con almeno 20 caratteri.");
    const rep = await db.report.findUnique({
      where: { id: String(p.reportId || "") },
      include: { review: true },
    });
    if (!rep) return fail("Segnalazione non trovata.", 404);
    const isAuthor = rep.review && rep.review.userId === user.id;
    const isReporter = rep.reporterUserId === user.id;
    if (!isAuthor && !isReporter) return fail("Puoi presentare appello solo sulle tue segnalazioni o sulle tue recensioni.", 403);
    if (rep.status !== "decided") return fail("L'appello è possibile solo su una decisione già adottata.", 409);
    const decidedAt = rep.decisions.length ? rep.decisions[rep.decisions.length - 1].at : rep.createdAt;
    const days = (Date.now() - decidedAt.getTime()) / 86400000;
    if (days > 15) return fail("Il termine di 15 giorni per l'appello è scaduto.", 409);
    await db.report.update({
      where: { id: rep.id },
      data: { status: "appeal", appealBy: isAuthor ? "author" : "reporter", appealReason: reason, appealAt: new Date() },
    });
    await db.reportDecision.create({
      data: { reportId: rep.id, byId: user.id, action: "Appello presentato", reason },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
