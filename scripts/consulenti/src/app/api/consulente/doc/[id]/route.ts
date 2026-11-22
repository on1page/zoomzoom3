// GET /api/consulente/doc/[id] — documento caricato dal consulente per
// l'iscrizione (qualifica, esperienza, identificazione). MAI pubblico:
// vi accedono solo il consulente stesso (sessione pubblica) e lo staff
// (anche con la sessione del back office), con il nome file originale
// nell'intestazione della risposta.
import { db } from "@/lib/db";
import { getCurrentUser, getCurrentAdmin } from "@/lib/server/auth";
import { fail, handleError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    // staff: la sessione amministrativa del back office vale quanto la
    // pubblica (il back office elenca e scarica i documenti)
    const admin = user ? null : await getCurrentAdmin();
    const me = user ?? admin;
    if (!me) return fail("Autenticazione necessaria.", 401);

    const doc = await db.consultantDoc.findUnique({
      where: { id },
      include: { consultant: { select: { userId: true } } },
    });
    if (!doc) return fail("Documento non trovato.", 404);

    const isStaff = ["moderator", "admin", "superadmin"].includes(me.role);
    if (doc.consultant.userId !== me.id && !isStaff) {
      return fail("Permesso negato.", 403);
    }

    const safeName = doc.originalName.replace(/[^\w.\-() ]/g, "_");
    return new Response(new Uint8Array(doc.data), {
      headers: {
        "content-type": doc.mimeType || "application/octet-stream",
        "content-disposition": `attachment; filename="${safeName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
