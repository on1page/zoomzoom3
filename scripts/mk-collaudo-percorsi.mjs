// ZoomZoom — scenario di collaudo visivo dei percorsi semplici (B + C + A):
// utente con indagine pubblicata su un immobile (per l'offerta
// «due righe sull'amministratore»), amministratore con due condomini
// collegati (per la scheda che li raggruppa), indagine madre pronta sul
// secondo immobile (per compilare il modulo direttamente dall'offerta).
// Stampa i token di sessione e gli id per lo script di screenshot.
// Uso: bun work/percorsi-schede-collegate/scripts/mk-collaudo-percorsi.mjs
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function mkUser(email, nickname) {
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const salt = randomBytes(16).toString("hex");
  return db.user.create({
    data: {
      email, nickname, role: "user", emailVerified: true,
      passwordHash: `scrypt$16384$8$1$${salt}$${scryptSync("test1234", salt, 64).toString("hex")}`,
    },
  });
}

async function mkSession(userId) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 4 * 3600_000) },
  });
  return token;
}

const TESTTXT = "Appartamento in ordine, affaccio tranquillo e vicinato rispettoso. La caldaia è stata sostituita di recente e l'ascensore funziona regolarmente. Nel complesso una buona esperienza di residenza, con alcune manutenzioni da rifinire.";

async function main() {
  // pulizia di eventuali scenari precedenti
  const prevUsers = await db.user.findMany({ where: { email: { contains: "percorsi.vis@" } } });
  for (const u of prevUsers) await db.user.delete({ where: { id: u.id } }).catch(() => {});
  await db.entity.deleteMany({ where: { name: { contains: "Via delle Anteprime" } } });
  await db.entity.deleteMany({ where: { name: "Studio Bianchi Amministrazioni" } });

  const milano = await db.zone.findFirst({ where: { id: "milano" } })
    || await db.zone.findFirst({ where: { name: "Milano" } });

  const u1 = await mkUser("cond1.percorsi.vis@zoomzoom.test", "silvia_anteprima");
  const u2 = await mkUser("cond2.percorsi.vis@zoomzoom.test", "luca_anteprima");

  const mkCond = async (civico) => db.entity.create({
    data: {
      categoryId: "immobile", name: `Via delle Anteprime ${civico}`,
      address: "Via delle Anteprime", streetNumber: civico,
      zoneId: milano.id, status: "published", proposedBy: "seed",
    },
  });
  const cond1 = await mkCond("3");
  const cond2 = await mkCond("5");

  const admin = await db.entity.create({
    data: {
      categoryId: "amministratore", name: "Studio Bianchi Amministrazioni",
      zoneId: milano.id, status: "published", proposedBy: "seed",
    },
  });

  // due collegamenti condominio → amministratore
  for (const c of [cond1, cond2]) {
    await db.entityLink.create({
      data: { fromEntityId: c.id, toEntityId: admin.id, kind: "amministra", source: "indagine" },
    }).catch(() => {}); // già presente da esecuzioni precedenti
  }

  // una mini-indagine sull'amministratore (scheda più credibile)
  const expAdm = await db.experience.create({
    data: { entityId: admin.id, kind: "Condominio in cui abito", origin: "self", clientEmail: u1.email, userId: u1.id, status: "active", isDemo: false },
  });
  await db.review.create({
    data: {
      experienceId: expAdm.id, entityId: admin.id, userId: u1.id,
      score: 7.5, criteriaJson: JSON.stringify({ conti: 8, trasparenza: 7, parti_comuni: 7, assemblee: 8, interventi: 6.5 }), criteriaVersionId: null,
      prosJson: JSON.stringify(["conti chiari e preventivi puntuali"]), consJson: JSON.stringify([]),
      text: TESTTXT, status: "published", verified: true, isDemo: false,
      authorCategory: "affittuario", showIdentity: false,
    },
  });

  // indagine madre su cond2: l'utente 2 ha appena pubblicato, l'offerta
  // «due righe sull'amministratore» si vede dopo l'invio del modulo
  const expCond = await db.experience.create({
    data: { entityId: cond2.id, kind: "Abitazione in affitto", origin: "self", clientEmail: u2.email, userId: u2.id, status: "active", isDemo: false },
  });
  await db.review.create({
    data: {
      experienceId: expCond.id, entityId: cond2.id, userId: u2.id,
      score: 6.5, criteriaJson: JSON.stringify({ stato: 6 }), criteriaVersionId: null,
      prosJson: JSON.stringify(["vista luminosa"]), consJson: JSON.stringify(["ascensore rumoroso"]),
      text: TESTTXT, status: "published", verified: false, isDemo: false,
      authorCategory: "affittuario", showIdentity: false,
    },
  });

  const t1 = await mkSession(u1.id);
  const t2 = await mkSession(u2.id);
  console.log(JSON.stringify({ t1, t2, admin: admin.id, cond1: cond1.id, cond2: cond2.id }));
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
