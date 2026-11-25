// ZoomZoom — servizio email.
// Onestà dichiarata: se SMTP non è configurato, le email NON vengono inviate
// e tanto viene registrato (status "queued"); l'interfaccia lo comunica.
// In modalità demo i messaggi generati restano consultabili dal solo back
// office (tabella EmailLog), marcati come demo: nessuna simulazione occulta.
import nodemailer from "nodemailer";
import { db } from "@/lib/db";

export type MailLink = { label: string; href: string };

export function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

export async function sendMail(to: string, subject: string, body: string, links: MailLink[] = []): Promise<"sent" | "queued" | "failed"> {
  const isDemo = process.env.DEMO_MODE === "true";
  let status: "sent" | "queued" | "failed" = "queued";
  let error: string | null = null;

  if (smtpConfigured()) {
    try {
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      });
      const linkHtml = links.map(l => `<p><a href="${l.href}">${l.label}</a></p>`).join("");
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to,
        subject,
        text: body + (links.length ? "\n\n" + links.map(l => `${l.label}: ${l.href}`).join("\n") : ""),
        html: `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>${linkHtml}`,
      });
      status = "sent";
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : "errore SMTP";
    }
  }

  await db.emailLog.create({
    data: {
      to, subject, body,
      // In modalità demo i link (che contengono il token) restano nel registro
      // della casella demo per consentire i test; in produzione il token non
      // viene mai persistito nei log oltre l'invio reale.
      linksJson: isDemo ? JSON.stringify(links) : "[]",
      status, error, isDemo,
    },
  });
  return status;
}
