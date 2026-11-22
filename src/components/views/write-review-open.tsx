"use client";
// ZoomZoom — contributo aperto, flusso semplificato a 4 passi (v3):
//   1 Soggetto   — cosa vuoi recensire (immobile · zona · altro soggetto)
//   2 Luogo      — UN solo campo di ricerca (o il GPS): prima le schede già
//                  su ZoomZoom, poi i luoghi della cartografia nazionale
//   3 Scheda     — riepilogo a badge: si corregge solo quello che manca
//   4 Recensione — un modulo unico con validazione in tempo reale
// I dati si compilano UNA volta: il luogo trovato in (2) alimenta la scheda
// di (3). INDIRIZZO STRUTTURATO: via + civico + interno/scala — in una via
// ci sono più edifici e in un civico più unità (condomini) — con dedup per
// via+civico+interno nella stessa città, proposta di riuso entro 50 m e
// riepilogo delle schede dello stesso civico prima di crearne una nuova.
// Regole invariate (il server resta l'autorità): una recensione per scheda
// per utente — con offerta di rettifica —, testo >= 100 caratteri, almeno un
// aspetto positivo, max 3 foto, prezzo facoltativo, honeypot, budget
// giornaliero, Premium per contributo pubblicato.
// Badge-first: etichette brevi, i dettagli vivono nei tooltip (title).
import { Fragment, useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmt1 } from "@/lib/client/api";
import { navigate } from "@/lib/client/router";
import { normUnit, dispAddress } from "@/lib/address-norm";
import { Alert, ChipCat, Stars } from "../ui-kit";
import { CheckSvg, iconSvg } from "../icons";
import { ReviewFields, type ReviewFormCore } from "../review-fields";
import { PhotoInput } from "../photo-input";
import { LocationPicker, type LatLng } from "../location-picker";
import { PlaceSearch } from "../place-search";
import { AddressSearch } from "../address-search";

type Target = "immobile" | "zona" | "altro";
type SelEntity = { id: string; name: string; categoryId: string };

type SearchRow = {
  entity: { id: string; name: string; categoryId: string; subtitle: string | null; address: string | null; streetNumber?: string | null; zoneId: string | null; isDemo: boolean };
  n: number; mean: number | null; sufficient: boolean;
};

type GeoRow = {
  label: string; name: string; lat: number; lng: number; kind: string;
  zoneName: string | null; province: string | null; region: string | null;
  road?: string | null; houseNumber?: string | null;
};

// località scelta (qualsiasi comune, paese o frazione d'Italia)
type ZonePick = {
  name: string; province: string | null; region: string | null;
  lat: number; lng: number; localId?: string;
};

type PubZone = { id: string; name: string; lat: number; lng: number; entityId: string | null };

// dati del luogo che fluiscono dal passo 2 al passo 3 (e alla creazione).
// Indirizzo strutturato: via (address) + civico + interno/scala, perché in
// una via ci sono più edifici e in uno stesso civico più unità abitative
// (condomini): la discriminante della scheda è via + civico + interno.
type Draft = { zone: ZonePick | null; address: string; civico: string; unit: string; geo: LatLng | null };

type NearbyRow = { id: string; name: string; address: string | null; zoneId: string | null; distM: number };

// scheda già esistente allo stesso indirizzo (via + civico), con il suo
// interno: è il "condominio" che si vede prima di creare una scheda nuova
type BuildingRow = { id: string; name: string; address: string; unit: string | null; unitNorm: string };

type FormState = ReviewFormCore & { honesty: boolean; hp: string; kind: string };

const SUBJECT_CATS = ["proprietario", "affittuario", "amministratore", "agenzia", "ditta", "consulente"];

const countLines = (s: string) =>
  s.split("\n").map(x => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean).length;

export function WriteReviewOpenView({ presetEntityId }: { presetEntityId?: string }) {
  const { boot, user, toast, refreshBoot } = useApp();
  const [step, setStep] = useState<"target" | "place" | "confirm" | "form">("target");
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState<Draft>({ zone: null, address: "", civico: "", unit: "", geo: null });
  const [sel, setSel] = useState<SelEntity | null>(null);
  // com'è nata la scheda del passo 4: badge "Nuova scheda" o "Scheda esistente"
  const [schedaNote, setSchedaNote] = useState<{ created: boolean; reused: boolean } | null>(null);
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
      setTarget(res.entity.categoryId === "zona" ? "zona" : res.entity.categoryId === "immobile" ? "immobile" : "altro");
      setStep("form");
    })();
  }, [presetEntityId, boot]);

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;

  if (!user) {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <h1>Scrivi una recensione</h1>
        <Alert kind="info">Serve <a href="#/accedi">accedere</a> o <a href="#/registrati">creare un account</a> (email verificata e pseudonimo). Ogni recensione pubblicata attiva la <b>Membership Premium</b> ({boot.settings.premiumDaysPerReview} giorni).</Alert>
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
          Le recensioni aperte sono temporaneamente disattivate: usa l&apos;invito ricevuto per email oppure la <a href="#/verifica-esperienza">verifica documentale</a>.
        </Alert>
      </div>
    );
  }

  // stepper: etichette e posizione corrente in base al percorso scelto
  const labels = target === "altro" ? ["Soggetto", "Ricerca", "Recensione"] : ["Soggetto", "Luogo", "Scheda", "Recensione"];
  const curIdx = step === "target" ? 0 : step === "place" ? 1 : step === "confirm" ? 2 : target === "altro" ? 2 : 3;
  const jump = (i: number) => {
    if (i >= curIdx) return;
    if (i === 0) setStep("target");
    else if (i === 1) setStep("place");
    else if (i === 2 && target !== "altro") setStep("confirm");
  };

  return (
    <>
      {target && step !== "target" ? (
        <div className="container" style={{ maxWidth: 860, paddingTop: 22 }}>
          <Stepper labels={labels} current={curIdx} onJump={jump} />
        </div>
      ) : null}
      {step === "target" ? (
        <TargetStep onPick={t => { setTarget(t); setStep("place"); }} />
      ) : step === "place" ? (
        <PlaceStep
          target={target!}
          onBack={() => { setTarget(null); setStep("target"); }}
          onInternal={(ent, note) => { setSel(ent); setSchedaNote(note); setStep("form"); }}
          onDraft={(d) => { setDraft(d); setStep("confirm"); }}
        />
      ) : step === "confirm" ? (
        <ConfirmStep
          target={target!}
          draft={draft}
          setDraft={setDraft}
          onBack={() => setStep("place")}
          onReady={(ent, note) => { setSel(ent); setSchedaNote(note); setStep("form"); }}
        />
      ) : sel ? (
        <ReviewStep
          key={sel.id}
          sel={sel}
          schedaNote={schedaNote}
          onBack={() => { setSel(null); setStep(target === "altro" ? "place" : "place"); }}
          onDone={async (entityId, premiumDays) => {
            if (premiumDays > 0) toast(`Recensione pubblicata: Premium attivo per ${premiumDays} giorni.`);
            else toast("Recensione pubblicata: grazie.");
            await refreshBoot();
            navigate(`#/scheda/${entityId}`);
          }}
        />
      ) : null}
    </>
  );
}

/* ---------- Stepper: 1 Soggetto · 2 Luogo · 3 Scheda · 4 Recensione ---------- */
function Stepper({ labels, current, onJump }: { labels: string[]; current: number; onJump: (i: number) => void }) {
  return (
    <ol className="zz-stepper" aria-label="Avanzamento">
      {labels.map((l, i) => (
        <Fragment key={l}>
          {i > 0 ? <span className="zz-step-arrow" aria-hidden="true">›</span> : null}
          <li
            className={`zz-step${i === current ? " on" : i < current ? " done" : ""}`}
            aria-current={i === current ? "step" : undefined}
            onClick={i < current ? () => onJump(i) : undefined}
            onKeyDown={i < current ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJump(i); } }) : undefined}
            tabIndex={i < current ? 0 : undefined}
            title={i < current ? `Torna a: ${l}` : undefined}
          >
            <span className="zz-dot">{i < current ? <CheckSvg size={11} /> : i + 1}</span>
            {l}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

/* ---------- Passo 1: cosa vuoi recensire ---------- */
function TargetStep({ onPick }: { onPick: (t: Target) => void }) {
  const { boot, user } = useApp();
  // C1 — cancello all'inizio, non dopo il modulo: senza email verificata il
  // server rifiuterebbe tutto alla fine, sprecando i campi compilati
  const gated = !user.emailVerified;
  return (
    <div className="container" style={{ maxWidth: 860, paddingTop: 26 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Scrivi una recensione</h1>
          <p className="sub" style={{ margin: "6px 0 0" }}>
            <span className="pill pill-green" title={`Ogni recensione pubblicata attiva la Membership Premium: lettura integrale delle recensioni di tutte le schede per ${boot?.settings.premiumDaysPerReview} giorni. Il premio è per il contributo, non per il voto.`}>
              Premium +{boot?.settings.premiumDaysPerReview} gg
            </span>{" "}
            <span className="pill pill-gray" title="Racconti un'esperienza personale, sotto pseudonimo. Segnalazioni e moderazione attive.">Pseudonimo</span>
          </p>
        </div>
      </div>

      {gated ? (
        <Alert kind="warn">
          <span className="pill pill-amber" style={{ marginRight: 8 }}>Email da confermare</span>
          Conferma l&apos;indirizzo dal <a href="#/profilo">collegamento ricevuto via email</a> prima di scrivere: la recensione si pubblica solo con email verificata.
        </Alert>
      ) : null}

      <div className="pick-target" style={{ marginTop: 14 }}>
        <button className="card card-click" style={{ textAlign: "left" }} disabled={gated} onClick={() => onPick("immobile")}>
          <h3>
            <span className="cat-ico" style={{ background: "#33658A", color: "#fff" }}>{iconSvg("immobile", 20)}</span>
            Un immobile
          </h3>
          <p>Appartamento o casa, in qualsiasi comune d&apos;Italia.</p>
          <div className="zz-badges">
            <span className="pill pill-green" title="Nessun invito necessario: la scheda nasce dall'indirizzo reale.">Subito</span>
            <span className="pill pill-gray" title="Trovi la scheda oppure la crei: una scheda per via, civico e interno nella stessa città.">Via + civico + interno</span>
            <span className="pill pill-gray" title="Nei condomini l'interno o la scala distingue le unità allo stesso civico: ognuna con la sua scheda.">Condomini</span>
          </div>
        </button>
        <button className="card card-click" style={{ textAlign: "left" }} disabled={gated} onClick={() => onPick("zona")}>
          <h3>
            <span className="cat-ico" style={{ background: "#4E7D5B", color: "#fff" }}>{iconSvg("zona", 20)}</span>
            Una zona o città
          </h3>
          <p>Dove vivi, lavori o studi: servizi, trasporti, sicurezza.</p>
          <div className="zz-badges">
            <span className="pill pill-green">Subito</span>
            <span className="pill pill-gray" title="Se la scheda manca, si attiva al momento: paesi e frazioni inclusi.">Tutta Italia</span>
          </div>
        </button>
        <button className="card card-click" style={{ textAlign: "left" }} disabled={gated} onClick={() => onPick("altro")}>
          <h3>
            <span className="cat-ico" style={{ background: "#6E5E93", color: "#fff" }}>{iconSvg("proprietario", 20)}</span>
            Altro soggetto
          </h3>
          <p>Agenzia, ditta, amministratore, professionista o persona.</p>
          <div className="zz-badges">
            <span className="pill pill-amber" title="Le schede esistenti si recensiscono subito; i soggetti nuovi passano dalla revisione dello staff.">Controllo staff</span>
            <span className="pill pill-gray" title="Le persone fisiche si recensiscono solo con esperienza verificata (invito o documenti).">Persone: verifica</span>
          </div>
        </button>
      </div>
    </div>
  );
}

/* ---------- Passo 2: il luogo, un solo campo ---------- */
function PlaceStep({ target, onBack, onInternal, onDraft }: {
  target: Target;
  onBack: () => void;
  onInternal: (ent: SelEntity, note: { created: boolean; reused: boolean }) => void;
  onDraft: (d: Draft) => void;
}) {
  const { boot, toast } = useApp();
  const [q, setQ] = useState("");
  const [internal, setInternal] = useState<SearchRow[] | null>(null);
  const [geoRes, setGeoRes] = useState<GeoRow[] | null>(null);
  const [busyInt, setBusyInt] = useState(false);
  const [busyGeo, setBusyGeo] = useState(false);
  const [throttled, setThrottled] = useState(false);
  const [gpsStage, setGpsStage] = useState<"idle" | "gps" | "addr">("idle");
  const [zoneBusy, setZoneBusy] = useState(false);
  const [pubZones, setPubZones] = useState<PubZone[] | null>(null);
  const [personBlock, setPersonBlock] = useState<SearchRow | null>(null);

  const zoneName = useCallback((id: string | null) => boot?.zones.find(z => z.id === id)?.name || "", [boot]);

  // zona: elenco delle città già sul catalogo (con la loro scheda, se attiva)
  useEffect(() => {
    if (target !== "zona") return;
    void (async () => {
      const res = await api<{ zones: PubZone[] }>("/api/public/map");
      setPubZones(res.ok ? res.zones : []);
    })();
  }, [target]);

  // ricerca combinata: schede interne + luoghi della mappa
  const runSearch = useCallback(async (query: string) => {
    if (target !== "zona") {
      setBusyInt(true);
      const cat = target === "immobile" ? "immobile" : SUBJECT_CATS.join(",");
      const res = await api<{ rows: SearchRow[] }>(`/api/public/search?cat=${cat}${query ? `&q=${encodeURIComponent(query)}` : ""}`);
      setInternal(res.ok ? res.rows : []);
      setBusyInt(false);
    }
    if (target !== "altro" && query.length >= 3) {
      setBusyGeo(true);
      const res = await api<{ results: GeoRow[]; throttled?: boolean }>(`/api/public/geocode?q=${encodeURIComponent(query)}`);
      setThrottled(!!(res as { throttled?: boolean }).throttled);
      setGeoRes(res.ok ? res.results : []);
      setBusyGeo(false);
    } else {
      setGeoRes(null);
    }
  }, [target]);

  // ricerca con debounce. A vuoto (immobile) si aprono le schede esistenti:
  // chi entra trova subito anche il catalogo, non solo la mappa (C5)
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setGeoRes(null); setThrottled(false);
      if (target === "immobile") void runSearch(""); else setInternal(null);
      return;
    }
    const t = setTimeout(() => { void runSearch(query); }, 420);
    return () => clearTimeout(t);
  }, [q, target, runSearch]);

  // scheda interna già presente: la si usa così com'è (USE del diagramma)
  const pickInternal = (r: SearchRow) => {
    const cat = boot?.categories.find(c => c.id === r.entity.categoryId);
    if (cat?.isPerson) { setPersonBlock(r); return; }
    onInternal({ id: r.entity.id, name: r.entity.name, categoryId: r.entity.categoryId }, { created: false, reused: true });
  };

  // città già sul catalogo: scheda attiva → si usa; altrimenti si attiva ora
  const pickZone = async (z: { id?: string; name: string; lat: number; lng: number; entityId?: string | null }) => {
    if (z.entityId) { onInternal({ id: z.entityId, name: z.name, categoryId: "zona" }, { created: false, reused: true }); return; }
    setZoneBusy(true);
    const res = await api<{ entityId: string; name: string; created: boolean }>("/api/zones", {
      body: { name: z.name, province: null, region: null, lat: z.lat, lng: z.lng },
    });
    setZoneBusy(false);
    if (res.ok && res.entityId) {
      toast(res.created ? `Scheda di ${z.name} attivata.` : `Scheda di ${z.name} già pronta.`);
      onInternal({ id: res.entityId, name: z.name, categoryId: "zona" }, { created: res.created, reused: !res.created });
    } else {
      toast("Non riesco ad attivare la scheda della città: riprova tra poco.", "err");
    }
  };

  // luogo della mappa: indirizzo o città → minibozza che finisce al passo 3.
  // Via e civico restano SEPARATI: in un civico possono esserci più unità
  // (condomini) e la via è la base del confronto con le schede esistenti
  const pickGeo = (g: GeoRow) => {
    onDraft({
      address: g.road || "",
      civico: g.houseNumber || "",
      unit: "",
      zone: g.zoneName ? { name: g.zoneName, province: g.province, region: g.region, lat: g.lat, lng: g.lng } : null,
      geo: { lat: g.lat, lng: g.lng },
    });
  };

  // GPS + reverse geocoding: chi è sul posto preme un bottone e il passo 3
  // si riempie da solo (indirizzo reale, città, pin). Coordinate al geocoder
  // pubblico SOLO su azione esplicita.
  const useGps = () => {
    if (!navigator.geolocation) { toast("Questo browser non espone la posizione: usa la ricerca.", "err"); return; }
    setGpsStage("gps");
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const pt = { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 };
        setGpsStage("addr");
        const res = await api<{ found: boolean; address: { road: string | null; houseNumber: string | null; zoneName: string | null; province: string | null; region: string | null } | null }>(`/api/public/geocode/reverse?lat=${pt.lat}&lng=${pt.lng}`);
        setGpsStage("idle");
        if (res.ok && res.found && res.address) {
          const a = res.address;
          onDraft({
            address: a.road || "",
            civico: a.houseNumber || "",
            unit: "",
            zone: a.zoneName ? { name: a.zoneName, province: a.province, region: a.region, lat: pt.lat, lng: pt.lng } : null,
            geo: pt,
          });
        } else {
          onDraft({ address: "", civico: "", unit: "", zone: null, geo: pt });
          toast("Posizione rilevata, indirizzo non mappato: lo compili al passo seguente.", "err");
        }
      },
      () => { setGpsStage("idle"); toast("Posizione non disponibile: consenti l'accesso oppure cerca a mano.", "err"); },
      { timeout: 9000, maximumAge: 30000, enableHighAccuracy: true },
    );
  };

  // per la zona: risultati interni = città già sul catalogo
  const ql = q.trim().toLowerCase();
  const zoneRows = target === "zona" && pubZones
    ? (q.trim().length >= 2 ? pubZones.filter(z => z.name.toLowerCase().includes(ql)) : pubZones).slice(0, 8)
    : [];
  const noQuery = q.trim().length < 2;

  const title = target === "immobile" ? "Dov'è l'immobile?" : target === "zona" ? "Quale zona o città?" : "Chi vuoi recensire?";
  const hint = target === "immobile"
    ? "Cerca l'indirizzo (Via dei Mille 15, Milano) o il nome della scheda."
    : target === "zona"
      ? "Cerca qualsiasi comune, paese o frazione d'Italia."
      : "Cerca per nome: agenzie, ditte, amministratori, professionisti, persone.";

  return (
    <div className="container" style={{ maxWidth: 860, paddingTop: 18 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <p className="sub" style={{ margin: "6px 0 0" }}>{hint}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Cambia soggetto</button>
      </div>

      {personBlock ? (
        <Alert kind="warn">
          <span className="pill pill-amber" style={{ marginRight: 8 }}>Serve esperienza verificata</span>
          <b>{personBlock.entity.name}</b> è una persona fisica: si recensisce solo con <a href="#/verifica-esperienza">invito del soggetto</a> o <a href="#/verifica-esperienza">verifica documentale</a> — così il badge «verificata» resta affidabile.
          <div className="row mt2">
            <a className="btn btn-primary btn-sm" href="#/verifica-esperienza">Verifica la tua esperienza</a>
            <button className="btn btn-ghost btn-sm" onClick={() => setPersonBlock(null)}>← Altri risultati</button>
          </div>
        </Alert>
      ) : (
        <>
          <form className="searchbar" role="search" onSubmit={e => { e.preventDefault(); void runSearch(q.trim()); }}>
            <input
              type="search"
              placeholder={target === "altro" ? "Es. Studio Tecnico Rossi, Impresa Bianchi…" : "Es. Via dei Mille 15, Milano, Alassio…"}
              aria-label="Cerca luogo o scheda"
              value={q} onChange={e => setQ(e.target.value)}
              autoFocus
            />
            <button className="btn btn-primary" type="submit" disabled={busyInt || busyGeo}>
              {busyInt || busyGeo ? "Cerca…" : "Cerca"}
            </button>
          </form>

          {target !== "altro" ? (
            <div className="row mt2" style={{ gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={useGps} disabled={gpsStage !== "idle"}
                title="Con il tuo consenso uso il GPS e ricavo via e civico reali dalla cartografia OpenStreetMap. Le coordinate vanno al geocoder solo ora, su tua richiesta.">
                {gpsStage === "gps" ? "Rilevo la posizione…" : gpsStage === "addr" ? "Cerco l'indirizzo…" : "Usa la mia posizione"}
              </button>
              <span className="zz-count" title="In alternativa al GPS: al passo seguente puoi piazzare il pin sulla mappa.">
                {target === "immobile" ? "GPS o pin sulla mappa" : "GPS per la tua città"}
              </span>
            </div>
          ) : null}

          {/* --- risultati interni: schede già su ZoomZoom --- */}
          {target === "zona" ? (
            pubZones == null ? <p className="muted mt2">Carico le città…</p> : zoneRows.length || q.trim().length >= 2 ? (
              <>
                <p className="pick-sect">Su ZoomZoom {zoneBusy ? <span className="small muted">· attivo la scheda…</span> : null}</p>
                <div className="pick-list">
                  {zoneRows.map(z => (
                    <ZoneCard key={z.id} name={z.name} active={!!z.entityId} busy={zoneBusy} onClick={() => void pickZone({ id: z.id, name: z.name, lat: z.lat, lng: z.lng, entityId: z.entityId })} />
                  ))}
                  {!zoneRows.length ? <p className="small muted mb0">Nessuna città del catalogo corrisponde: la cerchi qui sotto, sulla mappa.</p> : null}
                </div>
              </>
            ) : null
          ) : internal && internal.length ? (
            <>
              <p className="pick-sect">Su ZoomZoom — recensibili subito</p>
              <div className="pick-list">
                {internal.map(r => {
                  const cat = boot?.categories.find(c => c.id === r.entity.categoryId);
                  return (
                    <button type="button" key={r.entity.id} className="pick-card" onClick={() => pickInternal(r)}>
                      <span className="pick-ico" style={{ background: cat?.hexColor || "#33658A" }}>{iconSvg(cat?.icon || "immobile", 17)}</span>
                      <span className="pick-body">
                        <span className="pick-title">{r.entity.name}</span>
                        <span className="pick-sub">
                          {r.entity.address ? dispAddress(r.entity.address, r.entity.streetNumber) || r.entity.subtitle || "" : (r.entity.subtitle || "")}{r.entity.zoneId ? `${(r.entity.address || r.entity.subtitle) ? " · " : ""}${zoneName(r.entity.zoneId)}` : ""}
                        </span>
                      </span>
                      <span className="pick-tags">
                        {cat?.isPerson ? <span className="pill pill-amber">Verifica richiesta</span> : null}
                        {r.n > 0
                          ? <span className="small" style={{ whiteSpace: "nowrap" }}><Stars score={r.mean} size={12} /> {fmt1(r.mean ?? 0)}/10 · {r.n}</span>
                          : <span className="pill pill-green">Prima recensione</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : internal && !internal.length && !noQuery ? (
            <Alert kind="info">
              Nessuna scheda{q.trim() ? ` per “${q.trim()}”` : ""}: {target === "altro" ? "proponila qui sotto." : "cerca il luogo sulla mappa qui sotto e la scheda nasce con la tua recensione."}
            </Alert>
          ) : null}

          {/* --- luoghi della mappa (OpenStreetMap) --- */}
          {target !== "altro" ? (
            <>
              {geoRes && geoRes.length ? (
                <>
                  <p className="pick-sect" title="Risultati dalla cartografia nazionale OpenStreetMap: città, vie, indirizzi con civico.">Dalla mappa — per creare la scheda</p>
                  <div className="pick-list">
                    {geoRes.slice(0, 6).map((g, i) => {
                      const street = [g.road, g.houseNumber].filter(Boolean).join(" ");
                      return (
                        <button type="button" key={i} className="pick-card" onClick={() => pickGeo(g)}>
                          <span className="pick-ico" style={{ background: street ? "#33658A" : "#4E7D5B" }}>{iconSvg(street ? "immobile" : "zona", 17)}</span>
                          <span className="pick-body">
                            <span className="pick-title">{street || g.zoneName || g.name}</span>
                            <span className="pick-sub">
                              {street
                                ? [g.zoneName, g.province].filter(Boolean).join(" · ")
                                : `${g.kind}${g.province ? ` · ${g.province}` : ""}`}
                            </span>
                          </span>
                          <span className="pick-tags">
                            {street ? <span className="pill pill-gray">Indirizzo</span> : <span className="pill pill-gray">Località</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : geoRes && !geoRes.length && !noQuery ? (
                <p className="small muted mt2 mb0">{throttled ? "Troppe ricerche di fila: attendi qualche secondo." : "Nessun luogo trovato sulla mappa: controlla il nome o usa il GPS."}</p>
              ) : null}
              {noQuery && target === "immobile" ? (
                <p className="small muted mt2 mb0" title="Gli indirizzi sono dati pubblici per natura: una scheda per indirizzo e città, il dedup è automatico.">
                  Scegli una scheda esistente oppure un luogo dalla mappa: la scheda nasce subito, se manca.
                </p>
              ) : null}
            </>
          ) : (
            <SubjectProposal />
          )}
        </>
      )}
    </div>
  );
}

/* card compatta per una città del catalogo (target zona) */
function ZoneCard({ name, active, busy, onClick }: { name: string; active: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="pick-card" onClick={onClick} disabled={busy}>
      <span className="pick-ico" style={{ background: "#4E7D5B" }}>{iconSvg("zona", 17)}</span>
      <span className="pick-body">
        <span className="pick-title">{name}</span>
        <span className="pick-sub">{active ? "Scheda attiva · servizi, trasporti, sicurezza, costi" : "Sul catalogo · scheda da attivare"}</span>
      </span>
      <span className="pick-tags">
        {active
          ? <span className="pill pill-green">Recensibile</span>
          : <span className="pill pill-amber">Da attivare</span>}
      </span>
    </button>
  );
}

/* ---------- Altro soggetto: non lo trovi? Proponilo (revisione staff) ---------- */
function SubjectProposal() {
  const { boot, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [catId, setCatId] = useState("agenzia");
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subjectCats = (boot?.categories || []).filter(c => c.id !== "immobile" && c.id !== "zona");
  const whyN = why.trim().length;
  const canSend = name.trim().length >= 3 && whyN >= 20 && !busy;

  if (done) {
    return (
      <div className="card mt3">
        <p className="mb1"><span className="pill pill-amber">In revisione allo staff</span></p>
        <p className="small mb1">Proposta inviata: <b>{name}</b>. Riceverai l&apos;esito via email{boot?.site.emailDelivery === "demo" ? " (casella demo)" : ""}.</p>
        <p className="small muted mb0">Alla approvazione la scheda nasce nel catalogo e potrai scriverle la recensione.</p>
        <div className="row mt2">
          <a className="btn btn-primary btn-sm" href="#/cerca">Torna alla ricerca</a>
          <a className="btn btn-ghost btn-sm" href="#/profilo">Le mie proposte</a>
        </div>
      </div>
    );
  }

  return (
    <div className="card mt3">
      {!open ? (
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>+ Non la trovi? Proponila</button>
      ) : (
        <form onSubmit={async e => {
          e.preventDefault();
          if (!canSend) return;
          setBusy(true); setErr(null);
          const res = await api("/api/proposals", { body: { categoryId: catId, name: name.trim(), justification: why.trim(), hp } });
          setBusy(false);
          if (res.ok) { setDone(true); toast("Proposta inviata: in revisione allo staff."); }
          else setErr(res.error);
        }}>
          <div className="field">
            <label htmlFor="sp-cat">Categoria</label>
            <select id="sp-cat" value={catId} onChange={e => setCatId(e.target.value)}>
              {subjectCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sp-name">Nome del soggetto</label>
            <input id="sp-name" value={name} onChange={e => setName(e.target.value)} required minLength={3} placeholder="Es. Studio Tecnico Rossi" />
          </div>
          <div className="field">
            <label htmlFor="sp-why">Perché è utile una scheda? <span className="muted">(min 20 caratteri)</span></label>
            <textarea id="sp-why" value={why} onChange={e => setWhy(e.target.value)} required
              placeholder="Es. ho ricevuto un servizio da questo soggetto e voglio condividere l'esperienza" />
            <span className={`zz-count ${whyN >= 20 ? "ok" : "todo"}`} style={{ marginTop: 6 }}>
              {whyN}/20 caratteri
            </span>
          </div>
          <div className="hp-field"><label htmlFor="sp-hp">Non compilare</label><input id="sp-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} /></div>
          {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annulla</button>
            <button className="btn btn-primary" type="submit" disabled={!canSend} title={canSend ? undefined : "Nome (3+ caratteri) e motivazione (20+ caratteri)."}>
              {busy ? "Invio…" : "Invia proposta"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ---------- Passo 3: controlla la scheda (badge + solo i mancanti) ---------- */
function ConfirmStep({ target, draft, setDraft, onBack, onReady }: {
  target: Target;
  draft: Draft;
  setDraft: (updater: (d: Draft) => Draft) => void;
  onBack: () => void;
  onReady: (ent: SelEntity, note: { created: boolean; reused: boolean }) => void;
}) {
  const { boot, toast } = useApp();
  const [editZone, setEditZone] = useState(!draft.zone);
  const [editAddr, setEditAddr] = useState(target === "immobile" && draft.address.trim().length < 3);
  const [editCivico, setEditCivico] = useState(target === "immobile" && !draft.civico.trim());
  const [editUnit, setEditUnit] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyRow[] | null>(null);
  // schede già esistenti allo stesso indirizzo (via + civico): il condominio
  // si vede PRIMA di crearne una nuova — ogni unità ha la sua scheda
  const [building, setBuilding] = useState<BuildingRow[] | null>(null);

  const isImmobile = target === "immobile";
  const via = draft.address.trim();
  const civico = draft.civico.trim();
  const unit = draft.unit.trim();

  // la città scelta dalla mappa può già esistere nel catalogo: se c'è, il suo
  // id locale serve al controllo delle schede dello stesso civico (building)
  useEffect(() => {
    const name = draft.zone?.name?.toLowerCase();
    if (!name || draft.zone?.localId || !boot?.zones) return;
    const known = boot.zones.find(z => z.name.toLowerCase() === name);
    if (known) setDraft(d => (d.zone && !d.zone.localId ? { ...d, zone: { ...d.zone, localId: known.id } } : d));
  }, [draft.zone, boot, setDraft]);
  const addrOk = via.length >= 3;
  const civicoOk = civico.length >= 1;
  const valid = !!draft.zone && (!isImmobile || (addrOk && civicoOk));
  const myUnitNorm = normUnit(unit);
  const fullAddr = dispAddress(via, civico);

  // conferma: proposta di riuso (C6, pin) → schede dello stesso civico →
  // creazione/dedup (EXIST/CREATE)
  const confirm = async (skip: { prox?: boolean; building?: boolean } = {}) => {
    if (busy || !valid) return;
    setErr(null); setBusy(true);

    if (target === "zona") {
      const z = draft.zone!;
      const res = await api<{ entityId: string; created: boolean }>("/api/zones", {
        body: { name: z.name, province: z.province, region: z.region, lat: z.lat, lng: z.lng },
      });
      setBusy(false);
      if (res.ok && res.entityId) {
        toast(res.created ? `Scheda di ${z.name} attivata.` : `Scheda di ${z.name} già pronta.`);
        onReady({ id: res.entityId, name: z.name, categoryId: "zona" }, { created: res.created, reused: !res.created });
      } else setErr(res.error);
      return;
    }

    // immobile — con il pin, prima propongo le schede vicine (entro 50 m)
    if (draft.geo && !skip.prox) {
      const nr = await api<{ rows: NearbyRow[] }>(`/api/public/nearby?lat=${draft.geo.lat}&lng=${draft.geo.lng}${draft.zone?.localId ? `&zona=${draft.zone.localId}` : ""}`);
      if (nr.ok && nr.rows?.length) { setNearby(nr.rows); setBusy(false); return; }
    }
    setNearby(null);

    // stesso indirizzo (via + civico): le schede del condominio si vedono
    // prima di crearne una nuova. Il civico discrimina gli edifici nella
    // via, l'interno le unità nello stesso civico: se una coincide, si usa
    if (!skip.building && draft.zone?.localId && addrOk) {
      const br = await api<{ rows: BuildingRow[] }>(`/api/public/building?zona=${encodeURIComponent(draft.zone.localId)}&via=${encodeURIComponent(via)}&civico=${encodeURIComponent(civico)}`);
      if (br.ok && br.rows?.length) { setBuilding(br.rows); setBusy(false); return; }
    }
    setBuilding(null);

    const z = draft.zone;
    const res = await api<{ entity: { id: string; name: string } }>("/api/entities", {
      body: {
        address: via,
        streetNumber: civico,
        unit: unit || undefined,
        zoneId: z?.localId,
        zone: z && !z.localId
          ? { name: z.name, province: z.province, region: z.region, lat: z.lat, lng: z.lng }
          : undefined,
        geo: draft.geo ?? undefined,
      },
    });
    setBusy(false);
    if (res.ok && res.entity) {
      onReady({ id: res.entity.id, name: res.entity.name, categoryId: "immobile" }, { created: true, reused: false });
      return;
    }
    const ex = (res as { existingId?: string }).existingId;
    if (ex) {
      toast("Immobile già presente: uso la scheda esistente.");
      onReady({ id: ex, name: unit ? `${fullAddr}, ${unit}` : fullAddr, categoryId: "immobile" }, { created: false, reused: true });
      return;
    }
    setErr(res.error);
  };

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 18 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Controlla la scheda</h1>
          <p className="sub" style={{ margin: "6px 0 0" }}>
            {isImmobile
              ? <>Serve <span className="pill pill-green">città</span>, <span className="pill pill-green">via</span> e <span className="pill pill-green">civico</span>: il resto è facoltativo.</>
              : <>Serve la <span className="pill pill-green">località</span>: il resto arriva con la recensione.</>}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Cambia luogo</button>
      </div>

      <div className="card">
        <div className="zz-facts">
          {/* --- città / località --- */}
          <div className="zz-fact">
            <span className="zz-fact-k">{target === "zona" ? "Località" : "Città"}</span>
            {draft.zone && !editZone ? (
              <>
                <span className="zz-fact-v ok"><CheckSvg size={11} /> {draft.zone.name}{draft.zone.province ? ` (${draft.zone.province})` : ""}</span>
                <span className="spacer" />
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditZone(true)}>Modifica</button>
              </>
            ) : (
              <div style={{ flex: 1, minWidth: 220 }}>
                <PlaceSearch
                  id="cf-city" localZones={boot?.zones} placeholder="Città, comune o paese…"
                  selected={null}
                  onPick={p => {
                    setDraft(d => ({ ...d, zone: { name: p.zoneName || p.name, province: p.province, region: p.region, lat: p.lat, lng: p.lng, localId: p.localId } }));
                    setEditZone(false);
                  }}
                />
              </div>
            )}
          </div>

          {/* --- via (solo immobile): il civico va nel campo suo --- */}
          {isImmobile ? (
            <div className="zz-fact">
              <span className="zz-fact-k">Via</span>
              {addrOk && !editAddr ? (
                <>
                  <span className="zz-fact-v ok"><CheckSvg size={11} /> {via}</span>
                  <span className="spacer" />
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditAddr(true)}>Modifica</button>
                </>
              ) : (
                <div style={{ flex: 1, minWidth: 220 }}>
                  <AddressSearch
                    id="cf-addr" value={draft.address} onChange={v => setDraft(d => ({ ...d, address: v }))}
                    placeholder="Via, piazza o largo — es. Via dei Mille"
                    onPick={p => {
                      setDraft(d => ({
                        ...d,
                        address: p.road || d.address,
                        civico: p.houseNumber || d.civico,
                        geo: { lat: p.lat, lng: p.lng },
                        zone: d.zone ?? (p.zoneName ? { name: p.zoneName, province: p.province, region: p.region, lat: p.lat, lng: p.lng } : null),
                      }));
                      setEditAddr(false);
                      if (p.houseNumber) setEditCivico(false);
                    }}
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* --- civico: distingue gli edifici nella stessa via --- */}
          {isImmobile ? (
            <div className="zz-fact">
              <span className="zz-fact-k">Civico</span>
              {civicoOk && !editCivico ? (
                <>
                  <span className="zz-fact-v ok" title="In una via, piazza o largo possono esserci più edifici: il civico distingue le schede."><CheckSvg size={11} /> {civico}</span>
                  <span className="spacer" />
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditCivico(true)}>Modifica</button>
                </>
              ) : (
                <div style={{ flex: 1, minWidth: 140, maxWidth: 220 }}>
                  <input
                    id="cf-civico" type="text" autoComplete="off" autoFocus={!civicoOk}
                    aria-label="Numero civico" placeholder="Es. 15 o 15/A"
                    title="Numero civico: distingue gli edifici nella stessa via, piazza o largo."
                    value={draft.civico}
                    onChange={e => setDraft(d => ({ ...d, civico: e.target.value.slice(0, 10) }))}
                    onBlur={() => { if (civicoOk) setEditCivico(false); }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (civicoOk) setEditCivico(false); } }}
                  />
                </div>
              )}
              {!civicoOk ? <span className="pill pill-amber" title="In una via possono esserci più edifici: il civico distingue le schede.">Necessario</span> : null}
            </div>
          ) : null}

          {/* --- interno/scala: le unità di uno stesso civico (condomini) --- */}
          {isImmobile ? (
            <div className="zz-fact">
              <span className="zz-fact-k" title="Condomini e palazzi con più unità: l'interno (o la scala) distingue le schede allo stesso civico.">Interno/scala</span>
              {unit && !editUnit ? (
                <>
                  <span className="zz-fact-v ok"><CheckSvg size={11} /> {unit}</span>
                  <span className="spacer" />
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditUnit(true)}>Modifica</button>
                </>
              ) : (
                <div style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
                  <input
                    id="cf-unit" type="text" autoComplete="off"
                    aria-label="Interno o scala" placeholder="Es. interno 4, scala B"
                    title="Solo per civici con più unità (condomini): distingue la tua scheda da quella delle altre unità dello stesso indirizzo."
                    value={draft.unit}
                    onChange={e => setDraft(d => ({ ...d, unit: e.target.value.slice(0, 40) }))}
                    onBlur={() => setEditUnit(false)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setEditUnit(false); } }}
                  />
                </div>
              )}
              <span className="pill pill-gray" title="Lascia vuoto per la scheda dell'edificio: nei condomini l'interno crea una scheda per unità, ognuna con le sue recensioni.">Facoltativo</span>
            </div>
          ) : null}

          {/* --- posizione sulla mappa (facoltativa) --- */}
          {isImmobile ? (
            <div className="zz-fact">
              <span className="zz-fact-k">Posizione</span>
              {draft.geo ? (
                <span className="zz-fact-v ok" title="Il pin fa comparire l'immobile tra i punti della mappa pubblica."><CheckSvg size={11} /> Pin sulla mappa</span>
              ) : (
                <span className="zz-fact-v" title="Senza pin la scheda resta recensibile e cercabile per indirizzo.">Facoltativa</span>
              )}
              <span className="spacer" />
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowMap(s => !s)}>{draft.geo ? "Cambia" : "Aggiungi"}</button>
            </div>
          ) : null}
        </div>

        {isImmobile && showMap ? (
          <div style={{ marginBottom: 14 }}>
            <LocationPicker value={draft.geo} onChange={g => setDraft(d => ({ ...d, geo: g }))} note="" />
          </div>
        ) : null}

        {/* proposta di riuso: scheda vicina entro 50 m (C6) */}
        {nearby && nearby.length ? (
          <Alert kind="info">
            <p className="mb1"><span className="pill pill-blue">Scheda vicina</span> Ho trovato {nearby.length === 1 ? "una scheda" : `${nearby.length} schede`} entro {nearby[0].distM === 0 ? "pochi" : "50"} metri:</p>
            <div className="pick-list">
              {nearby.map(nb => (
                <button type="button" key={nb.id} className="pick-card" onClick={() => onReady({ id: nb.id, name: nb.name, categoryId: "immobile" }, { created: false, reused: true })}>
                  <span className="pick-ico" style={{ background: "#33658A" }}>{iconSvg("immobile", 17)}</span>
                  <span className="pick-body">
                    <span className="pick-title">{nb.address || nb.name}</span>
                    <span className="pick-sub">a {nb.distM} m dal tuo pin</span>
                  </span>
                  <span className="pick-tags"><span className="pill pill-green">Usa questa</span></span>
                </button>
              ))}
            </div>
            <div className="row mt2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void confirm({ prox: true })}>No, è un&apos;altra scheda — crea la nuova</button>
            </div>
          </Alert>
        ) : null}

        {/* stesso indirizzo (via + civico): le schede del condominio. Il
            civico discrimina gli edifici, l'interno le unità: chi riconosce
            la sua la usa, chi ha un interno diverso crea la sua scheda */}
        {building && building.length ? (
          <Alert kind="info">
            <p className="mb1">
              <span className="pill pill-blue" title="Stesso civico: in un condominio ogni unità ha la sua scheda, l'edificio pure.">Stesso indirizzo</span>{" "}
              A <b>{fullAddr}</b> {building.length === 1 ? "c’è già una scheda" : `ci sono già ${building.length} schede`}:
            </p>
            <div className="pick-list">
              {building.map(b => {
                const same = !!myUnitNorm && b.unitNorm === myUnitNorm;
                const toks = (s: string) => new Set(s.split(" ").filter(Boolean));
                const subset = (a: Set<string>, bb: Set<string>) => { for (const t of a) if (!bb.has(t)) return false; return true; };
                const similar = !same && !!myUnitNorm && !!b.unitNorm
                  && (subset(toks(myUnitNorm), toks(b.unitNorm)) || subset(toks(b.unitNorm), toks(myUnitNorm)));
                return (
                  <button type="button" key={b.id} className="pick-card" onClick={() => onReady({ id: b.id, name: b.name, categoryId: "immobile" }, { created: false, reused: true })}>
                    <span className="pick-ico" style={{ background: "#33658A" }}>{iconSvg("immobile", 17)}</span>
                    <span className="pick-body">
                      <span className="pick-title">{b.name}</span>
                      <span className="pick-sub">{b.unit ? b.unit : "Edificio intero · senza interno"}</span>
                    </span>
                    <span className="pick-tags">
                      {same
                        ? <span className="pill pill-green" title="Il tuo interno coincide con questa scheda: riusala per non creare un doppione.">Stesso interno</span>
                        : similar
                          ? <span className="pill pill-amber" title="L'interno somiglia al tuo: controlla bene prima di crearne uno nuovo.">Interno simile</span>
                          : <span className="pill pill-gray">{b.unit ? "Unità diversa" : "Senza interno"}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="row mt2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void confirm({ prox: true, building: true })}>
                {unit ? `Il mio interno (${unit}) è un altro — crea la scheda` : "Recensisco l'edificio — crea la scheda"}
              </button>
            </div>
          </Alert>
        ) : null}

        {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}

        <div className="row" style={{ justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
          {!valid ? (
            <span className="zz-count todo" title="La città si sceglie dai suggerimenti; la via vuole almeno 3 caratteri e il civico almeno 1 (es. 15 o 15/A).">
              Manca: {[!draft.zone ? "città" : "", !addrOk ? "via" : "", !civicoOk ? "civico" : ""].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void confirm()}>
            {busy ? "Preparo la scheda…" : "Conferma e continua"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Passo 4: la recensione (modulo unico, validazione inline) ---------- */
function ReviewStep({ sel, schedaNote, onBack, onDone }: {
  sel: SelEntity;
  schedaNote: { created: boolean; reused: boolean } | null;
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
  // C7 — "hai già recensito questa scheda?" PRIMA di far compilare il modulo
  const [dup, setDup] = useState<"loading" | "mine" | "ok">("loading");

  useEffect(() => { if (cat?.experienceKinds.length) setKind(cat.experienceKinds[0]); }, [cat]);

  useEffect(() => {
    void (async () => {
      const res = await api<{ myReviewCount?: number; myReviewId?: string | null }>(`/api/public/entity/${sel.id}`);
      setDup(res.ok && (res.myReviewCount ?? 0) > 0 ? "mine" : "ok");
    })();
  }, [sel.id]);

  if (!boot || !cat) return <div className="container section"><p className="muted">Caricamento criteri…</p></div>;

  // validazione inline (C8) — stesse regole del server, che resta l'autorità
  const textLen = form.text.trim().length;
  const prosN = countLines(form.pros);
  const priceN = Number(form.priceAmount);
  const priceBad = form.priceAmount !== "" && (!Number.isFinite(priceN) || priceN <= 0 || priceN > 100_000_000);
  const okText = textLen >= 100, okPros = prosN >= 1, okHonesty = form.honesty, okPrice = !priceBad;
  const canSend = okText && okPros && okHonesty && okPrice && !!kind && !busy;

  if (dup === "loading") {
    return <div className="container section" style={{ maxWidth: 760 }}><p className="muted">Controllo le tue recensioni…</p></div>;
  }

  if (dup === "mine") {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <h1>Recensione già scritta</h1>
        <Alert kind="info">
          <span className="pill pill-amber" style={{ marginRight: 8 }}>Una per scheda</span>
          Su <b>{sel.name}</b> c&apos;è già la tua recensione: ogni scheda accetta una recensione per utente. Puoi aggiornarla con una <b>rettifica motivata</b> (entro {boot.settings.rettificaDays} giorni dalla pubblicazione o dall&apos;ultimo aggiornamento).
        </Alert>
        <div className="row mt2">
          <a className="btn btn-primary" href={`#/scheda/${sel.id}`}>Vai alla scheda e rettifica</a>
          <a className="btn btn-ghost" href="#/profilo">Le mie recensioni</a>
        </div>
      </div>
    );
  }

  if (cat.isPerson) {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <h1>Serve una esperienza verificata</h1>
        <Alert kind="warn">
          <span className="pill pill-amber" style={{ marginRight: 8 }}>Persone fisiche</span>
          <b>{sel.name}</b> è una persona fisica: le sue recensioni nascono solo con l&apos;<b>invito del soggetto</b> o la <b>verifica documentale</b> dell&apos;esperienza. È ciò che rende affidabile il badge «verificata».
        </Alert>
        <div className="row mt2">
          <a className="btn btn-primary" href="#/verifica-esperienza">Verifica la tua esperienza</a>
          <button className="btn btn-ghost" onClick={onBack}>← Cambia soggetto</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 18, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>La recensione</h1>
          <p className="sub" style={{ margin: "6px 0 0", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <ChipCat cat={cat} href={false} /> <b>{sel.name}</b>
            {schedaNote?.created ? <span className="pill pill-green" title="La scheda è nata adesso, con i dati che hai confermato.">Nuova scheda</span> : null}
            {schedaNote?.reused ? <span className="pill pill-blue" title="Stai usando una scheda già presente nel catalogo.">Scheda esistente</span> : null}
            <span className="pill pill-gray" title="Senza invito o verifica documentale la recensione è marcata «esperienza dichiarata». Puoi verificarla in ogni momento successivo.">Dichiarata</span>
            {boot.site.premiumEnabled ? (
              <span className="pill pill-green" title={`Pubblicando ottieni ${boot.settings.premiumDaysPerReview} giorni di Membership Premium: lettura integrale delle recensioni di tutte le schede. Il premio è per il contributo, non per il voto.`}>
                Premium +{boot.settings.premiumDaysPerReview} gg
              </span>
            ) : null}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Cambia soggetto</button>
      </div>

      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          if (!canSend) return;
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
          </div>
          <ReviewFields cat={cat} form={form} setForm={setForm} />
          <PhotoInput photos={photos} onChange={setPhotos} enabled={!!boot.site.photosEnabled} />
          <label className="checkline mb2">
            <input type="checkbox" checked={form.honesty} onChange={e => setForm(f => ({ ...f, honesty: e.target.checked }))} required />
            <span><b>Dichiarazione:</b> l&apos;esperienza è personale e rispetto le <a href="#/regole-recensioni">regole</a>: niente dati di terzi senza autorizzazione, niente finalità promozionali.</span>
          </label>

          {/* stato del modulo in tempo reale: stessi requisiti del server */}
          <div className="zz-counts" aria-live="polite">
            <span className={`zz-count ${okText ? "ok" : "todo"}`}>Testo {textLen}/100</span>
            <span className={`zz-count ${okPros ? "ok" : "todo"}`}>Pro {prosN}</span>
            <span className={`zz-count ${photos.length ? "ok" : ""}`}>Foto {photos.length}/3</span>
            <span className={`zz-count ${okHonesty ? "ok" : "todo"}`}>Dichiarazione</span>
          </div>

          <div className="hp-field"><label htmlFor="orv-hp">Non compilare</label><input id="orv-hp" tabIndex={-1} autoComplete="off" value={form.hp} onChange={e => setForm(f => ({ ...f, hp: e.target.value }))} /></div>
          {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
          <button
            className="btn btn-primary btn-block" type="submit" disabled={!canSend}
            title={!canSend ? "Completa i requisiti segnati in ambra qui sopra (il server applica le stesse regole)." : undefined}
          >
            {busy ? "Pubblico…" : "Pubblica la recensione"}
          </button>
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Pubblichi senza invito: l&apos;esperienza resta <b>dichiarata</b> — <a href="#/verifica-esperienza">verificabile dopo</a> con invito o documenti. Segnalazioni e moderazione restano attive.
          </p>
        </form>
      </div>
    </div>
  );
}
