"use client";
// ZoomZoom — Consulente Tecnico: viste dedicate.
//   ConsulenteView          (#/consulente)            presentazione, domanda
//                                                       di iscrizione (con
//                                                       2FA obbligatoria),
//                                                       stato, dashboard del
//                                                       consulente approvato
//   ConsulenteRequestsView  (#/consulente-richieste)  richieste inviate
//                                                       (stato, pagamento,
//                                                       scarico del PDF)
//   ConsulenteRequestFormView (#/consulente-richiesta?to=<scheda>)
//                                                       modulo di richiesta
//                                                       di perizia/valutazione
//   ConsultantCard                                    sezione professionale
//                                                       della scheda pubblica
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmtDateTime } from "@/lib/client/api";
import { navigate } from "@/lib/client/router";
import { normalizeIban, validateIban } from "@/lib/iban";
import {
  prepareDocFile, preparePhotoFile, fmtBytes, dataUrlBytes,
  MAX_FILES, MAX_TOTAL_DOC_BYTES, type PreparedDoc,
} from "@/lib/client/files";
import { Alert } from "../ui-kit";
import { PlaceSearch, type Place } from "../place-search";

/* ---------- helper ---------- */

const fmtEuro = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DOC_KIND_LABEL: Record<string, string> = {
  qualifica: "Qualifica", esperienza: "Esperienza", documento: "Identificazione", altro: "Altro",
};

const PROFESSIONS = ["Geometra", "Ingegnere", "Tecnico", "Perito", "Consulente Tecnico", "Agente Immobiliare", "Altro"];
const PERIZIA_KINDS = ["Perizia tecnica", "Valutazione immobiliare", "Altro"];

type ProfiloConsultant = {
  id: string; firstName: string; lastName: string; hasPhoto: boolean;
  profession: string; title: string; bio: string | null;
  zone: { id: string; name: string; province: string | null; region: string | null };
  radiusKm: number; feeCents: number;
  vatNumber: string | null; iban: string | null; phone: string | null;
  status: string; rejectReason: string | null; entityId: string | null;
  ibanCheck: string | null; ibanCheckedAt: string | null;
  docs: Array<{ id: string; kind: string; originalName: string; sizeBytes: number }>;
  createdAt: string;
};

export type Richiesta = {
  id: string; kind: string; address: string; description: string;
  status: string; feeCents: number | null; rejectReason: string | null;
  reportTitle: string | null; deliveredAt: string | null; paidAt: string | null;
  payoutCents: number | null; commissionCents: number | null;
  createdAt: string;
  counterpart: { nickname?: string; name?: string; profession?: string };
  canDeliver?: boolean; canAccept?: boolean; canReject?: boolean; canCancel?: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  requested: "In attesa di risposta",
  accepted: "Accettata — in attesa di pagamento",
  rejected: "Rifiutata",
  paid: "Pagamento registrato — relazione in corso",
  delivered: "Relazione consegnata",
  closed: "Conclusa e accreditata",
  cancelled: "Annullata",
};

function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    requested: "pill pill-gray", accepted: "pill pill-amber", rejected: "pill pill-red",
    paid: "pill pill-blue", delivered: "pill pill-green", closed: "pill pill-green",
    cancelled: "pill pill-gray",
  };
  return <span className={cls[status] || "pill pill-gray"}>{STATUS_LABEL[status] || status}</span>;
}

/* ================================================================
   Vista principale: presentazione / iscrizione / dashboard
   ================================================================ */

export function ConsulenteView() {
  const { boot, user, toast } = useApp();
  const [me, setMe] = useState<{ profile: ProfiloConsultant | null; incoming: Richiesta[]; outgoing: Richiesta[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const res = await api<{ profile: ProfiloConsultant | null; incoming: Richiesta[]; outgoing: Richiesta[] }>("/api/consulente/me");
    if (res.ok) setMe({ profile: res.profile, incoming: res.incoming || [], outgoing: res.outgoing || [] });
    setLoading(false);
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;

  const prof = me?.profile ?? null;

  return (
    <>
      <div className="container section" style={{ maxWidth: 860 }}>
        <h1>Consulenti tecnici</h1>
        <Alert kind="info">
          Una figura professionale dedicata: <b>geometri, ingegneri, periti, tecnici e agenti immobiliari</b> iscritti con
          approvazione dello staff e accesso protetto da <b>verifica in due passaggi (2FA)</b>. Chi cerca una casa può
          chiedere una <b>perizia tecnica</b> o una <b>valutazione immobiliare indipendente</b>, ricevendola come relazione
          scritta scaricabile in PDF, dietro il pagamento della tariffa del consulente.
        </Alert>

        {!user ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Come funziona</h2>
            <ol className="small" style={{ paddingLeft: 20 }}>
              <li>Il consulente si iscrive dal suo account (2FA attiva obbligatoria) con anagrafica, zona di esercizio, raggio d&apos;azione, titolo, documenti di qualifica e identificazione, partita IVA, IBAN e tariffa.</li>
              <li>Lo staff esamina la domanda e, se idonea, approva: la scheda professionale entra nel catalogo.</li>
              <li>Un utente registrato richiede la perizia dalla scheda del consulente; il consulente accetta confermando la tariffa.</li>
              <li>L&apos;utente paga la tariffa alla piattaforma; il consulente consegna la relazione in PDF e riceve l&apos;accredito (tariffa meno il 10% che resta alla piattaforma) solo a consegna avvenuta.</li>
            </ol>
            <p className="small mb0">Per iniziare <a href="#/accedi">accedi</a> o <a href="#/registrati">registrati</a>; per chiedere una perizia, apri la scheda di un consulente dalla <a href="#/cerca">ricerca</a> o dalla categoria <a href="#/categoria/consulente">Consulenti</a>.</p>
          </div>
        ) : loading ? (
          <p className="muted">Caricamento del tuo profilo consulente…</p>
        ) : prof ? (
          prof.status === "approved" ? (
            <ConsultantDashboard prof={prof} incoming={me?.incoming || []} onChanged={load} />
          ) : prof.status === "pending" ? (
            <>
              <div className="card">
                <h2 style={{ marginTop: 0 }}>Domanda in esame</h2>
                <p className="small">La tua iscrizione come <b>{prof.profession}</b> è stata inviata il {fmtDateTime(prof.createdAt)} ed è <b>in attesa dell&apos;esame dello staff</b>. Riceverai la scheda pubblica nel catalogo all&apos;approvazione. Nel frattempo puoi consultare le tue richieste di perizia dalla <a href="#/consulente-richieste">pagina dedicata</a>.</p>
                <p className="small muted mb0">Documento caricato: {prof.docs.length} · Zona: {prof.zone.name} · Tariffa indicata: {prof.feeCents > 0 ? `€ ${fmtEuro(prof.feeCents)}` : "su richiesta"}</p>
                <p className="small mb0" style={{ marginTop: 6 }}>
                  {prof.ibanCheck === "confirmed"
                    ? <span className="pill pill-green">IBAN verificato</span>
                    : <><span className="pill pill-amber">IBAN autocertificato</span> <span className="muted">Lo staff controlla l&apos;intestazione del conto prima degli accrediti.</span></>}
                </p>
              </div>
              <DocsManager prof={prof} onChanged={load} />
            </>
          ) : (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Domanda non approvata</h2>
              <Alert kind="danger">Motivazione dello staff: {prof.rejectReason || "—"}</Alert>
              <p className="small">Puoi correggere i dati e presentare una nuova domanda: i campi verranno ricontrollati dallo staff.</p>
              <ReapplyForm prof={prof} onDone={load} />
            </div>
          )
        ) : user.totpEnabled ? (
          <ApplyForm onDone={load} />
        ) : (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Prima di iscriverti: attiva la 2FA</h2>
            <p className="small">L&apos;accesso del Consulente Tecnico è protetto dalla <b>verifica in due passaggi</b>: è obbligatoria già in fase di iscrizione. Attivala dalle impostazioni del tuo profilo (serve un&apos;app di autenticazione sul telefono), poi torna qui.</p>
            <a className="btn btn-primary" href="#/profilo-impostazioni">Vai alle impostazioni del profilo</a>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- modulo di iscrizione (prima domanda o ri-domanda) ---------- */

/** Riga di un file pronto da inviare: nome, dimensione e rimozione. */
function DocRow({ d, onRemove }: { d: PreparedDoc; onRemove: () => void }) {
  return (
    <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
      <span className="small" style={{ flex: 1, minWidth: 160, wordBreak: "break-all" }}>{d.name}</span>
      <span className="small muted">{fmtBytes(d.sizeBytes)}{d.compressed ? " · compressa nel browser" : ""}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>Rimuovi</button>
    </div>
  );
}

function ApplyForm({ onDone, existing = null }: { onDone: () => void; existing?: ProfiloConsultant | null }) {
  const { toast } = useApp();
  const [f, setF] = useState({
    firstName: existing?.firstName || "", lastName: existing?.lastName || "",
    profession: existing?.profession || "", title: existing?.title || "", bio: existing?.bio || "",
    radiusKm: existing?.radiusKm ?? 30,
    feeEuros: existing && existing.feeCents > 0 ? String(existing.feeCents / 100) : "",
    vatNumber: existing?.vatNumber || "", iban: existing?.iban || "", phone: existing?.phone || "",
  });
  const [zone, setZone] = useState<Place | null>(null);                // nuova zona scelta ora
  const [zoneId, setZoneId] = useState<string | null>(existing?.zone?.id || null); // zona in archivio
  const [photo, setPhoto] = useState<string | null>(null);              // nuova foto, compressa nel browser
  const [docs, setDocs] = useState<PreparedDoc[]>([]);                  // file nuovi pronti da inviare
  const [keepIds, setKeepIds] = useState<string[]>(existing?.docs?.map(d => d.id) || []);
  const [ibanDecl, setIbanDecl] = useState(false);
  const [prepBusy, setPrepBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // budget e completezza: stessi criteri del server, verificati PRIMA dell'invio
  const keptDocs = (existing?.docs || []).filter(d => keepIds.includes(d.id));
  const totDocBytes = docs.reduce((a, d) => a + d.sizeBytes, 0) + keptDocs.reduce((a, d) => a + d.sizeBytes, 0);
  const totCount = docs.length + keepIds.length;
  const overBudget = totDocBytes > MAX_TOTAL_DOC_BYTES || totCount > MAX_FILES;
  const kinds = new Set([...keptDocs.map(d => d.kind), ...docs.map(d => d.kind)]);
  const missingDocs = !kinds.has("qualifica")
    ? "Allega almeno un documento di qualifica (titolo, albo o certificato)."
    : !kinds.has("documento")
      ? "Allega almeno un documento d'identificazione."
      : null;

  // IBAN: controllo dal vivo, identico a quello del server
  const ibanCheck = f.iban.trim() ? validateIban(f.iban) : null;
  const ibanOk = ibanCheck?.ok === true;
  const ibanBad = ibanCheck != null && !ibanCheck.ok && normalizeIban(f.iban).length >= 8;

  const pick = async (files: FileList | null, kind: string) => {
    if (!files || !files.length) return;
    setPrepBusy(true);
    let room = MAX_FILES - totCount;
    const out: PreparedDoc[] = [];
    for (const file of Array.from(files)) {
      if (room <= 0) { toast(`Massimo ${MAX_FILES} documenti in totale (nuovi + conservati).`, "err"); break; }
      const r = await prepareDocFile(file, kind);
      if (!r.ok) { toast(r.error, "err"); continue; }
      out.push(r.doc);
      room--;
    }
    setPrepBusy(false);
    if (out.length) setDocs([...docs, ...out]);
  };

  const pickPhoto = async (file: File | null | undefined) => {
    if (!file) return;
    setPrepBusy(true);
    const r = await preparePhotoFile(file);
    setPrepBusy(false);
    if (!r.ok) { toast(r.error, "err"); return; }
    setPhoto(r.data);
  };

  const submit = async () => {
    setErr(null);
    if (overBudget) { setErr(`Gli allegati superano il limite (max ${MAX_FILES} file e ${fmtBytes(MAX_TOTAL_DOC_BYTES)} in totale): rimuovine qualcuno o sostituisci i PDF con foto, che vengono compresse.`); return; }
    if (missingDocs) { setErr(missingDocs); return; }
    if (ibanBad) { setErr(ibanCheck && !ibanCheck.ok ? ibanCheck.error : "IBAN non valido."); return; }
    if (!ibanDecl) { setErr("Conferma la dichiarazione sull'intestazione dell'IBAN prima di inviare."); return; }
    setBusy(true);
    const res = await api<{ status: string }>("/api/consulente/apply", {
      body: {
        ...f,
        photo: photo || undefined,
        zone: zone ? { name: zone.name, province: zone.province, region: zone.region, lat: zone.lat, lng: zone.lng } : undefined,
        zoneId: zone ? undefined : zoneId || undefined,
        docs,
        keepDocIds: keepIds,
        ibanSelfDeclared: ibanDecl,
      },
    });
    setBusy(false);
    if (res.ok) {
      toast(existing ? "Nuova domanda inviata: lo staff la esaminerà." : "Domanda inviata: lo staff la esaminerà.");
      onDone();
    } else if (res.error === "Risposta non valida dal server.") {
      setErr("Il server non ha risposto in modo leggibile: quasi sempre dipende dal peso degli allegati (max 3 MB in totale). Rimuovine qualcuno e riprova.");
    } else setErr(res.error);
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Iscriviti come Consulente Tecnico</h2>
      <p className="small muted">Tutti i dati indicati con * sono obbligatori. La domanda è esaminata dallo staff: la scheda pubblica nasce solo dopo l&apos;approvazione.</p>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="cz-first">Nome *</label>
            <input id="cz-first" required value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="cz-last">Cognome *</label>
            <input id="cz-last" required value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} />
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="cz-prof">Professione *</label>
            <select id="cz-prof" required value={f.profession} onChange={e => setF({ ...f, profession: e.target.value })}>
              <option value="">Scegli…</option>
              {PROFESSIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="cz-title">Titolo di studio *</label>
            <input id="cz-title" required placeholder="Es. Diploma di geometra / Laurea in ingegneria edile" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
          </div>
        </div>
        <PlaceSearch
          id="cz-zone" label="Zona di esercizio *" hint="La località da cui operi: qualsiasi comune d'Italia. La scheda sarà visibile in questa zona."
          selected={zone ? zone.name : existing?.zone?.name || null}
          onPick={p => { setZone(p); setZoneId(null); }}
        />
        {zone ? (
          <p className="small mb2">Zona scelta: <b>{zone.name}</b>{zone.province ? ` (${zone.province})` : ""}.</p>
        ) : existing?.zone ? (
          <p className="small mb2">Zona attuale: <b>{existing.zone.name}</b>{existing.zone.province ? ` (${existing.zone.province})` : ""} (cerca sopra per cambiarla).</p>
        ) : null}
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 130 }}>
            <label htmlFor="cz-radius">Raggio di azione (km) *</label>
            <input id="cz-radius" type="number" min={5} max={300} required value={f.radiusKm} onChange={e => setF({ ...f, radiusKm: Number(e.target.value) })} />
            <span className="hint">Tra 5 e 300 km attorno alla zona di esercizio.</span>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 130 }}>
            <label htmlFor="cz-fee">Tariffa richiesta (€)</label>
            <input id="cz-fee" type="text" inputMode="decimal" placeholder="Es. 300 (vuoto = su richiesta)" value={f.feeEuros} onChange={e => setF({ ...f, feeEuros: e.target.value })} />
            <span className="hint">La tariffa di riferimento per una perizia: potrai confermarla o aggiornarla a ogni richiesta.</span>
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="cz-vat">Partita IVA *</label>
            <input id="cz-vat" required placeholder="Es. 01234567890" value={f.vatNumber} onChange={e => setF({ ...f, vatNumber: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="cz-iban">IBAN (accredito compensi) *</label>
            <input id="cz-iban" required placeholder="ITXX..." value={f.iban} onChange={e => setF({ ...f, iban: e.target.value })} />
            {ibanOk ? <span className="hint">IBAN valido: struttura e codice di controllo corretti.</span>
              : ibanBad ? <span className="error-msg" style={{ display: "block" }}>{ibanCheck && !ibanCheck.ok ? ibanCheck.error : ""}</span>
              : <span className="hint">Visibile solo allo staff: serve per accreditarti i compensi.</span>}
          </div>
        </div>
        <div className="field">
          <label htmlFor="cz-ibandecl" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 400 }}>
            <input id="cz-ibandecl" type="checkbox" checked={ibanDecl} onChange={e => setIbanDecl(e.target.checked)} style={{ marginTop: 4 }} />
            <span className="small">Dichiaro che il conto corrispondente all&apos;IBAN indicato è intestato a <b>{f.firstName.trim() || "nome"} {f.lastName.trim() || "cognome"}</b> e autorizzo lo staff a verificarne l&apos;intestazione prima degli accrediti.</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="cz-phone">Telefono (facoltativo)</label>
          <input id="cz-phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="cz-bio">Presentazione ed esperienza</label>
          <textarea id="cz-bio" rows={4} placeholder="Es. Geometra dal 2008, specializzato in perizie giudiziarie e valutazioni immobiliari nel milanese…" value={f.bio} onChange={e => setF({ ...f, bio: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="cz-photo">Foto profilo {existing?.hasPhoto ? "(sostituisci se vuoi)" : "*"}</label>
          <input id="cz-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={prepBusy} onChange={e => void pickPhoto(e.target.files?.[0])} />
          <span className="hint">Ridimensionata e compressa nel browser prima dell&apos;invio; il server la ricompila senza metadati (come le foto delle recensioni).</span>
          {photo ? (
            <div className="row mt1" style={{ alignItems: "center", gap: 10 }}>
              <img src={photo} alt="Anteprima della nuova foto profilo" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8 }} />
              <div>
                <p className="small mb1"><b>{fmtBytes(dataUrlBytes(photo))}</b> · pronta all&apos;invio</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhoto(null)}>Rimuovi</button>
              </div>
            </div>
          ) : existing?.hasPhoto ? (
            <div className="row mt1" style={{ alignItems: "center", gap: 10 }}>
              <img src={`/api/consulente/photo/${existing.id}`} alt="Foto profilo attuale" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8 }} />
              <p className="small muted mb0">Foto attuale: resta in archivio. Scegline una nuova per sostituirla.</p>
            </div>
          ) : null}
        </div>
        <fieldset>
          <legend>Documenti (visibili solo allo staff) *</legend>
          <p className="small muted" style={{ marginTop: 4 }}>
            Massimo {MAX_FILES} file, 2 MB ciascuno e {fmtBytes(MAX_TOTAL_DOC_BYTES)} in totale. Le foto vengono compresse
            automaticamente nel browser; i PDF no — se un PDF è troppo grande, fotografane il contenuto e carica la foto.
            {" "}Spazio usato: <b style={{ color: overBudget ? "#c02929" : undefined }}>{fmtBytes(totDocBytes)}</b> su {fmtBytes(MAX_TOTAL_DOC_BYTES)}.
          </p>
          {existing && existing.docs.length ? (
            <div className="field">
              <label>Documenti già in archivio</label>
              {existing.docs.map(d => (
                <div key={d.id} className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <span className="small" style={{ flex: 1, minWidth: 160, wordBreak: "break-all", textDecoration: keepIds.includes(d.id) ? undefined : "line-through" }}>{d.originalName}</span>
                  <span className="pill pill-gray">{DOC_KIND_LABEL[d.kind] || d.kind}</span>
                  <span className="small muted">{fmtBytes(d.sizeBytes)}</span>
                  {keepIds.includes(d.id) ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKeepIds(keepIds.filter(x => x !== d.id))}>Rimuovi</button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKeepIds([...keepIds, d.id])}>Conserva</button>
                  )}
                </div>
              ))}
              <span className="hint">La nuova domanda conserva i documenti con il segno di spunta: togli quelli da sostituire e carica i nuovi qui sotto.</span>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="cz-doc-q">Qualifica: titolo, iscrizione all&apos;albo o certificato *</label>
            <input id="cz-doc-q" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={prepBusy} onChange={e => void pick(e.target.files, "qualifica")} />
            {docs.filter(d => d.kind === "qualifica").map((d, i) => <DocRow key={`q${i}`} d={d} onRemove={() => setDocs(docs.filter(x => x !== d))} />)}
          </div>
          <div className="field">
            <label htmlFor="cz-doc-d">Documento d&apos;identificazione *</label>
            <input id="cz-doc-d" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={prepBusy} onChange={e => void pick(e.target.files, "documento")} />
            {docs.filter(d => d.kind === "documento").map((d, i) => <DocRow key={`d${i}`} d={d} onRemove={() => setDocs(docs.filter(x => x !== d))} />)}
          </div>
          <div className="field">
            <label htmlFor="cz-doc-e">Esperienza: curriculum, portfolio, referenze (facoltativo)</label>
            <input id="cz-doc-e" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={prepBusy} onChange={e => void pick(e.target.files, "esperienza")} />
            {docs.filter(d => d.kind === "esperienza").map((d, i) => <DocRow key={`e${i}`} d={d} onRemove={() => setDocs(docs.filter(x => x !== d))} />)}
          </div>
        </fieldset>
        {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy || prepBusy || overBudget || !!missingDocs || ibanBad || !ibanDecl || (!photo && !existing?.hasPhoto)}>
          {prepBusy ? "Preparazione dei file…" : busy ? "Invio…" : existing ? "Invia la nuova domanda" : "Invia la domanda di iscrizione"}
        </button>
      </form>
    </div>
  );
}

/* ---------- ri-domanda dopo rifiuto: campi ricaricati, documenti conservabili ---------- */

function ReapplyForm({ prof, onDone }: { prof: ProfiloConsultant; onDone: () => void }) {
  return <ApplyForm key={prof.id} onDone={onDone} existing={prof} />;
}

/* ---------- documenti della domanda in esame: sostituisci / aggiungi / elimina ---------- */

function DocsManager({ prof, onChanged }: { prof: ProfiloConsultant; onChanged: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [prepBusy, setPrepBusy] = useState(false);
  const [addKind, setAddKind] = useState("esperienza");
  const addRef = useRef<HTMLInputElement | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const replaceTarget = useRef<string | null>(null);

  const send = async (method: "PATCH" | "DELETE", body: Record<string, unknown>) => {
    setBusy(true);
    const res = await api("/api/consulente/docs", { method, body });
    setBusy(false);
    if (res.ok) { toast("Documenti aggiornati."); onChanged(); }
    else toast(res.error, "err");
  };

  const prep = async (file: File | null | undefined, kind: string): Promise<PreparedDoc | null> => {
    if (!file) return null;
    setPrepBusy(true);
    const r = await prepareDocFile(file, kind);
    setPrepBusy(false);
    if (!r.ok) { toast(r.error, "err"); return null; }
    return r.doc;
  };

  const busyAll = busy || prepBusy;

  return (
    <div className="card mb2">
      <h3 style={{ marginTop: 0 }}>Documenti della domanda</h3>
      <p className="small muted">
        Finché la domanda è in esame puoi <b>sostituire, aggiungere o eliminare</b> i documenti: lo staff esaminerà
        sempre l&apos;ultima versione. Massimo {MAX_FILES} file, 2 MB ciascuno, {fmtBytes(MAX_TOTAL_DOC_BYTES)} in totale
        (le foto vengono compresse automaticamente nel browser).
      </p>
      {prof.docs.map(d => (
        <div key={d.id} className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <a href={`/api/consulente/doc/${d.id}`} className="small" style={{ flex: 1, minWidth: 160, wordBreak: "break-all" }}>{d.originalName}</a>
          <span className="pill pill-gray">{DOC_KIND_LABEL[d.kind] || d.kind}</span>
          <span className="small muted">{fmtBytes(d.sizeBytes)}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busyAll} onClick={() => { replaceTarget.current = d.id; replaceRef.current?.click(); }}>Sostituisci</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busyAll} onClick={() => void send("DELETE", { docId: d.id })}>Rimuovi</button>
        </div>
      ))}
      <div className="row" style={{ alignItems: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <div className="field mb0" style={{ minWidth: 180 }}>
          <label htmlFor="dm-kind">Tipo del documento nuovo</label>
          <select id="dm-kind" value={addKind} onChange={e => setAddKind(e.target.value)}>
            <option value="qualifica">Qualifica</option>
            <option value="documento">Identificazione</option>
            <option value="esperienza">Esperienza</option>
            <option value="altro">Altro</option>
          </select>
        </div>
        <button type="button" className="btn btn-primary" disabled={busyAll} onClick={() => addRef.current?.click()}>
          {prepBusy ? "Preparazione…" : "Aggiungi documento"}
        </button>
      </div>
      <input ref={addRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={async e => {
        const d = await prep(e.target.files?.[0], addKind);
        if (e.target) e.target.value = "";
        if (d) await send("PATCH", { kind: d.kind, name: d.name, data: d.data });
      }} />
      <input ref={replaceRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={async e => {
        const docId = replaceTarget.current;
        const d = await prep(e.target.files?.[0], "qualifica");
        if (e.target) e.target.value = "";
        if (docId && d) await send("PATCH", { docId, name: d.name, data: d.data });
      }} />
    </div>
  );
}

/* ---------- dashboard del consulente approvato ---------- */

function ConsultantDashboard({ prof, incoming, onChanged }: { prof: ProfiloConsultant; incoming: Richiesta[]; onChanged: () => void }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState({ bio: prof.bio || "", feeEuros: String(prof.feeCents ? prof.feeCents / 100 : ""), radiusKm: prof.radiusKm, phone: prof.phone || "" });
  const [busy, setBusy] = useState(false);

  const saveEdit = async () => {
    setBusy(true);
    const res = await api("/api/consulente/me", {
      method: "PATCH",
      body: { bio: edit.bio, feeEuros: edit.feeEuros === "" ? undefined : edit.feeEuros, radiusKm: edit.radiusKm, phone: edit.phone },
    });
    setBusy(false);
    toast(res.ok ? "Profilo aggiornato." : res.error, res.ok ? "ok" : "err");
    if (res.ok) onChanged();
  };

  return (
    <>
      <div className="card mb2">
        <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
          {prof.hasPhoto ? (
            <img src={`/api/consulente/photo/${prof.id}`} alt={`Foto profilo di ${prof.firstName} ${prof.lastName}`} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 12 }} />
          ) : null}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{prof.firstName} {prof.lastName} <span className="pill pill-green">Approvato</span></h2>
            <p className="small mb1" style={{ marginTop: 4 }}>{prof.profession} · {prof.title} · Zona: {prof.zone.name}{prof.zone.province ? ` (${prof.zone.province})` : ""} · raggio {prof.radiusKm} km</p>
            <p className="small muted mb0">P.IVA {prof.vatNumber} · IBAN in archivio (visibile solo allo staff) · {prof.docs.length} documenti in archivio</p>
            {prof.entityId ? <p className="small mb0" style={{ marginTop: 6 }}><a href={`#/scheda/${prof.entityId}`}>Apri la tua scheda pubblica nel catalogo →</a></p> : null}
          </div>
        </div>
      </div>

      <div className="card mb2">
        <h3 style={{ marginTop: 0 }}>Dati modificabili</h3>
        <p className="small muted">Presentazione, tariffa, raggio e telefono si aggiornano subito. Per nome, professione, zona o documenti serve una nuova domanda approvata.</p>
        <div className="row">
          <div className="field mb1" style={{ flex: 1, minWidth: 120 }}>
            <label htmlFor="cd-fee">Tariffa (€)</label>
            <input id="cd-fee" value={edit.feeEuros} placeholder="vuoto = su richiesta" onChange={e => setEdit({ ...edit, feeEuros: e.target.value })} />
          </div>
          <div className="field mb1" style={{ flex: 1, minWidth: 100 }}>
            <label htmlFor="cd-radius">Raggio (km)</label>
            <input id="cd-radius" type="number" min={5} max={300} value={edit.radiusKm} onChange={e => setEdit({ ...edit, radiusKm: Number(e.target.value) })} />
          </div>
          <div className="field mb1" style={{ flex: 1, minWidth: 120 }}>
            <label htmlFor="cd-phone">Telefono</label>
            <input id="cd-phone" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cd-bio">Presentazione</label>
          <textarea id="cd-bio" rows={3} value={edit.bio} onChange={e => setEdit({ ...edit, bio: e.target.value })} />
        </div>
        <button className="btn btn-primary" onClick={() => void saveEdit()} disabled={busy}>{busy ? "Salvo…" : "Salva"}</button>
      </div>

      <h2>Richieste ricevute</h2>
      {incoming.length ? incoming.map(r => <RequestCard key={r.id} r={r} role="consultant" onChanged={onChanged} />) : (
        <p className="small muted">Nessuna richiesta al momento: compariranno qui. Gli utenti ti trovano dalla tua scheda nel catalogo.</p>
      )}
    </>
  );
}

/* ================================================================
   Richieste di perizia — scheda (ruoli: utente o consulente)
   ================================================================ */

function RequestCard({ r, role, onChanged, payment }: { r: Richiesta; role: "user" | "consultant"; onChanged: () => void; payment?: { iban: string; instructions: string } }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [fee, setFee] = useState(r.feeCents != null ? String(r.feeCents / 100) : "");
  const [rejectReason, setRejectReason] = useState("");
  const [title, setTitle] = useState(r.reportTitle || "");
  const [body, setBody] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const res = await api(`/api/consulente/requests/${r.id}/action`, { body: { action, ...extra } });
    setBusy(false);
    if (res.ok) { toast("Operazione registrata."); onChanged(); setOpen(null); }
    else toast(res.error, "err");
  };

  return (
    <article className="card mb2">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>{r.kind} · {r.address}</h3>
        <StatusPill status={r.status} />
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        {role === "consultant" ? <>Da: {r.counterpart.nickname}</> : <>Consulente: {r.counterpart.name} ({r.counterpart.profession})</>}
        {" · "}{fmtDateTime(r.createdAt)}
        {r.feeCents != null ? <> · tariffa € {fmtEuro(r.feeCents)}</> : null}
        {r.status === "delivered" || r.status === "closed" ? <> · tuo accredito € {fmtEuro(r.payoutCents)} (commissione € {fmtEuro(r.commissionCents)})</> : null}
      </p>
      <p className="small" style={{ whiteSpace: "pre-wrap" }}>{r.description}</p>
      {r.rejectReason ? <p className="small muted">Motivo del rifiuto: {r.rejectReason}</p> : null}

      {role === "consultant" && r.canAccept ? (
        <div className="card card-pad-s mb1">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field mb0" style={{ flex: 1, minWidth: 120 }}>
              <label htmlFor={`fee-${r.id}`}>Tariffa confermata (€) *</label>
              <input id={`fee-${r.id}`} value={fee} inputMode="decimal" onChange={e => setFee(e.target.value)} />
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={() => void act("accept", { feeEuros: fee })}>Accetti l&apos;incarico</button>
          </div>
          {open === "reject" ? (
            <div className="field mt1">
              <label htmlFor={`rej-${r.id}`}>Motivo del rifiuto *</label>
              <textarea id={`rej-${r.id}`} rows={2} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
              <div className="row mt1"><button className="btn btn-danger" disabled={busy || rejectReason.trim().length < 5} onClick={() => void act("reject", { reason: rejectReason })}>Conferma rifiuto</button><button className="btn btn-ghost" onClick={() => setOpen(null)}>Annulla</button></div>
            </div>
          ) : (
            <button className="link small" onClick={() => setOpen("reject")} style={{ marginTop: 6 }}>oppure rifiuta con motivazione…</button>
          )}
        </div>
      ) : null}

      {role === "consultant" && r.canDeliver ? (
        <div className="card card-pad-s mb1">
          <p className="small mb1"><b>Consegna la relazione.</b> Verrà resa come PDF scaricabile dal richiedente; l&apos;accredito ti verrà riconosciuto alla consegna.</p>
          <div className="field">
            <label htmlFor={`rt-${r.id}`}>Titolo della relazione *</label>
            <input id={`rt-${r.id}`} value={title} onChange={e => setTitle(e.target.value)} placeholder="Es. Relazione di valutazione immobiliare" />
          </div>
          <div className="field">
            <label htmlFor={`rb-${r.id}`}>Testo della relazione * (almeno 300 caratteri)</label>
            <textarea id={`rb-${r.id}`} rows={8} value={body} onChange={e => setBody(e.target.value)} placeholder={"Struttura suggerita:\n1. Premessa e incarico\n2. Descrizione dell'immobile\n3. Verifiche eseguite\n4. Valutazione / esito\n5. Conclusioni"} />
          </div>
          <button className="btn btn-primary" disabled={busy || title.trim().length < 5 || body.trim().length < 300} onClick={() => void act("deliver", { title, body })}>Consegna la relazione</button>
        </div>
      ) : null}

      {role === "user" && r.status === "accepted" ? (
        <div className="card card-pad-s mb1">
          <p className="small mb1"><b>Pagamento della tariffa (€ {fmtEuro(r.feeCents)}).</b> Il consulente procede alla relazione dopo la registrazione del pagamento da parte della piattaforma.</p>
          {payment?.iban ? <p className="small">IBAN della piattaforma: <b className="mono">{payment.iban}</b></p> : null}
          {payment?.instructions ? <p className="small" style={{ whiteSpace: "pre-wrap" }}>{payment.instructions}</p> : (
            <p className="small muted">Le istruzioni di pagamento (IBAN e causale) sono indicate qui dal gestore della piattaforma; in caso contrario contatta l&apos;amministrazione dal modulo contatti.</p>
          )}
          <p className="small muted mb0">Causale consigliata: <span className="mono">perizia {r.id}</span></p>
        </div>
      ) : null}

      {r.status === "delivered" || r.status === "closed" ? (
        r.reportTitle ? <p className="small mb1"><b>Relazione consegnata:</b> {r.reportTitle}</p> : null
      ) : null}

      <div className="row">
        {r.status === "delivered" || r.status === "closed" ? (
          <a className="btn btn-primary btn-sm" href={`/api/consulente/requests/${r.id}/pdf`}>Scarica il PDF</a>
        ) : null}
        {role === "user" && r.canCancel ? (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void act("cancel")}>Annulla la richiesta</button>
        ) : null}
      </div>
    </article>
  );
}

/* ================================================================
   Vista: le mie richieste (utente) + riepilogo (consulente)
   ================================================================ */

export function ConsulenteRequestsView() {
  const { user, boot } = useApp();
  const [me, setMe] = useState<{ profile: ProfiloConsultant | null; incoming: Richiesta[]; outgoing: Richiesta[]; payment: { iban: string; instructions: string } } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const res = await api<typeof me>("/api/consulente/me");
    if (res.ok) setMe(res);
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;
  if (!user) {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <h1>Le mie richieste</h1>
        <Alert kind="info">Questa area richiede l&apos;accesso. <a href="#/accedi">Accedi</a> o <a href="#/registrati">registrati</a>.</Alert>
      </div>
    );
  }
  if (!me) return <div className="container section"><p className="muted">Caricamento…</p></div>;

  return (
    <div className="container section" style={{ maxWidth: 860 }}>
      <h1>Le mie richieste di perizia</h1>
      {me.profile?.status === "approved" ? (
        <p className="small">Sei anche consulente: le richieste che RICEVI sono nella <a href="#/consulente">dashboard del consulente</a>.</p>
      ) : null}
      {me.outgoing.length ? me.outgoing.map(r => <RequestCard key={r.id} r={r} role="user" onChanged={load} payment={me.payment} />) : (
        <p className="small muted">Non hai ancora richiesto nessuna perizia. Trova un consulente dalla categoria <a href="#/categoria/consulente">Consulenti</a> e apri la sua scheda.</p>
      )}
    </div>
  );
}

/* ================================================================
   Vista: modulo di richiesta perizia (dalla scheda di un consulente)
   ================================================================ */

export function ConsulenteRequestFormView({ entityId }: { entityId?: string }) {
  const { boot, user, toast } = useApp();
  const [cons, setCons] = useState<{ name: string; profession: string; feeCents: number; zoneName: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [f, setF] = useState({ kind: PERIZIA_KINDS[0], address: "", description: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entityId || !boot) return;
    void (async () => {
      const res = await api<{ entity: { name: string }; consultant: { firstName: string; lastName: string; profession: string; feeCents: number; zoneName: string } | null }>(`/api/public/entity/${entityId}`);
      if (!res.ok || !res.consultant) { setNotFound(true); return; }
      setCons({ name: `${res.consultant.firstName} ${res.consultant.lastName}`, profession: res.consultant.profession, feeCents: res.consultant.feeCents, zoneName: res.consultant.zoneName });
    })();
  }, [entityId, boot]);

  if (!boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;
  if (!user) {
    return (
      <div className="container section" style={{ maxWidth: 640 }}>
        <h1>Richiedi una perizia</h1>
        <Alert kind="info">Serve un account registrato per chiedere una perizia. <a href="#/accedi">Accedi</a> o <a href="#/registrati">registrati</a>.</Alert>
      </div>
    );
  }
  if (notFound) return <div className="container section"><h1>Consulente non trovato</h1><p className="muted">La scheda indicata non corrisponde a un consulente disponibile. <a href="#/categoria/consulente">Vedi tutti i consulenti</a>.</p></div>;
  if (!cons) return <div className="container section"><p className="muted">Caricamento della scheda…</p></div>;

  const submit = async () => {
    setErr(null); setBusy(true);
    const res = await api<{ requestId: string }>("/api/consulente/requests", {
      body: { entityId, kind: f.kind, address: f.address, description: f.description },
    });
    setBusy(false);
    if (res.ok) {
      toast("Richiesta inviata: il consulente la valuterà.");
      navigate("#/consulente-richieste");
    } else setErr(res.error);
  };

  return (
    <div className="container section" style={{ maxWidth: 680 }}>
      <h1>Richiedi una perizia</h1>
      <Alert kind="info">
        Consulente: <b>{cons.name}</b> ({cons.profession} · {cons.zoneName}).<br />
        Tariffa indicativa: <b>{cons.feeCents > 0 ? `€ ${fmtEuro(cons.feeCents)}` : "su richiesta"}</b> — verrà confermata dal consulente prima del pagamento. Il testo integrale delle recensioni di questa scheda resta soggetto alle regole Premium.
      </Alert>
      <div className="card">
        <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <div className="field">
            <label htmlFor="rq-kind">Tipo di richiesta *</label>
            <select id="rq-kind" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
              {PERIZIA_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <span className="hint">Perizia tecnica (stato, difetti, conformità) o valutazione immobiliare (valore di mercato).</span>
          </div>
          <div className="field">
            <label htmlFor="rq-addr">Indirizzo dell&apos;immobile *</label>
            <input id="rq-addr" required minLength={5} placeholder="Es. Via Roma 1, Milano" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="rq-desc">Descrivi la richiesta * (almeno 30 caratteri)</label>
            <textarea id="rq-desc" required rows={6} minLength={30} placeholder="Es. Vorrei una valutazione indipendente di un appartamento di 80 m2 al terzo piano con cantina, prima di fare un'offerta…" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
            <span className="hint">Niente dati personali di terzi. Il consulente valuterà l&apos;incarico prima che tu paghi.</span>
          </div>
          {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Invio…" : "Invia la richiesta"}</button>
        </form>
      </div>
      <p className="small muted mt2">Come prosegue: il consulente accetta (o rifiuta) → paghi la tariffa alla piattaforma → ricevi la relazione in PDF → il consulente riceve l&apos;accredito solo a consegna avvenuta.</p>
    </div>
  );
}

/* ================================================================
   Sezione professionale per la scheda pubblica del consulente
   ================================================================ */

export function ConsultantCard({ c, entityId }: { c: NonNullable<PublicCons>; entityId: string }) {
  const { user } = useApp();
  return (
    <section className="card mb2" style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
      {c.hasPhoto ? (
        <img src={`/api/consulente/photo/${c.id}`} alt={`Foto profilo di ${c.firstName} ${c.lastName}`} style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 12, flexShrink: 0 }} />
      ) : null}
      <div style={{ flex: 1, minWidth: 240 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem" }}>{c.firstName} {c.lastName}</h2>
          <span>
            <span className="pill pill-blue">Approvato dallo staff</span>{" "}
            <span className="pill pill-gray">Accesso con 2FA</span>
          </span>
        </div>
        <p className="small" style={{ marginTop: 6 }}>
          <b>{c.profession}</b> · {c.title}<br />
          Zona di esercizio: <b>{c.zoneName}</b>{c.province ? ` (${c.province})` : ""} · raggio d&apos;azione {c.radiusKm} km<br />
          Tariffa: <b>{c.feeCents > 0 ? `€ ${fmtEuro(c.feeCents)}` : "su richiesta"}</b> · P.IVA {c.vatNumber}
        </p>
        {c.bio ? <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{c.bio}</p> : null}
        <div className="row mt1">
          <button className="btn btn-primary" onClick={() => navigate(user ? `#/consulente-richiesta?to=${entityId}` : "#/accedi")}>
            Richiedi perizia o valutazione
          </button>
          <a className="btn btn-ghost" href="#/consulente-richieste">Le mie richieste</a>
        </div>
        <p className="small muted mt1 mb0">Relazione scritta consegnata in PDF, dietro pagamento della tariffa. L&apos;accredito al consulente avviene solo a consegna avvenuta (10% trattenuto dalla piattaforma).</p>
      </div>
    </section>
  );
}

type PublicCons = {
  id: string; firstName: string; lastName: string; profession: string; title: string;
  bio: string | null; zoneName: string; province: string | null; region: string | null;
  radiusKm: number; feeCents: number; vatNumber: string | null; hasPhoto: boolean; twoFactor: boolean;
};
