// POST /api/consent — registrazione del consenso cookie granulare.
// La navigazione o la chiusura del banner NON costituiscono consenso:
// il registro si compila solo su scelta esplicita.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureVisitorId, getCurrentUser } from "@/lib/server/auth";
import { guard, readJson, handleError } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    guard(req, "consent", 30, 3600);
    const p = await readJson<{ statistics?: boolean; marketing?: boolean }>(req);
    const visitorId = await ensureVisitorId();
    const user = await getCurrentUser();
    const existing = await db.consent.findFirst({ where: { visitorId }, orderBy: { updatedAt: "desc" } });
    const data = {
      visitorId, userId: user?.id || null,
      technical: true, statistics: !!p.statistics, marketing: !!p.marketing,
    };
    if (existing) {
      await db.consent.update({ where: { id: existing.id }, data });
    } else {
      await db.consent.create({ data });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
