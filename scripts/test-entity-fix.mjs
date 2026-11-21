// Verifica post-fix dei casi che prima fallivano con "non risulta in Italia"
// + regressione dei casi già funzionanti.
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function main() {
  let u = await db.user.findFirst({ where: { email: "test-bug@zoomzoom.test" } });
  if (!u) {
    u = await db.user.create({
      data: { email: "test-bug@zoomzoom.test", nickname: "testbug", role: "user", emailVerified: true, passwordHash: "x" },
    });
  }
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
  const cleanup = async (needle) => {
    await db.entity.deleteMany({ where: { OR: [{ name: { contains: needle } }, { address: { contains: needle } }] } });
  };

  const cases = [
    // i due casi che PRIMA davano "La località indicata non risulta in Italia"
    ["E: lat/lng=0,0 → ora recupera col nome/pin", {
      address: "Via Fix 5",
      zone: { name: "Milano", province: null, region: null, lat: 0, lng: 0 },
      geo: { lat: 45.4642, lng: 9.19 },
    }],
    ["F: lat/lng mancanti → zona nota col nome", {
      address: "Via Fix 6",
      zone: { name: "Berlingo", province: "Brescia", region: "Lombardia" },
    }],
    ["F2: lat/lng mancanti, zona NUOVA + pin valido → crea col pin", {
      address: "Via Fix 7",
      zone: { name: "Sustinente", province: "Mantova", region: "Lombardia" },
      geo: { lat: 45.05, lng: 10.98 },
    }],
    // regressioni: i casi che già funzionano devono continuare a funzionare
    ["A: città remota Nominatim", {
      address: "Via Fix 1",
      zone: { name: "Quistello", province: "Mantova", region: "Lombardia", lat: 45.0, lng: 10.98 },
    }],
    ["D: zoneId esistente", {
      address: "Via Fix 4",
      zoneId: "milano",
    }],
    ["X: zona sconosciuta SENZA coordinate e SENZA pin → errore onesto (non 'non risulta in Italia')", {
      address: "Via Fix 8",
      zone: { name: "Postoinesistente XYZ", province: null, region: null },
    }],
    ["Y: nome corto → errore 'seleziona la città'", {
      address: "Via Fix 9",
      zone: { name: "A", lat: 45.5, lng: 10.2 },
    }],
  ];

  for (const [label, body] of cases) {
    await cleanup("Via Fix");
    const r = await post(body);
    const out = r.j.ok ? `OK (zona: ${r.j.entity?.zoneId ?? "?"})` : (r.j.error || "?").slice(0, 100);
    console.log(`${label}\n   → ${r.status}: ${out}`);
  }
  await cleanup("Via Fix");

  // le zone create: Sustinente deve esistere con le coordinate del pin
  const sus = await db.zone.findUnique({ where: { id: "sustinente" } });
  console.log("\nZona Sustinente creata da pin:", sus ? `${sus.gpsLat}, ${sus.gpsLng} (${sus.province})` : "MANCANTE");
  // pulizia zone di test
  await db.zone.deleteMany({ where: { id: { in: ["quistello", "sustinente"] } } }).catch(() => {});

  await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  await db.$disconnect();
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
