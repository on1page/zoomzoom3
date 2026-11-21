// GET /api/public/photo/[id] — serve una foto di recensione GIÀ ricompilata
// (JPEG, senza metadati EXIF/GPS). Il controllo di accesso è per utente e
// per singola richiesta, lato server: Premium attivo, staff, autore della
// recensione oppure contributo fotografico proprio (almeno una foto in una
// propria recensione pubblicata). Chi non ha titolo riceve 403: i byte
// delle foto riservate non lasciano mai il server.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { premiumStateOf } from "@/lib/server/premium";
import { handleError } from "@/lib/server/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [settings, user] = await Promise.all([getSettings(), getCurrentUser()]);
    if (!settings.photosEnabled) {
      return NextResponse.json({ ok: false, error: "Funzione non disponibile." }, { status: 403 });
    }
    const photo = await db.reviewPhoto.findUnique({
      where: { id },
      select: { id: true, data: true, reviewId: true, review: { select: { userId: true, status: true } } },
    });
    if (!photo || photo.review.status !== "published") {
      return NextResponse.json({ ok: false, error: "Foto non trovata." }, { status: 404 });
    }

    let allowed = false;
    if (user) {
      if (["moderator", "admin", "superadmin"].includes(user.role)) allowed = true;
      else if (photo.review.userId === user.id) allowed = true; // le proprie foto restano sempre visibili
      else if (premiumStateOf(user).active) allowed = true;
      else {
        const own = await db.reviewPhoto.findFirst({
          where: { review: { userId: user.id, status: "published" } },
          select: { id: true },
        });
        allowed = !!own;
      }
    }
    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: "Le foto delle recensioni sono riservate: si sbloccano con la Membership Premium oppure allegando una foto a una tua recensione." },
        { status: 403 },
      );
    }

    const bytes = Buffer.from(photo.data);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        // riservate per utente: mai cache condivisa (proxy/CDN pubblici)
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
