"use client";
// ZoomZoom — chrome dell'applicazione: barra demo (solo DEMO_MODE), header con
// navigazione e menu categorie, menu mobile, footer, banner e pannello cookie
// con consenso granulare, blocco preventivo degli strumenti non essenziali.
import { useEffect, useRef, useState } from "react";
import { BrandMark, CheckSvg, iconSvg } from "./icons";
import { useApp } from "@/lib/client/store";
import { navigate, useHashRoute } from "@/lib/client/router";
import { Modal, Stars } from "./ui-kit";

export function DemoBar() {
  const { boot, toast } = useApp();
  if (!boot?.site.demoMode) return null;
  return (
    <div className="demo-bar" role="status">
      <div className="container">
        <span className="demo-dot" aria-hidden="true"></span>
        <span>{boot.settings.globalNotice}</span>
        <span className="spacer"></span>
        <a href="#/casella-demo">Casella email demo</a>
      </div>
    </div>
  );
}

function NavDD({ cats }: { cats: { id: string; name: string; shortName: string; hexColor: string; icon: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const close = (ev: MouseEvent) => {
      if (!ref.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <span className={`nav-dd${open ? " open" : ""}`} ref={ref}>
      <button className="navlink" aria-expanded={open} aria-haspopup="true"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        Categorie ▾
      </button>
      <div className="nav-dd-panel" role="menu">
        {cats.map(c => (
          <a key={c.id} href={`#/categoria/${c.id}`} role="menuitem">
            <span className="cat-ico" style={{ background: c.hexColor, color: "#fff", borderRadius: 8, display: "inline-flex", padding: 5 }}>
              {iconSvg(c.icon, 16)}
            </span>
            <span><b>{c.shortName}</b><br /><span className="small muted">{c.name}</span></span>
          </a>
        ))}
      </div>
    </span>
  );
}

function UserMenu() {
  const { user, setUser, refreshBoot, toast } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const close = (ev: MouseEvent) => {
      if (!ref.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  if (!user) return null;
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    await refreshBoot();
    toast("Sessione chiusa.");
    navigate("#/");
  };
  return (
    <span className={`user-menu${open ? " open" : ""}`} ref={ref}>
      <button className="user-menu-btn" aria-expanded={open} aria-haspopup="true"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        {user.hasAvatar ? (
          <span className="avatar avatar-img" aria-hidden="true">
            <img src={`/api/public/avatar/${encodeURIComponent(user.nickname)}`} alt="" />
            <span className="avatar-fallback">{user.nickname.slice(0, 2).toUpperCase()}</span>
          </span>
        ) : (
          <span className="avatar" aria-hidden="true">{user.nickname.slice(0, 2).toUpperCase()}</span>
        )}
        <span>{user.nickname}</span>
      </button>
      <div className="user-menu-panel" role="menu">
        {user.subjectEntityId ? <a href="#/area-soggetto">Area del soggetto verificato</a> : null}
        {user.subjectEntityId ? <a href={`#/scheda/${user.subjectEntityId}`}>La mia scheda pubblica</a> : null}
        <a href="#/profilo">Il mio profilo</a>
        <a href="#/profilo-inviti">Inviti ricevuti</a>
        <a href="#/profilo-impostazioni">Impostazioni e privacy</a>
        <button onClick={logout}>Esci</button>
      </div>
    </span>
  );
}

export function Header() {
  const { boot, user, setUser, refreshBoot, toast } = useApp();
  const route = useHashRoute();
  const [mobileOpen, setMobileOpen] = useState(false);
  const cats = boot?.categories || [];
  const active = (key: string) => (route.segs[0] === key ? " active" : "");
  const siteName = boot?.site.name || "ZoomZoom";
  const nameParts = siteName.includes("Zoom") && siteName === "ZoomZoom"
    ? <>Zoom<b>Zoom</b></> : <>{siteName}</>;
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    await refreshBoot();
    toast("Sessione chiusa.");
    navigate("#/");
  };
  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="#/" aria-label={`${siteName}, home`}>
            <BrandMark size={36} />
            <span className="brand-name">{nameParts}</span>
          </a>
          <nav className="main-nav" aria-label="Navigazione principale">
            <a href="#/cerca" className={active("cerca")}>Cerca</a>
            <a href="#/mappa" className={active("mappa")}>Mappa</a>
            <a href="#/classifiche" className={active("classifiche")}>Classifiche</a>
            <NavDD cats={cats} />
            <a href="#/come-funziona" className={active("come-funziona")}>Come funziona</a>
          </nav>
          <span className="spacer"></span>
          {boot?.site.openReviewsEnabled ? (
            <a className="btn btn-primary btn-sm btn-scrivi" href="#/recensione">Scrivi la tua indagine</a>
          ) : null}
          {user ? (
            <UserMenu />
          ) : (
            <>
              <a className="btn btn-ghost btn-accedi" href="#/accedi">Accedi</a>
              <a className="btn btn-primary" href="#/registrati">Registrati</a>
            </>
          )}
          <button className="burger" aria-label="Apri il menu" aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(o => !o)}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </header>
      <div className={`mobile-nav${mobileOpen ? " open" : ""}`}>
        {boot?.site.openReviewsEnabled ? <a className="mobile-cta" href="#/recensione" onClick={() => setMobileOpen(false)}>Scrivi la tua indagine</a> : null}
        <a href="#/cerca" onClick={() => setMobileOpen(false)}>Cerca</a>
        <a href="#/mappa" onClick={() => setMobileOpen(false)}>Mappa</a>
        <a href="#/classifiche" onClick={() => setMobileOpen(false)}>Classifiche</a>
        <a href="#/come-funziona" onClick={() => setMobileOpen(false)}>Come funziona</a>
        {boot?.site.demoMode ? <a href="#/casella-demo" onClick={() => setMobileOpen(false)}>Casella email demo</a> : null}
        {user ? (
          <>
            <a href="#/profilo" onClick={() => setMobileOpen(false)}>Il mio profilo</a>
            <button className="link" style={{ padding: "9px 6px" }} onClick={logout}>Esci</button>
          </>
        ) : (
          <>
            <a href="#/accedi" onClick={() => setMobileOpen(false)}>Accedi</a>
            <a href="#/registrati" onClick={() => setMobileOpen(false)}>Registrati</a>
          </>
        )}
        <div className="small muted mt2">Categorie</div>
        {cats.map(c => (
          <a key={c.id} href={`#/categoria/${c.id}`} onClick={() => setMobileOpen(false)}>{c.name}</a>
        ))}
      </div>
    </>
  );
}

/* ---------- Cookie: banner e pannello ---------- */
export function CookieBanner() {
  const { consent, saveConsent, openCookiePrefs, setOpenCookiePrefs } = useApp();
  if (consent === null) {
    return (
      <section className="cookie-banner" role="region" aria-label="Preferenze cookie">
        <div className="container">
          <h2>Cookie su ZoomZoom</h2>
          <p>Usiamo <strong>cookie tecnici</strong> (sessione e preferenze), necessari al funzionamento, e — solo con il tuo consenso — <strong>cookie statistici</strong> e <strong>di profilazione pubblicitaria</strong> (Google AdSense). Puoi accettare tutti, rifiutare i non essenziali o personalizzare: la scelta è modificabile in ogni momento dal piè di pagina. Navigare o chiudere questo avviso <strong>non</strong> equivale a consenso.</p>
          <div className="cookie-actions">
            <button className="btn btn-primary" onClick={() => saveConsent({ statistics: false, marketing: false })}>Rifiuta i non essenziali</button>
            <button className="btn btn-ghost" onClick={() => setOpenCookiePrefs(true)}>Personalizza</button>
            <button className="btn btn-ghost" style={{ borderColor: "#fff" }} onClick={() => saveConsent({ statistics: true, marketing: true })}>Accetta tutti</button>
          </div>
        </div>
      </section>
    );
  }
  return <CookiePrefsModal open={openCookiePrefs} onClose={() => setOpenCookiePrefs(false)} />;
}

function CookiePrefsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { consent, saveConsent, toast } = useApp();
  const [stats, setStats] = useState(consent?.statistics ?? false);
  const [mkt, setMkt] = useState(consent?.marketing ?? false);
  if (!open) return null;
  return (
    <Modal label="Preferenze cookie" onClose={onClose}>
      <div className="modal-head">
        <h2>Preferenze cookie</h2>
        <button className="modal-close" onClick={onClose} aria-label="Chiudi">×</button>
      </div>
      <p className="small muted">Puoi modificare le scelte quando vuoi. I cookie tecnici sono indispensabili e non richiedono consenso.</p>
      <div className="consent-row">
        <div>
          <h4>Cookie tecnici</h4>
          <p>Sessione di navigazione, sicurezza e memorizzazione delle preferenze essenziali (inclusa questa scelta). Sempre attivi.</p>
        </div>
        <span className="switch">
          <input type="checkbox" checked disabled aria-label="Cookie tecnici sempre attivi" />
          <span className="track"></span><span className="thumb"></span>
        </span>
      </div>
      <div className="consent-row">
        <div>
          <h4>Cookie statistici</h4>
          <p>Statistiche di uso aggregate e anonime, per capire quali pagine migliorare. Nessun profiling.</p>
        </div>
        <span className="switch">
          <input type="checkbox" checked={stats} onChange={e => setStats(e.target.checked)} aria-label="Cookie statistici" />
          <span className="track"></span><span className="thumb"></span>
        </span>
      </div>
      <div className="consent-row">
        <div>
          <h4>Cookie di profilazione pubblicitaria</h4>
          <p>Necessari per mostrare annunci Google AdSense personalizzati. Se rifiuti, il sito resta pienamente fruibile: la pubblicità, se attiva, non viene caricata.</p>
        </div>
        <span className="switch">
          <input type="checkbox" checked={mkt} onChange={e => setMkt(e.target.checked)} aria-label="Cookie di profilazione pubblicitaria" />
          <span className="track"></span><span className="thumb"></span>
        </span>
      </div>
      <div className="row mt3" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" onClick={() => {
          saveConsent({ statistics: stats, marketing: mkt });
          onClose();
          toast("Preferenze sui cookie salvate. Puoi cambiarle in qualsiasi momento dal piè di pagina.");
        }}>Salva scelte</button>
      </div>
    </Modal>
  );
}

/* ---------- Toasts ---------- */
export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toast-root" role="status" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={`toast ${t.kind === "err" ? "toast-err" : "toast-ok"}`}>{t.msg}</div>)}
    </div>
  );
}

/* ---------- AdSense condizionale ---------- */
declare global {
  interface Window { adsbygoogle?: unknown[] }
}

export function AdSlot({ position }: { position: string }) {
  const { boot, consent } = useApp();
  const loaded = useRef(false);
  useEffect(() => {
    if (!boot?.site.adsEnabled || !consent?.marketing || !boot.site.adsClient || loaded.current) return;
    loaded.current = true;
    if (!document.querySelector("script[data-zz-ads]")) {
      const s = document.createElement("script");
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(boot.site.adsClient)}`;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.setAttribute("data-zz-ads", "1");
      document.head.appendChild(s);
    }
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* adsense non pronto */ }
  }, [boot, consent]);
  if (!boot?.site.adsEnabled) return null;
  if (!consent?.marketing) {
    return (
      <aside className="ad-slot" aria-label="Spazio pubblicitario non attivo" style={{ margin: "18px 0" }}>
        <b>Pubblicità non attivata</b>
        spazio {position}
        <div>La pubblicità è caricata solo dopo consenso esplicito (profilo "Pubblicità" nelle preferenze cookie).</div>
      </aside>
    );
  }
  if (!boot.site.adsClient) return null;
  return (
    <aside className="ad-slot" aria-label="Spazio pubblicitario" style={{ margin: "18px 0" }}>
      <b>Pubblicità · Google AdSense</b>
      <ins className="adsbygoogle" style={{ display: "block" }}
        data-ad-client={boot.site.adsClient}
        data-ad-format="auto" data-full-width-responsive="true"></ins>
      <div className="small">Annuncio chiaramente separato dalle indagini e dalle classifiche: non influenza punteggi, medie né ordine dei risultati.</div>
    </aside>
  );
}

/* ---------- Footer ---------- */
export function Footer() {
  const { boot, setOpenCookiePrefs } = useApp();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-brand">
              <BrandMark size={30} />
              <span className="brand-name">{boot?.site.name || "ZoomZoom"}</span>
            </div>
            <p className="small mt2">Portale indipendente: indagini sugli immobili grazie alla community — su case, zone e servizi della casa. Nessun annuncio, nessuna compravendita, nessuna prenotazione: solo esperienze verificate.</p>
            {boot?.site.demoMode ? (
              <p className="small">Istanza dimostrativa: i contenuti sono dati fittizi e il sito non costituisce consulenza legale.</p>
            ) : null}
          </div>
          <div>
            <h4>Il progetto</h4>
            <a href="#/come-funziona">Come funziona la verifica</a>
            <a href="#/premium">Membership Premium</a>
            <a href="#/abbonamento">Abbonamento</a>
            <a href="#/cerca">Cerca un soggetto</a>
            <a href="#/mappa">Mappa delle reputazioni</a>
            <a href="#/classifiche">Classifiche</a>
          </div>
          <div>
            <h4>Informative</h4>
            <a href="#/privacy">Privacy</a>
            <a href="#/cookie">Cookie</a>
            <a href="#/termini">Termini d&apos;uso</a>
          </div>
          <div>
            <h4>Regole e contatti</h4>
            <a href="#/regole-recensioni">Regole delle recensioni</a>
            <a href="#/moderazione">Moderazione e contestazioni</a>
            <a href="#/contatti">Contatti</a>
            <button onClick={() => setOpenCookiePrefs(true)}>Preferenze cookie</button>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {boot?.site.name || "ZoomZoom"} — nome provvisorio: verificare la disponibilità del marchio prima di qualsiasi uso.</span>
          <span>Fatto per essere accessibile e sobrio.</span>
        </div>
      </div>
    </footer>
  );
}
