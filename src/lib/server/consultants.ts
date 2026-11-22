// ZoomZoom — Consulente Tecnico: validazioni, costanti e helper condivisi
// dalle API. Il flusso è descritto in prisma/schema.prisma (PeriziaRequest):
// iscrizione con approvazione dello staff e 2FA obbligatoria; richieste di
// perizia con tariffa confermata dal consulente; pagamento trattenuto dalla
// piattaforma e accreditato (meno il 10%) solo a relazione consegnata.
import { db } from "@/lib/db";

export const CONSULENTE_PROFESSIONS = [
  "Geometra", "Ingegnere", "Tecnico", "Perito", "Consulente Tecnico",
  "Agente Immobiliare", "Altro",
] as const;

export const PERIZIA_KINDS = [
  "Perizia tecnica", "Valutazione immobiliare", "Altro",
] as const;

// commissione della piattaforma sul compenso del consulente (%)
export const COMMISSION_PCT = 10;

export type ApplyInput = {
  firstName?: string;
  lastName?: string;
  photo?: string | null;          // dataURL dell'immagine (opzionale alla rettifica)
  profession?: string;
  title?: string;
  bio?: string;
  zone?: { name?: string; province?: string | null; region?: string | null; lat?: number; lng?: number };
  zoneId?: string;
  radiusKm?: number;
  feeEuros?: number | string;
  vatNumber?: string;
  iban?: string;
  phone?: string;
  docs?: Array<{ kind?: string; name?: string; mime?: string; data?: string }>;
};

export type ApplyIssue = { field?: string; error: string };

export type ApplyData = {
  firstName: string;
  lastName: string;
  profession: string;
  title: string;
  bio: string | null;
  zoneId: string;
  radiusKm: number;
  feeCents: number;
  vatNumber: string;
  iban: string;
  phone: string | null;
  docs: Array<{ kind: string; name: string; mime: string; data: string }>;
  photo: string | null;
};

function isIbanLike(s: string): boolean {
  return /^[A-Z]{2}[0-9A-Z]{13,30}$/i.test(s.replace(/\s+/g, ""));
}

function isVatLike(s: string): boolean {
  // partita IVA italiana: 11 cifre (si accettano anche formati esteri semplici)
  return /^[0-9]{11}$/.test(s) || /^[A-Z]{2}[0-9A-Z]{6,15}$/i.test(s);
}

/** parse di un importo in euro (accetta "300", "300,50", 300.5) → centesimi */
export function eurosToCents(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Ripartizione tariffa: accredito al consulente e commissione piattaforma. */
export function splitFee(feeCents: number): { payoutCents: number; commissionCents: number } {
  const commissionCents = Math.round((feeCents * COMMISSION_PCT) / 100);
  return { payoutCents: feeCents - commissionCents, commissionCents };
}

/** Validazione della domanda di iscrizione (o ri-domanda dopo un rifiuto).
 *  Ritorna i campi pronti per il salvataggio, oppure l'errore. */
export async function validateApply(p: ApplyInput, requirePhoto: boolean):
  Promise<{ ok: true; data: ApplyData } | { ok: false; issue: ApplyIssue }> {
  const firstName = String(p.firstName || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (firstName.length < 2) return { ok: false, issue: { field: "firstName", error: "Indica il nome." } };
  const lastName = String(p.lastName || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (lastName.length < 2) return { ok: false, issue: { field: "lastName", error: "Indica il cognome." } };

  const profession = String(p.profession || "").trim();
  if (!(CONSULENTE_PROFESSIONS as readonly string[]).includes(profession)) {
    return { ok: false, issue: { field: "profession", error: "Scegli la professione dall'elenco." } };
  }
  const title = String(p.title || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (title.length < 2) return { ok: false, issue: { field: "title", error: "Indica il titolo di studio." } };

  const bio = String(p.bio || "").trim().slice(0, 2000) || null;

  // zona di esercizio: zona esistente (zoneId) oppure località geocodificata
  // (nome + coordinate) che entra nel catalogo con ensureZone
  let zoneId: string | null = p.zoneId ? String(p.zoneId) : null;
  if (zoneId) {
    const z = await db.zone.findUnique({ where: { id: zoneId } });
    if (!z) zoneId = null;
  }
  if (!zoneId && p.zone) {
    const name = String(p.zone.name || "").trim().slice(0, 80);
    const lat = Number(p.zone.lat), lng = Number(p.zone.lng);
    if (name.length >= 2 && Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= 34 && lat <= 48.5 && lng >= 5.5 && lng <= 19.5) {
      const { ensureZone } = await import("./zones");
      try {
        const r = await ensureZone({
          name,
          province: p.zone.province || null,
          region: p.zone.region || null,
          lat, lng,
        }, "user");
        zoneId = r.zone.id;
      } catch {
        zoneId = null;
      }
    }
  }
  if (!zoneId) {
    return { ok: false, issue: { field: "zone", error: "Indica la zona di esercizio (cerca e conferma la località)." } };
  }

  const radiusKm = Math.round(Number(p.radiusKm));
  if (!Number.isFinite(radiusKm) || radiusKm < 5 || radiusKm > 300) {
    return { ok: false, issue: { field: "radiusKm", error: "Il raggio di azione deve essere tra 5 e 300 km." } };
  }

  const feeCents = p.feeEuros == null || p.feeEuros === "" ? 0 : eurosToCents(p.feeEuros);
  if (feeCents == null || feeCents > 100_000_00) {
    return { ok: false, issue: { field: "feeEuros", error: "Tariffa non valida (max 100.000 €)." } };
  }

  const vatNumber = String(p.vatNumber || "").trim().toUpperCase().slice(0, 30);
  if (!isVatLike(vatNumber)) {
    return { ok: false, issue: { field: "vatNumber", error: "Partita IVA non valida (11 cifre per l'Italia)." } };
  }
  const iban = String(p.iban || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
  if (!isIbanLike(iban)) {
    return { ok: false, issue: { field: "iban", error: "IBAN non valido." } };
  }
  const phone = String(p.phone || "").trim().slice(0, 40) || null;

  // documenti: almeno uno di qualifica e uno d'identificazione
  const docs = (p.docs || []).map(d => ({
    kind: ["qualifica", "esperienza", "documento", "altro"].includes(String(d.kind)) ? String(d.kind) : "altro",
    name: String(d.name || "documento").trim().slice(0, 160),
    mime: String(d.mime || "application/octet-stream").slice(0, 120),
    data: String(d.data || ""),
  })).filter(d => d.data.length > 0);
  if (!docs.some(d => d.kind === "qualifica")) {
    return { ok: false, issue: { field: "docs", error: "Allega almeno un documento di qualifica (titolo, iscrizione all'albo o certificato)." } };
  }
  if (!docs.some(d => d.kind === "documento")) {
    return { ok: false, issue: { field: "docs", error: "Allega almeno un documento d'identificazione." } };
  }
  const totBytes = docs.reduce((a, d) => a + d.data.length, 0);
  if (totBytes > 14 * 1024 * 1024) {
    return { ok: false, issue: { field: "docs", error: "Documenti troppo grandi: massimo 14 MB in totale." } };
  }

  if (requirePhoto && !p.photo) {
    return { ok: false, issue: { field: "photo", error: "Carica una foto profilo." } };
  }

  return {
    ok: true,
    data: {
      firstName, lastName, profession, title, bio, zoneId, radiusKm,
      feeCents, vatNumber, iban, phone,
      docs, photo: p.photo ? String(p.photo) : null,
    },
  };
}

/** Payload pubblico del consulente per la sua scheda nel catalogo. */
export async function publicConsultantForEntity(entityId: string) {
  const c = await db.consultantProfile.findUnique({
    where: { entityId },
    include: { zone: true },
  });
  if (!c || c.status !== "approved") return null;
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    profession: c.profession,
    title: c.title,
    bio: c.bio,
    zoneId: c.zoneId,
    zoneName: c.zone.name,
    province: c.zone.province,
    region: c.zone.region,
    radiusKm: c.radiusKm,
    feeCents: c.feeCents,
    vatNumber: c.vatNumber, // dato professionale pubblico
    hasPhoto: c.photoData != null,
    twoFactor: true, // garantito: l'approvazione richiede 2FA attiva
  };
}

export type PublicConsultant = NonNullable<Awaited<ReturnType<typeof publicConsultantForEntity>>>;

/** Nome completo del consulente per la scheda del catalogo. */
export function consultantDisplayName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`.replace(/\s+/g, " ").trim();
}
