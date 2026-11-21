// POST /api/reviews/[id]/vote — voto di utilità sulla recensione (effetto
// community): pollice su (confermata dalla community) o pollice giù (non
// confermata). Riservato agli utenti Premium attivi e allo staff: chi ha
// contribuito ha più titolo di chi legge soltanto. Un voto per utente e per
// recensione (vincolo UNIQUE), mai sulla propria recensione; value 0 rimuove.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { premiumStateOf } from "@/lib/server/premium";
import { voteSummariesForEntity } from "@/lib/server/review-access";
import { assertSameOrigin, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    if (!user) return fail("Autenticazione necessaria.", 401);
    const rl = rateLimit(`vote:${user.id}`, 60, 3600);
    if (!rl.ok) return fail("Troppe operazioni: riprova tra poco.", 429);

    const settings = await getSettings();
    if (!settings.votesEnabled) return fail("I voti di utilità sono temporaneamente sospesi.", 403);
    const isStaff = ["moderator", "admin", "superadmin"].includes(user.role);
    if (!isStaff && !premiumStateOf(user).active) {
      return fail("Il voto è riservato agli utenti Premium: si ottiene pubblicando una recensione.", 403);
    }

    const review = await db.review.findUnique({ where: { id }, select: { id: true, entityId: true, userId: true, status: true } });
    if (!review || review.status !== "published") return fail("Recensione non disponibile.", 404);
    if (review.userId === user.id) return fail("Non puoi votare la tua stessa recensione.", 403);

    const p = await readJson<{ value?: number }>(req);
    const value = Number(p.value);
    if (value !== 1 && value !== -1 && value !== 0) return fail("Voto non valido.");

    if (value === 0) {
      await db.reviewVote.deleteMany({ where: { reviewId: review.id, userId: user.id } });
    } else {
      await db.reviewVote.upsert({
        where: { reviewId_userId: { reviewId: review.id, userId: user.id } },
        create: { reviewId: review.id, userId: user.id, value },
        update: { value },
      });
    }

    const sums = await voteSummariesForEntity(review.entityId);
    const sum = sums.get(review.id) || { up: 0, down: 0 };
    const mine = value === 0 ? null : value;
    return NextResponse.json({ ok: true, up: sum.up, down: sum.down, mine });
  } catch (e) {
    return handleError(e);
  }
}
