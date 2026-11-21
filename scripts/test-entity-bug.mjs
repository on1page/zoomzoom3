// Riproduce i flussi del client "Aggiungi immobile" contro POST /api/entities
// per trovare quale payload scatena "La località indicata non risulta in Italia".
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";

function sha256(s) { return createHash("sha256").update(s).digest("hex"); }

async function main() {
  // utente di prova: prendo (o creo) un utente normale verificato
  let u = await db.user.findFirst({ where: { role: "user", emailVerified: true } });
  if (!u) {
    u = await db.user.create({
      data: {
        email: "test-bug@zoomzoom.test", nickname: "testbug", role: "user",
        emailVerified: true, passwordHash: "x",
      },
    });
    console.log("utente di test creato:", u.email);
  }

  // sessione pubblica mintata a mano (come farebbe il login)
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId: u.id, kind: "public", tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });

  const post = async (body) => {
    const res = await fetch(`${BASE}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `zz_session=${token}`, Origin: BASE },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, j };
  };

  // pulizia preventiva delle schede di test create
  const cleanup = async (name) => {
    await db.entity.deleteMany({ where: { name: { contains: name } } });
  };

  const cases = [
    ["A: città remota Nominatim (nome+coordinate reali)", {
      address: "Via Test 1",
      zone: { name: "Berlingo", province: "Brescia", region: "Lombardia", lat: 45.50298, lng: 10.043665 },
    }],
    ["B: flusso GPS reverse (zoneName + coordinate GPS)", {
      address: "Via Test 2",
      zone: { name: "Pompiano", province: "Brescia", region: "Lombardia", lat: 45.4, lng: 10.0 },
    }],
    ["C: pick PlaceSearch con zoneName + coord Nominatim", {
      address: "Via Test 3",
      zone: { name: "Alassio", province: "Savona", region: "Liguria", lat: 44.008011, lng: 8.173027 },
    }],
    ["D: zoneId di zona esistente", {
      address: "Via Test 4",
      zoneId: "milano",
    }],
    ["E: lat/lng = 0,0 (PlaceSearch locale con cache vecchia senza coordinate)", {
      address: "Via Test 5",
      zone: { name: "Milano", province: null, region: null, lat: 0, lng: 0 },
    }],
    ["F: lat/lng undefined (Number(undefined)=NaN)", {
      address: "Via Test 6",
      zone: { name: "Quistello", province: "Mantova", region: "Lombardia" },
    }],
    ["G: nome corto", {
      address: "Via Test 7",
      zone: { name: "A", lat: 45.5, lng: 10.2 },
    }],
    ["H: nome con spazi multipli/caso misto", {
      address: "Via Test 8",
      zone: { name: "  Corte de' Frati  ", province: "Cremona", region: "Lombardia", lat: 45.27, lng: 10.02 },
    }],
  ];

  for (const [label, body] of cases) {
    const key = body.address;
    await cleanup(key);
    const r = await post(body);
    const out = r.j.ok ? "OK" : (r.j.error || "?").slice(0, 90);
    console.log(`${label}\n   → status ${r.status}: ${out}`);
    await cleanup(key);
  }

  // zone create durante i test? le mostro
  const zones = await db.zone.findMany({ where: { source: "user" }, select: { id: true, name: true, gpsLat: true, gpsLng: true } });
  console.log("\nZone source=user nel DB:", JSON.stringify(zones, null, 1));

  await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  await db.$disconnect();
}

main().catch(e => { console.error("FATAL", e); process.exit(1); });
