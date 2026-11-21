"use client";
// ZoomZoom — contributo aperto: "Scrivi una recensione" senza invito.
// Immobile e zona si recensiscono subito: basta trovare la scheda oppure
// aggiungerla dall'indirizzo reale (con posizione facoltativa da GPS o mappa).
// È il cuore della strategia anti "catalogo vuoto": ogni utente porta il
// primo mattone (l'indirizzo) e il contenuto arriva con la recensione.
// Le persone fisiche restano sulla via invito/verifica: qui si spiegano i motivi.
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmt1 } from "@/lib/client/api";
import { navigate } from "@/lib/client/router";
import { Alert, ChipCat, Stars } from "../ui-kit";
import { iconSvg } from "../icons";
import { ReviewFields, type ReviewFormCore } from "../review-fields";
import { PhotoInput } from "../photo-input";
import { LocationPicker, type LatLng } from "../location-picker";

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
          <p className="small mb0">Appartamento, casa o singolo indirizzo. Trovalo tra le schede oppure <b>aggiungilo tu dall&apos;indirizzo</b>: la prima recensione può essere la tua.</p>
          <span className="pill pill-green" style={{ marginTop: 10 }}>Subito, senza invito</span>
        </button>
        <button className="card card-click" style={{ textAlign: "left" }} onClick={() => onPick("zona")}>
          <span className="cat-ico" style={{ background: "#4E7D5B", color: "#fff" }}>{iconSvg("zona", 22)}</span>
          <h3>Una città / zona</h3>
          <p className="small mb0">Dove vivi, lavori o studi: servizi, trasporti, sicurezza percepita, costi. Le {boot?.zones.length} città coperte hanno già la loro scheda.</p>
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
  const [zoneId, setZoneId] = useState("");
  const [geo, setGeo] = useState<LatLng | null>(null);
  const [geoQ, setGeoQ] = useState("");
  const [geoRes, setGeoRes] = useState<Array<{ label: string; lat: number; lng: number }> | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    setBusy(true);
    const res = await api<{ rows: SearchRow[] }>(`/api/public/search?cat=immobile${query ? `&q=${encodeURIComponent(query)}` : ""}`);
    setRows(res.ok ? res.rows : []);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (target === "immobile") void search("");
  }, [target, search]);

  // zona: serve l'id della scheda zona (ent_z_<zona>) chiesto alla mappa pubblica
  const pickZone = async (zid: string, zname: string) => {
    const res = await api<{ zones: Array<{ id: string; entityId: string | null }> }>("/api/public/map");
    if (res.ok) {
      const z = res.zones.find(zz => zz.id === zid);
      if (z?.entityId) { onSelected({ id: z.entityId, name: zname, categoryId: "zona" }); return; }
    }
    toast("Scheda della città non raggiungibile: riprova.", "err");
  };

  const doGeocode = async () => {
    if (geoQ.trim().length < 3) return;
    setGeoBusy(true); setGeoRes(null);
    const res = await api<{ results: Array<{ label: string; lat: number; lng: number }> }>(`/api/public/geocode?q=${encodeURIComponent(geoQ.trim())}`);
    setGeoRes(res.ok ? res.results : []);
    setGeoBusy(false);
  };

  const addEntity = async () => {
    setAddErr(null);
    const res = await api<{ entity: { id: string; name: string } }>("/api/entities", {
      body: { address: address.trim(), zoneId, geo },
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
          <p className="sub">{target === "immobile" ? "Cercalo tra le schede esistenti oppure aggiungilo dall'indirizzo: basta quello." : "Seleziona la città di cui vuoi raccontare la vita quotidiana."}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Cambia categoria</button>
      </div>

      {target === "zona" ? (
        <div className="grid grid-3">
          {boot?.zones.map(z => (
            <button key={z.id} className="card card-click" style={{ textAlign: "left" }} onClick={() => void pickZone(z.id, z.name)}>
              <h3 style={{ margin: 0 }}>{z.name}</h3>
              <span className="small muted">Servizi, trasporti, sicurezza, costi</span>
            </button>
          ))}
        </div>
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
              <p className="sub">Inserisci l&apos;indirizzo reale: la scheda nasce subito e resta nella tua città. Niente catalogo vuoto.</p>
            </div>
          </div>
          <div className="card">
            {!adding ? (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Aggiungi un immobile da recensire</button>
            ) : (
              <form onSubmit={async e => {
                e.preventDefault();
                if (address.trim().length < 5 || !zoneId) { setAddErr("Indica l'indirizzo (almeno 5 caratteri) e la città."); return; }
                await addEntity();
              }}>
                <div className="field">
                  <label htmlFor="ne-address">Indirizzo dell&apos;immobile</label>
                  <input id="ne-address" required placeholder="Es. Via dei Mille 15" value={address} onChange={e => setAddress(e.target.value)} />
                  <span className="hint">Come appare su una buca delle lettere: via, numero, eventualmente scala o interno. È un dato pubblico per natura.</span>
                </div>
                <div className="field">
                  <label htmlFor="ne-zone">Città</label>
                  <select id="ne-zone" required value={zoneId} onChange={e => setZoneId(e.target.value)}>
                    <option value="">— Seleziona la città —</option>
                    {boot?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </div>
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
                            <button type="button" onClick={() => { setGeo({ lat: g.lat, lng: g.lng }); setGeoRes(null); }}>{g.label}</button>
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
