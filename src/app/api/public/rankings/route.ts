// GET /api/public/rankings?cat=&zona= — classifiche per categoria e zona.
// Espone anche i parametri del metodo (m, C) per trasparenza completa.
import { NextRequest, NextResponse } from "next/server";
import { getCategories } from "@/lib/server/categories";
import { rankingFor } from "@/lib/server/score";
import { getSettings } from "@/lib/server/settings";
import { handleError } from "@/lib/server/http";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const catId = sp.get("cat") || "";
    const zoneId = sp.get("zona") || "";
    const categories = await getCategories();
    const settings = await getSettings();

    const targets = catId ? categories.filter(c => c.id === catId) : categories;
    const result: Record<string, unknown>[] = [];
    for (const c of targets) {
      const { rows, prior, m } = await rankingFor(c.id, zoneId ? { zoneId } : {});
      const withData = rows.filter(x => x.n > 0);
      result.push({
        category: { id: c.id, name: c.name, shortName: c.shortName, hexColor: c.hexColor },
        rows: withData.map(x => ({
          entityId: x.entityId, name: x.name, subtitle: x.subtitle, zoneId: x.zoneId,
          isDemo: x.isDemo, verifiedBusiness: x.verifiedBusiness,
          n: x.n,
          mean: x.mean == null ? null : Math.round(x.mean * 10) / 10,
          weighted: x.weighted == null ? null : Math.round(x.weighted * 100) / 100,
          sufficient: x.sufficient,
        })),
        method: { m, prior: Math.round(prior * 100) / 100 },
      });
    }
    return NextResponse.json({ ok: true, sections: result, minReviews: settings.minReviews });
  } catch (e) {
    return handleError(e);
  }
}
