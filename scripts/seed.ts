// ZoomZoom — seed dei dati dimostrativi (città italiane reali, contenuti fittizi).
// Le zone corrispondono a città reali con coordinate GPS reali, per una mappa
// fedele al territorio italiano; TUTTI i contenuti restano fittizi e isDemo=true.
// Il seed è idempotente: ricrea da zero solo i dati demo, senza toccare dati "reali".
// Uso: bun scripts/seed.ts
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "crypto";
import { scryptSync } from "crypto";
import sharp from "sharp";

const db = new PrismaClient();

// Password degli account demo: visibile SOLO qui e nel README, mai nel front-end.
// Il dominio esempio.test è riservato (RFC 6761): non sono credenziali reali.
const DEMO_PW = "ZoomZoom-Demo-2026";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$16384$8$1$${salt}$${hash}`;
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/* RNG deterministico per dati fittizi riproducibili */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rndPick = <T>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)];
const rndInt = (r: () => number, a: number, b: number) => a + Math.floor(r() * (b - a + 1));

// Città reali distribuite su tutto il territorio italiano (coordinate WGS84
// dei centri storici). Coprono Nord-Ovest, Nord-Est, Centro, Sud e Isole.
const ZONES = [
  { id: "torino", name: "Torino", lat: 45.0703, lng: 7.6869, radius: 4000 },
  { id: "milano", name: "Milano", lat: 45.4642, lng: 9.1900, radius: 4000 },
  { id: "genova", name: "Genova", lat: 44.4056, lng: 8.9463, radius: 3000 },
  { id: "venezia", name: "Venezia", lat: 45.4408, lng: 12.3155, radius: 3000 },
  { id: "bologna", name: "Bologna", lat: 44.4949, lng: 11.3426, radius: 3000 },
  { id: "firenze", name: "Firenze", lat: 43.7696, lng: 11.2558, radius: 3000 },
  { id: "roma", name: "Roma", lat: 41.9028, lng: 12.4964, radius: 5000 },
  { id: "napoli", name: "Napoli", lat: 40.8518, lng: 14.2681, radius: 4000 },
  { id: "bari", name: "Bari", lat: 41.1171, lng: 16.8719, radius: 3000 },
  { id: "reggio-calabria", name: "Reggio Calabria", lat: 38.1113, lng: 15.6470, radius: 3000 },
  { id: "palermo", name: "Palermo", lat: 38.1157, lng: 13.3615, radius: 4000 },
  { id: "cagliari", name: "Cagliari", lat: 39.2238, lng: 9.1217, radius: 3000 },
];

// Tipi di esperienza e unità prezzo (copia locale delle costanti applicative,
// per mantenere lo script di seed autonomo e rapido)
const EXP_KINDS: Record<string, string[]> = {
  immobile: ["Abitazione in affitto", "Abitazione di proprietà", "Soggiorno prolungato", "Visita e sopralluogo"],
  zona: ["Residenza attuale (oltre 6 mesi)", "Residenza precedente", "Lavoro o studio quotidiano nella zona"],
  proprietario: ["Contratto di affitto in corso", "Contratto di affitto cessato", "Interazioni da richiedente"],
  affittuario: ["Affitto del mio immobile", "Affitto cessato di recente", "Interazione da coobbligato/garante"],
  amministratore: ["Condominio in cui abito", "Condominio di proprietà affittata", "Assemblea e gestione economica"],
  agenzia: ["Servizio di intermediazione ricevuto", "Valutazione o consulenza su un immobile", "Assistenza dopo il servizio"],
  ditta: ["Intervento di manutenzione", "Lavori e lavori o ristrutturazione", "Perizia o consulenza tecnica", "Impianti e installazioni"],
};

const DEMO_TEXTS: Record<string, { pros: string[]; cons: string[]; bodies: string[] }> = {
  immobile: {
    pros: ["Spazi ben distribuiti e luminosi", "Impianti recenti e a norma", "Ottimo isolamento acustico", "Parti comuni curate", "Spese di riscaldamento contenute", "Servizi e trasporti a pochi passi", "Nessuna infiltrazione né umidità"],
    cons: ["Umidità in bagno e in cucina", "Infissi da sostituire", "Rumori frequenti dal piano superiore", "Portoncino d'ingresso spesso guasto", "Aria condizionata assente", "Scala buia e poco pulita", "Manutenzioni richieste e rinviate"],
    bodies: [
      "Ho vissuto qui per due anni: la descrizione ricevuta corrispondeva in gran parte alla realtà, con qualche eccezione sullo stato dell'impianto elettrico. Nel complesso una convivenza tranquilla.",
      "L'appartamento è ampio e ben esposto, la zona è silenziosa. La manutenzione straordinaria del tetto è stata gestita con tempi accettabili e spese ripartite correttamente.",
      "La casa corrisponde alle fotografie, ma l'edificio soffre di scarsa insonorizzazione: si sente tutto dai vicini. Da valutare con attenzione se si lavora da casa.",
      "Esperienza discreta: nessun problema strutturale, ma piccole manutenzioni rimandate a lungo e una caldaia che ha richiesto più interventi in inverno.",
    ],
  },
  zona: {
    pros: ["Tutti i servizi a pochi passi", "Bus frequenti e fermata vicina", "Mercato e negozi di quartiere", "Vicino al parco e alla pista ciclabile", "Zona silenziosa la sera", "Scuole e asili presenti"],
    cons: ["Poco verde nelle vicinanze", "Parcheggio difficile", "Illuminazione pubblica insufficiente", "Traffico nelle ore di punta", "Pochi esercizi aperti la domenica", "Rumori nei weekend"],
    bodies: [
      "Abito in questa zona da cinque anni: i servizi essenziali ci sono tutti e il quartiere è comodo anche senza automobile.",
      "Zona ben collegata al centro, con un buon rapporto tra costi e qualità della vita. Il punto debole è il parcheggio, quasi impossibile la sera.",
      "Ho vissuto qui durante gli studi: trasporti comodi e vita tranquilla in giornata, con qualche episodio di rumore il sabato sera.",
      "Quartiere in evoluzione: sono arrivati nuovi esercizi e si respira un clima migliore rispetto a qualche anno fa.",
    ],
  },
  proprietario: {
    pros: ["Sempre disponibile per le manutenzioni", "Contratto chiaro, senza clausole ambigue", "Deposito restituito integralmente e nei tempi", "Risponde entro poche ore", "Rispetta la privacy dell'inquilino", "Nessun aumento a sorpresa"],
    cons: ["Manutenzioni richieste e mai eseguite", "Difficile da contattare, risponde dopo settimane", "Trattenute ingiustificate sul deposito", "Visite senza preavviso", "Clausole contrattuali poco chiare", "Aumenti non discussi"],
    bodies: [
      "Il rapporto è stato professionale: richieste di intervento gestite in tempi ragionevoli e massima correttezza alla chiusura del contratto.",
      "Persona corretta nelle scadenze, ma molto lenta nella gestione delle richieste di manutenzione: un guasto è stato risolto dopo settimane.",
      "Esperienza negativa: più solleciti per una perdita in bagno risolti solo dopo mesi, con discussioni sul deposito alla fine del rapporto.",
      "Proprietario serio e trasparente: contratto registrato correttamente e nessuna pressazione durante tutto il periodo di affitto.",
    ],
  },
  affittuario: {
    pros: ["Pagamenti sempre puntuali", "Immobile restituito in ottimo stato", "Comunica subito ogni problema", "Rispettoso dei vicini e del condominio", "Documenti sempre in regola"],
    cons: ["Ritardi ripetuti nei pagamenti", "Immobile restituito in stato trascurato", "Comunicazioni incomplete o in ritardo", "Lamentele frequenti dai vicini", "Documentazione consegnata in ritardo"],
    bodies: [
      "Il periodo di affitto è proceduto senza intoppi: canone sempre puntuale e ottima cura degli spazi, restituiti impeccabili.",
      "Inquilino corretto nel complesso, con qualche ritardo nei pagamenti sempre comunicato in anticipo e giustificato.",
      "Esperienza difficile: pagamenti irregolari e segnalazioni dei vicini per rumori notturni ripetuti.",
    ],
  },
  amministratore: {
    pros: ["Conti chiari e preventivati", "Comunicazioni puntuali", "Manutenzioni programmate", "Assemblee gestite con equilibrio", "Interventi urgenti in poche ore"],
    cons: ["Conti consegnati in forte ritardo", "Risponde solo dopo molti solleciti", "Manutenzioni ordinarie trascurate", "Assemblee convocate all'ultimo", "Preventivi poco dettagliati"],
    bodies: [
      "Il nostro condominio è seguito da anni: bilanci trasparenti, interventi tempestivi e fornitori selezionati con criterio.",
      "Amministrazione nel complesso adeguata, ma la comunicazione con i condomini può migliorare molto: circolari tardive e risposte generiche.",
      "Esperienza altalenante: buono il rapporto con i fornitori, pessima la tempistica dei documenti di fine anno, arrivati a fine marzo.",
    ],
  },
  agenzia: {
    pros: ["Personale preparato e paziente", "Costi dichiarati fin dall'inizio", "Pratica gestita senza intoppi", "Informazioni veritiere sull'immobile", "Disponibili anche dopo la conclusione"],
    cons: ["Costi aggiuntivi emersi solo alla fine", "Informazioni parziali sui difetti dell'immobile", "Risposte lente alle richieste", "Cambio di referente a metà pratica", "Pressioni per decidere in fretta"],
    bodies: [
      "Mi sono affidato a loro per la vendita del mio appartamento: pratica seguita con cura e costi chiari dal primo incontro.",
      "Servizio corretto ma lento: la pratica si è conclusa con settimane di ritardo rispetto alle previsioni comunicate.",
      "Esperienza deludente: alcune criticità dell'immobile sono emerse solo dopo la firma dell'incarico, con costi finali diversi dal preventivo.",
    ],
  },
  ditta: {
    pros: ["Lavoro eseguito con cura e pulizia", "Tempi rispettati in pieno", "Preventivo chiaro e confermato", "Personale cortese e professionale", "Garanzia offerta senza discussioni"],
    cons: ["Lavoro ripassato più volte per difetti", "Ritardo di settimane sulla consegna", "Costi finali oltre il preventivo", "Cantiere lasciato sporco", "Assistenza post-intervento difficile da raggiungere"],
    bodies: [
      "Ho commissionato una ristrutturazione del bagno: risultato ottimo, area lasciata pulita e tempi rispettati.",
      "Intervento di manutenzione puntuale e ben eseguito, con un piccolo extra giustificato e concordato prima di procedere.",
      "Lavoro nel complesso buono, ma i tempi sono slittati di due settimane senza avvisi tempestivi.",
      "Perizia consegnata completa e nei termini, con spiegazioni chiare sui limiti della valutazione.",
    ],
  },
};

const PRICE_HINTS: Record<string, [number, number, string]> = {
  ent_i_rondini: [620, 1180, "€/mese"], ent_i_girasole: [580, 950, "€/mese"], ent_i_tigli8: [700, 1100, "€/mese"],
  ent_i_dazio: [480, 800, "€/mese"], ent_i_fiume: [720, 1200, "€/mese"], ent_i_ciliegio: [285000, 335000, "€ totale"],
  ent_p_gm: [620, 1100, "€/mese"], ent_p_lb: [700, 1200, "€/mese"], ent_p_rt: [650, 1050, "€/mese"],
  ent_am_sereni: [900, 1700, "€/anno"], ent_am_ferretti: [700, 1400, "€/anno"], ent_am_gcv: [800, 1600, "€/anno"],
  ent_ag_portico: [2500, 6000, "€ totale"], ent_ag_casanova: [2000, 5000, "€ totale"], ent_ag_chiavi: [2200, 5500, "€ totale"],
  ent_d_valli: [9000, 15000, "€ totale"], ent_d_pezzoli: [300, 600, "€ totale"], ent_d_fiamma: [250, 700, "€ totale"], ent_d_grillo: [400, 900, "€ totale"],
};

const TARGETS: Array<[string, number, number]> = [
  ["ent_i_rondini", 5, 7.8], ["ent_i_girasole", 3, 6.4], ["ent_i_tigli8", 4, 8.2],
  ["ent_i_dazio", 2, 5.5], ["ent_i_fiume", 3, 8.6], ["ent_i_ciliegio", 1, 9.0],
  ["ent_z_milano", 12, 7.9], ["ent_z_roma", 11, 7.1], ["ent_z_napoli", 9, 6.3],
  ["ent_z_torino", 8, 7.5], ["ent_z_bologna", 7, 6.8], ["ent_z_palermo", 6, 5.9],
  ["ent_z_firenze", 5, 8.1], ["ent_z_venezia", 4, 7.2], ["ent_z_bari", 4, 6.5],
  ["ent_z_genova", 3, 5.6], ["ent_z_cagliari", 2, 7.0],
  ["ent_p_gm", 4, 8.3], ["ent_p_lb", 2, 4.5], ["ent_p_rt", 3, 6.0],
  ["ent_a_mc", 2, 8.5], ["ent_a_sd", 1, 5.0],
  ["ent_am_sereni", 9, 8.7], ["ent_am_ferretti", 4, 5.2], ["ent_am_gcv", 3, 6.8],
  ["ent_ag_portico", 11, 7.4], ["ent_ag_casanova", 5, 6.1], ["ent_ag_chiavi", 2, 3.8],
  ["ent_d_valli", 6, 8.8], ["ent_d_pezzoli", 3, 7.0], ["ent_d_fiamma", 4, 6.3], ["ent_d_grillo", 2, 8.0],
];

const UPDATE_REASONS = ["Ho corretto un dettaglio dopo la pubblicazione.", "Aggiornamento dopo l'intervento di manutenzione promesso.", "Precisazione sui tempi di risposta."];

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

async function main() {
  console.log("Seed dati demo ZoomZoom (città italiane reali, contenuti tutti fittizi)…");
  const t0 = Date.now();

  // 0) Categorie (se assenti) — replica ensureCategoriesSeeded senza dipendenze
  const CAT_SEED: Array<{ id: string; name: string; shortName: string; description: string; hexColor: string; icon: string; isPerson: boolean; isMapped: boolean; criteria: Array<{ key: string; label: string }> }> = [
    { id: "immobile", name: "Immobili e indirizzi", shortName: "Immobili", description: "Appartamenti, case e singoli indirizzi: stato reale, gestione e vivibilità, raccontati da chi ci ha vissuto.", hexColor: "#33658A", icon: "immobile", isPerson: false, isMapped: true, criteria: [
      { key: "stato", label: "Stato di manutenzione" }, { key: "descrizione", label: "Corrispondenza con la descrizione ricevuta" }, { key: "spazi", label: "Qualità degli spazi e luce naturale" }, { key: "rumori", label: "Rumori e rapporti di vicinato" }, { key: "impianti", label: "Impianti, riscaldamento ed efficienza" }, { key: "rapporto", label: "Rapporto qualità-prezzo" }] },
    { id: "zona", name: "Zone e aree geografiche", shortName: "Zone", description: "Città e zone del territorio italiano: servizi, trasporti, sicurezza percepita e qualità della vita quotidiana.", hexColor: "#4E7D5B", icon: "zona", isPerson: false, isMapped: true, criteria: [
      { key: "servizi", label: "Servizi alla persona e vivibilità" }, { key: "trasporti", label: "Trasporti e mobilità" }, { key: "sicurezza", label: "Sicurezza percepita" }, { key: "verde", label: "Verde, aria e ambiente" }, { key: "costi", label: "Costi della vita nella zona" }] },
    { id: "proprietario", name: "Proprietari", shortName: "Proprietari", description: "Il rapporto con chi affitta o gestisce un immobile: contratto, trasparenza, manutenzione e rispetto.", hexColor: "#6E5E93", icon: "proprietario", isPerson: true, isMapped: false, criteria: [
      { key: "contratto", label: "Chiarezza del contratto e trasparenza" }, { key: "risposta", label: "Disponibilità e tempi di risposta" }, { key: "manutenzione", label: "Gestione di guasti e manutenzione" }, { key: "deposito", label: "Correttezza sul deposito cauzionale" }, { key: "privacy", label: "Rispetto della privacy e degli spazi" }, { key: "rapporto", label: "Rapporto qualità-prezzo" }] },
    { id: "affittuario", name: "Affittuari", shortName: "Affittuari", description: "Il rapporto con chi vive in un immobile in affitto: pagamenti, cura degli spazi e comunicazione.", hexColor: "#8B4E67", icon: "affittuario", isPerson: true, isMapped: false, criteria: [
      { key: "pagamenti", label: "Puntualità e correttezza dei pagamenti" }, { key: "cura", label: "Cura e pulizia dell'immobile" }, { key: "comunicazione", label: "Comunicazione e segnalazione dei problemi" }, { key: "regole", label: "Rispetto di regole del condominio e dei vicini" }, { key: "documenti", label: "Correttezza documentale e comunicazioni obbligatorie" }] },
    { id: "amministratore", name: "Amministratori di condominio", shortName: "Amministratori", description: "Gestione dei condomini: conti, trasparenza, parti comuni, assemblee e tempestività degli interventi.", hexColor: "#27696F", icon: "amministratore", isPerson: false, isMapped: false, criteria: [
      { key: "conti", label: "Gestione economica e trasparenza dei conti" }, { key: "comunicazione", label: "Comunicazione con i condomini" }, { key: "comuni", label: "Manutenzione delle parti comuni" }, { key: "assemblee", label: "Convocazione e conduzione delle assemblee" }, { key: "competenza", label: "Tempestività e competenza tecnica" }, { key: "rapporto", label: "Rapporto qualità-prezzo (compenso)" }] },
    { id: "agenzia", name: "Agenzie immobiliari", shortName: "Agenzie", description: "Il servizio delle agenzie: comunicazione, trasparenza sui costi, gestione della pratica e onestà delle informazioni.", hexColor: "#83661F", icon: "agenzia", isPerson: false, isMapped: false, criteria: [
      { key: "comunicazione", label: "Comunicazione e professionalità del personale" }, { key: "trasparenza", label: "Trasparenza su costi e condizioni" }, { key: "pratica", label: "Gestione della pratica e degli adempimenti" }, { key: "onestà", label: "Onestà delle informazioni fornite" }, { key: "supporto", label: "Supporto durante e dopo il servizio" }, { key: "rapporto", label: "Rapporto qualità-prezzo (compenso)" }] },
    { id: "ditta", name: "Ditte e professionisti della casa", shortName: "Ditte e professionisti", description: "Imprese, artigiani e tecnici che operano su immobili e condomini: qualità, tempi, preventivi e garanzie.", hexColor: "#A65B3F", icon: "ditta", isPerson: false, isMapped: false, criteria: [
      { key: "qualita", label: "Qualità del lavoro e seguito" }, { key: "tempi", label: "Rispetto di tempi e impegni" }, { key: "preventivo", label: "Chiarezza e rispetto del preventivo" }, { key: "professionalita", label: "Professionalità del personale" }, { key: "assistenza", label: "Assistenza e garanzia post-intervento" }] },
  ];
  if (await db.category.count() === 0) {
    for (let i = 0; i < CAT_SEED.length; i++) {
      const c = CAT_SEED[i];
      await db.category.create({
        data: {
          id: c.id, name: c.name, shortName: c.shortName, description: c.description,
          hexColor: c.hexColor, icon: c.icon, isPerson: c.isPerson, isMapped: c.isMapped,
          orderIndex: i, isActive: true, isDemo: true,
          criteria: { create: c.criteria.map((cr, j) => ({ key: cr.key, label: cr.label, orderIndex: j })) },
        },
      });
    }
    console.log("Categorie create:", CAT_SEED.length);
  }

  // 1) Pulizia dei soli dati demo (idempotente)
  const demoUsers = await db.user.findMany({ where: { isDemo: true }, select: { id: true } });
  const demoUserIds = demoUsers.map(u => u.id);
  if (demoUserIds.length) {
    await db.auditLog.deleteMany({ where: { actorId: { in: demoUserIds } } });
    await db.consent.deleteMany({ where: { userId: { in: demoUserIds } } });
    await db.privacyRequest.deleteMany({ where: { userId: { in: demoUserIds } } });
    await db.session.deleteMany({ where: { userId: { in: demoUserIds } } });
    await db.backupCode.deleteMany({ where: { userId: { in: demoUserIds } } });
    await db.emailVerifyToken.deleteMany({ where: { userId: { in: demoUserIds } } });
  }
  // 2) contenuti demo (le recensioni seguono a cascata da esperienze e schede)
  await db.entityProposal.deleteMany({ where: { isDemo: true } });
  // foto e voti delle recensioni demo (il resto va a cascata con entità e utenti)
  await db.reviewPhoto.deleteMany({ where: { isDemo: true } });
  await db.reviewVote.deleteMany({ where: { review: { isDemo: true } } });
  await db.entity.deleteMany({ where: { isDemo: true } });
  await db.experience.deleteMany({ where: { isDemo: true } });
  await db.invite.deleteMany({ where: { isDemo: true } });
  await db.report.deleteMany({ where: { isDemo: true } });
  await db.dispute.deleteMany({ where: { isDemo: true } });
  await db.emailLog.deleteMany({ where: { isDemo: true } });
  await db.zone.deleteMany({ where: { isDemo: true } });
  // concessioni Premium dei demo (verrebbero comunque rimosse a cascata con l'utente)
  await db.premiumGrant.deleteMany({ where: { user: { isDemo: true } } });
  // 3) infine gli utenti demo
  if (demoUserIds.length) {
    await db.user.deleteMany({ where: { id: { in: demoUserIds } } });
  }

  // 2) Zone: città reali (coordinate vere, contenuti dimostrativi)
  for (const z of ZONES) {
    await db.zone.create({ data: { id: z.id, name: z.name, gpsLat: z.lat, gpsLng: z.lng, radiusM: z.radius, isDemo: true } });
  }
  // la descrizione della categoria "zona" viene allineata alla copertura nazionale
  await db.category.update({ where: { id: "zona" }, data: { description: "Città e zone del territorio italiano: servizi, trasporti, sicurezza percepita e qualità della vita quotidiana." } });

  // 3) Utenti demo (staff con TOTP; credenziali salvate in demo-credentials.json, mai nel front-end)
  const credentials: Record<string, { password: string; totpSecret?: string }> = {};
  async function mkUser(email: string, nickname: string, role: string, opts: { subject?: string; totp?: string } = {}) {
    const u = await db.user.create({
      data: {
        email, nickname, role, emailVerified: true,
        passwordHash: hashPassword(DEMO_PW),
        subjectEntityId: opts.subject || null,
        totpSecretEnc: opts.totp ? encryptSecretStatic(opts.totp) : null,
        totpEnabled: !!opts.totp,
        createdAt: new Date(daysAgoIso(rndInt(r, 60, 700))),
        isDemo: true,
      },
    });
    credentials[email] = { password: DEMO_PW, ...(opts.totp ? { totpSecret: opts.totp } : {}) };
    return u;
  }
  const r = mulberry32(0x41424954);
  // TOTP segreti demo generati in modo deterministico (visibili solo nel file credenziali)
  const totpA = base32(randomBytesStatic(r, 20));
  const totpB = base32(randomBytesStatic(r, 20));
  const totpC = base32(randomBytesStatic(r, 20));

  const uArianna = await mkUser("utente@esempio.test", "Arianna_84", "user", {});
  const uAgenzia = await mkUser("agenzia@esempio.test", "Il Portico Immobiliare", "user", { subject: "ent_ag_portico" });
  await mkUser("moderatore@esempio.test", "Ufficio Moderazione", "moderator", { totp: totpA });
  await mkUser("admin@esempio.test", "Amministrazione ZoomZoom", "admin", { totp: totpB });
  await mkUser("superadmin@esempio.test", "Super Amministrazione", "superadmin", { totp: totpC });

  const NICKS = ["MarcoT_79","GiuliaF","Luca_e_Sara","CasaPerDue","GeometraCurioso","MartaB","FerroVie","NuovaCasa2026","AnnaPaola","DavideG88","SoleQuarto","TreFiglie","Camilla_R","VivoInQuartiere","PaoloM1962","LeGiare","Roberta_C","DueBambini","AbitoInCentro","SergioETania","PrimaCasa","MicolF"];
  const reviewers = [];
  for (let i = 0; i < NICKS.length; i++) {
    reviewers.push(await mkUser(`recensione${i + 1}@esempio.test`, NICKS[i], "user", {}));
  }
  const uMarco = reviewers[0];

  // 4) Snapshot criteri per recensioni demo
  const cats = await db.category.findMany({ include: { criteria: { orderBy: { orderIndex: "asc" }, where: { active: true } } } });
  const versionByCat = new Map<string, string>();
  for (const c of cats) {
    const snap = JSON.stringify(c.criteria.map(cr => ({ key: cr.key, label: cr.label })));
    const v = await db.categoryVersion.create({
      data: { categoryId: c.id, version: 1, criteriaSnapshot: snap, priceUnitsJson: "[]" },
    });
    versionByCat.set(c.id, v.id);
  }
  console.log("Zone e categorie pronte.", Date.now() - t0, "ms");

  // 5) Entità (id fissi per coerenza con i PRICE_HINTS)
  async function mkEnt(id: string, catId: string, name: string, subtitle: string, zoneId: string, opts: { address?: string; geo?: { lat: number; lng: number }; initials?: boolean; business?: boolean; owner?: string } = {}) {
    return db.entity.create({
      data: {
        id, categoryId: catId, name, subtitle, zoneId,
        address: opts.address || null,
        geoLat: opts.geo ? opts.geo.lat : null, geoLng: opts.geo ? opts.geo.lng : null,
        initialsOnly: !!opts.initials, verifiedBusiness: !!opts.business,
        ownerUserId: opts.owner || null,
        status: "published", proposedBy: "seed",
        createdAt: new Date(daysAgoIso(rndInt(r, 100, 800))), isDemo: true,
      },
    });
  }
  for (const z of ZONES) {
    await mkEnt("ent_z_" + z.id, "zona", z.name, "Città reale — contenuti dimostrativi", z.id);
  }
  await mkEnt("ent_i_rondini", "immobile", "Palazzo delle Rondini", "Edificio residenziale", "milano", { address: "Via del Filatoio 14, Milano", geo: { lat: 45.4658, lng: 9.1880 } });
  await mkEnt("ent_i_girasole", "immobile", "Casa Girasole", "Appartamento", "roma", { address: "Vicolo dei Beccai 3, Roma", geo: { lat: 41.8953, lng: 12.4832 } });
  await mkEnt("ent_i_tigli8", "immobile", "Residenza I Tigli 8", "Condominio residenziale", "torino", { address: "Viale dei Tigli 8, Torino", geo: { lat: 45.0677, lng: 7.6834 } });
  await mkEnt("ent_i_dazio", "immobile", "Casa del Dazio", "Appartamento", "napoli", { address: "Piazza del Dazio 2, Napoli", geo: { lat: 40.8530, lng: 14.2652 } });
  await mkEnt("ent_i_fiume", "immobile", "Casa sul Fiume", "Appartamento con vista", "bologna", { address: "Lungofiume Altino 21, Bologna", geo: { lat: 44.4931, lng: 11.3390 } });
  await mkEnt("ent_i_ciliegio", "immobile", "Villa Ciliegio", "Villa unifamiliare", "firenze", { address: "Via dei Ciliegi 45, Firenze", geo: { lat: 43.7702, lng: 11.2570 } });
  await mkEnt("ent_p_gm", "proprietario", "G. M.", "Proprietario di immobili in affitto — Milano", "milano", { initials: true });
  await mkEnt("ent_p_lb", "proprietario", "L. B.", "Proprietario di immobili in affitto — Bologna", "bologna", { initials: true });
  await mkEnt("ent_p_rt", "proprietario", "R. T.", "Proprietario di immobili in affitto — Torino", "torino", { initials: true });
  await mkEnt("ent_a_mc", "affittuario", "M. C.", "Affittuario — Milano", "milano", { initials: true });
  await mkEnt("ent_a_sd", "affittuario", "S. D.", "Affittuario — Napoli", "napoli", { initials: true });
  await mkEnt("ent_am_sereni", "amministratore", "Condomini Sereni", "Studio di amministrazione condominiale", "milano", { address: "Via del Filatoio 30, Milano" });
  await mkEnt("ent_am_ferretti", "amministratore", "Studio Ferretti Condomini", "Amministrazione condominiale", "napoli", { address: "Piazza della Stazione 8, Napoli" });
  await mkEnt("ent_am_gcv", "amministratore", "Gestioni Condominiali Due Torri", "Amministrazione condominiale", "bologna", { address: "Via degli Orti 12, Bologna" });
  await mkEnt("ent_ag_portico", "agenzia", "Il Portico Immobiliare", "Agenzia di intermediazione (account verificato)", "milano", { address: "Piazza del Mercato 4, Milano", business: true, owner: uAgenzia.id });
  await mkEnt("ent_ag_casanova", "agenzia", "Casa Nova Studio Immobiliare", "Agenzia di intermediazione", "torino", { address: "Viale dei Tigli 22, Torino" });
  await mkEnt("ent_ag_chiavi", "agenzia", "Le Chiavi Bianche", "Agenzia di intermediazione", "napoli", { address: "Via della Croce 7, Napoli" });
  await mkEnt("ent_d_valli", "ditta", "Impresa Edile Fratelli Valli", "Lavori edili e ristrutturazioni", "bologna", { address: "Via dei Mugnai 9, Bologna" });
  await mkEnt("ent_d_pezzoli", "ditta", "Geom. Pezzoli — Perizie e catasto", "Professionista tecnico", "milano", { address: "Via del Filatoio 2, Milano" });
  await mkEnt("ent_d_fiamma", "ditta", "Fiamma Blu Impianti", "Impianti idraulici e termici", "torino", { address: "Via dei Platani 18, Torino" });
  await mkEnt("ent_d_grillo", "ditta", "Il Grillo — Traslochi e piccoli lavori", "Traslochi e manutenzione leggera", "napoli", { address: "Via Aldo Moro 3, Napoli" });

  // 6) Recensioni generate (fittizie, marcate)
  const entCat = new Map((await db.entity.findMany({ select: { id: true, categoryId: true } })).map(e => [e.id, e.categoryId]));
  const roundHalf = (v: number) => Math.round(v * 2) / 2;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  function shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const reviewIdsByEntity = new Map<string, string[]>();
  let expSeq = 0, revSeq = 0;
  for (let ti = 0; ti < TARGETS.length; ti++) {
    const [entId, count, target] = TARGETS[ti];
    const catId = entCat.get(entId)!;
    const cat = cats.find(c => c.id === catId)!;
    const texts = DEMO_TEXTS[catId];
    let pool = shuffle(reviewers);
    if (entId === "ent_ag_portico") pool = [uMarco, ...pool.filter(u => u.id !== uMarco.id)].slice(0, Math.max(count, 22));
    if (entId === "ent_z_milano" || entId === "ent_d_valli") pool = [uArianna, ...pool.filter(u => u.id !== uArianna.id)].slice(0, Math.max(count, 22));
    for (let i = 0; i < count; i++) {
      const author = pool[i % pool.length];
      const daysAgo = rndInt(r, 5, 560);
      expSeq++;
      const exp = await db.experience.create({
        data: {
          entityId: entId, kind: rndPick(r, EXP_KINDS[catId] || ["Esperienza diretta"]),
          period: String(2024 + rndInt(r, 0, 2)),
          origin: entId === "ent_ag_portico" && i === 0 ? "business" : "seed",
          clientEmail: author.email, userId: author.id, status: "active",
          createdAt: new Date(daysAgoIso(daysAgo + rndInt(r, 5, 45))),
          claimedAt: new Date(daysAgoIso(daysAgo)), isDemo: true,
        },
      });
      const score = clamp(roundHalf(target + (r() - 0.5) * 3), 0.5, 10);
      const crit: Record<string, number> = {};
      for (const c of cat.criteria) crit[c.key] = clamp(roundHalf(score + (r() - 0.5) * 3), 0.5, 10);
      const ph = PRICE_HINTS[entId];
      const hasPrice = !!(ph && cat.id !== "zona" && cat.id !== "affittuario");
      const hasUpdate = r() < 0.14;
      revSeq++;
      const review = await db.review.create({
        data: {
          experienceId: exp.id, entityId: entId, userId: author.id,
          score, criteriaJson: JSON.stringify(crit), criteriaVersionId: versionByCat.get(catId)!,
          prosJson: JSON.stringify(shuffle(texts.pros).slice(0, rndInt(r, 1, 3))),
          consJson: JSON.stringify(shuffle(texts.cons).slice(0, rndInt(r, 1, 2))),
          priceAmount: hasPrice ? rndInt(r, ph[0], ph[1]) : null,
          priceUnit: hasPrice ? ph[2] : null,
          priceKind: hasPrice ? (r() < 0.6 ? "Concluso/pagato" : r() < 0.5 ? "Richiesto" : "Proposto/offerta") : null,
          text: rndPick(r, texts.bodies), status: "published",
          verified: true, createdAt: new Date(daysAgoIso(daysAgo)),
          updatedAt: hasUpdate ? new Date(daysAgoIso(Math.max(1, daysAgo - rndInt(r, 2, 20)))) : null,
          updateReason: hasUpdate ? rndPick(r, UPDATE_REASONS) : null, isDemo: true,
        },
      });
      const arr = reviewIdsByEntity.get(entId) || [];
      arr.push(review.id);
      reviewIdsByEntity.set(entId, arr);
    }
  }

  // 7) Una recensione nascosta dalla moderazione (decisione registrata)
  const casanovaRevs = reviewIdsByEntity.get("ent_ag_casanova") || [];
  const hiddenRev = casanovaRevs[0];
  if (hiddenRev) {
    await db.review.update({
      where: { id: hiddenRev },
      data: { status: "hidden", hiddenReason: "Contenuto promozionale ripetuto, privo di esperienza diretta (decisione di moderazione)." },
    });
  }
  const ferrettiRevs = reviewIdsByEntity.get("ent_am_ferretti") || [];
  const hiddenRep = ferrettiRevs[0];

  // 6bis) FOTO demo: gradienti generati con sharp (nessun file esterno),
  // allegati alle recensioni di alcuni immobili. Come da regola, sono già
  // senza metadati: sharp ricompila in JPEG puro.
  async function demoPhoto(w: number, h: number, rgb: [number, number, number]): Promise<Buffer> {
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${rgb[0]},${rgb[1]},${rgb[2]})"/><stop offset="1" stop-color="rgb(${Math.max(0, rgb[0] - 60)},${Math.max(0, rgb[1] - 45)},${Math.max(0, rgb[2] - 30)})"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="54%" text-anchor="middle" font-family="sans-serif" font-size="26" fill="rgba(255,255,255,0.85)">Foto dimostrativa</text></svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true }).then(o => o.data);
  }
  const photoTargets: Array<[string, [number, number, number]]> = [
    ["ent_i_rondini", [51, 101, 138]],
    ["ent_i_tigli8", [78, 125, 91]],
    ["ent_i_girasole", [166, 91, 63]],
    ["ent_i_fiume", [131, 102, 31]],
  ];
  let demoPhotoCount = 0;
  for (const [entId, rgb] of photoTargets) {
    const ids = reviewIdsByEntity.get(entId) || [];
    for (let i = 0; i < Math.min(2, ids.length); i++) {
      const w = 640 + i * 40;
      const buf = await demoPhoto(w, 480, rgb);
      await db.reviewPhoto.create({
        data: { reviewId: ids[i], data: new Uint8Array(buf), width: w, height: 480, bytes: buf.length, isDemo: true },
      });
      demoPhotoCount++;
    }
  }

  // 6ter) VOTI demo (effetto community): i recensori premium confermano o
  // disconfermano alcune recensioni. Un voto per utente e recensione,
  // mai sulla propria (stessa regola applicata dal server).
  let demoVoteCount = 0;
  for (const entId of ["ent_i_rondini", "ent_am_sereni"]) {
    const ids = reviewIdsByEntity.get(entId) || [];
    for (let i = 0; i < Math.min(4, ids.length); i++) {
      const rev = await db.review.findUnique({ where: { id: ids[i] }, select: { userId: true } });
      if (!rev) continue;
      for (let j = 0; j < 3; j++) {
        const voter = reviewers[(i * 3 + j + 2) % reviewers.length];
        if (voter.id === rev.userId) continue;
        await db.reviewVote.create({
          data: { reviewId: ids[i], userId: voter.id, value: r() < 0.78 ? 1 : -1 },
        });
        demoVoteCount++;
      }
    }
  }

  // 6quater) Una recensione APERTA (dichiarata, senza invito) demo: mostra il
  // badge "Dichiarata" e il funzionamento del contributo aperto.
  const openAuthor = reviewers[6];
  const expOpen = await db.experience.create({
    data: {
      entityId: "ent_i_ciliegio", kind: "Visita e sopralluogo", period: "2026",
      origin: "self", clientEmail: openAuthor.email, userId: openAuthor.id, status: "active",
      claimedAt: new Date(daysAgoIso(2)), createdAt: new Date(daysAgoIso(2)), isDemo: true,
    },
  });
  await db.review.create({
    data: {
      experienceId: expOpen.id, entityId: "ent_i_ciliegio", userId: openAuthor.id,
      score: 6.5,
      criteriaJson: JSON.stringify({ stato: 6, descrizione: 7, spazi: 7.5, rumori: 6, impianti: 5, rapporto: 6.5 }),
      criteriaVersionId: versionByCat.get("immobile")!,
      prosJson: JSON.stringify(["Giardino curato e ben esposto a sud", "Struttura sana, nessuna infiltrazione"]),
      consJson: JSON.stringify(["Caldaia con più di quindici anni da sostituire"]),
      text: "Ho visitato la villa durante un sopralluogo: struttura sana e giardino esposto a sud, ma la caldaia ha più di quindici anni e andrebbe sostituita. Esperienza dichiarata senza invito: riporto ciò che ho visto, con nome e cognome mai nominati.",
      status: "published", verified: false, createdAt: new Date(daysAgoIso(2)), isDemo: true,
    },
  });

  // 8) Esperienza in attesa di verifica documentale (flusso utente)
  const expPending = await db.experience.create({
    data: {
      entityId: "ent_p_gm", kind: "Contratto di affitto cessato", period: "2025",
      origin: "verification-request", clientEmail: uArianna.email, userId: null,
      status: "pending", note: "Contratto di affitto registrato, anni 2023-2025. Chiedo di poter recensire la mia esperienza.",
      requestedById: uArianna.id, createdAt: new Date(daysAgoIso(3)), isDemo: true,
    },
  });

  // 9) Inviti demo: uno attivo (token solo nell'email log demo), uno scaduto, uno usato
  const expInvite = await db.experience.create({
    data: {
      entityId: "ent_ag_portico", kind: "Servizio di intermediazione ricevuto", period: "2026",
      origin: "business", clientEmail: uArianna.email, userId: null, status: "active",
      note: "Esperienza registrata dal soggetto verificato (Il Portico Immobiliare).",
      createdAt: new Date(daysAgoIso(2)), isDemo: true,
    },
  });
  const tokActive = randomBytes(32).toString("hex");
  await db.invite.create({
    data: {
      experienceId: expInvite.id, email: uArianna.email, tokenHash: sha256(tokActive),
      quotaOwner: "ent_ag_portico", expiresAt: new Date(Date.now() + 5 * 86400000), isDemo: true,
    },
  });
  const tokExpired = randomBytes(32).toString("hex");
  const expExpired = await db.experience.create({
    data: {
      entityId: "ent_ag_portico", kind: "Servizio di intermediazione ricevuto", period: "2025",
      origin: "business", clientEmail: "cliente.passato@esempio.test", userId: null, status: "active",
      createdAt: new Date(daysAgoIso(10)), isDemo: true,
    },
  });
  await db.invite.create({
    data: {
      experienceId: expExpired.id, email: "cliente.passato@esempio.test", tokenHash: sha256(tokExpired),
      quotaOwner: "ent_ag_portico", expiresAt: new Date(daysAgoIso(3)), isDemo: true,
    },
  });
  // invito usato: esperienza del reviewer 0 su ent_ag_portico (prima del pool)
  const usedExp = await db.experience.create({
    data: {
      entityId: "ent_ag_portico", kind: "Servizio di intermediazione ricevuto", period: "2024",
      origin: "business", clientEmail: uMarco.email, userId: uMarco.id, status: "active",
      claimedAt: new Date(daysAgoIso(20)), createdAt: new Date(daysAgoIso(28)), isDemo: true,
    },
  });
  await db.invite.create({
    data: {
      experienceId: usedExp.id, email: uMarco.email, tokenHash: sha256(randomBytes(32).toString("hex")),
      quotaOwner: "ent_ag_portico", expiresAt: new Date(daysAgoIso(21)), usedAt: new Date(daysAgoIso(20)), isDemo: true,
    },
  });

  // 10) Segnalazioni e contestazioni demo
  const uModerator = await db.user.findUnique({ where: { email: "moderatore@esempio.test" } });
  const casanovaPublished = casanovaRevs.find(id => id !== hiddenRev);
  if (casanovaPublished) {
    await db.report.create({
      data: {
        targetType: "review", targetId: casanovaPublished, reporterUserId: uMarco.id,
        reason: "falsita",
        details: "Il modello di immobile descritto non corrisponde a nessuna unità gestita dall'agenzia: la recensione sembra provenire da un concorrente.",
        status: "received", createdAt: new Date(daysAgoIso(1)), isDemo: true,
      },
    });
  }
  if (hiddenRep) {
    await db.report.create({
      data: {
        targetType: "review", targetId: hiddenRep, reporterUserId: reviewers[5].id,
        reason: "dati-personali",
        details: "La recensione cita il nominativo completo e la scala di un condomino.",
        status: "reviewing", createdAt: new Date(daysAgoIso(2)), isDemo: true,
        decisions: {
          create: { byId: uModerator!.id, action: "Presa in carico", reason: "In valutazione da parte della moderazione.", at: new Date(daysAgoIso(1)) },
        },
      },
    });
  }
  await db.dispute.create({
    data: {
      entityId: "ent_p_lb", claimantEmail: "persona.interessata@esempio.test",
      claim: "La scheda 'L. B.' si riferisce a una persona diversa da me: chiedo la revisione dell'associazione tra la scheda e il mio nominativo.",
      status: "received", createdAt: new Date(daysAgoIso(1)), isDemo: true,
    },
  });

  // 10bis) Membership Premium dei recensori demo: ogni recensione pubblicata
  // genera il grant come nel meccanismo reale. Nell'istanza demo le scadenze
  // partono da adesso (il seed gira ora): così i login demo mostrano lo stato
  // Premium attivo e il gating si prova con l'utente normale.
  const PREMIUM_DAYS = 30;
  const demoReviews = await db.review.findMany({
    where: { isDemo: true, status: "published" },
    select: { id: true, userId: true, createdAt: true },
  });
  const nowSeed = Date.now();
  const premiumByUser = new Map<string, Date>();
  if (demoReviews.length) {
    await db.premiumGrant.createMany({
      data: demoReviews.map(r => {
        const expiresAt = new Date(Math.max(nowSeed, r.createdAt.getTime() + PREMIUM_DAYS * 86400000) + PREMIUM_DAYS * 86400000);
        const cur = premiumByUser.get(r.userId);
        if (!cur || expiresAt > cur) premiumByUser.set(r.userId, expiresAt);
        return { userId: r.userId, reviewId: r.id, days: PREMIUM_DAYS, origin: "seed", grantedAt: r.createdAt, expiresAt };
      }),
    });
    for (const [uid, until] of premiumByUser) {
      await db.user.update({ where: { id: uid }, data: { premiumUntil: until } });
    }
  }

  // 11) Log demo
  await db.auditLog.createMany({
    data: [
      { actorId: uModerator!.id, actorRole: "moderator", action: "Recensione nascosta", targetType: "review", targetId: hiddenRev, reason: "Contenuto promozionale, non pertinente a un'esperienza diretta.", at: new Date(daysAgoIso(5)), isDemo: true },
      { actorId: uModerator!.id, actorRole: "moderator", action: "Esperienza verificata e approvata", targetType: "experience", targetId: expPending.id, reason: "Documento di contratto ritenuto sufficiente.", at: new Date(daysAgoIso(12)), isDemo: true },
    ],
  });
  await db.securityLog.createMany({
    data: [
      { type: "login_failed_repeat", severity: "warn", details: "5 tentativi di accesso falliti per moderatore@esempio.test — blocco temporaneo di 60 s applicato.", at: new Date(daysAgoIso(4)), isDemo: true },
      { type: "admin_login_ok", severity: "info", details: "Accesso all'area amministrativa riuscito con 2FA (admin@esempio.test).", at: new Date(daysAgoIso(3)), isDemo: true },
      { type: "invite_token_invalid", severity: "warn", details: "Tentativo di riscatto di un token di invito non valido o già usato (possibile enumerazione).", at: new Date(daysAgoIso(2)), isDemo: true },
      { type: "totp_enabled", severity: "info", details: "Autenticazione a due fattori attivata per un account amministrativo.", at: new Date(daysAgoIso(1)), isDemo: true },
    ],
  });

  // 12) Email demo (casella dimostrativa: contengono il link con il token SOLO in demo)
  await db.emailLog.createMany({
    data: [
      { to: uArianna.email, subject: "Benvenuta su ZoomZoom (istanza demo)", body: "Grazie per la registrazione. Il tuo indirizzo email è stato verificato con il codice contenuto in questo messaggio dimostrativo.", linksJson: "[]", status: "queued", at: new Date(daysAgoIso(30)), isDemo: true },
      { to: uArianna.email, subject: "Il Portico Immobiliare ti invita a recensire la tua esperienza", body: "Hai ricevuto un invito collegato a un'esperienza registrata sulla piattaforma: 'Servizio di intermediazione ricevuto' con Il Portico Immobiliare. Il collegamento è valido 7 giorni e per un solo uso. L'invito verifica l'esistenza dell'interazione registrata, non la veridicità delle affermazioni.", linksJson: JSON.stringify([{ label: "Apri l'invito e scrivi la recensione", href: "#/invito/" + tokActive }]), status: "queued", at: new Date(daysAgoIso(2)), isDemo: true },
      { to: uArianna.email, subject: "Richiesta di verifica esperienza ricevuta", body: "Abbiamo ricevuto la tua richiesta di verifica per l'esperienza con G. M. (Contratto di affitto cessato). Un moderatore esaminerà il documento caricato: riceverai un aggiornamento entro 7 giorni.", linksJson: "[]", status: "queued", at: new Date(daysAgoIso(3)), isDemo: true },
    ],
  });

  // 13) Credenziali demo in file locale (NON pubblico, NON nel front-end)
  const fs = await import("fs");
  fs.writeFileSync("demo-credentials.json", JSON.stringify({
    _nota: "Credenziali dell'istanza DEMO. Dominio esempio.test riservato (RFC 6761): non sono credenziali valide su alcun sistema reale. Per il codice TOTP: bun scripts/totp.ts <email>",
    ...credentials,
  }, null, 2));
  fs.appendFileSync(".gitignore", "\ndemo-credentials.json\n");

  const counts = {
    utenti: await db.user.count({ where: { isDemo: true } }),
    schede: await db.entity.count({ where: { isDemo: true } }),
    recensioni: await db.review.count({ where: { isDemo: true } }),
    esperienze: await db.experience.count({ where: { isDemo: true } }),
    foto: await db.reviewPhoto.count({ where: { isDemo: true } }),
    voti: await db.reviewVote.count({ where: { review: { isDemo: true } } }),
  };
  console.log("Seed completato:", counts, "in", Date.now() - t0, "ms");
  console.log("Credenziali demo salvate in demo-credentials.json (mai esposte al front-end).");
  console.log("Invito demo attivo per utente@esempio.test: visibile nella casella demo del back office.");
}

/* Utils statici (seed senza import del modulo con next/headers) */
import { createCipheriv } from "crypto";
function encryptSecretStatic(plain: string): string {
  const APP_SECRET = process.env.APP_SECRET || "";
  if (!APP_SECRET) throw new Error("APP_SECRET mancante in .env");
  const key = createHash("sha256").update(APP_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${enc.toString("hex")}`;
}
function randomBytesStatic(r: () => number, n: number): Buffer {
  // per il seed serve entropia reale per i segreti TOTP, non RNG deterministico
  return randomBytes(n);
}
function base32(bytes: Buffer): string {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
