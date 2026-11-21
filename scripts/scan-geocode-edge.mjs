// Battery of realistic queries to /api/public/geocode: looks for results that
// would make ensureZone fail (name < 2 chars, coords out of Italy bounds).
const BASE = "http://localhost:3000";
const QUERIES = [
  "Via dei Mille 15 Milano",
  "Milano",
  "Roma",
  "Napoli Via Roma 10",
  "Quistello",
  "Corte de' Frati",
  "Marciaga",
  "Alassio",
  "Morterone",
  "Strada Morterone Frasnida",
  "Borgo San Lorenzo",
  "Reggio Calabria",
  "Ala",
  "Re",
  "Ne",
  "Vo",
  "Ro",
  "Isola d'Elba",
  "Lampedusa",
  "Cortina d'Ampezzo",
  "Santa Lucia di Piave",
  "San Martino in Passiria",
  "Curon Venosta",
  "Sappada",
  "Sauris",
  "Timau",
  "Palmanova",
  "Gorizia",
  "Trieste",
  "Muggia",
  "Lugano",
  "Campione d'Italia",
  "Livigno",
  "Predappio",
];

const inItaly = (lat, lng) => lat >= 34 && lat <= 48.5 && lng >= 5.5 && lng <= 19.5;

for (const q of QUERIES) {
  try {
    const res = await fetch(`${BASE}/api/public/geocode?q=${encodeURIComponent(q)}`);
    const j = await res.json();
    const rows = j.results || [];
    for (const r of rows) {
      const nameBad = !r.zoneName || String(r.zoneName).trim().length < 2;
      const coordsBad = !Number.isFinite(r.lat) || !Number.isFinite(r.lng) || !inItaly(r.lat, r.lng);
      if (nameBad || coordsBad) {
        console.log(`PROBLEMA  q=${q}`);
        console.log(`   → name="${r.zoneName}" lat=${r.lat} lng=${r.lng} label="${r.label}"`);
      }
    }
    if (!rows.length) console.log `(vuoto: ${q})`;
  } catch (e) {
    console.log("ERRORE fetch", q, e.message);
  }
}
console.log("Scansione completata.");
