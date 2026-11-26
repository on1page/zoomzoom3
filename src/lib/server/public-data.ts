// ZoomZoom — serializzazione dei dati pubblici (niente dati sensibili,
// niente email). Recensori anonimi DI DEFAULT: il nickname lascia il server
// solo se l'autore ha attivato il flag showIdentity per quella recensione.
import { db } from "@/lib/db";
import { getCategories } from "./categories";
import { statsForEntity, priceStatsForEntity } from "./score";

export type PublicReview = {
  id: string;
  userId: string; // per il filtro "le proprie recensioni restano sempre visibili" (mai serializzato al client)
  // nickname dell'autore: È PRESENTE SOLO se l'autore ha attivato il flag
  // showIdentity per questa recensione; altrimenti null e sulla recensione
  // compare la sola categoria (privacy by default). Mai serializzato al
  // client quando è nascosto: il nickname non lascia il server.
  author: string | null;
  authorCategory: string | null; // categoria d'appartenenza dichiarata (snapshot alla pubblicazione)
  showIdentity: boolean; // l'autore ha autorizzato nickname + foto profilo
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
  // trasparenza: la recensione ha generato giorni Premium per l'autore
  // (contributo incentivato, da etichettare in chiaro al pubblico)
  incentivized: boolean;
  // riconoscimenti di utilità attivi dell'autore (segnale di qualità, non
  // dato personale: si mostrano anche sulle recensioni anonime)
  authorBadges: string[];
};

export async function publicReviewsForEntity(entityId: string): Promise<PublicReview[]> {
  const now = new Date();
  const revs = await db.review.findMany({
    where: { entityId },
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          nickname: true,
          // solo i badge NON scaduti: la finestra mobile li spegne da sola
          utilityBadges: { where: { expiresAt: { gt: now } }, select: { code: true } },
        },
      },
      criteriaVersion: true,
      // etichetta di trasparenza: grant Premium generato da questo contributo
      premiumGrant: { select: { revokedAt: true } },
    },
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
      // il nickname esce dal server solo con il consenso esplicito per recensione
      author: r.showIdentity ? r.user.nickname : null,
      authorCategory: r.authorCategory,
      showIdentity: r.showIdentity,
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
      incentivized: !!r.premiumGrant && !r.premiumGrant.revokedAt,
      authorBadges: r.user.utilityBadges.map(b => b.code),
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
