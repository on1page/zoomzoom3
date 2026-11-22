// ZoomZoom — Consulente Tecnico: validazioni, costanti e helper condivisi
// dalle API. Il flusso è descritto in prisma/schema.prisma (PeriziaRequest):
// iscrizione con approvazione dello staff e 2FA obbligatoria; richieste di
// perizia con tariffa confermata dal consulente; pagamento trattenuto dalla
// piattaforma e accreditato (meno il 10%) solo a relazione consegnata.
import { db } from "@/lib/db";
import { normalizeIban, validateIban } from "@/lib/iban";

export const CONSULENTE_PROFESSIONS = [
  "Geometra", "Ingegnere", "Tecnico", "Perito", "Consulente Tecnico",
  "Agente Immobiliare", "Altro",
] as const;

export const PERIZIA_KINDS = [
  "Perizia tecnica", "Valutazione immobiliare", "Altro",
] as const;

// commissione della piattaforma sul compenso del consulente (%)
export const COMMISSION_PCT = 10;

// ---- limiti dei documenti (ripetuti identici nel browser:
// src/lib/client/files.ts — vanno tenute allineate) ----
export const DOC_KINDS = ["qualifica", "esperienza", "documento", "altro"] as const;
export const MAX_FILES = 8;                          // documenti totali in archivio
export const MAX_DOC_BYTES = 2 * 1024 * 1024;        // 2 MB per documento
export const MAX_TOTAL_DOC_BYTES = 3 * 1024 * 1024;  // 3 MB tutti i documenti insieme
export const ALLOWED_DOC_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

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
  ibanSelfDeclared?: boolean;     // dichiarazione: il conto è intestato all'iscritto
  phone?: string;
  docs?: Array<{ kind?: string; name?: string; mime?: string; data?: string }>;
  keepDocIds?: string[];          // documenti già in archivio da conservare (rettifica)
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
  keepDocIds: string[];
  photo: string | null;
};

/** Decodifica un dataURL base64 (foto e documenti). null se malformato. */
export function decodeDataUrl(u: string): { mime: string; buf: Buffer } | null {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(String(u || ""));
  if (!m) return null;
  try {
    return { mime: m[1], buf: Buffer.from(m[2], "base64") };
  } catch { return null; }
}

/** Riconosce il formato REALE di un documento dai primi byte, a prescindere
 *  da come si dichiara: PDF, JPEG, PNG o WebP. null se sconosciuto. */
export function sniffDocMime(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
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

export type ExistingProfile = { id: string; photoData: Uint8Array | null } | null;

/** Validazione della domanda di iscrizione (o ri-domanda dopo un rifiuto).
 *  `existing` è il profilo già presente (rettifica): se ne ricava se la foto
 *  è ancora obbligatoria e quali documenti in archivio si possono conservare.
 *  Ritorna i campi pronti per il salvataggio, oppure l'errore. */
export async function validateApply(p: ApplyInput, existing: ExistingProfile):
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

  // IBAN: struttura, lunghezza per paese e codice di controllo mod-97
  // (la corrispondenza con l'intestatario è dichiarata e verificata dallo staff)
  const iban = normalizeIban(p.iban);
  const ibanCheck = validateIban(iban);
  if (!ibanCheck.ok) {
    return { ok: false, issue: { field: "iban", error: ibanCheck.error } };
  }
  if (p.ibanSelfDeclared !== true) {
    return { ok: false, issue: { field: "ibanSelfDeclared", error: `Dichiarazione obbligatoria: spunta la casella che il conto è intestato a ${firstName} ${lastName}.` } };
  }
  const phone = String(p.phone || "").trim().slice(0, 40) || null;

  // documenti NuOVI: formato, numero e dimensioni (i limiti valgono anche
  // per chi bypassasse il browser: sono ricontrollati qui)
  const newDocs = (p.docs || []).map(d => ({
    kind: (DOC_KINDS as readonly string[]).includes(String(d.kind)) ? String(d.kind) : "altro",
    name: String(d.name || "documento").trim().slice(0, 160),
    mime: String(d.mime || "application/octet-stream").toLowerCase().slice(0, 120),
    data: String(d.data || ""),
  })).filter(d => d.data.length > 0);

  if (newDocs.length > MAX_FILES) {
    return { ok: false, issue: { field: "docs", error: `Troppi documenti: massimo ${MAX_FILES} in totale.` } };
  }

  // documenti GIÀ in archivio che la ri-domanda conserva
  const existingDocs = existing
    ? await db.consultantDoc.findMany({ where: { consultantId: existing.id }, select: { id: true, kind: true, sizeBytes: true } })
    : [];
  const wanted = new Set((p.keepDocIds || []).map(String));
  const keepDocs = existingDocs.filter(d => wanted.has(d.id));

  const totCount = keepDocs.length + newDocs.length;
  if (totCount > MAX_FILES) {
    return { ok: false, issue: { field: "docs", error: `Troppi documenti: massimo ${MAX_FILES} in totale (nuovi + conservati).` } };
  }

  let totBytes = keepDocs.reduce((a, d) => a + d.sizeBytes, 0);
  for (const d of newDocs) {
    if (!(ALLOWED_DOC_MIMES as string[]).includes(d.mime)) {
      return { ok: false, issue: { field: "docs", error: `"${d.name}": formato non ammesso (PDF, JPG, PNG o WebP).` } };
    }
    const dec = decodeDataUrl(d.data);
    if (!dec) {
      return { ok: false, issue: { field: "docs", error: `Il documento "${d.name}" non è leggibile.` } };
    }
    if (dec.buf.length > MAX_DOC_BYTES) {
      return { ok: false, issue: { field: "docs", error: `"${d.name}" supera i 2 MB: comprimilo o sostituiscilo con una foto (le foto vengono compresse automaticamente).` } };
    }
    totBytes += dec.buf.length;
    if (totBytes > MAX_TOTAL_DOC_BYTES) {
      return { ok: false, issue: { field: "docs", error: "Documenti troppo grandi: massimo 3 MB in totale (nuovi + conservati). Rimuovine qualcuno o sostituisci i PDF con foto compresse." } };
    }
  }

  // completezza: almeno una qualifica e un documento d'identificazione
  // (possono arrivare anche dai documenti conservati)
  const kinds = new Set([...keepDocs.map(d => d.kind), ...newDocs.map(d => d.kind)]);
  if (!kinds.has("qualifica")) {
    return { ok: false, issue: { field: "docs", error: "Allega almeno un documento di qualifica (titolo, iscrizione all'albo o certificato)." } };
  }
  if (!kinds.has("documento")) {
    return { ok: false, issue: { field: "docs", error: "Allega almeno un documento d'identificazione." } };
  }

  const needPhoto = !(existing && existing.photoData != null);
  if (needPhoto && !p.photo) {
    return { ok: false, issue: { field: "photo", error: "Carica una foto profilo." } };
  }

  return {
    ok: true,
    data: {
      firstName, lastName, profession, title, bio, zoneId, radiusKm,
      feeCents, vatNumber, iban, phone,
      docs: newDocs, keepDocIds: keepDocs.map(d => d.id),
      photo: p.photo ? String(p.photo) : null,
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
