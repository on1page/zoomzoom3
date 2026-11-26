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
  ["utilita", "Utilità e riconoscimenti", "mod.reviews", "utility"],
  ["foto", "Foto recensioni", "mod.reviews", null],
  ["esperienze", "Esperienze e verifiche", "mod.experiences", "experiences"],
  ["inviti", "Inviti", "admin.invites", null],
  ["utenti", "Utenti e privacy", "admin.users", "privacy"],
  ["entita", "Schede e proposte", "admin.entities", "proposals"],
  ["consulenti", "Consulenti tecnici", "admin.entities", "consulenti"],
  ["perizie", "Perizie e pagamenti", "admin.entities", null],
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
        if (q.href.includes("consulenti")) c.consulenti = q.count;
        if (q.href.includes("utenti")) c.privacy = q.count;
        if (q.href.includes("utilita")) c.utility = q.count;
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
          {actionModal.kind === "report.decide" || actionModal.kind === "dispute.decide" || actionModal.kind === "proposal.approve" || actionModal.kind === "utility.appeal.resolve" ? (
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
                ) : actionModal.kind === "utility.appeal.resolve" ? (
                  <>
                    <option value="accepted">Accogli: i voti esclusi tornano a contare</option>
                    <option value="rejected">Respingi: i controlli restano attivi</option>
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
  "consultant.approve": "Decisione sull'iscrizione consulente",
  "entity.toggle": "Pubblica/nascondi scheda",
  "review.restore": "Ripristina la recensione",
  "photo.remove": "Rimuovi la foto",
  "utility.appeal.resolve": "Decisione sul ricorso di utilità",
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

    case "utilita": {
      const enabled = (d?.enabled !== false);
      const stats = (d?.stats || {}) as {
        lastCalculatedAt: string | null; votesInWindow: number; reviewsScored: number;
        confirmedReviews: number; anomalousVotes: number; badgeCounts: Record<string, number>; openAppeals: number;
      };
      const rules = (d?.rules || {}) as {
        windowDays: number; capPerReview: number; bonusFactor: number; burstPerDay: number; reciprocalMin: number;
        badges: Array<{ code: string; label: string; description: string; threshold: number; minCategories: number }>;
      };
      const appeals = (d?.appeals || []) as Array<{
        id: string; user: { nickname: string; email: string } | null;
        review: { id: string; entityName: string; utility: { points: number; validVotes: number; anomalousVotes: number } | null } | null;
        reason: string; status: string; answer: string | null; createdAt: string; resolvedAt: string | null;
      }>;
      const top = (d?.top || []) as Array<{ entityName: string; author: string; points: number; validVotes: number; anomalousVotes: number; confirmed: boolean }>;
      const recalc = async () => {
        const res = await api<{ stats: { reviewsScored: number; votesAnomalous: number; badgesAssigned: number } }>("/api/admin/action", {
          body: { action: "utility.recalc", reason: "Ricalcolo manuale dal back office." },
        });
        if (res.ok) {
          toast(`Ricalcolo completato: ${res.stats.reviewsScored} indagini con punteggio, ${res.stats.votesAnomalous} voti anomali esclusi, ${res.stats.badgesAssigned} badge attivi.`);
          void reload();
        } else toast(res.error, "err");
      };
      return (
        <>
          <div className="admin-head"><h1>Utilità e riconoscimenti</h1><span className="pill pill-gray">premia chi aiuta a decidere, non le stelle né il volume</span></div>
          {!enabled ? <Alert kind="warn"><b>Funzione disattivata.</b> Il riconoscimento di utilità è spento nelle impostazioni: voti e riconoscimenti non vengono calcolati.</Alert> : null}
          <Alert kind="info">Punti = voti «utile» validi pesati (tetto {rules.capPerReview} per indagine) − voti anomali, su finestra mobile di {rules.windowDays} giorni, bonus ×{rules.bonusFactor} se l&apos;utilità si conferma su più settimane. Le stelle non entrano mai nella formula. Il ricalcolo parte ogni giorno da un job automatico; qui si può anticipare a mano.</Alert>
          <div className="stat-grid">
            <div className="stat"><div className="v">{stats.votesInWindow}</div><div className="l">Voti «utile» nella finestra</div></div>
            <div className="stat"><div className="v">{stats.reviewsScored}</div><div className="l">Indagini con punteggio</div><div className="d">{stats.confirmedReviews} a utilità confermata</div></div>
            <div className="stat"><div className="v">{stats.anomalousVotes}</div><div className="l">Voti anomali esclusi</div><div className="d">scambi reciproci e raffiche</div></div>
            <div className="stat"><div className="v">{Object.values(stats.badgeCounts || {}).reduce((a, b) => a + b, 0)}</div><div className="l">Badge attivi</div><div className="d">{rules.badges?.map(b => `${b.label}: ${stats.badgeCounts?.[b.code] || 0}`).join(" · ")}</div></div>
          </div>
          <div className="card mb2">
            <div className="premium-card-head">
              <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Ricalcolo</h2>
              {stats.lastCalculatedAt ? <span className="pill pill-gray">ultimo: {fmtDateTime(stats.lastCalculatedAt)}</span> : <span className="pill pill-gray">mai eseguito</span>}
            </div>
            <p className="small mb1">Stessi conti del job giornaliero (finestra mobile di {rules.windowDays} giorni): nessun risultato «speciale» dal back office, tutto tracciato nel log.</p>
            <button className="btn btn-primary btn-sm" onClick={() => void recalc()} disabled={!enabled}>Ricalcola ora</button>
          </div>
          <div className="card mb2" style={{ overflowX: "auto" }}>
            <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Ricorsi ({stats.openAppeals} aperti)</h2>
            <p className="small muted">L&apos;autore contesta l&apos;esclusione di voti ritenuti anomali. Accogliendo il ricorso, i controlli su quell&apos;indagine vengono sospesi e i voti esclusi tornano a contare dal ricalcolo successivo; la risposta motivata viene comunicata per email.</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Utente</th><th scope="col">Indagine</th><th scope="col">Motivo</th><th scope="col">Stato</th><th scope="col">Azioni</th></tr></thead>
                <tbody>
                  {appeals.map(a => (
                    <tr key={a.id}>
                      <td className="small">{a.user ? <>{a.user.nickname}<br /><span className="muted">{a.user.email}</span></> : <em>utente rimosso</em>}</td>
                      <td className="small">
                        {a.review ? (
                          <>{a.review.entityName}<br />{a.review.utility
                            ? <span className="muted">{fmt1(a.review.utility.points)} punti · {a.review.utility.validVotes} voti validi · {a.review.utility.anomalousVotes} esclusi</span>
                            : <span className="muted">ancora senza punteggio</span>}</>
                        ) : <em>ricorso generale</em>}
                      </td>
                      <td className="small">{a.reason.slice(0, 200)}{a.reason.length > 200 ? "…" : ""}{a.answer ? <><br /><span className="pill pill-gray">risposta:</span> {a.answer.slice(0, 150)}{a.answer.length > 150 ? "…" : ""}</> : null}</td>
                      <td>
                        {a.status === "open" ? <span className="pill pill-amber">In valutazione</span>
                          : a.status === "accepted" ? <span className="pill pill-green">Accolto</span>
                          : <span className="pill pill-red">Respinto</span>}
                        {a.resolvedAt ? <div className="small muted">{fmtDateTime(a.resolvedAt)}</div> : null}
                      </td>
                      <td>{a.status === "open" ? <button className="btn btn-primary btn-xs" onClick={() => onAction("utility.appeal.resolve", a.id)}>Decidi</button> : null}</td>
                    </tr>
                  ))}
                  {!appeals.length ? <tr><td colSpan={5}>Nessun ricorso.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Indagini con più punti di utilità (monitoraggio)</h2>
            <p className="small muted">Solo per lo staff, ordinato per punti di utilità (mai volume, mai stelle): serve a controllare che il riconoscimento non si concentri in modo sospetto.</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Indagine</th><th scope="col">Autore</th><th scope="col">Punti</th><th scope="col">Voti validi</th><th scope="col">Anomali</th><th scope="col">Confermata</th></tr></thead>
                <tbody>
                  {top.map((t, i) => (
                    <tr key={i}>
                      <td className="small">{t.entityName}</td>
                      <td className="small">{t.author}</td>
                      <td><b>{fmt1(t.points)}</b></td>
                      <td>{t.validVotes}</td>
                      <td>{t.anomalousVotes || "—"}</td>
                      <td>{t.confirmed ? <span className="pill pill-green">sì</span> : <span className="pill pill-gray">no</span>}</td>
                    </tr>
                  ))}
                  {!top.length ? <tr><td colSpan={6}>Nessuna indagine con punteggio: servono voti «utile» nella finestra.</td></tr> : null}
                </tbody>
              </table>
            </div>
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

    case "consulenti": {
      const consulenti = (d?.consulenti || []) as Array<{
        id: string; name: string; email: string; nickname: string; totpEnabled: boolean;
        profession: string; title: string; bio: string | null; zone: string; province: string | null;
        radiusKm: number; feeCents: number; vatNumber: string | null; iban: string | null; phone: string | null;
        ibanCheck: string | null; ibanCheckedAt: string | null;
        status: string; rejectReason: string | null; entityId: string | null; hasPhoto: boolean;
        docs: Array<{ id: string; kind: string; originalName: string; sizeBytes: number }>;
        requestsCount: number; createdAt: string;
      }>;
      const pendenti = consulenti.filter(c => c.status === "pending");
      const altri = consulenti.filter(c => c.status !== "pending");
      const fmtE = (c: number) => (c / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 });
      // stato della verifica dell'intestazione dell'IBAN (autocertificato,
      // confermato dallo staff o dal servizio esterno, discordanza segnalata)
      const ibanPill = (c: { ibanCheck: string | null }) =>
        c.ibanCheck === "confirmed" ? <span className="pill pill-green">IBAN verificato</span>
        : c.ibanCheck === "mismatch" ? <span className="pill pill-red">IBAN discorde</span>
        : c.ibanCheck === "self" ? <span className="pill pill-amber">IBAN autocertificato</span>
        : <span className="pill pill-gray">IBAN da verificare</span>;
      return (
        <>
          <div className="admin-head"><h1>Consulenti tecnici</h1><span className="pill pill-gray">{pendenti.length} domande da esaminare</span></div>
          <Alert kind="info">L&apos;approvazione crea la scheda pubblica nel catalogo (categoria Consulenti) e abilita la ricezione delle richieste di perizia. L&apos;accesso del consulente richiede la 2FA: verificata qui prima di approvare. I documenti sono riservati allo staff.</Alert>
          <h2 style={{ fontSize: "1.05rem" }}>Domande in attesa</h2>
          <div className="table-wrap mb2">
            <table className="table">
              <thead><tr><th scope="col">Candidato</th><th scope="col">Professione e dati</th><th scope="col">Documenti (riservati)</th><th scope="col">Decisione</th></tr></thead>
              <tbody>
                {pendenti.map(c => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><br /><span className="small muted">{c.email}</span><br />
                      {c.totpEnabled ? <span className="pill pill-green">2FA attiva</span> : <span className="pill pill-red">2FA mancante</span>}</td>
                    <td className="small">{c.profession} · {c.title}<br />Zona: {c.zone}{c.province ? ` (${c.province})` : ""} · raggio {c.radiusKm} km<br />Tariffa: {c.feeCents > 0 ? `€ ${fmtE(c.feeCents)}` : "su richiesta"} · P.IVA {c.vatNumber}<br />IBAN: <span className="mono">{c.iban}</span> {ibanPill(c)}{c.phone ? ` · tel. ${c.phone}` : ""}{c.bio ? <><br /><span className="muted">{c.bio.slice(0, 200)}</span></> : null}</td>
                    <td className="small">{c.docs.map(doc => (
                      <div key={doc.id}><a href={`/api/consulente/doc/${doc.id}`}>{doc.originalName}</a> <span className="muted">({doc.kind})</span></div>
                    ))}</td>
                    <td>
                      <button className="btn btn-primary btn-xs" onClick={() => onAction("consultant.approve", c.id)}>Approva</button>{" "}
                      <button className="btn btn-danger btn-xs" onClick={() => onAction("consultant.reject", c.id)}>Respingi</button>
                      <div style={{ marginTop: 6 }}>
                        {c.ibanCheck !== "confirmed" ? <button className="btn btn-ghost btn-xs" onClick={() => onAction("consultant.ibanConfirm", c.id)}>Conferma IBAN</button> : null}{" "}
                        {c.ibanCheck !== "mismatch" ? <button className="btn btn-ghost btn-xs" onClick={() => onAction("consultant.ibanMismatch", c.id)}>IBAN discorde</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!pendenti.length ? <tr><td colSpan={4}>Nessuna domanda in attesa.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <h2 style={{ fontSize: "1.05rem" }}>Iscritti ({altri.length})</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Nome</th><th scope="col">Professione</th><th scope="col">Zona</th><th scope="col" className="num">Richieste</th><th scope="col">Stato</th></tr></thead>
              <tbody>
                {altri.map(c => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><br /><span className="small muted">{c.email}</span></td>
                    <td className="small">{c.profession}</td>
                    <td className="small">{c.zone}</td>
                    <td className="num">{c.requestsCount}</td>
                    <td>
                      {c.status === "approved" ? <span className="pill pill-green">Approvato</span> : <span className="pill pill-red">Respinto</span>}
                      {c.entityId ? <> <a className="small" href={`#/scheda/${c.entityId}`}>scheda</a></> : null}
                      <div style={{ marginTop: 6 }}>{ibanPill(c)}</div>
                      {c.ibanCheck !== "confirmed" ? <button className="btn btn-ghost btn-xs" style={{ marginTop: 6 }} onClick={() => onAction("consultant.ibanConfirm", c.id)}>Conferma IBAN</button> : null}
                    </td>
                  </tr>
                ))}
                {!altri.length ? <tr><td colSpan={5}>Nessun altro iscritto.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    case "perizie": {
      const perizie = (d?.perizie || []) as Array<{
        id: string; kind: string; address: string; description: string; status: string;
        feeCents: number | null; payoutCents: number | null; commissionCents: number | null;
        paymentRef: string | null; paidAt: string | null; deliveredAt: string | null; createdAt: string;
        consultant: string; consultantIban: string | null; requester: string; requesterEmail: string;
      }>;
      const fmtE = (c: number | null) => c == null ? "—" : `€ ${(c / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`;
      const periziaAct = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
        const res = await api(`/api/consulente/requests/${id}/action`, { body: { action, ...extra } });
        toast(res.ok ? "Operazione registrata." : res.error, res.ok ? "ok" : "err");
        if (res.ok) void reload();
      };
      return (
        <>
          <div className="admin-head"><h1>Perizie e pagamenti</h1><span className="pill pill-gray">{perizie.length} richieste</span></div>
          <Alert kind="info">
            Il denaro è custodito dalla piattaforma: l&apos;utente paga dopo l&apos;accettazione, il consulente è accreditato (tariffa meno il 10%) solo dopo la consegna della relazione.
            La registrazione del pagamento e dell&apos;accredito è riservata al <b>super amministratore</b>: agli altri ruoli il server risponde con un rifiuto.
          </Alert>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Richiesta</th><th scope="col">Parti</th><th scope="col">Tariffa</th><th scope="col">Stato</th><th scope="col">Registrazioni</th></tr></thead>
              <tbody>
                {perizie.map(r => (
                  <tr key={r.id}>
                    <td className="small"><b>{r.kind}</b><br />{r.address}<br /><span className="muted">{fmtDateTime(r.createdAt)}</span></td>
                    <td className="small">Consulente: {r.consultant}<br /><span className="muted">IBAN: <span className="mono">{r.consultantIban || "—"}</span></span><br />Richiedente: {r.requester} ({r.requesterEmail})</td>
                    <td className="small">Tariffa: <b>{fmtE(r.feeCents)}</b><br />Accredito: {fmtE(r.payoutCents)}<br /><span className="muted">Commissione: {fmtE(r.commissionCents)}</span></td>
                    <td className="small">{{ requested: "In attesa", accepted: "Accettata", rejected: "Rifiutata", paid: "Pagata", delivered: "Consegnata", closed: "Conclusa", cancelled: "Annullata" }[r.status] || r.status}{r.paymentRef ? <><br /><span className="muted">rif. {r.paymentRef}</span></> : null}</td>
                    <td>
                      {r.status === "accepted" ? (
                        <button className="btn btn-primary btn-xs mb1" onClick={() => {
                          const ref = window.prompt("Riferimento del pagamento ricevuto (facoltativo, es. CRO bonifico):") ?? "";
                          void periziaAct(r.id, "pay", { paymentRef: ref });
                        }}>Registra pagamento</button>
                      ) : null}
                      {r.status === "delivered" ? (
                        <button className="btn btn-primary btn-xs" onClick={() => void periziaAct(r.id, "payout")}>Registra accredito</button>
                      ) : null}
                      {r.status === "delivered" || r.status === "closed" ? (
                        <a className="btn btn-ghost btn-xs" href={`/api/consulente/requests/${r.id}/pdf`}>PDF</a>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!perizie.length ? <tr><td colSpan={5}>Nessuna richiesta.</td></tr> : null}
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
    premiumDaysPerReview: Number(s.premiumDaysPerReview ?? 7),
    premiumMaxDays: Number(s.premiumMaxDays ?? 365),
    openReviewsPerDay: Number(s.openReviewsPerDay ?? 5),
    premiumEnabled: s.premiumEnabled !== false,
    openReviewsEnabled: s.openReviewsEnabled !== false,
    photosEnabled: s.photosEnabled !== false,
    votesEnabled: s.votesEnabled !== false,
    utilityEnabled: s.utilityEnabled !== false,
    consulentiEnabled: s.consulentiEnabled !== false,
    platformIban: String(s.platformIban ?? ""),
    paymentInstructions: String(s.paymentInstructions ?? ""),
  });
  const fields: Array<[Exclude<keyof typeof form, "premiumEnabled" | "openReviewsEnabled" | "photosEnabled" | "votesEnabled" | "utilityEnabled" | "consulentiEnabled" | "platformIban" | "paymentInstructions">, string, string]> = [
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
          <div className="field">
            <label htmlFor="s-utilityEnabled">
              <input id="s-utilityEnabled" type="checkbox" checked={form.utilityEnabled}
                onChange={e => setForm(f => ({ ...f, utilityEnabled: e.target.checked }))} />{" "}
              Riconoscimento di utilità attivo (punti, badge, ricorsi)
            </label>
            <span className="hint">Il ricalcolo quotidiano assegna punti e riconoscimenti sulla finestra di 30 giorni. Disattivandolo, etichette e badge non compaiono più (i voti restano, se i voti sono attivi).</span>
          </div>
          <div className="field">
            <label htmlFor="s-consulentiEnabled">
              <input id="s-consulentiEnabled" type="checkbox" checked={form.consulentiEnabled}
                onChange={e => setForm(f => ({ ...f, consulentiEnabled: e.target.checked }))} />{" "}
              Consulenti tecnici attivi (iscrizioni e richieste di perizia)
            </label>
            <span className="hint">Sospende nuove iscrizioni e nuove richieste; le schede esistenti restano nel catalogo e le pratiche avviate si concludono.</span>
          </div>
          <div className="field">
            <label htmlFor="s-platformIban">IBAN della piattaforma (incassi perizie)</label>
            <input id="s-platformIban" value={form.platformIban} placeholder="ITXX..." onChange={e => setForm(f => ({ ...f, platformIban: e.target.value }))} />
            <span className="hint">Mostrato all&apos;utente per saldare le richieste accettate. Lascia vuoto per comunicarlo con altre istruzioni.</span>
          </div>
          <div className="field">
            <label htmlFor="s-paymentInstructions">Istruzioni di pagamento perizie</label>
            <textarea id="s-paymentInstructions" rows={2} value={form.paymentInstructions} onChange={e => setForm(f => ({ ...f, paymentInstructions: e.target.value }))} placeholder="Es. Bonifico entro 3 giorni dall'accettazione, causale 'perizia <codice>'. All'esito invia la ricevuta a amministrazione@sito.it." />
            <span className="hint">Testo libero mostrato accanto all&apos;IBAN nella pagina delle richieste.</span>
          </div>
          <button className="btn btn-primary" type="submit">Salva impostazioni</button>
        </form>
      </div>
    </>
  );
}
