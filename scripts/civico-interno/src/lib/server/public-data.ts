// ZoomZoom — serializzazione dei dati pubblici (niente dati sensibili,
// niente email, niente identificativi di recensori oltre lo pseudonimo).
import { db } from "@/lib/db";
import { getCategories } from "./categories";
import { statsForEntity, priceStatsForEntity } from "./score";

export type PublicReview = {
  id: string;
  userId: string; // per il filtro "le proprie recensioni restano sempre visibili" (mai serializzato al client)
  author: string; // solo pseudonimo
  score: number;
  criteria: Record<string, number>;
  criteriaLabels: Record<string, string> | null; // etichette dello snapshot d'epoca
  pros: string[];
  cons: string[];
  price: { amount: number; unit: string; kind: string } | null;
  text: string;
  status: string;
  hiddenReason: string | null;
  verified: boolean;
  createdAt: string;
  updatedAt: string | null;
  updateReason: string | null;
  isDemo: boolean;
};

export async function publicReviewsForEntity(entityId: string): Promise<PublicReview[]> {
  const revs = await db.review.findMany({
    where: { entityId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { nickname: true } }, criteriaVersion: true },
  });
  return revs.map(r => {
    let labels: Record<string, string> | null = null;
    if (r.criteriaVersion) {
      try {
        labels = Object.fromEntries((JSON.parse(r.criteriaVersion.criteriaSnapshot) as { key: string; label: string }[]).map(c => [c.key, c.label]));
      } catch { labels = null; }
    }
    return {
      id: r.id,
      userId: r.userId,
      author: r.user.nickname,
      score: r.score,
      criteria: JSON.parse(r.criteriaJson) as Record<string, number>,
      criteriaLabels: labels,
      pros: JSON.parse(r.prosJson) as string[],
      cons: JSON.parse(r.consJson) as string[],
      price: r.priceAmount != null ? { amount: r.priceAmount, unit: r.priceUnit || "", kind: r.priceKind || "" } : null,
      text: r.text,
      status: r.status,
      hiddenReason: r.hiddenReason,
      verified: r.verified,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt?.toISOString() || null,
      updateReason: r.updateReason,
      isDemo: r.isDemo,
    };
  });
}

export type PublicEntity = {
  id: string; categoryId: string; name: string; subtitle: string | null;
  address: string | null; streetNumber: string | null; unit: string | null;
  zoneId: string | null; geo: { lat: number; lng: number } | null;
  initialsOnly: boolean; verifiedBusiness: boolean; isDemo: boolean;
  stats: { n: number; mean: number | null; crit: Record<string, number | null>; sufficient: boolean };
  priceStats: { unit: string; min: number; max: number; median: number; n: number } | null;
};

export async function publicEntity(entityId: string, minReviews: number): Promise<PublicEntity | null> {
  const e = await db.entity.findUnique({ where: { id: entityId } });
  if (!e || e.status !== "published") return null;
  const stats = await statsForEntity(e.id, minReviews);
  const ps = await priceStatsForEntity(e.id);
  return {
    id: e.id, categoryId: e.categoryId, name: e.name, subtitle: e.subtitle,
    address: e.address, streetNumber: e.streetNumber, unit: e.unit, zoneId: e.zoneId,
    geo: e.geoLat != null && e.geoLng != null ? { lat: e.geoLat, lng: e.geoLng } : null,
    initialsOnly: e.initialsOnly, verifiedBusiness: e.verifiedBusiness, isDemo: e.isDemo,
    stats: { n: stats.n, mean: stats.mean, crit: stats.crit, sufficient: stats.sufficient },
    priceStats: ps,
  };
}

export async function publicZones() {
  return db.zone.findMany({ orderBy: { name: "asc" } });
}

// Metadati delle foto di ogni recensione di un'entità (mai i byte: le
// immagini si servono da /api/public/photo/[id] con controllo di accesso).
export type PublicPhotoMeta = { id: string; width: number; height: number };

export async function photoMetaForEntity(entityId: string): Promise<Map<string, PublicPhotoMeta[]>> {
  const photos = await db.reviewPhoto.findMany({
    where: { review: { entityId, status: "published" } },
    select: { id: true, reviewId: true, width: true, height: true },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, PublicPhotoMeta[]>();
  for (const p of photos) {
    const arr = map.get(p.reviewId) || [];
    arr.push({ id: p.id, width: p.width, height: p.height });
    map.set(p.reviewId, arr);
  }
  return map;
}

export async function publicCategoriesPayload() {
  const cats = await getCategories();
  return cats.map(c => ({
    id: c.id, name: c.name, shortName: c.shortName, description: c.description,
    hexColor: c.hexColor, icon: c.icon, isPerson: c.isPerson, isMapped: c.isMapped,
    criteria: c.criteria, experienceKinds: c.experienceKinds, priceUnits: c.priceUnits,
  }));
}
