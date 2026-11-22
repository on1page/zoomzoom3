// GET /api/consulente/requests/[id]/pdf — la relazione consegnata, resa
// come PDF scaricabile. Accesso riservato: richiedente, consulente
// incaricato e staff. Generata al volo dal testo conservato (nessun file
// da gestire), con intestazione, dati dell'incarico e ripartizione della
// tariffa.
import { db } from "@/lib/db";
import { getCurrentUser, getCurrentAdmin } from "@/lib/server/auth";
import { fail, handleError } from "@/lib/server/http";
import { buildPdf, type PdfBlock } from "@/lib/server/pdf";

export const dynamic = "force-dynamic";

const fmtEuro = (cents: number) =>
  (cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    // staff: anche con la sessione del back office (il registro perizie
    // scarica le relazioni)
    const admin = user ? null : await getCurrentAdmin();
    const me = user ?? admin;
    if (!me) return fail("Autenticazione necessaria.", 401);

    const r = await db.periziaRequest.findUnique({
      where: { id },
      include: { consultant: { include: { zone: true } }, requester: { select: { nickname: true } } },
    });
    if (!r) return fail("Richiesta non trovata.", 404);

    const isStaff = ["moderator", "admin", "superadmin"].includes(me.role);
    const isRequester = r.requesterId === me.id;
    const isConsultant = r.consultant.userId === me.id;
    if (!isRequester && !isConsultant && !isStaff) return fail("Permesso negato.", 403);
    if (r.status !== "delivered" && r.status !== "closed") {
      return fail("La relazione non è ancora stata consegnata.", 409);
    }

    const dataIt = (d: Date) => d.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
    const blocks: PdfBlock[] = [
      { text: r.reportTitle || "Relazione tecnica", bold: true, size: 18, gapBefore: 0 },
      { text: `ZoomZoom · Richiesta n. ${r.id} · ${r.kind}`, size: 9, color: 0.45, gapBefore: 2 },
      { text: `Consulente: ${r.consultant.firstName} ${r.consultant.lastName} — ${r.consultant.profession} (${r.consultant.title})`, size: 11, gapBefore: 16 },
      { text: `Zona di esercizio: ${r.consultant.zone.name}${r.consultant.zone.province ? ` (${r.consultant.zone.province})` : ""} · raggio ${r.consultant.radiusKm} km`, size: 11 },
      { text: `Richiedente: utente registrato “${r.requester.nickname}”`, size: 11 },
      { text: `Oggetto: ${r.kind}`, size: 11 },
      { text: `Indirizzo: ${r.address}`, size: 11 },
      { text: `Data di consegna: ${dataIt(r.deliveredAt ?? r.updatedAt)}`, size: 11 },
      ...(r.feeCents != null ? [{
        text: `Tariffa pattuita: € ${fmtEuro(r.feeCents)} (di cui commissione della piattaforma € ${fmtEuro(r.commissionCents ?? 0)}; accredito al consulente € ${fmtEuro(r.payoutCents ?? 0)})`,
        size: 11,
      }] : []),
      { text: "Sintesi della richiesta del richiedente", bold: true, size: 13, gapBefore: 16 },
      { text: r.description, size: 10.5, color: 0.25, gapBefore: 6, indent: 10 },
      { text: "Relazione del consulente", bold: true, size: 13, gapBefore: 14 },
      { text: r.reportBody || "", size: 11, gapBefore: 6 },
      { text: `Il consulente: ${r.consultant.firstName} ${r.consultant.lastName} — ${r.consultant.profession}`, size: 11, gapBefore: 24 },
      { text: "Documento generato da ZoomZoom il " + dataIt(new Date()) + ". La relazione è redatta sotto la responsabilità professionale del consulente; la piattaforma ne cura la consegna e il pagamento trattenuto, non il contenuto tecnico.", size: 8.5, color: 0.45, gapBefore: 18 },
    ];

    const pdf = buildPdf(blocks, `Relazione tecnica — ZoomZoom · richiesta n. ${r.id}`);
    const nome = `relazione-${r.id}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${nome}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
