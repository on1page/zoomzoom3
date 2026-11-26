// POST /api/utility/appeal — ricorso contro una penalità di utilità.
// L'autore di un'indagine può contestare, in modo semplice, l'esclusione di
// voti ritenuti anomali (scambi reciproci o raffiche) che hanno ridotto i
// suoi punti. Lo staff risponde dal back office con decisione motivata;
// se il ricorso è accolto, al ricalcolo successivo i voti esclusi su
// quell'indagine tornano a contare. Rate limit: 3 ricorsi al giorno.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { assertSameOrigin, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const rl = rateLimit(`utilityappeal:${user.id}`, 3, 86400);
    if (!rl.ok) return fail("Hai già presentato 3 ricorsi oggi: riprova domani.", 429);

    const settings = await getSettings();
    if (!settings.utilityEnabled) return fail("Il riconoscimento di utilità è temporaneamente sospeso.", 403);

    const p = await readJson<{ reviewId?: string; reason?: string }>(req);
    const reason = String(p.reason || "").trim();
    if (reason.length < 20) return fail("Descrivi il motivo del ricorso (almeno 20 caratteri).");
    if (reason.length > 2000) return fail("Testo troppo lungo (massimo 2000 caratteri).");

    // il ricorso riguarda una propria indagine (facoltativo: può essere
    // presentato anche in forma generale dal profilo)
    let reviewId: string | null = null;
    if (p.reviewId) {
      const rev = await db.review.findUnique({
        where: { id: String(p.reviewId) },
        select: { id: true, userId: true, status: true, utility: { select: { anomalousVotes: true, points: true } } },
      });
      if (!rev || rev.userId !== user.id) return fail("Indagine non trovata tra le tue.", 404);
      reviewId = rev.id;
    }

    await db.utilityAppeal.create({
      data: { userId: user.id, reviewId, reason },
    });
    return NextResponse.json({ ok: true, message: "Ricorso presentato: lo staff risponderà nel tuo profilo." });
  } catch (e) {
    return handleError(e);
  }
}
