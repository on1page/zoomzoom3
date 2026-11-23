"use client";
// ZoomZoom — viste mappa, classifiche, categoria e zona.
import { useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmt1 } from "@/lib/client/api";
import { navigate, useHashRoute } from "@/lib/client/router";
import { Alert, Crumbs, EntityCard, insuffChip, MethodNoteBox, Stars, type EntCardData } from "../ui-kit";
import { MapLegend, MapViewport } from "../map";
import { AdSlot } from "../chrome";

/* ---------- Mappa completa ---------- */
type MapData = {
  zones: Array<{ id: string; name: string; aggregate: { mean: number; n: number; sufficient: boolean } | null; suppressed: boolean; entityId: string | null }>;
};

export function MapView() {
  const { boot } = useApp();
  const [mode, setMode] = useState<"immobili" | "zone">("immobili");
  const [data, setData] = useState<MapData | null>(null);
  useEffect(() => {
    void api<MapData>("/api/public/map").then(res => { if (res.ok) setData(res); });
  }, []);
  if (!boot) return null;
  return (
    <div className="container">
      <div className="section-head" style={{ paddingTop: 26 }}>
        <div>
          <h1>Mappa delle reputazioni</h1>
          <p className="sub">L&apos;intero territorio italiano su cartografia MapTiler minimale, con l&apos;estero oscurato. La reputazione si legge a prima vista: regioni colorate nella vista Italia, province e comuni zoomando, e i pulsanti «Criterio» ricolorano il territorio per Servizi, Trasporti, Sicurezza, Verde e aria o Costi della vita. Punteggi aggregati: la mappa non rivela mai chi ha scritto una recensione né quando.</p>
        </div>
      </div>
      <div className="map-wrap" style={{ position: "relative" }}>
        <div className="map-toolbar">
          <span className="small"><b>Vista:</b></span>
          <button className={`chip chip-filter${mode !== "zone" ? " on" : ""}`} onClick={() => setMode("immobili")}>Immobili</button>
          <button className={`chip chip-filter${mode === "zone" ? " on" : ""}`} onClick={() => setMode("zone")}>Solo aggregati di città</button>
          <span className="spacer"></span>
          <span className="small muted">Vista Italia: regioni per reputazione · zoom/città: province e comuni · pulsanti «Criterio»: colora per singolo criterio · clicca una città o un punto per i dettagli · «Vista Italia» per tornare all&apos;insieme</span>
        </div>
        <MapViewport mode={mode} />
        <MapLegend />
      </div>
      <Alert kind="info">
        <b>Privacy sulla mappa.</b> Sulla mappa pubblica compaiono solo immobili (il cui indirizzo è di per sé pubblico) e valutazioni <em>aggrega te</em> di città e zone. Persone fisiche (proprietari, affittuari) e altri soggetti privati non vengono geolocalizzati, e dai punti sulla mappa non è possibile risalire all&apos;autore o alla data di una recensione. Le schede zona mostrano solo medie e conteggi, mai recensioni individuali posizionate. Dove i dati sono troppo pochi per un aggregato sicuro, il valore viene soppresso.
      </Alert>
      <div className="grid grid-3 mt3">
        {(data?.zones || []).map(z => (
          <a className="card card-click" key={z.id} href={z.entityId ? `#/zona/${z.entityId}` : "#/mappa"}>
            <h3>{z.name}</h3>
            {z.aggregate ? (
              <div className="score-line">
                <Stars score={z.aggregate.mean} />
                <span className="score-num">{fmt1(z.aggregate.mean)}<small>/10</small></span>
                <span className="score-n">{z.aggregate.n} recensioni</span>
                {!z.aggregate.sufficient ? insuffChip(z.aggregate.n) : null}
              </div>
            ) : (
              <p className="small muted mb0">{z.suppressed ? "Aggregati non pubblicati: troppo pochi dati per non risalire a persone." : "Nessuna recensione."}</p>
            )}
            <p className="small muted mb0">Sintesi della città: migliori 3 per categoria, filtri e recensioni aggregate.</p>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ---------- Classifiche ---------- */
type Section = {
  category: { id: string; name: string; shortName: string; hexColor: string };
  rows: Array<{ entityId: string; name: string; zoneId: string | null; isDemo: boolean; n: number; mean: number | null; weighted: number | null; sufficient: boolean }>;
  method: { m: number; prior: number };
};

export function RankingsView() {
  const { boot } = useApp();
  const route = useHashRoute();
  const catParam = route.params.cat || "";
  const activeCat = boot?.categories.find(c => c.id === catParam) || boot?.categories[0];
  const [section, setSection] = useState<Section | null>(null);
  const [zoneSection, setZoneSection] = useState<Section | null>(null);

  useEffect(() => {
    if (!activeCat) return;
    void api<{ sections: Section[] }>(`/api/public/rankings?cat=${activeCat.id}`).then(res => {
      if (res.ok) setSection(res.sections[0] || null);
    });
    void api<{ sections: Section[] }>("/api/public/rankings?cat=zona").then(res => {
      if (res.ok) setZoneSection(res.sections[0] || null);
    });
  }, [activeCat]);

  if (!boot || !activeCat) return null;
  const min = boot.settings.minReviews;
  const zoneName = (id: string | null) => boot.zones.find(z => z.id === id)?.name || "";
  const rows = section?.rows.filter(x => x.n > 0) || [];
  const suff = rows.filter(x => x.sufficient);

  return (
    <div className="container">
      <div className="section-head" style={{ paddingTop: 26 }}>
        <div>
          <h1>Classifiche</h1>
          <p className="sub">Come ordiniamo gli elenchi — trasparenza completa sul metodo.</p>
        </div>
      </div>
      <div className="method-box mb2">
        <h3>Il metodo (visibile e riproducibile)</h3>
        <p>Ogni classifica ordina le schede per <b>punteggio di classifica</b>, una media ponderata: <code>PC = (n · M + m · C) / (n + m)</code> dove <code>M</code> è la media della scheda, <code>n</code> il numero di recensioni, <code>C</code> la media della categoria{section ? <> (qui <b>C = {fmt1(section.method.prior)}</b>)</> : null} e <code>m = {min}</code> la soglia minima di recensioni.</p>
        <p className="mb0">Con poche recensioni il punteggio resta vicino alla media della categoria: così <b>una sola valutazione massima non può conquistare il primo posto</b>. Le schede sotto la soglia ({min} recensioni) restano visibili ma sono escluse dal podio e segnalate con &quot;dati insufficienti&quot;. Quando in una categoria non ci sono abbastanza schede con dati sufficienti, il dato viene mostrato con avvertenza invece di fingere una classifica solida. I punteggi di categorie diverse non sono direttamente confrontabili: ogni classifica è interna alla propria categoria.</p>
      </div>
      <div className="tabs" role="tablist">
        {boot.categories.map(c => (
          <button key={c.id} role="tab" aria-selected={c.id === activeCat.id}
            onClick={() => navigate(`#/classifiche?cat=${c.id}`)}>{c.shortName}</button>
        ))}
      </div>
      {suff.length < 3 && rows.length ? (
        <Alert kind="warn">In questa categoria meno di tre schede raggiungono la soglia di {min} recensioni: la classifica è da considerare indicativa.</Alert>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Classifica {activeCat.name}</caption>
          <thead>
            <tr>
              <th scope="col">#</th><th scope="col">Scheda</th><th scope="col">Media</th>
              <th scope="col">Punteggio classifiche</th><th scope="col" className="num">Recensioni</th><th scope="col">Affidabilità</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((x, i) => (
              <tr key={x.entityId}>
                <td><b>{x.sufficient ? i + 1 : "—"}</b></td>
                <td>
                  <a href={`#/scheda/${x.entityId}`}>{x.name}</a> {x.isDemo ? <span className="badge-demo">Dato fittizio</span> : null}<br />
                  <span className="small muted">{activeCat.shortName} · {zoneName(x.zoneId)}</span>
                </td>
                <td><b>{x.mean == null ? "—" : fmt1(x.mean)}</b>/10 <Stars score={x.mean} size={14} /></td>
                <td>{x.weighted == null ? "—" : fmt1(x.weighted)}</td>
                <td className="num">{x.n}</td>
                <td>{x.sufficient ? <span className="pill pill-green">Dati sufficienti</span> : insuffChip(x.n)}</td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="muted">Nessuna scheda con recensioni in questa categoria.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="section-head mt3"><h2>Le zone più apprezzate</h2></div>
      <div className="grid grid-3">
        {(zoneSection?.rows || []).filter(x => x.n > 0).slice(0, 3).map((x, i) => (
          <a className="card card-click" key={x.entityId} href={`#/zona/${x.entityId}`}>
            <div className="row" style={{ gap: 10 }}>
              <span className={`rank-num${i === 1 ? " r2" : i === 2 ? " r3" : ""}`}>{i + 1}</span>
              <h3 style={{ margin: 0 }}>{x.name}</h3>
            </div>
            <div className="score-line mt1">
              <Stars score={x.mean} />
              <span className="score-n">{x.n} recensioni</span>
              {!x.sufficient ? insuffChip(x.n) : null}
            </div>
          </a>
        ))}
      </div>
      <AdSlot position="classifiche-bottom" />
    </div>
  );
}

/* ---------- Pagina categoria ---------- */
export function CategoryView({ catId }: { catId: string }) {
  const { boot } = useApp();
  const [section, setSection] = useState<Section | null>(null);
  const cat = boot?.categories.find(c => c.id === catId);
  useEffect(() => {
    if (!cat) return;
    void api<{ sections: Section[] }>(`/api/public/rankings?cat=${cat.id}`).then(res => {
      if (res.ok) setSection(res.sections[0] || null);
    });
  }, [cat]);
  if (!boot || !cat) {
    return <div className="container section"><h1>Pagina non trovata</h1><p>Il collegamento non corrisponde a nessuna pagina. <a href="#/">Torna alla home</a>.</p></div>;
  }
  const zoneName = (id: string | null) => boot.zones.find(z => z.id === id)?.name || "";
  const rows = (section?.rows || []).filter(x => x.n > 0);
  return (
    <>
      <Crumbs items={[{ label: "Home", href: "#/" }, { label: "Categorie" }, { label: cat.name }]} />
      <div className="container">
        <div className="section-head" style={{ paddingTop: 22 }}>
          <div>
            <div className="row">
              <span className="cat-ico" style={{ background: cat.hexColor, color: "#fff", borderRadius: 10, padding: 9, display: "inline-flex" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 11 L12 4 L20 11 M6 10 V20 H18 V10 M10 20 V15 H14 V20" />
                </svg>
              </span>
              <div>
                <h1 style={{ margin: 0 }}>{cat.name}</h1>
                <p className="sub" style={{ margin: "2px 0 0" }}>{cat.description}</p>
              </div>
            </div>
          </div>
          <div>
            <span className="pill pill-gray">{rows.length} schede con recensioni</span>{" "}
            <span className="pill pill-gray">{cat.criteria.length} criteri dedicati</span>
          </div>
        </div>
        {cat.isPerson ? (
          <Alert kind="warn">
            <b>Privacy delle persone.</b> Questa categoria riguarda persone fisiche: le schede sono identificate solo con iniziali e zona di attività, senza indirizzi né mappe. Se una scheda ti riguarda e ritieni che i contenuti siano errati, puoi <a href="#/moderazione">contestare l&apos;associazione</a> tramite il modulo dedicato.
          </Alert>
        ) : null}
        <div className="grid grid-3 mt2">
          {rows.map((x, i) => (
            <EntityCard key={x.entityId} data={{
              entity: { id: x.entityId, name: x.name, categoryId: cat.id, zoneId: x.zoneId, isDemo: x.isDemo },
              n: x.n, mean: x.mean, sufficient: x.sufficient, rank: i < 3 ? i + 1 : undefined,
            } as EntCardData} cat={cat} zoneName={zoneName} />
          ))}
          {!rows.length ? <Alert kind="info">Ancora nessuna recensione in questa categoria.</Alert> : null}
        </div>
        <div className="section-head mt3">
          <h2>Criteri di valutazione di questa categoria</h2>
        </div>
        <div className="card card-pad-s">
          <ul className="mb0" style={{ columns: 2 }}>
            {cat.criteria.map(c => <li key={c.key} style={{ breakInside: "avoid" }}>{c.label}</li>)}
          </ul>
          <p className="small muted mt2 mb0">I criteri sono specifici di questa categoria e non vengono riutilizzati tra categorie diverse. Le recensioni conservano la versione dei criteri usata al momento della pubblicazione.</p>
        </div>
        <MethodNoteBox />
      </div>
    </>
  );
}
