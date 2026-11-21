// ZoomZoom — statistiche, medie e classifiche (formula PC = (n·M + m·C)/(n+m)).
// Calcolo server-side: il client riceve solo i risultati e i parametri usati.
import { db } from "@/lib/db";
import { getCategories } from "./categories";
import { getSettings } from "./settings";

export type EntityStats = {
  n: number;
  mean: number | null;
  crit: Record<string, number | null>;
  sufficient: boolean;
};

export type PriceStats = {
  unit: string; min: number; max: number; median: number; n: number;
} | null;

export async function statsForEntity(entityId: string, minReviews: number): Promise<EntityStats> {
  const revs = await db.review.findMany({ where: { entityId, status: "published" } });
  const cats = await getCategories();
  const ent = await db.entity.findUnique({ where: { id: entityId } });
  const cat = cats.find(c => c.id === ent?.categoryId);
  const n = revs.length;
  const mean = n ? revs.reduce((s, r) => s + r.score, 0) / n : null;
  const crit: Record<string, number | null> = {};
  if (cat) {
    for (const c of cat.criteria) {
      const vals = revs
        .map(r => (JSON.parse(r.criteriaJson) as Record<string, number>)[c.key])
        .filter((v): v is number => typeof v === "number");
      crit[c.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
  }
  return { n, mean, crit, sufficient: n >= minReviews };
}

/** Statistiche prezzi dichiarati: solo sull'unità più ricorrente (mai aggregare unità diverse). */
export async function priceStatsForEntity(entityId: string): Promise<PriceStats> {
  const revs = await db.review.findMany({
    where: { entityId, status: "published", priceAmount: { not: null } },
  });
  const rows = revs
    .filter(r => r.priceAmount && r.priceUnit)
    .map(r => ({ amount: r.priceAmount!, unit: r.priceUnit! }));
  if (!rows.length) return null;
  const byUnit = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byUnit.get(r.unit) || [];
    arr.push(r.amount);
    byUnit.set(r.unit, arr);
  }
  let unit = "", arr: number[] = [];
  for (const [u, a] of byUnit) if (!arr.length || a.length > arr.length) { unit = u; arr = a; }
  arr.sort((a, b) => a - b);
  const median = arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2;
  return { unit, min: arr[0], max: arr[arr.length - 1], median, n: arr.length };
}

/** Media C della categoria: media delle medie delle schede pubblicate con recensioni. */
export async function categoryPrior(catId: string, minReviews: number): Promise<number> {
  const ents = await db.entity.findMany({ where: { categoryId: catId, status: "published" }, select: { id: true } });
  const means: number[] = [];
  for (const e of ents) {
    const st = await statsForEntity(e.id, minReviews);
    if (st.mean != null) means.push(st.mean);
  }
  return means.length ? means.reduce((a, b) => a + b, 0) / means.length : 6.0;
}

export type RankingRow = {
  entityId: string; name: string; subtitle: string | null; address: string | null;
  zoneId: string | null; categoryId: string; initialsOnly: boolean; verifiedBusiness: boolean; isDemo: boolean;
  n: number; mean: number | null; weighted: number | null; sufficient: boolean;
};

/** Punteggio di classifica: media ponderata alla Bayes. */
export function weightedScore(n: number, mean: number | null, prior: number, m: number): number | null {
  if (n === 0 || mean == null) return null;
  return (n * mean + m * prior) / (n + m);
}

export async function rankingFor(catId: string, opts: { zoneId?: string } = {}): Promise<{ rows: RankingRow[]; prior: number; m: number }> {
  const settings = await getSettings();
  const m = settings.minReviews;
  const prior = await categoryPrior(catId, m);
  const ents = await db.entity.findMany({
    where: { categoryId: catId, status: "published", ...(opts.zoneId ? { zoneId: opts.zoneId } : {}) },
  });
  const rows: RankingRow[] = [];
  for (const e of ents) {
    const st = await statsForEntity(e.id, m);
    if (st.n === 0) {
      rows.push({
        entityId: e.id, name: e.name, subtitle: e.subtitle, address: e.address, zoneId: e.zoneId,
        categoryId: e.categoryId, initialsOnly: e.initialsOnly, verifiedBusiness: e.verifiedBusiness, isDemo: e.isDemo,
        n: 0, mean: null, weighted: null, sufficient: false,
      });
      continue;
    }
    rows.push({
      entityId: e.id, name: e.name, subtitle: e.subtitle, address: e.address, zoneId: e.zoneId,
      categoryId: e.categoryId, initialsOnly: e.initialsOnly, verifiedBusiness: e.verifiedBusiness, isDemo: e.isDemo,
      n: st.n, mean: st.mean, weighted: weightedScore(st.n, st.mean, prior, m), sufficient: st.sufficient,
    });
  }
  // prima le schede con dati sufficienti, poi punteggio ponderato
  rows.sort((a, b) => {
    if (!!a.sufficient !== !!b.sufficient) return a.sufficient ? -1 : 1;
    return (b.weighted ?? -1) - (a.weighted ?? -1);
  });
  return { rows, prior, m };
}
