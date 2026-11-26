// GET /api/cron/perizie — applicazione periodica delle scadenze delle
// indagini professionali (percorso ③ del modello D11). Pianificato ogni
// giorno da Vercel Cron (vercel.json, ore 03:43 UTC, fuori dai picchi).
// Protetto da CRON_SECRET come il job del riconoscimento di utilità: senza
// segreto configurato la rotta resta spenta. Il controllo gira comunque
// (applicazione pigra) a ogni lettura della bacheca e delle aree: il cron
// serve solo a mandare gli avvisi in tempo, anche se nessuno apre le pagine.
//   · bacheca di zona scaduta senza accettazioni → expired (avviso al richiedente)
//   · relazione non consegnata entro il termine → incarico nullo:
//     ripubblicazione in bacheca + incarichiNulli al consulente (avvisi alle parti)
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/server/settings";
import { sweepPerizie } from "@/lib/server/perizie";
import { handleError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ ok: false, error: "Job non configurato: manca CRON_SECRET." }, { status: 503 });
    }
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Non autorizzato." }, { status: 401 });
    }
    const settings = await getSettings();
    if (!settings.consulentiEnabled) {
      return NextResponse.json({ ok: true, skipped: "Servizio perizie disattivato nelle impostazioni." });
    }
    const stats = await sweepPerizie(settings);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    return handleError(e);
  }
}
