// POST /api/disputes — contestazione dell'associazione di una scheda.
// Aperta anche ai non registrati (persona interessata): nessuna rimozione
// automatica, decisione umana tracciata.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { validateEmail } from "@/lib/server/validation";

export async function POST(req: Request) {
  try {
    guard(req, "dispute", 5, 3600);
    const p = await readJson<{ entityId?: string; email?: string; claim?: string; hp?: string }>(req);
    if (String(p.hp || "").trim()) return fail("Richiesta rifiutata.", 400);
    if (!validateEmail(p.email)) return fail("Indirizzo email non valido.");
    if (String(p.claim || "").trim().length < 30) return fail("Descrivi la contestazione con almeno 30 caratteri.");
    const ent = await db.entity.findUnique({ where: { id: String(p.entityId || "") } });
    if (!ent) return fail("Scheda non trovata.", 404);
    await db.dispute.create({
      data: {
        entityId: ent.id, claimantEmail: String(p.email).toLowerCase(),
        claim: String(p.claim).trim(), status: "received", isDemo: ent.isDemo,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
