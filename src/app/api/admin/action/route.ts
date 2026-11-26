// POST /api/admin/action — azioni del back office con autorizzazione per
// permesso e audit log (attore, azione, oggetto, data, motivo).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/server/auth";
import { getSettings, updateSettings, invalidateSettingsCache } from "@/lib/server/settings";
import { revokePremiumForReview, restorePremiumForReview, grantPremiumManually, revokeAllPremium, awardPremiumForOrder } from "@/lib/server/premium";
import { recomputeUtility } from "@/lib/server/utility";
import { sendMail } from "@/lib/server/mailer";
import { auditLog, securityLog } from "@/lib/server/audit";
import { assertSameOrigin, readJson, handleError, fail } from "@/lib/server/http";
import { spawn } from "child_process";

type ActionBody = {
  action: string;
  id?: string;
  reason?: string;
  decision?: string;
  appealReason?: string;
  appealBy?: string;
  settings?: Record<string, unknown>;
  paymentRef?: string;
  role?: string;
  categoryId?: string;
  days?: number;
  geo?: { x?: number; y?: number };
};

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const p = await readJson<ActionBody>(req);
    const reason = String(p.reason || "").trim();

    switch (p.action) {

      /* ---- moderazione segnalazioni ---- */
      case "report.take": {
        const actor = await requireStaff("mod.reports");
        const rep = await db.report.findUnique({ where: { id: p.id } });
        if (!rep || rep.status !== "received") return fail("Segnalazione non disponibile.", 409);
        await db.report.update({ where: { id: rep.id }, data: { status: "reviewing" } });
        await db.reportDecision.create({ data: { reportId: rep.id, byId: actor.id, action: "Presa in carico", reason: reason || "In valutazione da parte della moderazione." } });
        return NextResponse.json({ ok: true });
      }
      case "report.decide": {
        const actor = await requireStaff("mod.reports");
        if (reason.length < 15) return fail("Motivazione obbligatoria (almeno 15 caratteri).");
        const rep = await db.report.findUnique({ where: { id: p.id }, include: { review: true } });
        if (!rep || !["reviewing", "received"].includes(rep.status)) return fail("Segnalazione non decidibile.", 409);
        const decision = p.decision === "hide" ? "hide" : "keep";
        if (decision === "hide" && rep.review) {
          if (rep.review.status !== "published") return fail("La recensione non è pubblicata.", 409);
          await db.review.update({ where: { id: rep.review.id }, data: { status: "hidden", hiddenReason: reason } });
          // frode accertata o contenuto illecito: il Premium ottenuto con quel
          // contributo viene revocato e ricalcolato (adattamento del modello
          // "rimuovi recensione e vantaggio" alla filosofia ZoomZoom)
          await revokePremiumForReview(rep.review.id, `Recensione nascosta dalla moderazione: ${reason}`);
        }
        await db.report.update({ where: { id: rep.id }, data: { status: "decided", decision } });
        await db.reportDecision.create({
          data: { reportId: rep.id, byId: actor.id, action: decision === "hide" ? "Recensione nascosta" : "Nessuna azione: recensione mantenuta", reason },
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: decision === "hide" ? "Recensione nascosta" : "Segnalazione respinta", targetType: "review", targetId: rep.targetId, reason, isDemo: rep.isDemo });
        if (rep.review) {
          const author = await db.user.findUnique({ where: { id: rep.review.userId } });
          if (author) {
            await sendMail(author.email, "La tua recensione è stata nascosta",
              `La moderazione ha nascosto la recensione con questa motivazione: ${reason} Puoi presentare appello entro 15 giorni.`);
          }
        }
        return NextResponse.json({ ok: true });
      }
      case "report.appeal": {
        // appello presentato dall'autore o dal segnalatore (dal sito pubblico, ma gestito qui per tracciabilità)
        const actor = await requireStaff(); // placeholder: gli appelli arrivano da /api/reports/appeal
        return fail("Usare la rotta dedicata per gli appelli.", 400);
      }

      /* ---- moderazione recensioni ---- */
      case "review.hide": {
        const actor = await requireStaff("mod.reviews");
        if (reason.length < 15) return fail("Motivo obbligatorio (almeno 15 caratteri).");
        const rev = await db.review.findUnique({ where: { id: p.id } });
        if (!rev || rev.status !== "published") return fail("Recensione non pubblicata.", 409);
        await db.review.update({ where: { id: rev.id }, data: { status: "hidden", hiddenReason: reason } });
        await revokePremiumForReview(rev.id, `Recensione nascosta dalla moderazione: ${reason}`);
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Recensione nascosta", targetType: "review", targetId: rev.id, reason, isDemo: rev.isDemo });
        const author = await db.user.findUnique({ where: { id: rev.userId } });
        if (author) {
          await sendMail(author.email, "La tua recensione è stata nascosta",
            `La moderazione ha nascosto la recensione con questa motivazione: ${reason} Puoi presentare appello entro 15 giorni.`);
        }
        return NextResponse.json({ ok: true });
      }
      case "review.restore": {
        const actor = await requireStaff("mod.reviews");
        const rev = await db.review.findUnique({ where: { id: p.id } });
        if (!rev || rev.status !== "hidden") return fail("Recensione non nascosta.", 409);
        await db.review.update({ where: { id: rev.id }, data: { status: "published", hiddenReason: null } });
        // appello accolto: il contributo torna valido e il Premium viene ripristinato
        await restorePremiumForReview(rev.id);
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Recensione ripristinata", targetType: "review", targetId: rev.id, reason: reason || "Ripristino a seguito di riesame.", isDemo: rev.isDemo });
        return NextResponse.json({ ok: true });
      }
      case "photo.remove": {
        // rimozione di una singola foto (privacy/illiceità): la recensione resta
        const actor = await requireStaff("mod.reviews");
        if (reason.length < 15) return fail("Motivo obbligatorio (almeno 15 caratteri).");
        const photo = await db.reviewPhoto.findUnique({ where: { id: p.id }, include: { review: { select: { id: true, userId: true, isDemo: true } } } });
        if (!photo) return fail("Foto non trovata.", 404);
        await db.reviewPhoto.delete({ where: { id: photo.id } });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Foto rimossa dalla recensione", targetType: "review", targetId: photo.review.id, reason, isDemo: photo.review.isDemo });
        const author = await db.user.findUnique({ where: { id: photo.review.userId } });
        if (author) {
          await sendMail(author.email, "Una tua foto è stata rimossa",
            `La moderazione ha rimosso una foto allegata a una tua recensione con questa motivazione: ${reason}`);
        }
        return NextResponse.json({ ok: true });
      }

      /* ---- riconoscimento di utilità (community) ---- */
      case "utility.recalc": {
        // ricalcolo manuale degli stessi conti del job giornaliero (trasparenza:
        // stessi numeri, stessa formula, stessa finestra mobile di 30 giorni)
        const actor = await requireStaff("mod.reviews");
        const settings = await getSettings();
        if (!settings.utilityEnabled) return fail("Il riconoscimento di utilità è disattivato nelle impostazioni.", 409);
        const stats = await recomputeUtility();
        await auditLog({
          actorId: actor.id, actorRole: actor.role,
          action: "Riconoscimento di utilità ricalcolato",
          targetType: "utility", targetId: null,
          reason: reason || `Indagini con punteggio: ${stats.reviewsScored}; voti anomali esclusi: ${stats.votesAnomalous}.`,
        });
        return NextResponse.json({ ok: true, stats });
      }
      case "utility.appeal.resolve": {
        // decisione sul ricorso: l'autore contesta voti esclusi come anomali
        const actor = await requireStaff("mod.reviews");
        if (reason.length < 15) return fail("Motivazione obbligatoria (almeno 15 caratteri): sarà comunicata all'utente.");
        const appeal = await db.utilityAppeal.findUnique({
          where: { id: p.id },
          include: { review: { select: { id: true, userId: true } }, user: { select: { id: true, email: true } } },
        });
        if (!appeal || appeal.status !== "open") return fail("Ricorso non disponibile o già deciso.", 409);
        const decision = p.decision === "accepted" ? "accepted" : "rejected";
        await db.utilityAppeal.update({
          where: { id: appeal.id },
          data: { status: decision, answer: reason, resolvedAt: new Date(), resolvedById: actor.id },
        });
        // ricorso accolto: al ricalcolo i controlli di reciprocità/raffica su
        // quell'indagine vengono sospesi e i voti esclusi tornano a contare
        if (decision === "accepted" && appeal.review) {
          await db.reviewUtility.upsert({
            where: { reviewId: appeal.review.id },
            create: { reviewId: appeal.review.id, trustOverride: true },
            update: { trustOverride: true },
          });
          const settings = await getSettings();
          if (settings.utilityEnabled) await recomputeUtility();
        }
        const codeLabel = decision === "accepted" ? "accolto" : "respinto";
        await auditLog({
          actorId: actor.id, actorRole: actor.role,
          action: `Ricorso di utilità ${codeLabel}`,
          targetType: "utility", targetId: appeal.reviewId,
          reason,
        });
        if (appeal.user) {
          await sendMail(
            appeal.user.email,
            `Ricorso ${codeLabel}`,
            `Il tuo ricorso sulla penalità di utilità è stato ${codeLabel}. Motivazione: ${reason} ` +
            (decision === "accepted"
              ? "I voti esclusi sulla tua indagine tornano a contare dal prossimo ricalcolo."
              : "I controlli anti-abuso restano attivi: puoi ripresentare il ricorso con nuovi elementi."),
          );
        }
        return NextResponse.json({ ok: true });
      }

      /* ---- contestazioni associazione ---- */
      case "dispute.take": {
        const actor = await requireStaff("mod.disputes");
        const d = await db.dispute.findUnique({ where: { id: p.id } });
        if (!d || d.status !== "received") return fail("Contestazione non disponibile.", 409);
        await db.dispute.update({ where: { id: d.id }, data: { status: "reviewing" } });
        await db.disputeDecision.create({ data: { disputeId: d.id, byId: actor.id, action: "Presa in carico", reason: reason || "In valutazione." } });
        return NextResponse.json({ ok: true });
      }
      case "dispute.decide": {
        const actor = await requireStaff("mod.disputes");
        if (reason.length < 15) return fail("Motivazione obbligatoria (almeno 15 caratteri).");
        const d = await db.dispute.findUnique({ where: { id: p.id }, include: { entity: true } });
        if (!d || !["received", "reviewing"].includes(d.status)) return fail("Contestazione non decidibile.", 409);
        const decision = p.decision === "hide" ? "hide" : "keep";
        if (decision === "hide") {
          // sospende la visibilità della scheda come provvedimento motivato (non cancellazione)
          await db.entity.update({ where: { id: d.entityId }, data: { status: "rejected" } });
        }
        await db.dispute.update({ where: { id: d.id }, data: { status: "closed", decision } });
        await db.disputeDecision.create({
          data: { disputeId: d.id, byId: actor.id, action: decision === "hide" ? "Scheda sospesa per correzione" : "Associazione mantenuta", reason },
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: decision === "hide" ? "Scheda sospesa su contestazione" : "Contestazione respinta", targetType: "entity", targetId: d.entityId, reason, isDemo: d.isDemo });
        await sendMail(d.claimantEmail, "Esito della contestazione",
          `La tua contestazione sulla scheda "${d.entity.name}" è stata valutata: ${decision === "hide" ? "la scheda è stata sospesa per correzione" : "l'associazione è stata mantenuta"}. Motivazione: ${reason}`);
        return NextResponse.json({ ok: true });
      }

      /* ---- esperienze e verifiche ---- */
      case "experience.approve": {
        const actor = await requireStaff("mod.experiences");
        const e = await db.experience.findUnique({ where: { id: p.id }, include: { entity: true, requester: true, docs: true } });
        if (!e || e.status !== "pending") return fail("Richiesta non disponibile.", 409);
        const isRequest = e.origin === "verification-request";
        if (isRequest && !e.requester) return fail("Richiedente non trovato.", 409);
        await db.$transaction(async (tx) => {
          await tx.experience.update({
            where: { id: e.id },
            data: isRequest ? { status: "active", userId: e.requester!.id, claimedAt: new Date() } : { status: "active" },
          });
          // cancellazione documenti dopo la decisione (retention)
          for (const d of e.docs) {
            if (!d.deletedAt) await tx.verificationDoc.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
          }
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Esperienza verificata e approvata", targetType: "experience", targetId: e.id, reason: reason || "Documento ritenuto sufficiente.", isDemo: e.isDemo });
        if (e.requester) {
          const base = process.env.APP_BASE_URL || "";
          await sendMail(e.requester.email, "Esperienza approvata: puoi recensire",
            `La tua esperienza con ${e.entity.name} è stata verificata: ora puoi pubblicare la tua recensione.`,
            [{ label: "Scrivi la recensione", href: `${base}/#/scrivi/${e.id}` }]);
        }
        return NextResponse.json({ ok: true });
      }
      case "experience.reject": {
        const actor = await requireStaff("mod.experiences");
        if (reason.length < 15) return fail("Motivo (comunicato all'utente) obbligatorio.");
        const e = await db.experience.findUnique({ where: { id: p.id }, include: { entity: true, requester: true, docs: true } });
        if (!e || e.status !== "pending") return fail("Richiesta non disponibile.", 409);
        await db.$transaction(async (tx) => {
          await tx.experience.update({ where: { id: e.id }, data: { status: "rejected" } });
          for (const d of e.docs) {
            if (!d.deletedAt) await tx.verificationDoc.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
          }
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Verifica esperienza rigettata", targetType: "experience", targetId: e.id, reason, isDemo: e.isDemo });
        if (e.requester) {
          await sendMail(e.requester.email, "Verifica esperienza non approvata",
            `La richiesta relativa a ${e.entity.name} non è stata approvata. Motivo: ${reason}`);
        }
        return NextResponse.json({ ok: true });
      }

      /* ---- inviti ---- */
      case "invite.revoke": {
        const actor = await requireStaff("admin.invites");
        const inv = await db.invite.findUnique({ where: { id: p.id } });
        if (!inv || inv.usedAt || inv.revoked) return fail("Invito non revocabile.", 409);
        await db.invite.update({ where: { id: inv.id }, data: { revoked: true } });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Invito revocato", targetType: "invite", targetId: inv.id, reason: reason || "Revoca amministrativa.", isDemo: inv.isDemo });
        await securityLog("invite_revoked", "info", "Invito revocato dall'area amministrativa.", inv.isDemo);
        return NextResponse.json({ ok: true });
      }

      /* ---- utenti ---- */
      case "user.toggle": {
        const actor = await requireStaff("admin.users");
        const u = await db.user.findUnique({ where: { id: p.id } });
        if (!u) return fail("Utente non trovato.", 404);
        if (u.id === actor.id) return fail("Non puoi sospendere il tuo account.", 400);
        if (["moderator", "admin", "superadmin"].includes(u.role) && actor.role !== "superadmin") {
          return fail("I ruoli dello staff sono gestibili solo dal super amministratore.", 403);
        }
        await db.user.update({ where: { id: u.id }, data: { disabled: !u.disabled } });
        await db.session.deleteMany({ where: { userId: u.id } });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: u.disabled ? "Account riattivato" : "Account sospeso", targetType: "user", targetId: u.id, reason: reason || (u.disabled ? "Riattivazione." : "Sospensione per violazioni o indagini su abusi."), isDemo: u.isDemo });
        return NextResponse.json({ ok: true });
      }
      case "user.forceLogout": {
        const actor = await requireStaff("admin.users");
        const u = await db.user.findUnique({ where: { id: p.id } });
        if (!u) return fail("Utente non trovato.", 404);
        if (u.id === actor.id) return fail("Impossibile forzare l'uscita di te stesso.", 400);
        await db.session.deleteMany({ where: { userId: u.id } });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Uscita forzata sessione", targetType: "user", targetId: u.id, reason: reason || "Chiusura sessione per sicurezza.", isDemo: u.isDemo });
        return NextResponse.json({ ok: true });
      }
      /* ---- Membership Premium ---- */
      case "premium.grant": {
        const actor = await requireStaff("admin.users");
        const days = Math.min(365, Math.max(1, Math.round(Number(p.days) || 0)));
        if (!days) return fail("Giorni non validi (1-365).");
        if (reason.length < 10) return fail("Motivazione obbligatoria (almeno 10 caratteri).");
        const u = await db.user.findUnique({ where: { id: p.id } });
        if (!u) return fail("Utente non trovato.", 404);
        const res = await grantPremiumManually({ userId: u.id, days, reason });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: `Premium concesso manualmente: ${res.grantedDays} giorni`, targetType: "user", targetId: u.id, reason, isDemo: u.isDemo });
        await sendMail(u.email, "Membership Premium attiva",
          `Hai ricevuto ${res.grantedDays} giorni di Membership Premium. Motivazione: ${reason}`);
        return NextResponse.json({ ok: true, premium: { until: res.until ? res.until.toISOString() : null } });
      }
      case "premium.revoke": {
        const actor = await requireStaff("admin.users");
        if (reason.length < 15) return fail("Motivazione obbligatoria (almeno 15 caratteri).");
        const u = await db.user.findUnique({ where: { id: p.id } });
        if (!u) return fail("Utente non trovato.", 404);
        const n = await revokeAllPremium(u.id, reason);
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: `Premium revocato (${n} concessioni)`, targetType: "user", targetId: u.id, reason, isDemo: u.isDemo });
        return NextResponse.json({ ok: true, revoked: n });
      }

      case "privacy.done": {
        const actor = await requireStaff("admin.users");
        const pr = await db.privacyRequest.findUnique({ where: { id: p.id } });
        if (!pr) return fail("Richiesta non trovata.", 404);
        await db.privacyRequest.update({ where: { id: pr.id }, data: { status: "done" } });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Richiesta privacy evasa", targetType: "privacy_request", targetId: pr.id, reason: reason || null });
        return NextResponse.json({ ok: true });
      }

      /* ---- schede e proposte ---- */
      case "proposal.approve": {
        const actor = await requireStaff("admin.entities");
        if (reason.length < 10) return fail("Motivazione della decisione obbligatoria (almeno 10 caratteri).");
        const prop = await db.entityProposal.findUnique({ where: { id: p.id }, include: { category: true } });
        if (!prop || prop.status !== "received") return fail("Proposta non disponibile.", 409);
        const isPerson = prop.category.isPerson;
        const initials = initialsFrom(prop.name);
        const geo = isPerson ? null : p.geo as { lat: number; lng: number } | undefined;
        const ent = await db.entity.create({
          data: {
            categoryId: prop.categoryId,
            name: isPerson ? initials : prop.name,
            subtitle: prop.subtitle, address: isPerson ? null : prop.address,
            zoneId: prop.zoneId, geoLat: geo?.lat ?? null, geoLng: geo?.lng ?? null,
            initialsOnly: isPerson, verifiedBusiness: false,
            status: "published", proposedBy: prop.proposedById || "proposal", isDemo: prop.isDemo,
          },
        });
        await db.entityProposal.update({
          where: { id: prop.id },
          data: { status: "approved", decisionReason: reason, decidedById: actor.id, decidedAt: new Date() },
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Proposta di scheda approvata", targetType: "entity", targetId: ent.id, reason, isDemo: prop.isDemo });
        return NextResponse.json({ ok: true, entityId: ent.id });
      }
      case "proposal.reject": {
        const actor = await requireStaff("admin.entities");
        if (reason.length < 10) return fail("Motivazione della decisione obbligatoria (almeno 10 caratteri).");
        const prop = await db.entityProposal.findUnique({ where: { id: p.id } });
        if (!prop || prop.status !== "received") return fail("Proposta non disponibile.", 409);
        await db.entityProposal.update({
          where: { id: prop.id },
          data: { status: "rejected", decisionReason: reason, decidedById: actor.id, decidedAt: new Date() },
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Proposta di scheda respinta", targetType: "entity_proposal", targetId: prop.id, reason, isDemo: prop.isDemo });
        return NextResponse.json({ ok: true });
      }
      case "entity.toggle": {
        const actor = await requireStaff("admin.entities");
        const ent = await db.entity.findUnique({ where: { id: p.id } });
        if (!ent) return fail("Scheda non trovata.", 404);
        const next = ent.status === "published" ? "hidden" : "published";
        await db.entity.update({ where: { id: ent.id }, data: { status: next } });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: next === "published" ? "Scheda pubblicata" : "Scheda nascosta", targetType: "entity", targetId: ent.id, reason: reason || null, isDemo: ent.isDemo });
        return NextResponse.json({ ok: true });
      }

      /* ---- Consulenti tecnici: iscrizioni ---- */
      case "consultant.approve": {
        const actor = await requireStaff("admin.entities");
        const prof = await db.consultantProfile.findUnique({
          where: { id: p.id },
          include: { zone: true, user: { select: { id: true, totpEnabled: true, isDemo: true } } },
        });
        if (!prof || prof.status !== "pending") return fail("Domanda di iscrizione non disponibile.", 409);
        // l'accesso del consulente è protetto da 2FA: garantita all'iscrizione
        // e ricontrollata qui, prima di pubblicare la scheda
        if (!prof.user.totpEnabled) {
          return fail("L'account non ha più la 2FA attiva: l'approvazione richiede la verifica in due passaggi. Contatta l'iscritto prima di procedere.", 409);
        }
        const displayName = `${prof.firstName} ${prof.lastName}`;
        const subtitle = `${prof.profession}${prof.zone.province ? ` · ${prof.zone.name} (${prof.zone.province})` : ` · ${prof.zone.name}`}`;
        // scheda pubblica nel catalogo (categoria "consulente"): creata ora o
        // aggiornata se era già stata creata in un ciclo precedente
        let entityId = prof.entityId;
        if (entityId) {
          await db.entity.update({
            where: { id: entityId },
            data: { name: displayName, subtitle, zoneId: prof.zoneId, status: "published" },
          });
        } else {
          const ent = await db.entity.create({
            data: {
              categoryId: "consulente",
              name: displayName,
              subtitle,
              zoneId: prof.zoneId,
              initialsOnly: false,
              verifiedBusiness: true,
              status: "published",
              proposedBy: `user:${prof.userId}`,
              ownerUserId: prof.userId,
              isDemo: prof.user.isDemo,
            },
          });
          entityId = ent.id;
        }
        await db.consultantProfile.update({
          where: { id: prof.id },
          data: { status: "approved", rejectReason: null, reviewedById: actor.id, reviewedAt: new Date(), entityId },
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Iscrizione consulente approvata", targetType: "consultantProfile", targetId: prof.id, reason: reason || null });
        return NextResponse.json({ ok: true, entityId });
      }
      case "consultant.reject": {
        const actor = await requireStaff("admin.entities");
        if (reason.length < 10) return fail("Motivazione della decisione obbligatoria (almeno 10 caratteri).");
        const prof = await db.consultantProfile.findUnique({ where: { id: p.id } });
        if (!prof || prof.status !== "pending") return fail("Domanda di iscrizione non disponibile.", 409);
        // la scheda pubblica (se esiste da un ciclo precedente) viene nascosta
        if (prof.entityId) {
          await db.entity.update({ where: { id: prof.entityId }, data: { status: "hidden" } }).catch(() => {});
        }
        await db.consultantProfile.update({
          where: { id: prof.id },
          data: { status: "rejected", rejectReason: reason, reviewedById: actor.id, reviewedAt: new Date() },
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Iscrizione consulente respinta", targetType: "consultantProfile", targetId: prof.id, reason });
        return NextResponse.json({ ok: true });
      }
      case "consultant.ibanConfirm":
      case "consultant.ibanMismatch": {
        // verifica dell'intestazione dell'IBAN: conferma manuale dello staff
        // (il richiamo al servizio esterno, se configurato, avviene alla
        // presentazione della domanda)
        const actor = await requireStaff("admin.entities");
        const prof = await db.consultantProfile.findUnique({ where: { id: p.id } });
        if (!prof) return fail("Profilo consulente non trovato.", 404);
        const next = p.action === "consultant.ibanConfirm" ? "confirmed" : "mismatch";
        await db.consultantProfile.update({
          where: { id: prof.id },
          data: { ibanCheck: next, ibanCheckedAt: new Date() },
        });
        await auditLog({
          actorId: actor.id, actorRole: actor.role,
          action: next === "confirmed" ? "IBAN consulente verificato" : "Discordanza IBAN consulente segnalata",
          targetType: "consultantProfile", targetId: prof.id, reason: reason || null,
        });
        return NextResponse.json({ ok: true, ibanCheck: next });
      }

      /* ---- abbonamenti Premium (percorso ② del modello D11) ---- */
      case "subscription.pay": {
        // registrazione del bonifico: SOLO il super amministratore, come per
        // le perizie (i soldi passano dalle stesse mani)
        const actor = await requireStaff("admin.entities");
        if (actor.role !== "superadmin") {
          return fail("Solo il super amministratore registra i pagamenti degli abbonamenti.", 403);
        }
        const order = await db.subscriptionOrder.findUnique({
          where: { id: p.id },
          include: { user: { select: { id: true, email: true, isDemo: true, role: true } } },
        });
        if (!order) return fail("Ordine non trovato.", 404);
        if (order.status !== "pending") return fail("Si registra il pagamento di un ordine in attesa.", 409);
        const settings = await getSettings();
        if (!settings.premiumEnabled) return fail("Membership Premium è sospesa: impossibile attivare l'ordine.", 409);
        const paymentRef = String(p.paymentRef || "").trim().slice(0, 160) || null;
        const paidAt = new Date();
        // il grant nasce qui (origine «acquisto»), con le stesse regole di
        // accumulo e lo stesso cap dei premi per contributo
        const res = await awardPremiumForOrder({
          userId: order.userId, days: order.days, settings,
        });
        await db.subscriptionOrder.update({
          where: { id: order.id },
          data: { status: "paid", paidAt, paymentRef, grantId: res.grantId ?? null },
        });
        await auditLog({
          actorId: actor.id, actorRole: actor.role,
          action: "Pagamento abbonamento registrato",
          targetType: "subscriptionOrder", targetId: order.id,
          reason: `piano ${order.planName} · ${res.grantedDays} giorni · causale ${order.code}${paymentRef ? ` · rif. ${paymentRef}` : ""}`,
          isDemo: order.user.isDemo,
        });
        void sendMail(
          order.user.email,
          "ZoomZoom — Premium attivato",
          `Abbiamo registrato il pagamento del piano ${order.planName}: ${res.grantedDays} giorni di Membership Premium sono attivi${res.until ? ` fino al ${res.until.toLocaleDateString("it-IT")}` : ""}.
Grazie! Puoi anche guadagnarti il Premium contribuendo con le indagini della community.`,
          [{ label: "Il tuo profilo", href: "/#/profilo" }],
        );
        return NextResponse.json({ ok: true, status: "paid", grantedDays: res.grantedDays, until: res.until ? res.until.toISOString() : null });
      }
      case "subscription.cancel": {
        const actor = await requireStaff("admin.entities");
        if (actor.role !== "superadmin") {
          return fail("Solo il super amministratore gestisce gli ordini di abbonamento.", 403);
        }
        const order = await db.subscriptionOrder.findUnique({ where: { id: p.id } });
        if (!order) return fail("Ordine non trovato.", 404);
        if (order.status !== "pending") return fail("L'ordine non è più annullabile in questo stato.", 409);
        await db.subscriptionOrder.update({ where: { id: order.id }, data: { status: "cancelled" } });
        await auditLog({
          actorId: actor.id, actorRole: actor.role,
          action: "Ordine di abbonamento annullato dallo staff",
          targetType: "subscriptionOrder", targetId: order.id,
          reason: reason || `piano ${order.planName}`,
        });
        return NextResponse.json({ ok: true, status: "cancelled" });
      }

      /* ---- contenuti e impostazioni ---- */
      case "contents.update": {
        const actor = await requireStaff("admin.contents");
        const s = p.settings || {};
        const patch: Record<string, unknown> = {};
        if (typeof s.siteName === "string" && s.siteName.trim()) patch.siteName = s.siteName.trim().slice(0, 40);
        if (typeof s.heroTitle === "string") patch.heroTitle = s.heroTitle.slice(0, 200);
        if (typeof s.heroSub === "string") patch.heroSub = s.heroSub.slice(0, 400);
        if (typeof s.globalNotice === "string") patch.globalNotice = s.globalNotice.slice(0, 300);
        if (typeof s.adsEnabled === "boolean") patch.adsEnabled = s.adsEnabled;
        if (typeof s.adsClient === "string") patch.adsClient = s.adsClient.trim().slice(0, 40);
        const settings = await updateSettings(patch);
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Contenuti aggiornati", targetType: "settings", targetId: "contents", reason: reason || null });
        return NextResponse.json({ ok: true, settings });
      }
      case "settings.update": {
        const actor = await requireStaff("admin.settings");
        const s = p.settings || {};
        const patch: Record<string, unknown> = {};
        const num = (v: unknown, min: number, max: number) => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined;
        };
        const mr = num(s.minReviews, 1, 50); if (mr != null) patch.minReviews = mr;
        const rd = num(s.rettificaDays, 1, 365); if (rd != null) patch.rettificaDays = rd;
        const idc = num(s.inviteDailyCap, 1, 200); if (idc != null) patch.inviteDailyCap = idc;
        const iaa = num(s.inviteApprovalAbove, 1, 500); if (iaa != null) patch.inviteApprovalAbove = iaa;
        const ied = num(s.inviteExpiryDays, 1, 90); if (ied != null) patch.inviteExpiryDays = ied;
        const prd = num(s.proofRetentionDays, 1, 365); if (prd != null) patch.proofRetentionDays = prd;
        const mma = num(s.mapMinAggregate, 1, 50); if (mma != null) patch.mapMinAggregate = mma;
        const pdpr = num(s.premiumDaysPerReview, 0, 365); if (pdpr != null) patch.premiumDaysPerReview = pdpr;
        const pmd = num(s.premiumMaxDays, 1, 3650); if (pmd != null) patch.premiumMaxDays = pmd;
        const orpd = num(s.openReviewsPerDay, 1, 50); if (orpd != null) patch.openReviewsPerDay = orpd;
        if (typeof s.premiumEnabled === "boolean") patch.premiumEnabled = s.premiumEnabled;
        if (typeof s.openReviewsEnabled === "boolean") patch.openReviewsEnabled = s.openReviewsEnabled;
        if (typeof s.photosEnabled === "boolean") patch.photosEnabled = s.photosEnabled;
        if (typeof s.votesEnabled === "boolean") patch.votesEnabled = s.votesEnabled;
        if (typeof s.utilityEnabled === "boolean") patch.utilityEnabled = s.utilityEnabled;
        if (typeof s.consulentiEnabled === "boolean") patch.consulentiEnabled = s.consulentiEnabled;
        // percorso ② — abbonamenti Premium
        if (typeof s.premiumPlansEnabled === "boolean") patch.premiumPlansEnabled = s.premiumPlansEnabled;
        if (Array.isArray(s.premiumPlans)) {
          const { sanitizePlans } = await import("@/lib/server/settings");
          patch.premiumPlans = sanitizePlans(s.premiumPlans);
        }
        // percorso ③ — indagine professionale e bacheca di zona
        if (typeof s.periziaBachecaEnabled === "boolean") patch.periziaBachecaEnabled = s.periziaBachecaEnabled;
        if (typeof s.periziaHideRequesterUntilAccept === "boolean") patch.periziaHideRequesterUntilAccept = s.periziaHideRequesterUntilAccept;
        const bed = num(s.bachecaExpiryDays, 1, 90); if (bed != null) patch.bachecaExpiryDays = bed;
        const pdd = num(s.periziaDeadlineDays, 1, 60); if (pdd != null) patch.periziaDeadlineDays = pdd;
        if (typeof s.platformIban === "string") patch.platformIban = s.platformIban.trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
        if (typeof s.paymentInstructions === "string") patch.paymentInstructions = s.paymentInstructions.trim().slice(0, 600);
        if (typeof s.adsEnabled === "boolean") patch.adsEnabled = s.adsEnabled;
        if (typeof s.adsClient === "string") patch.adsClient = s.adsClient.trim().slice(0, 40);
        const settings = await updateSettings(patch);
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Impostazione aggiornata", targetType: "settings", targetId: Object.keys(patch).join(","), reason: reason || null });
        return NextResponse.json({ ok: true, settings });
      }

      /* ---- ruoli (solo superadmin) ---- */
      case "role.set": {
        const actor = await requireStaff("admin.roles");
        const u = await db.user.findUnique({ where: { id: p.id } });
        if (!u) return fail("Utente non trovato.", 404);
        if (u.id === actor.id) return fail("Non puoi cambiare il tuo ruolo.", 400);
        const newRole = String(p.role);
        if (!["user", "moderator", "admin", "superadmin"].includes(newRole)) return fail("Ruolo non valido.");
        // promozione a staff concessa solo se la 2FA è attiva (obbligatoria per il back office)
        if (["moderator", "admin", "superadmin"].includes(newRole) && !u.totpEnabled) {
          return fail("L'account deve avere la 2FA attiva prima di poter ricevere un ruolo di back office.", 409);
        }
        await db.user.update({ where: { id: u.id }, data: { role: newRole } });
        if (newRole === "user") await db.session.deleteMany({ where: { userId: u.id, kind: "admin" } });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: `Ruolo impostato: ${newRole}`, targetType: "user", targetId: u.id, reason: reason || null, isDemo: u.isDemo });
        return NextResponse.json({ ok: true });
      }

      /* ---- dati demo (solo superadmin, solo DEMO_MODE) ---- */
      case "demo.wipe": {
        const actor = await requireStaff("admin.demo");
        if (process.env.DEMO_MODE !== "true") return fail("Operazione disponibile solo in modalità demo.", 403);
        await wipeDemoData();
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Dati demo eliminati", targetType: "demo", targetId: "all", reason: reason || "Pulizia dati dimostrativi." });
        return NextResponse.json({ ok: true });
      }
      case "demo.reseed": {
        const actor = await requireStaff("admin.demo");
        if (process.env.DEMO_MODE !== "true") return fail("Operazione disponibile solo in modalità demo.", 403);
        await wipeDemoData();
        await new Promise<void>((resolve, reject) => {
          const child = spawn("bun", ["scripts/seed.ts"], { cwd: process.cwd() });
          child.on("close", code => code === 0 ? resolve() : reject(new Error("seed fallito")));
          child.on("error", reject);
        });
        await auditLog({ actorId: actor.id, actorRole: actor.role, action: "Dati demo rigenerati", targetType: "demo", targetId: "all", reason: reason || "Rigenerazione dati dimostrativi." });
        return NextResponse.json({ ok: true });
      }

      default:
        return fail("Azione non riconosciuta.", 404);
    }
  } catch (e) {
    return handleError(e);
  }
}

function initialsFrom(name: string): string {
  const w = String(name).trim().split(/\s+/);
  return w.length >= 2 ? `${w[0][0].toUpperCase()}. ${w[1][0].toUpperCase()}.` : `${w[0][0].toUpperCase()}.`;
}

async function wipeDemoData() {
  const demoUsers = await db.user.findMany({ where: { isDemo: true }, select: { id: true } });
  const ids = demoUsers.map(u => u.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await db.consent.deleteMany({ where: { userId: { in: ids } } });
    await db.privacyRequest.deleteMany({ where: { userId: { in: ids } } });
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.backupCode.deleteMany({ where: { userId: { in: ids } } });
    await db.emailVerifyToken.deleteMany({ where: { userId: { in: ids } } });
  }
  await db.entityProposal.deleteMany({ where: { isDemo: true } });
  // foto e voti delle recensioni demo (il resto va a cascata con entità e utenti)
  await db.reviewPhoto.deleteMany({ where: { isDemo: true } });
  await db.reviewVote.deleteMany({ where: { review: { isDemo: true } } });
  await db.entity.deleteMany({ where: { isDemo: true } });
  await db.experience.deleteMany({ where: { isDemo: true } });
  await db.invite.deleteMany({ where: { isDemo: true } });
  await db.report.deleteMany({ where: { isDemo: true } });
  await db.dispute.deleteMany({ where: { isDemo: true } });
  await db.emailLog.deleteMany({ where: { isDemo: true } });
  await db.zone.deleteMany({ where: { isDemo: true } });
  if (ids.length) {
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}
