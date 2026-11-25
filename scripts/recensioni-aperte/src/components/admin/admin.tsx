"use client";
// ZoomZoom — back office: accesso con password + TOTP obbligatorio, sessione
// separata breve, sezioni con permessi distinti, audit di ogni azione.
// L'URL non è linkato pubblicamente, ma la sicurezza sta nell'autenticazione
// server-side, non nella segretezza del percorso.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmtDateTime, fmt1 } from "@/lib/client/api";
import { Alert, Modal, Stars } from "../ui-kit";
import { navigate, useHashRoute } from "@/lib/client/router";

const SECTIONS: Array<[string, string, string | null, string | null]> = [
  ["dashboard", "Dashboard", null, null],
  ["segnalazioni", "Segnalazioni", "mod.reports", "reports"],
  ["contestazioni", "Contestazioni", "mod.disputes", "disputes"],
  ["recensioni", "Recensioni", "mod.reviews", null],
  ["foto", "Foto recensioni", "mod.reviews", null],
  ["esperienze", "Esperienze e verifiche", "mod.experiences", "experiences"],
  ["inviti", "Inviti", "admin.invites", null],
  ["utenti", "Utenti e privacy", "admin.users", "privacy"],
  ["entita", "Schede e proposte", "admin.entities", "proposals"],
  ["contenuti", "Contenuti del sito", "admin.contents", null],
  ["impostazioni", "Impostazioni", "admin.settings", null],
  ["log", "Log di moderazione", "audit.full", null],
  ["sicurezza", "Eventi di sicurezza", "admin.security", null],
  ["ruoli", "Ruoli e permessi", "admin.roles", null],
  ["demo", "Dati dimostrativi", "admin.demo", null],
];

/* ---------- Login admin ---------- */
// QR di prima configurazione 2FA (forma della risposta del server)
type Enroll = { otpauth: string; qr: string; secret: string };

export function AdminLoginView() {
  const { toast } = useApp();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [hp, setHp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="container section" style={{ maxWidth: 560 }}>
      <h1>Area amministrativa</h1>
      <Alert kind="info">Accesso riservato allo staff, con autenticazione a due fattori obbligatoria. Ogni azione viene registrata nel log di moderazione. L&apos;indirizzo non è linkato pubblicamente, ma la misura di sicurezza è l&apos;autenticazione server-side con ruoli e permessi, non la segretezza del percorso.</Alert>
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          if (hp) return;
          setErr(null); setField(null); setBusy(true);
          const res = await api<{ field?: string; enrollment?: Enroll }>("/api/admin/login", { body: { email, password: pw, code, hp } });
          setBusy(false);
          if (res.ok) {
            toast("Accesso amministrativo riuscito.");
            navigate("#/admin/dashboard");
          } else {
            setErr(res.error);
            setField((res as { field?: string }).field || null);
            // il QR arriva solo se la password era valida e il primo accesso
            // 2FA non è mai stato completato; altrimenti viene nascosto
            setEnroll((res as { enrollment?: Enroll }).enrollment || null);
          }
        }}>
          <div className="field">
            <label htmlFor="a-email">Email</label>
            <input id="a-email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="a-pw">Password</label>
            <input id="a-pw" type="password" autoComplete="current-password" required value={pw} onChange={e => setPw(e.target.value)} />
            {err && field === "password" ? <span className="error-msg" style={{ display: "block" }}>{err}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="a-totp">Codice 2FA (app autenticazione)</label>
            <input id="a-totp" inputMode="numeric" maxLength={6} value={code}
              onChange={e => setCode(e.target.value)} placeholder="000000"
              style={{ letterSpacing: "3px", textAlign: "center", fontSize: "1.1rem" }} />
            <span className="hint">Primo accesso con questo account? Lascia vuoto il campo: dopo il controllo della password comparirà il QR da inquadrare con l&apos;app.</span>
            {err && field === "totp" ? <span className="error-msg" style={{ display: "block" }}>{err}</span> : null}
            {err && !field ? <span className="error-msg" style={{ display: "block" }}>{err}</span> : null}
          </div>
          {enroll ? (
            <div className="card card-pad-s mb2" style={{ textAlign: "center" }}>
              <p className="small mb1"><b>Prima configurazione — mostrata solo adesso.</b></p>
              <img src={enroll.qr} alt="QR code da inquadrare con l'app di autenticazione per aggiungere l'account" width={200} height={200} style={{ display: "block", margin: "0 auto 8px" }} />
              <p className="small muted">Se non puoi inquadrare il QR, aggiungi la chiave a mano nell&apos;app (inserimento manuale, codice base32):</p>
              <p className="mono small" style={{ wordBreak: "break-all", background: "var(--paper)", padding: 8, borderRadius: 6 }}>{enroll.secret}</p>
            </div>
          ) : null}
          <div className="hp-field"><label htmlFor="a-hp">Non compilare</label><input id="a-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} /></div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Accedi all&apos;area riservata</button>
        </form>
      </div>
      <p className="small muted mt2">Utenti e soggetti verificati accedono invece dal <a href="#/accedi">sito pubblico</a>.</p>
    </div>
  );
}

/* ---------- Shell admin ---------- */
function AdminShell({ section, children, counts }: {
  section: string;
  children: ReactNode;
  counts: Record<string, number>;
}) {
  const { boot } = useApp();
  const [role, setRole] = useState<string>("");
  const [nickname, setNickname] = useState<string>("");
  useEffect(() => {
    void api<{ roleLabel: string; role: string }>("/api/admin/data/dashboard").then(res => {
      if (res.ok) { setRole(res.roleLabel); setNickname(res.role); }
    });
  }, []);
  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    navigate("#/admin");
  };
  const allowed = (perm: string | null) => {
    if (perm === null) return true;
    // i permessi effettivi sono applicati dal server: qui solo visualizzazione
    return true;
  };
  return (
    <div className="container" style={{ paddingTop: 22 }}>
      <div className="admin-shell">
        <aside className="admin-side">
          <div className="as-title">Area riservata</div>
          {SECTIONS.map(([id, label, perm, countKey]) => (
            <a key={id} href={`#/admin/${id}`} className={section === id ? "active" : ""}>
              {label}
              {countKey && counts[countKey] ? <span className="queue-count">{counts[countKey]}</span> : null}
            </a>
          ))}
          <div className="as-title mt2">Sessione</div>
          <div style={{ padding: "4px 10px", color: "#D4DEE8", fontSize: ".82rem" }}>
            {role || "…"}<br />
            <span className="small" style={{ color: "#8FA2B5" }}>scadenza 30 min di inattività</span>
          </div>
          <a href="#/admin" onClick={logout} style={{ color: "#F0B9AE" }}>Esci dall&apos;area</a>
        </aside>
        <div className="admin-main">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Vista admin con routing ---------- */
export function AdminView({ section }: { section: string }) {
  const { toast } = useApp();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [actionModal, setActionModal] = useState<{ kind: string; id?: string; extra?: Record<string, unknown> } | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("keep");
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    const res = await api<Record<string, unknown>>(`/api/admin/data/${section}`);
    if (res.ok) {
      setAuthed(true);
      setData(res);
    } else {
      if ((res as { error?: string }).error?.includes("Sessione amministrativa")) setAuthed(false);
      else { setAuthed(true); setData({}); }
    }
  }, [section]);

  const loadCounts = useCallback(async () => {
    const res = await api<{ stats: { reports: number; exps: number }; queues: Array<{ label: string; href: string; count: number }> }>("/api/admin/data/dashboard");
    if (res.ok) {
      const c: Record<string, number> = { reports: res.stats.reports, experiences: res.stats.exps };
      for (const q of res.queues || []) {
        if (q.href.includes("contestazioni")) c.disputes = q.count;
        if (q.href.includes("entita")) c.proposals = q.count;
        if (q.href.includes("utenti")) c.privacy = q.count;
      }
      setCounts(c);
    }
  }, []);

  useEffect(() => { setAuthed(null); setData(null); void load(); void loadCounts(); }, [load, loadCounts]);

  if (authed === null) return <div className="container section"><p className="muted">Verifica della sessione amministrativa…</p></div>;
  if (authed === false) return <AdminLoginView />;

  const doAction = async (action: string, payload: Record<string, unknown> = {}) => {
    const res = await api("/api/admin/action", { body: { action, ...payload } });
    if (res.ok) {
      toast("Operazione registrata.");
      setActionModal(null);
      setReason("");
      void load();
      void loadCounts();
    } else toast(res.error, "err");
  };

  return (
    <>
      <AdminShell section={section} counts={counts}>
        <AdminSection section={section} data={data} onAction={(kind, id, extra) => { setReason(""); setDecision("keep"); setActionModal({ kind, id, extra }); }} reload={load} />
      </AdminShell>
      {actionModal ? (
        <Modal label="Azione amministrativa" onClose={() => setActionModal(null)}>
          <div className="modal-head">
            <h2>{actionModalTitles[actionModal.kind]}</h2>
            <button className="modal-close" onClick={() => setActionModal(null)} aria-label="Chiudi">×</button>
          </div>
          {actionModal.kind === "report.decide" || actionModal.kind === "dispute.decide" || actionModal.kind === "proposal.approve" ? (
            <div className="field">
              <label htmlFor="ad-action">Esito</label>
              <select id="ad-action" value={decision} onChange={e => setDecision(e.target.value)}>
                {actionModal.kind === "report.decide" ? (
                  <>
                    <option value="keep">Nessuna azione: recensione mantenuta</option>
                    <option value="hide">Nascondi la recensione</option>
                  </>
                ) : actionModal.kind === "dispute.decide" ? (
                  <>
                    <option value="keep">Associazione mantenuta</option>
                    <option value="hide">Sospendi la scheda per correzione</option>
                  </>
                ) : (
                  <>
                    <option value="approve">Approva e crea la scheda</option>
                    <option value="reject">Rigetta la proposta</option>
                  </>
                )}
              </select>
            </div>
          ) : null}
          {actionModal.kind === "premium.grant" ? (
            <div className="field">
              <label htmlFor="ad-days">Giorni di Membership Premium (1–365)</label>
              <input id="ad-days" type="number" min={1} max={365} value={days} onChange={e => setDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="ad-reason">Motivazione (registrata nel log e comunicata)</label>
            <textarea id="ad-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Perché si adotta questo esito."></textarea>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setActionModal(null)}>Annulla</button>
            <button className="btn btn-primary" onClick={() => {
              const kind = actionModal.kind;
              if (kind === "proposal.approve") {
                void doAction(decision === "approve" ? "proposal.approve" : "proposal.reject", { id: actionModal.id, reason });
              } else if (kind === "premium.grant") {
                void doAction("premium.grant", { id: actionModal.id, days, reason });
              } else {
                void doAction(kind, { id: actionModal.id, reason, decision });
              }
            }}>Registra decisione</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const actionModalTitles: Record<string, string> = {
  "report.take": "Presa in carico",
  "report.decide": "Decisione sulla segnalazione",
  "review.hide": "Nascondi la recensione",
  "dispute.take": "Presa in carico",
  "dispute.decide": "Decisione sulla contestazione",
  "experience.approve": "Approva la verifica",
  "experience.reject": "Rigetta la verifica",
  "invite.revoke": "Revoca l'invito",
  "user.toggle": "Sospendi/riattiva account",
  "premium.grant": "Concedi Membership Premium",
  "premium.revoke": "Revoca il Premium (tutte le concessioni)",
  "proposal.approve": "Decisione sulla proposta",
  "entity.toggle": "Pubblica/nascondi scheda",
  "review.restore": "Ripristina la recensione",
  "photo.remove": "Rimuovi la foto",
};

/* ---------- Sezioni ---------- */
function AdminSection({ section, data, onAction, reload }: {
  section: string;
  data: Record<string, unknown> | null;
  onAction: (kind: string, id?: string, extra?: Record<string, unknown>) => void;
  reload: () => Promise<void>;
}) {
  const { toast, boot } = useApp();
  const d = data as Record<string, never> | null;

  switch (section) {
    case "dashboard": {
      const stats = (d?.stats || {}) as { users: number; reviews: number; reports: number; exps: number };
      const queues = (d?.queues || []) as Array<{ label: string; href: string; count: number }>;
      const security = (d?.security || []) as Array<{ at: string; type: string; severity: string; details: string }>;
      return (
        <>
          <div className="admin-head">
            <h1>Dashboard</h1>
            <span className="pill pill-blue">{String(d?.roleLabel || "")}</span>
          </div>
          <div className="stat-grid">
            <div className="stat"><div className="v">{stats.users}</div><div className="l">Utenti registrati</div></div>
            <div className="stat"><div className="v">{stats.reviews}</div><div className="l">Recensioni pubblicate</div></div>
            <div className="stat"><div className="v">{stats.reports}</div><div className="l">Segnalazioni aperte</div><div className="d">coda di moderazione</div></div>
            <div className="stat"><div className="v">{stats.exps}</div><div className="l">Verifiche in attesa</div><div className="d">esperienze da approvare</div></div>
          </div>
          <div className="grid grid-2" style={{ gap: 22 }}>
            <div className="card">
              <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Code di lavoro</h2>
              <ul style={{ lineHeight: 2 }}>
                {queues.map((q, i) => <li key={i}><a href={q.href}>{q.label}</a> ({q.count})</li>)}
              </ul>
            </div>
            <div className="card">
              <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Ultimi eventi di sicurezza</h2>
              <ul className="timeline">
                {security.length ? security.map((s, i) => (
                  <li key={i}><b>{fmtDateTime(s.at)}</b> — {s.details} <span className={`pill ${s.severity === "warn" ? "pill-amber" : "pill-gray"}`}>{s.severity === "warn" ? "attenzione" : "info"}</span></li>
                )) : <li>Nessun evento.</li>}
              </ul>
              <a className="btn btn-ghost btn-sm mt2" href="#/admin/sicurezza">Registro completo</a>
            </div>
          </div>
          <Alert kind="info"><b>Registro azioni.</b> Ogni operazione svolta da quest&apos;area (nascondere una recensione, approvare una verifica, modificare impostazioni) è annotata nel log di moderazione con autore, oggetto, motivo e orario. Il log è consultabile solo dai ruoli autorizzati.</Alert>
        </>
      );
    }

    case "segnalazioni": {
      const reports = (d?.reports || []) as Array<{
        id: string; reasonLabel: string; details: string; statusLabel: string; status: string;
        createdAt: string; appealBy: string | null; appealReason: string | null;
        review: { id: string; entityName: string; author: string; score: number; text: string; status: string } | null;
        decisions: Array<{ action: string; reason: string; at: string; by: string }>;
      }>;
      return (
        <>
          <div className="admin-head"><h1>Segnalazioni</h1><span className="pill pill-gray">flusso: ricevuta → valutazione → decisione → appello → chiusura</span></div>
          <Alert kind="info">Nessuna rimozione automatica: ogni decisione è motivata e registrata; autore e segnalatore possono presentare appello entro 15 giorni.</Alert>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Recensione</th><th scope="col">Motivo e dettagli</th><th scope="col">Stato e cronologia</th><th scope="col">Azioni</th></tr></thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.id}>
                    <td>
                      {r.review ? <><b>{r.review.entityName}</b><br /><span className="small muted">{r.review.author} · {fmt1(r.review.score)}/10</span><br /><span className="small">{r.review.text.slice(0, 120)}…</span></> : <em>recensione rimossa</em>}
                    </td>
                    <td>{r.reasonLabel}<br /><span className="small muted">{r.details}</span>{r.appealReason ? <><br /><span className="small">Appello ({r.appealBy}): {r.appealReason}</span></> : null}</td>
                    <td>{r.statusLabel}
                      <ul className="timeline mt1">
                        {r.decisions.map((x, i) => <li key={i}><b>{x.action}</b> · {fmtDateTime(x.at)} — {x.reason}</li>)}
                      </ul>
                    </td>
                    <td>
                      {r.status === "received" ? <button className="btn btn-ghost btn-xs" onClick={() => onAction("report.take", r.id)}>Prendi in carico</button> : null}
                      {r.status === "reviewing" ? <button className="btn btn-primary btn-xs" onClick={() => onAction("report.decide", r.id)}>Decidi</button> : null}
                      {r.status === "appeal" ? <button className="btn btn-primary btn-xs" onClick={() => onAction("report.decide", r.id)}>Decidi sull&apos;appello</button> : null}
                    </td>
                  </tr>
                ))}
                {!reports.length ? <tr><td colSpan={4}>Nessuna segnalazione.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "contestazioni": {
      const disputes = (d?.disputes || []) as Array<{
        id: string; entity: { name: string }; claimantEmail: string; claim: string; status: string;
        createdAt: string; decisions: Array<{ action: string; reason: string; at: string; by: string }>;
      }>;
      return (
        <>
          <div className="admin-head"><h1>Contestazioni</h1><span className="pill pill-gray">associazione scheda ↔ persona</span></div>
          <Alert kind="info">Nessuna sospensione automatica: la visibilità di una scheda può essere sospesa solo come provvedimento motivato e tracciato.</Alert>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Scheda</th><th scope="col">Richiedente</th><th scope="col">Motivo</th><th scope="col">Stato</th><th scope="col">Azioni</th></tr></thead>
              <tbody>
                {disputes.map(x => (
                  <tr key={x.id}>
                    <td><b>{x.entity.name}</b></td>
                    <td className="small">{x.claimantEmail}</td>
                    <td className="small">{x.claim}
                      <ul className="timeline mt1">{x.decisions.map((dd, i) => <li key={i}><b>{dd.action}</b> — {dd.reason}</li>)}</ul>
                    </td>
                    <td>{x.status === "received" ? "Ricevuta" : x.status === "reviewing" ? "In valutazione" : "Chiusa"}</td>
                    <td>
                      {x.status === "received" ? <button className="btn btn-ghost btn-xs" onClick={() => onAction("dispute.take", x.id)}>Prendi in carico</button> : null}
                      {x.status === "reviewing" ? <button className="btn btn-primary btn-xs" onClick={() => onAction("dispute.decide", x.id)}>Decidi</button> : null}
                    </td>
                  </tr>
                ))}
                {!disputes.length ? <tr><td colSpan={5}>Nessuna contestazione.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "recensioni": {
      const reviews = (d?.reviews || []) as Array<{ id: string; entityName: string; author: string; score: number; text: string; status: string; hiddenReason: string | null; verified: boolean; photosCount: number; votesUp: number; votesDown: number; createdAt: string; isDemo: boolean }>;
      return (
        <>
          <div className="admin-head"><h1>Recensioni</h1><span className="pill pill-gray">{reviews.length} totali (prime 60)</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Scheda e autore</th><th scope="col">Voto</th><th scope="col">Testo</th><th scope="col">Comunità</th><th scope="col">Stato</th><th scope="col">Azioni</th></tr></thead>
              <tbody>
                {reviews.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.entityName}</b><br /><span className="small muted">{r.author} · {new Date(r.createdAt).toLocaleDateString("it-IT")}</span></td>
                    <td>{fmt1(r.score)}/10 <Stars score={r.score} size={13} /><br />{r.verified ? <span className="pill pill-green">Verificata</span> : <span className="pill pill-amber">Dichiarata</span>}</td>
                    <td className="small">{r.text.slice(0, 100)}…</td>
                    <td className="small">👍 {r.votesUp} · 👎 {r.votesDown}{r.photosCount ? <><br />{r.photosCount} 📷</> : null}</td>
                    <td>{r.status === "published" ? <span className="pill pill-green">Pubblicata</span> : <><span className="pill pill-red">Nascosta</span><br /><span className="small muted">{r.hiddenReason}</span></>}</td>
                    <td>
                      {r.status === "published"
                        ? <button className="btn btn-ghost btn-xs" onClick={() => onAction("review.hide", r.id)}>Nascondi</button>
                        : <button className="btn btn-ghost btn-xs" onClick={() => onAction("review.restore", r.id)}>Ripristina</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "foto": {
      const photos = (d?.photos || []) as Array<{ id: string; reviewId: string; entityName: string; author: string; reviewStatus: string; width: number; height: number; bytes: number; createdAt: string; isDemo: boolean }>;
      return (
        <>
          <div className="admin-head"><h1>Foto recensioni</h1><span className="pill pill-gray">{photos.length} (prime 120)</span></div>
          <Alert kind="info">Le foto sono già state ripulite dei metadati (posizione EXIF inclusa) al caricamento. Qui si moderano: una foto illecita o con persone riconoscibili si rimuove con motivazione, la recensione resta.</Alert>
          {!photos.length ? (
            <p className="muted">Nessuna foto caricata finora.</p>
          ) : (
            <div className="photo-admin-grid">
              {photos.map(p => (
                <div className="card card-pad-s" key={p.id}>
                  <a href={`/api/public/photo/${p.id}`} target="_blank" rel="noopener noreferrer" title="Apri la foto in originale">
                    <img src={`/api/public/photo/${p.id}`} alt={`Foto di ${p.entityName} allegata da ${p.author}`} loading="lazy" />
                  </a>
                  <p className="small mb0" style={{ marginTop: 8 }}><b>{p.entityName}</b></p>
                  <p className="small muted mb0">di {p.author} · {new Date(p.createdAt).toLocaleDateString("it-IT")} · {Math.round(p.bytes / 1024)} KB{p.reviewStatus !== "published" ? " · recensione nascosta" : ""}{p.isDemo ? " · demo" : ""}</p>
                  <div className="row mt1">
                    <a className="btn btn-ghost btn-xs" href={`#/admin/recensioni`}>Recensioni</a>
                    <button className="btn btn-danger btn-xs" onClick={() => onAction("photo.remove", p.id)}>Rimuovi foto</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      );
    }

    case "esperienze": {
      const pending = (d?.pending || []) as Array<{ id: string; entityName: string; kind: string; period: string | null; origin: string; requesterEmail: string | null; note: string | null; docs: Array<{ id: string; originalName: string; sizeBytes: number; mimeType: string }>; createdAt: string }>;
      const active = (d?.active || []) as Array<{ id: string; entityName: string; kind: string; reviewed: string }>;
      return (
        <>
          <div className="admin-head"><h1>Esperienze e verifiche</h1><span className="pill pill-gray">{pending.length} in attesa</span></div>
          <Alert kind="info">Le verifiche documentali si approvano solo se il documento dimostra un&apos;esperienza plausibile. Il documento non resta nel sistema più del necessario: viene cancellato dopo la decisione (retention configurabile).</Alert>
          <div className="table-wrap mb2">
            <table className="table">
              <thead><tr><th scope="col">Soggetto</th><th scope="col">Origine</th><th scope="col">Documento e note</th><th scope="col">Decisione</th></tr></thead>
              <tbody>
                {pending.map(e => (
                  <tr key={e.id}>
                    <td><b>{e.entityName}</b><br /><span className="small muted">{e.kind}{e.period ? ` · ${e.period}` : ""}</span></td>
                    <td className="small">{e.origin === "verification-request" ? <>Verifica documentale<br /><span className="small">{e.requesterEmail}</span></> : "Da soggetto verificato (soglia inviti)"}</td>
                    <td className="small">
                      {e.docs.length ? e.docs.map(doc => (
                        <a key={doc.id} href={`/api/admin/docs/${doc.id}`} target="_blank" rel="noopener noreferrer">{doc.originalName}</a>
                      )) : "—"}
                      <br />{e.note}
                    </td>
                    <td>
                      <button className="btn btn-primary btn-xs" onClick={() => onAction("experience.approve", e.id)}>Approva</button>{" "}
                      <button className="btn btn-ghost btn-xs" onClick={() => onAction("experience.reject", e.id)}>Rigetta</button>
                    </td>
                  </tr>
                ))}
                {!pending.length ? <tr><td colSpan={4}>Nessuna richiesta in attesa.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <h2 style={{ fontSize: "1.05rem" }}>Attive di recente</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Soggetto</th><th scope="col">Tipo</th><th scope="col">Esito</th></tr></thead>
              <tbody>
                {active.map(e => <tr key={e.id}><td>{e.entityName}</td><td>{e.kind}</td><td>{e.reviewed}</td></tr>)}
                {!active.length ? <tr><td colSpan={3}>Nessuna.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "inviti": {
      const invites = (d?.invites || []) as Array<{ id: string; entityName: string; email: string; tokenHashPrefix: string; createdAt: string; expiresAt: string; usedAt: string | null; revoked: boolean }>;
      const perEntity = (d?.perEntity || []) as Array<{ name: string; today: number; cap: number }>;
      return (
        <>
          <div className="admin-head"><h1>Inviti</h1><span className="pill pill-gray">tutti i soggetti · uso singolo · scadenza configurabile</span></div>
          <Alert kind="info">Gli inviti in massa sono impediti per costruzione: limite giornaliero per scheda, approvazione obbligatoria sopra la soglia, revoca possibile. I token sono conservati solo come hash: il valore in chiaro non esiste nel database.</Alert>
          {perEntity.length ? (
            <ul className="mb2">{perEntity.map((p, i) => <li key={i}>{p.name}: <b>{p.today}/{p.cap}</b> inviti oggi</li>)}</ul>
          ) : null}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Scheda</th><th scope="col">Destinatario</th><th scope="col">Token (hash)</th><th scope="col">Date</th><th scope="col">Stato</th><th scope="col"></th></tr></thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.id}>
                    <td>{i.entityName}</td>
                    <td>{i.email}</td>
                    <td className="small">{i.tokenHashPrefix} …<br /><span className="muted">solo hash: il token in chiaro non è conservato</span></td>
                    <td className="small">{fmtDateTime(i.createdAt)}<br />scade {fmtDateTime(i.expiresAt)}</td>
                    <td>{i.usedAt ? <span className="pill pill-green">Usato</span> : i.revoked ? <span className="pill pill-red">Revocato</span> : new Date(i.expiresAt) < new Date() ? <span className="pill pill-gray">Scaduto</span> : <span className="pill pill-amber">Valido</span>}</td>
                    <td>{!i.usedAt && !i.revoked && new Date(i.expiresAt) >= new Date() ? <button className="btn btn-ghost btn-xs" onClick={() => onAction("invite.revoke", i.id)}>Revoca</button> : null}</td>
                  </tr>
                ))}
                {!invites.length ? <tr><td colSpan={6}>Nessun invito.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "utenti": {
      const users = (d?.users || []) as Array<{ id: string; nickname: string; email: string; roleLabel: string; totpEnabled: boolean; createdAt: string; reviewsCount: number; disabled: boolean; isDemo: boolean; premiumUntil: string | null }>;
      const privacy = (d?.privacy || []) as Array<{ id: string; email: string; kind: string; message: string; status: string; createdAt: string }>;
      return (
        <>
          <div className="admin-head"><h1>Utenti e privacy</h1><span className="pill pill-gray">{users.length} account</span></div>
          <Alert kind="info">Accesso ai dati minimi necessari: qui non compaiono password (nemmeno hash) né segreti 2FA. La sospensione richiede motivo ed è registrata. Il Premium si guadagna con le recensioni verificate; qui si può concedere o revocare con motivazione.</Alert>
          <div className="table-wrap mb2">
            <table className="table">
              <thead><tr><th scope="col">Utente</th><th scope="col">Ruolo</th><th scope="col">2FA</th><th scope="col">Premium</th><th scope="col" className="num">Rec.</th><th scope="col">Stato</th><th scope="col">Azioni</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td><b>{u.nickname}</b>{u.isDemo ? <span className="badge-demo">demo</span> : null}<br /><span className="small muted">{u.email}</span></td>
                    <td>{u.roleLabel}</td>
                    <td>{u.totpEnabled ? <span className="pill pill-green">2FA</span> : <span className="pill pill-gray">—</span>}</td>
                    <td>{u.premiumUntil ? <span className="pill pill-amber" title={`Attivo fino al ${new Date(u.premiumUntil).toLocaleDateString("it-IT")}`}>fino al {new Date(u.premiumUntil).toLocaleDateString("it-IT")}</span> : <span className="pill pill-gray">—</span>}</td>
                    <td className="num">{u.reviewsCount}</td>
                    <td>{u.disabled ? <span className="pill pill-red">Sospeso</span> : <span className="pill pill-green">Attivo</span>}</td>
                    <td>
                      <button className="btn btn-ghost btn-xs" onClick={() => onAction("user.toggle", u.id)}>{u.disabled ? "Riattiva" : "Sospendi"}</button>{" "}
                      <button className="btn btn-ghost btn-xs" onClick={() => onAction("user.forceLogout", u.id)}>Forza uscita</button>{" "}
                      <button className="btn btn-ghost btn-xs" onClick={() => onAction("premium.grant", u.id)}>Premium +</button>
                      {u.premiumUntil ? <> <button className="btn btn-ghost btn-xs" onClick={() => onAction("premium.revoke", u.id)}>Revoca Premium</button></> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ fontSize: "1.05rem" }}>Richieste privacy</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Email</th><th scope="col">Tipo</th><th scope="col">Messaggio</th><th scope="col">Ricevuta</th><th scope="col">Stato</th><th scope="col"></th></tr></thead>
              <tbody>
                {privacy.map(p => (
                  <tr key={p.id}>
                    <td>{p.email}</td><td>{p.kind}</td><td className="small">{p.message}</td>
                    <td>{fmtDateTime(p.createdAt)}</td>
                    <td>{p.status === "received" ? <span className="pill pill-amber">Da gestire</span> : <span className="pill pill-green">Evasa</span>}</td>
                    <td>{p.status === "received" ? <button className="btn btn-ghost btn-xs" onClick={() => onAction("privacy.done", p.id)}>Segna come evasa</button> : null}</td>
                  </tr>
                ))}
                {!privacy.length ? <tr><td colSpan={6}>Nessuna richiesta.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "entita": {
      const proposals = (d?.proposals || []) as Array<{ id: string; name: string; categoryName: string; subtitle: string | null; address: string | null; zoneId: string | null; justification: string; contactEmail: string | null; isPerson: boolean; createdAt: string }>;
      const entities = (d?.entities || []) as Array<{ id: string; name: string; categoryShort: string; zoneId: string | null; status: string; verifiedBusiness: boolean; isDemo: boolean; reviewsCount: number }>;
      const zones = (d?.zones || []) as Array<{ id: string; name: string }>;
      return (
        <>
          <div className="admin-head"><h1>Schede e proposte</h1><span className="pill pill-gray">{proposals.length} proposte da esaminare</span></div>
          <h2 style={{ fontSize: "1.05rem" }}>Proposte in attesa</h2>
          <div className="table-wrap mb2">
            <table className="table">
              <thead><tr><th scope="col">Proposta</th><th scope="col">Dettagli</th><th scope="col">Motivazione e contatto</th><th scope="col">Decisione</th></tr></thead>
              <tbody>
                {proposals.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}<br /><span className="small muted">{p.categoryName}{p.zoneId ? ` · ${zones.find(z => z.id === p.zoneId)?.name || p.zoneId}` : ""}</span></td>
                    <td className="small">{p.subtitle} {p.address}{p.isPerson ? <><br /><span className="muted">persona fisica: la scheda sarà creata con sole iniziali</span></> : null}</td>
                    <td className="small">{p.justification}<br /><span className="muted">{p.contactEmail}</span></td>
                    <td><button className="btn btn-primary btn-xs" onClick={() => onAction("proposal.approve", p.id)}>Decidi</button></td>
                  </tr>
                ))}
                {!proposals.length ? <tr><td colSpan={4}>Nessuna proposta.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <h2 style={{ fontSize: "1.05rem" }}>Schede esistenti</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Nome</th><th scope="col">Categoria</th><th scope="col">Zona</th><th scope="col" className="num">Rec.</th><th scope="col">Stato</th><th scope="col"></th></tr></thead>
              <tbody>
                {entities.map(e => (
                  <tr key={e.id}>
                    <td><b>{e.name}</b>{e.isDemo ? <span className="badge-demo">demo</span> : null}</td>
                    <td>{e.categoryShort}</td>
                    <td>{zones.find(z => z.id === e.zoneId)?.name || "—"}</td>
                    <td className="num">{e.reviewsCount}</td>
                    <td>{e.status === "published" ? <span className="pill pill-green">Pubblicata</span> : <span className="pill pill-gray">Non pubblicata</span>}{e.verifiedBusiness ? <span className="pill pill-blue">Verificato</span> : null}</td>
                    <td><button className="btn btn-ghost btn-xs" onClick={() => onAction("entity.toggle", e.id)}>{e.status === "published" ? "Nascondi" : "Pubblica"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "contenuti":
      return <ContentsSection initial={d} />;

    case "impostazioni":
      return <SettingsSection initial={d} />;

    case "log": {
      const logs = (d?.logs || []) as Array<{ id: string; at: string; actor: string; actorRole: string | null; action: string; targetType: string; targetId: string | null; reason: string | null; isDemo: boolean }>;
      return (
        <>
          <div className="admin-head"><h1>Log di moderazione</h1><span className="pill pill-gray">ultimi 200 eventi</span></div>
          <Alert kind="info">Registro accessibile solo ai ruoli autorizzati. Contiene attore, azione, oggetto, data e motivazione: mai password, token, documenti o altri segreti.</Alert>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Data</th><th scope="col">Attore</th><th scope="col">Azione</th><th scope="col">Oggetto</th><th scope="col">Motivo</th></tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td className="small">{fmtDateTime(l.at)}</td>
                    <td className="small">{l.actor}<br /><span className="muted">{l.actorRole}</span></td>
                    <td>{l.action}{l.isDemo ? <span className="badge-demo">demo</span> : null}</td>
                    <td className="small">{l.targetType} {l.targetId ? `· ${l.targetId.slice(0, 12)}…` : ""}</td>
                    <td className="small">{l.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "sicurezza": {
      const logs = (d?.logs || []) as Array<{ id: string; at: string; type: string; severity: string; details: string; isDemo: boolean }>;
      return (
        <>
          <div className="admin-head"><h1>Eventi di sicurezza</h1><span className="pill pill-gray">ultimi 200 eventi</span></div>
          <Alert kind="info">Registrati con tipo e orario, senza dati personali eccessivi. Da qui si monitorano tentativi di accesso falliti, token non validi e cambi di configurazione.</Alert>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Data</th><th scope="col">Tipo</th><th scope="col">Dettagli</th></tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td className="small">{fmtDateTime(l.at)}</td>
                    <td>{l.type}{l.isDemo ? <span className="badge-demo">demo</span> : null}</td>
                    <td className="small">{l.details} <span className={`pill ${l.severity === "warn" ? "pill-amber" : l.severity === "error" ? "pill-red" : "pill-gray"}`}>{l.severity}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "ruoli":
      return <RolesSection reload={reload} />;

    case "demo": {
      const counts = (d?.counts || {}) as Record<string, number>;
      const demoMode = Boolean(d?.demoMode);
      return (
        <>
          <div className="admin-head"><h1>Dati dimostrativi</h1><span className="pill pill-gray">solo super amministratore · solo DEMO_MODE</span></div>
          <Alert kind={demoMode ? "warn" : "info"}>
            {demoMode
              ? "Questa istanza è in modalità demo: i dati fittizi sono marcati isDemo e separati da eventuali dati reali. Le operazioni below toccano SOLO i contenuti marcati demo."
              : "Modalità demo non attiva: le operazioni sono disabilitate (la produzione non deve contenere dati fittizi)."}
          </Alert>
          <div className="stat-grid">
            {Object.entries(counts).map(([k, v]) => (
              <div className="stat" key={k}><div className="v">{v}</div><div className="l">{k}</div></div>
            ))}
          </div>
          <div className="row">
            <button className="btn btn-danger" disabled={!demoMode} onClick={async () => {
              const res = await api("/api/admin/action", { body: { action: "demo.wipe", reason: "Pulizia dati demo." } });
              toast(res.ok ? "Dati demo eliminati." : res.error, res.ok ? "ok" : "err");
              void reload();
            }}>Elimina i dati demo</button>
            <button className="btn btn-primary" disabled={!demoMode} onClick={async () => {
              toast("Rigenerazione in corso…");
              const res = await api("/api/admin/action", { body: { action: "demo.reseed", reason: "Rigenerazione dati demo." } });
              toast(res.ok ? "Dati demo rigenerati." : res.error, res.ok ? "ok" : "err");
              void reload();
            }}>Rigenera i dati demo</button>
          </div>
        </>
      );
    }

    default:
      return <div className="admin-head"><h1>Sezione non riconosciuta</h1></div>;
  }
}

/* ---------- Sezione ruoli (componente separato: hook incondizionato) ---------- */
function RolesSection({ reload }: { reload: () => Promise<void> }) {
  const { toast } = useApp();
  const [sel, setSel] = useState<Record<string, string>>({});
  const [staff, setStaff] = useState<Array<{ id: string; email: string; nickname: string; role: string; totpEnabled: boolean; disabled: boolean }>>([]);
  useEffect(() => {
    void api<{ staff: typeof staff }>("/api/admin/data/ruoli").then(res => {
      if (res.ok) setStaff(res.staff);
    });
  }, []);
  return (
    <>
      <div className="admin-head"><h1>Ruoli e permessi</h1><span className="pill pill-gray">solo super amministratore</span></div>
      <Alert kind="info">Principio del minimo privilegio: la promozione a un ruolo di back office è concessa solo se l&apos;account ha la 2FA attiva. Ogni cambio è tracciato nel log.</Alert>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">Account</th><th scope="col">Ruolo attuale</th><th scope="col">2FA</th><th scope="col">Nuovo ruolo</th></tr></thead>
          <tbody>
            {staff.map(u => (
              <tr key={u.id}>
                <td><b>{u.nickname}</b><br /><span className="small muted">{u.email}</span></td>
                <td>{u.role}</td>
                <td>{u.totpEnabled ? <span className="pill pill-green">2FA</span> : <span className="pill pill-red">assente</span>}</td>
                <td>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <select style={{ width: "auto" }} value={sel[u.id] || u.role} onChange={e => setSel(s => ({ ...s, [u.id]: e.target.value }))}>
                      <option value="moderator">Moderatore</option>
                      <option value="admin">Amministratore</option>
                      <option value="superadmin">Super amministratore</option>
                      <option value="user">Revoca (utente)</option>
                    </select>
                    <button className="btn btn-ghost btn-xs" onClick={async () => {
                      const res = await api("/api/admin/action", { body: { action: "role.set", id: u.id, role: sel[u.id] || u.role, reason: "Cambio ruolo dall'area amministrativa." } });
                      toast(res.ok ? "Ruolo aggiornato." : res.error, res.ok ? "ok" : "err");
                      void reload();
                    }}>Applica</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- Contenuti ---------- */
function ContentsSection({ initial }: { initial: Record<string, unknown> | null }) {
  const { toast } = useApp();
  const s = (initial?.settings || {}) as Record<string, string | boolean>;
  const [form, setForm] = useState({
    siteName: String(s.siteName || "ZoomZoom"),
    heroTitle: String(s.heroTitle || ""),
    heroSub: String(s.heroSub || ""),
    globalNotice: String(s.globalNotice || ""),
    adsEnabled: Boolean(s.adsEnabled),
    adsClient: String(s.adsClient || ""),
  });
  return (
    <>
      <div className="admin-head"><h1>Contenuti del sito</h1><span className="pill pill-gray">nome, hero, avvisi, pubblicità</span></div>
      <Alert kind="info">Il nome &quot;ZoomZoom&quot; è provvisorio: va verificata la disponibilità del marchio prima del lancio. L&apos;avviso globale è mostrato solo in modalità demo.</Alert>
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          const res = await api("/api/admin/action", { body: { action: "contents.update", settings: form, reason: "Aggiornamento contenuti." } });
          toast(res.ok ? "Contenuti aggiornati." : res.error, res.ok ? "ok" : "err");
        }}>
          <div className="field">
            <label htmlFor="c-name">Nome del sito</label>
            <input id="c-name" value={form.siteName} onChange={e => setForm(f => ({ ...f, siteName: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="c-ht">Titolo hero</label>
            <input id="c-ht" value={form.heroTitle} onChange={e => setForm(f => ({ ...f, heroTitle: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="c-hs">Sottotitolo hero</label>
            <textarea id="c-hs" value={form.heroSub} onChange={e => setForm(f => ({ ...f, heroSub: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="c-gn">Avviso globale (solo demo)</label>
            <input id="c-gn" value={form.globalNotice} onChange={e => setForm(f => ({ ...f, globalNotice: e.target.value }))} />
          </div>
          <label className="checkline mb2">
            <input type="checkbox" checked={form.adsEnabled} onChange={e => setForm(f => ({ ...f, adsEnabled: e.target.checked }))} />
            <span>Pubblicità Google AdSense attiva (richiede anche il consenso degli utenti e l&apos;ID client)</span>
          </label>
          <div className="field">
            <label htmlFor="c-ads">ID client AdSense (ca-pub-…)</label>
            <input id="c-ads" value={form.adsClient} onChange={e => setForm(f => ({ ...f, adsClient: e.target.value }))} placeholder="ca-pub-0000000000000000" />
          </div>
          <button className="btn btn-primary" type="submit">Salva contenuti</button>
        </form>
      </div>
    </>
  );
}

/* ---------- Impostazioni ---------- */
function SettingsSection({ initial }: { initial: Record<string, unknown> | null }) {
  const { toast } = useApp();
  const s = (initial?.settings || {}) as Record<string, number | boolean>;
  const [form, setForm] = useState({
    minReviews: Number(s.minReviews ?? 3),
    rettificaDays: Number(s.rettificaDays ?? 30),
    inviteDailyCap: Number(s.inviteDailyCap ?? 5),
    inviteApprovalAbove: Number(s.inviteApprovalAbove ?? 10),
    inviteExpiryDays: Number(s.inviteExpiryDays ?? 7),
    proofRetentionDays: Number(s.proofRetentionDays ?? 30),
    mapMinAggregate: Number(s.mapMinAggregate ?? 3),
    premiumDaysPerReview: Number(s.premiumDaysPerReview ?? 30),
    premiumMaxDays: Number(s.premiumMaxDays ?? 365),
    openReviewsPerDay: Number(s.openReviewsPerDay ?? 5),
    premiumEnabled: s.premiumEnabled !== false,
    openReviewsEnabled: s.openReviewsEnabled !== false,
    photosEnabled: s.photosEnabled !== false,
    votesEnabled: s.votesEnabled !== false,
  });
  const fields: Array<[Exclude<keyof typeof form, "premiumEnabled" | "openReviewsEnabled" | "photosEnabled" | "votesEnabled">, string, string]> = [
    ["minReviews", "Soglia recensioni sufficienti (m della formula)", "Peso della media di categoria nella media ponderata; le schede sotto questa soglia sono segnala te come non sufficienti."],
    ["rettificaDays", "Finestra di rettifica (giorni)", "Giorni per aggiornare autonomamente una recensione con rettifica motivata."],
    ["inviteDailyCap", "Inviti al giorno per scheda", "Limite anti-abuso per soggetto verificato."],
    ["inviteApprovalAbove", "Soglia approvazione inviti", "Oltre questo numero di inviti al giorno l'esperienza richiede approvazione della moderazione."],
    ["inviteExpiryDays", "Scadenza invito (giorni)", "Durata del token di invito."],
    ["proofRetentionDays", "Retention documenti (giorni)", "Dopo la decisione i documenti di verifica vengono cancellati (impostazione da validare con il professionista)."],
    ["mapMinAggregate", "Soglia aggregati mappa", "Numero minimo di recensioni per pubblicare un aggregato di zona sulla mappa (soppressione selettiva)."],
    ["premiumDaysPerReview", "Premium: giorni per recensione", "Giorni di Membership Premium assegnati per ogni recensione pubblicata (verificata o dichiarata). 0 disattiva l'assegnazione automatica."],
    ["premiumMaxDays", "Premium: accumulo massimo (giorni)", "La scadenza del Premium non supera mai adesso + questo valore, per limitare i benefici della frode."],
    ["openReviewsPerDay", "Contributo aperto: limite giornaliero per utente", "Numero massimo di recensioni aperte E di nuove schede immobile che un utente può pubblicare in un giorno."],
  ];
  return (
    <>
      <div className="admin-head"><h1>Impostazioni</h1><span className="pill pill-gray">parametri del metodo e anti-abuso</span></div>
      <Alert kind="info">Ogni modifica è registrata nel log. La soglia recensioni modifica il peso m della formula PC = (n·M + m·C)/(n+m): le medie storiche delle recensioni non vengono riscritte, ma i punteggi di classifica sono calcolati con i parametri correnti e documentati nella pagina classifiche.</Alert>
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          const res = await api("/api/admin/action", { body: { action: "settings.update", settings: form, reason: "Aggiornamento impostazioni." } });
          toast(res.ok ? "Impostazioni aggiornate." : res.error, res.ok ? "ok" : "err");
        }}>
          {fields.map(([k, label, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={`s-${k}`}>{label}</label>
              <input id={`s-${k}`} type="number" min={1} max={500} value={form[k]}
                onChange={e => setForm(f => ({ ...f, [k]: Number(e.target.value) }))} />
              <span className="hint">{hint}</span>
            </div>
          ))}
          <div className="field">
            <label htmlFor="s-premiumEnabled">
              <input id="s-premiumEnabled" type="checkbox" checked={form.premiumEnabled}
                onChange={e => setForm(f => ({ ...f, premiumEnabled: e.target.checked }))} />{" "}
              Membership Premium attiva (le recensioni integrali sono riservate a chi contribuisce)
            </label>
            <span className="hint">Se disattivata, tutte le recensioni tornano pubbliche come prima dell'introduzione del Premium: usalo per emergenze o manutenzione.</span>
          </div>
          <div className="field">
            <label htmlFor="s-openReviewsEnabled">
              <input id="s-openReviewsEnabled" type="checkbox" checked={form.openReviewsEnabled}
                onChange={e => setForm(f => ({ ...f, openReviewsEnabled: e.target.checked }))} />{" "}
              Contributo aperto attivo (recensioni su immobili e zone senza invito)
            </label>
            <span className="hint">Se disattivato, si torna al modello a invito/verifica per tutte le categorie: usalo in caso di ondata di abusi.</span>
          </div>
          <div className="field">
            <label htmlFor="s-photosEnabled">
              <input id="s-photosEnabled" type="checkbox" checked={form.photosEnabled}
                onChange={e => setForm(f => ({ ...f, photosEnabled: e.target.checked }))} />{" "}
              Foto nelle recensioni attive (caricamento e visualizzazione)
            </label>
            <span className="hint">Disattivandolo, le foto esistenti non vengono più mostrate né accettate (restano nel database e tornano visibili riattivando).</span>
          </div>
          <div className="field">
            <label htmlFor="s-votesEnabled">
              <input id="s-votesEnabled" type="checkbox" checked={form.votesEnabled}
                onChange={e => setForm(f => ({ ...f, votesEnabled: e.target.checked }))} />{" "}
              Voti di utilità attivi (pollice su/giù degli utenti Premium)
            </label>
            <span className="hint">I conteggi esistenti restano nel database; disattivando, i pulsanti scompaiono dalle schede.</span>
          </div>
          <button className="btn btn-primary" type="submit">Salva impostazioni</button>
        </form>
      </div>
    </>
  );
}
