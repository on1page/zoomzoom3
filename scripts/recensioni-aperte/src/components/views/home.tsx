"use client";
// ZoomZoom — home: hero con ricerca, mappa delle reputazioni, come funziona,
// categorie recensibili, top 3 e sezione imparzialità.
import { useState } from "react";
import { useApp } from "@/lib/client/store";
import { navigate } from "@/lib/client/router";
import { api, fmtInt } from "@/lib/client/api";
import { iconSvg, CheckSvg } from "../icons";
import { MapLegend, MapViewport } from "../map";
import { AdSlot } from "../chrome";
import { EntityCard, type EntCardData } from "../ui-kit";
import { useEffect } from "react";

type SearchRow = {
  entity: { id: string; name: string; categoryId: string; subtitle: string | null; address: string | null; zoneId: string | null; verifiedBusiness: boolean; isDemo: boolean };
  n: number; mean: number | null; weighted: number | null; sufficient: boolean;
};

export function HomeView() {
  const { boot } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [tops, setTops] = useState<Record<string, { rows: SearchRow[]; method: { m: number; prior: number } }>>({});

  useEffect(() => {
    if (!boot) return;
    void (async () => {
      const [r1, r2] = await Promise.all([
        api<{ sections: { category: { id: string }; rows: SearchRow[]; method: { m: number; prior: number } }[] }>("/api/public/rankings?cat=immobile"),
        api<{ sections: { category: { id: string }; rows: SearchRow[]; method: { m: number; prior: number } }[] }>("/api/public/rankings?cat=zona"),
      ]);
      const acc: typeof tops = {};
      if (r1.ok) for (const s of r1.sections) acc[s.category.id] = { rows: s.rows, method: s.method };
      if (r2.ok) for (const s of r2.sections) acc[s.category.id] = { rows: s.rows, method: s.method };
      setTops(acc);
    })();
  }, [boot]);

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;
  const cats = boot.categories;
  const zoneName = (id: string | null) => boot.zones.find(z => z.id === id)?.name || "";

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (cat) params.set("cat", cat);
    navigate(`#/cerca${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const topList = (catId: string, title: string, sub: string) => {
    const section = tops[catId];
    if (!section || !section.rows.length) return null;
    const rows = section.rows.filter(x => x.n > 0).slice(0, 3).map(x => ({
      entity: {
        id: x.entityId, name: x.name, categoryId: catId, subtitle: null,
        address: null, zoneId: x.zoneId, verifiedBusiness: (x as { verifiedBusiness?: boolean }).verifiedBusiness || false,
        isDemo: x.isDemo,
      },
      n: x.n, mean: x.mean, sufficient: x.sufficient,
    }));
    if (!rows.length) return null;
    const cat = cats.find(c => c.id === catId)!;
    return (
      <div>
        <div className="section-head">
          <div>
            <h2>{title}</h2>
            <p className="sub">{sub}</p>
          </div>
          <a className="btn btn-ghost btn-sm" href="#/classifiche">Tutte le classifiche</a>
        </div>
        <div className="grid">
          {rows.map((x, i) => (
            <EntityCard key={x.entity.id} data={{ ...x, rank: i + 1 } as EntCardData} cat={cat} zoneName={zoneName} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Recensioni <em>verificate</em> su case, zone e servizi della casa</h1>
          <p className="lead">{boot.settings.heroSub}</p>
          <div className="hero-box">
            <form className="searchbar" role="search" onSubmit={submitSearch}>
              <input type="search" placeholder="Cerca un immobile, una zona, un professionista…"
                aria-label="Cerca su ZoomZoom" value={q} onChange={e => setQ(e.target.value)} />
              <select aria-label="Categoria" value={cat} onChange={e => setCat(e.target.value)}>
                <option value="">Tutte le categorie</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.shortName}</option>)}
              </select>
              <button className="btn btn-primary" type="submit">Cerca</button>
            </form>
            <div className="hero-badges">
              <span className="hero-badge"><CheckSvg /> Immobili e zone: recensioni aperte a tutti</span>
              <span className="hero-badge"><CheckSvg /> Persone: solo con esperienza verificata</span>
              <span className="hero-badge"><CheckSvg /> Una recensione per esperienza</span>
              <span className="hero-badge"><CheckSvg /> Consultazione libera, senza registrazione</span>
            </div>
            <div className="row mt2" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <a className="btn btn-primary" href="#/recensione">Scrivi una recensione</a>
              <span className="small muted">Basta l&apos;indirizzo: +{boot.settings.premiumDaysPerReview} giorni Premium per ogni contributo pubblicato</span>
            </div>
          </div>
        </div>
      </section>

      <AdSlot position="home-top" />

      <section className="section section-alt" style={{ paddingTop: 36 }}>
        <div className="container">
          <div className="section-head">
            <div>
              <h2>La mappa delle reputazioni</h2>
              <p className="sub">Tutto il territorio italiano su cartografia reale (OpenStreetMap): medie aggregate per città e punti colorati per fascia di punteggio. I contenuti delle città demo sono dati fittizi.</p>
            </div>
            <a className="btn btn-ghost btn-sm" href="#/mappa">Apri la mappa completa</a>
          </div>
          <div className="map-wrap">
            <MapViewport />
            <MapLegend />
          </div>
          <p className="small muted mt2 mb0">Dalla mappa non si risale a chi ha scritto una recensione né a quando: le persone fisiche non compaiono mai tra i punti geografici.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <h2>Come funziona la verifica</h2>
              <p className="sub">Un modello pensato per ridurre le recensioni false, senza promettere l&apos;impossibile.</p>
            </div>
            <a className="btn btn-ghost btn-sm" href="#/come-funziona">Approfondisci</a>
          </div>
          <div className="steps">
            <div className="step"><h3>Esperienza reale, due strade</h3><p>Per <b>immobili e zone</b> basta dichiarare la tua esperienza: nessun invito, il badge resta “dichiarata”. Per le <b>persone</b> serve l&apos;invito del soggetto o la verifica documentale: il badge “verificata” vale qualcosa proprio per questo.</p></div>
            <div className="step"><h3>Contributo con incentivo</h3><p>Ogni recensione pubblicata attiva giorni di Membership Premium, che sbloccano i testi integrali; chi allega una foto sblocca anche le foto degli altri. Il premio è per il contributo, non per il voto.</p></div>
            <div className="step"><h3>Community e moderazione</h3><p>Gli utenti Premium validano o disconfermano le recensioni (pollice su/giù); segnalazioni e moderazione con decisioni motivate chiudono il cerchio: chi bara perde il vantaggio ottenuto.</p></div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-head">
            <div>
              <h2>Cosa puoi recensire</h2>
              <p className="sub">Sette categorie, ciascuna con criteri di valutazione dedicati: domande diverse per soggetti diversi.</p>
            </div>
          </div>
          <div className="grid grid-4">
            {cats.map(c => (
              <a className="card card-click cat-card" href={`#/categoria/${c.id}`} key={c.id}>
                <span className="cat-ico" style={{ background: c.hexColor, color: "#fff" }}>{iconSvg(c.icon, 22)}</span>
                <h3>{c.name}</h3>
                <p>{c.description}</p>
                <span className="cat-count">{c.id === "zona" ? boot.zones.length + " zone" : ""} criteri dedicati: {c.criteria.length}</span>
              </a>
            ))}
            <a className="card card-click cat-card" href="#/proponi-soggetto" style={{ borderStyle: "dashed" }}>
              <span className="cat-ico" style={{ background: "var(--navy)", color: "#fff" }}>+</span>
              <h3>Proponi un soggetto</h3>
              <p>Manca una scheda? Proponila: la revisione della moderazione protegge da schede arbitrarie.</p>
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid grid-2">
            {topList("immobile", "Immobili più apprezzati", "Primi tre per media ponderata, con numero di recensioni visibile.")}
            {topList("zona", "Zone più apprezzate", "Le valutazioni aggregate di chi ci vive o ci lavora.")}
          </div>
        </div>
      </section>

      <AdSlot position="home-mid" />

      <section className="section section-alt">
        <div className="container">
          <div className="grid grid-2">
            <div>
              <h2>Imparzialità per costruzione</h2>
              <p>Le classifiche seguono una media ponderata che richiede un minimo di recensioni prima di considerare solida una media: una valutazione isolata, anche massima, non determina il primo posto.</p>
              <p>La pubblicità, quando attiva, è chiaramente separata e non influenza punteggi, medie né ordine dei risultati. Ogni decisione di moderazione è tracciata in un registro riservato, con possibilità di appello.</p>
              <p className="mb0">Consulta <a href="#/come-funziona">come funziona</a> e le <a href="#/regole-recensioni">regole delle recensioni</a>.</p>
            </div>
            <div>
              <div className="card">
                <h3 className="mt0">Hai vissuto un&apos;esperienza con la casa?</h3>
                <p className="small">Per immobili e zone scrivi <b>subito, senza invito</b>: basta trovare la scheda o aggiungere l&apos;indirizzo. Ogni recensione pubblicata attiva {boot.settings.premiumDaysPerReview} giorni di Premium.</p>
                <a className="btn btn-primary" href="#/recensione">Scrivi una recensione</a>{" "}
                <a className="btn btn-ghost" href="#/come-funziona">Prima voglio capire</a>
                <hr />
                <p className="small muted mb0">Cerchi invece cosa dicono di un quartiere? Vai alla <a href="#/mappa">mappa delle reputazioni</a>. Finora {fmtInt(boot.stats.reviews)} recensioni su {fmtInt(boot.stats.entities)} schede.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
