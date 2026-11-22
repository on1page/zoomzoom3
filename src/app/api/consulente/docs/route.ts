// PATCH  /api/consulente/docs — gestione dei documenti caricati con la
//   domanda, FINCHÉ È IN ESAME (status "pending"):
//   - con docId: sostituisce il contenuto (data) e/o riclassifica (kind)
//     o rinomina il documento già in archivio;
//   - senza docId: aggiunge un documento nuovo (kind + data obbligatori).
// DELETE /api/consulente/docs — elimina un documento, salvo che sia l'ultimo
//   di un tipo obbligatorio (qualifica / identificazione): la domanda deve
//   restare completa per lo staff. Stessi limiti dell'invio iniziale:
//   2 MB per file, 3 MB in totale, 8 file, PDF/JPG/PNG/WebP verificati
//   sui primi byte del contenuto.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { auditLog } from "@/lib/server/audit";
import {
  decodeDataUrl, sniffDocMime,
  MAX_FILES, MAX_DOC_BYTES, MAX_TOTAL_DOC_BYTES, ALLOWED_DOC_MIMES, DOC_KINDS,
} from "@/lib/server/consultants";

export const dynamic = "force-dynamic";

function toBytes(b: Buffer): Uint8Array<ArrayBuffer> {
  const u = new Uint8Array(new ArrayBuffer(b.length));
  u.set(b);
  return u;
}

/** Decodifica e controlla un documento nuovo (formato reale + dimensione). */
function checkDocData(data: string, name: string):
  { ok: true; mime: string; buf: Buffer } | { ok: false; error: string } {
  const dec = decodeDataUrl(data);
  if (!dec) return { ok: false, error: `Il documento "${name}" non è leggibile.` };
  if (dec.buf.length > MAX_DOC_BYTES) {
    return { ok: false, error: `"${name}" supera i 2 MB: comprimilo o carica una foto (le foto vengono compresse automaticamente).` };
  }
  const sniffed = sniffDocMime(dec.buf);
  if (!sniffed) return { ok: false, error: `Il contenuto di "${name}" non è un PDF né un'immagine: usa PDF, JPG, PNG o WebP.` };
  if (!(ALLOWED_DOC_MIMES as string[]).includes(sniffed)) {
    return { ok: false, error: `"${name}": formato non ammesso (PDF, JPG, PNG o WebP).` };
  }
  return { ok: true, mime: sniffed, buf: dec.buf };
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "consulente-docs", 60, 3600);
    const p = await readJson<{ docId?: string; kind?: string; name?: string; data?: string }>(req);

    const prof = await db.consultantProfile.findUnique({ where: { userId: user.id } });

    if (p.docId) {
      // ---- sostituzione / riclassifica di un documento esistente ----
      // prima la titolarità del documento (404 anche per chi non ha profilo:
      // nessuna informazione su documenti altrui), poi lo stato della domanda
      const doc = await db.consultantDoc.findUnique({ where: { id: String(p.docId) } });
      if (!doc || !prof || doc.consultantId !== prof.id) return fail("Documento non trovato.", 404);
      if (prof.status !== "pending") {
        return fail("I documenti si possono sostituire o eliminare solo mentre la domanda è in attesa di esame dello staff.", 409);
      }
      const allDocs = await db.consultantDoc.findMany({ where: { consultantId: prof.id }, select: { id: true, kind: true, sizeBytes: true } });

      const data: Record<string, unknown> = {};
      if (p.kind !== undefined) {
        if (!(DOC_KINDS as readonly string[]).includes(String(p.kind))) return fail("Tipo di documento non valido.", 400);
        data.kind = String(p.kind);
      }
      if (p.name !== undefined) {
        const n = String(p.name).trim().slice(0, 160);
        if (n) data.originalName = n;
      }
      if (p.data !== undefined && p.data !== "") {
        const name = String(p.name || doc.originalName);
        const chk = checkDocData(String(p.data), name);
        if (!chk.ok) return fail(chk.error, 400, { field: "docs" });
        const others = allDocs.filter(d => d.id !== doc.id).reduce((a, d) => a + d.sizeBytes, 0);
        if (others + chk.buf.length > MAX_TOTAL_DOC_BYTES) {
          return fail("Con questo file si supererebbero i 3 MB totali: rimuovi un documento o sostituisci un PDF con una foto.", 400, { field: "docs" });
        }
        data.data = toBytes(chk.buf);
        data.mimeType = chk.mime;
        data.sizeBytes = chk.buf.length;
      }
      if (!Object.keys(data).length) return fail("Nessuna modifica indicata.", 400);

      // la sostituzione non deve svuotare i tipi obbligatori
      const nextKinds = new Set(allDocs.map(d => d.id === doc.id ? String(data.kind || d.kind) : d.kind));
      if (!nextKinds.has("qualifica")) return fail("Deve restare almeno un documento di qualifica.", 400);
      if (!nextKinds.has("documento")) return fail("Deve restare almeno un documento d'identificazione.", 400);

      await db.consultantDoc.update({ where: { id: doc.id }, data });
      await auditLog({ actorId: user.id, actorRole: user.role, action: "consulente.doc-update", targetType: "consultantDoc", targetId: doc.id });
      return NextResponse.json({ ok: true, updated: true });
    }

    // ---- aggiunta di un documento nuovo ----
    if (!prof || prof.status !== "pending") {
      return fail("I documenti si possono sostituire o eliminare solo mentre la domanda è in attesa di esame dello staff.", 409);
    }
    const allDocs = await db.consultantDoc.findMany({ where: { consultantId: prof.id }, select: { id: true, kind: true, sizeBytes: true } });
    if (!p.data) return fail("Indica il file da caricare.", 400);
    if (allDocs.length >= MAX_FILES) return fail(`Hai già ${MAX_FILES} documenti: massimo ${MAX_FILES} in totale.`, 400);
    const kind = String(p.kind || "altro");
    if (!(DOC_KINDS as readonly string[]).includes(kind)) return fail("Tipo di documento non valido.", 400);
    const name = String(p.name || "documento").trim().slice(0, 160) || "documento";
    const chk = checkDocData(String(p.data), name);
    if (!chk.ok) return fail(chk.error, 400, { field: "docs" });
    const tot = allDocs.reduce((a, d) => a + d.sizeBytes, 0);
    if (tot + chk.buf.length > MAX_TOTAL_DOC_BYTES) {
      return fail("Con questo file si supererebbero i 3 MB totali: rimuovi un documento o sostituisci un PDF con una foto.", 400, { field: "docs" });
    }

    const doc = await db.consultantDoc.create({
      data: { consultantId: prof.id, kind, originalName: name, mimeType: chk.mime, sizeBytes: chk.buf.length, data: toBytes(chk.buf) },
    });
    await auditLog({ actorId: user.id, actorRole: user.role, action: "consulente.doc-add", targetType: "consultantDoc", targetId: doc.id });
    return NextResponse.json({ ok: true, added: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "consulente-docs", 60, 3600);
    const p = await readJson<{ docId?: string }>(req);

    const prof = await db.consultantProfile.findUnique({ where: { userId: user.id } });
    const doc = await db.consultantDoc.findUnique({ where: { id: String(p.docId || "") } });
    if (!doc || !prof || doc.consultantId !== prof.id) return fail("Documento non trovato.", 404);
    if (prof.status !== "pending") {
      return fail("I documenti si possono sostituire o eliminare solo mentre la domanda è in attesa di esame dello staff.", 409);
    }

    const remaining = await db.consultantDoc.findMany({ where: { consultantId: prof.id, id: { not: doc.id } }, select: { kind: true } });
    const kinds = new Set(remaining.map(d => d.kind));
    if (doc.kind === "qualifica" && !kinds.has("qualifica")) {
      return fail("È l'unico documento di qualifica: carica prima quello nuovo, poi rimuovi questo.");
    }
    if (doc.kind === "documento" && !kinds.has("documento")) {
      return fail("È l'unico documento d'identificazione: carica prima quello nuovo, poi rimuovi questo.");
    }

    await db.consultantDoc.delete({ where: { id: doc.id } });
    await auditLog({ actorId: user.id, actorRole: user.role, action: "consulente.doc-delete", targetType: "consultantDoc", targetId: doc.id });
    return NextResponse.json({ ok: true, deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
