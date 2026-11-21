// GET /api/subject/overview — dati per l'area del soggetto verificato.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { statsForEntity } from "@/lib/server/score";
import { handleError, fail } from "@/lib/server/http";
import { getCategory } from "@/lib/server/categories";

export async function GET() {
  try {
    const user = await requireUser();
    const u = await db.user.findUnique({ where: { id: user.id } });
    if (!u?.subjectEntityId) return fail("Account non collegato a una scheda.", 403);
    const ent = await db.entity.findUnique({ where: { id: u.subjectEntityId } });
    if (!ent) return fail("Scheda non trovata.", 404);
    const settings = await getSettings();
    const st = await statsForEntity(ent.id, settings.minReviews);
    const cat = await getCategory(ent.categoryId);
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const sentToday = await db.invite.count({ where: { quotaOwner: ent.id, createdAt: { gte: t0 } } });
    const exps = await db.experience.findMany({
      where: { entityId: ent.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { invites: { orderBy: { createdAt: "desc" }, take: 1 }, review: { select: { score: true } } },
    });
    return NextResponse.json({
      ok: true,
      entity: { id: ent.id, name: ent.name, categoryId: ent.categoryId },
      category: cat ? { name: cat.name, experienceKinds: cat.experienceKinds } : null,
      stats: { n: st.n, mean: st.mean == null ? null : Math.round(st.mean * 10) / 10 },
      invites: { sentToday, cap: settings.inviteDailyCap, approvalAbove: settings.inviteApprovalAbove },
      experiences: exps.map(e => ({
        id: e.id, clientEmail: e.clientEmail, kind: e.kind, period: e.period,
        status: e.status, createdAt: e.createdAt.toISOString(),
        invite: e.invites[0] ? {
          expiresAt: e.invites[0].expiresAt.toISOString(),
          usedAt: e.invites[0].usedAt?.toISOString() || null,
          revoked: e.invites[0].revoked,
        } : null,
        reviewScore: e.review?.score ?? null,
      })),
      settings: { inviteExpiryDays: settings.inviteExpiryDays },
    });
  } catch (e) {
    return handleError(e);
  }
}
