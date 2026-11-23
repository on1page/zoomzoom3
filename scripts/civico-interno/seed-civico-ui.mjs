// Semina 2 schede di test allo stesso civico per la verifica UI del blocco
// "Stesso indirizzo" (Via dei Mille 15, Alassio: interno 4 + edificio).
// Stampa gli id creati, per la pulizia successiva.
const BASE = "http://localhost:3000";
const TOKEN = process.argv[2];
const cookie = `zz_session=${TOKEN}`;

async function post(body) {
  const res = await fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const via = "Via dei Mille";
const r1 = await post({ address: via, streetNumber: "15", unit: "interno 4", zoneId: "alassio" });
const r2 = await post({ address: via, streetNumber: "15", zoneId: "alassio" });
console.log(JSON.stringify({
  interno4: { status: r1.status, id: r1.json?.entity?.id ?? r1.json?.existingId ?? null },
  edificio: { status: r2.status, id: r2.json?.entity?.id ?? r2.json?.existingId ?? null },
}));
