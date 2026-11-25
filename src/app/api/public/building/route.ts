// GET /api/public/building?zona=&via=&civico= — contributo semplificato:
// PRIMA di creare una nuova scheda immobile, il client chiede se allo STESSO
// indirizzo (via + civico, stessa città) esistono già schede pubbliche, a
// prescindere dall'interno. In un condominio ogni unità ha la sua scheda:
// chi vuole recensire "Via dei Mille 15, interno 4" vede subito le schede
// già scritte per lo stesso 15 ("interno 4", "scala B", l'edificio intero)
// e può riusarle invece di crearne una doppia.
// Solo dati pubblici (le schede sono già nel catalogo): id, nome, indirizzo
// e interno. Nessuna posizione richiesta: funziona anche senza pin.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleError } from "@/lib/server/http";
import { normAddress, normUnit, sameBuilding, dispAddress } from "@/lib/address-norm";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const zoneId = (sp.get("zona") || "").trim();
    const via = (sp.get("via") || "").trim().slice(0, 120);
    const civico = (sp.get("civico") || "").trim().slice(0, 10);
    if (!zoneId || via.length < 3) {
      return NextResponse.json({ ok: true, rows: [] });
    }
    const zone = await db.zone.findUnique({ where: { id: zoneId } });
    if (!zone) return NextResponse.json({ ok: true, rows: [] });

    const target = {
      street: via,
      civico,
      fullNorm: normAddress([via, civico].filter(Boolean).join(" ")),
      zoneNorm: normAddress(zone.name),
    };
    const ents = await db.entity.findMany({
      where: { zoneId: zone.id, categoryId: "immobile", status: "published" },
      select: { id: true, name: true, address: true, streetNumber: true, unit: true },
    });

    const rows = ents
      .filter(e => sameBuilding(e, target))
      .map(e => ({
        id: e.id,
        name: e.name,
        address: dispAddress(e.address, e.streetNumber),
        unit: e.unit,
        unitNorm: normUnit(e.unit || ""),
      }))
      // prima la scheda dell'edificio (senza interno), poi le unità in ordine
      .sort((a, b) => a.unitNorm.localeCompare(b.unitNorm, "it"))
      .slice(0, 8);

    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return handleError(e);
  }
}
