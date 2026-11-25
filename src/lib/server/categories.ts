// ZoomZoom — categorie e criteri dal database, con cache breve.
// Le categorie sono configurabili dal back office; le recensioni conservano
// lo snapshot dei criteri (CategoryVersion) usato al momento della pubblicazione.
import { db } from "@/lib/db";

export type CriterionDef = { key: string; label: string };
export type CategoryDef = {
  id: string; name: string; shortName: string; description: string;
  hexColor: string; icon: string; isPerson: boolean; isMapped: boolean;
  criteria: CriterionDef[];
  experienceKinds: string[];
  priceUnits: string[];
};

// I tipi di esperienza e le unità di prezzo sono impostazioni di categoria:
// valori iniziali fedeli al prototipo, modificabili da back office.
export const DEFAULT_EXP_KINDS: Record<string, string[]> = {
  immobile: ["Abitazione in affitto", "Abitazione di proprietà", "Soggiorno prolungato", "Visita e sopralluogo"],
  zona: ["Residenza attuale (oltre 6 mesi)", "Residenza precedente", "Lavoro o studio quotidiano nella zona"],
  consulente: ["Perizia tecnica commissionata", "Valutazione immobiliare richiesta", "Consulenza tecnica ricevuta", "Altro servizio tecnico"],
  proprietario: ["Contratto di affitto in corso", "Contratto di affitto cessato", "Interazioni da richiedente"],
  affittuario: ["Affitto del mio immobile", "Affitto cessato di recente", "Interazione da coobbligato/garante"],
  amministratore: ["Condominio in cui abito", "Condominio di proprietà affittata", "Assemblea e gestione economica"],
  agenzia: ["Servizio di intermediazione ricevuto", "Valutazione o consulenza su un immobile", "Assistenza dopo il servizio"],
  ditta: ["Intervento di manutenzione", "Lavori e lavori o ristrutturazione", "Perizia o consulenza tecnica", "Impianti e installazioni"],
};

export const DEFAULT_PRICE_UNITS: Record<string, string[]> = {
  immobile: ["€/mese", "€ totale"],
  consulente: ["€ totale"],
  proprietario: ["€/mese"],
  amministratore: ["€/anno"],
  agenzia: ["€ totale"],
  ditta: ["€ totale"],
};

export const PRICE_KINDS = ["Richiesto", "Proposto/offerta", "Concluso/pagato"] as const;

const CAT_SEED: Array<Omit<CategoryDef, "criteria" | "experienceKinds" | "priceUnits"> & { criteria: CriterionDef[] }> = [
  {
    id: "immobile", name: "Immobili e indirizzi", shortName: "Immobili", hexColor: "#33658A", icon: "immobile",
    description: "Appartamenti, case e singoli indirizzi: stato reale, gestione e vivibilità, raccontati da chi ci ha vissuto.",
    isPerson: false, isMapped: true,
    criteria: [
      { key: "stato", label: "Stato di manutenzione" },
      { key: "descrizione", label: "Corrispondenza con la descrizione ricevuta" },
      { key: "spazi", label: "Qualità degli spazi e luce naturale" },
      { key: "rumori", label: "Rumori e rapporti di vicinato" },
      { key: "impianti", label: "Impianti, riscaldamento ed efficienza" },
      { key: "rapporto", label: "Rapporto qualità-prezzo" },
    ],
  },
  {
    id: "zona", name: "Zone e aree geografiche", shortName: "Zone", hexColor: "#4E7D5B", icon: "zona",
    description: "Città e zone del territorio italiano: servizi, trasporti, sicurezza percepita e qualità della vita quotidiana.",
    isPerson: false, isMapped: true,
    criteria: [
      { key: "servizi", label: "Servizi alla persona e vivibilità" },
      { key: "trasporti", label: "Trasporti e mobilità" },
      { key: "sicurezza", label: "Sicurezza percepita" },
      { key: "verde", label: "Verde, aria e ambiente" },
      { key: "costi", label: "Costi della vita nella zona" },
    ],
  },
  {
    id: "proprietario", name: "Proprietari", shortName: "Proprietari", hexColor: "#6E5E93", icon: "proprietario",
    description: "Il rapporto con chi affitta o gestisce un immobile: contratto, trasparenza, manutenzione e rispetto.",
    isPerson: true, isMapped: false,
    criteria: [
      { key: "contratto", label: "Chiarezza del contratto e trasparenza" },
      { key: "risposta", label: "Disponibilità e tempi di risposta" },
      { key: "manutenzione", label: "Gestione di guasti e manutenzione" },
      { key: "deposito", label: "Correttezza sul deposito cauzionale" },
      { key: "privacy", label: "Rispetto della privacy e degli spazi" },
      { key: "rapporto", label: "Rapporto qualità-prezzo" },
    ],
  },
  {
    id: "affittuario", name: "Affittuari", shortName: "Affittuari", hexColor: "#8B4E67", icon: "affittuario",
    description: "Il rapporto con chi vive in un immobile in affitto: pagamenti, cura degli spazi e comunicazione.",
    isPerson: true, isMapped: false,
    criteria: [
      { key: "pagamenti", label: "Puntualità e correttezza dei pagamenti" },
      { key: "cura", label: "Cura e pulizia dell'immobile" },
      { key: "comunicazione", label: "Comunicazione e segnalazione dei problemi" },
      { key: "regole", label: "Rispetto di regole del condominio e dei vicini" },
      { key: "documenti", label: "Correttezza documentale e comunicazioni obbligatorie" },
    ],
  },
  {
    id: "amministratore", name: "Amministratori di condominio", shortName: "Amministratori", hexColor: "#27696F", icon: "amministratore",
    description: "Gestione dei condomini: conti, trasparenza, parti comuni, assemblee e tempestività degli interventi.",
    isPerson: false, isMapped: false,
    criteria: [
      { key: "conti", label: "Gestione economica e trasparenza dei conti" },
      { key: "comunicazione", label: "Comunicazione con i condomini" },
      { key: "comuni", label: "Manutenzione delle parti comuni" },
      { key: "assemblee", label: "Convocazione e conduzione delle assemblee" },
      { key: "competenza", label: "Tempestività e competenza tecnica" },
      { key: "rapporto", label: "Rapporto qualità-prezzo (compenso)" },
    ],
  },
  {
    id: "agenzia", name: "Agenzie immobiliari", shortName: "Agenzie", hexColor: "#83661F", icon: "agenzia",
    description: "Il servizio delle agenzie: comunicazione, trasparenza sui costi, gestione della pratica e onestà delle informazioni.",
    isPerson: false, isMapped: false,
    criteria: [
      { key: "comunicazione", label: "Comunicazione e professionalità del personale" },
      { key: "trasparenza", label: "Trasparenza su costi e condizioni" },
      { key: "pratica", label: "Gestione della pratica e degli adempimenti" },
      { key: "onestà", label: "Onestà delle informazioni fornite" },
      { key: "supporto", label: "Supporto durante e dopo il servizio" },
      { key: "rapporto", label: "Rapporto qualità-prezzo (compenso)" },
    ],
  },
  {
    id: "ditta", name: "Ditte e professionisti della casa", shortName: "Ditte e professionisti", hexColor: "#A65B3F", icon: "ditta",
    description: "Imprese, artigiani e tecnici che operano su immobili e condomini: qualità, tempi, preventivi e garanzie.",
    isPerson: false, isMapped: false,
    criteria: [
      { key: "qualita", label: "Qualità del lavoro e seguito" },
      { key: "tempi", label: "Rispetto di tempi e impegni" },
      { key: "preventivo", label: "Chiarezza e rispetto del preventivo" },
      { key: "professionalita", label: "Professionalità del personale" },
      { key: "assistenza", label: "Assistenza e garanzia post-intervento" },
    ],
  },
  {
    id: "consulente", name: "Consulenti tecnici", shortName: "Consulenti", hexColor: "#50648C", icon: "consulente",
    description: "Geometri, ingegneri, periti e consulenti tecnici iscritti con approvazione dello staff: perizie e valutazioni immobiliari su richiesta, oltre alle recensioni di chi li ha incaricati.",
    isPerson: false, isMapped: false,
    criteria: [
      { key: "competenza", label: "Competenza tecnica e chiarezza della relazione" },
      { key: "tempi", label: "Rispetto di tempi e impegni" },
      { key: "trasparenza", label: "Trasparenza di costi e condizioni" },
      { key: "comunicazione", label: "Comunicazione e disponibilità" },
      { key: "rapporto", label: "Rapporto qualità-prezzo" },
    ],
  },
];

/** Popola le categorie di default (idempotente). */
export async function ensureCategoriesSeeded() {
  const existing = await db.category.count();
  if (existing > 0) return;
  for (let i = 0; i < CAT_SEED.length; i++) {
    const c = CAT_SEED[i];
    await db.category.create({
      data: {
        id: c.id, name: c.name, shortName: c.shortName, description: c.description,
        hexColor: c.hexColor, icon: c.icon, isPerson: c.isPerson, isMapped: c.isMapped,
        orderIndex: i, isActive: true, isDemo: true,
        criteria: { create: c.criteria.map((cr, j) => ({ key: cr.key, label: cr.label, orderIndex: j })) },
      },
    });
  }
}

/** Crea (se manca) la categoria Consulenti con i suoi criteri: idempotente,
 *  così i database già popolati la ottengono senza reseeding. */
export async function ensureConsulenteCategory() {
  const cat = CAT_SEED.find(c => c.id === "consulente");
  if (!cat) return;
  const existing = await db.category.findUnique({
    where: { id: "consulente" },
    include: { criteria: true },
  });
  if (!existing) {
    await db.category.create({
      data: {
        id: cat.id, name: cat.name, shortName: cat.shortName, description: cat.description,
        hexColor: cat.hexColor, icon: cat.icon, isPerson: cat.isPerson, isMapped: cat.isMapped,
        orderIndex: 99, isActive: true, isDemo: true,
        criteria: { create: cat.criteria.map((cr, j) => ({ key: cr.key, label: cr.label, orderIndex: j })) },
      },
    });
    return;
  }
  // categoria presente ma senza criteri (creata a mano?): si completano
  if (!existing.criteria.length) {
    await db.criterion.createMany({
      data: cat.criteria.map((cr, j) => ({ categoryId: "consulente", key: cr.key, label: cr.label, orderIndex: j })),
    });
  }
}

let cache: { at: number; cats: CategoryDef[] } | null = null;
const TTL = 5000;

export async function getCategories(): Promise<CategoryDef[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.cats;
  // self-healing: se la categoria Consulenti manca (database nato prima di
  // questa funzione), viene creata al volo — una sola query di controllo
  try { await ensureConsulenteCategory(); } catch { /* non blocca il catalogo */ }
  const rows = await db.category.findMany({
    where: { isActive: true },
    orderBy: { orderIndex: "asc" },
    include: { criteria: { where: { active: true }, orderBy: { orderIndex: "asc" } } },
  });
  const cats: CategoryDef[] = rows.map(c => ({
    id: c.id, name: c.name, shortName: c.shortName, description: c.description,
    hexColor: c.hexColor, icon: c.icon, isPerson: c.isPerson, isMapped: c.isMapped,
    criteria: c.criteria.map(cr => ({ key: cr.key, label: cr.label })),
    experienceKinds: DEFAULT_EXP_KINDS[c.id] || [],
    priceUnits: DEFAULT_PRICE_UNITS[c.id] || [],
  }));
  cache = { at: Date.now(), cats };
  return cats;
}

export function invalidateCategoryCache() {
  cache = null;
}

export async function getCategory(id: string): Promise<CategoryDef | null> {
  const cats = await getCategories();
  return cats.find(c => c.id === id) || null;
}

/** Snapshot (versione) dei criteri di una categoria, per le recensioni future. */
export async function snapshotCategoryVersion(categoryId: string): Promise<string> {
  const cat = await getCategory(categoryId);
  if (!cat) throw new Error("categoria inesistente");
  const latest = await db.categoryVersion.findFirst({
    where: { categoryId },
    orderBy: { version: "desc" },
  });
  const snap = JSON.stringify(cat.criteria);
  if (latest && latest.criteriaSnapshot === snap) return latest.id;
  const next = await db.categoryVersion.create({
    data: { categoryId, version: (latest?.version ?? 0) + 1, criteriaSnapshot: snap, priceUnitsJson: JSON.stringify(cat.priceUnits) },
  });
  return next.id;
}
