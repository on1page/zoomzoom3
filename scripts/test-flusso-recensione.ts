// Test end-to-end: il flusso esatto dell'utente (account demo Arianna_84)
// 1) login → 2) creazione scheda immobile a Laveno-Mombello → 3) recensione
// 4) verifica che la mappa pubblichi comune e provincia di Varese
const BASE = process.env.BASE_URL || "http://localhost:3000";
let cookie = "";

async function j(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() || [];
  if (sc.length) cookie = sc.map(c => c.split(";")[0]).join("; ");
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* vuota */ }
  return { status: res.status, data };
}

async function main() {
  // 1) login
  const login = await j("POST", "/api/auth/login", { email: "utente@esempio.test", password: "ZoomZoom-Demo-2026" });
  console.log("LOGIN:", login.status, JSON.stringify(login.data).slice(0, 120));
  if (login.status !== 200 || !login.data.ok) throw new Error("login fallito");

  // 2) scheda immobile: Piazza Dante 6, Laveno-Mombello (il test dell'utente)
  const ent = await j("POST", "/api/entities", {
    address: "Piazza Dante",
    streetNumber: "6",
    zone: { name: "Laveno-Mombello", province: "Varese", region: "Lombardia", lat: 45.897493, lng: 8.59662 },
    geo: { lat: 45.8999, lng: 8.6011 },
  });
  console.log("NUOVA SCHEDE IMMOBILE:", ent.status, JSON.stringify(ent.data).slice(0, 220));
  let entity = (ent.data as { entity?: { id?: string; name?: string; zone?: { name?: string } } }).entity;
  // già presente (esecuzione precedente del test): si usa la scheda esistente
  if (!entity?.id && ent.status === 409) {
    const existingId = (ent.data as { existingId?: string }).existingId;
    if (existingId) entity = { id: existingId };
    console.log("SCHEDE GIÀ ESISTENTE (409):", existingId);
  }
  if (!entity?.id) throw new Error("creazione scheda fallita: " + JSON.stringify(ent.data));

  // 3) recensione: voto complessivo 6, criteri realistici
  const rev = await j("POST", "/api/reviews", {
    entityId: entity.id,
    experienceKind: "Abitazione in affitto",
    score: 6,
    honesty: true,
    criteria: { stato: 6, descrizione: 6, spazi: 5, rumori: 7, impianti: 5, rapporto: 6 },
    pros: ["Posizione tranquilla"],
    cons: ["Riscaldamento datato"],
    text: "Appartamento dignitoso con posizione tranquilla vicino al lungolago; l'impianto di riscaldamento è datato e andrebbe revisionato, ma gli spazi sono vivibili e luminosi. Prova completa del flusso di pubblicazione con la connessione al database corretta.",
  });
  console.log("RECENSIONE:", rev.status, JSON.stringify(rev.data).slice(0, 260));
  if (rev.status !== 200 || !rev.data.ok) throw new Error("recensione fallita: " + JSON.stringify(rev.data));

  // 4) la mappa ora pubblica comune e provincia?
  const map = await j("GET", "/api/public/map");
  const md = map.data as {
    zones?: Array<{ name: string; place: { mean: number; n: number } | null; placeCount: number }>;
    admin?: { provinces: Array<{ name: string; mean: number; n: number }>; provincesPending: Array<{ name: string; n: number }> };
  };
  const laveno = md.zones?.find(z => z.name.includes("Laveno"));
  console.log("MAPPA · LAVENO:", laveno ? JSON.stringify({ place: laveno.place, placeCount: laveno.placeCount }) : "non trovata");
  const varese = md.admin?.provinces.find(p => p.name.includes("Varese"));
  const varesePend = md.admin?.provincesPending.find(p => p.name.includes("Varese"));
  console.log("MAPPA · PROVINCIA VARESE:", varese ? JSON.stringify(varese) : varesePend ? `in attesa: ${JSON.stringify(varesePend)}` : "assente");
  console.log("\nRISULTATO:", laveno?.place && varese ? "COMUNE E PROVINCIA COLORABILI — SUCCESSO" : "ancora soppresse");
}

main().catch(e => { console.error("TEST FALLITO:", e.message); process.exit(1); });
