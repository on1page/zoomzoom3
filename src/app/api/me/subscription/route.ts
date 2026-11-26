// POST /api/me/subscription — percorso ② del modello D11: «chi non
// contribuisce, paga». L'utente registrato (email verificata) sceglie un
// piano (Silver/Gold/Platinum, configurabili dal back office) e apre un
// ordine: il pagamento è un BONIFICO TRACCIATO con causale-codice SUB-XXXXXX
// (come le perizie — K8); alla registrazione dello staff nasce il PremiumGrant
// di origine «acquisto». Nessun circuito di pagamento automatico: Stripe
// resta l'evoluzione successiva, non un prerequisito.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { guard, readJson, handleError, fail } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { uniqueSubscriptionCode } from "@/lib/server/perizie";
import { sendMail } from "@/lib/server/mailer";
import { auditLog } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.emailVerified) return fail("Conferma prima l'indirizzo email dal collegamento ricevuto via email.", 403);
    guard(req, "subscription", 20, 3600);

    const settings = await getSettings();
    if (!settings.premiumPlansEnabled) {
      return fail("La vendita di abbonamenti è temporaneamente sospesa.", 403);
    }
    if (!settings.premiumEnabled) {
      return fail("Membership Premium è temporaneamente sospesa.", 403);
    }
    // anti-abuso: 5 ordini al giorno e massimo 3 ordini in attesa insieme
    const rl = rateLimit(`subscription:${user.id}`, 5, 86400);
    if (!rl.ok) return fail("Hai già aperto 5 ordini nelle ultime 24 ore: riprova domani.", 429);
    const pending = await db.subscriptionOrder.count({
      where: { userId: user.id, status: "pending" },
    });
    if (pending >= 3) {
      return fail("Hai già 3 ordini in attesa di pagamento: attendi la registrazione o annullane qualcuno dal profilo.", 429);
    }

    const p = await readJson<{ planSlug?: string }>(req);
    const plan = settings.premiumPlans.find(x => x.slug === String(p.planSlug || ""));
    if (!plan) return fail("Piano non disponibile: scegli Silver, Gold o Platinum.", 400);

    const code = await uniqueSubscriptionCode();
    const order = await db.subscriptionOrder.create({
      data: {
        userId: user.id,
        planSlug: plan.slug,
        planName: plan.name,
        days: plan.days,
        priceCents: plan.priceCents,
        code,
      },
    });
    await auditLog({
      actorId: user.id, actorRole: user.role,
      action: "Ordine di abbonamento Premium aperto",
      targetType: "subscriptionOrder", targetId: order.id,
      reason: `piano ${plan.name}: ${plan.days} giorni per € ${(plan.priceCents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`,
      isDemo: user.isDemo,
    });

    // istruzioni di pagamento: causale-codice univoca per riconciliare il
    // bonifico (nessun circuito automatico — K8)
    void sendMail(
      user.email,
      `ZoomZoom — ordine piano ${plan.name}: istruzioni di pagamento`,
      `Hai aperto l'ordine del piano ${plan.name} (${plan.days} giorni di Membership Premium, € ${(plan.priceCents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}).\nPer attivarlo salda con bonifico usando ESATTAMENTE questa causale: ${code}\nIl Premium parte quando lo staff registra il pagamento (di solito entro un giorno lavorativo).\nPuoi annullare l'ordine in ogni momento, finché è in attesa, dal tuo profilo.`,
      [{ label: "Il tuo profilo", href: "/#/profilo" }],
    );

    return NextResponse.json({
      ok: true,
      order: {
        id: order.id,
        planSlug: order.planSlug,
        planName: order.planName,
        days: order.days,
        priceCents: order.priceCents,
        code: order.code,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
      },
      payment: {
        iban: settings.platformIban,
        instructions: settings.paymentInstructions,
        causale: `ZoomZoom Premium ${code}`,
        importo: `€ ${(order.priceCents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
