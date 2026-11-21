"use client";
// ZoomZoom — contributo aperto: "Scrivi una recensione" senza invito.
// Immobile e zona si recensiscono subito: basta trovare la scheda oppure
// aggiungerla dall'indirizzo reale (con posizione facoltativa da GPS o mappa).
// È il cuore della strategia anti "catalogo vuoto": ogni utente porta il
// primo mattone (l'indirizzo) e il contenuto arriva con la recensione.
// COPERTURA NAZIONALE: la città non è più un elenco fisso di poche città —
// si cerca qualsiasi comune, paese o frazione d'Italia (geocodifica
// OpenStreetMap) oppure si usa il GPS, che riempie via/civico reali con il
// reverse geocoding. Le persone fisiche restano sulla via invito/verifica.
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmt1 } from "@/lib/client/api";
import { navigate } from "@/lib/client/router";
import { Alert, ChipCat, Stars } from "../ui-kit";
import { iconSvg } from "../icons";
import { ReviewFields, type ReviewFormCore } from "../review-fields";
import { PhotoInput } from "../photo-input";
import { LocationPicker, type LatLng } from "../location-picker";
import { PlaceSearch } from "../place-search";
import { AddressSearch, type AddressPlace } from "../address-search";

type SelEntity = { id: string; name: string; categoryId: string };

type SearchRow = {
  entity: { id: string; name: string; subtitle: string | null; address: string | null; zoneId: string | null; isDemo: boolean };
  n: number; mean: number | null; sufficient: boolean;
};

type FormState = ReviewFormCore & { honesty: boolean; hp: string; kind: string };

export function WriteReviewOpenView({ presetEntityId }: { presetEntityId?: string }) {
  const { boot, user, toast, refreshBoot } = useApp();
  const [step, setStep] = useState<"target" | "find" | "form">("target");
  const [target, setTarget] = useState<"immobile" | "zona" | null>(null);
  const [sel, setSel] = useState<SelEntity | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  // preselezione dalla scheda (#/recensione?entity=…): si accettano solo
  // immobili e zone; le persone restano sulla via invito/verifica
  useEffect(() => {
    if (!presetEntityId || !boot) return;
    void (async () => {
      const res = await api<{ entity: { id: string; name: string; categoryId: string } }>(`/api/public/entity/${presetEntityId}`);
      if (!res.ok || !res.entity) { setPresetError("La scheda indicata non è raggiungibile."); return; }
      const cat = boot.categories.find(c => c.id === res.entity.categoryId);
      if (!cat) { setPresetError("Categoria non disponibile."); return; }
      if (cat.isPerson) { setPresetError("Per recensire una persona serve l'invito del soggetto o la verifica documentale dell'esperienza."); return; }
      setSel({ id: res.entity.id, name: res.entity.name, categoryId: res.entity.categoryId });
      setTarget(res.entity.categoryId === "zona" ? "zona" : "immobile");
      setStep("form");
    })();
  }, [presetEntityId, boot]);

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;

  if (!user) {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <h1>Scrivi una recensione</h1>
        <Alert kind="info">Per scrivere una recensione serve <a href="#/accedi">accedere</a> o <a href="#/registrati">creare un account</a>: servono un indirizzo email verificato e uno pseudonimo, mai il tuo nome vero. Ogni recensione pubblicata attiva la <b>Membership Premium</b> ({boot.settings.premiumDaysPerReview} giorni).</Alert>
      </div>
    );
  }

  if (presetError) {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <Alert kind="danger">
          <h1 style={{ margin: "0 0 8px", fontSize: "1.3rem" }}>Non si può procedere</h1>
          {presetError}{" "}
          <a href="#/verifica-esperienza">Verifica la tua esperienza</a> · <a href="#/cerca">Torna alla ricerca</a>
        </Alert>
      </div>
    );
  }

  if (!boot.site.openReviewsEnabled) {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <Alert kind="warn">
          <h1 style={{ margin: "0 0 8px", fontSize: "1.3rem" }}>Contributo aperto sospeso</h1>
          Le recensioni aperte sono temporaneamente disattivate dall&apos;amministrazione: per scrivere usa l&apos;invito ricevuto per email oppure la <a href="#/verifica-esperienza">verifica documentale</a>.
        </Alert>
      </div>
    );
  }

  return (
    <>
      {step === "target" ? (
        <TargetStep onPick={t => { setTarget(t); setStep("find"); }} />
      ) : step === "find" ? (
        <FindStep
          target={target!}
          onSelected={(ent) => { setSel(ent); setStep("form"); }}
          onBack={() => { setTarget(null); setStep("target"); }}
        />
      ) : sel ? (
        <OpenReviewForm
          key={sel.id}
          sel={sel}
          onBack={() => { setSel(null); setStep("find"); }}
          onDone={async (entityId, premiumDays) => {
            if (premiumDays > 0) toast(`Recensione pubblicata: grazie! Membership Premium attivata per ${premiumDays} giorni.`);
            else toast("Recensione pubblicata: grazie.");
            await refreshBoot();
            navigate(`#/scheda/${entityId}`);
          }}
        />
      ) : null}
    </>
  );
}

/* ---------- Passo 1: cosa vuoi recensire ---------- */
function TargetStep({ onPick }: { onPick: (t: "immobile" | "zona") => void }) {
  const { boot } = useApp();
  return (
    <div className="container" style={{ maxWidth: 860, paddingTop: 26 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Scrivi una recensione</h1>
          <p className="sub">Basta un account verificato: per immobili e zone non serve nessun invito. Ogni recensione pubblicata attiva {boot?.settings.premiumDaysPerReview} giorni di Membership Premium.</p>
        </div>
      </div>
      <div className="grid grid-3">
        <button className="card card-click" style={{ textAlign: "left" }} onClick={() => onPick("immobile")}>
          <span className="cat-ico" style={{ background: "#33658A", color: "#fff" }}>{iconSvg("immobile", 22)}</span>
          <h3>Un immobile</h3>
          <p className="small mb0">Appartamento, casa o singolo indirizzo, in <b>qualsiasi comune o paese d&apos;Italia</b>. Trovalo tra le schede oppure aggiungilo tu dall&apos;indirizzo: la prima recensione può essere la tua.</p>
          <span className="pill pill-green" style={{ marginTop: 10 }}>Subito, senza invito</span>
        </button>
        <button className="card card-click" style={{ textAlign: "left" }} onClick={() => onPick("zona")}>
          <span className="cat-ico" style={{ background: "#4E7D5B", color: "#fff" }}>{iconSvg("zona", 22)}</span>
          <h3>Una città / zona</h3>
          <p className="small mb0">Dove vivi, lavori o studi: servizi, trasporti, sicurezza percepita, costi. <b>Tutto il territorio nazionale, paesi e frazioni inclusi</b>: se la scheda manca, si attiva al momento.</p>
          <span className="pill pill-green" style={{ marginTop: 10 }}>Subito, senza invito</span>
        </button>
        <div className="card" style={{ textAlign: "left", borderStyle: "dashed" }}>
          <span className="cat-ico" style={{ background: "#6E5E93", color: "#fff" }}>{iconSvg("proprietario", 22)}</span>
          <h3>Una persona</h3>
          <p className="small">Proprietari, affittuari e professionisti si recensiscono solo con <b>esperienza verificata</b>: protegge le persone dalle recensioni inventate e dà valore al badge.</p>
          <a className="btn btn-ghost btn-sm" href="#/verifica-esperienza">Verifica la tua esperienza</a>
        </div>
      </div>
    </div>
  );
}

/* ---------- Passo 2: trova o aggiungi ---------- */
// località scelta per la nuova scheda: qualsiasi comune, paese o frazione
// d'Italia (da ricerca geocodificata o dal GPS con indirizzo reale)
type ZonePick = {
  name: string;
  province: string | null;
  region: string | null;
  lat: number;
  lng: number;
  localId?: string; // id della zona se già presente su ZoomZoom
};

type PubZone = { id: string; name: string; lat: number; lng: number; entityId: string | null };

function FindStep({ target, onSelected, onBack }: {
  target: "immobile" | "zona";
  onSelected: (ent: SelEntity) => void;
  onBack: () => void;
}) {
  const { boot, toast } = useApp();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  // stato "aggiungi immobile"
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [zone, setZone] = useState<ZonePick | null>(null);
  const [geo, setGeo] = useState<LatLng | null>(null);
  const [geoQ, setGeoQ] = useState("");
  const [geoRes, setGeoRes] = useState<Array<{ label: string; lat: number; lng: number; zoneName: string | null; province: string | null; region: string | null; road?: string | null; houseNumber?: string | null }> | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [gpsStage, setGpsStage] = useState<"idle" | "gps" | "addr">("idle");
  const [addErr, setAddErr] = useState<string | null>(null);

  // zona: elenco delle città già sul catalogo (dalla mappa pubblica)
  const [pubZones, setPubZones] = useState<PubZone[] | null>(null);
  const [zoneBusy, setZoneBusy] = useState(false);

  const search = useCallback(async (query: string) => {
    setBusy(true);
    const res = await api<{ rows: SearchRow[] }>(`/api/public/search?cat=immobile${query ? `&q=${encodeURIComponent(query)}` : ""}`);
    setRows(res.ok ? res.rows : []);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (target === "immobile") void search("");
    else void (async () => {
      const res = await api<{ zones: PubZone[] }>("/api/public/map");
      setPubZones(res.ok ? res.zones : []);
    })();
  }, [target, search]);

  // attiva la scheda recensibile di una città: se esiste già si usa quella,
  // altrimenti nasce adesso (copertura nazionale, paesi inclusi)
  const activateZone = async (z: { id?: string; name: string; lat: number; lng: number; province?: string | null; region?: string | null; entityId?: string | null }) => {
    if (z.entityId) { onSelected({ id: z.entityId, name: z.name, categoryId: "zona" }); return; }
    setZoneBusy(true);
    const res = await api<{ entityId: string; name: string; created: boolean }>("/api/zones", {
      body: { name: z.name, province: z.province ?? null, region: z.region ?? null, lat: z.lat, lng: z.lng },
    });
    setZoneBusy(false);
    if (res.ok && res.entityId) {
      toast(res.created ? `Scheda di ${z.name} attivata: ora scrivi la recensione.` : `Scheda di ${z.name} già pronta: ora scrivi la recensione.`);
      onSelected({ id: res.entityId, name: z.name, categoryId: "zona" });
    } else {
      toast("Non riesco ad attivare la scheda della città: riprova tra poco.", "err");
    }
  };

  const doGeocode = async () => {
    if (geoQ.trim().length < 3) return;
    setGeoBusy(true); setGeoRes(null);
    const res = await api<{ results: Array<{ label: string; lat: number; lng: number; zoneName: string | null; province: string | null; region: string | null; road?: string | null; houseNumber?: string | null }> }>(`/api/public/geocode?q=${encodeURIComponent(geoQ.trim())}`);
    setGeoRes(res.ok ? res.results : []);
    setGeoBusy(false);
  };

  // GPS + reverse geocoding: chi è davanti all'immobile preme un bottone e
  // il modulo si riempie da solo (indirizzo reale, città, pin). Le coordinate
  // vanno al geocoder pubblico SOLO in questo momento, su richiesta esplicita.
  const useGpsAddress = () => {
    if (!navigator.geolocation) { toast("Questo browser non espone la posizione: usa la ricerca o la mappa.", "err"); return; }
    setGpsStage("gps");
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const pt = { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 };
        setGeo(pt);
        setGpsStage("addr");
        const res = await api<{ found: boolean; address: { road: string | null; houseNumber: string | null; zoneName: string | null; province: string | null; region: string | null } | null }>(`/api/public/geocode/reverse?lat=${pt.lat}&lng=${pt.lng}`);
        setGpsStage("idle");
        if (res.ok && res.found && res.address) {
          const a = res.address;
          const street = [a.road, a.houseNumber].filter(Boolean).join(" ");
          if (street) setAddress(street);
          if (a.zoneName) setZone({ name: a.zoneName, province: a.province, region: a.region, lat: pt.lat, lng: pt.lng });
          toast("Indirizzo riconosciuto: controlla e correggi se serve.");
        } else {
          toast("Posizione rilevata, ma l'indirizzo non risulta mappato: inseriscilo a mano (il pin è già a posto).", "err");
        }
      },
      () => { setGpsStage("idle"); toast("Posizione non disponibile: consenti l'accesso dal browser oppure cerca a mano.", "err"); },
      { timeout: 9000, maximumAge: 30000, enableHighAccuracy: true },
    );
  };

  // conferma di un INDIRIZZO dai suggerimenti del campo indirizzo: riempie
  // via/civico, città e pin in un colpo solo — l'utente vede esattamente
  // cosa sta per salvare e lo conferma scegliendo il suggerimento
  const pickAddress = (p: AddressPlace) => {
    setGeo({ lat: p.lat, lng: p.lng });
    if (p.zoneName) {
      setZone({ name: p.zoneName, province: p.province, region: p.region, lat: p.lat, lng: p.lng });
    }
  };

  // conferma di un risultato della ricerca sulla mappa: piazza il pin e
  // ricava la città. Se il risultato non porta il comune (es. una via di
  // campagna mappata senza riferimento), lo chiede al reverse geocoder sul
  // punto scelto: un'azione esplicita dell'utente, come il GPS. Prima di
  // questa correzione il pin veniva piazzato ma la città restava vuota,
  // senza spiegazioni: la località trovata non era confermabile.
  const pickGeoResult = async (g: NonNullable<typeof geoRes>[number]) => {
    setGeo({ lat: g.lat, lng: g.lng });
    setGeoRes(null);
    const street = [g.road, g.houseNumber].filter(Boolean).join(" ");
    if (street && !address.trim()) setAddress(street);
    if (zone) return; // città già scelta: il risultato serve solo per il pin
    if (g.zoneName) {
      setZone({ name: g.zoneName, province: g.province, region: g.region, lat: g.lat, lng: g.lng });
      return;
    }
    const res = await api<{ found: boolean; address: { zoneName: string | null; province: string | null; region: string | null } | null }>(`/api/public/geocode/reverse?lat=${g.lat}&lng=${g.lng}`);
    if (res.ok && res.found && res.address?.zoneName) {
      setZone({ name: res.address.zoneName, province: res.address.province, region: res.address.region, lat: g.lat, lng: g.lng });
    } else {
      toast("Posizione segnata sulla mappa: scegli anche la città nel campo “Città, comune o paese”.", "err");
    }
  };

  const addEntity = async () => {
    setAddErr(null);
    const res = await api<{ entity: { id: string; name: string } }>("/api/entities", {
      body: {
        address: address.trim(),
        // città già presente → id diretto; nuova località → nome+coordinate.
        // Le coordinate vanno solo se davvero valide (numeri finiti): il
        // server ha comunque i fallback (zona nota col nome, pin sulla mappa)
        zoneId: zone?.localId,
        zone: zone && !zone.localId
          ? {
            name: zone.name, province: zone.province, region: zone.region,
            lat: Number.isFinite(zone.lat) ? zone.lat : undefined,
            lng: Number.isFinite(zone.lng) ? zone.lng : undefined,
          }
          : undefined,
        geo,
      },
    });
    if (res.ok) {
      if (res.entity) {
        toast("Immobile aggiunto: ora scrivi la recensione.");
        onSelected({ id: res.entity.id, name: res.entity.name, categoryId: "immobile" });
      }
      return;
    }
    const ex = (res as { existingId?: string }).existingId;
    if (ex) {
      toast("Questo immobile è già presente: puoi recensire la scheda esistente.");
      onSelected({ id: ex, name: address.trim(), categoryId: "immobile" });
      return;
    }
    setAddErr(res.error);
  };

  const zoneName = (id: string | null) => boot?.zones.find(z => z.id === id)?.name || "";

  return (
    <div className="container" style={{ maxWidth: 860, paddingTop: 26 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>{target === "immobile" ? "Quale immobile?" : "Quale città?"}</h1>
          <p className="sub">{target === "immobile" ? "Cercalo tra le schede esistenti oppure aggiungilo dall'indirizzo: basta quello." : "Una città già attiva, oppure qualsiasi comune o paese d'Italia: la scheda si attiva al momento."}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Cambia categoria</button>
      </div>

      {target === "zona" ? (
        <>
          {pubZones == null ? (
            <p className="muted">Carico le città…</p>
          ) : (
            <div className="grid grid-3">
              {pubZones.map(z => (
                <button key={z.id} className="card card-click" style={{ textAlign: "left" }} disabled={zoneBusy}
                  onClick={() => void activateZone({ id: z.id, name: z.name, lat: z.lat, lng: z.lng, entityId: z.entityId })}>
                  <h3 style={{ margin: 0 }}>{z.name}</h3>
                  <span className="small muted">{z.entityId ? "Scheda attiva · servizi, trasporti, sicurezza, costi" : "Sul catalogo · scheda da attivare"}</span>
                </button>
              ))}
            </div>
          )}
          <div className="card mt3">
            <h2 style={{ marginBottom: 4 }}>La tua città non è tra queste?</h2>
            <p className="small muted" style={{ marginTop: 0 }}>Cerca qualsiasi comune, paese o frazione d&apos;Italia: la scheda nasce ora e resta nel catalogo.</p>
            <PlaceSearch id="zps-city" localZones={boot?.zones}
              placeholder="Es. Corte de' Frati, Marciaga, Alassio…"
              onPick={p => void activateZone({
                name: p.zoneName || p.name,
                province: p.province, region: p.region,
                lat: p.lat, lng: p.lng,
                entityId: p.localId ? (pubZones?.find(z => z.id === p.localId)?.entityId ?? null) : null,
              })} />
            {zoneBusy ? <p className="small muted mb0">Attivo la scheda…</p> : null}
          </div>
        </>
      ) : (
        <>
          <form className="searchbar" role="search" onSubmit={e => { e.preventDefault(); void search(q.trim()); }}>
            <input type="search" placeholder="Cerca per indirizzo o nome (es. Via del Filatoio)" aria-label="Cerca immobile"
              value={q} onChange={e => setQ(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Cerca…" : "Cerca"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setQ(""); void search(""); }}>Azzera</button>
          </form>

          {rows && rows.length > 0 ? (
            <div className="grid mt2">
              {rows.slice(0, 12).map(r => (
                <article className="card card-click" key={r.entity.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px" }}>{r.entity.name}</h3>
                    <p className="small muted mb0">{r.entity.address || r.entity.subtitle}{r.entity.zoneId ? ` · ${zoneName(r.entity.zoneId)}` : ""}</p>
                    <p className="small mb0" style={{ marginTop: 4 }}>
                      {r.n > 0 ? <><Stars score={r.mean} size={13} /> {fmt1(r.mean)}/10 · {r.n} {r.n === 1 ? "recensione" : "recensioni"}</> : <span className="muted">Nessuna recensione: potresti essere il primo</span>}
                    </p>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => onSelected({ id: r.entity.id, name: r.entity.name, categoryId: "immobile" })}>Recensisci</button>
                </article>
              ))}
              {rows.length > 12 ? <p className="small muted">Mostrati i primi 12 su {rows.length}: affina la ricerca per vedere gli altri.</p> : null}
            </div>
          ) : rows && !rows.length ? (
            <Alert kind="info">Nessun immobile trovato{q ? ` per “${q}”` : ""}: aggiungilo tu qui sotto e scrivi la prima recensione.</Alert>
          ) : null}

          <div className="section-head mt3">
            <div>
              <h2 style={{ marginBottom: 0 }}>Non c&apos;è ancora? Aggiungilo tu</h2>
              <p className="sub">Inserisci l&apos;indirizzo reale: la scheda nasce subito, in qualsiasi comune o paese d&apos;Italia. Niente catalogo vuoto.</p>
            </div>
          </div>
          <div className="card">
            {!adding ? (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Aggiungi un immobile da recensire</button>
            ) : (
              <form onSubmit={async e => {
                e.preventDefault();
                if (address.trim().length < 5 || !zone) { setAddErr("Indica l'indirizzo (almeno 5 caratteri) e scegli la città dai suggerimenti del campo “Città, comune o paese”."); return; }
                await addEntity();
              }}>
                <div className="field">
                  <label>Sei davanti all&apos;immobile? Lascia fare al telefono</label>
                  <button type="button" className="btn btn-ghost" onClick={useGpsAddress} disabled={gpsStage !== "idle"}>
                    {gpsStage === "gps" ? "Rilevo la posizione…" : gpsStage === "addr" ? "Cerco l'indirizzo reale…" : "Usa la mia posizione e trova l'indirizzo"}
                  </button>
                  <span className="hint">Con il tuo consenso uso il GPS e ricavo <b>via e civico reali</b> dalla cartografia OpenStreetMap (reverse geocoding). Le coordinate vanno al geocoder solo ora, su tua richiesta: poi restano solo nel modulo.</span>
                </div>
                <AddressSearch id="ne-address" label="Indirizzo dell&apos;immobile"
                  placeholder="Es. Via dei Mille 15"
                  hint="Come appare su una buca delle lettere: via, numero, eventualmente scala o interno. È un dato pubblico per natura. Digita la via: tra i suggerimenti trovi gli indirizzi reali della cartografia OpenStreetMap, e scegliendone uno si compilano anche città e pin."
                  value={address} onChange={setAddress}
                  onPick={p => void pickAddress(p)} />
                <PlaceSearch id="ne-city" localZones={boot?.zones}
                  label="Città, comune o paese"
                  placeholder="Es. Milano, Corte de' Frati, Marciaga…"
                  hint="Qualsiasi località d'Italia: se non è ancora sul catalogo, la aggiungo al momento (nome e coordinate dalla cartografia OpenStreetMap)."
                  onPick={p => setZone({
                    name: p.zoneName || p.name,
                    province: p.province, region: p.region,
                    lat: p.lat, lng: p.lng,
                    localId: p.localId,
                  })} />
                {zone ? (
                  <p className="small" style={{ marginTop: -6, marginBottom: 14 }}>
                    <span className="pill pill-green">Città</span> <b>{zone.name}</b>
                    {zone.province ? ` · ${zone.province}` : ""}{zone.region && zone.province !== zone.region ? ` (${zone.region})` : ""}
                    <button type="button" className="btn btn-ghost btn-xs" style={{ marginLeft: 8 }} onClick={() => setZone(null)}>Cambia</button>
                  </p>
                ) : null}
                <div className="field">
                  <label htmlFor="ne-geoq">Posizione sulla mappa <span className="muted">(facoltativa)</span></label>
                  <div className="row">
                    <input id="ne-geoq" type="search" style={{ flex: 1 }} placeholder="Cerca l'indirizzo sulla mappa (OpenStreetMap)" value={geoQ}
                      onChange={e => setGeoQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void doGeocode(); } }} />
                    <button type="button" className="btn btn-ghost" onClick={() => void doGeocode()} disabled={geoBusy}>{geoBusy ? "Cerca…" : "Cerca"}</button>
                  </div>
                  {geoRes ? (
                    geoRes.length ? (
                      <ul className="geo-results">
                        {geoRes.map((g, i) => (
                          <li key={i}>
                            <button type="button" onClick={() => { void pickGeoResult(g); }}>{g.label}</button>
                          </li>
                        ))}
                      </ul>
                    ) : <span className="hint">Nessun risultato: piazza il pin a mano con un clic sulla mappa (o col GPS).</span>
                  ) : (
                    <span className="hint">La stringa cercata passa al geocoder pubblico di OpenStreetMap solo quando premi “Cerca”; il pin manuale e il GPS restano tra te e la mappa.</span>
                  )}
                </div>
                <LocationPicker value={geo} onChange={setGeo}
                  note="Con la posizione l'immobile compare tra i punti della mappa (zoom città). Senza, resta recensibile e cercabile per indirizzo." />
                {addErr ? <p className="error-msg" style={{ display: "block" }}>{addErr}</p> : null}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Annulla</button>
                  <button className="btn btn-primary" type="submit">Aggiungi e scrivi la recensione</button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Passo 3: la recensione aperta ---------- */
function OpenReviewForm({ sel, onBack, onDone }: {
  sel: SelEntity;
  onBack: () => void;
  onDone: (entityId: string, premiumDays: number) => void | Promise<void>;
}) {
  const { boot, toast } = useApp();
  const cat = boot?.categories.find(c => c.id === sel.categoryId) || null;
  const [kind, setKind] = useState("");
  const [form, setForm] = useState<FormState>({
    kind: "", score: 5, crit: {} as Record<string, number>,
    priceAmount: "", priceUnit: "", priceKind: "Concluso/pagato",
    pros: "", cons: "", text: "", honesty: false, hp: "",
  });
  const [photos, setPhotos] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (cat?.experienceKinds.length) setKind(cat.experienceKinds[0]); }, [cat]);

  if (!boot || !cat) return <div className="container section"><p className="muted">Caricamento criteri…</p></div>;

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Scrivi la recensione</h1>
          <p className="sub">
            <ChipCat cat={cat} /> · {sel.name} · <span className="pill pill-gray">Esperienza dichiarata</span>
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Cambia soggetto</button>
      </div>
      <Alert kind="info">
        Stai scrivendo senza invito: la recensione sarà marcata <b>“esperienza dichiarata”</b> (non “verificata”). Restano valide le regole: segnalazioni, moderazione con decisioni motivate e revoca del Premium in caso di frode accertata.
      </Alert>
      {boot.site.premiumEnabled ? (
        <Alert kind="ok"><b>Membership Premium.</b> Pubblicando questa recensione ottieni <b>{boot.settings.premiumDaysPerReview} giorni di Premium</b>: leggi le recensioni integrali di tutte le schede. E se alleghi una foto, sblocchi anche le foto di tutte le altre recensioni. Il premio è legato al contributo, non al voto.</Alert>
      ) : null}
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          setErr(null); setBusy(true);
          const res = await api<{ reviewId: string; entityId: string; photos?: { added: number; skipped: number }; premium: { grantedDays: number } | null }>("/api/reviews", {
            body: { entityId: sel.id, experienceKind: kind, ...form, photos },
          });
          setBusy(false);
          if (res.ok) {
            if (res.photos && res.photos.skipped > 0) toast(`${res.photos.skipped} ${res.photos.skipped === 1 ? "foto non valida è stata" : "foto non valide sono state"} scartata/e: la recensione è comunque pubblicata.`, "err");
            await onDone(res.entityId, res.premium?.grantedDays || 0);
          } else setErr(res.error);
        }}>
          <div className="field">
            <label htmlFor="rv-kind">Che esperienza hai avuto?</label>
            <select id="rv-kind" required value={kind} onChange={e => setKind(e.target.value)}>
              {cat.experienceKinds.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <span className="hint">La tua esperienza è dichiarata sotto la tua responsabilità: contributi falsi o diffamatori vengono rimossi e comportano la revoca del vantaggio.</span>
          </div>
          <ReviewFields cat={cat} form={form} setForm={setForm} />
          <PhotoInput photos={photos} onChange={setPhotos} enabled={!!boot.site.photosEnabled} />
          <label className="checkline mb2">
            <input type="checkbox" checked={form.honesty} onChange={e => setForm(f => ({ ...f, honesty: e.target.checked }))} required />
            <span><b>Dichiarazione:</b> l&apos;esperienza è personale e il contenuto rispetta le regole; non ho inserito dati personali di terzi senza autorizzazione né finalità promozionali.</span>
          </label>
          <div className="hp-field"><label htmlFor="orv-hp">Non compilare</label><input id="orv-hp" tabIndex={-1} autoComplete="off" value={form.hp} onChange={e => setForm(f => ({ ...f, hp: e.target.value }))} /></div>
          {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Pubblica la recensione</button>
        </form>
      </div>
    </div>
  );
}
