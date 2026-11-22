// GET /api/consulente/photo/[id] — foto profilo del consulente (JPEG già
// ricompilato lato server senza metadati). Pubblica: è la foto della
// scheda professionale, visibile nel catalogo.
import { db } from "@/lib/db";
import { handleError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const prof = await db.consultantProfile.findUnique({ where: { id }, select: { photoData: true, status: true } });
    if (!prof || prof.status !== "approved" || !prof.photoData) {
      return new Response("Not found", { status: 404 });
    }
    const bytes = new Uint8Array(prof.photoData);
    return new Response(bytes, {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
