// GET /api/public/nearby?lat=…&lng=…&zona=… — contributo semplificato (C6):
// prima di creare una nuova scheda immobile, il client chiede se esistono
// già schede pubbliche CON POSIZIONE entro 50 metri dello stesso punto.
// Così "Via dei Mille 15" e "Via dei Mille 15/A", o un pin leggermente
// spostato, non generano doppioni: all'utente si propone il riuso.
// Solo dati pubblici (gli immobili con posizione sono già punti della
// mappa pubblica): id, nome, indirizzo, zona e distanza in metri.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { distanceKm } from "@/lib/server/zones";
import { handleError } from "@/lib/server/http";

const RADIUS_M = 50;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const lat = Number(sp.get("lat")), lng = Number(sp.get("lng"));
    const zoneId = sp.get("zona") || "";
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ ok: false, error: "Coordinate non valide." }, { status: 400 });
    }

    const ents = await db.entity.findMany({
      where: {
        categoryId: "immobile",
        status: "published",
        geoLat: { not: null },
        geoLng: { not: null },
        ...(zoneId ? { zoneId } : {}),
      },
      select: { id: true, name: true, address: true, zoneId: true, geoLat: true, geoLng: true },
    });

    const rows = ents
      .map(e => ({
        id: e.id,
        name: e.name,
        address: e.address,
        zoneId: e.zoneId,
        distM: Math.round(distanceKm({ lat, lng }, { lat: e.geoLat!, lng: e.geoLng! }) * 1000),
      }))
      .filter(r => r.distM <= RADIUS_M)
      .sort((a, b) => a.distM - b.distM)
      .slice(0, 5);

    return NextResponse.json({ ok: true, rows, radiusM: RADIUS_M });
  } catch (e) {
    return handleError(e);
  }
}
