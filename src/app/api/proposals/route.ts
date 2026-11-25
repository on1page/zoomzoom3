// POST /api/proposals — proposta di nuova scheda, in revisione prima della
// pubblicazione. Controllo duplicati su categoria + nome normalizzato + zona.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/server/auth";
import { getCategories } from "@/lib/server/categories";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { validateEmail } from "@/lib/server/validation";

function normalizeName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export async function POST(req: Request) {
  try {
    guard(req, "proposal", 5, 3600);
    const p = await readJson<{
      categoryId?: string; name?: string; subtitle?: string; address?: string;
      zoneId?: string; justification?: string; contactEmail?: string; hp?: string;
    }>(req);
    if (String(p.hp || "").trim()) return fail("Richiesta rifiutata.", 400);
    const cats = await getCategories();
    const cat = cats.find(c => c.id === p.categoryId);
    if (!cat) return fail("Categoria non valida.");
    const name = String(p.name || "").trim();
    if (name.length < 3) return fail("Nome troppo breve.");
    const user = await getCurrentUser();
    const justification = String(p.justification || "").trim();
    if (justification.length < 20) return fail("Motivazione troppo breve (almeno 20 caratteri).");
    const contactEmail = user ? user.email : String(p.contactEmail || "");
    if (!user && !validateEmail(contactEmail)) return fail("Indirizzo email di contatto non valido.");

    // controllo duplicati: stessa categoria + nome normalizzato (+ zona se indicata)
    const norm = normalizeName(name);
    const existing = await db.entity.findMany({ where: { categoryId: cat.id } });
    const dup = existing.find(e => normalizeName(e.name) === norm && (!p.zoneId || e.zoneId === p.zoneId));
    if (dup) return fail(`Esiste già una scheda con questo nome nella categoria ${cat.shortName}: "${dup.name}". Se ritieni sia un caso diverso, descrivi meglio la differenza nella motivazione.`, 409);
    const dupProposal = await db.entityProposal.findFirst({
      where: { categoryId: cat.id, status: "received" },
    });
    if (dupProposal && normalizeName(dupProposal.name) === norm) {
      return fail("Una proposta con questo nome è già in revisione.", 409);
    }

    await db.entityProposal.create({
      data: {
        categoryId: cat.id, name, subtitle: String(p.subtitle || "").slice(0, 200) || null,
        address: cat.isPerson ? null : String(p.address || "").slice(0, 200) || null,
        zoneId: p.zoneId || null, proposedById: user?.id || null,
        contactEmail: user ? user.email : contactEmail,
        justification, status: "received",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
