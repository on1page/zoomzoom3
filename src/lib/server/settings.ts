// ZoomZoom — impostazioni applicative modificabili dal back office.
import { db } from "@/lib/db";

export type AppSettings = {
  siteName: string;              // nome configurabile (verificare disponibilità marchio)
  adsEnabled: boolean;
  adsClient: string;             // ID client AdSense (vuoto = non attivo)
  minReviews: number;            // soglia dati sufficienti / peso m della formula
  rettificaDays: number;         // finestra rettifica autonoma
  inviteDailyCap: number;        // inviti/giorno per soggetto
  inviteApprovalAbove: number;   // oltre N inviti/giorno serve approvazione
  inviteExpiryDays: number;      // scadenza token invito
  heroTitle: string;
  heroSub: string;
  globalNotice: string;          // mostrata solo in demo (vedi demoMode)
  proofRetentionDays: number;    // retention documenti di verifica
  mapMinAggregate: number;       // soglia minima aggregati zona sulla mappa
  premiumEnabled: boolean;       // Membership Premium: gating recensioni integrali
  premiumDaysPerReview: number;  // giorni Premium per recensione verificata pubblicata
  premiumMaxDays: number;        // cap di accumulo: premiumUntil mai oltre now+questo
  openReviewsEnabled: boolean;   // contributo aperto: recensioni su immobili/zone senza invito
  openReviewsPerDay: number;     // limite anti-abuso: recensioni aperte e nuove schede per utente al giorno
  photosEnabled: boolean;        // foto allegate alle recensioni
  votesEnabled: boolean;         // voti di utilità (pollice su/giù) riservati ai Premium
  consulentiEnabled: boolean;    // Consulenti tecnici: iscrizioni e richieste di perizia
  platformIban: string;          // IBAN della piattaforma per i pagamenti delle perizie (vuoto = istruzioni generiche)
  paymentInstructions: string;   // istruzioni mostrate all'utente per saldare una richiesta accettata
};

export const DEFAULT_SETTINGS: AppSettings = {
  siteName: "ZoomZoom",
  adsEnabled: false,
  adsClient: "",
  minReviews: 3,
  rettificaDays: 30,
  inviteDailyCap: 5,
  inviteApprovalAbove: 10,
  inviteExpiryDays: 7,
  heroTitle: "Indagini della community su case, zone e servizi della casa",
  // Fase 1 del modello «indagini della community» (D11): il sito non chiede
  // recensioni, offre indagini sugli immobili grazie alla community.
  // «Indagine della community» = nome pubblico del contributo; «recensione»
  // resta il termine delle regole, della moderazione e del percorso invito.
  heroSub: "Un portale indipendente, niente annunci né compravendita: indagini sugli immobili grazie alla community, contributi verificati, prezzi dichiarati e avvertenze esplicite, per scegliere casa senza sorprese.",
  globalNotice: "Istanza dimostrativa: tutti i contenuti di questa istanza sono dati fittizi, eliminabili dal super amministratore.",
  proofRetentionDays: 30,
  mapMinAggregate: 3,
  premiumEnabled: true,
  // 7 giorni dal 26/11/2026 (prima era 30): calibrato sul piano Gold
  // (7 giorni a 5 €) della proposta "indagini della community" — D11/K2.
  premiumDaysPerReview: 7,
  premiumMaxDays: 365,
  openReviewsEnabled: true,
  openReviewsPerDay: 5,
  photosEnabled: true,
  votesEnabled: true,
  consulentiEnabled: true,
  platformIban: "",
  paymentInstructions: "",
};

const SETTINGS_KEY = "app";

let cache: { value: AppSettings; at: number } | null = null;
const TTL = 5000;

export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
  let value = DEFAULT_SETTINGS;
  if (row) {
    try {
      value = { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) as Partial<AppSettings> };
    } catch { /* valore corrotto: si usano i default */ }
  }
  cache = { value, at: Date.now() };
  return value;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = { ...current, ...patch };
  await db.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  cache = { value: next, at: Date.now() };
  return next;
}

export function invalidateSettingsCache() {
  cache = null;
}
