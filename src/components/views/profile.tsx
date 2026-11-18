"use client";
// ZoomZoom — area personale: panoramica, inviti, impostazioni con 2FA
// (attivazione con segreto mostrato una sola volta, codici di backup).
import { useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api, fmt1, fmtMonthYear } from "@/lib/client/api";
import { Alert, Modal, VerifBadge } from "../ui-kit";
import { navigate } from "@/lib/client/router";

function ProfileTabs({ active }: { active: string }) {
  const tabs = [
    ["#/profilo", "Panoramica"],
    ["#/profilo-inviti", "Inviti"],
    ["#/profilo-impostazioni", "Impostazioni e privacy"],
  ];
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([href, label]) => (
        <a key={href} role="tab" aria-selected={href === active} href={href}>{label}</a>
      ))}
    </div>
  );
}

type Overview = {
  experiences: Array<{
    id: string; entity: { id: string; name: string; categoryId: string }; kind: string; period: string | null;
    origin: string; status: string; note: string | null; createdAt: string;
    review: { id: string; score: number; status: string } | null;
  }>;
  reviews: Array<{ id: string; entity: { id: string; name: string }; score: number; status: string; createdAt: string; updatedAt: string | null; updateReason: string | null }>;
  reports: Array<{ id: string; reason: string; status: string; createdAt: string; targetId: string }>;
};

function RequireLogin() {
  const { user, boot } = useApp();
  if (boot && !user) {
    return (
      <div className="container section" style={{ maxWidth: 560 }}>
        <Alert kind="info">Questa area richiede l&apos;accesso. <a href="#/accedi">Accedi</a> o <a href="#/registrati">registrati</a>: la consultazione pubblica resta libera.</Alert>
      </div>
    );
  }
  return null;
}

export function ProfileView() {
  const { user, boot } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    if (user) void api<Overview>("/api/me/overview").then(res => { if (res.ok) setData(res); });
  }, [user]);
  const guard = RequireLogin();
  if (guard) return guard;
  if (!user || !data || !boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Ciao, {user.nickname}</h1>
          <p className="sub">Email verificata: <b>{user.email}</b> · Account dal {fmtMonthYear(user.createdAt.toISOString ? user.createdAt.toISOString() : String(user.createdAt))}</p>
        </div>
      </div>
      <ProfileTabs active="#/profilo" />
      <div className="card mb2">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Le tue esperienze verificate</h2>
        {data.experiences.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Scheda</th><th scope="col">Tipo</th><th scope="col">Stato</th><th scope="col">Recensione</th></tr></thead>
              <tbody>
                {data.experiences.map(e => (
                  <tr key={e.id}>
                    <td><a href={`#/scheda/${e.entity.id}`}>{e.entity.name}</a></td>
                    <td className="small">{e.kind}{e.period ? ` · ${e.period}` : ""}</td>
                    <td>{e.status === "active" ? <span className="pill pill-green">Attiva</span> : e.status === "pending" ? <span className="pill pill-amber">In verifica</span> : <span className="pill pill-red">Rifiutata</span>}</td>
                    <td>
                      {e.review ? (
                        e.review.status === "published"
                          ? <a href={`#/scheda/${e.entity.id}`} className="small">Pubblicata · {fmt1(e.review.score)}/10</a>
                          : <span className="pill pill-red">Nascosta</span>
                      ) : e.status === "active"
                        ? <a className="btn btn-ghost btn-xs" href={`#/scrivi/${e.id}`}>Scrivi la recensione</a>
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted mb0">Nessuna esperienza registrata: puoi <a href="#/verifica-esperienza">richiedere la verifica documentale</a> oppure attendere un invito email da un soggetto verificato.</p>
        )}
      </div>
      <div className="card mb2">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Le tue recensioni</h2>
        {data.reviews.length ? (
          <ul className="mb0">
            {data.reviews.map(r => (
              <li key={r.id} className="small" style={{ marginBottom: 8 }}>
                <a href={`#/scheda/${r.entity.id}`}>{r.entity.name}</a> · {fmt1(r.score)}/10 · {fmtMonthYear(r.createdAt)}
                {r.updatedAt ? ` · aggiornata ${fmtMonthYear(r.updatedAt)}` : ""}
                {" "}{r.status === "published"
                  ? <a className="btn btn-ghost btn-xs" href={`#/rettifica/${r.id}`}>Aggiorna / rettifica</a>
                  : <span className="pill pill-red">Nascosta dalla moderazione</span>}
              </li>
            ))}
          </ul>
        ) : <p className="small muted mb0">Non hai ancora pubblicato recensioni.</p>}
      </div>
      <div className="card">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Le tue segnalazioni</h2>
        {data.reports.length ? (
          <ul className="small mb0">
            {data.reports.map(r => (
              <li key={r.id}>{new Date(r.createdAt).toLocaleDateString("it-IT")} · motivo: {r.reason} · stato: {r.status}</li>
            ))}
          </ul>
        ) : <p className="small muted mb0">Nessuna segnalazione presentata.</p>}
      </div>
    </div>
  );
}

export function ProfileInvitesView() {
  const { user, boot } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    if (user) void api<Overview>("/api/me/overview").then(res => { if (res.ok) setData(res); });
  }, [user]);
  const guard = RequireLogin();
  if (guard) return guard;
  if (!user || !data || !boot) return <div className="container section"><p className="muted">Caricamento…</p></div>;
  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Inviti ricevuti</h1>
          <p className="sub">Gli inviti collegati al tuo indirizzo email <b>{user.email}</b>. Ogni invito è a uso singolo, con scadenza di {boot.settings.inviteExpiryDays} giorni.</p>
        </div>
      </div>
      <ProfileTabs active="#/profilo-inviti" />
      <Alert kind="info">
        Gli inviti arrivano per email all&apos;indirizzo con cui ti sei registrato: aprili dal messaggio ricevuto. {boot.site.demoMode ? "In questa istanza demo i messaggi sono visibili nella casella demo (collegamento nella barra superiore)." : ""}
      </Alert>
      <div className="card">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Esperienze collegate al tuo indirizzo</h2>
        {data.experiences.length ? (
          <ul className="small mb0">
            {data.experiences.filter(e => e.origin === "business").map(e => (
              <li key={e.id} style={{ marginBottom: 6 }}>
                {e.entity.name} · {e.kind} · {e.status === "active" ? "invito attivo o già riscattato" : "in approvazione"}
                {e.review ? " · recensita" : ""}
              </li>
            ))}
            {!data.experiences.filter(e => e.origin === "business").length ? <li>Nessun invito da soggetti verificati registrato.</li> : null}
          </ul>
        ) : <p className="small muted mb0">Nessuna esperienza.</p>}
      </div>
    </div>
  );
}

export function ProfileSettingsView() {
  const { user, boot, toast, refreshBoot } = useApp();
  const [nick, setNick] = useState(user?.nickname || "");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [totpStep, setTotpStep] = useState<"idle" | "pending" | "done">("idle");
  const [totpSecret, setTotpSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [totpQr, setTotpQr] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState("");
  const [delOpen, setDelOpen] = useState(false);

  const guard = RequireLogin();
  if (guard) return guard;
  if (!user || !boot) return null;

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 26, paddingBottom: 30 }}>
      <div className="section-head">
        <div>
          <h1 style={{ margin: 0 }}>Impostazioni e privacy</h1>
          <p className="sub">Pseudonimo, password, doppia autenticazione e controllo dei tuoi dati.</p>
        </div>
      </div>
      <ProfileTabs active="#/profilo-impostazioni" />
      <div className="card mb2">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Dati principali</h2>
        <p className="small muted">Email (privata, verificata): <b>{user.email}</b> · Account dal {fmtMonthYear(String(user.createdAt))}</p>
        <form onSubmit={async e => {
          e.preventDefault();
          const res = await api<{ nickname: string }>("/api/me/nickname", { body: { nickname: nick } });
          if (res.ok) { toast("Pseudonimo aggiornato."); await refreshBoot(); }
          else toast(res.error, "err");
        }}>
          <div className="row">
            <div className="field mb0" style={{ flex: 1 }}>
              <label htmlFor="s-nick">Pseudonimo pubblico</label>
              <input id="s-nick" value={nick} minLength={3} required onChange={e => setNick(e.target.value)} />
            </div>
            <button className="btn btn-ghost" type="submit" style={{ alignSelf: "flex-end" }}>Salva</button>
          </div>
        </form>
      </div>
      <div className="card mb2">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Password</h2>
        <form onSubmit={async e => {
          e.preventDefault();
          const res = await api("/api/auth/change-password", { body: { oldPassword: oldPw, newPassword: newPw } });
          if (res.ok) { toast("Password aggiornata."); setOldPw(""); setNewPw(""); (e.target as HTMLFormElement).reset(); }
          else toast(res.error, "err");
        }}>
          <div className="row">
            <div className="field mb0">
              <label htmlFor="s-old">Attuale</label>
              <input id="s-old" type="password" required value={oldPw} onChange={e => setOldPw(e.target.value)} />
            </div>
            <div className="field mb0">
              <label htmlFor="s-new">Nuova (min 10)</label>
              <input id="s-new" type="password" minLength={10} required value={newPw} onChange={e => setNewPw(e.target.value)} />
            </div>
            <button className="btn btn-ghost" type="submit" style={{ alignSelf: "flex-end" }}>Cambia</button>
          </div>
        </form>
        <p className="small muted mb0">Le password sono conservate solo come hash (scrypt con sale per utente): nessuno può leggerle, nemmeno gli amministratori.</p>
      </div>
      <div className="card mb2">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>Autenticazione a due fattori (TOTP)</h2>
        {user.totpEnabled ? (
          <>
            <Alert kind="ok">2FA attiva: l&apos;accesso richiede anche il codice temporaneo dalla tua app.</Alert>
            <form onSubmit={async e => {
              e.preventDefault();
              const res = await api("/api/auth/2fa/disable", { body: { code: disableCode } });
              if (res.ok) { toast("2FA disattivata."); await refreshBoot(); }
              else toast(res.error, "err");
            }}>
              <div className="field">
                <label htmlFor="t-off-code">Codice per disattivare</label>
                <input id="t-off-code" inputMode="numeric" maxLength={6} required value={disableCode}
                  onChange={e => setDisableCode(e.target.value)} style={{ letterSpacing: "3px", textAlign: "center" }} />
              </div>
              <button className="btn btn-ghost" type="submit">Disattiva la 2FA</button>
            </form>
          </>
        ) : totpStep === "pending" ? (
          <>
            <Alert kind="info"><b>Passaggio 2 di 2.</b> Aggiungi la chiave alla tua app (Google Authenticator, Aegis, 1Password…) e inserisci il codice generato.</Alert>
            <div className="card card-pad-s mb2" style={{ textAlign: "center" }}>
              {totpQr ? (
                <img src={totpQr} alt="QR code da inquadrare con l'app di autenticazione per aggiungere l'account" width={200} height={200} style={{ display: "block", margin: "0 auto 8px" }} />
              ) : null}
              <p className="small mb1"><b>Chiave segreta (inserimento manuale):</b></p>
              <p className="mono" style={{ wordBreak: "break-all", background: "var(--paper)", padding: 8, borderRadius: 6 }}>{totpSecret}</p>
              <p className="small mb1 mt2"><b>URI per le app (alternativa testuale al QR):</b></p>
              <p className="mono small" style={{ wordBreak: "break-all", background: "var(--paper)", padding: 8, borderRadius: 6 }}>{otpauth}</p>
            </div>
            <form onSubmit={async e => {
              e.preventDefault();
              const res = await api<{ backupCodes: string[] }>("/api/auth/2fa/enable", { body: { code: totpCode } });
              if (res.ok) {
                setTotpStep("done");
                setBackupCodes(res.backupCodes);
                await refreshBoot();
                toast("2FA attivata: da ora l'accesso chiederà anche il codice temporaneo.");
              } else toast(res.error, "err");
            }}>
              <div className="field">
                <label htmlFor="t-on-code">Codice a 6 cifre</label>
                <input id="t-on-code" inputMode="numeric" maxLength={6} required value={totpCode}
                  onChange={e => setTotpCode(e.target.value)}
                  style={{ letterSpacing: "3px", fontSize: "1.15rem", textAlign: "center" }} />
              </div>
              <div className="row">
                <button className="btn btn-primary" type="submit">Verifica e attiva</button>
                <button className="btn btn-ghost" type="button" onClick={() => setTotpStep("idle")}>Annulla</button>
              </div>
            </form>
          </>
        ) : totpStep === "done" && backupCodes ? (
          <>
            <Alert kind="warn"><b>Codici di backup.</b> Conservali in luogo sicuro: ognuno è monouso e permette l&apos;accesso se perdi l&apos;app. Non verranno mostrati di nuovo.</Alert>
            <div className="card card-pad-s mb2" style={{ columns: 2 }}>
              {backupCodes.map(c => <code key={c} style={{ display: "block", padding: "2px 0" }}>{c}</code>)}
            </div>
            <button className="btn btn-primary" onClick={() => { setTotpStep("idle"); setBackupCodes(null); }}>Ho salvato i codici</button>
          </>
        ) : (
          <>
            <Alert kind="warn"><b>2FA non attiva.</b> Aggiungi un secondo fattore con un&apos;app di codici temporanei (TOTP): rende molto più difficile l&apos;uso indebito del tuo account.</Alert>
            <button className="btn btn-primary" onClick={async () => {
              const res = await api<{ secret: string; otpauth: string; qr?: string }>("/api/auth/2fa/start", { body: {} });
              if (res.ok) { setTotpSecret(res.secret); setOtpauth(res.otpauth); setTotpQr(res.qr || ""); setTotpStep("pending"); }
              else toast(res.error, "err");
            }}>Attiva la 2FA (app di autenticazione)</button>
          </>
        )}
      </div>
      <div className="card mb2">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>I tuoi dati</h2>
        <p className="small">Puoi esportare in qualsiasi momento tutti i dati collegati al tuo account in formato leggibile (esperienze, recensioni, segnalazioni).</p>
        <a className="btn btn-ghost" href="/api/me/export">Esporta i miei dati (JSON)</a>
      </div>
      <div className="card" style={{ borderColor: "#EBC6C0" }}>
        <h2 style={{ fontSize: "1.05rem", marginTop: 0, color: "var(--danger)" }}>Cancellazione account</h2>
        <p className="small">La richiesta avvia la procedura di cancellazione dei dati (soggetta agli obblighi di conservazione previsti dalla legge applicabile). L&apos;esito è comunicato via email entro i termini.</p>
        <button className="btn btn-danger" onClick={() => setDelOpen(true)}>Richiedi la cancellazione</button>
      </div>
      {delOpen ? (
        <Modal label="Richiesta di cancellazione" onClose={() => setDelOpen(false)}>
          <div className="modal-head">
            <h2>Richiedere la cancellazione dell&apos;account?</h2>
            <button className="modal-close" onClick={() => setDelOpen(false)} aria-label="Chiudi">×</button>
          </div>
          <p className="mb2">La richiesta verrà presa in carico (con verifica degli eventuali obblighi di conservazione). Riceverai conferma via email.</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setDelOpen(false)}>Annulla</button>
            <button className="btn btn-danger" onClick={async () => {
              setDelOpen(false);
              const res = await api("/api/me/delete-request", { body: {} });
              toast(res.ok ? "Richiesta registrata: riceverai conferma via email." : res.error, res.ok ? "ok" : "err");
            }}>Invia richiesta</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
