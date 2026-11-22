// Test runtime: indirizzo strutturato (via + civico + interno) nel flusso
// di contributo. Scenari:
//   T1 crea "Via dei Test Civico 15, interno 4"        → 201 (nuova scheda)
//   T2 ricrea lo stesso interno                         → 409 existingId (dedup)
//   T3 stesso civico, interno diverso ("scala B int 4") → 201 (nuova scheda)
//   T4 stesso civico, senza interno (edificio)          → 201 (nuova scheda)
//   T5 civico diverso (15/A), stesso interno            → 201 (nuova scheda)
//   T6 building: schede dello stesso civico 15          → 3 righe
//   T7 retrocompat: address scritto di fila "… 15" senza unit → 409 (edificio)
//   T8 tolleranza ordine: "4 interno" ≡ "interno 4"     → 409 (stessa scheda T1)
//   T9 unit simile non è uguale: "interno 5"            → 201
// Alla fine cancella le schede di test dal catalogo.
const BASE = "http://localhost:3000";
const TOKEN = process.argv[2];
const ZONA = "alassio";

if (!TOKEN) { console.error("uso: bun test-civico-interno.mjs <TOKEN>"); process.exit(1); }

const cookie = `zz_session=${TOKEN}`;
let created = []; // id delle schede di test, per la pulizia
let fails = 0;

async function post(body) {
  const res = await fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function check(name, cond, extra = "") {
  const tag = cond ? "OK " : "FAIL";
  if (!cond) fails++;
  console.log(`[${tag}] ${name}${extra ? ` — ${extra}` : ""}`);
}

const via = "Via dei Test Civico";

// T1 — nuova scheda con interno
{
  const r = await post({ address: via, streetNumber: "15", unit: "interno 4", zoneId: ZONA });
  created.push(r.json?.entity?.id);
  check("T1 crea via+civico+interno", r.status === 200 && r.json?.ok && r.json?.entity?.name === `${via} 15, interno 4`,
    r.json?.entity?.name || JSON.stringify(r.json).slice(0, 120));
  check("T1 campi strutturati salvati", r.json?.entity?.streetNumber === "15" && r.json?.entity?.unit === "interno 4");
}

// T2 — dedup esatto (stesso interno)
{
  const r = await post({ address: via, streetNumber: "15", unit: "interno 4", zoneId: ZONA });
  check("T2 dedup stesso interno → 409", r.status === 409 && !!r.json?.existingId, `status=${r.status}`);
}

// T3 — stesso civico, interno diverso → nuova scheda
{
  const r = await post({ address: via, streetNumber: "15", unit: "scala B, interno 4", zoneId: ZONA });
  created.push(r.json?.entity?.id);
  check("T3 stesso civico, interno diverso → nuova", r.status === 200 && r.json?.ok,
    r.json?.entity?.name || JSON.stringify(r.json).slice(0, 120));
}

// T4 — stesso civico, senza interno (edificio)
{
  const r = await post({ address: via, streetNumber: "15", zoneId: ZONA });
  created.push(r.json?.entity?.id);
  check("T4 edificio senza interno → nuova", r.status === 200 && r.json?.ok && r.json?.entity?.unit === null,
    r.json?.entity?.name || JSON.stringify(r.json).slice(0, 120));
}

// T5 — civico diverso, stesso interno
{
  const r = await post({ address: via, streetNumber: "15/A", unit: "interno 4", zoneId: ZONA });
  created.push(r.json?.entity?.id);
  check("T5 civico diverso (15/A) → nuova", r.status === 200 && r.json?.ok && r.json?.entity?.streetNumber === "15/A",
    r.json?.entity?.name || JSON.stringify(r.json).slice(0, 120));
}

// T6 — building: schede dello stesso civico 15 (non 15/A)
{
  const res = await fetch(`${BASE}/api/public/building?zona=${ZONA}&via=${encodeURIComponent(via)}&civico=15`);
  const j = await res.json();
  const units = (j.rows || []).map(r => r.unit || "(edificio)").sort();
  check("T6 building: 3 schede al civico 15", res.status === 200 && j.rows?.length === 3, units.join(" | "));
}

// T7 — retrocompatibilità: indirizzo scritto di fila, senza interno → 409 (edificio T4)
{
  const r = await post({ address: `${via} 15`, zoneId: ZONA });
  check("T7 retrocompat address di fila → 409 edificio", r.status === 409, `status=${r.status}`);
}

// T8 — tolleranza all'ordine delle parole nell'interno
{
  const r = await post({ address: via, streetNumber: "15", unit: "4 interno", zoneId: ZONA });
  check("T8 ordine parole interno («4 interno» ≡ «interno 4») → 409", r.status === 409, `status=${r.status}`);
}

// T9 — interno davvero diverso → nuova scheda
{
  const r = await post({ address: via, streetNumber: "15", unit: "interno 5", zoneId: ZONA });
  created.push(r.json?.entity?.id);
  check("T9 interno 5 → nuova scheda", r.status === 200 && r.json?.ok, r.json?.entity?.name || "");
}

// pulizia: rimuove le schede di test (nessuna recensione associata)
{
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  for (const id of created.filter(Boolean)) {
    await db.entity.deleteMany({ where: { id } });
  }
  const left = await db.entity.count({ where: { zoneId: ZONA, address: via } });
  await db.$disconnect();
  check("pulizia schede di test", left === 0, `residue=${left}`);
}

console.log(fails === 0 ? "\nTUTTI I TEST SUPERATI" : `\n${fails} TEST FALLITI`);
process.exit(fails === 0 ? 0 : 1);
