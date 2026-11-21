// ZoomZoom — accesso alle recensioni: offuscamento dell'anteprima (teaser),
// gating delle foto e ricompilazione delle immagini, riepilogo dei voti.
// Tutto QUI, lato server: al client non arrivano mai i testi integrali né
// le immagini per cui l'utente non ha titolo.
import { db } from "@/lib/db";
import type { AppSettings } from "./settings";
import { premiumStateOf, type PremiumUserLike } from "./premium";

/* ---------- Anteprima offuscata (teaser) ---------- */

// Riduce il testo a un breve estratto iniziale + una maschera di punti che
// ne richiama la lunghezza: abbastanza per farsi un'idea del tono, mai
// abbastanza per leggerlo. Il testo integrale resta riservato ai Premium.
export function obfuscateReviewText(text: string): string {
  const t = String(text || "").trim();
  if (!t) return "";
  const KEEP = 70;
  let head = t.slice(0, KEEP).replace(/\s+\S+$/, "");
  if (head.length < 30) head = t.slice(0, 40);
  const rest = Math.max(0, t.length - head.length);
  const maskLen = Math.max(12, Math.min(48, Math.round(rest * 0.5)));
  const mask = "•".repeat(maskLen).replace(/(.{4})/g, "$1 ").trim();
  return `${head}… ${mask}`;
}

/* ---------- Gating delle foto ---------- */

export type PhotoAccess = {
  canView: boolean;
  viaContribution: boolean; // sbloccato contribuendo con almeno una foto propria
};

// Accesso alle foto delle recensioni: Premium attivo, staff (moderazione)
// oppure contributo fotografico proprio (almeno una foto in una recensione
// pubblicata). Se la funzione foto è spenta nessuno le vede (coerenza UI).
export async function photoAccessOf(user: PremiumUserLike & { id: string } | null, settings: AppSettings): Promise<PhotoAccess> {
  if (!settings.photosEnabled) return { canView: false, viaContribution: false };
  if (!user) return { canView: false, viaContribution: false };
  if (["moderator", "admin", "superadmin"].includes(user.role)) return { canView: true, viaContribution: false };
  if (premiumStateOf(user).active) return { canView: true, viaContribution: false };
  const own = await db.reviewPhoto.findFirst({
    where: { review: { userId: user.id, status: "published" } },
    select: { id: true },
  });
  return { canView: !!own, viaContribution: !!own };
}

/* ---------- Ricompilazione delle immagini (privacy) ---------- */

export type PhotoAttachResult = { added: number; skipped: number };

const MAX_PHOTOS_PER_REVIEW = 3;
const MAX_PHOTO_BYTES = 1_500_000; // ~1,5 MB prima della ricompilazione

// Valida e conserva le foto di una recensione. Ogni immagine viene
// ricompilata lato server con sharp: l'EXIF (posizione GPS inclusa) viene
// eliminato, la lunghezza è limitata a 1280 px, il formato è JPEG.
// Le foto non valide vengono saltate senza fallire l'intera recensione.
export async function attachReviewPhotos(reviewId: string, isDemo: boolean, photos: unknown): Promise<PhotoAttachResult> {
  const result: PhotoAttachResult = { added: 0, skipped: 0 };
  if (!Array.isArray(photos)) return result;
  const list = photos.slice(0, MAX_PHOTOS_PER_REVIEW);
  const sharp = (await import("sharp")).default;
  for (const raw of list) {
    try {
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/i.exec(String(raw || ""));
      if (!m) { result.skipped++; continue; }
      const buf = Buffer.from(m[2], "base64");
      if (!buf.length || buf.length > MAX_PHOTO_BYTES) { result.skipped++; continue; }
      const out = await sharp(buf)
        .rotate() // applica l'orientamento EXIF e lo rimuove
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      await db.reviewPhoto.create({
        data: {
          reviewId, data: new Uint8Array(out.data),
          width: out.info.width, height: out.info.height, bytes: out.data.length, isDemo,
        },
      });
      result.added++;
    } catch {
      result.skipped++;
    }
  }
  return result;
}

/* ---------- Voti di utilità ---------- */

export type VoteSummary = { up: number; down: number };

// Conteggio voti per le recensioni di un'entità (piccoli volumi: aggrega in JS).
export async function voteSummariesForEntity(entityId: string): Promise<Map<string, VoteSummary>> {
  const votes = await db.reviewVote.findMany({
    where: { review: { entityId } },
    select: { reviewId: true, value: true },
  });
  const map = new Map<string, VoteSummary>();
  for (const v of votes) {
    const cur = map.get(v.reviewId) || { up: 0, down: 0 };
    if (v.value === 1) cur.up++;
    else if (v.value === -1) cur.down++;
    map.set(v.reviewId, cur);
  }
  return map;
}

// Il voto dell'utente su ciascuna recensione di un'entità.
export async function myVotesForEntity(entityId: string, userId: string): Promise<Map<string, number>> {
  const votes = await db.reviewVote.findMany({
    where: { review: { entityId }, userId },
    select: { reviewId: true, value: true },
  });
  return new Map(votes.map(v => [v.reviewId, v.value]));
}
