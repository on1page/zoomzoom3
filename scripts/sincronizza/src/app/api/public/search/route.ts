// GET /api/public/search — ricerca pubblica con filtri chiari e
// ordinamento trasparente. Solo dati pubblici, niente email o autori.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCategories } from "@/lib/server/categories";
import { getSettings } from "@/lib/server/settings";
import { categoryPrior, weightedScore } from "@/lib/server/score";
import { statsForEntity } from "@/lib/server/score";
import { handleError } from "@/lib/server/http";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().toLowerCase();
    const cats = sp.get("cat") ? sp.get("cat")!.split(",").filter(Boolean) : [];
    const zone = sp.get("zona") || "";
    const suff = sp.get("suff") === "1";
    const ord = sp.get("ord") || "rilevanza";
    const pmin = sp.get("pmin") ? Number(sp.get("pmin")) : null;
    const pmax = sp.get("pmax") ? Number(sp.get("pmax")) : null;
    const punit = sp.get("punit") || "";

    const settings = await getSettings();
    const categories = await getCategories();
    const validCats = cats.filter(c => categories.some(x => x.id === c));

    let where: Record<string, unknown> = { status: "published", NOT: { categoryId: "zona" } };
    if (validCats.length) where = { ...where, categoryId: { in: validCats } };
    if (zone) where = { ...where, zoneId: zone };

    let ents = await db.entity.findMany({ where });

    if (q) {
      ents = ents.filter(e =>
        `${e.name} ${e.address || ""} ${e.subtitle || ""}`.toLowerCase().includes(q)
      );
    }

    if (pmin != null || pmax != null || punit) {
      const matching = await db.review.findMany({
        where: { status: "published", priceAmount: { not: null } },
        select: { entityId: true, priceAmount: true, priceUnit: true },
      });
      const okEntities = new Set(
        matching
          .filter(r =>
            r.priceAmount! > 0 &&
            (!punit || r.priceUnit === punit) &&
            (pmin == null || r.priceAmount! >= pmin) &&
            (pmax == null || r.priceAmount! <= pmax))
          .map(r => r.entityId)
      );
      ents = ents.filter(e => okEntities.has(e.id));
    }

    const priorCache = new Map<string, number>();
    let rows = await Promise.all(ents.map(async e => {
      const st = await statsForEntity(e.id, settings.minReviews);
      if (!priorCache.has(e.categoryId)) priorCache.set(e.categoryId, await categoryPrior(e.categoryId, settings.minReviews));
      return {
        entity: {
          id: e.id, categoryId: e.categoryId, name: e.name, subtitle: e.subtitle,
          address: e.address, zoneId: e.zoneId, initialsOnly: e.initialsOnly,
          verifiedBusiness: e.verifiedBusiness, isDemo: e.isDemo,
        },
        n: st.n, mean: st.mean,
        weighted: weightedScore(st.n, st.mean, priorCache.get(e.categoryId)!, settings.minReviews),
        sufficient: st.sufficient,
      };
    }));

    if (suff) rows = rows.filter(x => x.sufficient && x.n > 0);

    const cmp: Record<string, (a: typeof rows[0], b: typeof rows[0]) => number> = {
      rilevanza: (a, b) => (b.weighted ?? -1) - (a.weighted ?? -1),
      punteggio: (a, b) => (b.mean ?? -1) - (a.mean ?? -1),
      recensioni: (a, b) => b.n - a.n,
      nome: (a, b) => a.entity.name.localeCompare(b.entity.name, "it"),
    };
    rows.sort((a, b) => {
      const d = (cmp[ord] || cmp.rilevanza)(a, b);
      return d !== 0 ? d : b.n - a.n;
    });

    return NextResponse.json({
      ok: true,
      rows: rows.map(x => ({ ...x, mean: x.mean == null ? null : Math.round(x.mean * 10) / 10, weighted: x.weighted == null ? null : Math.round(x.weighted * 100) / 100 })),
      count: rows.length,
      method: { minReviews: settings.minReviews },
    });
  } catch (e) {
    return handleError(e);
  }
}
