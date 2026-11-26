"use client";
// ZoomZoom — ricerca con filtri chiari e ordinamento trasparente.
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/client/store";
import { navigate, useHashRoute } from "@/lib/client/router";
import { api } from "@/lib/client/api";
import { Alert, EntityCard, MethodNoteBox, type EntCardData } from "../ui-kit";

type SearchRow = {
  entity: { id: string; name: string; categoryId: string; subtitle: string | null; address: string | null; zoneId: string | null; verifiedBusiness: boolean; isDemo: boolean };
  n: number; mean: number | null; weighted: number | null; sufficient: boolean;
};

export function SearchView() {
  const { boot } = useApp();
  const route = useHashRoute();
  const p = route.params;
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  // Atterraggio diretto su #/cerca?q=…: partono due ricerche (la prima, senza
  // filtri, per il primo render con la route predefinita; poi quella reale).
  // Se la prima risponde per ultima NON deve sovrascrivere i filtri: conta le
  // invocazioni e applica solo la risposta più recente.
  const searchSeq = useRef(0);
  const [form, setForm] = useState({
    q: p.q || "", cats: p.cat ? p.cat.split(",") : [], zona: p.zona || "",
    pmin: p.pmin || "", pmax: p.pmax || "", punit: p.punit || "",
    suff: p.suff === "1", ord: p.ord || "rilevanza",
  });

  const runSearch = useCallback(async () => {
    const seq = ++searchSeq.current;
    const params = new URLSearchParams();
    if (p.q) params.set("q", p.q);
    if (p.cat) params.set("cat", p.cat);
    if (p.zona) params.set("zona", p.zona);
    if (p.suff) params.set("suff", p.suff);
    if (p.ord) params.set("ord", p.ord);
    if (p.pmin) params.set("pmin", p.pmin);
    if (p.pmax) params.set("pmax", p.pmax);
    if (p.punit) params.set("punit", p.punit);
    const res = await api<{ rows: SearchRow[] }>(`/api/public/search?${params.toString()}`);
    if (seq !== searchSeq.current) return; // risposta superata da una più recente
    setRows(res.ok ? res.rows : []);
  }, [p.q, p.cat, p.zona, p.suff, p.ord, p.pmin, p.pmax, p.punit]);

  useEffect(() => { void runSearch(); }, [runSearch]);

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;
  const allUnits = Array.from(new Set(boot.categories.flatMap(c => c.priceUnits)));

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const qp = new URLSearchParams();
    if (form.q.trim()) qp.set("q", form.q.trim());
    if (form.cats.length) qp.set("cat", form.cats.join(","));
    if (form.zona) qp.set("zona", form.zona);
    if (form.pmin) qp.set("pmin", form.pmin);
    if (form.pmax) qp.set("pmax", form.pmax);
    if (form.punit) qp.set("punit", form.punit);
    if (form.suff) qp.set("suff", "1");
    if (form.ord) qp.set("ord", form.ord);
    navigate(`#/cerca${qp.toString() ? `?${qp.toString()}` : ""}`);
  };

  const zoneName = (id: string | null) => boot.zones.find(z => z.id === id)?.name || "";

  return (
    <div className="container">
      <div className="section-head" style={{ paddingTop: 26 }}>
        <div>
          <h1>Cerca schede e indagini</h1>
          <p className="sub">Immobili, professionisti, agenzie e soggetti della casa. La consultazione è libera: non serve un account.</p>
        </div>
        {boot.site.openReviewsEnabled ? (
          <a className="btn btn-primary btn-sm" href="#/recensione">Non c&apos;è? Aggiungilo tu</a>
        ) : null}
      </div>
      {rows && !rows.length ? (
        <Alert kind="info">
          Nessun risultato. Se l&apos;immobile che cerchi non è ancora qui, puoi <a href="#/recensione"><b>aggiungerlo tu dall&apos;indirizzo</b></a> e avviare la prima indagine della community: niente catalogo vuoto, il primo mattone lo porti tu (con {boot.settings.premiumDaysPerReview} giorni di Premium).
          {boot.site.periziaBachecaEnabled && boot.site.consulentiEnabled ? (
            <><br />Oppure <a href={`#/indagine${p.q ? `?addr=${encodeURIComponent(p.q)}` : ""}`}><b>chiedi un&apos;indagine professionale</b></a> per questo indirizzo: geometri, ingegneri e periti della zona ricevono la richiesta e il primo che accetta consegna una relazione scritta (con pagamento tracciato e consegna entro {boot.settings.periziaDeadlineDays} giorni).</>
          ) : null}
        </Alert>
      ) : null}
      <div className="grid grid-side">
        <form className="card card-pad-s" role="search" onSubmit={apply}>
          <div className="field">
            <label htmlFor="sq">Parola chiave</label>
            <input id="sq" type="search" value={form.q} onChange={e => setForm(f => ({ ...f, q: e.target.value }))} placeholder="nome, indirizzo, zona…" />
          </div>
          <fieldset>
            <legend>Categorie</legend>
            {boot.categories.filter(c => c.id !== "zona").map(c => (
              <label className="checkline" style={{ marginBottom: 6 }} key={c.id}>
                <input type="checkbox" checked={form.cats.includes(c.id)}
                  onChange={e => setForm(f => ({
                    ...f,
                    cats: e.target.checked ? [...f.cats, c.id] : f.cats.filter(x => x !== c.id),
                  }))} />
                <span>{c.shortName}</span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="sz">Città</label>
            <select id="sz" value={form.zona} onChange={e => setForm(f => ({ ...f, zona: e.target.value }))}>
              <option value="">Tutte</option>
              {boot.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <fieldset>
            <legend>Prezzo dichiarato</legend>
            <div className="row">
              <div className="field mb0" style={{ flex: 1, minWidth: 90 }}>
                <label htmlFor="sp-min">Da (€)</label>
                <input id="sp-min" type="number" min={0} step={10} value={form.pmin} onChange={e => setForm(f => ({ ...f, pmin: e.target.value }))} />
              </div>
              <div className="field mb0" style={{ flex: 1, minWidth: 90 }}>
                <label htmlFor="sp-max">A (€)</label>
                <input id="sp-max" type="number" min={0} step={10} value={form.pmax} onChange={e => setForm(f => ({ ...f, pmax: e.target.value }))} />
              </div>
              <div className="field mb0" style={{ flex: 1, minWidth: 110 }}>
                <label htmlFor="sp-unit">Periodo</label>
                <select id="sp-unit" value={form.punit} onChange={e => setForm(f => ({ ...f, punit: e.target.value }))}>
                  <option value="">Qualsiasi</option>
                  {allUnits.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <p className="hint mb0 mt1">Mostra le schede con almeno un prezzo dichiarato in questo intervallo. Gli importi sono dichiarati dai recensori e non sono verificati dalla piattaforma.</p>
          </fieldset>
          <label className="checkline mb2">
            <input type="checkbox" checked={form.suff} onChange={e => setForm(f => ({ ...f, suff: e.target.checked }))} />
            <span>Mostra solo schede con dati sufficienti (≥ {boot.settings.minReviews} indagini)</span>
          </label>
          <div className="field">
            <label htmlFor="so">Ordina per</label>
            <select id="so" value={form.ord} onChange={e => setForm(f => ({ ...f, ord: e.target.value }))}>
              <option value="rilevanza">Rilevanza (media ponderata)</option>
              <option value="punteggio">Punteggio medio</option>
              <option value="recensioni">Numero di indagini</option>
              <option value="nome">Nome</option>
            </select>
          </div>
          <button className="btn btn-primary btn-block" type="submit">Applica filtri</button>
          <p className="small muted mt2 mb0">Zone e quartieri si cercano nella <a href="#/mappa">mappa</a> e nelle schede zona.</p>
        </form>
        <div>
          <p aria-live="polite" className="muted">
            {rows == null ? "Ricerca in corso…" : rows.length === 1 ? "1 risultato" : `${rows.length} risultati`}
            {p.cat ? ` · ${p.cat.split(",").map(c => boot.categories.find(x => x.id === c)?.shortName).filter(Boolean).join(", ")}` : ""}
            {(p.pmin || p.pmax || p.punit) ? ` · prezzo ${p.pmin ? `da ${p.pmin} € ` : ""}${p.pmax ? `a ${p.pmax} € ` : ""}${p.punit ? `(${p.punit})` : ""}` : ""}
          </p>
          <MethodNoteBox />
          <div className="grid mt3">
            {rows == null ? null : rows.length ? (
              rows.map(x => (
                <EntityCard key={x.entity.id} data={x as EntCardData}
                  cat={boot.categories.find(c => c.id === x.entity.categoryId)!} zoneName={zoneName} />
              ))
            ) : (
              <Alert kind="info">Nessun risultato con questi filtri. Prova a rimuovere qualche vincolo, oppure <a href="#/proponi-soggetto">proponi tu il soggetto</a>.</Alert>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
