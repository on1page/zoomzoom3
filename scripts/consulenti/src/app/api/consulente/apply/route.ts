// POST /api/consulente/apply — domanda di iscrizione come Consulente
// Tecnico (o ri-domanda dopo un rifiuto). Richiede: account con email
// verificata e 2FA attiva; anagrafica professionale completa; zona di
// esercizio e raggio d'azione; tariffa; partita IVA e IBAN; foto profilo;
// documenti di qualifica e identificazione. La domanda resta PENDING fino
// all'approvazione dello staff (back office): la scheda pubblica nasce
// solo all'approvazione.
import { NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { auditLog } from "@/lib/server/audit";
import { validateApply, type ApplyInput } from "@/lib/server/consultants";

export const dynamic = "force-dynamic";

function decodeDataUrl(u: string): { mime: string; buf: Buffer } | null {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(String(u || ""));
  if (!m) return null;
  try {
    return { mime: m[1], buf: Buffer.from(m[2], "base64") };
  } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    if (!user.totpEnabled) {
      return fail("Per iscriverti come Consulente Tecnico devi prima attivare la verifica in due passaggi (2FA) dalle impostazioni del profilo: è obbligatoria per questa figura.", 403);
    }
    guard(req, "consulente-apply", 10, 3600);
    const settings = await getSettings();
    if (!settings.consulentiEnabled) {
      return fail("Le iscrizioni dei Consulenti Tecnici sono temporaneamente sospese.", 403);
    }

    const p = await readJson<ApplyInput>(req);
    const existing = await db.consultantProfile.findUnique({ where: { userId: user.id } });
    if (existing && existing.status === "approved") {
      return fail("La tua iscrizione è già approvata: usa la scheda del profilo per aggiornare i dati modificabili.", 409);
    }

    // alla ri-domanda dopo un rifiuto la foto già caricata può restare
    const needPhoto = !(existing && existing.photoData != null);
    const val = await validateApply(p, needPhoto);
    if (!val.ok) {
      return fail(val.issue.error, 400, { field: val.issue.field });
    }
    const d = val.data;

    // foto profilo: ricompilata in JPEG senza metadati (come le foto delle
    // recensioni), massimo 800 px
    let photoData: Buffer | null = null;
    if (d.photo) {
      const dec = decodeDataUrl(d.photo);
      if (!dec) return fail("La foto profilo non è leggibile: riprova con un'immagine diversa.", 400, { field: "photo" });
      try {
        photoData = await sharp(dec.buf).rotate().resize(800, 800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      } catch {
        return fail("La foto profilo non è un'immagine valida.", 400, { field: "photo" });
      }
    }

    // documenti: decodifica e controllo dimensioni (Bytes = Uint8Array
    // copiata in un buffer proprio, come la vuole Prisma)
    const toBytes = (b: Buffer): Uint8Array<ArrayBuffer> => {
      const u = new Uint8Array(new ArrayBuffer(b.length));
      u.set(b);
      return u;
    };
    const docs: Array<{ kind: string; originalName: string; mimeType: string; sizeBytes: number; data: Uint8Array<ArrayBuffer> }> = [];
    for (const doc of d.docs) {
      const dec = decodeDataUrl(doc.data);
      if (!dec) return fail(`Il documento "${doc.name}" non è leggibile.`, 400, { field: "docs" });
      if (dec.buf.length > 8 * 1024 * 1024) {
        return fail(`Il documento "${doc.name}" supera gli 8 MB.`, 400, { field: "docs" });
      }
      docs.push({ kind: doc.kind, originalName: doc.name, mimeType: dec.mime, sizeBytes: dec.buf.length, data: toBytes(dec.buf) });
    }

    const base = {
      firstName: d.firstName, lastName: d.lastName, profession: d.profession, title: d.title,
      bio: d.bio ?? null, zoneId: d.zoneId, radiusKm: d.radiusKm,
      feeCents: d.feeCents, vatNumber: d.vatNumber, iban: d.iban,
      phone: d.phone ?? null,
      status: "pending", rejectReason: null, reviewedById: null, reviewedAt: null,
    };

    if (existing) {
      await db.consultantProfile.update({
        where: { id: existing.id },
        data: {
          ...base,
          ...(photoData ? { photoData: toBytes(photoData) } : {}),
          docs: { deleteMany: {}, create: docs },
        },
      });
      await auditLog({ actorId: user.id, actorRole: user.role, action: "consulente.riapply", targetType: "consultantProfile", targetId: existing.id });
      return NextResponse.json({ ok: true, status: "pending", reapplied: true });
    }

    const prof = await db.consultantProfile.create({
      data: {
        ...base,
        userId: user.id,
        ...(photoData ? { photoData: toBytes(photoData) } : {}),
        docs: { create: docs },
      },
    });
    await auditLog({ actorId: user.id, actorRole: user.role, action: "consulente.apply", targetType: "consultantProfile", targetId: prof.id });
    return NextResponse.json({ ok: true, status: "pending" });
  } catch (e) {
    return handleError(e);
  }
}
