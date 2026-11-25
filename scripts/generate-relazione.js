// ZoomZoom — Relazione di analisi e implementazione (DOCX)
// Skill docx: route Create, scena Report (Template A), copertina R2, palette navy/oro.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, SectionType, TableOfContents,
  PageBreak, TableLayoutType,
} = require("docx");
const fs = require("fs");

// ── Palette (brand ZoomZoom: blu notte + oro, mood consulting Warm+Heavy+Calm)
const P = {
  bg: "F6F5F0",            // carta avorio
  primary: "17334F",       // blu notte — titoli
  body: "1E2A36",          // inchiostro — corpo (report con copertina: identità professionale)
  secondary: "53616F",     // grigio — didascalie
  accent: "C9A227",        // oro — linee/accenti
  cover: { titleColor: "17334F", subtitleColor: "4A5A6B", metaColor: "53616F", footerColor: "8B93A0" },
  table: { headerBg: "17334F", headerText: "FFFFFF", accentLine: "17334F", innerLine: "E2DED2", surface: "F0EDE3" },
};

const FONT_H = { ascii: "Arial", eastAsia: "Arial" };        // titoli
const FONT_B = { ascii: "Times New Roman", eastAsia: "Times New Roman" }; // corpo

// ── Bordi
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

// ── calcTitleLayout adattata a testo latino (larghezza media carattere ≈ pt × 11 twips)
function splitTitleLinesLatin(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const words = title.split(" ");
  const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + (cur ? " " : "") + w).length > charsPerLine && cur) { lines.push(cur); cur = w; }
    else cur += (cur ? " " : "") + w;
  }
  if (cur) lines.push(cur);
  // niente orfani: ultima riga con una sola parola corta → fondi con la precedente se possibile
  if (lines.length > 1 && lines[lines.length - 1].length <= 4) {
    const last = lines.pop(); lines[lines.length - 1] += " " + last;
  }
  return lines;
}
function calcTitleLayoutLatin(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 11; // testo latino
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = Math.floor(maxWidthTwips / charWidth(titlePt));
    if (cpl < 4) { titlePt -= 2; continue; }
    lines = splitTitleLinesLatin(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLinesLatin(title, Math.floor(maxWidthTwips / charWidth(minPt))); titlePt = minPt; }
  return { titlePt, titleLines: lines };
}

// ── Copertina R2 (Double-Rule Frame) — adattamento fedele alla ricetta del design system
function buildCoverR2(config) {
  const padL = 1400, padR = 1400;
  const { titlePt, titleLines } = calcTitleLayoutLatin(config.title, 11906 - padL - padR, 40, 24);
  const titleSize = titlePt * 2;
  const thickBorder = { style: BorderStyle.SINGLE, size: 18, color: P.accent, space: 20 };
  const children = [];

  // 1. Fileo superiore
  children.push(new Paragraph({
    indent: { left: padL - 400, right: padR - 400 }, spacing: { before: 1200, after: 200 },
    border: { top: thickBorder }, children: [],
  }));
  // 2. Aria
  children.push(new Paragraph({ spacing: { before: 1800 } }));
  // 3. Etichetta
  if (config.englishLabel) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 500 },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: P.accent, font: { ascii: "Arial" }, characterSpacing: 40 })],
    }));
  }
  // 4. Titolo (dinamico, linee semantiche)
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: i < titleLines.length - 1 ? 80 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: P.cover.titleColor, font: FONT_H })],
    }));
  }
  // 5. Sottotitolo
  if (config.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 400, line: 320, lineRule: "atLeast" },
      indent: { left: 900, right: 900 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.cover.subtitleColor, font: { ascii: "Arial" } })],
    }));
  }
  // 6. Aria
  children.push(new Paragraph({ spacing: { before: 1200 } }));
  // 7. Meta (18pt)
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100, line: Math.ceil(18 * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: line, size: 36, color: P.cover.metaColor, font: { ascii: "Arial" } })],
    }));
  }
  // 8. Aria
  children.push(new Paragraph({ spacing: { before: 2000 } }));
  // 9. Piè + fileo inferiore
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: { left: padL - 400, right: padR - 400 }, spacing: { before: 200 },
    border: { bottom: thickBorder },
    children: [new TextRun({ text: config.footerRight || "", size: 18, color: P.cover.footerColor, font: { ascii: "Arial" } })],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders, children })],
    })],
  })];
}

// ── Componenti corpo
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: P.primary, font: FONT_H })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: P.primary, font: FONT_H })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: opts.after !== undefined ? opts.after : 120 },
    children: [new TextRun({ text, size: 24, color: P.body, font: FONT_B, bold: !!opts.bold, italics: !!opts.italics })],
  });
}
// Paragrafo con porzioni in grassetto: parts = [{t, b}]
function bodyRuns(parts, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: opts.after !== undefined ? opts.after : 120 },
    children: parts.map(p => new TextRun({ text: p.t, bold: !!p.b, italics: !!p.i, size: 24, color: P.body, font: FONT_B })),
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    alignment: AlignmentType.LEFT,
    spacing: { line: 312, after: 60 },
    children: [new TextRun({ text, size: 24, color: P.body, font: FONT_B })],
  });
}
function bulletRuns(parts, level = 0) {
  return new Paragraph({
    bullet: { level },
    alignment: AlignmentType.LEFT,
    spacing: { line: 312, after: 60 },
    children: parts.map(p => new TextRun({ text: p.t, bold: !!p.b, size: 24, color: P.body, font: FONT_B })),
  });
}
function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT, keepNext: true,
    spacing: { before: 160, after: 80, line: 312 },
    children: [new TextRun({ text, bold: true, size: 21, color: P.secondary, font: { ascii: "Arial" } })],
  });
}
function noteAfterTable(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 80, after: 160, line: 312 },
    children: [new TextRun({ text, italics: true, size: 21, color: P.secondary, font: FONT_B })],
  });
}

// Cella standard
function cell(text, o = {}) {
  return new TableCell({
    width: { size: o.w || 50, type: WidthType.PERCENTAGE },
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill } : undefined,
    verticalAlign: "top",
    children: (Array.isArray(text) ? text : [text]).map(t => new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { line: 276 },
      children: [new TextRun({ text: t, bold: !!o.bold, size: o.size || 21, color: o.color || P.body, font: { ascii: o.sans ? "Arial" : "Times New Roman" } })],
    })),
  });
}
// Tabella dati con intestazione
function dataTable(headers, rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((t, i) => cell(t, { w: widths[i], fill: P.table.headerBg, color: P.table.headerText, bold: true, sans: true })),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => cell(t, { w: widths[i], fill: ri % 2 === 1 ? P.table.surface : undefined })),
      })),
    ],
  });
}

// Piè di pagina con numero pagina
function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: { ascii: "Arial" } })],
    })],
  });
}
function docHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 4 } },
      children: [new TextRun({ text: "ZoomZoom — Relazione di analisi e implementazione", size: 18, color: "808080", font: { ascii: "Arial" } })],
    })],
  });
}

// ══════════════════ CONTENUTO ══════════════════
const bodyChildren = [];

// ── 1. Sintesi esecutiva
bodyChildren.push(h1("1. Sintesi esecutiva"));
bodyChildren.push(body(
  "Il presente documento riassume il passaggio dal prototipo statico ZoomZoom (file HTML autonomo fornito in formato PDF) a un portale funzionante di recensioni verificate su immobili, zone e servizi della casa. L'obiettivo non era una riscrittura estetica, ma la trasformazione di ogni regola di dominio — verifica delle esperienze, voto, moderazione, classifiche, privacy — in logica applicativa server-side, eliminando nel contempo le debolezze strutturali del prototipo stesso."
));
bodyChildren.push(body(
  "L'analisi ha prodotto quattro esiti, richiesti prima dello sviluppo: il riepilogo delle funzionalità mantenute, corrette ed escluse (capitolo 2); la definizione di architettura, schema dati e flussi (capitoli 3 e 4); l'elenco delle questioni che richiedono verifica professionale prima del lancio (capitolo 5); la distinzione tra istanza dimostrativa, MVP e requisiti di produzione (capitolo 6). L'implementazione risultante è un'applicazione Next.js 16 con API dedicate, database Prisma/SQLite di 19 tabelle, sessioni separate per area pubblica e back office, autenticazione a due fattori obbligatoria per lo staff e cifratura dei segreti."
));
bodyChildren.push(body(
  "La verifica automatica ha confermato 17 test end-to-end su 17 superati, inclusi il riscatto atomico dei token di invito sotto richieste concorrenti, l'obbligatorietà del secondo fattore per l'accesso amministrativo, la separazione dei permessi tra ruoli e l'assenza di dati sensibili nelle risposte pubbliche. L'istanza corrente è dichiaratamente dimostrativa: tutti i contenuti appartengono alla città fittizia Valserrana, sono marcati come dati fittizi nel database e sono eliminabili dal super amministratore. Le raccomandazioni operative — configurazione di un servizio email reale, fornitura di mappe con licenza verificata, revisione legale delle informative e test di penetrazione esterni — sono raccolte nei capitoli 5 e 7."
));

// ── 2. Perimetro
bodyChildren.push(h1("2. Perimetro: funzionalità mantenute, corrette, escluse"));

bodyChildren.push(h2("2.1 Funzionalità mantenute dal prototipo"));
bodyChildren.push(body(
  "L'identità visiva e la struttura informativa del prototipo sono state conservate integralmente, perché costituivano il punto di forza del progetto: palette blu notte, avorio e oro; titoli in carattere serif; chip di categoria con colori dedicati; badge di esperienza verificata; stelle oro abbinate al punteggio su scala 0–10. Anche l'impianto informativo è rimasto invariato: consultazione pubblica libera senza registrazione, pubblicazione di recensioni riservata agli utenti autenticati con esperienza verificata, avvertenze esplicite sui limiti del modello."
));
bodyChildren.push(bullet("Le sette categorie di recensione — immobili e indirizzi, zone, proprietari, affittuari, amministratori di condominio, agenzie, ditte e professionisti — ciascuna con criteri di valutazione dedicati, ora conservati nel database e modificabili dal back office."));
bodyChildren.push(bullet("Il voto da 0 a 10 con passo configurabile (0,5) e i tre campi prezzo facoltativi (richiesto, offerto, concluso) trattati come dati dichiarati dal recensore e mai aggregati in statistiche."));
bodyChildren.push(bullet("Il modello di verifica a due percorsi: invito con token monouso da parte di un soggetto verificato oppure verifica documentale con caricamento in area privata."));
bodyChildren.push(bullet("Le classifiche con formula ponderata visibile, la mappa interattiva con aggregati per zona, la possibilità di rettificare una recensione entro una finestra temporale e il tracciamento delle rettifiche."));
bodyChildren.push(bullet("Segnalazioni, contestazioni e appelli; casella di posta dimostrativa visibile al solo staff; consenso cookie granulare con blocco preventivo degli strumenti non essenziali."));

bodyChildren.push(h2("2.2 Correzioni: dal prototipo all'architettura server-side"));
bodyChildren.push(body(
  "Il prototipo era un file autonomo in cui ogni regola risiedeva nel browser: questa scelta, legittima per una dimostrazione, non è accettabile in produzione perché qualunque utente può modificare il codice eseguito dal proprio client. La tabella 1 riporta, per ciascun punto debole individuato, la contromisura adottata nell'implementazione reale."
));
bodyChildren.push(caption("Tabella 1 — Correzioni strutturali dal prototipo all'implementazione reale"));
bodyChildren.push(dataTable(
  ["Aspetto nel prototipo (PDF)", "Implementazione reale"],
  [
    ["Tutta la logica in JavaScript nel browser", "Ogni regola di dominio in API route server-side; il client riflette lo stato, non decide"],
    ["localStorage usato come database", "Database Prisma su SQLite; localStorage solo per la preferenza di zona, dato non sensibile"],
    ["Password con hash SHA-1 calcolato dal client", "Funzione di derivazione scrypt con sale per utente e confronto a tempo costante"],
    ["TOTP calcolato nel browser e codice mostrato nella pagina admin", "TOTP server-side (RFC 6238) con segreto cifrato AES-256-GCM; codici temporanei solo via script CLI locale"],
    ["Token di invito conservato in chiaro nel database", "Solo hash SHA-256 del token nel database; il token in chiaro esiste soltanto nel link inviato per email"],
    ["Riscatto dell'invito non atomico", "Transazione condizionale: richieste concorrenti sullo stesso token, una sola va a buon fine"],
    ["Sessioni conservate nel client", "Cookie httpOnly SameSite=Lax; token di sessione salvati come hash; sessioni pubblica (7 giorni) e amministrativa (30 minuti) separate"],
    ["Controllo dei permessi nel client", "Verifica dei permessi server-side su ogni API di back office"],
    ["Caricamento documenti simulato (solo nome file)", "Caricamento reale in area privata: tipi consentiti, limite di dimensione, verifica dei magic byte, download solo per lo staff, cancellazione dopo la decisione"],
    ["Chiavi e credenziali nel front-end", "Nessuna chiave nel client; funzionalità opzionali dichiarate dal server e disattivate se non configurate"],
  ],
  [42, 58]
));
bodyChildren.push(noteAfterTable("Tutte le contromisure sono verificate dai test automatici descritti nel capitolo 7."));

bodyChildren.push(h2("2.3 Esclusioni motivate dal perimetro della versione 1"));
bodyChildren.push(body(
  "Restano escluse, come richiesto in fase di analisi, le funzioni estranee alla missione di un portale indipendente di recensioni: annunci di vendita o affitto, appuntamenti e prenotazioni, messaggistica privata tra utenti, pagamenti e servizi premium, vendita di posizioni nelle classifiche. Il pannello di configurazione del prototipo, che esponeva credenziali nel client, è stato sostituito da impostazioni gestite esclusivamente dal back office. Queste esclusioni non sono limiti temporanei del prototipo: sono scelte di perimetro che proteggono l'indipendenza del servizio e la credibilità delle classifiche, e la loro eventuale estensione andrà valutata con una nuova analisi di impatto."
));

// ── 3. Architettura
bodyChildren.push(h1("3. Architettura, schema dati e ruoli"));

bodyChildren.push(h2("3.1 Architettura applicativa"));
bodyChildren.push(body(
  "L'applicazione è un progetto Next.js 16 in TypeScript con App Router. L'interfaccia pubblica è una single-page application con hash routing servita dalla route unica «/»; tutte le funzioni di dominio sono esposte da API route server-side organizzate per area: endpoint pubblici in sola lettura (bootstrap, ricerca, schede, classifiche, mappa), autenticazione (registrazione, accesso con secondo fattore e codici di recupero, verifica email, cambio password, accesso Google opzionale), area personale (panoramica, esportazione dati, richiesta di cancellazione), gestione delle esperienze e degli inviti, recensioni, segnalazioni, contestazioni, proposte di nuove schede, contatti, consensi e back office."
));
bodyChildren.push(body(
  "Le regole trasversali risiedono in moduli server dedicati: cifratura e hashing (scrypt, SHA-256, AES-256-GCM), TOTP, gestione delle sessioni, limitazione delle richieste per indirizzo IP e azione, invio email con registro diagnostico quando il servizio SMTP non è configurato, log di moderazione e log di sicurezza, impostazioni applicative modificabili a runtime, definizione delle categorie e dei criteri con snapshot di versione, calcolo dei punteggi, validazione dei carichi utili e serializzazione pubblica dei dati. Il frontend non contiene segreti né logica decisionale: riceve dal server anche l'elenco delle funzionalità attive."
));

bodyChildren.push(h2("3.2 Schema dati"));
bodyChildren.push(body(
  "Lo schema Prisma comprende 19 tabelle, riassunte nella tabella 2. Due scelte meritano attenzione: gli snapshot di versione dei criteri, che conservano la definizione dei criteri di valutazione al momento di ogni recensione in modo che le modifiche amministrative successive non alterino i punteggi storici; e il vincolo di unicità sull'esperienza, che rende strutturalmente impossibile pubblicare due recensioni per la stessa esperienza."
));
bodyChildren.push(caption("Tabella 2 — Schema dati: 19 tabelle per gruppo funzionale"));
bodyChildren.push(dataTable(
  ["Gruppo", "Tabelle", "Funzione"],
  [
    ["Utenti e accessi", "User, Session, BackupCode, EmailVerifyToken", "Credenziali con scrypt, secondo fattore, sessioni separate pubblica/amministrativa, codici di recupero, verifica email"],
    ["Categorie e criteri", "Category, Criterion, CategoryVersion", "Sette categorie con criteri dedicati e snapshot di versione per recensione"],
    ["Territorio e schede", "Zone, Entity, EntityProposal", "Zone della città, schede dei soggetti recensibili, proposte dei cittadini"],
    ["Esperienze e inviti", "Experience, Invite", "Esperienze registrate, inviti monouso con solo hash del token nel database"],
    ["Verifiche documentali", "VerificationDoc", "Caricamenti in area privata con retention configurabile e cancellazione dopo decisione"],
    ["Recensioni", "Review", "Voto, criteri con versione, punti di forza e criticità, testo, prezzi dichiarati, stato, rettifiche"],
    ["Moderazione", "Report, ReportDecision, Dispute, DisputeDecision", "Segnalazioni, decisioni motivate, contestazioni e appelli entro 15 giorni"],
    ["Trasversali", "AuditLog, SecurityLog, Setting, Consent, EmailLog, PrivacyRequest, ContactRequest", "Log di moderazione e sicurezza, impostazioni a runtime, consensi cookie, registro email, richieste privacy, contatti"],
  ],
  [22, 34, 44]
));

bodyChildren.push(h2("3.3 Ruoli, permessi e sessioni"));
bodyChildren.push(body(
  "I ruoli sono quattro: utente, moderatore, amministratore e super amministratore. L'utente accede alla consultazione pubblica e può recensire solo se ha un'esperienza verificata. Il moderatore gestisce segnalazioni, recensioni, esperienze e contestazioni, con visibilità limitata ai propri atti nel log. L'amministratore aggiunge la gestione di utenti, schede, inviti, contenuti, impostazioni e sicurezza. Il super amministratore può inoltre modificare i ruoli ed eliminare i dati dimostrativi. Ogni API di back office verifica il permesso richiesto prima di eseguire l'operazione."
));
bodyChildren.push(body(
  "Il secondo fattore è obbligatorio per tutto lo staff: l'accesso amministrativo lo richiede, la promozione a un ruolo di back office viene rifiutata senza un secondo fattore attivo e la sua disattivazione è bloccata per i ruoli interni. Le sessioni amministrative scadono dopo 30 minuti di inattività e sono distinte da quelle pubbliche, che durano 7 giorni: un account dello staff che accede dal sito pubblico non ottiene alcun permesso di back office, e viceversa."
));

// ── 4. Flussi
bodyChildren.push(h1("4. Flussi principali e sicurezza"));

bodyChildren.push(h2("4.1 Invito con token monouso"));
bodyChildren.push(body(
  "Il percorso di verifica principale si articola in passi verificati singolarmente. Primo: un soggetto verificato — un account collegato alla propria scheda, come un'agenzia o un amministratore — registra l'esperienza del cliente e ne cura l'invito. Secondo: il sistema genera un token da 256 bit, ne conserva solo l'hash SHA-256 nel database e lo invia per email come link monouso con scadenza configurabile, vincolato al destinatario e all'esperienza. Terzo: al riscatto, una transazione condizionale aggiorna il token solo se non ancora utilizzato; due richieste concorrenti sullo stesso link producono una sola accettazione. Quarto: la recensione può essere pubblicata una sola volta per esperienza, per vincolo di unicità nel database."
));
bodyChildren.push(bodyRuns([
  { t: "Per contrastare la selezione artificiosa dei destinatari — l'invito solo ai clienti soddisfatti — il soggetto verificato deve dichiarare di aver invitato " },
  { t: "tutti", b: true },
  { t: " i clienti del periodo, ci sono limiti di inviti al giorno per scheda, una soglia oltre la quale è richiesta approvazione e gli inviti sono revocabili. Il back office espone i volumi per soggetto per consentire verifiche periodiche." },
]));

bodyChildren.push(h2("4.2 Verifica documentale"));
bodyChildren.push(body(
  "Chi non può ricevere un invito può chiedere la verifica documentale: caricamento di un documento (PDF o immagine, fino a 8 MB, con controllo dei magic byte oltre all'estensione) in un'area privata non pubblica. Il documento è esaminato dallo staff; l'approvazione collega l'esperienza all'utente e il file viene cancellato entro la retention configurabile. Lo scaricamento è consentito solo al personale autorizzato, e il test automatico verifica il rifiuto per chi non ha i permessi."
));

bodyChildren.push(h2("4.3 Moderazione, contestazioni e appelli"));
bodyChildren.push(body(
  "Le segnalazioni della comunità seguono un percorso a presa in carico e decisione motivata: nessuna rimozione automatica, ogni provvedimento è registrato nel log di moderazione con autore, motivo e contenuto interessato. La sospensione della visibilità di una scheda è sempre un provvedimento motivato. Le decisioni sono appellabili entro 15 giorni. L'associazione tra una scheda e un soggetto reale può essere contestata, e il reclamante ha un canale dedicato."
));

bodyChildren.push(h2("4.4 Classifiche e trasparenza del metodo"));
bodyChildren.push(body(
  "Le classifiche usano la formula dichiarata PC = (n · M + m · C) / (n + m), dove n è il numero di recensioni della scheda, M la loro media, m la soglia minima di recensioni e C la media della categoria. I parametri sono esposti nell'API e nella pagina, insieme all'avvertenza che sotto soglia i dati sono insufficienti: le schede restano consultabili ma non entrano in classifica. Non è possibile confrontare direttamente schede di categorie diverse, perché criteri e medie di riferimento differiscono."
));

bodyChildren.push(h2("4.5 Misure di sicurezza applicativa"));
bodyChildren.push(body(
  "Oltre alle correzioni della tabella 1, l'implementazione applica: limitazione delle richieste per indirizzo IP e azione (registrazione, accesso, riscatto token, pubblicazione recensioni, contatti); blocco progressivo dopo ripetuti accessi falliti; risposte di errore generiche che non rivelano se un indirizzo email è registrato; validazione server-side di ogni carico utile; query parametrizzate attraverso il mapper Prisma; protezione della mutazione dei dati con controlli di origine; log di sicurezza senza segreti (il test automatico verifica l'assenza di password, hash e token nei log). Le variabili di configurazione sensibili risiedono esclusivamente nel ambiente server."
));

bodyChildren.push(h2("4.6 Privacy, mappe e consensi"));
bodyChildren.push(body(
  "La mappa non geolocalizza mai persone fisiche: i punti rappresentano solo schede di immobili e gli aggregati di zona sono soppressi sotto la soglia minima configurabile (tre recensioni). Dalla mappa non è possibile risalire all'autore di una recensione né al momento in cui è stata scritta. I dati dimostrativi di Valserrana sono marcati come fittizi nel database, etichettati nell'interfaccia ed eliminabili in blocco dal super amministratore. Il consenso cookie è granulare: gli strumenti non essenziali — inclusi gli spazi pubblicitari opzionali — restano bloccati fino al consenso esplicito, e l'informativa è raggiungibile da ogni pagina."
));

// ── 5. Verifiche professionali
bodyChildren.push(h1("5. Questioni da verifica professionale pre-lancio"));
bodyChildren.push(body(
  "Il software implementa meccanismi tecnici; la conformità legale e la robustezza operativa richiedono professionisti abilitati. Le seguenti questioni sono state predisposte con segnaposto da compilare dopo la revisione, e nessuna di esse è risolvibile con la sola configurazione dell'applicazione."
));
bodyChildren.push(caption("Tabella 3 — Questioni aperte e figure professionali coinvolte"));
bodyChildren.push(dataTable(
  ["Area", "Questione da verificare", "Professionista"],
  [
    ["Legale e privacy", "Informativa privacy, cookie policy, termini di servizio, regole della moderazione: titolare del trattamento, basi giuridiche, durate di conservazione, giurisdizione; conformità al regolamento sui servizi digitali (DSA) e alla normativa consumatori; etichettatura degli spazi pubblicitari", "Avvocato / consulente privacy"],
    ["Marchio", "Verifica di disponibilità del nome «ZoomZoom» nelle classi pertinenti; il nome è configurabile dal back office in attesa dell'esito", "Consulente di proprietà industriale"],
    ["Mappe reali", "Licenza, attribuzione e termini del fornitore di cartografia; informativa sull'invio di coordinate al provider; l'astrazione è già pronta: l'endpoint della mappa è l'unica sorgente dati", "Consulente IT / legale"],
    ["Retention e backup", "Durate di conservazione dei documenti di verifica e dei log, cifrazione dei backup e prove di ripristino", "Consulente IT / privacy"],
    ["Sicurezza esterna", "Test di penetrazione e revisione del codice da parte di terzi; test di carico prima dell'apertura pubblica", "Specialista sicurezza"],
    ["Incident response", "Procedura di risposta agli incidenti, registro dei responsabili, runbook per sospensioni account e revoca inviti", "Management con consulente IT"],
    ["Anti-selettività", "Verifica periodica dei volumi di inviti per soggetto, disponibile nel back office, per contrastare la selezione dei soli clienti soddisfatti", "Management"],
  ],
  [18, 60, 22]
));
bodyChildren.push(noteAfterTable("I segnaposto 【…】 presenti nelle informative dell'istanza (nome del titolare, contatti, durate) vanno compilati solo dopo la revisione legale."));

// ── 6. Demo / MVP / produzione
bodyChildren.push(h1("6. Livelli: istanza dimostrativa, MVP, produzione"));
bodyChildren.push(body(
  "Il sistema distingue tre livelli operativi, che corrispondono a stati di configurazione e di processo, non a versioni diverse del software. Il livello corrente è quello dimostrativo: tutte le funzioni sono reali, ma l'invio email è disattivato (i messaggi restano nella casella visibile al solo staff), la cartografia è quella schematicità della città fittizia e i contenuti sono dati dimostrativi marcati e rimovibili."
));
bodyChildren.push(caption("Tabella 4 — Livelli operativi e requisiti"));
bodyChildren.push(dataTable(
  ["Livello", "Stato dei requisiti"],
  [
    ["Demo (istanza attuale)", "Modalità dimostrativa attiva; dati di Valserrana interamente fittizi marcati nel database; barra di avviso permanente; casella email demo riservata allo staff; credenziali di test conservate solo in file locale non versionato"],
    ["MVP", "Stessa applicazione con invio email reale (SMTP configurato), modalità dimostrativa disattivata e database senza dati fittizi, HTTPS su tutto il sito con cookie sicuri, backup del database pianificati e provati con ripristino"],
    ["Pre-lancio (produzione)", "Revisione legale delle informative; fornitore di mappe reali con licenza verificata; test di penetrazione esterni superati; procedure di risposta agli incidenti definite; monitoraggio dei log di sicurezza; verifica del marchio completata"],
  ],
  [24, 76]
));
bodyChildren.push(body(
  "Il passaggio da un livello al successivo non richiede modifiche al codice: le variabili d'ambiente e le impostazioni del back office governano l'invio email, la modalità dimostrativa, la pubblicità opzionale e le soglie. Il database SQLite è adeguato al MVP; per carichi maggiori lo schema Prisma è portabile su PostgreSQL senza riscritture."
));

// ── 7. Verifica eseguita e conclusioni
bodyChildren.push(h1("7. Verifica eseguita, limiti dichiarati e conclusioni"));

bodyChildren.push(h2("7.1 Copertura dei test automatici"));
bodyChildren.push(body(
  "La suite end-to-end, eseguita sull'istanza attiva con dati dimostrativi, copre 17 scenari: configurazione pubblica senza dati sensibili; ricerca e classifiche con parametri del metodo esposti; registrazione rifiutata con password debole e accettata con credenziali valide; accesso rifiutato con messaggio generico; canale staff separato dal sito pubblico; utente ordinario escluso dalle API di back office; accesso amministrativo rifiutato senza secondo fattore; permessi distinti tra moderatore e amministratore; inviti limitati alla propria scheda con dichiarazione anti-selezione; riscatto atomico del token sotto richieste concorrenti; una recensione per esperienza anche in concorrenza; carichi utili non validi rifiutati; rettifica tracciata con motivo; moderazione con log e ripristino; assenza di segreti nei log; privacy della mappa; documenti di verifica non scaricabili senza permessi. Esito: 17 superati su 17."
));

bodyChildren.push(h2("7.2 Limiti dichiarati dell'ambiente attuale"));
bodyChildren.push(bullet("Il servizio SMTP non è configurato: le email non partono; i flussi lo dichiarano nell'interfaccia e in demo i messaggi restano nella casella del back office. Nessuna simulazione occulta."));
bodyChildren.push(bullet("L'accesso Google è predisposto ma disattivato: il pulsante non compare e l'endpoint risponde con un errore esplicito finché le credenziali non sono configurate."));
bodyChildren.push(bullet("La mappa usa la cartografia schematica della città fittizia fedele al prototipo, con le regole privacy applicate; l'integrazione di cartografia reale richiede un fornitore con licenza verificata."));
bodyChildren.push(bullet("La scansione antivirus dei caricamenti non è disponibile in questo ambiente: tipi, dimensioni e magic byte sono verificati, la scansione virale resta un requisito pre-lancio."));
bodyChildren.push(bullet("La limitazione delle richieste è in memoria per istanza singola; in configurazioni multi-istanza va spostata su un servizio condiviso."));
bodyChildren.push(bullet("Gli spazi pubblicitari opzionali si attivano solo con consenso marketing, attivazione amministrativa e identificativo cliente configurato; in assenza di una delle tre condizioni nessuno script pubblicitario viene caricato."));

bodyChildren.push(h2("7.3 Conclusioni e raccomandazioni"));
bodyChildren.push(body(
  "Il portale rispetta il perimetro e le correzioni concordate: le funzionalità del prototipo sono conservate, le debolezze strutturali sono state eliminate a livello di architettura e non di cosmesi, e le esclusioni di perimetro sono documentate. La trasparenza — formula delle classifiche esposta, avvertenze sui dati insufficienti, limiti dichiarati — è trattata come requisito di prodotto, non come corredo di testi."
));
bodyChildren.push(body(
  "Le azioni raccomandate, in ordine: attivare un servizio SMTP reale e verificare l'intero percorso di invito end-to-end; avviare la revisione legale delle informative compilando i segnaposto predisposti; selezionare il fornitore di cartografia e integrarlo nell'endpoint già isolato; commissionare il test di penetrazione esterno; definire la procedura di risposta agli incidenti con i responsabili; verificare la disponibilità del marchio prima di qualsiasi uso pubblico del nome. Con queste condizioni soddisfatte, il sistema è pronto a passare dal livello dimostrativo al MVP."
));

// ══════════════════ DOCUMENTO ══════════════════
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  creator: "ZoomZoom",
  title: "ZoomZoom: dal prototipo al portale reale — Relazione di analisi e implementazione",
  styles: {
    default: {
      document: {
        run: { font: FONT_B, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT_H, size: 32, bold: true, color: P.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 312 } },
      },
      heading2: {
        run: { font: FONT_H, size: 28, bold: true, color: P.primary },
        paragraph: { spacing: { before: 240, after: 120, line: 312 } },
      },
      heading3: {
        run: { font: FONT_H, size: 24, bold: true, color: P.primary },
        paragraph: { spacing: { before: 200, after: 100, line: 312 } },
      },
    },
  },
  sections: [
    // Sezione 1: copertina — margini 0, nessun numero pagina
    {
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR2({
        englishLabel: "RELAZIONE TECNICA",
        title: "ZoomZoom: dal prototipo al portale reale",
        subtitle: "Recensioni verificate su case, zone e servizi della casa — funzionalità, architettura, flussi e requisiti pre-lancio",
        metaLines: [
          "Documento: relazione tecnica di accompagnamento",
          "Versione 1.0 — 17 novembre 2026",
          "Istanza di riferimento: dimostrativa (dati fittizi)",
        ],
        footerRight: "ZoomZoom — portale indipendente di recensioni verificate",
      }),
    },
    // Sezione 2: indice — numeri romani
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: docHeader() },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "Indice", bold: true, size: 32, color: P.primary, font: FONT_H })],
        }),
        new TableOfContents("Indice", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Nota: l'indice è generato tramite campi. Dopo eventuali modifiche, fare clic con il tasto destro sull'indice e scegliere «Aggiorna campo» per aggiornare i numeri di pagina.",
            italics: true, size: 18, color: "888888", font: FONT_B,
          })],
        }),
        // Niente PageBreak finale: la sezione successiva è già NEXT_PAGE (evita pagina vuota)
      ],
    },
    // Sezione 3: corpo — numeri arabi da 1
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: docHeader() },
      footers: { default: pageFooter() },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/ZoomZoom_Relazione_analisi_implementazione.docx", buf);
  console.log("DOCX generato:", buf.length, "byte");
});
