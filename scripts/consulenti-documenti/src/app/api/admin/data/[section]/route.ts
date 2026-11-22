// GET /api/admin/data/[section] — dati per le sezioni del back office.
// Autorizzazione per permesso, applicata server-side per ogni sezione.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff, hasPerm, ROLE_LABELS } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { getCategories } from "@/lib/server/categories";
import { handleError, fail } from "@/lib/server/http";
import { REPORT_STATUS_LABELS, REPORT_REASONS } from "@/lib/server/validation";

export async function GET(_req: Request, ctx: { params: Promise<{ section: string }> }) {
  try {
    const { section } = await ctx.params;
    const admin = await requireStaff();

    switch (section) {
      case "dashboard": {
        const [users, reviews, reports, exps, proposals, disputes, privacy] = await Promise.all([
          db.user.count(),
          db.review.count({ where: { status: "published" } }),
          db.report.count({ where: { status: { in: ["received", "reviewing", "appeal"] } } }),
          db.experience.count({ where: { status: "pending" } }),
          db.entityProposal.count({ where: { status: "received" } }),
          db.dispute.count({ where: { status: { in: ["received", "reviewing"] } } }),
          db.privacyRequest.count({ where: { status: "received" } }),
        ]);
        const security = await db.securityLog.findMany({ orderBy: { at: "desc" }, take: 5 });
        const consulentiPending = await db.consultantProfile.count({ where: { status: "pending" } });
        const perizieDaPagare = await db.periziaRequest.count({ where: { status: "accepted" } });
        const perizieDaAccreditare = await db.periziaRequest.count({ where: { status: "delivered" } });
        const queues = [
          hasPerm(admin.role, "mod.reports") && { label: "Segnalazioni da valutare", href: "#/admin/segnalazioni", count: reports },
          hasPerm(admin.role, "mod.experiences") && { label: "Verifiche di esperienza da esaminare", href: "#/admin/esperienze", count: exps },
          hasPerm(admin.role, "mod.disputes") && { label: "Contestazioni di associazione", href: "#/admin/contestazioni", count: disputes },
          hasPerm(admin.role, "admin.entities") && { label: "Proposte di nuove schede", href: "#/admin/entita", count: proposals },
          hasPerm(admin.role, "admin.entities") && { label: "Iscrizioni Consulenti tecnici", href: "#/admin/consulenti", count: consulentiPending },
          hasPerm(admin.role, "admin.entities") && { label: "Perizie: pagamenti da registrare", href: "#/admin/perizie", count: perizieDaPagare },
          hasPerm(admin.role, "admin.entities") && { label: "Perizie: accrediti da eseguire", href: "#/admin/perizie", count: perizieDaAccreditare },
          hasPerm(admin.role, "admin.users") && { label: "Richieste privacy", href: "#/admin/utenti", count: privacy },
        ].filter(Boolean);
        return NextResponse.json({ ok: true, stats: { users, reviews, reports, exps }, queues, security, role: admin.role, roleLabel: ROLE_LABELS[admin.role] });
      }

      case "segnalazioni": {
        await requireStaff("mod.reports");
        const reports = await db.report.findMany({
          orderBy: { createdAt: "desc" }, take: 100,
          include: {
            review: { include: { entity: { select: { name: true } }, user: { select: { nickname: true } } } },
            decisions: { orderBy: { at: "asc" }, include: { by: { select: { nickname: true } } } },
          },
        });
        return NextResponse.json({
          ok: true,
          reports: reports.map(r => ({
            id: r.id, reason: r.reason, reasonLabel: REPORT_REASONS.find(x => x.id === r.reason)?.label || r.reason,
            details: r.details, status: r.status, statusLabel: REPORT_STATUS_LABELS[r.status] || r.status,
            createdAt: r.createdAt.toISOString(), appealBy: r.appealBy, appealReason: r.appealReason,
            review: r.review ? {
              id: r.review.id, entityName: r.review.entity.name, author: r.review.user.nickname,
              score: r.review.score, text: r.review.text.slice(0, 160), status: r.review.status,
            } : null,
            decisions: r.decisions.map(d => ({ action: d.action, reason: d.reason, at: d.at.toISOString(), by: d.by.nickname })),
          })),
        });
      }

      case "contestazioni": {
        await requireStaff("mod.disputes");
        const disputes = await db.dispute.findMany({
          orderBy: { createdAt: "desc" }, take: 100,
          include: { entity: { select: { id: true, name: true, status: true } }, decisions: { orderBy: { at: "asc" }, include: { by: { select: { nickname: true } } } } },
        });
        return NextResponse.json({
          ok: true,
          disputes: disputes.map(d => ({
            id: d.id, entity: d.entity, claimantEmail: d.claimantEmail, claim: d.claim,
            status: d.status, createdAt: d.createdAt.toISOString(),
            decisions: d.decisions.map(x => ({ action: x.action, reason: x.reason, at: x.at.toISOString(), by: x.by.nickname })),
          })),
        });
      }

      case "recensioni": {
        await requireStaff("mod.reviews");
        const revs = await db.review.findMany({
          orderBy: { createdAt: "desc" }, take: 60,
          include: {
            entity: { select: { name: true } },
            user: { select: { nickname: true } },
            photos: { select: { id: true } },
            votes: { select: { value: true } },
          },
        });
        return NextResponse.json({
          ok: true,
          reviews: revs.map(r => ({
            id: r.id, entityName: r.entity.name, author: r.user.nickname, score: r.score,
            text: r.text.slice(0, 140), status: r.status, hiddenReason: r.hiddenReason,
            verified: r.verified,
            photosCount: r.photos.length,
            votesUp: r.votes.filter(v => v.value === 1).length,
            votesDown: r.votes.filter(v => v.value === -1).length,
            createdAt: r.createdAt.toISOString(), isDemo: r.isDemo,
          })),
        });
      }

      case "foto": {
        // moderazione delle foto: anteprime (lo staff vede tutto) e rimozione
        await requireStaff("mod.reviews");
        const photos = await db.reviewPhoto.findMany({
          orderBy: { createdAt: "desc" }, take: 120,
          include: {
            review: {
              select: {
                id: true, status: true, isDemo: true,
                entity: { select: { name: true } },
                user: { select: { nickname: true } },
              },
            },
          },
        });
        return NextResponse.json({
          ok: true,
          photos: photos.map(p => ({
            id: p.id, reviewId: p.review.id, entityName: p.review.entity.name,
            author: p.review.user.nickname, reviewStatus: p.review.status,
            width: p.width, height: p.height, bytes: p.bytes,
            createdAt: p.createdAt.toISOString(), isDemo: p.isDemo,
          })),
        });
      }

      case "esperienze": {
        await requireStaff("mod.experiences");
        const pending = await db.experience.findMany({
          where: { status: "pending" },
          include: {
            entity: { select: { name: true } },
            requester: { select: { email: true, nickname: true } },
            docs: true,
          },
        });
        const active = await db.experience.findMany({
          where: { status: "active" },
          orderBy: { createdAt: "desc" }, take: 12,
          include: { entity: { select: { name: true } }, review: { select: { score: true } } },
        });
        return NextResponse.json({
          ok: true,
          pending: pending.map(e => ({
            id: e.id, entityName: e.entity.name, kind: e.kind, period: e.period,
            origin: e.origin, requesterEmail: e.requester?.email || null,
            note: e.note, docs: e.docs.filter(d => !d.deletedAt).map(d => ({ id: d.id, originalName: d.originalName, sizeBytes: d.sizeBytes, mimeType: d.mimeType })),
            createdAt: e.createdAt.toISOString(),
          })),
          active: active.map(e => ({
            id: e.id, entityName: e.entity.name, kind: e.kind,
            reviewed: e.review ? `recensita (${e.review.score})` : "in attesa di recensione",
          })),
        });
      }

      case "inviti": {
        await requireStaff("admin.invites");
        const invites = await db.invite.findMany({
          orderBy: { createdAt: "desc" }, take: 40,
          include: { experience: { include: { entity: { select: { name: true } } } } },
        });
        const t0 = new Date(); t0.setHours(0, 0, 0, 0);
        const business = await db.entity.findMany({
          where: { verifiedBusiness: true },
          include: { _count: { select: { experiences: true } } },
        });
        const settings = await getSettings();
        const perEntity = [];
        for (const b of business) {
          perEntity.push({
            name: b.name,
            today: await db.invite.count({ where: { quotaOwner: b.id, createdAt: { gte: t0 } } }),
            cap: settings.inviteDailyCap,
          });
        }
        return NextResponse.json({
          ok: true,
          invites: invites.map(i => ({
            id: i.id, entityName: i.experience.entity.name, email: i.email,
            tokenHashPrefix: i.tokenHash.slice(0, 8),
            createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString(),
            usedAt: i.usedAt?.toISOString() || null, revoked: i.revoked,
          })),
          perEntity,
        });
      }

      case "utenti": {
        await requireStaff("admin.users");
        const users = await db.user.findMany({
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { reviews: true } } },
        });
        const privacy = await db.privacyRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
        return NextResponse.json({
          ok: true,
          users: users.map(u => ({
            id: u.id, nickname: u.nickname, email: u.email, role: u.role, roleLabel: ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role,
            totpEnabled: u.totpEnabled, createdAt: u.createdAt.toISOString(),
            reviewsCount: u._count.reviews, disabled: u.disabled, isDemo: u.isDemo,
            premiumUntil: u.premiumUntil && u.premiumUntil.getTime() > Date.now() ? u.premiumUntil.toISOString() : null,
          })),
          privacy: privacy.map(p => ({
            id: p.id, email: p.email, kind: p.kind, message: p.message,
            status: p.status, createdAt: p.createdAt.toISOString(),
          })),
        });
      }

      case "entita": {
        await requireStaff("admin.entities");
        const proposals = await db.entityProposal.findMany({
          where: { status: "received" },
          include: { category: { select: { name: true } }, proposer: { select: { email: true } } },
        });
        const entities = await db.entity.findMany({
          include: { category: { select: { shortName: true } }, _count: { select: { reviews: true } } },
          orderBy: { createdAt: "asc" },
        });
        const zones = await db.zone.findMany();
        return NextResponse.json({
          ok: true,
          proposals: proposals.map(p => ({
            id: p.id, name: p.name, categoryName: p.category.name,
            subtitle: p.subtitle, address: p.address, zoneId: p.zoneId,
            justification: p.justification, contactEmail: p.contactEmail || p.proposer?.email || null,
            isPerson: p.categoryId === "proprietario" || p.categoryId === "affittuario",
            createdAt: p.createdAt.toISOString(),
          })),
          entities: entities.map(e => ({
            id: e.id, name: e.name, categoryShort: e.category.shortName, zoneId: e.zoneId,
            status: e.status, verifiedBusiness: e.verifiedBusiness, isDemo: e.isDemo,
            reviewsCount: e._count.reviews,
          })),
          zones: zones.map(z => ({ id: z.id, name: z.name })),
        });
      }

      case "consulenti": {
        await requireStaff("admin.entities");
        const profili = await db.consultantProfile.findMany({
          orderBy: { createdAt: "asc" },
          include: {
            zone: { select: { name: true, province: true } },
            user: { select: { email: true, nickname: true, totpEnabled: true } },
            docs: { select: { id: true, kind: true, originalName: true, sizeBytes: true } },
            requests: { select: { status: true } },
          },
        });
        return NextResponse.json({
          ok: true,
          consulenti: profili.map(c => ({
            id: c.id,
            name: `${c.firstName} ${c.lastName}`,
            email: c.user.email, nickname: c.user.nickname,
            totpEnabled: c.user.totpEnabled,
            profession: c.profession, title: c.title, bio: c.bio,
            zone: c.zone.name, province: c.zone.province,
            radiusKm: c.radiusKm, feeCents: c.feeCents,
            vatNumber: c.vatNumber, iban: c.iban, phone: c.phone,
            ibanCheck: c.ibanCheck, ibanCheckedAt: c.ibanCheckedAt?.toISOString() ?? null,
            status: c.status, rejectReason: c.rejectReason,
            entityId: c.entityId,
            hasPhoto: c.photoData != null,
            docs: c.docs,
            requestsCount: c.requests.length,
            createdAt: c.createdAt.toISOString(),
          })),
        });
      }

      case "perizie": {
        await requireStaff("admin.entities");
        const rows = await db.periziaRequest.findMany({
          orderBy: { createdAt: "desc" }, take: 200,
          include: {
            consultant: { select: { firstName: true, lastName: true, profession: true, iban: true } },
            requester: { select: { nickname: true, email: true } },
          },
        });
        const settings = await getSettings();
        return NextResponse.json({
          ok: true,
          platformIban: settings.platformIban,
          perizie: rows.map(r => ({
            id: r.id, kind: r.kind, address: r.address, description: r.description,
            status: r.status, feeCents: r.feeCents, payoutCents: r.payoutCents,
            commissionCents: r.commissionCents, paymentRef: r.paymentRef,
            paidAt: r.paidAt?.toISOString() ?? null,
            deliveredAt: r.deliveredAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
            consultant: `${r.consultant.firstName} ${r.consultant.lastName} (${r.consultant.profession})`,
            consultantIban: r.consultant.iban,
            requester: r.requester.nickname, requesterEmail: r.requester.email,
          })),
        });
      }

      case "contenuti": {
        await requireStaff("admin.contents");
        const settings = await getSettings();
        return NextResponse.json({
          ok: true,
          settings: {
            siteName: settings.siteName,
            heroTitle: settings.heroTitle, heroSub: settings.heroSub, globalNotice: settings.globalNotice,
            adsEnabled: settings.adsEnabled, adsClient: settings.adsClient,
          },
          demoMode: process.env.DEMO_MODE === "true",
        });
      }

      case "impostazioni": {
        await requireStaff("admin.settings");
        const settings = await getSettings();
        return NextResponse.json({ ok: true, settings });
      }

      case "log": {
        await requireStaff("audit.full");
        const logs = await db.auditLog.findMany({
          orderBy: { at: "desc" }, take: 200,
          include: { actor: { select: { nickname: true, email: true } } },
        });
        return NextResponse.json({
          ok: true,
          logs: logs.map(l => ({
            id: l.id, at: l.at.toISOString(),
            actor: l.actor ? `${l.actor.nickname} (${l.actor.email})` : "sistema",
            actorRole: l.actorRole, action: l.action, targetType: l.targetType,
            targetId: l.targetId, reason: l.reason, isDemo: l.isDemo,
          })),
        });
      }

      case "sicurezza": {
        await requireStaff("admin.security");
        const logs = await db.securityLog.findMany({ orderBy: { at: "desc" }, take: 200 });
        return NextResponse.json({
          ok: true,
          logs: logs.map(l => ({ id: l.id, at: l.at.toISOString(), type: l.type, severity: l.severity, details: l.details, isDemo: l.isDemo })),
        });
      }

      case "ruoli": {
        await requireStaff("admin.roles");
        const users = await db.user.findMany({
          where: { role: { in: ["moderator", "admin", "superadmin"] } },
          include: { entityOwned: { select: { name: true } } },
        });
        return NextResponse.json({
          ok: true,
          staff: users.map(u => ({
            id: u.id, email: u.email, nickname: u.nickname, role: u.role,
            totpEnabled: u.totpEnabled, disabled: u.disabled,
          })),
        });
      }

      case "demo": {
        await requireStaff("admin.demo");
        const counts = {
          users: await db.user.count({ where: { isDemo: true } }),
          entities: await db.entity.count({ where: { isDemo: true } }),
          reviews: await db.review.count({ where: { isDemo: true } }),
          experiences: await db.experience.count({ where: { isDemo: true } }),
          emails: await db.emailLog.count({ where: { isDemo: true } }),
        };
        return NextResponse.json({
          ok: true,
          demoMode: process.env.DEMO_MODE === "true",
          counts,
        });
      }

      case "casella-demo": {
        // casella email dimostrativa: visibile solo allo staff e solo in DEMO_MODE
        await requireStaff();
        if (process.env.DEMO_MODE !== "true") return fail("Funzione disponibile solo in modalità demo.", 404);
        const mails = await db.emailLog.findMany({ orderBy: { at: "desc" }, take: 60 });
        return NextResponse.json({
          ok: true,
          emails: mails.map(m => ({
            id: m.id, to: m.to, subject: m.subject, body: m.body,
            links: JSON.parse(m.linksJson) as { label: string; href: string }[],
            status: m.status, at: m.at.toISOString(), isDemo: m.isDemo,
          })),
        });
      }

      default:
        return fail("Sezione non riconosciuta.", 404);
    }
  } catch (e) {
    return handleError(e);
  }
}
