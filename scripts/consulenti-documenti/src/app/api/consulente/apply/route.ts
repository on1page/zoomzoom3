// POST /api/consulente/apply — domanda di iscrizione come Consulente
// Tecnico (o ri-domanda dopo un rifiuto). Richiede: account con email
// verificata e 2FA attiva; anagrafica professionale completa; zona di
// esercizio e raggio d'azione; tariffa; partita IVA e IBAN (con struttura
// e codice di controllo verificati + dichiarazione di intestazione); foto
// profilo; documenti di qualifica e identificazione (max 2 MB l'uno, 3 MB
// in totale: il browser comprime le foto, qui i limiti sono ripetuti).
// La domanda resta PENDING fino all'approvazione dello staff (back office):
// la scheda pubblica nasce solo all'approvazione.
import { NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { auditLog } from "@/lib/server/audit";
import { validateApply, decodeDataUrl, sniffDocMime, MAX_DOC_BYTES, type ApplyInput } from "@/lib/server/consultants";
import { verifyIbanOwner } from "@/lib/server/iban-verify";

export const dynamic = "force-dynamic";

// la richiesta viaggia in un unico JSON con i file in base64: l'ambiente di
// produzione (serverless) taglia i body oltre ~4,5 MB rispondendo in modo
// non JSON ("Risposta non valida dal server"). Con i limiti attuali il body
// resta sotto ~4,2 MB; se sfora, meglio un messaggio chiaro che un 413.
const MAX_BODY_BYTES = 4_600_000;

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

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      // il body viene consumato (entro un tetto di sicurezza) prima di
      // rispondere: altrimenti la connessione del client si tronca e il
      // browser mostra un errore di rete invece del messaggio
      if (contentLength < 50 * 1024 * 1024) await req.arrayBuffer().catch(() => null);
      return fail("Gli allegati superano il limite per un invio unico (max 3 MB in totale): rimuovine qualcuno o sostituisci i PDF con foto, che vengono compresse automaticamente.", 413, { field: "docs" });
    }

    const p = await readJson<ApplyInput>(req);
    const existing = await db.consultantProfile.findUnique({ where: { userId: user.id } });
    if (existing && existing.status === "approved") {
      return fail("La tua iscrizione è già approvata: usa la scheda del profilo per aggiornare i dati modificabili.", 409);
    }

    const val = await validateApply(p, existing);
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

    // documenti: decodifica, controllo del FORMATO REALE (primi byte) e
    // delle dimensioni (Bytes = Uint8Array copiata in un buffer proprio,
    // come la vuole Prisma)
    const toBytes = (b: Buffer): Uint8Array<ArrayBuffer> => {
      const u = new Uint8Array(new ArrayBuffer(b.length));
      u.set(b);
      return u;
    };
    const docs: Array<{ kind: string; originalName: string; mimeType: string; sizeBytes: number; data: Uint8Array<ArrayBuffer> }> = [];
    for (const doc of d.docs) {
      const dec = decodeDataUrl(doc.data);
      if (!dec) return fail(`Il documento "${doc.name}" non è leggibile.`, 400, { field: "docs" });
      if (dec.buf.length > MAX_DOC_BYTES) {
        return fail(`Il documento "${doc.name}" supera i 2 MB.`, 400, { field: "docs" });
      }
      const sniffed = sniffDocMime(dec.buf);
      if (!sniffed) {
        return fail(`Il contenuto di "${doc.name}" non è un PDF né un'immagine: usa PDF, JPG, PNG o WebP.`, 400, { field: "docs" });
      }
      if (sniffed !== dec.mime.toLowerCase()) {
        return fail(`"${doc.name}" dichiara un formato ma il contenuto è un altro (${sniffed}): ricarica il file corretto.`, 400, { field: "docs" });
      }
      docs.push({ kind: doc.kind, originalName: doc.name, mimeType: sniffed, sizeBytes: dec.buf.length, data: toBytes(dec.buf) });
    }

    // verifica dell'intestatario dell'IBAN: solo se lo staff ha configurato
    // un servizio di verifica (IBAN_VERIFY_URL + IBAN_VERIFY_TOKEN). Senza
    // servizio vale l'autocertificazione, che lo staff conferma a mano.
    let ibanCheck = "self";
    let ibanCheckedAt: Date | null = null;
    const extCheck = await verifyIbanOwner(d.iban, `${d.firstName} ${d.lastName}`);
    if (extCheck?.result === "mismatch") {
      return fail("Il servizio di verifica indica che l'IBAN è intestato a una persona diversa da quella indicata. Controlla l'IBAN o scrivi all'amministrazione se ritieni sia un errore.", 400, { field: "iban" });
    }
    if (extCheck?.result === "match") {
      ibanCheck = "confirmed";
      ibanCheckedAt = new Date();
    }

    const base = {
      firstName: d.firstName, lastName: d.lastName, profession: d.profession, title: d.title,
      bio: d.bio ?? null, zoneId: d.zoneId, radiusKm: d.radiusKm,
      feeCents: d.feeCents, vatNumber: d.vatNumber, iban: d.iban,
      ibanCheck, ibanCheckedAt,
      phone: d.phone ?? null,
      status: "pending", rejectReason: null, reviewedById: null, reviewedAt: null,
    };

    if (existing) {
      // ri-domanda: si conservano i documenti indicati, si sostituiscono gli altri
      await db.consultantProfile.update({
        where: { id: existing.id },
        data: {
          ...base,
          ...(photoData ? { photoData: toBytes(photoData) } : {}),
          docs: {
            deleteMany: d.keepDocIds.length ? { id: { notIn: d.keepDocIds } } : {},
            create: docs,
          },
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
