// GET /api/admin/docs/[id] — download di un documento di verifica.
// Solo staff con permesso mod.experiences; file servito dall'area privata
// (db/uploads), mai esposta pubblicamente. Accesso tracciato.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/server/auth";
import { auditLog } from "@/lib/server/audit";
import { handleError, fail } from "@/lib/server/http";
import { readFile } from "fs/promises";
import path from "path";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff("mod.experiences");
    const { id } = await ctx.params;
    const doc = await db.verificationDoc.findUnique({ where: { id }, include: { experience: true } });
    if (!doc) return fail("Documento non trovato.", 404);
    if (doc.deletedAt) return fail("Documento già cancellato secondo la politica di conservazione.", 410);
    const filePath = path.join(process.cwd(), "db", "uploads", doc.storedName);
    const buf = await readFile(filePath);
    await auditLog({
      actorId: actor.id, actorRole: actor.role,
      action: "Documento di verifica consultato", targetType: "verification_doc", targetId: doc.id,
      reason: `Esperienza ${doc.experienceId}`,
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.originalName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
