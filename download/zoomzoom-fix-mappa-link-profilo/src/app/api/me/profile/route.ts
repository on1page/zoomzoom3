// POST /api/me/profile — identità pubblica dell'account: foto profilo e
// categoria di appartenenza. La foto è facoltativa e viene ricompilata lato
// server (senza EXIF/GPS). Cambiando categoria: se l'utente dichiara per la
// prima volta una categoria di appartenenza, la scheda ad hoc viene creata
// e attivata; se ne ha già una, quella resta (cronologia e recensioni
// restano al loro posto). Le recensioni già pubblicate conservano lo
// snapshot della categoria di allora: nessuna riscrittura del passato.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { compileAvatar, ensureSubjectSheet, validSubjectCategory } from "@/lib/server/user-identity";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { auditLog } from "@/lib/server/audit";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "profile", 15, 3600);
    const p = await readJson<{
      avatar?: string | null; // data URL | null (null = rimuovi)
      categoryId?: string | null; // slug categoria | "" (utente semplice)
      sheetName?: string;
    }>(req);

    const data: { avatarData?: Uint8Array<ArrayBuffer> | null; categoryId?: string | null } = {};
    let sheet: { entityId: string; created: boolean; name: string } | null = null;

    // --- foto profilo ---
    if ("avatar" in p) {
      if (p.avatar === null || p.avatar === "") {
        data.avatarData = null; // rimozione esplicita
      } else {
        const compiled = await compileAvatar(p.avatar);
        if (!compiled) return fail("La foto non è valida: JPEG, PNG o WebP, massimo 1,5 MB.");
        data.avatarData = compiled;
      }
    }

    // --- categoria di appartenenza ---
    if ("categoryId" in p) {
      const cat = await validSubjectCategory(p.categoryId);
      if (String(p.categoryId || "") && !cat) {
        return fail("Categoria non valida.");
      }
      const sheetName = String(p.sheetName || "").trim();
      if (cat && !cat.isPerson && sheetName && (sheetName.length < 3 || sheetName.length > 80)) {
        return fail("Il nome della scheda deve avere tra 3 e 80 caratteri.");
      }
      const next = cat?.id ?? null;
      // nuova dichiarazione di categoria: nasce (o esiste già) la scheda ad hoc
      if (cat && next !== user.categoryId) {
        sheet = await ensureSubjectSheet(user.id, user.nickname, cat, sheetName);
      }
      data.categoryId = next;
    }

    if (!Object.keys(data).length) return fail("Niente da aggiornare.");

    await db.user.update({ where: { id: user.id }, data });
    await auditLog({
      actorId: user.id, actorRole: user.role,
      action: "Identità pubblica aggiornata (profilo)"
        + ("avatarData" in data ? " · foto profilo" : "")
        + ("categoryId" in data ? ` · categoria: ${data.categoryId || "utente semplice"}` : ""),
      targetType: "user", targetId: user.id,
      reason: "Modifica volontaria dall'area personale.",
      isDemo: user.isDemo,
    });

    const fresh = await db.user.findUnique({
      where: { id: user.id },
      select: { categoryId: true, avatarData: true, subjectEntityId: true },
    });
    return NextResponse.json({
      ok: true,
      categoryId: fresh?.categoryId ?? null,
      hasAvatar: !!fresh?.avatarData,
      subjectEntityId: fresh?.subjectEntityId ?? null,
      sheet: sheet ? { name: sheet.name, created: sheet.created } : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
