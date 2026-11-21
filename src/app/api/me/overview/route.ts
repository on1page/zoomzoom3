// GET /api/me/overview — panoramica personale: esperienze, recensioni,
// segnalazioni, stato verifiche, stato Premium. Solo dati propri.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { premiumStateOf } from "@/lib/server/premium";
import { getSettings } from "@/lib/server/settings";
import { handleError } from "@/lib/server/http";

export async function GET() {
  try {
    const user = await requireUser();
    const [exps, revs, reports, grants, settings] = await Promise.all([
      db.experience.findMany({
        where: { OR: [{ userId: user.id }, { requestedById: user.id }, { clientEmail: user.email }] },
        orderBy: { createdAt: "desc" },
        include: { entity: { select: { id: true, name: true, categoryId: true } }, review: { select: { id: true, score: true, status: true, updatedAt: true } } },
      }),
      db.review.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: { entity: { select: { id: true, name: true } } },
      }),
      db.report.findMany({
        where: { reporterUserId: user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, reason: true, status: true, createdAt: true, targetId: true },
      }),
      db.premiumGrant.findMany({
        where: { userId: user.id },
        orderBy: { grantedAt: "desc" },
        take: 10,
        include: { review: { select: { entity: { select: { name: true } } } } },
      }),
      getSettings(),
    ]);
    const premium = premiumStateOf(user);
    return NextResponse.json({
      ok: true,
      premium: {
        enabled: settings.premiumEnabled,
        active: premium.active,
        until: premium.until ? premium.until.toISOString() : null,
        daysPerReview: settings.premiumDaysPerReview,
        grants: grants.map(g => ({
          id: g.id, days: g.days, origin: g.origin,
          grantedAt: g.grantedAt.toISOString(),
          expiresAt: g.expiresAt.toISOString(),
          revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null,
          revokedReason: g.revokedReason,
          reviewEntityName: g.review ? g.review.entity.name : null,
        })),
      },
      experiences: exps.map(e => ({
        id: e.id, entity: e.entity, kind: e.kind, period: e.period, origin: e.origin,
        status: e.status, note: e.note, createdAt: e.createdAt.toISOString(),
        review: e.review ? { id: e.review.id, score: e.review.score, status: e.review.status } : null,
      })),
      reviews: revs.map(r => ({
        id: r.id, entity: r.entity, score: r.score, status: r.status,
        createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt?.toISOString() || null,
        updateReason: r.updateReason,
      })),
      reports,
    });
  } catch (e) {
    return handleError(e);
  }
}
