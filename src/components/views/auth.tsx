"use client";
// ZoomZoom — autenticazione: accesso (anche 2FA e codici di backup),
// registrazione con verifica email, riscatto token di verifica.
// Nessuna credenziale demo o codice TOTP viene mostrato qui.
// Alla registrazione si può caricare una foto profilo (facoltativa) e
// dichiarare la categoria di appartenenza: per ogni categoria nasce la
// scheda ad hoc ATTIVA nel catalogo. Le recensioni restano anonime di
// default (sola categoria): nickname e foto compaiono solo con il flag.
import { useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { navigate } from "@/lib/client/router";
import { api } from "@/lib/client/api";
import { Alert } from "../ui-kit";
import { AvatarInput } from "../avatar-input";

// opzioni del combo "a quale categoria appartieni": stessi slug validati
// dal server (SUBJECT_CATEGORY_IDS in src/lib/server/user-identity.ts)
const SUBJECT_OPTIONS = [
  { id: "proprietario", label: "Proprietario di immobili", person: true },
  { id: "affittuario", label: "Affittuario", person: true },
  { id: "amministratore", label: "Amministratore di condominio", person: false },
  { id: "agenzia", label: "Agenzia immobiliare", person: false },
  { id: "ditta", label: "Ditta / professionista della casa", person: false },
  { id: "consulente", label: "Consulente tecnico", person: false },
];

// QR di prima configurazione 2FA (forma della risposta del server)
type Enroll = { otpauth: string; qr: string; secret: string };

export function LoginView() {
  const { boot, refreshBoot, toast } = useApp();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [hp, setHp] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const step1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hp) return;
    setErr(null); setBusy(true);
    const res = await api<{ needs2fa?: boolean; enrollment?: Enroll }>("/api/auth/login", { body: { email, password: pw } });
    setBusy(false);
    if (res.ok) {
      if (res.needs2fa) { setNeeds2fa(true); setEnroll(res.enrollment || null); }
      else {
        await refreshBoot();
        toast("Accesso riuscito. Benvenuto su ZoomZoom.");
        navigate("#/profilo");
      }
    } else if (res.error.includes("riservato all'area amministrativa")) {
      setErr(res.error);
      setTimeout(() => navigate("#/admin"), 900);
    } else setErr(res.error);
  };

  const step2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    const res = useBackup
      ? await api("/api/auth/2fa/backup-login", { body: { email, code } })
      : await api("/api/auth/login-2fa", { body: { email, password: pw, code } });
    setBusy(false);
    if (res.ok) {
      await refreshBoot();
      toast("Accesso riuscito.");
      navigate("#/profilo");
    } else setErr(res.error);
  };

  return (
    <div className="container section" style={{ maxWidth: 560 }}>
      <h1>Accedi</h1>
      <div className="card">
        {needs2fa ? (
          <>
            <Alert kind="info">Inserisci il codice temporaneo a 6 cifre dalla tua app di autenticazione (Google Authenticator, Aegis, 1Password…).</Alert>
            {enroll && !useBackup ? (
              <div className="card card-pad-s mb2" style={{ textAlign: "center" }}>
                <p className="small mb1"><b>Prima configurazione — mostrata solo adesso.</b></p>
                <img src={enroll.qr} alt="QR code da inquadrare con l'app di autenticazione per aggiungere l'account" width={200} height={200} style={{ display: "block", margin: "0 auto 8px" }} />
                <p className="small muted">Se non puoi inquadrare il QR, aggiungi la chiave a mano nell&apos;app (inserimento manuale, codice base32):</p>
                <p className="mono small" style={{ wordBreak: "break-all", background: "var(--paper)", padding: 8, borderRadius: 6 }}>{enroll.secret}</p>
              </div>
            ) : null}
            <form onSubmit={step2}>
              <div className="field">
                <label htmlFor="l2-code">{useBackup ? "Codice di backup" : "Codice 2FA"}</label>
                <input id="l2-code" inputMode={useBackup ? "text" : "numeric"} autoComplete="one-time-code"
                  maxLength={useBackup ? 10 : 6} value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                  required placeholder={useBackup ? "CODICE DI BACKUP" : "000000"}
                  style={{ letterSpacing: "4px", fontSize: "1.2rem", textAlign: "center" }} />
                <span className="hint">{useBackup ? "Codice di backup monouso generato all'attivazione della 2FA." : "Codice a uso singolo, valido ~30 secondi (tolleranza ±30 s)."}</span>
              </div>
              {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Verifica e accedi</button>
            </form>
            <p className="small muted mt2 mb0">
              <button className="link" onClick={() => setUseBackup(b => !b)}>
                {useBackup ? "Ho il codice dell'app" : "Usa un codice di backup"}
              </button>{" · "}
              <button className="link" onClick={() => { setNeeds2fa(false); setCode(""); setErr(null); }}>Torna alle credenziali</button>
            </p>
          </>
        ) : (
          <>
            <form onSubmit={step1}>
              <div className="field">
                <label htmlFor="l-email">Email</label>
                <input id="l-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="l-pw">Password</label>
                <input id="l-pw" type="password" autoComplete="current-password" required value={pw} onChange={e => setPw(e.target.value)} />
                {err ? <span className="error-msg" style={{ display: "block" }}>{err}</span> : null}
              </div>
              <div className="hp-field"><label htmlFor="l-hp">Non compilare</label><input id="l-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} /></div>
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Accedi</button>
            </form>
            {boot?.site.googleOAuthEnabled ? (
              <>
                <hr />
                <a className="btn btn-ghost btn-block" href="/api/auth/google/start">Continua con Google</a>
              </>
            ) : null}
            <p className="small muted center mt2 mb0">Non hai un account? <a href="#/registrati">Registrati</a>.</p>
          </>
        )}
      </div>
      {boot?.site.demoMode ? (
        <div className="login-demo-hint mt3">
          <b>Istanza dimostrativa.</b> Gli account di test e le relative credenziali sono documentati nel file <code>demo-credentials.json</code> del progetto e nel README (mai esposti nel sito). Gli account di moderazione/amministrazione accedono solo dall&apos;<a href="#/admin">area amministrativa dedicata</a> (2FA obbligatoria).
        </div>
      ) : null}
    </div>
  );
}

export function RegisterView() {
  const { boot, toast } = useApp();
  const [email, setEmail] = useState("");
  const [nick, setNick] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [terms, setTerms] = useState(false);
  const [hp, setHp] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [catId, setCatId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selCat = SUBJECT_OPTIONS.find(c => c.id === catId);

  return (
    <div className="container section" style={{ maxWidth: 600 }}>
      <h1>Registrati</h1>
      <Alert kind="info">La registrazione serve a <b>ricevere o richiedere</b> la verifica di un&apos;esperienza. La consultazione di schede, medie e classifiche è sempre libera, senza account.</Alert>
      <div className="card">
        <form onSubmit={async e => {
          e.preventDefault();
          setErr(null);
          if (pw !== pw2) { setErr("Le password non coincidono."); return; }
          setBusy(true);
          const res = await api<{ message?: string; emailDelivery?: string }>("/api/auth/register", {
            body: { email, nickname: nick, password: pw, terms, hp, avatar, categoryId: catId, sheetName: selCat && !selCat.person ? sheetName : "" },
          });
          setBusy(false);
          if (res.ok) {
            toast(res.message || "Registrazione avvenuta.");
            navigate("#/accedi");
          } else setErr(res.error);
        }}>
          <div className="field">
            <label htmlFor="r-email">Email</label>
            <input id="r-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
            <span className="hint">Non viene mai mostrata pubblicamente. Serve per la verifica e per gli inviti.</span>
          </div>
          <div className="field">
            <label htmlFor="r-nick">Pseudonimo pubblico</label>
            <input id="r-nick" required minLength={3} value={nick} onChange={e => setNick(e.target.value)} placeholder="Es. Arianna_84" />
            <span className="hint">Nome visibile quando decidi di firmare un&apos;indagine: scegli uno pseudonimo, non il tuo nome completo.</span>
          </div>
          <div className="field">
            <label htmlFor="r-avatar">Foto profilo <span className="muted">(facoltativa)</span></label>
            <AvatarInput value={avatar} onChange={setAvatar} />
            <span className="hint">Ricompresa senza metadati (posizione EXIF inclusa). Compare sulle tue indagini solo se attivi l&apos;apposita opzione.</span>
          </div>
          <div className="field">
            <label htmlFor="r-cat">A quale categoria appartieni?</label>
            <select id="r-cat" value={catId} onChange={e => { setCatId(e.target.value); setSheetName(""); }}>
              <option value="">Utente — scrivo recensioni</option>
              {SUBJECT_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {selCat ? (
              <span className="hint">
                <span className="pill pill-green" title="La scheda nasce subito, pubblicata e ricercabile nel catalogo della sua categoria.">Scheda attiva</span>{" "}
                {selCat.person
                  ? "Persona fisica: la scheda nasce con le sole iniziali."
                  : "Soggetto d'impresa: puoi indicare il nome con cui sei conosciuto."}
              </span>
            ) : (
              <span className="hint">Nelle indagini compare di default solo la categoria: nickname e foto solo se li autorizzi di volta in volta.</span>
            )}
          </div>
          {selCat && !selCat.person ? (
            <div className="field">
              <label htmlFor="r-sheet">Nome sulla scheda <span className="muted">(facoltativo)</span></label>
              <input id="r-sheet" value={sheetName} onChange={e => setSheetName(e.target.value)} maxLength={80}
                placeholder={selCat.id === "agenzia" ? "Es. Immobiliare Rossi" : selCat.id === "consulente" ? "Es. Studio Tecnico Bianchi" : "Es. Impresa Edile Verdi"} />
              <span className="hint">Lasciando vuoto si usa lo pseudonimo.</span>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="r-pw">Password (minimo 10 caratteri)</label>
            <input id="r-pw" type="password" autoComplete="new-password" minLength={10} required value={pw} onChange={e => setPw(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="r-pw2">Ripeti la password</label>
            <input id="r-pw2" type="password" autoComplete="new-password" minLength={10} required value={pw2} onChange={e => setPw2(e.target.value)} />
            {err ? <span className="error-msg" style={{ display: "block" }}>{err}</span> : null}
          </div>
          <label className="checkline mb2">
            <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} required />
            <span>Ho letto e accetto <a href="#/termini">termini d&apos;uso</a>, <a href="#/privacy">privacy</a> e <a href="#/regole-recensioni">regole delle recensioni</a>.</span>
          </label>
          <div className="hp-field"><label htmlFor="r-hp">Non compilare</label><input id="r-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} /></div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Crea account</button>
        </form>
        <hr />
        <p className="small muted center mb0">Hai già un account? <a href="#/accedi">Accedi</a>.</p>
      </div>
      {boot?.site.emailDelivery === "disabled" ? (
        <Alert kind="warn">
          Su questo server l&apos;invio email non è configurato: l&apos;email di verifica non può partire. {boot.site.demoMode ? "Nell'istanza demo il messaggio resta consultabile dal back office (casella demo)." : "Contatta l'amministratore per completare la verifica."}
        </Alert>
      ) : null}
    </div>
  );
}

export function VerifyEmailView({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [email, setEmail] = useState("");
  useEffect(() => {
    void api<{ email?: string }>("/api/auth/verify-email", { body: { token } }).then(res => {
      if (res.ok) { setState("ok"); setEmail(res.email || ""); }
      else setState("err");
    });
  }, [token]);
  return (
    <div className="container section" style={{ maxWidth: 560 }}>
      {state === "loading" ? <p className="muted">Verifica del collegamento…</p> : state === "ok" ? (
        <Alert kind="ok">
          <h1 style={{ margin: "0 0 8px", fontSize: "1.3rem" }}>Email verificata</h1>
          Grazie, l&apos;indirizzo <b>{email}</b> è confermato. Ora puoi <a href="#/accedi">accedere</a> e richiedere la verifica di un&apos;esperienza.
        </Alert>
      ) : (
        <Alert kind="danger">
          <h1 style={{ margin: "0 0 8px", fontSize: "1.3rem" }}>Collegamento non valido</h1>
          Il token è errato o già utilizzato. Se hai appena effettuato la registrazione, usa il collegamento più recente nella tua email.
        </Alert>
      )}
    </div>
  );
}
