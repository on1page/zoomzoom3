// GET /api/cron/utility — ricalcolo periodico del riconoscimento di utilità.
// Pianificato ogni giorno da Vercel Cron (vercel.json, ore 03:17 UTC, fuori
// dai picchi). Protetto da CRON_SECRET: Vercel invia l'intestazione
// «Authorization: Bearer <CRON_SECRET>»; senza segreto configurato la rotta
// resta spenta. Lo staff può sempre lanciare il ricalcolo dal back office.
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/server/settings";
import { recomputeUtility } from "@/lib/server/utility";
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
    if (!settings.utilityEnabled) {
      return NextResponse.json({ ok: true, skipped: "Riconoscimento di utilità disattivato nelle impostazioni." });
    }
    const stats = await recomputeUtility();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    return handleError(e);
  }
}
