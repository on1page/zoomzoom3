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

// Indagine professionale certificata collegata alla scheda (chiusura del
// cerchio, K7: la relazione consegnata crea o aggiorna la scheda). Nessun dato
// del richiedente, nessun testo integrale: solo il fatto certificato, il
// consulente e l'eventuale sintesi pubblica che ha scelto di pubblicare.
export type CertifiedIndagine = {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  deliveredAt: string;
  consultantName: string;
  consultantProfession: string;
};

export async function certifiedIndagineForEntity(entityId: string): Promise<CertifiedIndagine | null> {
  const r = await db.periziaRequest.findFirst({
    where: { entityId, status: { in: ["delivered", "closed"] } },
    orderBy: { deliveredAt: "desc" },
    include: { consultant: true },
  });
  if (!r || !r.consultant) return null;
  return {
    id: r.id,
    kind: r.kind,
    title: r.reportTitle || r.kind,
    summary: r.publicSummary || null,
    deliveredAt: (r.deliveredAt ?? r.updatedAt).toISOString(),
    consultantName: `${r.consultant.firstName} ${r.consultant.lastName}`,
    consultantProfession: r.consultant.profession,
  };
}

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

/* ---------- collegamenti tra schede (raggruppare schede) ---------- */

// scheda collegata, con i suoi aggregati pubblici (medie e conteggi restano
// sempre pubblici: i testi integrali restano alle regole Premium)
export type PublicEntityLink = {
  id: string;
  name: string;
  mean: number | null;
  n: number;
};

// Collegamenti di una scheda: per un immobile, chi lo amministra; per un
// amministratore, i condomini che amministra. Solo schede pubblicate (se
// la moderazione nasconde una scheda, il suo collegamento non appare).
export async function entityLinksForEntity(entityId: string, minReviews: number): Promise<{
  administrator: PublicEntityLink | null;
  buildings: PublicEntityLink[];
}> {
  const [outgoing, incoming] = await Promise.all([
    db.entityLink.findMany({
      where: { fromEntityId: entityId, kind: "amministra" },
      include: { toEntity: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    db.entityLink.findMany({
      where: { toEntityId: entityId, kind: "amministra" },
      include: { fromEntity: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
  ]);
  const withStats = async (e: { id: string; name: string }): Promise<PublicEntityLink> => {
    const st = await statsForEntity(e.id, minReviews);
    return { id: e.id, name: e.name, mean: st.mean, n: st.n };
  };
  // l'amministratore del condominio: il più recente se più di uno è stato
  // dichiarato (il turnover esiste: la scheda mostra l'ultimo in carica, lo
  // storico resta nel back office)
  const admins = outgoing
    .map(l => l.toEntity)
    .filter(e => e && e.status === "published");
  const administrator = admins.length ? await withStats(admins[admins.length - 1]) : null;
  const buildings = await Promise.all(
    incoming.map(l => l.fromEntity).filter(e => e && e.status === "published").map(withStats),
  );
  return { administrator, buildings };
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
