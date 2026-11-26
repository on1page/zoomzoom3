"use client";
// ZoomZoom — Abbonamento Premium (percorso ② del modello D11: «chi non
// contribuisce, paga»). Piani dichiarati con prezzi chiari (Silver 1 giorno /
// 1 €, Gold 7 giorni / 5 €, Platinum 30 giorni / 20 € — modificabili dal back
// office), pagamento con bonifico tracciato e causale-codice, registrazione
// dello staff, PremiumGrant di origine «acquisto». Onestà dichiarata: il
// Premium si può anche guadagnare contribuendo, e il prezzo lo dice.
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmtDateTime } from "@/lib/client/api";
import { Alert } from "../ui-kit";

const fmtEuro = (cents: number) =>
  (cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type OrderRow = {
  id: string; planSlug: string; planName: string; days: number; priceCents: number;
  code: string; status: string; paymentRef: string | null;
  createdAt: string; paidAt: string | null;
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "In attesa del bonifico",
  paid: "Pagato — Premium attivato",
  cancelled: "Annullato",
};

function OrderStatusPill({ status }: { status: string }) {
  const cls = status === "paid" ? "pill pill-green" : status === "cancelled" ? "pill pill-gray" : "pill pill-amber";
  return <span className={cls}>{ORDER_STATUS_LABEL[status] || status}</span>;
}

export function SubscriptionView() {
  const { boot, user, toast } = useApp();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [payment, setPayment] = useState<{ iban: string; instructions: string } | null>(null);
  const [plansEnabled, setPlansEnabled] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<{ planName: string; code: string; priceCents: number; days: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setOrders([]); return; }
    const res = await api<{
      premium: {
        orders: OrderRow[];
        plansEnabled: boolean;
        payment: { iban: string; instructions: string };
      };
    }>("/api/me/overview");
    if (res.ok) {
      setOrders(res.premium.orders || []);
      setPlansEnabled(res.premium.plansEnabled !== false);
      setPayment(res.premium.payment);
    }
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  const order = async (slug: string) => {
    setErr(null); setBusy(slug);
    const res = await api<{
      order: { planName: string; code: string; priceCents: number; days: number };
    }>("/api/me/subscription", { body: { planSlug: slug } });
    setBusy(null);
    if (res.ok) {
      setLastOrder(res.order);
      toast("Ordine aperto: paga con la causale indicata.");
      void load();
    } else setErr(res.error);
  };

  const cancel = async (id: string) => {
    const res = await api(`/api/me/subscription/${id}/action`, { body: { action: "cancel" } });
    if (res.ok) { toast("Ordine annullato."); void load(); }
    else toast(res.error, "err");
  };

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;
  const plans = boot.settings.premiumPlans || [];
  const daysPerReview = boot.settings.premiumDaysPerReview;

  return (
    <div className="container section" style={{ maxWidth: 880 }}>
      <h1>Abbonamento Premium</h1>
      <Alert kind="info">
        Con il Premium leggi le <b>indagini integrali</b> di tutte le schede (i punti di forza, le criticità, i prezzi dichiarati) e voti l&apos;utilità di quelle degli altri.
        Puoi <b>guadagnartelo contribuendo</b> ({daysPerReview} giorni per ogni indagine pubblicata) oppure <b>acquistarlo</b> con uno dei piani qui sotto.
      </Alert>

      {!boot.settings.premiumPlansEnabled || !plansEnabled ? (
        <Alert kind="warn">La vendita di abbonamenti è temporaneamente sospesa: il Premium si può comunque guadagnare contribuendo con le indagini della community.</Alert>
      ) : null}

      <div className="grid" style={{ gap: 14 }}>
        {plans.map(p => (
          <div key={p.slug} className="card card-pad-s" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ minWidth: 200, flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Piano {p.name}</h2>
              <p className="small mb0" style={{ marginTop: 4 }}>
                <b>{p.days} {p.days === 1 ? "giorno" : "giorni"}</b> di Membership Premium
                {p.slug === "gold" && daysPerReview === p.days ? <> — come {daysPerReview} giorni per {fmtEuro(p.priceCents)} €: lo stesso premio di UNA indagine pubblicata (trasparenza della taratura)</> : null}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>{fmtEuro(p.priceCents)} €</p>
              <p className="small muted" style={{ margin: 0 }}>{fmtEuro(Math.round(p.priceCents / p.days))} € / giorno</p>
            </div>
            {!user ? (
              <a className="btn btn-primary" href="#/accedi">Accedi per ordinare</a>
            ) : !user.emailVerified ? (
              <span className="pill pill-amber">Conferma prima l&apos;email</span>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!!busy || !boot.settings.premiumPlansEnabled || !plansEnabled}
                onClick={() => void order(p.slug)}
              >
                {busy === p.slug ? "Apertura…" : "Ordina"}
              </button>
            )}
          </div>
        ))}
      </div>

      {err ? <p className="error-msg" style={{ display: "block", marginTop: 10 }}>{err}</p> : null}

      {lastOrder ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Ordine aperto: piano {lastOrder.planName}</h2>
          <p className="small">Per attivare i {lastOrder.days} {lastOrder.days === 1 ? "giorno" : "giorni"} di Premium salda <b>{fmtEuro(lastOrder.priceCents)} €</b> con bonifico usando <b>esattamente</b> questa causale:</p>
          <p className="mono" style={{ background: "var(--paper)", padding: 10, borderRadius: 8, fontSize: "1.05rem", wordBreak: "break-all" }}>
            ZoomZoom Premium {lastOrder.code}
          </p>
          {payment?.iban ? <p className="small">IBAN della piattaforma: <b className="mono">{payment.iban}</b></p> : null}
          {payment?.instructions ? <p className="small" style={{ whiteSpace: "pre-wrap" }}>{payment.instructions}</p> : (
            <p className="small muted">Le istruzioni complete (IBAN e intestatario) sono indicate qui dal gestore della piattaforma; in mancanza, chiedile dal <a href="#/contatti">modulo contatti</a>.</p>
          )}
          <p className="small muted mb0">Il Premium parte quando lo staff registra il pagamento (di solito entro un giorno lavorativo). La causale-codice serve ad abbinare il bonifico al tuo ordine: senza, l&apos;attivazione slitta.</p>
        </div>
      ) : null}

      <h2 style={{ marginTop: 26 }}>Come si paga (dichiarato prima di comprare)</h2>
      <ul className="small" style={{ paddingLeft: 20 }}>
        <li><b>Bonifico tracciato con causale-codice.</b> Ogni ordine ha un codice univoco (es. SUB-4K7F2Q): lo riporti nella causale e il pagamento resta tracciato per entrambi (modello già usato per le perizie);</li>
        <li><b>Attivazione dopo registrazione.</b> Lo staff registra l&apos;incasso e il Premium parte da quel momento; di solito entro un giorno lavorativo;</li>
        <li><b>Niente rinnovo automatico.</b> Nessun circuito di pagamento, nessun dato di carta: alla scadenza il Premium si riattiva con un nuovo ordine o con un contributo;</li>
        <li><b>Annullamento libero.</b> Finché il bonifico non è registrato puoi annullare l&apos;ordine dal tuo profilo o da qui sotto;</li>
        <li><b>Prezzi dichiarati.</b> I piani e i prezzi sono quelli pubblicati qui sopra, impostati dal gestore; nessun costo nascosto oltre l&apos;importo indicato.</li>
      </ul>

      {user ? (
        <>
          <h2 style={{ marginTop: 26 }}>I tuoi ordini</h2>
          {orders == null ? (
            <p className="muted">Caricamento…</p>
          ) : orders.length ? (
            orders.map(o => (
              <article key={o.id} className="card card-pad-s mb2" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <b>{o.planName}</b> <span className="small muted">{o.days} {o.days === 1 ? "giorno" : "giorni"} · {fmtEuro(o.priceCents)} €</span>
                    {o.status === "pending" ? <span className="mono small" style={{ background: "var(--paper)", padding: "2px 8px", borderRadius: 6 }}>causale: ZoomZoom Premium {o.code}</span> : null}
                  </div>
                  <p className="small muted mb0" style={{ marginTop: 4 }}>
                    Aperto il {fmtDateTime(o.createdAt)}{o.paidAt ? ` · pagato il ${fmtDateTime(o.paidAt)}` : ""}{o.paymentRef ? ` · rif. ${o.paymentRef}` : ""}
                  </p>
                </div>
                <div className="row">
                  <OrderStatusPill status={o.status} />
                  {o.status === "pending" ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => void cancel(o.id)}>Annulla</button>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <p className="small muted">Nessun ordine: quando ne apri uno, qui trovi la causale e lo stato.</p>
          )}
        </>
      ) : (
        <p className="small muted mt2">Per ordinare serve un account: <a href="#/accedi">accedi</a> o <a href="#/registrati">registrati</a>. Intanto i prezzi sono quelli dichiarati sopra, e restano uguali dopo l&apos;accesso.</p>
      )}
    </div>
  );
}
