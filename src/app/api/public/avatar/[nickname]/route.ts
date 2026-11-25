// GET /api/public/avatar/[nickname] — foto profilo di un utente, GIÀ
// ricompilata lato server (JPEG, senza metadati EXIF/GPS, lato max 320 px).
// Pubblica per natura: compare sulle recensioni SOLO quando l'autore ha
// attivato il flag showIdentity, e nel menu del proprio account. La chiave
// è lo pseudonimo pubblico (mai l'id utente): nessuna enumerazione di
// identificativi interni. 404 se l'utente non ha una foto.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleError } from "@/lib/server/http";

export async function GET(_req: Request, ctx: { params: Promise<{ nickname: string }> }) {
  try {
    const { nickname } = await ctx.params;
    const nick = decodeURIComponent(nickname || "").trim();
    if (!nick || nick.length > 60) {
      return NextResponse.json({ ok: false, error: "Foto non trovata." }, { status: 404 });
    }
    const u = await db.user.findFirst({
      where: { nickname: nick, disabled: false },
      select: { avatarData: true },
    });
    if (!u || !u.avatarData) {
      return NextResponse.json({ ok: false, error: "Foto non trovata." }, { status: 404 });
    }
    const bytes = Buffer.from(u.avatarData);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        // pubblica per natura (nessun controllo per utente); la URL cambia
        // con lo pseudonimo, quindi la cache si aggiorna da sola al cambio nome
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
