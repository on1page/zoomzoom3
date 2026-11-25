// POST /api/contact — richiesta di contatto (generica, privacy, contenuto).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/server/auth";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { validateEmail } from "@/lib/server/validation";
import { sendMail } from "@/lib/server/mailer";

const KINDS = ["generic", "privacy", "association", "content"];

export async function POST(req: Request) {
  try {
    guard(req, "contact", 5, 3600);
    const p = await readJson<{ email?: string; message?: string; kind?: string; hp?: string }>(req);
    if (String(p.hp || "").trim()) return fail("Richiesta rifiutata.", 400);
    const user = await getCurrentUser();
    const email = user ? user.email : String(p.email || "");
    if (!validateEmail(email)) return fail("Indirizzo email non valido.");
    const msg = String(p.message || "").trim();
    if (msg.length < 30) return fail("Il messaggio deve avere almeno 30 caratteri.");
    const kind = KINDS.includes(String(p.kind)) ? String(p.kind) : "generic";
    const created = await db.contactRequest.create({
      data: { email: email.toLowerCase(), kind, message: msg, status: "received" },
    });
    if (kind === "privacy") {
      await db.privacyRequest.create({
        data: { email: email.toLowerCase(), userId: user?.id || null, kind: "contact", message: msg, status: "received" },
      });
    }
    await sendMail(email, "Richiesta ricevuta",
      "La tua richiesta è stata registrata: riceverai risposta all'indirizzo indicato.");
    return NextResponse.json({ ok: true, id: created.id });
  } catch (e) {
    return handleError(e);
  }
}
