"use client";
// ZoomZoom — scheda entità e scheda zona.
// Contributo aperto: chi non ha il Premium vede le ultime 3 recensioni in
// anteprima offuscata (il testo integrale non lascia mai il server), le foto
// restano riservate ai Premium e a chi ha contribuito con una foto, i voti
// di utilità (pollice su/giù) sono conteggi pubblici ma li esprimono i
// Premium. Le recensioni senza invito mostrano il badge "dichiarata".
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmt1, fmtInt, fmtMonthYear } from "@/lib/client/api";
import { Alert, ChipCat, Crumbs, CriteriaBars, DemoChip, insuffChip, MethodNoteBox, Modal, ScoreLine, Stars, VerifBadge } from "../ui-kit";
import { MapLegend, MapViewport } from "../map";
import { AdSlot } from "../chrome";
import { iconSvg } from "../icons";
import { ConsultantCard } from "./consulente";

type ReviewItem = {
  id: string;
  // null quando l'autore non ha attivato il flag: in quel caso il server
  // non invia MAI il nickname e sulla recensione compare la sola categoria
  author: string | null;
  authorCategory: string | null; // categoria d'appartenenza dichiarata (snapshot alla pubblicazione)
  showIdentity: boolean;
  mine?: boolean; // una propria recensione: riconoscibile dall'autore anche se anonima
  avatarUrl?: string | null;
  score: number; criteria: Record<string, number>;
  criteriaLabels: Record<string, string> | null;
  pros: string[]; cons: string[];
  price: { amount: number; unit: string; kind: string } | null;
  text: string; verified: boolean;
  createdAt: string; updatedAt: string | null; updateReason: string | null; isDemo: boolean;
  photos: Array<{ id: string; width: number; height: number }>;
  votes: { up: number; down: number };
  myVote: number | null;
  teaser?: boolean;
};

// etichetta singolare della categoria d'appartenenza del recensore
// (le categorie del catalogo hanno nomi plurali: qui serve la persona)
const AUTHOR_CATEGORY_LABELS: Record<string, string> = {
  proprietario: "Proprietario",
  affittuario: "Affittuario",
  amministratore: "Amministratore di condominio",
  agenzia: "Agenzia immobiliare",
  ditta: "Ditta / professionista",
  consulente: "Consulente tecnico",
};

type EntityPayload = {
  entity: {
    id: string; categoryId: string; name: string; subtitle: string | null; address: string | null; streetNumber?: string | null; unit?: string | null;
    zoneId: string | null; geo: { lat: number; lng: number } | null; initialsOnly: boolean;
    verifiedBusiness: boolean; isDemo: boolean;
    stats: { n: number; mean: number | null; crit: Record<string, number | null>; sufficient: boolean };
    priceStats: { unit: string; min: number; max: number; median: number; n: number } | null;
  };
  category: { id: string; name: string; shortName: string; hexColor: string; icon: string; isPerson: boolean; isMapped: boolean; criteria: { key: string; label: string }[] } | null;
  consultant: {
    id: string; firstName: string; lastName: string; profession: string; title: string;
    bio: string | null; zoneName: string; province: string | null; region: string | null;
    radiusKm: number; feeCents: number; vatNumber: string | null; hasPhoto: boolean; twoFactor: boolean;
  } | null;
  reviews: ReviewItem[];
  teasers: ReviewItem[];
  hiddenCount: number;
  publishedCount: number;
  premium: {
    enabled: boolean; daysPerReview: number; locked: boolean;
    activeUntil: string | null; lockedCount: number;
  };
  photos: { enabled: boolean; canView: boolean; viaContribution: boolean };
  votes: { enabled: boolean; canVote: boolean };
  settings: { minReviews: number; rettificaDays: number };
};

// Scheda riservata agli utenti Premium: aggregati pubblici, testi integrali
// sbloccati contribuendo. È il cartello mostrato sopra l'anteprima offuscata
// quando l'utente non ha l'accesso (il server non invia i testi in alcun caso).
function PremiumLockedBox({ lockedCount, daysPerReview, logged }: { lockedCount: number; daysPerReview: number; logged: boolean }) {
  return (
    <div className="premium-locked" role="note" aria-label="Indagini integrali riservate agli utenti Premium">
      <div className="premium-locked-head">
        <span className="premium-lock" aria-hidden="true">🔒</span>
        <div>
          <h3 style={{ margin: 0 }}>{lockedCount > 0 ? `${lockedCount} ${lockedCount === 1 ? "indagine riservata" : "indagini riservate"}` : "Indagini riservate"}</h3>
          <p className="small mb0">Medie, criteri e conteggi restano pubblici; qui sotto le ultime tre in <b>anteprima offuscata</b>. Il testo integrale si sblocca con la Membership Premium.</p>
        </div>
      </div>
      <p className="small mb1">Il Premium non si compra: si guadagna contribuendo. Ogni indagine che pubblichi attiva <b>{daysPerReview} giorni di Premium</b> (accumulabili), che ti lascia leggere tutte le indagini del sito. Allegiando una foto sblocchi anche le foto degli altri.</p>
      <div className="row">
        {logged ? (
          <a className="btn btn-primary btn-sm" href="#/recensione">Scrivi la tua indagine</a>
        ) : (
          <a className="btn btn-primary btn-sm" href="#/accedi">Accedi per iniziare</a>
        )}{" "}
        <a className="btn btn-ghost btn-sm" href="#/premium">Come funziona il Premium</a>
      </div>
      <p className="small muted mb0">Le tue indagini restano sempre visibili a te. La moderazione può revocare il Premium ottenuto con contributi fraudolenti.</p>
    </div>
  );
}

// Testo in anteprima: l'estratto iniziale è leggibile, la maschera di punti
// (calcolata dal server) viene resa sfocata: effetto "offuscato" senza mai
// ricevere il testo integrale.
function TeaserText({ text }: { text: string }) {
  const i = text.indexOf("•");
  if (i === -1) return <p className="review-body mb0">{text}</p>;
  return (
    <p className="review-body mb0">
      {text.slice(0, i)}
      <span className="rev-mask" aria-hidden="true">{text.slice(i)}</span>
    </p>
  );
}

function PhotosStrip({ r, canView, hintContribution }: { r: ReviewItem; canView: boolean; hintContribution: boolean }) {
  if (!r.photos.length) return null;
  if (canView) {
    return (
      <div className="photo-grid">
        {r.photos.map(p => (
          <a key={p.id} href={`/api/public/photo/${p.id}`} target="_blank" rel="noopener noreferrer" title="Apri la foto in dimensione originale">
            <img src={`/api/public/photo/${p.id}`} alt="Foto dell'immobile allegata a un'indagine della community" loading="lazy" />
          </a>
        ))}
      </div>
    );
  }
  return (
    <div className="photo-grid">
      {r.photos.map((p, i) => (
        <div key={p.id} className="photo-tile-locked" title="Foto riservata: si sblocca con il Premium o contribuendo con una foto">
          <span aria-hidden="true">🔒</span>
          <span>Foto {i + 1}</span>
        </div>
      ))}
      {hintContribution ? <p className="small muted mb0" style={{ gridColumn: "1 / -1" }}>Le foto si sbloccano con la Membership Premium oppure allegando una foto a una tua indagine.</p> : null}
    </div>
  );
}

function VoteBar({ r, canVote, enabled }: { r: ReviewItem; canVote: boolean; enabled: boolean }) {
  const { user } = useApp();
  const [v, setV] = useState({ up: r.votes.up, down: r.votes.down, mine: r.myVote });
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;
  const vote = async (value: number) => {
    if (busy) return;
    setBusy(true);
    const next = v.mine === value ? 0 : value; // clic di nuovo = ritira il voto
    const res = await api<{ up: number; down: number; mine: number | null }>(`/api/reviews/${r.id}/vote`, { body: { value: next } });
    setBusy(false);
    if (res.ok) setV({ up: res.up, down: res.down, mine: res.mine });
  };
  return (
    <div className="vote-bar">
      <span className="small muted">Ti risulta attendibile?</span>
      <button type="button" className={`vote-btn up${v.mine === 1 ? " on" : ""}`} disabled={!canVote || busy}
        onClick={() => void vote(1)}
        title={canVote ? "Confermi la plausibilità di questa indagine" : "Il voto è riservato agli utenti Premium: si ottiene pubblicando un'indagine"}
        aria-label="Pollice su: indagine attendibile">👍 <span className="vote-n">{v.up}</span></button>
      <button type="button" className={`vote-btn down${v.mine === -1 ? " on" : ""}`} disabled={!canVote || busy}
        onClick={() => void vote(-1)}
        title={canVote ? "Questa indagine non ti torna: esprimi il disconoscimento" : "Il voto è riservato agli utenti Premium: si ottiene pubblicando un'indagine"}
        aria-label="Pollice giù: indagine non confermata">👎 <span className="vote-n">{v.down}</span></button>
      {!canVote ? <span className="small muted">{user ? "votano gli utenti Premium" : <a href="#/accedi">accedi per votare</a>}</span> : null}
    </div>
  );
}

// Identità dell'autore — privacy by default:
//   - flag OFF: cerchio con l'icona della categoria + etichetta della
//     categoria + badge «Anonima» (il nickname non è mai arrivato al client);
//   - flag ON: foto profilo + pseudonimo. Le iniziali restano sotto la
//     foto: se l'immagine manca o non carica, restano visibili come riserva.
function AuthorIdentity({ r }: { r: ReviewItem }) {
  const { boot } = useApp();
  const cat = boot?.categories.find(c => c.id === r.authorCategory) || null;
  const label = AUTHOR_CATEGORY_LABELS[r.authorCategory || ""] || "Utente";
  const signed = r.showIdentity && !!r.author;
  return (
    <div className="review-author">
      {signed ? (
        r.avatarUrl ? (
          <span className="avatar avatar-img" aria-hidden="true">
            <img src={r.avatarUrl} alt="" loading="lazy"
              onError={e => { const el = e.currentTarget; el.style.display = "none"; }} />
            <span className="avatar-fallback">{r.author!.slice(0, 2).toUpperCase()}</span>
          </span>
        ) : (
          <span className="avatar" aria-hidden="true">{r.author!.slice(0, 2).toUpperCase()}</span>
        )
      ) : (
        <span className="avatar" style={{ background: cat?.hexColor || "#5B6770" }} aria-hidden="true" title={`Categoria dell'autore: ${label}`}>
          {iconSvg(cat?.icon || "proprietario", 15, { color: "#fff" })}
        </span>
      )}
      <div>
        {signed ? <b>{r.author}</b> : <b>{label}</b>}{" "}
        {!signed ? (
          <span className="pill pill-gray" title="Per privacy sull'indagine compare solo la categoria dell'autore: né pseudonimo né foto, a meno che non li abbia autorizzati lui stesso per questa indagine.">Anonima</span>
        ) : null}
        {r.mine ? <span className="pill pill-blue" title="Una delle tue indagini: per te è sempre riconoscibile.">La tua</span> : null}
        {r.verified
          ? <VerifBadge />
          : <span className="pill pill-amber" title="Indagine scritta senza invito: l'esperienza è dichiarata dall'autore, soggetta a moderazione">Dichiarata</span>}
        <div className="review-meta">
          Pubblicata: {fmtMonthYear(r.createdAt)}{r.updatedAt ? ` · aggiornata ${fmtMonthYear(r.updatedAt)}` : ""}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ r, photos, votes, onReport }: {
  r: ReviewItem;
  photos: EntityPayload["photos"];
  votes: EntityPayload["votes"];
  onReport?: (id: string) => void;
}) {
  const { user } = useApp();
  return (
    <article className="review" id={`rev-${r.id}`}>
      <div className="review-head">
        <AuthorIdentity r={r} />
        <div className="score-line">
          <Stars score={r.score} />
          <span className="score-num">{fmt1(r.score)} <small>/10</small></span>
        </div>
      </div>
      {r.price ? (
        <p className="review-meta mb1" style={{ marginTop: 2 }}>
          <b>Prezzo {r.price.kind.toLowerCase()}: </b> {fmtInt(r.price.amount)} {r.price.unit}{" "}
          <span className="muted">(dato dichiarato dal recensore, non verificato)</span>
        </p>
      ) : null}
      {!r.teaser && (r.pros.length || r.cons.length) ? (
        <div className="pc-grid">
          <div className="pc-box pc-pros">
            <h4>Punti di forza</h4>
            <ul>{r.pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
          <div className="pc-box pc-cons">
            <h4>Criticità</h4>
            <ul>{r.cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        </div>
      ) : null}
      {r.teaser ? <TeaserText text={r.text} /> : <p className="review-body mb0">{r.text}</p>}
      {photos.enabled ? <PhotosStrip r={r} canView={photos.canView} hintContribution={!!user && !photos.canView} /> : null}
      {r.updateReason ? <p className="updated-note">Motivo dell&apos;aggiornamento: {r.updateReason}</p> : null}
      <VoteBar r={r} canVote={votes.canVote} enabled={votes.enabled} />
      <div className="review-foot">
        {r.isDemo ? <DemoChip /> : null}
        <span className="spacer"></span>
        {user && onReport ? (
          <button className="btn btn-ghost btn-xs" onClick={() => onReport(r.id)}>Segnala</button>
        ) : null}
      </div>
    </article>
  );
}

export function EntityView({ id }: { id: string }) {
  const { boot, user, toast } = useApp();
  const [data, setData] = useState<EntityPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<EntityPayload>(`/api/public/entity/${id}`);
    if (res.ok) setData(res);
    else setNotFound(true);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (notFound) {
    return <div className="container section"><h1>Pagina non trovata</h1><p>Il collegamento non corrisponde a nessuna pagina. <a href="#/">Torna alla home</a>.</p></div>;
  }
  if (!data || !boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;
  const cat = boot.categories.find(c => c.id === data.entity.categoryId);
  if (!cat) return null;
  const ent = data.entity;
  const zoneName = ent.zoneId ? boot.zones.find(z => z.id === ent.zoneId)?.name : null;
  const st = ent.stats;

  return (
    <>
      <Crumbs items={[{ label: "Home", href: "#/" }, { label: cat.shortName, href: `#/categoria/${cat.id}` }, { label: ent.name }]} />
      <div className="container">
        <div className="section-head" style={{ paddingTop: 22, alignItems: "flex-start" }}>
          <div>
            <div className="row">
              <h1 style={{ margin: 0 }}>{ent.name}{" "}
                <span style={{ whiteSpace: "nowrap" }}>
                  {ent.isDemo ? <DemoChip /> : null}
                  {ent.verifiedBusiness ? <span className="pill pill-blue">Soggetto verificato</span> : null}
                </span>
              </h1>
            </div>
            <p className="sub" style={{ margin: "6px 0 0" }}>
              <ChipCat cat={cat} />{" "}
              {ent.address ? <span>· {[ent.address, ent.streetNumber].filter(Boolean).join(" ")}</span> : null}
              {ent.categoryId !== "zona" && zoneName ? <> · <a href={`#/zona/ent_z_${ent.zoneId}`}>{zoneName}</a></> : null}
              {ent.subtitle && !ent.address ? <> · {ent.subtitle}</> : null}
            </p>
          </div>
        </div>
        {cat.isPerson ? (
          <Alert kind="warn">
            <b>Persona fisica.</b> Per tutelare la privacy la scheda usa iniziali e zona, senza indirizzo né mappa. Chi scrive ha confermato un&apos;esperienza diretta verificata; le affermazioni restano opinioni personali sottoposte a moderazione.{" "}
            <button className="link" onClick={() => setDisputeOpen(true)}>Contesta l&apos;associazione della scheda</button>.
          </Alert>
        ) : null}
        <div className="grid grid-entity">
          <div>
            <div className="score-hero mb2">
              <div>
                <div className="big">{st.mean == null ? "—" : fmt1(st.mean)} <small>/ 10</small></div>
                <div className="muted small">media complessiva</div>
              </div>
              <div>
                <div><Stars score={st.mean} size={24} /></div>
                <div className="score-n">{st.n === 1 ? "1 indagine" : `${st.n} indagini`}</div>
                {st.n > 0 && !st.sufficient ? <div className="mt1">{insuffChip(st.n)} la media non è ancora statisticamente solida</div> : null}
              </div>
              {ent.priceStats ? (
                <div>
                  <div className="big" style={{ fontSize: "1.7rem" }}>{fmtInt(ent.priceStats.median)} <small>{ent.priceStats.unit}</small></div>
                  <div className="muted small">mediana dei prezzi dichiarati ({ent.priceStats.n})</div>
                  <div className="small muted">intervallo {fmtInt(ent.priceStats.min)}–{fmtInt(ent.priceStats.max)} · dato dichiarato, non verificato</div>
                </div>
              ) : null}
            </div>
            {data.consultant ? <ConsultantCard c={data.consultant} entityId={ent.id} /> : null}
            {st.n > 0 ? (
              <>
                <h2>Criteri specifici di questa categoria</h2>
                <CriteriaBars criteria={cat.criteria} stats={st} />
              </>
            ) : (
              <Alert kind="info">Ancora nessuna indagine: questa scheda non ha medie o classifiche. {cat.isPerson ? "" : "Puoi essere il primo a contribuire."}</Alert>
            )}
            <MethodNoteBox />
            <AdSlot position="scheda-mid" />
            <div className="section-head mt3">
              <h2>{cat.isPerson ? "Recensioni verificate" : "Indagini della community"}</h2>
              <span className="pill pill-gray">
                {data.premium.locked ? data.publishedCount : data.reviews.length} pubblicate{data.hiddenCount ? ` · ${data.hiddenCount} nascoste dalla moderazione` : ""}
              </span>
            </div>
            {data.premium.locked ? (
              <PremiumLockedBox lockedCount={data.premium.lockedCount} daysPerReview={data.premium.daysPerReview} logged={!!user} />
            ) : null}
            {data.premium.locked && data.teasers.length ? (
              <div className="grid">
                <p className="small muted" style={{ marginTop: 10 }}>Anteprima: ultime {data.teasers.length} indagini, testo offuscato. Il resto è riservato.</p>
                {data.teasers.map(r => <ReviewCard key={r.id} r={r} photos={data.photos} votes={data.votes} />)}
              </div>
            ) : null}
            <div className="grid">
              {data.premium.locked && data.reviews.length ? (
                <p className="small muted" style={{ marginTop: 10 }}>Queste sono le tue indagini su questa scheda (sempre visibili a te):</p>
              ) : null}
              {data.reviews.map(r => (
                <ReviewCard key={r.id} r={r} photos={data.photos} votes={data.votes} onReport={setReportFor} />
              ))}
              {!data.reviews.length && !data.teasers.length ? (
                <p className="small muted">{cat.isPerson ? "Nessuna recensione pubblica al momento." : "Nessuna indagine: quella giusta potrebbe essere la tua."}</p>
              ) : null}
              {data.hiddenCount ? (
                <div className="hidden-note">
                  {data.hiddenCount} {data.hiddenCount === 1 ? "indagine è stata nascosta" : "indagini sono state nascoste"} dopo una decisione di moderazione documentata (vedi <a href="#/moderazione">criteri e appello</a>).
                </div>
              ) : null}
            </div>
          </div>
          <aside>
            <div className="card mb2">
              {cat.isPerson ? (
                <>
                  <h3 style={{ marginTop: 0 }}>Vuoi recensire questa persona?</h3>
                  <p className="small">Servono due condizioni: un account verificato e un&apos;<b>esperienza registrata</b> su ZoomZoom, che arriva dall&apos;invito email di un soggetto verificato oppure dalla verifica documentale della tua esperienza.</p>
                  <a className="btn btn-primary btn-block" href="#/verifica-esperienza">Verifica la tua esperienza</a>
                </>
              ) : (
                <>
                  <h3 style={{ marginTop: 0 }}>Hai vissuto questo posto?</h3>
                  <p className="small">Per immobili e zone <b>non serve nessun invito</b>: dichiara la tua esperienza e pubblica. Ogni indagine vale <b>{boot.settings.premiumDaysPerReview} giorni di Premium</b>; con una foto alleghi anche la prova e sblocchi le foto di tutti.</p>
                  <a className="btn btn-primary btn-block" href={`#/recensione?entity=${ent.id}`}>Scrivi la tua indagine</a>
                  {ent.categoryId === "immobile" ? <p className="small muted mt1 mb0" style={{ textAlign: "center" }}>oppure <a href="#/recensione">cerca / aggiungi un altro immobile</a></p> : null}
                </>
              )}
              <p className="small muted mt2 mb0">Una sola indagine per esperienza; aggiornabile con rettifica motivata entro {boot.settings.rettificaDays} giorni.</p>
            </div>
            <div className="card mb2">
              <h3 style={{ marginTop: 0 }}>Problemi con la scheda?</h3>
              <p className="small mb1">Errori di associazione, contenuti illeciti o dati personali non autorizzati si possono segnalare o contestare: ogni richiesta è tracciata.</p>
              <button className="btn btn-ghost btn-block mb1" onClick={() => setDisputeOpen(true)}>Contesta l&apos;associazione</button>
              <p className="small muted mb0">Le indagini si segnalano dal pulsante &quot;Segnala&quot; presente su ciascuna (serve un account). <a href="#/moderazione">Come funziona la moderazione</a>.</p>
            </div>
            {cat.isMapped && ent.geo ? (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Posizione approssimativa</h3>
                <p className="small mb0">Punto indicativo sull&apos;indirizzo pubblico della scheda. Dalla posizione non si risale ad alcuna informazione sui recensori.</p>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
      {disputeOpen ? <DisputeModal entityId={ent.id} onClose={() => setDisputeOpen(false)} /> : null}
      {reportFor ? <ReportModal reviewId={reportFor} onClose={() => setReportFor(null)} onDone={() => { setReportFor(null); toast("Segnalazione inviata: stato consultabile dal tuo profilo."); }} /> : null}
    </>
  );
}

/* ---------- Modale segnalazione ---------- */
export function ReportModal({ reviewId, onClose, onDone }: { reviewId: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const reasons = [
    { id: "minacce", label: "Minacce, insulti o contenuto diffamatorio" },
    { id: "dati-personali", label: "Dati personali pubblicati senza autorizzazione" },
    { id: "discriminazione", label: "Contenuti discriminatori" },
    { id: "falsita", label: "Falsità manifeste" },
    { id: "spam", label: "Spam o finalità promozionali" },
    { id: "non-pertinente", label: "Non riguarda un'esperienza pertinente" },
    { id: "conflitto", label: "Conflitto di interessi sospetto" },
    { id: "altro", label: "Altro (specificare nei dettagli)" },
  ];
  return (
    <Modal label="Segnala l'indagine" onClose={onClose}>
      <div className="modal-head">
        <h2>Segnala l'indagine</h2>
        <button className="modal-close" onClick={onClose} aria-label="Chiudi">×</button>
      </div>
      <form onSubmit={async e => {
        e.preventDefault();
        setErr(null);
        const res = await api("/api/reports", { body: { reviewId, reason, details } });
        if (res.ok) onDone();
        else { setErr(res.error); toast(res.error, "err"); }
      }}>
        <div className="field">
          <label htmlFor="rep-reason">Motivo</label>
          <select id="rep-reason" required value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">— Seleziona un motivo —</option>
            {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-details">Dettagli (almeno 20 caratteri)</label>
          <textarea id="rep-details" required minLength={20} value={details}
            onChange={e => setDetails(e.target.value)}
            placeholder="Spiega il problema: aiuta la moderazione a decidere."></textarea>
          <span className="hint">La segnalazione è visibile solo alla moderazione; non è pubblica.</span>
        </div>
        {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn btn-danger" type="submit">Invia segnalazione</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Modale contestazione associazione ---------- */
export function DisputeModal({ entityId, onClose }: { entityId: string; onClose: () => void }) {
  const { user, toast } = useApp();
  const [email, setEmail] = useState(user?.email || "");
  const [claim, setClaim] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal label="Contesta associazione" onClose={onClose}>
      <div className="modal-head">
        <h2>Contesta l&apos;associazione della scheda</h2>
        <button className="modal-close" onClick={onClose} aria-label="Chiudi">×</button>
      </div>
      <p className="small muted">Per le persone fisiche e i soggetti che ritengono errata l&apos;associazione tra la scheda e la propria persona o attività. La richiesta passa alla moderazione: nessuna cancellazione automatica, decisione motivata e possibilità di appello.</p>
      <form onSubmit={async e => {
        e.preventDefault();
        setErr(null);
        const res = await api("/api/disputes", { body: { entityId, email, claim } });
        if (res.ok) { onClose(); toast("Contestazione ricevuta: riceverai l'esito via email."); }
        else setErr(res.error);
      }}>
        <div className="field">
          <label htmlFor="dis-email">La tua email di contatto</label>
          <input id="dis-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@esempio.it" />
          <span className="hint">Usata solo per comunicarti l&apos;esito: non viene pubblicata.</span>
        </div>
        <div className="field">
          <label htmlFor="dis-claim">Motivo della contestazione (almeno 30 caratteri)</label>
          <textarea id="dis-claim" required minLength={30} value={claim} onChange={e => setClaim(e.target.value)}
            placeholder="Es.: la scheda si riferisce a una persona omonima, non a me."></textarea>
        </div>
        {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn btn-primary" type="submit">Invia contestazione</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Scheda zona ---------- */
export function ZoneView({ entityId }: { entityId: string }) {
  const { boot, user } = useApp();
  const [data, setData] = useState<EntityPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [sections, setSections] = useState<Array<{ category: { id: string; shortName: string; hexColor: string; icon: string }; rows: Array<{ entityId: string; name: string; zoneId: string | null; isDemo: boolean; n: number; mean: number | null; sufficient: boolean }> }>>([]);

  useEffect(() => {
    // Reset dello stato per il nuovo id: senza questo, una scheda non
    // trovata restava "Pagina non trovata" anche dopo aver cambiato zona.
    setNotFound(false);
    setData(null);
    void api<EntityPayload>(`/api/public/entity/${entityId}`).then(res => {
      if (res.ok) setData(res); else setNotFound(true);
    });
  }, [entityId]);

  const zoneId = data?.entity.zoneId;
  useEffect(() => {
    if (!zoneId) return;
    void (async () => {
      const acc: typeof sections = [];
      for (const c of boot?.categories.filter(c => c.id !== "zona") || []) {
        const res = await api<{ sections: { category: { id: string }; rows: typeof sections[0]["rows"] }[] }>(`/api/public/rankings?cat=${c.id}&zona=${zoneId}`);
        if (res.ok && res.sections[0]) {
          acc.push({ category: { id: c.id, shortName: c.shortName, hexColor: c.hexColor, icon: c.icon }, rows: res.sections[0].rows.filter(x => x.n > 0).slice(0, 3) });
        }
      }
      setSections(acc);
    })();
  }, [zoneId, boot]);

  if (notFound) {
    return <div className="container section"><h1>Pagina non trovata</h1><p><a href="#/">Torna alla home</a>.</p></div>;
  }
  if (!data || !boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;
  const zoneName = boot.zones.find(z => z.id === zoneId)?.name || "";
  const st = data.entity.stats;
  const cat = boot.categories.find(c => c.id === "zona")!;
  const sum = sections.filter(s => s.rows.length && (!filterCat || s.category.id === filterCat));

  return (
    <>
      <Crumbs items={[{ label: "Home", href: "#/" }, { label: "Zone", href: "#/mappa" }, { label: zoneName }]} />
      <div className="container">
        <div className="section-head" style={{ paddingTop: 22 }}>
          <div>
            <h1>Zona {zoneName} {data.entity.isDemo ? <DemoChip /> : null}</h1>
            <p className="sub">Sintesi aggregata della zona: valutazioni della zona stessa e migliori 3 soggetti per ogni categoria, filtrabili.</p>
          </div>
        </div>
        <div className="grid grid-zone">
          <div>
            <div className="score-hero mb2">
              <div>
                <div className="big">{st.mean == null ? "—" : fmt1(st.mean)} <small>/ 10</small></div>
                <div className="muted small">voto medio della zona</div>
              </div>
              <div>
                <div><Stars score={st.mean} size={22} /></div>
                <div className="score-n">{st.n} indagini della zona</div>
                {st.n > 0 && !st.sufficient ? <div className="mt1">{insuffChip(st.n)}</div> : null}
              </div>
            </div>
            {st.n > 0 ? <CriteriaBars criteria={cat.criteria} stats={st} /> : <Alert kind="info">Nessuna indagine diretta della zona, ma le schede sottostanti hanno dati aggregati.</Alert>}
            <div className="section-head mt3"><h2>Migliori 3 per categoria in questa zona</h2></div>
            <div className="row mb2">
              <button className={`chip chip-filter${!filterCat ? " on" : ""}`} onClick={() => setFilterCat("")}>Tutte</button>
              {boot.categories.filter(c => c.id !== "zona").map(c => (
                <button key={c.id} className={`chip chip-filter${filterCat === c.id ? " on" : ""}`} onClick={() => setFilterCat(c.id)}>{c.shortName}</button>
              ))}
            </div>
            {sum.map(s => {
              const c = boot.categories.find(c => c.id === s.category.id)!;
              return (
                <div className="mb3" key={s.category.id}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="chip chip-cat" style={{ ["--c" as string]: s.category.hexColor }}>{s.category.shortName}</span>
                  </div>
                  <div className="grid grid-3 mt1">
                    {s.rows.map((x, i) => (
                      <article className="card card-click ent-card" key={x.entityId}>
                        <div className="ent-card-head">
                          <h3>
                            <span className={`rank-num${i === 1 ? " r2" : i === 2 ? " r3" : ""}`}>{i + 1}</span>{" "}
                            <a href={`#/scheda/${x.entityId}`}>{x.name}</a> {x.isDemo ? <DemoChip /> : null}
                          </h3>
                        </div>
                        <ScoreLine stats={{ n: x.n, mean: x.mean, sufficient: x.sufficient }} />
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
            {!sum.length ? <Alert kind="info">Nessun soggetto con indagini in questa zona{filterCat ? " per la categoria selezionata" : ""}.</Alert> : null}
            <MethodNoteBox />
            <div className="section-head mt3"><h2>Indagini della zona</h2></div>
            {data.premium.locked ? (
              <>
                <PremiumLockedBox lockedCount={data.premium.lockedCount} daysPerReview={data.premium.daysPerReview} logged={!!user} />
                {data.teasers.length ? (
                  <div className="grid">
                    {data.teasers.slice(0, 3).map(r => <ReviewCard key={r.id} r={r} photos={data.photos} votes={data.votes} />)}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="grid">
                {data.reviews.slice(0, 3).map(r => <ReviewCard key={r.id} r={r} photos={data.photos} votes={data.votes} />)}
              </div>
            )}
            <div className="mt2">
              <a className="btn btn-ghost" href={`#/scheda/${entityId}`}>Tutte le indagini e i criteri della zona</a>{" "}
              <a className="btn btn-primary" href={`#/recensione?entity=${entityId}`}>Indaga questa zona</a>
            </div>
          </div>
          <aside>
            <div className="map-wrap mb2">
              <MapViewport mode="zone" activeZone={zoneId || undefined} />
              <MapLegend />
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Dati aggregati, privacy tutelata</h3>
              <p className="small mb1">Le valutazioni di zona sono mostrate solo in forma aggregata: medie, conteggi e classifiche.</p>
              <p className="small mb0">Dalla mappa e dai riepiloghi non è possibile risalire a chi ha contribuito a un'indagine né a quando è stata scritta. Le persone fisiche non compaiono sulle mappe pubbliche. Se i dati sono troppo pochi, gli aggregati vengono soppressi.</p>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
