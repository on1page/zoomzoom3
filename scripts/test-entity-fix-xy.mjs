// Casi X e Y con utente fresco: errori onesti al posto del generico "non risulta in Italia".
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function main() {
  const email = "test-xy@zoomzoom.test";
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const u = await db.user.create({
    data: { email, nickname: "testxy", role: "user", emailVerified: true, passwordHash: "x" },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId: u.id, kind: "public", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) },
  });
  const post = async (body) => {
    const res = await fetch(`${BASE}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `zz_session=${token}`, Origin: BASE },
      body: JSON.stringify(body),
    });
    return { status: res.status, j: await res.json().catch(() => ({})) };
  };

  const cases = [
    ["X: zona sconosciuta SENZA coordinate e SENZA pin → messaggio utile", {
      address: "Via Xy 1",
      zone: { name: "Postoinesistente XYZ", province: null, region: null },
    }],
    ["Y: nome corto → invito a scegliere la città", {
      address: "Via Xy 2",
      zone: { name: "A", lat: 45.5, lng: 10.2 },
    }],
    ["Z: zoneId inesistente senza zone → invito a scegliere la città", {
      address: "Via Xy 3",
      zoneId: "zona-che-non-esiste",
    }],
  ];
  for (const [label, body] of cases) {
    const r = await post(body);
    console.log(`${label}\n   → ${r.status}: ${(r.j.error || "?").slice(0, 120)}`);
  }
  await db.user.delete({ where: { id: u.id } });
  await db.$disconnect();
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
