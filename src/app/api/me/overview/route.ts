// GET /api/me/overview — panoramica personale: esperienze, recensioni,
// segnalazioni, stato verifiche, stato Premium. Solo dati propri.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { premiumStateOf } from "@/lib/server/premium";
import { getSettings } from "@/lib/server/settings";
import { UTILITY_BADGES, utilityBadgeLabel } from "@/lib/server/utility";
import { handleError } from "@/lib/server/http";

export async function GET() {
  try {
    const user = await requireUser();
    const [exps, revs, reports, grants, settings, utilityRows, badges, appeals] = await Promise.all([
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
      // riconoscimento di utilità: punti delle proprie indagini, badge e ricorsi
      db.reviewUtility.findMany({
        where: { review: { userId: user.id } },
        select: { reviewId: true, points: true, validVotes: true, anomalousVotes: true, confirmed: true, calculatedAt: true },
      }),
      db.utilityBadge.findMany({ where: { userId: user.id } }),
      db.utilityAppeal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { review: { select: { entity: { select: { name: true } } } } },
      }),
    ]);
    const premium = premiumStateOf(user);
    const utilityByReview = new Map(utilityRows.map(u => [u.reviewId, u]));
    const utilityPoints = utilityRows
      .filter(u => revs.some(r => r.id === u.reviewId && r.status === "published"))
      .reduce((acc, u) => acc + u.points, 0);
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
        utility: utilityByReview.get(r.id) ? {
          points: utilityByReview.get(r.id)!.points,
          validVotes: utilityByReview.get(r.id)!.validVotes,
          anomalousVotes: utilityByReview.get(r.id)!.anomalousVotes,
          confirmed: utilityByReview.get(r.id)!.confirmed,
        } : null,
      })),
      reports,
      utility: {
        enabled: settings.utilityEnabled,
        points: Math.round(utilityPoints * 100) / 100,
        windowDays: 30,
        badges: badges.map(b => ({
          code: b.code,
          label: utilityBadgeLabel(b.code),
          description: UTILITY_BADGES.find(x => x.code === b.code)?.description || "",
          points: b.points,
          categories: b.categories,
          awardedAt: b.awardedAt.toISOString(),
          expiresAt: b.expiresAt.toISOString(),
          active: b.expiresAt.getTime() > Date.now(),
        })),
        appeals: appeals.map(a => ({
          id: a.id,
          entityName: a.review ? a.review.entity.name : null,
          reason: a.reason,
          status: a.status,
          answer: a.answer,
          createdAt: a.createdAt.toISOString(),
          resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
        })),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
