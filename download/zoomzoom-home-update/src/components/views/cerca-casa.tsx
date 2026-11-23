"use client";
// ZoomZoom — «Cerca casa»: pagina ponte in attesa della ricerca avanzata
// con mappa interattiva e filtri (località, tipologia, prezzo, superficie,
// locali, bagni, vendita/affitto). Nel frattempo indirizza verso le città
// Zoom, le schede zona, la ricerca esistente e la mappa delle reputazioni.
import { useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmtInt } from "@/lib/client/api";
import { Alert } from "../ui-kit";
import { ZOOM_CITIES_ALPHA } from "@/lib/zoom-cities";

// Le righe delle classifiche arrivano dall'API con campi piatti:
// vedi /api/public/rankings.
type RankRow = { entityId: string; name: string; zoneId: string | null; n: number; mean: number | null };

export function CercaCasaView() {
  const { boot } = useApp();
  const [rows, setRows] = useState<RankRow[] | null>(null);

  useEffect(() => {
    if (!boot) return;
    void (async () => {
      const r = await api<{ sections: { rows: RankRow[] }[] }>("/api/public/rankings?cat=zona");
      setRows(r.ok ? (r.sections[0]?.rows ?? []) : []);
    })();
  }, [boot]);

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;

  // Zone già presenti nel catalogo ma fuori dalle dieci città Zoom
  // (es. città demo del seed): restano consultabili e vengono elencate in coda.
  const extraZones = boot.zones.filter(z => !ZOOM_CITIES_ALPHA.some(c => c.slug === z.id));
  const stat = (slug: string) => {
    const r = (rows || []).find(x => x.zoneId === slug);
    return r ? { n: r.n, mean: r.mean } : null;
  };

  return (
    <div className="container">
      <div className="section-head" style={{ paddingTop: 26 }}>
        <div>
          <h1>Cerca casa</h1>
          <p className="sub">Scegli una delle città Zoom e scopri cosa dicono le recensioni verificate di zone, immobili e servizi della casa.</p>
        </div>
      </div>

      <Alert kind="info">
        <b>Novità in arrivo:</b> la ricerca avanzata con mappa interattiva e filtri (tipologia, prezzo, superficie, locali, bagni, vendita o affitto) è in fase di realizzazione. Nel frattempo puoi esplorare le città Zoom qui sotto, usare la <a href="#/cerca">ricerca con i filtri attuali</a> o aprire la <a href="#/mappa">mappa delle reputazioni</a>.
      </Alert>

      <div className="grid grid-3 mt3">
        {ZOOM_CITIES_ALPHA.map(city => {
          const st = stat(city.slug);
          const live = boot.zones.some(z => z.id === city.slug);
          return live ? (
            <a className="card card-click" href={`#/zona/${city.slug}`} key={city.slug}>
              <span className="city-region">{city.region}</span>
              <h3 style={{ margin: "2px 0 6px" }}>{city.name}</h3>
              <p className="small muted mb0">
                {st
                  ? <>{fmtInt(st.n)} recensioni in zona{st.mean != null ? <> · media {st.mean.toFixed(1)}</> : null}</>
                  : "Le prime recensioni arrivano a breve"}
              </p>
            </a>
          ) : (
            <div className="card" key={city.slug} style={{ borderStyle: "dashed" }}>
              <span className="city-region">{city.region}</span>
              <h3 style={{ margin: "2px 0 6px" }}>{city.name}</h3>
              <p className="small muted mb0">Scheda in preparazione: questa città entra ora nel catalogo Zoom.</p>
            </div>
          );
        })}
      </div>

      {extraZones.length ? (
        <p className="small muted mt3 mb0">
          Già consultabili anche:{" "}
          {extraZones.map((z, i) => (
            <span key={z.id}>{i > 0 ? ", " : ""}<a href={`#/zona/${z.id}`}>{z.name}</a></span>
          ))}.
        </p>
      ) : null}
    </div>
  );
}
