// ZoomZoom — identità pubblica dell'utente: categoria di appartenenza,
// foto profilo e scheda ad hoc del catalogo.
//
// Regole di privacy (le recensioni sono anonime DI DEFAULT):
//   - sulla recensione compare SOLO la categoria dell'autore (snapshot
//     salvato su Review.authorCategory alla pubblicazione);
//   - nickname e foto profilo compaiono soltanto se l'autore attiva il
//     flag showIdentity per quella singola recensione.
//
// Scheda ad hoc: chi si registra dichiarando una categoria di appartenenza
// (proprietario, affittuario, amministratore, agenzia, ditta, consulente)
// ottiene una scheda pubblica attiva di quella categoria, collegata al
// proprio account (ownerUserId + subjectEntityId). Per le persone fisiche
// (proprietari, affittuari) la scheda nasce con sole iniziali, come da
// prassi del catalogo: la discriminante privacy resta il flag per recensione.
import { db } from "@/lib/db";
import { getCategory, type CategoryDef } from "./categories";

/** Slug delle categorie a cui un utente può appartenere alla registrazione. */
export const SUBJECT_CATEGORY_IDS = [
  "proprietario", "affittuario", "amministratore", "agenzia", "ditta", "consulente",
] as const;

/** Etichette della combo di registrazione (l'ordine è quello del form). */
export const SUBJECT_CATEGORY_LABELS: Record<string, string> = {
  proprietario: "Proprietario di immobili",
  affittuario: "Affittuario",
  amministratore: "Amministratore di condominio",
  agenzia: "Agenzia immobiliare",
  ditta: "Ditta / professionista della casa",
  consulente: "Consulente tecnico",
};

/** Categoria valida per l'appartenenza di un utente (null = utente semplice). */
export async function validSubjectCategory(id: unknown): Promise<CategoryDef | null> {
  const slug = String(id || "").trim();
  if (!slug) return null;
  if (!(SUBJECT_CATEGORY_IDS as readonly string[]).includes(slug)) return null;
  return getCategory(slug);
}

const MAX_AVATAR_BYTES = 1_500_000; // ~1,5 MB prima della ricompilazione
const AVATAR_MAX_SIDE = 320;

/** Ricompila la foto profilo lato server (sharp): EXIF/GPS rimossi, lato
 *  massimo 320 px, JPEG. Restituisce null se il dato non è un'immagine
 *  valida: un avatar non valido non deve mai fallire la registrazione. */
export async function compileAvatar(dataUrl: unknown): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
    if (!m) return null;
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length || buf.length > MAX_AVATAR_BYTES) return null;
    const sharp = (await import("sharp")).default;
    const out = await sharp(buf)
      .rotate() // applica l'orientamento EXIF e lo rimuove
      .resize(AVATAR_MAX_SIDE, AVATAR_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return new Uint8Array(out) as Uint8Array<ArrayBuffer>;
  } catch {
    return null;
  }
}

/** Iniziali dallo pseudonimo, prassi del catalogo per le persone fisiche:
 *  si tengono le iniziali delle sole parole alfabetiche
 *  ("Arianna Verdi" → "A. V.", "Arianna_84" → "A."). */
export function initialsOf(nickname: string): string {
  const parts = String(nickname || "").trim().split(/[\s_\-_.]+/).filter(w => /[a-zA-Zàèéìòù]/.test(w));
  const letters = parts.map(w => w[0]!.toUpperCase()).slice(0, 3);
  return letters.length ? letters.map(l => `${l}.`).join(" ") : "—";
}

export type SubjectSheetResult = {
  entityId: string;
  created: boolean;
  name: string;
};

/** Crea (se manca) e ATTIVA la scheda ad hoc dell'utente per la categoria
 *  dichiarata. Idempotente: se l'utente ha già una scheda collegata, quella
 *  resta (si cambia categoria senza perdere cronologia e recensioni).
 *  Persone fisiche → sole iniziali; soggetti d'impresa → nome scelto o
 *  pseudonimo. La scheda nasce pubblicata: è subito recensibile/ricercabile. */
export async function ensureSubjectSheet(
  userId: string,
  nickname: string,
  cat: CategoryDef,
  sheetName?: string,
): Promise<SubjectSheetResult> {
  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { subjectEntityId: true },
  });
  if (existing?.subjectEntityId) {
    const ent = await db.entity.findUnique({ where: { id: existing.subjectEntityId }, select: { id: true, name: true } });
    if (ent) return { entityId: ent.id, created: false, name: ent.name };
  }
  const chosen = String(sheetName || "").trim().slice(0, 80);
  const isPerson = cat.isPerson;
  const name = isPerson
    ? initialsOf(nickname)
    : (chosen.length >= 3 ? chosen : nickname).slice(0, 80);
  const entity = await db.entity.create({
    data: {
      categoryId: cat.id,
      name,
      subtitle: `${SUBJECT_CATEGORY_LABELS[cat.id] || cat.name} · scheda attivata dal diretto interessato`,
      initialsOnly: isPerson,
      status: "published",
      proposedBy: "registration",
      ownerUserId: userId,
    },
    select: { id: true, name: true },
  });
  await db.user.update({ where: { id: userId }, data: { subjectEntityId: entity.id } });
  return { entityId: entity.id, created: true, name: entity.name };
}
