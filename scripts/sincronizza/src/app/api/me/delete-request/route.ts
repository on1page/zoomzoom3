// POST /api/me/delete-request — richiesta di cancellazione account.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { sendMail } from "@/lib/server/mailer";
import { guard, handleError } from "@/lib/server/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    guard(req, "delete-request", 3, 3600);
    await db.privacyRequest.create({
      data: {
        email: user.email, userId: user.id, kind: "account-deletion",
        message: "Richiesta di cancellazione account inviata dall'utente.", status: "received",
      },
    });
    await sendMail(user.email, "Richiesta di cancellazione ricevuta",
      "La tua richiesta di cancellazione è stata registrata: riceverai conferma dell'esito entro i termini previsti.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
