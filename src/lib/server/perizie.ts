// ZoomZoom — indagine professionale (percorso ③ del modello D11): regole
// condivise dalle rotte delle perizie.
//   · codici-causale brevi e univoci per il bonifico tracciato (PZ-4K7F2Q)
//   · applicazione pigra delle scadenze: bacheca scaduta → expired;
//     relazione non consegnata entro il termine → incarico nullo (la
//     richiesta torna in bacheca, il consulente manca l'incaricio perde un
//     punto di serietà). Il controllo gira a ogni lettura utile e dal job
//     giornaliero /api/cron/perizie: nessun timer necessario.
//   · chiusura del cerchio (K7): alla consegna la scheda dell'indirizzo
//     nasce o si aggiorna con l'indagine certificata.
//   · avvisi ai consulenti che coprono la zona: MAI dati identificativi del
//     richiedente (K9): né nickname né email, solo l'indirizzo e la richiesta.
import { db } from "@/lib/db";
import type { AppSettings } from "./settings";
import { sendMail } from "./mailer";
import { normAddress, normUnit, sameBuilding, splitStreetCivico } from "@/lib/address-norm";
import { auditLog } from "./audit";

// alfabeto senza caratteri ambigui (0/O, 1/I/L, 5/S, 8/B): codici che si
// leggono e si trascrivono senza dubbio al telefono o dallo screenshot
const CODE_ALPHABET = "234679ACDEFGHJKMNPQRTUVWXYZ";

function randomChars(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** Codice-causale breve per il bonifico tracciato (es. «PZ-4K7F2Q»). */
export function genPeriziaCode(): string {
  return `PZ-${randomChars(6)}`;
}

/** Codice-causale di un ordine di abbonamento (es. «SUB-4K7F2Q»). */
export function genSubscriptionCode(): string {
  return `SUB-${randomChars(6)}`;
}

/** Rigenera il codice fintantoché è univoco (collisione: si ritenta). */
export async function uniquePeriziaCode(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = genPeriziaCode();
    const taken = await db.periziaRequest.findUnique({ where: { code } });
    if (!taken) return code;
  }
  // fallback statistico: 6 caratteri su 24 → collisioni trascurabili
  return genPeriziaCode();
}

export async function uniqueSubscriptionCode(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = genSubscriptionCode();
    const taken = await db.subscriptionOrder.findUnique({ where: { code } });
    if (!taken) return code;
  }
  return genSubscriptionCode();
}

/* ------------------------------------------------------------------ */
/*  Applicazione pigra delle scadenze                                  */
/* ------------------------------------------------------------------ */

export type SweepStats = { expired: number; voided: number };

/**
 * Applica le scadenze maturate. Chiamata all'inizio delle letture che le
 * riguardano (bacheca, area consulente, back office) e dal cron giornaliero:
 *  1. «open» con expiresAt passato → «expired»: il richiedente è avvisato e
 *     può riproporre la richiesta o annullarla;
 *  2. «paid» con deadlineAt passato → incarico nullo: la richiesta torna in
 *     bacheca («open», nuova scadenza di accettazione), il consulente riceve
 *     incarichiNulli+1 (feedback di serietà pubblico) e le parti sono
 *     avvisate. La tariffa resta quella già versata: il prossimo consulente
 *     che accetta la ritira alle stesse condizioni.
 */
export async function sweepPerizie(settings: AppSettings): Promise<SweepStats> {
  const stats: SweepStats = { expired: 0, voided: 0 };
  const now = new Date();

  // 1) bacheca scaduta senza accettazioni
  const staleOpen = await db.periziaRequest.findMany({
    where: { status: "open", expiresAt: { lt: now } },
    include: { zone: true, requester: { select: { email: true } } },
  });
  for (const r of staleOpen) {
    await db.periziaRequest.update({ where: { id: r.id }, data: { status: "expired" } });
    stats.expired++;
    await auditLog({
      actorId: null, actorRole: "system",
      action: "perizia.bachecaScaduta",
      targetType: "periziaRequest", targetId: r.id,
      reason: `Nessun consulente ha accettato entro il ${r.expiresAt!.toLocaleDateString("it-IT")}.`,
    });
    void sendMail(
      r.requester.email,
      "ZoomZoom — nessun consulente ha accettato la tua richiesta",
      "La tua richiesta di indagine professionale è scaduta in bacheca di zona senza accettazioni.\nPuoi riproporla (i consulenti della zona riceveranno un nuovo invito) oppure annullarla dalla pagina «Le mie richieste».",
      [{ label: "Le mie richieste", href: "/#/consulente-richieste" }],
    );
  }

  // 2) incarico nullo: pagata ma relazione non consegnata entro il termine
  const stalePaid = await db.periziaRequest.findMany({
    where: { status: "paid", deadlineAt: { lt: now }, consultantId: { not: null } },
    include: { consultant: { include: { user: { select: { email: true } }, zone: true } }, zone: true },
  });
  for (const r of stalePaid) {
    const consulente = r.consultant!;
    const expiresAt = new Date(now.getTime() + settings.bachecaExpiryDays * 86400000);
    await db.periziaRequest.update({
      where: { id: r.id },
      data: {
        status: "open",          // ripubblicata in bacheca di zona
        consultantId: null,      // il consulente mancate viene svincolato
        expiresAt,
        voidCount: { increment: 1 },
      },
    });
    await db.consultantProfile.update({
      where: { id: consulente.id },
      data: { incarichiNulli: { increment: 1 } },
    });
    stats.voided++;
    await auditLog({
      actorId: null, actorRole: "system",
      action: "perizia.incaricoNullo",
      targetType: "periziaRequest", targetId: r.id,
      reason: `Relazione non consegnata entro il ${r.deadlineAt!.toLocaleDateString("it-IT")}: richiesta ripubblicata in bacheca, incarico mancato registrato al consulente.`,
    });
    void sendMail(
      consulente.user.email,
      "ZoomZoom — incarico non adempiuto: la richiesta torna in bacheca",
      `Non hai consegnato la relazione entro il termine del ${r.deadlineAt!.toLocaleDateString("it-IT")}: l'incarico è risultato nullo e la richiesta è stata ripubblicata in bacheca di zona. Il mancato adempimento è registrato nel tuo feedback di serietà (visibile sulla tua scheda pubblica). Se hai già consegnato o ritieni sia un errore, contatta l'amministrazione.`,
      [],
    );
    const requester = await db.user.findUnique({ where: { id: r.requesterId }, select: { email: true } });
    if (requester) {
      void sendMail(
        requester.email,
        "ZoomZoom — l'incarico è risultato nullo: la tua richiesta è di nuovo in bacheca",
        "Il consulente non ha consegnato la relazione entro il termine: la richiesta è stata ripubblicata in bacheca di zona e i consulenti della zona sono stati avvisati. La tariffa già versata resta valida per il prossimo che accetta. Puoi seguire lo stato dalla pagina «Le mie richieste».",
        [{ label: "Le mie richieste", href: "/#/consulente-richieste" }],
      );
    }
  }

  return stats;
}

/* ------------------------------------------------------------------ */
/*  Bacheca di zona: avvisi ai consulenti (K9: senza dati richiedente)  */
/* ------------------------------------------------------------------ */

/**
 * Invia l'avviso ai consulenti APPROVATI che coprono la zona (centro della
 * loro zona di esercizio entro il loro raggio d'azione). Il messaggio NON
 * contiene dati identificativi del richiedente (K9 del modello D11): solo
 * tipo, indirizzo, zona e testo della richiesta.
 */
export async function emailConsultantsOfZone(
  zone: { id: string; name: string; province: string | null; gpsLat: number; gpsLng: number },
  subject: string,
  body: string,
  maxConsultants = 50,
): Promise<number> {
  const { distanceKm } = await import("./zones");
  const approved = await db.consultantProfile.findMany({
    where: { status: "approved" },
    include: { user: { select: { email: true } }, zone: true },
  });
  const covering = approved.filter(c =>
    distanceKm({ lat: c.zone.gpsLat, lng: c.zone.gpsLng }, { lat: zone.gpsLat, lng: zone.gpsLng }) <= c.radiusKm,
  );
  let sent = 0;
  for (const c of covering.slice(0, maxConsultants)) {
    const r = await sendMail(c.user.email, subject, body, [{ label: "Bacheca di zona", href: "/#/consulente" }]);
    if (r !== "failed") sent++;
  }
  return sent;
}

/** Testo dell'invito in bacheca (per riuso tra creazione e riproposta). */
export function bachecaInviteBody(r: {
  kind: string; address: string; description: string;
  zone: { name: string; province: string | null };
  expiresAt: Date;
}, expiryDays: number): string {
  const scade = r.expiresAt.toLocaleDateString("it-IT");
  return [
    `È arrivata in bacheca di zona una nuova richiesta di indagine professionale (${r.kind}).`,
    `Indirizzo: ${r.address} — ${r.zone.name}${r.zone.province ? ` (${r.zone.province})` : ""}.`,
    "",
    "Richiesta del richiedente:",
    r.description,
    "",
    `Se l'incarico ti interessa, ritiralo dalla bacheca di zona confermando la tua tariffa. La richiesta scade il ${scade} (${expiryDays} giorni).`,
    "Prima dell'accettazione non vengono mostrati dati identificativi del richiedente.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/*  K7 — la relazione consegnata crea o aggiorna la scheda dell'indirizzo  */
/* ------------------------------------------------------------------ */

/**
 * Assicura che l'indirizzo della perizia consegnata abbia la sua scheda nel
 * catalogo (categoria «immobile», pubblicata). Se nella stessa città esiste
 * già una scheda dello stesso edificio (via + civico, a prescindere
 * dall'interno), quella viene RIUSATA: la relazione si aggancia alla scheda
 * esistente e il prossimo che cerca quell'indirizzo trova tutto insieme.
 * Ritorna l'id della scheda (che la rotta collega alla perizia).
 */
export async function ensureEntityForPerizia(r: {
  id: string; address: string; zoneId: string | null;
  requester: { id: string; isDemo: boolean };
}): Promise<string | null> {
  if (!r.zoneId) return null; // perizie storiche senza zona: nessuna scheda
  const zone = await db.zone.findUnique({ where: { id: r.zoneId } });
  if (!zone) return null;

  let { street, civico } = splitStreetCivico(r.address.trim().replace(/\s+/g, " "));
  if (street.length < 3) return null;

  // scheda esistente dello stesso edificio nella stessa città?
  const inZone = await db.entity.findMany({
    where: { zoneId: zone.id, categoryId: "immobile", status: "published" },
    select: { id: true, name: true, address: true, streetNumber: true, unit: true },
  });
  const target = {
    street,
    civico,
    fullNorm: normAddress(r.address),
    zoneNorm: normAddress(zone.name),
  };
  const existing = inZone.find(e => sameBuilding(e, target));
  if (existing) return existing.id;

  // scheda nuova: via + civico nella stessa città (come il contributo aperto)
  const fullAddress = [street, civico].filter(Boolean).join(" ");
  const ent = await db.entity.create({
    data: {
      categoryId: "immobile",
      name: fullAddress,
      subtitle: "Indirizzo con indagine professionale certificata",
      address: street,
      streetNumber: civico || null,
      zoneId: zone.id,
      status: "published",
      proposedBy: `perizia:${r.id}`,
      isDemo: r.requester.isDemo,
    },
  });
  await auditLog({
    actorId: null, actorRole: "system",
    action: "Scheda immobile creata dalla consegna di un'indagine professionale (chiusura del cerchio)",
    targetType: "entity", targetId: ent.id,
    reason: `Perizia ${r.id}: ${fullAddress}, ${zone.name}.`,
    isDemo: ent.isDemo,
  });
  return ent.id;
}
