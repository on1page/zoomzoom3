"use client";
// ZoomZoom — landing invito (riscatto), form recensione/rettifica, verifica
// esperienza documentale, area soggetto verificato, proposta scheda.
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmt1, fmtMonthYear } from "@/lib/client/api";
import { navigate } from "@/lib/client/router";
import { Alert, ChipCat, Modal, VerifBadge } from "../ui-kit";

/* ---------- Invito ---------- */
type InviteInfo =
  | { state: "invalid" | "revoked" | "expired" | "pending"; message: string }
  | {
    state: "valid"; experience: { entityName: string; categoryId: string; kind: string; period: string | null };
    maskedEmail: string; expiresAt: string; loggedIn: boolean; emailMatches: boolean;
  };

export function InviteView({ token }: { token: string }) {
  const { user, refreshBoot, toast } = useApp();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<InviteInfo>(`/api/invitations/info/${encodeURIComponent(token)}`);
    setInfo(res.ok ? res as unknown as InviteInfo : { state: "invalid", message: "Il collegamento non è valido." });
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  if (!info) return <div className="container section" style={{ maxWidth: 640 }}><p className="muted">Verifica dell&apos;invito…</p></div>;

  if (info.state !== "valid") {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <h1 className="sr-only">Invito a recensire</h1>
        <Alert kind="danger">
          <h1 style={{ margin: "0 0 8px", fontSize: "1.3rem" }}>Invito non utilizzabile</h1>
          {info.message}
        </Alert>
        {info.state === "expired" ? <p className="small">Se pensi sia un errore, scrivi dal modulo <a href="#/contatti">contatti</a>.</p> : null}
        <p className="small mt3"><a href="#/">&#8592; Torna alla home</a></p>
      </div>
    );
  }

  const claim = async () => {
    setBusy(true);
    const res = await api<{ experienceId: string }>("/api/invitations/redeem", { body: { token } });
    setBusy(false);
    if (res.ok) {
      await refreshBoot();
      toast("Invito accettato: esperienza collegata al tuo account.");
      navigate(`#/scrivi/${res.experienceId}`);
    } else {
      toast(res.error, "err");
      void load();
    }
  };

  return (
    <div className="container section" style={{ maxWidth: 640 }}>
      <h1 className="sr-only">Invito a recensire</h1>
      <Alert kind="ok"><b>Invito valido</b> — collegato a un&apos;esperienza registrata su ZoomZoom.</Alert>
      <div className="card mb2">
        <h2 style={{ marginTop: 0, fontSize: "1.15rem" }}>Esperienza da recensire</h2>
        <p className="mb1"><b>{info.experience.entityName}</b> · {info.experience.kind}{info.experience.period ? ` · ${info.experience.period}` : ""}</p>
        <p className="small mb1">Destinatario: <b>{info.maskedEmail}</b> · Scadenza: {new Date(info.expiresAt).toLocaleString("it-IT")} · Uso singolo</p>
        <p className="small muted mb0">La verifica attesta l&apos;esistenza dell&apos;interazione registrata (invito o documento): <b>non garantisce che ogni affermazione sia vera</b>. Le opinioni restano responsabilità di chi le scrive, con moderazione e appello.</p>
      </div>
      {!user ? (
        <>
          <Alert kind="info">Per usare l&apos;invito accedi o registrati con l&apos;indirizzo email a cui è destinato (<b>{info.maskedEmail}</b>): è così che colleghiamo la recensione all&apos;esperienza.</Alert>
          <div className="row">
            <a className="btn btn-primary" href="#/accedi">Accedi</a>
            <a className="btn btn-ghost" href="#/registrati">Registrati con quell&apos;email</a>
          </div>
        </>
      ) : !info.emailMatches ? (
        <Alert kind="danger">Questo invito è destinato a un altro indirizzo email. Stai usando l&apos;account <b>{user.email}</b>.</Alert>
      ) : (
        <button className="btn btn-primary" onClick={claim} disabled={busy}>Accetta l&apos;invito e scrivi la recensione</button>
      )}
      <p className="small mt3"><a href="#/">&#8592; Torna alla home</a></p>
    </div>
  );
}

/* ---------- Scrivi recensione ---------- */
export function WriteReviewView({ expId }: { expId: string }) {
  const { user, boot, toast } = useApp();
  const [state, setState] = useState<"loading" | "form" | "already" | "notavailable">("loading");
  const [exp, setExp] = useState<{ entityName: string; entityId: string; kind: string; period: string | null; catId: string } | null>(null);
  const [existingReviewId, setExistingReviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void api<{ experiences: Array<{ id: string; entity: { id: string; name: string }; kind: string; period: string | null; status: string; review: { id: string } | null }> }>("/api/me/overview").then(res => {
      if (!res.ok) return;
      const e = res.experiences.find(x => x.id === expId);
      if (!e || e.status !== "active") { setState("notavailable"); return; }
      if (e.review) { setExistingReviewId(e.review.id); setState("already"); return; }
      setExp({ entityName: e.entity.name, entityId: e.entity.id, kind: e.kind, period: e.period, catId: "" });
      setState("form");
    });
  }, [user, expId]);

  if (!user) {
    return (
      <div className="container section" style={{ maxWidth: 620 }}>
        <Alert kind="info">Per scrivere una recensione serve <a href="#/accedi">accedere</a>. Se hai ricevuto un invito, aprilo dal messaggio email.</Alert>
      </div>
    );
  }
  if (state === "loading") return <div className="container section"><p className="muted">Caricamento…</p></div>;
  if (state === "already") return (
    <div className="container section" style={{ maxWidth: 620 }}>
      <Alert kind="info">
        <h1 style={{ margin: "0 0 8px", fontSize: "1.3rem" }}>Hai già scritto questa recensione</h1>
        Per esperienza è ammessa una sola recensione: puoi aggiornarla con una <a href={`#/rettifica/${existingReviewId}`}>rettifica motivata</a>.
      </Alert>
    </div>
  );
  if (state === "notavailable" || !exp || !boot) return (
    <div className="container section" style={{ maxWidth: 620 }}>
      <Alert kind="danger">Questa esperienza non è attiva o non è collegata al tuo account. Gli inviti si usano dal messaggio ricevuto per email.</Alert>
    </div>
  );

  const cat = boot.categories.find(c => c.id === (exp.catId || ""));
  // la categoria si ricava dall'entità: la chiediamo alla scheda pubblica
  return <WriteReviewForm expId={expId} entityId={exp.entityId} entityName={exp.entityName} kind={exp.kind} period={exp.period} />;
}

function WriteReviewForm({ expId, entityId, entityName, kind, period }: { expId: string; entityId: string; entityName: string; kind: string; period: string | null }) {
  const { boot, toast, refreshBoot } = useApp();
  const [cat, setCat] = useState<{ id: string; name: string; criteria: { key: string; label: string }[]; priceUnits: string[] } | null>(null);
  const [form, setForm] = useState({ score: 5, crit: {} as Record<string, number>, priceAmount: "", priceUnit: "", priceKind: "Concluso/pagato", pros: "", cons: "", text: "", honesty: false, hp: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ category: typeof cat }>(`/api/public/entity/${entityId}`).then(res => {
      if (res.ok && res.category) setCat(res.category);
    });
  }, [entityId]);

  if (!boot) return null;
  if (!cat) return <div className="container section"><p className="muted">Caricamento criteri…</p></div>;

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Scrivi la recensione</h1>
          <p className="sub">{entityName} · {kind}{period ? ` · ${period}` : ""} <VerifBadge /></p>
        </div>
      </div>
      <Alert kind="info">Stelle e punteggio: il voto complessivo (0–10, step 0,5) verrà mostrato con la scala a cinque stelle e il valore numerico su 10. I criteri valutano aspetti specifici della categoria.</Alert>
      {boot.site.premiumEnabled ? (
        <Alert kind="ok"><b>Membership Premium.</b> Pubblicando questa recensione verificata ottieni <b>{boot.settings.premiumDaysPerReview} giorni di Premium</b>: ti permettono di leggere le recensioni integrali di tutte le schede. Il Premio è legato al contributo, non al voto; viene revocato se la moderazione accerta la frode.</Alert>
      ) : null}
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          setErr(null); setBusy(true);
          const res = await api<{ reviewId: string; entityId: string; premium: { grantedDays: number; until: string } | null }>("/api/reviews", {
            body: { experienceId: expId, ...form },
          });
          setBusy(false);
          if (res.ok) {
            if (res.premium && res.premium.grantedDays > 0) {
              const fino = res.premium.until ? new Date(res.premium.until).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }) : "";
              toast(`Recensione pubblicata: grazie! Membership Premium attivata per ${res.premium.grantedDays} giorni${fino ? ` (fino al ${fino})` : ""}.`);
            } else {
              toast("Recensione pubblicata: grazie.");
            }
            void refreshBoot(); // aggiorna subito lo stato Premium dell'utente
            navigate(`#/scheda/${entityId}`);
          } else setErr(res.error);
        }}>
          <div className="field">
            <label htmlFor="rv-score">Punteggio complessivo dell&apos;esperienza (0–10)</label>
            <div className="range-wrap">
              <input type="range" id="rv-score" min={0} max={10} step={0.5} value={form.score}
                onChange={e => setForm(f => ({ ...f, score: Number(e.target.value) }))} aria-describedby="rv-score-val" />
              <span className="range-val" id="rv-score-val" aria-live="polite">{fmt1(form.score)}</span>
            </div>
          </div>
          <fieldset>
            <legend>Valutazioni per criterio (specifiche della categoria &quot;{cat.name}&quot;)</legend>
            {cat.criteria.map(c => (
              <div className="field" key={c.key}>
                <label htmlFor={`rv-crit-${c.key}`}>{c.label}</label>
                <div className="range-wrap">
                  <input type="range" id={`rv-crit-${c.key}`} min={0} max={10} step={0.5}
                    value={form.crit[c.key] ?? 5}
                    onChange={e => setForm(f => ({ ...f, crit: { ...f.crit, [c.key]: Number(e.target.value) } }))}
                    aria-describedby={`rv-crit-${c.key}-val`} />
                  <span className="range-val" id={`rv-crit-${c.key}-val`} aria-live="polite">{fmt1(form.crit[c.key] ?? 5)}</span>
                </div>
              </div>
            ))}
          </fieldset>
          {cat.priceUnits.length ? (
            <fieldset>
              <legend>Prezzo richiesto e/o proposto (dato dichiarato, facoltativo)</legend>
              <div className="row">
                <div className="field mb0" style={{ flex: 1, minWidth: 120 }}>
                  <label htmlFor="rv-price">Importo (€)</label>
                  <input id="rv-price" type="number" min={1} step={1} placeholder="Es. 850" value={form.priceAmount} onChange={e => setForm(f => ({ ...f, priceAmount: e.target.value }))} />
                </div>
                <div className="field mb0" style={{ flex: 1, minWidth: 110 }}>
                  <label htmlFor="rv-price-unit">Periodo</label>
                  <select id="rv-price-unit" value={form.priceUnit || cat.priceUnits[0]} onChange={e => setForm(f => ({ ...f, priceUnit: e.target.value }))}>
                    {cat.priceUnits.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="field mb0" style={{ flex: 1, minWidth: 150 }}>
                  <label htmlFor="rv-price-kind">Natura</label>
                  <select id="rv-price-kind" value={form.priceKind} onChange={e => setForm(f => ({ ...f, priceKind: e.target.value }))}>
                    {["Richiesto", "Proposto/offerta", "Concluso/pagato"].map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>
              <span className="hint">Sarà mostrato come <b>dato dichiarato dal recensore</b>: la piattaforma non verifica gli importi, ma aiuta chi consulta a farsi un&apos;idea dei valori praticati.</span>
            </fieldset>
          ) : null}
          <div className="field">
            <label htmlFor="rv-pros">Aspetti positivi <span className="muted">(uno per riga, almeno uno)</span></label>
            <textarea id="rv-pros" required value={form.pros} onChange={e => setForm(f => ({ ...f, pros: e.target.value }))}
              placeholder={"Es.\nTempi di risposta rapidi\nCosti chiari fin dall'inizio"} />
          </div>
          <div className="field">
            <label htmlFor="rv-cons">Criticità <span className="muted">(una per riga, facoltativo)</span></label>
            <textarea id="rv-cons" value={form.cons} onChange={e => setForm(f => ({ ...f, cons: e.target.value }))}
              placeholder={"Es.\nDocumentazione consegnata in ritardo"} />
          </div>
          <div className="field">
            <label htmlFor="rv-text">Descrizione dell&apos;esperienza <span className="muted">(almeno 100 caratteri)</span></label>
            <textarea id="rv-text" required minLength={100} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
              placeholder="Racconta l'esperienza in modo concreto e rispettoso: cosa è successo, con quali tempi, quali esiti. Senza dati personali di terzi (nomi completi, telefoni, indirizzi privati)." />
            <span className="hint">Minimo 100 caratteri. Vedi le <a href="#/regole-recensioni">regole</a>.</span>
          </div>
          <label className="checkline mb2">
            <input type="checkbox" checked={form.honesty} onChange={e => setForm(f => ({ ...f, honesty: e.target.checked }))} required />
            <span><b>Dichiarazione:</b> l&apos;esperienza è personale e il contenuto rispetta le regole; non ho inserito dati personali di terzi senza autorizzazione né finalità promozionali.</span>
          </label>
          <div className="hp-field"><label htmlFor="rv-hp">Non compilare</label><input id="rv-hp" tabIndex={-1} autoComplete="off" value={form.hp} onChange={e => setForm(f => ({ ...f, hp: e.target.value }))} /></div>
          {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Pubblica la recensione</button>
        </form>
      </div>
    </div>
  );
}

/* ---------- Rettifica ---------- */
export function UpdateReviewView({ reviewId }: { reviewId: string }) {
  const { user, boot, toast } = useApp();
  const [state, setState] = useState<"loading" | "form" | "notFound" | "notEditable" | "windowOver">("loading");
  const [rev, setRev] = useState<{
    entityId: string; entityName: string; catId: string; score: number;
    criteria: Record<string, number>; pros: string[]; cons: string[]; text: string;
    price: { amount: number; unit: string; kind: string } | null; createdAt: string;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const res = await api<{ reviews: Array<{ id: string; entity: { id: string; name: string }; score: number; status: string; createdAt: string }> }>("/api/me/overview");
      if (!res.ok) return;
      const r = res.reviews.find(x => x.id === reviewId);
      if (!r) { setState("notFound"); return; }
      if (r.status !== "published") { setState("notEditable"); return; }
      const days = (Date.now() - new Date(r.createdAt).getTime()) / 86400000;
      if (days > (boot?.settings.rettificaDays ?? 30)) { setState("windowOver"); return; }
      const full = await api<{ reviews: Array<{ id: string; criteria: Record<string, number>; pros: string[]; cons: string[]; text: string; price: { amount: number; unit: string; kind: string } | null; entity: { id: string; name: string } }> }>(`/api/public/entity/${r.entity.id}`);
      if (full.ok) {
        const fr = (full as unknown as { reviews: Array<{ id: string; criteria: Record<string, number>; pros: string[]; cons: string[]; text: string; price: { amount: number; unit: string; kind: string } | null }> }).reviews.find(x => x.id === reviewId);
        if (fr) {
          setRev({
            entityId: r.entity.id, entityName: r.entity.name, catId: "", score: r.score,
            criteria: fr.criteria, pros: fr.pros, cons: fr.cons, text: fr.text, price: fr.price, createdAt: r.createdAt,
          });
          setState("form");
          return;
        }
      }
      setState("notFound");
    })();
  }, [user, reviewId, boot]);

  if (!user) return <div className="container section" style={{ maxWidth: 620 }}><Alert kind="info">Serve <a href="#/accedi">accedere</a> per rettificare una recensione.</Alert></div>;
  if (state === "loading") return <div className="container section"><p className="muted">Caricamento…</p></div>;
  if (state === "notFound") return <div className="container section" style={{ maxWidth: 620 }}><Alert kind="danger">Recensione non trovata.</Alert></div>;
  if (state === "notEditable") return (
    <div className="container section" style={{ maxWidth: 620 }}>
      <Alert kind="danger">La recensione non è modificabile in autonomia: è stata nascosta dalla moderazione. Scrivi dal modulo <a href="#/contatti">contatti</a> per la procedura di correzione.</Alert>
    </div>
  );
  if (state === "windowOver" || !rev || !boot) return (
    <div className="container section" style={{ maxWidth: 620 }}>
      <Alert kind="warn">
        <h1 style={{ margin: "0 0 8px", fontSize: "1.3rem" }}>Finestra di rettifica conclusa</h1>
        Puoi aggiornare autonomamente entro {boot?.settings.rettificaDays ?? 30} giorni dalla pubblicazione. Dopo, le correzioni passano dalla moderazione: usa il modulo <a href="#/contatti">contatti</a> indicando la recensione.
      </Alert>
    </div>
  );

  return <UpdateReviewForm reviewId={reviewId} rev={rev} />;
}

function UpdateReviewForm({ reviewId, rev }: { reviewId: string; rev: NonNullable<Parameters<typeof UpdateReviewView>[0]["rev"]> }) {
  const { boot, toast } = useApp();
  const [cat, setCat] = useState<{ name: string; criteria: { key: string; label: string }[]; priceUnits: string[] } | null>(null);
  const [form, setForm] = useState({
    score: rev.score, crit: rev.criteria, priceAmount: rev.price ? String(rev.price.amount) : "",
    priceUnit: rev.price?.unit || "", priceKind: rev.price?.kind || "Concluso/pagato",
    pros: rev.pros.join("\n"), cons: rev.cons.join("\n"), text: rev.text, honesty: true, hp: "",
    updateReason: "",
  });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void api<{ category: typeof cat }>(`/api/public/entity/${rev.entityId}`).then(res => {
      if (res.ok && res.category) setCat(res.category);
    });
  }, [rev.entityId]);
  if (!boot) return null;
  if (!cat) return <div className="container section"><p className="muted">Caricamento criteri…</p></div>;

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Aggiorna la recensione</h1>
          <p className="sub">{rev.entityName} · pubblicata {fmtMonthYear(rev.createdAt)} · aggiornabile entro {boot.settings.rettificaDays} giorni</p>
        </div>
      </div>
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          setErr(null);
          const res = await api(`/api/reviews/${reviewId}`, {
            method: "PUT",
            body: { ...form, updateReason: form.updateReason },
          });
          if (res.ok) {
            toast("Recensione aggiornata.");
            navigate(`#/scheda/${rev.entityId}`);
          } else setErr(res.error);
        }}>
          <div className="field">
            <label htmlFor="rv-score">Punteggio complessivo (0–10)</label>
            <div className="range-wrap">
              <input type="range" id="rv-score" min={0} max={10} step={0.5} value={form.score}
                onChange={e => setForm(f => ({ ...f, score: Number(e.target.value) }))} aria-describedby="rv-score-val" />
              <span className="range-val" id="rv-score-val" aria-live="polite">{fmt1(form.score)}</span>
            </div>
          </div>
          <fieldset>
            <legend>Valutazioni per criterio (categoria &quot;{cat.name}&quot;)</legend>
            {cat.criteria.map(c => (
              <div className="field" key={c.key}>
                <label htmlFor={`rv-crit-${c.key}`}>{c.label}</label>
                <div className="range-wrap">
                  <input type="range" id={`rv-crit-${c.key}`} min={0} max={10} step={0.5}
                    value={form.crit[c.key] ?? 5}
                    onChange={e => setForm(f => ({ ...f, crit: { ...f.crit, [c.key]: Number(e.target.value) } }))}
                    aria-describedby={`rv-crit-${c.key}-val`} />
                  <span className="range-val" id={`rv-crit-${c.key}-val`} aria-live="polite">{fmt1(form.crit[c.key] ?? 5)}</span>
                </div>
              </div>
            ))}
          </fieldset>
          {cat.priceUnits.length ? (
            <fieldset>
              <legend>Prezzo dichiarato (facoltativo)</legend>
              <div className="row">
                <div className="field mb0" style={{ flex: 1, minWidth: 120 }}>
                  <label htmlFor="rv-price">Importo (€)</label>
                  <input id="rv-price" type="number" min={1} step={1} value={form.priceAmount} onChange={e => setForm(f => ({ ...f, priceAmount: e.target.value }))} />
                </div>
                <div className="field mb0" style={{ flex: 1, minWidth: 110 }}>
                  <label htmlFor="rv-price-unit">Periodo</label>
                  <select id="rv-price-unit" value={form.priceUnit || cat.priceUnits[0]} onChange={e => setForm(f => ({ ...f, priceUnit: e.target.value }))}>
                    {cat.priceUnits.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="field mb0" style={{ flex: 1, minWidth: 150 }}>
                  <label htmlFor="rv-price-kind">Natura</label>
                  <select id="rv-price-kind" value={form.priceKind} onChange={e => setForm(f => ({ ...f, priceKind: e.target.value }))}>
                    {["Richiesto", "Proposto/offerta", "Concluso/pagato"].map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>
            </fieldset>
          ) : null}
          <div className="field">
            <label htmlFor="rv-pros">Aspetti positivi (uno per riga)</label>
            <textarea id="rv-pros" required value={form.pros} onChange={e => setForm(f => ({ ...f, pros: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="rv-cons">Criticità (una per riga)</label>
            <textarea id="rv-cons" value={form.cons} onChange={e => setForm(f => ({ ...f, cons: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="rv-text">Descrizione dell&apos;esperienza (almeno 100 caratteri)</label>
            <textarea id="rv-text" required minLength={100} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="rv-reason">Motivo della rettifica <span className="muted">(almeno 10 caratteri, sarà visibile sulla recensione)</span></label>
            <input id="rv-reason" required minLength={10} value={form.updateReason} onChange={e => setForm(f => ({ ...f, updateReason: e.target.value }))} placeholder="Es. aggiornamento dopo l'intervento promesso" />
          </div>
          <div className="hp-field"><label htmlFor="rv-hp">Non compilare</label><input id="rv-hp" tabIndex={-1} autoComplete="off" value={form.hp} onChange={e => setForm(f => ({ ...f, hp: e.target.value }))} /></div>
          {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" type="submit">Salva aggiornamento</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- Verifica esperienza (upload) ---------- */
export function VerifyExperienceView() {
  const { user, boot, toast } = useApp();
  const [cat, setCat] = useState("");
  const [ent, setEnt] = useState("");
  const [kind, setKind] = useState("");
  const [period, setPeriod] = useState(String(new Date().getFullYear()));
  const [note, setNote] = useState("");
  const [hp, setHp] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return <div className="container section" style={{ maxWidth: 700 }}><Alert kind="info">Per richiedere la verifica di un&apos;esperienza serve <a href="#/accedi">accedere</a>.</Alert></div>;
  if (!boot) return null;
  const selCat = boot.categories.find(c => c.id === cat);
  const entitiesOf = (catId: string) => null; // popolato via API sotto

  return (
    <div className="container" style={{ maxWidth: 700, paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Verifica la tua esperienza</h1>
          <p className="sub">Per recensire serve un&apos;esperienza registrata. Se non hai ricevuto un invito, puoi proporre la verifica documentale.</p>
        </div>
      </div>
      <Alert kind="info">Carica un documento che dimostri l&apos;esperienza (contratto, fattura, delibera, email di conferma…). Un moderatore valuterà la richiesta, di norma entro 7 giorni. Il documento è accessibile solo al personale autorizzato e viene cancellato dopo la decisione.</Alert>
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          setErr(null); setBusy(true);
          const fd = new FormData();
          fd.set("entityId", ent); fd.set("kind", kind); fd.set("period", period);
          fd.set("note", note); fd.set("hp", hp);
          if (file) fd.set("proof", file);
          const res = await fetch("/api/experiences/verify-request", { method: "POST", body: fd });
          const data = await res.json() as { ok: boolean; error?: string };
          setBusy(false);
          if (data.ok) {
            toast("Richiesta registrata: la moderazione valuterà l'esperienza.");
            navigate("#/profilo");
          } else setErr(data.error || "Errore.");
        }}>
          <div className="field">
            <label htmlFor="ve-cat">Categoria del soggetto</label>
            <select id="ve-cat" required value={cat} onChange={e => { setCat(e.target.value); setEnt(""); setKind(""); }}>
              <option value="">— Scegli —</option>
              {boot.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {selCat ? (
            <>
              <EntitySelect catId={selCat.id} value={ent} onChange={setEnt} />
              <div className="field">
                <label htmlFor="ve-kind">Tipo di esperienza</label>
                <select id="ve-kind" required value={kind} onChange={e => setKind(e.target.value)}>
                  <option value="">— Scegli il tipo —</option>
                  {selCat.experienceKinds.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </>
          ) : null}
          <div className="field">
            <label htmlFor="ve-period">Periodo (anno)</label>
            <input id="ve-period" type="number" min={2015} max={new Date().getFullYear()} value={period} onChange={e => setPeriod(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="ve-proof">Documento dimostrativo</label>
            <input id="ve-proof" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={e => setFile(e.target.files?.[0] || null)} />
            <span className="hint">PDF, PNG, JPG o WebP, massimo 8 MB. Il documento è archiviato in area privata, accessibile solo alla moderazione e cancellato dopo la decisione.</span>
          </div>
          <div className="field">
            <label htmlFor="ve-note">Note per la moderazione</label>
            <textarea id="ve-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Indicazioni utili, senza dati personali di terzi."></textarea>
          </div>
          <div className="hp-field"><label htmlFor="ve-hp">Non compilare</label><input id="ve-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} /></div>
          {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>Invia richiesta di verifica</button>
        </form>
      </div>
      <p className="small muted mt2">Non trovi la scheda? <a href="#/proponi-soggetto">Proponi un soggetto</a>.</p>
    </div>
  );
}

function EntitySelect({ catId, value, onChange }: { catId: string; value: string; onChange: (v: string) => void }) {
  const [ents, setEnts] = useState<Array<{ id: string; name: string; zoneName?: string }>>([]);
  const { boot } = useApp();
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/public/search?cat=${catId}`);
      const data = await res.json() as { rows?: Array<{ entity: { id: string; name: string; zoneId: string | null } }> };
      setEnts((data.rows || []).map(r => ({
        id: r.entity.id, name: r.entity.name,
        zoneName: boot?.zones.find(z => z.id === r.entity.zoneId)?.name,
      })));
    })();
  }, [catId, boot]);
  return (
    <div className="field">
      <label htmlFor="ve-ent">Soggetto</label>
      <select id="ve-ent" required value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— Scegli il soggetto —</option>
        {ents.map(e => <option key={e.id} value={e.id}>{e.name}{e.zoneName ? ` (${e.zoneName})` : ""}</option>)}
      </select>
    </div>
  );
}

/* ---------- Area soggetto verificato ---------- */
export function SubjectAreaView() {
  const { user, boot, toast } = useApp();
  const [data, setData] = useState<{
    entity: { id: string; name: string; categoryId: string };
    category: { name: string; experienceKinds: string[] } | null;
    stats: { n: number; mean: number | null };
    invites: { sentToday: number; cap: number; approvalAbove: number };
    experiences: Array<{ id: string; clientEmail: string; kind: string; period: string | null; status: string; createdAt: string; invite: { expiresAt: string; usedAt: string | null; revoked: boolean } | null; reviewScore: number | null }>;
    settings: { inviteExpiryDays: number };
  } | null>(null);
  const [form, setForm] = useState({ clientEmail: "", kind: "", period: String(new Date().getFullYear()), fair: false, hp: "" });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<NonNullable<typeof data>>("/api/subject/overview");
    if (res.ok) setData(res);
  }, []);
  useEffect(() => { if (user) void load(); }, [user, load]);

  if (!user) return <div className="container section" style={{ maxWidth: 760 }}><Alert kind="info">Area riservata ai soggetti verificati: <a href="#/accedi">accedi</a> con l&apos;account collegato alla tua scheda.</Alert></div>;
  if (!data || !boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;

  return (
    <div className="container" style={{ paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Area del soggetto verificato</h1>
          <p className="sub">{data.entity.name} · {data.category?.name}</p>
        </div>
        <a className="btn btn-ghost" href={`#/scheda/${data.entity.id}`}>Vedi la scheda pubblica</a>
      </div>
      <div className="grid grid-3 mb2">
        <div className="stat">
          <div className="v">{data.stats.mean == null ? "—" : fmt1(data.stats.mean)}</div>
          <div className="l">Media complessiva</div>
          <div className="d">{data.stats.n} recensioni verificate</div>
        </div>
        <div className="stat">
          <div className="v">{data.invites.sentToday}/{data.invites.cap}</div>
          <div className="l">Inviti usati oggi</div>
          <div className="d">Limite anti-abuso per soggetto</div>
        </div>
        <div className="stat">
          <div className="v">{data.experiences.length}</div>
          <div className="l">Esperienze registrate</div>
          <div className="d">Totali per questa scheda</div>
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 26 }}>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Registra un&apos;esperienza e invita il cliente</h2>
          <form onSubmit={async e => {
            e.preventDefault();
            setErr(null);
            const res = await api("/api/subject/experience", { body: { ...form, entityId: data.entity.id } });
            if (res.ok) {
              toast("Esperienza registrata e invito inviato: il cliente lo troverà nella propria email.");
              setForm(f => ({ ...f, clientEmail: "", fair: false }));
              void load();
            } else setErr(res.error);
          }}>
            <div className="field">
              <label htmlFor="be-email">Email del cliente</label>
              <input id="be-email" type="email" required value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} placeholder="cliente@esempio.it" />
              <span className="hint">L&apos;invito sarà valido {data.settings.inviteExpiryDays} giorni, un solo uso, legato a questo indirizzo.</span>
            </div>
            <div className="field">
              <label htmlFor="be-kind">Tipo di esperienza</label>
              <select id="be-kind" required value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                <option value="">— Scegli —</option>
                {(data.category?.experienceKinds || []).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="be-period">Periodo (anno)</label>
              <input id="be-period" type="number" min={2015} max={new Date().getFullYear()} value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} required />
            </div>
            <label className="checkline mb2">
              <input type="checkbox" checked={form.fair} onChange={e => setForm(f => ({ ...f, fair: e.target.checked }))} required />
              <span><b>Dichiarazione:</b> invito <em>tutti</em> i clienti coinvolti in questa interazione, non soltanto quelli soddisfatti. L&apos;invio selettivo viola le regole e può portare alla sospensione della scheda.</span>
            </label>
            <div className="hp-field"><label htmlFor="be-hp">Non compilare</label><input id="be-hp" tabIndex={-1} autoComplete="off" value={form.hp} onChange={e => setForm(f => ({ ...f, hp: e.target.value }))} /></div>
            {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
            <button className="btn btn-primary" type="submit">Registra e invia invito</button>
          </form>
          <p className="small muted mt2 mb0">Oltre {data.invites.approvalAbove} inviti al giorno l&apos;esperienza richiede l&apos;approvazione della moderazione prima di diventare attiva.</p>
        </div>
        <div>
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Esperienze e inviti</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Cliente</th><th scope="col">Stato</th><th scope="col">Invito</th><th scope="col">Recensione</th></tr></thead>
              <tbody>
                {data.experiences.map(e => (
                  <tr key={e.id}>
                    <td>{maskEmail(e.clientEmail)}<br /><span className="small muted">{e.kind}{e.period ? ` · ${e.period}` : ""}</span></td>
                    <td>{e.status === "pending" ? <span className="pill pill-amber">In approvazione</span> : <span className="pill pill-green">Attiva</span>}</td>
                    <td>
                      {!e.invite ? <span className="pill pill-gray">—</span>
                        : e.invite.usedAt ? <span className="pill pill-green">Invito riscattato</span>
                        : e.invite.revoked ? <span className="pill pill-red">Revocato</span>
                        : new Date(e.invite.expiresAt) < new Date() ? <span className="pill pill-gray">Invito scaduto</span>
                        : <span className="pill pill-amber">Invito in attesa</span>}
                    </td>
                    <td>{e.reviewScore != null ? `${fmt1(e.reviewScore)}/10` : "—"}</td>
                  </tr>
                ))}
                {!data.experiences.length ? <tr><td colSpan={4} className="muted">Nessuna esperienza registrata.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <Alert kind="warn">
            <b>Anticipazione delle recensioni negative?</b> Non è possibile bloccare la pubblicazione: le recensioni negative verificate sono parte del contratto di trasparenza del servizio. Puoi rispondere attraverso il modulo contatti: la moderazione valuta l&apos;inserimento di una nota.
          </Alert>
        </div>
      </div>
    </div>
  );
}

function maskEmail(em: string): string {
  const p = em.split("@");
  return p.length === 2 ? `${p[0].slice(0, 1)}*****@${p[1]}` : "—";
}

/* ---------- Proponi un soggetto ---------- */
export function ProposeView() {
  const { user, boot, toast } = useApp();
  const [form, setForm] = useState({ categoryId: "", name: "", subtitle: "", address: "", zoneId: "", justification: "", contactEmail: user?.email || "", hp: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!boot) return null;
  const selCat = boot.categories.find(c => c.id === form.categoryId);
  return (
    <div className="container" style={{ maxWidth: 640, paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Proponi un soggetto</h1>
          <p className="sub">La creazione delle schede passa dalla revisione della moderazione: così evitiamo schede arbitrarie o usate per scopi impropri.</p>
        </div>
      </div>
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          setErr(null);
          const res = await api("/api/proposals", { body: form });
          if (res.ok) {
            toast("Proposta inviata: la moderazione la valuterà.");
            setForm(f => ({ ...f, name: "", subtitle: "", address: "", zoneId: "", justification: "" }));
          } else setErr(res.error);
        }}>
          <div className="field">
            <label htmlFor="pr-cat">Categoria</label>
            <select id="pr-cat" required value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
              <option value="">— Scegli —</option>
              {boot.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pr-name">Nome della scheda</label>
            <input id="pr-name" required minLength={3} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Es. Impresa Edile XYZ" />
            <span className="hint">Per le persone fisiche verranno usate solo le iniziali, decise dalla moderazione.</span>
          </div>
          <div className="field">
            <label htmlFor="pr-sub">Breve descrizione (facoltativa)</label>
            <input id="pr-sub" value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="Es. Manutenzione caldaie e impianti" />
          </div>
          {selCat && !selCat.isPerson ? (
            <div className="field">
              <label htmlFor="pr-addr">Indirizzo (solo per immobili e attività)</label>
              <input id="pr-addr" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Via, civico, città" />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="pr-zone">Zona di riferimento</label>
            <select id="pr-zone" value={form.zoneId} onChange={e => setForm(f => ({ ...f, zoneId: e.target.value }))}>
              <option value="">— Scegli —</option>
              {boot.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pr-just">Perché è utile questa scheda</label>
            <textarea id="pr-just" required minLength={20} value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))} placeholder="Es. ho interagito con questo professionista e vorrei poter condividere l'esperienza verificata."></textarea>
          </div>
          {!user ? (
            <div className="field">
              <label htmlFor="pr-email">Email di contatto</label>
              <input id="pr-email" type="email" required value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="nome@esempio.it" />
            </div>
          ) : null}
          <div className="hp-field"><label htmlFor="pr-hp">Non compilare</label><input id="pr-hp" tabIndex={-1} autoComplete="off" value={form.hp} onChange={e => setForm(f => ({ ...f, hp: e.target.value }))} /></div>
          {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
          <button className="btn btn-primary" type="submit">Invia proposta</button>
        </form>
      </div>
    </div>
  );
}
