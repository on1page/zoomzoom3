// POST /api/experiences/verify-request — richiesta di verifica documentale.
// Upload in area PRIVATA (db/uploads, mai in public/): tipi ammessi, dimensione
// massima, verifica dei magic bytes. Accesso ai documenti solo staff autorizzato.
// Nota ambiente: la scansione antivirus non è disponibile qui ed è dichiarata
// come requisito pre-lancio (vedi README).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { randomToken, createHashOf } from "@/lib/server/doc-utils";
import { sendMail } from "@/lib/server/mailer";
import { getCategory } from "@/lib/server/categories";
import { guard, handleError, fail } from "@/lib/server/http";
import { validateEmail } from "@/lib/server/validation";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED: Array<{ ext: string; mime: string; magic?: number[] }> = [
  { ext: "pdf", mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  { ext: "png", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: "jpg", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { ext: "webp", mime: "image/webp" },
];

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "verify-request", 5, 3600);
    const form = await req.formData();
    const entityId = String(form.get("entityId") || "");
    const kind = String(form.get("kind") || "");
    const period = String(form.get("period") || "");
    const note = String(form.get("note") || "").slice(0, 2000);
    const hp = String(form.get("hp") || "");
    if (hp) return fail("Richiesta rifiutata.", 400);

    const ent = await db.entity.findUnique({ where: { id: entityId } });
    if (!ent || ent.status !== "published") return fail("Scheda non trovata.", 404);
    const cat = await getCategory(ent.categoryId);
    if (!cat) return fail("Categoria non valida.");
    if (!cat.experienceKinds.includes(kind)) return fail("Tipo di esperienza non valido per questa categoria.");
    // per le persone fisiche la scheda deve essere a iniziali (dato minimo)
    if (cat.isPerson && !ent.initialsOnly) return fail("Per le persone fisiche la scheda usa le iniziali.");

    const pending = await db.experience.findFirst({
      where: { requestedById: user.id, status: "pending", entityId: ent.id },
    });
    if (pending) return fail("Hai già una richiesta in verifica per questa scheda.", 409);
    const already = await db.experience.findFirst({
      where: { userId: user.id, entityId: ent.id },
      include: { review: true },
    });
    if (already?.review) return fail("Hai già recensito questa scheda per un'esperienza.", 409);

    const file = form.get("proof");
    let docData: { storedName: string; originalName: string; mime: string; size: number; sha: string } | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) return fail("Documento troppo grande (massimo 8 MB).");
      const originalName = file.name.slice(0, 120).replace(/[/\\]/g, "_");
      const ext = originalName.split(".").pop()?.toLowerCase() || "";
      const spec = ALLOWED.find(a => a.ext === ext);
      if (!spec || (file.type && file.type !== spec.mime)) return fail("Formato non ammesso: PDF, PNG, JPG o WebP.");
      const buf = Buffer.from(await file.arrayBuffer());
      if (spec.magic) {
        const okMagic = spec.magic.every((b, i) => buf[i] === b);
        if (!okMagic) return fail("Il contenuto del file non corrisponde al formato dichiarato.");
      }
      const storedName = `${randomToken(16)}.${spec.ext}`;
      const dir = path.join(process.cwd(), "db", "uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, storedName), buf);
      docData = { storedName, originalName, mime: spec.mime, size: buf.length, sha: createHashOf(buf) };
    } else if (!smtpConfiguredSafe()) {
      return fail("Allega un documento dimostrativo dell'esperienza (PDF, PNG, JPG o WebP).");
    }

    const exp = await db.experience.create({
      data: {
        entityId: ent.id, kind, period,
        origin: "verification-request", clientEmail: user.email,
        status: "pending", requestedById: user.id, note, isDemo: ent.isDemo,
        docs: docData ? {
          create: {
            storedName: docData.storedName, originalName: docData.originalName,
            mimeType: docData.mime, sizeBytes: docData.size, sha256: docData.sha,
            uploadedById: user.id,
          },
        } : undefined,
      },
      include: { docs: true },
    });
    await sendMail(user.email, "Richiesta di verifica esperienza ricevuta",
      `Un moderatore esaminerà la documentazione per l'esperienza con ${ent.name}. Riceverai un aggiornamento entro 7 giorni. ` +
      `Nota: il documento è accessibile solo al personale autorizzato e viene cancellato dopo la decisione.`);
    return NextResponse.json({ ok: true, experienceId: exp.id });
  } catch (e) {
    return handleError(e);
  }
}

function smtpConfiguredSafe(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

export async function GET() {
  // stato della funzione: onestà sui limiti ambientali
  return NextResponse.json({
    ok: true,
    uploadEnabled: true,
    maxBytes: MAX_BYTES,
    allowed: ALLOWED.map(a => a.mime),
    antivirusScan: "non disponibile in questo ambiente — requisito pre-lancio (vedi README)",
    validateEmailExample: validateEmail("nome@esempio.it"),
  });
}
