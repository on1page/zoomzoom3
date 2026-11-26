// ZoomZoom — scenario di collaudo visivo dei percorsi ② e ③ del modello D11.
// Crea: richiedente con richiesta in bacheca (open) + accettata (con causale) +
// scaduta (expired), consulente approvato con richiesta pagata (da consegnare),
// perizia consegnata con sintesi pubblica e scheda K7 (chiusura del cerchio),
// ordine di abbonamento in attesa + pagato (Premium attivo).
// Stampa i token di sessione per lo script di screenshot.
// Uso: bun work/d11-percorsi/scripts/mk-collaudo-d11.mjs
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function mkUser(email, nickname, { totp = false, role = "user" } = {}) {
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const salt = randomBytes(16).toString("hex");
  return db.user.create({
    data: {
      email, nickname, role, emailVerified: true, totpEnabled: totp,
      passwordHash: `scrypt$16384$8$1$${salt}$${scryptSync("test1234", salt, 64).toString("hex")}`,
    },
  });
}

async function mkSession(userId, kind) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 4 * 3600_000) },
  });
  return token;
}

const relazione = Array.from({ length: 9 }, (_, i) => `${i + 1}. Sezione della relazione tecnica di collaudo: struttura in ordine, impianti conformi, isolamento acustico migliorabile, grondaie da revisionare. Il resto del testo serve a superare il minimo di trecento caratteri richiesto dalla validazione della consegna.`).join("\n\n");

async function main() {
  // pulizia di eventuali scenari precedenti
  const prevUsers = await db.user.findMany({ where: { email: { contains: "d11.vis@" } } });
  for (const u of prevUsers) await db.user.delete({ where: { id: u.id } }).catch(() => {});
  await db.entity.deleteMany({ where: { name: { contains: "Via Certosa 4" } } }).catch(() => {});

  const milano = await db.zone.findFirst({ where: { id: "milano" } }) || await db.zone.findFirst();

  const rich = await mkUser("rich.d11.vis@zoomzoom.test", "giuliaf", { totp: false });
  const cons = await mkUser("cons.d11.vis@zoomzoom.test", "geomrossi", { totp: true });
  const superA = await mkUser("super.d11.vis@zoomzoom.test", "direttore", { totp: true, role: "superadmin" });

  // consulente approvato (con scheda pubblica per il feedback di serietà)
  const oldProf = await db.consultantProfile.findUnique({ where: { userId: cons.id } });
  if (oldProf) await db.consultantProfile.delete({ where: { id: oldProf.id } });
  const prof = await db.consultantProfile.create({
    data: {
      userId: cons.id, firstName: "Marco", lastName: "Rossi",
      profession: "Geometra", title: "Diploma di geometra",
      bio: "Perizie e valutazioni indipendenti dal 2011, specializzato in edifici d'epoca.",
      zoneId: milano.id, radiusKm: 45, feeCents: 28000, vatNumber: "01234567890",
      iban: "IT60X0542811101000000123456", status: "approved",
      incarichiCompletati: 2, incarichiNulli: 0,
    },
  });
  // scheda pubblica del consulente (categoria consulente)
  const entCons = await db.entity.create({
    data: {
      categoryId: "consulente", name: "Marco Rossi", subtitle: "Geometra · Milano",
      zoneId: milano.id, verifiedBusiness: true, status: "published", proposedBy: "seed",
    },
  });
  await db.consultantProfile.update({ where: { id: prof.id }, data: { entityId: entCons.id } });

  // 1) richiesta in BACHECA (open) — vista del richiedente e della bacheca
  const rOpen = await db.periziaRequest.create({
    data: {
      requesterId: rich.id, consultantId: null, code: "PZ-4K7F2Q",
      kind: "Valutazione immobiliare", address: "Via dei Mille 15",
      zoneId: milano.id, status: "open",
      description: "Valutazione indipendente di un appartamento di 80 mq al terzo piano con cantina, prima di fare un'offerta.",
      expiresAt: new Date(Date.now() + 13 * 86400000),
    },
  });

  // 2) richiesta ACCETTATA (pagamento con causale) — vista del richiedente
  const rAcc = await db.periziaRequest.create({
    data: {
      requesterId: rich.id, consultantId: prof.id, code: "PZ-9M2X7C",
      kind: "Perizia tecnica", address: "Via Padova 44",
      zoneId: milano.id, status: "accepted", feeCents: 32000,
      description: "Perizia tecnica su infiltrazioni dal balcone: capire se il danno è strutturale prima di firmare il compromesso.",
    },
  });

  // 3) richiesta PAGATA (da consegnare) — vista del consulente
  const rPaid = await db.periziaRequest.create({
    data: {
      requesterId: rich.id, consultantId: prof.id, code: "PZ-6Q3N8T",
      kind: "Valutazione immobiliare", address: "Via Ripamonti 88",
      zoneId: milano.id, status: "paid", feeCents: 28000,
      paidAt: new Date(Date.now() - 2 * 86400000),
      deadlineAt: new Date(Date.now() + 5 * 86400000), paymentRef: "CRO-8817",
      description: "Valutazione di un bilocale da ristrutturare: quanto conviene offrire considerando i lavori necessari?",
    },
  });

  // 4) perizia CONSEGNATA con sintesi pubblica + scheda K7 (chiusura del cerchio)
  const entK7 = await db.entity.create({
    data: {
      categoryId: "immobile", name: "Via Certosa 4",
      subtitle: "Indirizzo con indagine professionale certificata",
      address: "Via Certosa", streetNumber: "4", zoneId: milano.id,
      status: "published", proposedBy: "collaudo",
    },
  });
  const rDel = await db.periziaRequest.create({
    data: {
      requesterId: rich.id, consultantId: prof.id, code: "PZ-2R8D5W",
      kind: "Perizia tecnica", address: "Via Certosa 4",
      zoneId: milano.id, status: "delivered", feeCents: 28000,
      description: "Perizia tecnica sull'edificio prima dell'acquisto: umidità in cantina e conformità degli impianti.",
      reportTitle: "Perizia tecnica — Via Certosa 4",
      reportBody: relazione,
      publicSummary: "Struttura in ordine; impianti elettrici a norma, idraulico da revisionare; ascensore non ancora a norma. Nessun danno strutturale.",
      entityId: entK7.id, deliveredAt: new Date(Date.now() - 1 * 86400000),
      paidAt: new Date(Date.now() - 4 * 86400000), paymentRef: "CRO-7742",
      payoutCents: 25200, commissionCents: 2800,
    },
  });

  // 5) richiesta SCADUTA in bacheca (Riproponi) — vista del richiedente
  const rExp = await db.periziaRequest.create({
    data: {
      requesterId: rich.id, consultantId: null, code: "PZ-7C4J1N",
      kind: "Perizia tecnica", address: "Via Naviglio Grande 21",
      zoneId: milano.id, status: "expired",
      description: "Verifica della conformità della caldaia condominiale prima dell'acquisto: nessun consulente ha ancora risposto.",
      expiresAt: new Date(Date.now() - 1 * 86400000), voidCount: 0,
    },
  });

  // 6) abbonamenti: uno in attesa (con causale) e uno pagato (Premium attivo)
  const gold = await db.subscriptionOrder.create({
    data: { userId: rich.id, planSlug: "gold", planName: "Gold", days: 7, priceCents: 500, code: "SUB-8K2F6N", status: "pending" },
  });
  const platinum = await db.subscriptionOrder.create({
    data: { userId: rich.id, planSlug: "platinum", planName: "Platinum", days: 30, priceCents: 2000, code: "SUB-3M9P4R", status: "paid", paidAt: new Date(), paymentRef: "CRO-5510" },
  });
  const grant = await db.premiumGrant.create({
    data: { userId: rich.id, days: 30, origin: "acquisto", expiresAt: new Date(Date.now() + 29 * 86400000) },
  });
  await db.subscriptionOrder.update({ where: { id: platinum.id }, data: { grantId: grant.id } });
  await db.user.update({ where: { id: rich.id }, data: { premiumUntil: grant.expiresAt } });

  const tRich = await mkSession(rich.id, "public");
  const tCons = await mkSession(cons.id, "public");
  const tAdmin = await mkSession(superA.id, "admin");

  console.log(JSON.stringify({
    tokens: { rich: tRich, cons: tCons, admin: tAdmin },
    ids: { open: rOpen.id, accepted: rAcc.id, paid: rPaid.id, delivered: rDel.id, expired: rExp.id, entK7: entK7.id, entCons: entCons.id, orderGold: gold.id },
  }, null, 2));
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
