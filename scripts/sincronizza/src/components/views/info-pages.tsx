"use client";
// ZoomZoom — pagine informative: come funziona, privacy, cookie, termini,
// regole recensioni, moderazione, contatti. Bozze con segnaposto espliciti
// da verificare con professionisti prima del lancio.
import { useEffect, useState } from "react";
import { useApp } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Alert, Crumbs, LegalNote } from "../ui-kit";
import { api as apiCall } from "@/lib/client/api";

function LegalShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <>
      <Crumbs items={[{ label: "Home", href: "#/" }, { label: "Informative e regole" }, { label: title }]} />
      <div className="container"><div className="legal-body">
        <div className="section-head" style={{ paddingTop: 22 }}>
          <div>
            <h1>{title}</h1>
            {sub ? <p className="sub">{sub}</p> : null}
          </div>
        </div>
        <LegalNote />
        {children}
      </div></div>
    </>
  );
}

export function HowItWorksView() {
  const { boot } = useApp();
  const s = boot?.settings;
  return (
    <>
      <Crumbs items={[{ label: "Home", href: "#/" }, { label: "Come funziona" }]} />
      <div className="container"><div className="legal-body">
        <div className="section-head" style={{ paddingTop: 22 }}>
          <div>
            <h1>Come funziona la verifica</h1>
            <p className="sub">Un metodo trasparente, con i suoi limiti dichiarati.</p>
          </div>
        </div>
        <Alert kind="ok">
          <b>In sintesi.</b> Su ZoomZoom può pubblicare una recensione solo un utente autenticato che ha ricevuto un <b>invito email</b> collegato a un&apos;esperienza registrata sulla piattaforma, oppure ha ottenuto una <b>verifica documentale</b>. Il badge &quot;esperienza verificata&quot; attesta l&apos;esistenza dell&apos;invito o dell&apos;interazione registrata: <b>non garantisce che ogni affermazione sia oggettivamente vera</b>.
        </Alert>
        <h2>Le tre fasi</h2>
        <h3>1. L&apos;esperienza viene registrata</h3>
        <p>Un&apos;esperienza (per esempio un contratto d&apos;affitto, una pratica seguita da un&apos;agenzia, un intervento di manutenzione) entra nella piattaforma in due modi:</p>
        <ul>
          <li><b>Soggetto verificato</b> (agenzia, amministratore, ditta con account verificato) registra l&apos;interazione e invita il cliente a recensirla, con limiti giornalieri e obbligo dichiarato di invitare <em>tutti</em> i clienti dell&apos;interazione, non solo i soddisfatti;</li>
          <li><b>Verifica documentale</b>: l&apos;utente carica un documento che dimostri l&apos;esperienza (contratto, fattura, delibera…); un moderatore valuta la richiesta e, se sufficiente, abilita la recensione.</li>
        </ul>
        <Alert kind="warn">
          <b>Limite dichiarato.</b> Non possiamo escludere in assoluto selezioni vantaggiose da parte dei soggetti che invitano, né la creazione di account multipli: l&apos;email verificata, i limiti di frequenza, i controlli anti-bot e la moderazione riducono il rischio ma non sono una garanzia di unicità. Segnalazioni e controlli diminuiscono il rischio residuo.
        </Alert>
        <h3>2. L&apos;invito è un token sicuro</h3>
        <p>L&apos;invito email contiene un collegamento con un token casuale a <b>uso singolo</b>, con <b>scadenza</b> ({s?.inviteExpiryDays ?? 7} giorni), collegato all&apos;indirizzo email del destinatario. I token sono conservati solo come hash: nemmeno gli amministratori li riutilizzano. Ogni uso, scadenza o tentativo non valido viene registrato tra gli eventi di sicurezza. Gli inviti in massa sono impediti da limiti di frequenza e da una soglia oltre la quale serve approvazione della moderazione.</p>
        <h3>3. Una recensione per esperienza</h3>
        <p>Ogni utente può scrivere <b>una sola recensione per esperienza</b>, e il riscatto dell&apos;invito è una transazione atomica sul server. La recensione è aggiornabile con una rettifica motivata entro {s?.rettificaDays ?? 30} giorni; dopo, occorre rivolgersi alla moderazione, che valuta le richieste di correzione con tracciatura delle decisioni.</p>
        <h2>Cosa contiene una recensione</h2>
        <p>Punteggio complessivo da 0 a 10 (step 0,5) mostrato con stelle e valore numerico; punteggi per i criteri <b>specifici della categoria</b> (le domande per un immobile riguardano manutenzione e rumori, quelle per un&apos;agenzia trasparenza e gestione della pratica: non vengono riusate tra categorie); punti di forza; criticità; dove pertinente, il <b>prezzo richiesto, proposto o concluso</b> (dato dichiarato dal recensore: non viene verificato, ed è sempre mostrato come tale); descrizione dell&apos;esperienza; dichiarazione di veridicità dell&apos;esperienza personale e di assenza di dati personali di terzi.</p>
        <h2>Classifiche: il metodo</h2>
        <p>Le classifiche ordinano le schede per <code>PC = (n · M + m · C) / (n + m)</code>, dove M è la media della scheda, n il numero di recensioni, C la media della categoria e m la soglia minima (m = {s?.minReviews ?? 3}). Con poche recensioni il punteggio resta vicino alla media della categoria: una singola valutazione massima non conquista il primo posto. Le schede sotto soglia restano consultabili ma sono segnalate come &quot;dati insufficienti&quot;. I punteggi di categorie diverse non sono direttamente confrontabili.</p>
        <h2>Cosa non facciamo</h2>
        <ul>
          <li>Nessun annuncio di immobili in vendita o affitto;</li>
          <li>Nessun appuntamento, prenotazione o messaggistica tra utenti;</li>
          <li>Nessun servizio a pagamento: la <a href="#/premium">Membership Premium</a> non si compra, si guadagna contribuendo con recensioni verificate;</li>
          <li>Nessuna vendita di posizioni: la pubblicità, quando attiva, non influenza punteggi, medie né ordine dei risultati.</li>
        </ul>
        <h2>Modera, segnala, contesta</h2>
        <p>Ogni recensione ha un pulsante &quot;Segnala&quot; (per utenti autenticati) e ogni scheda permette di contestare l&apos;associazione a una persona o attività. Il flusso completo — stati, tempi, decisioni, appello — è descritto nella pagina <a href="#/moderazione">Moderazione e contestazioni</a>.</p>
        <h2>Sicurezza e privacy: impostazione onesta</h2>
        <p>L&apos;area amministrativa è separata dal sito pubblico, richiede autenticazione con 2FA obbligatoria e registra ogni azione in un log riservato. Le password sono conservate solo come hash con algoritmo adatto (scrypt con sale per utente). I dati dei recensori (email, identità) non vengono mai mostrati pubblicamente: le recensioni mostrano solo lo pseudonimo scelto. Tutte le regole di accesso sono applicate dal server, con protezioni CSRF/XSS/injection, rate limiting e backup dichiarati nella documentazione operativa. Nessun sistema è immune da attacchi: documentiamo le misure adottate e le verifiche ancora necessarie.</p>
      </div></div>
    </>
  );
}

export function PrivacyView() {
  return (
    <LegalShell title="Privacy policy (bozza)" sub="Cosa raccogliamo, perché, per quanto tempo">
      <h2>1. Titolare del trattamento</h2>
      <p>【Da definire — società o persona fisica che gestirà il servizio, con recapiti completi, PEC e riferimenti del rappresentante】.</p>
      <h2>2. Quali dati raccogliamo (minimizzazione)</h2>
      <ul>
        <li><b>Account</b>: indirizzo email (verificato), pseudonimo pubblico, hash della password (scrypt con sale), impostazioni (incluso il segreto 2FA cifrato). Nessun cognome o identità legale è richiesto per recensire.</li>
        <li><b>Esperienze e recensioni</b>: il contenuto che pubblichi; il documento caricato per la verifica è accessibile solo alla moderazione, con tempi di conservazione limitati e cancellazione dopo la decisione (conservazione dell&apos;esito, non del documento).</li>
        <li><b>Interazioni tecniche</b>: eventi di sicurezza e di moderazione (tipo di evento, orario) per prevenire abusi — con accesso limitato ai ruoli autorizzati.</li>
        <li><b>Preferenze</b>: consenso cookie e zona di riferimento sulla mappa (preferenza tecnica del browser, non associata all&apos;account).</li>
      </ul>
      <h2>3. Base giuridica e finalità</h2>
      <p>【Da verificare con il professionista: contratto per l&apos;erogazione del servizio; legittimo interesse per sicurezza e prevenzione abusi; consenso per statistiche e pubblicità; obblighi legali per conservazione】.</p>
      <h2>4. Conservazione</h2>
      <p>【Durate da definire]: account finché attivo; documenti di verifica cancellati dopo la decisione (impostazione configurabile); log di sicurezza 【durata da definire]; backup 【cifratura e durata da definire].</p>
      <h2>5. Comunicazione a terzi</h2>
      <p>Il servizio non vende dati. Possono ricevere dati, con le garanzie del caso: fornitore email per l&apos;invio (【fornitore e base giuridica da indicare]); Google AdSense solo dopo consenso per la profilazione; 【eventuale fornitore di mappe reali, con informativa sull&apos;invio di coordinate].</p>
      <h2>6. Diritti dell&apos;interessato</h2>
      <p>Puoi esercitare accesso, rettifica, cancellazione, opposizione e portabilità dal modulo <a href="#/contatti">contatti</a> (voce &quot;Richiesta privacy&quot;) o da <a href="#/profilo-impostazioni">Impostazioni e privacy</a>. L&apos;esportazione dei dati è disponibile in autonomia, in formato leggibile.</p>
      <h2>7. Reclami</h2>
      <p>Puoi rivolgerti al Garante per la protezione dei dati personali (www.garanteprivacy.it). 【Verificare la formulazione con il professionista].</p>
    </LegalShell>
  );
}

export function CookieView() {
  return (
    <LegalShell title="Cookie policy (bozza)" sub="Cosa installiamo, come chiediamo il consenso, come lo revochi">
      <h2>Quali cookie usiamo</h2>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">Categoria</th><th scope="col">Uso</th><th scope="col">Serve consenso?</th></tr></thead>
          <tbody>
            <tr><td><b>Tecnici</b></td><td>Sessione, sicurezza, preferenze essenziali (incluso il ricordo di questa scelta sui cookie e della zona di riferimento sulla mappa).</td><td>No, sono necessari.</td></tr>
            <tr><td><b>Statistici</b></td><td>Statistiche aggregate di utilizzo per migliorare il servizio.</td><td>Sì, facoltativo.</td></tr>
            <tr><td><b>Profilazione pubblicitaria</b></td><td>Google AdSense, per mostrare annunci pertinenti (quando la pubblicità è attiva).</td><td>Sì, facoltativo.</td></tr>
          </tbody>
        </table>
      </div>
      <h2>Come si manifesta il consenso</h2>
      <p>Al primo arrivo mostriamo un avviso con tre opzioni equivalenti: <b>accetta tutti</b>, <b>rifiuta i non essenziali</b>, <b>personalizza</b>. Scorrire la pagina, navigare o chiudere l&apos;avviso <b>non</b> costituisce consenso: i cookie non essenziali restano spenti finché non scegli. La scelta è revocabile o modificabile in ogni momento dal collegamento &quot;Preferenze cookie&quot; nel piè di pagina, con effetto immediato. Ogni scelta viene registrata con data e ora.</p>
      <h2>Disattivazione della pubblicità</h2>
      <p>La piattaforma può funzionare interamente senza pubblicità: l&apos;integrazione AdSense è opzionale e comandata da un&apos;apposita impostazione dell&apos;area amministrativa. Quando attiva, il componente pubblicitario viene caricato solo dopo il consenso; gli annunci sono etichettati e tenuti separati da recensioni, risultati e classifiche, e non ne influenzano l&apos;ordine.</p>
      <h2>Gestione dai browser</h2>
      <p>Puoi inoltre bloccare o eliminare i cookie dalle impostazioni del browser. Il blocco dei cookie tecnici può compromettere l&apos;accesso e il salvataggio delle preferenze.</p>
    </LegalShell>
  );
}

export function TermsView() {
  return (
    <LegalShell title="Termini d'uso (bozza)" sub="Le regole per usare il servizio">
      <h2>1. Oggetto</h2>
      <p>ZoomZoom (nome provvisorio) è un portale indipendente di <b>recensioni verificate</b> su immobili, zone, proprietari, affittuari, amministratori di condominio, agenzie e ditte/professionisti del settore. <b>Non</b> è un portale di compravendita o affitto: non pubblica annunci, non gestisce appuntamenti, prenotazioni o messaggistica e non offre servizi a pagamento in questa versione.</p>
      <h2>2. Account</h2>
      <p>La registrazione richiede la verifica dell&apos;indirizzo email; sono disponibili l&apos;accesso con credenziali proprie e, se configurato dall&apos;amministrazione, Google OAuth, oltre all&apos;autenticazione a due fattori (TOTP), consigliata a tutti e obbligatoria per lo staff. Sei responsabile della veridicità dei dati forniti e della riservatezza delle tue credenziali. L&apos;email verificata attesta il possesso dell&apos;indirizzo, non l&apos;unicità della persona.</p>
      <h2>3. Condotta vietata</h2>
      <ul>
        <li>pubblicare contenuti che non derivano da un&apos;esperienza diretta verificata;</li>
        <li>inserire dati personali di terzi senza autorizzazione (nomi completi, telefoni, indirizzi privati);</li>
        <li>insulti, minacce, diffamazione, discriminazione, incitamento all&apos;odio;</li>
        <li>falsità manifeste, spam, finalità promozionali o concorrenza sleale;</li>
        <li>tentativi di manipolare punteggi o classifiche, inclusi account multipli;</li>
        <li>violare diritti di terzi, incluso il diritto d&apos;autore.</li>
      </ul>
      <h2>4. Contenuti degli utenti</h2>
      <p>Resti titolare delle tue recensioni: concedi alla piattaforma una licenza non esclusiva, gratuita e mondiale per pubblicarle nel servizio (e rimuoverle su richiesta o per decisione di moderazione). Le opinioni espresse dagli utenti non riflettono la posizione della piattaforma.</p>
      <h2>5. Moderazione</h2>
      <p>Le segnalazioni e le contestazioni seguono il procedimento descritto nella pagina <a href="#/moderazione">Moderazione</a>: nessuna rimozione automatica al semplice arrivo di una contestazione, decisioni tracciate, appello possibile.</p>
      <h2>6. Limitazioni di responsabilità</h2>
      <p>Il servizio è offerto &quot;così com&apos;è&quot;: la piattaforma non garantisce l&apos;accuratezza delle opinioni degli utenti e non fornisce consulenza legale, fiscale o tecnica. 【In questa istanza i contenuti possono essere dati dimostrativi fittizi].</p>
      <h2>7. Legge applicabile</h2>
      <p>【Da definirsi con la revisione legale; l&apos;impostazione prevista è la legge italiana, con foro da stabilire].</p>
    </LegalShell>
  );
}

export function ReviewRulesView() {
  const { boot } = useApp();
  return (
    <LegalShell title="Regole delle recensioni" sub="Cosa può entrare in una recensione e cosa no">
      <h2>Chi può recensire</h2>
      <p>Solo utenti autenticati con un&apos;<b>esperienza registrata</b> sulla piattaforma: o hai ricevuto un invito email collegato a un&apos;interazione, o la tua esperienza è stata verificata documentalmente dalla moderazione. Il badge &quot;esperienza verificata&quot; indica esattamente questo — l&apos;esistenza dell&apos;esperienza — non la veridicità di ogni affermazione.</p>
      <h2>Le regole in dieci punti</h2>
      <ol>
        <li>Racconta solo <b>esperienze dirette</b>, verificate con il metodo della piattaforma.</li>
        <li><b>Una recensione per esperienza</b>: la stessa esperienza non si vota due volte.</li>
        <li>Niente <b>dati personali di terzi</b>: senza nomi completi, telefoni, email, indirizzi privati o documenti.</li>
        <li>Niente insulti, minacce, discriminazione o linguaggio d&apos;odio.</li>
        <li>Niente contenuti promozionali o denigratori pilotati da interessi: dichiara i conflitti d&apos;interesse.</li>
        <li>Attieniti ai fatti che puoi aver vissuto; distingui chiaramente le opinioni.</li>
        <li>Non usare la recensione per ricatti, richieste o trattative.</li>
        <li>Aggiorna con la <b>rettifica motivata</b> se i fatti cambiano (entro {boot?.settings.rettificaDays ?? 30} giorni in autonomia; dopo, via moderazione).</li>
        <li>Puoi chiedere la cancellazione della tua recensione in ogni momento.</li>
        <li>Le violazioni comportano la rimozione del contenuto e, nei casi gravi o ripetuti, la sospensione dell&apos;account, sempre con decisione tracciata e appello possibile.</li>
      </ol>
      <h2>Cosa valutano le recensioni</h2>
      <p>Ogni categoria ha criteri propri (da 0 a 10): per esempio un immobile viene valutato su manutenzione, corrispondenza con la descrizione e qualità degli spazi; un&apos;agenzia su comunicazione, trasparenza dei costi e gestione della pratica. Il punteggio complessivo — da 0 a 10, con stelle — resta la tua sintesi dell&apos;esperienza. I prezzi sono facoltativi, distinti per natura (richiesto, proposto, concluso) e unità, e sono sempre mostrati come dichiarati, non verificati.</p>
    </LegalShell>
  );
}

export function ModerationView() {
  return (
    <LegalShell title="Moderazione e contestazioni" sub="Come decidiamo, con quali tempi e garanzie">
      <h2>Il flusso di una segnalazione</h2>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">Stato</th><th scope="col">Significato</th><th scope="col">Tempi indicativi</th></tr></thead>
          <tbody>
            <tr><td><b>Ricevuta</b></td><td>La segnalazione è in coda: nessuna azione automatica sulla recensione.</td><td>—</td></tr>
            <tr><td><b>In valutazione</b></td><td>Un moderatore legge e raccoglie eventuali elementi.</td><td>entro 3 giorni</td></tr>
            <tr><td><b>Decisa</b></td><td>Decisione motivata: nessuna azione, oscuramento parziale, o nascondimento con motivo registrato.</td><td>entro 7 giorni</td></tr>
            <tr><td><b>Appello</b></td><td>Autore o segnalatore può chiedere la revisione.</td><td>entro 15 giorni dalla decisione</td></tr>
            <tr><td><b>Chiusa</b></td><td>Esito definitivo con motivazione registrata nel log riservato.</td><td>—</td></tr>
          </tbody>
        </table>
      </div>
      <h2>Regole di contenuto</h2>
      <p>Le segnalazioni verificate portano all&apos;azione su: minacce e insulti; dati personali pubblicati senza autorizzazione; contenuti discriminatori; falsità manifeste; spam e finalità promozionali; recensioni prive di esperienza pertinente.</p>
      <h2>Cosa non facciamo</h2>
      <p><b>Nessuna cancellazione automatica</b> per il solo arrivo di una contestazione: ogni decisione passa da una valutazione umana, viene registrata in un <b>registro di moderazione accessibile solo ai ruoli autorizzati</b>, e resta aperto il diritto di appello. Gli autori ricevono comunicazione con il motivo. Le contestazioni sull&apos;associazione di una scheda a una persona seguono lo stesso procedimento; quando necessario per sicurezza o tutela, la visibilità di una scheda può essere sospesa temporaneamente come provvedimento motivato e tracciato.</p>
      <h2>Trasparenza verso il pubblico</h2>
      <p>Quando una recensione è nascosta, la scheda mostra che è avvenuta un&apos;azione di moderazione (senza esporre i contenuti illeciti). Le statistiche aggregate escludono i contenuti nascosti.</p>
    </LegalShell>
  );
}

export function ContactsView() {
  const { user, toast, boot } = useApp();
  const [email, setEmail] = useState(user?.email || "");
  const [kind, setKind] = useState("generic");
  const [msg, setMsg] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Crumbs items={[{ label: "Home", href: "#/" }, { label: "Contatti" }]} />
      <div className="container">
        <div className="grid grid-2" style={{ gap: 26, paddingTop: 22 }}>
          <div>
            <h1 style={{ marginTop: 0 }}>Contatti e richieste</h1>
            <p className="sub">Per richieste di accesso, rettifica o cancellazione dei dati, per contestazioni sull&apos;associazione di una scheda o per segnalazioni che richiedono un contatto diretto.</p>
            <div className="card">
              <form onSubmit={async e => {
                e.preventDefault();
                setBusy(true);
                const res = await apiCall("/api/contact", { body: { email, kind, message: msg, hp } });
                setBusy(false);
                if (res.ok) {
                  e.currentTarget.reset();
                  setMsg(""); setHp("");
                  toast("Richiesta inviata. Se riguarda i tuoi dati, la troverai tracciata nell'area riservata.");
                } else toast(res.error, "err");
              }}>
                <div className="field">
                  <label htmlFor="ct-kind">Tipo di richiesta</label>
                  <select id="ct-kind" required value={kind} onChange={e => setKind(e.target.value)}>
                    <option value="generic">Domanda generica</option>
                    <option value="privacy">Richiesta privacy (accesso, rettifica, cancellazione)</option>
                    <option value="association">Contestazione associazione a persona/attività</option>
                    <option value="content">Segnalazione contenuti (non urgente)</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ct-email">Email di contatto</label>
                  <input id="ct-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@esempio.it" />
                  <span className="hint">Non viene pubblicata. Per le richieste useremo questo recapito.</span>
                </div>
                <div className="field">
                  <label htmlFor="ct-msg">Messaggio</label>
                  <textarea id="ct-msg" required minLength={30} value={msg} onChange={e => setMsg(e.target.value)} placeholder="Descrivi la richiesta (almeno 30 caratteri)."></textarea>
                </div>
                <div className="hp-field"><label htmlFor="ct-hp">Non compilare</label><input id="ct-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)} /></div>
                <button className="btn btn-primary" type="submit" disabled={busy}>Invia richiesta</button>
              </form>
            </div>
          </div>
          <div>
            <h2>Risposte e tempi</h2>
            <p>Le richieste privacy ricevono risposta entro i termini previsti dalla normativa applicabile (indicativamente 30 giorni). Le contestazioni seguono il <a href="#/moderazione">procedimento di moderazione</a>.</p>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Altri canali (da attivare in produzione)</h3>
              <ul className="mb0">
                <li>【privacy@…】 — richieste relative ai dati personali</li>
                <li>【moderazione@…】 — segnalazioni urgenti su contenuti</li>
                <li>【PEC del titolare】 — da definire con la revisione legale</li>
              </ul>
            </div>
            {boot?.site.demoMode ? (
              <Alert kind="info">In questa istanza demo l&apos;invio email non è configurato: le richieste vengono registrate e le email simulate restano nella casella visibile dal back office.</Alert>
            ) : boot?.site.emailDelivery === "disabled" ? (
              <Alert kind="warn">L&apos;invio email non è configurato su questo server: le richieste vengono registrate ma senza notifica via email.</Alert>
            ) : null}
            <Alert kind="info"><b>Attenzione.</b> ZoomZoom non fornisce consulenza legale: per questioni giuridiche rivolgiti a un professionista abilitato.</Alert>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Casella email demo (solo DEMO_MODE) ---------- */
export function MailboxView() {
  const { boot } = useApp();
  const [emails, setEmails] = useState<Array<{ id: string; to: string; subject: string; body: string; links: { label: string; href: string }[]; status: string; at: string; isDemo: boolean }> | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    void api<{ emails: typeof emails }>("/api/admin/data/casella-demo").then(res => {
      if (res.ok) setEmails(res.emails);
      else setEmails([]);
    });
  }, []);
  if (!boot?.site.demoMode) {
    return <div className="container section"><h1>Pagina non trovata</h1><p><a href="#/">Torna alla home</a>.</p></div>;
  }
  const list = (emails || []).filter(m => !filter || m.to === filter);
  const addrs = Array.from(new Set((emails || []).map(m => m.to))).sort();
  return (
    <>
      <Crumbs items={[{ label: "Home", href: "#/" }, { label: "Casella email demo" }]} />
      <div className="container" style={{ paddingTop: 22, paddingBottom: 30 }}>
        <div className="section-head">
          <div>
            <h1 style={{ margin: 0 }}>Casella email dimostrativa</h1>
            <p className="sub">Simula la posta in arrivo dei flussi (verifiche, inviti) di questa istanza demo. In produzione i messaggi partono davvero via SMTP: qui restano registrati per provare i collegamenti. Accesso riservato allo staff.</p>
          </div>
          <label className="small" htmlFor="mb-filter" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            Destinatario
            <select id="mb-filter" style={{ width: "auto" }} value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="">Tutti</option>
              {addrs.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        {emails === null ? <p className="muted">Caricamento… (richiede accesso staff)</p> : list.length ? list.slice(0, 40).map(m => (
          <div className="mail-item" key={m.id}>
            <div className="mail-head">
              <span><b>A: </b>{m.to}</span>
              <span>{new Date(m.at).toLocaleString("it-IT")} · stato: {m.status}{m.isDemo ? " · dato fittizio" : ""}</span>
            </div>
            <div className="mail-body">
              <h3 style={{ margin: "0 0 6px" }}>{m.subject}</h3>
              <p>{m.body}</p>
              {(m.links || []).map((l, i) => <a className="mail-link" key={i} href={l.href}>{l.label}</a>)}
            </div>
          </div>
        )) : <Alert kind="info">Nessun messaggio{filter ? " per questo destinatario" : ""} (la casella richiede l&apos;accesso staff: vedi la documentazione demo).</Alert>}
      </div>
    </>
  );
}

export function PremiumView() {
  const { boot, user } = useApp();
  const s = boot?.settings;
  const days = s?.premiumDaysPerReview ?? 30;
  return (
    <>
      <Crumbs items={[{ label: "Home", href: "#/" }, { label: "Membership Premium" }]} />
      <div className="container"><div className="legal-body">
        <div className="section-head" style={{ paddingTop: 22 }}>
          <div>
            <h1>Membership Premium</h1>
            <p className="sub">Le recensioni integrali si leggono contribuendo: il Premium non si compra, si guadagna.</p>
          </div>
        </div>
        <Alert kind="ok">
          <b>In sintesi.</b> Le medie, i punteggi per criterio, i conteggi e le classifiche restano <b>pubblici per tutti</b>. Con il Premium leggi il testo integrale delle recensioni (punti di forza, criticità, descrizioni, prezzi dichiarati) di tutte le schede. Il Premium si attiva pubblicando una recensione verificata: <b>+{days} giorni per contributo</b>, accumulabili.
        </Alert>
        <h2>Come si ottiene</h2>
        <ol>
          <li>Registra e verifica la tua esperienza su una scheda (<a href="#/verifica-esperienza">verifica diretta</a> oppure invito email ricevuto dal soggetto);</li>
          <li>Pubblica la recensione: dalla pubblicazione hai {days} giorni di Premium;</li>
          <li>Ogni altro contributo verificato somma giorni, entro un tetto massimo di accumulo.</li>
        </ol>
        <p>Lo staff può anche concedere o revocare il Premium con motivazione registrata (per esempio per collaborazione, o come provvedimento). Lo stato e lo storico delle concessioni sono visibili nel <a href="#/profilo">tuo profilo</a> e inclusi nell&apos;<a href="#/profilo-impostazioni">esportazione dei tuoi dati</a>.</p>
        {user?.premium?.active ? (
          <Alert kind="ok"><b>Il tuo Premium è attivo</b>{user.premium.until ? ` fino al ${new Date(user.premium.until).toLocaleDateString("it-IT")}` : ""}. Grazie per il tuo contributo.</Alert>
        ) : null}
        <h2>Perché un incentivo (e i suoi rischi, detti chiari)</h2>
        <p>Legare un vantaggio alla scrittura di una recensione spinge a contribuire, ma crea anche un rischio evidente: qualcuno potrebbe scrivere recensioni superficiali o inventate solo per ottenere il vantaggio. Non fingiamo che il problema non esista: dichiariamo le contromisure e i loro limiti.</p>
        <h2>Cosa rende la frode difficile qui</h2>
        <ul>
          <li><b>Nessuna recensione anonima improvvisata.</b> A differenza di chi accetta recensioni da chiunque e le esamina solo dopo, su ZoomZoom la recensione richiede un&apos;<b>esperienza verificata a monte</b>: un invito email a uso singolo dal soggetto (con limiti giornalieri) o una verifica documentale valutata dalla moderazione. Scrivere una recensione falsa richiede prima un invito o un documento falsificato: reato, oltre che violazione dei <a href="#/termini">termini</a>;</li>
          <li><b>Una recensione per esperienza.</b> Il vincolo è atomico sul database: richieste ripetute o concorrenti non aggirano il limite;</li>
          <li><b>Revoca immediata del vantaggio.</b> Se la moderazione nasconde una recensione per frode o contenuti illeciti, i giorni di Premium ottenuti con quel contributo vengono <b>revocati automaticamente</b> e la scadenza ricalcolata; nei casi gravi l&apos;account viene sospeso, con l&apos;impossibilità di continuare a interagire;</li>
          <li><b>Nessun premio per il voto.</b> I giorni si ottengono per il contributo, non per il punteggio assegnato: scrivere 10 o 2 non cambia il vantaggio;</li>
          <li><b>Tetto di accumulo.</b> La scadenza non supera mai il massimo configurato: anche una lunga serie di contributi sospetti non costruisce un vantaggio illimitato;</li>
          <li><b>Tracciatura.</b> Ogni concessione e revoca è registrata nel log di moderazione con motivazione.</li>
        </ul>
        <h2>Limiti dichiarati</h2>
        <p>Un account duplicato (email diverse, stessa persona) potrebbe teoricamente accumulare più concessioni: come per ogni piattaforma, non possiamo escluderlo in assoluto. Gli inviti sono legati all&apos;email del cliente reale e i documenti sono esaminati da un moderatore, quindi ogni recensione fraudolenta ha un costo e lascia tracce; chiunque ne individui una può <a href="#/moderazione">segnalarla</a>. La verifica documentale è un controllo umano, non una prova giudiziaria: dichiariamo riduzione del rischio, non certezza assoluta.</p>
        <h2>Privacy</h2>
        <p>Il Premium è uno stato del tuo account, non un pagamento: non raccogliamo dati di fatturazione né numeri di telefono. Le tue concessioni compaiono nella tua area personale, sono incluse nell&apos;esportazione dei dati e vengono eliminate con l&apos;account (diritto all&apos;oblio). Il gating è applicato dal server: al browser non arrivano i testi riservati, quindi non esistono scorciatoie lato client per leggerli.</p>
      </div></div>
    </>
  );
}

export function NotFoundView() {
  return (
    <div className="container section">
      <h1>Pagina non trovata</h1>
      <p>Il collegamento non corrisponde a nessuna pagina. <a href="#/">Torna alla home</a>.</p>
    </div>
  );
}
