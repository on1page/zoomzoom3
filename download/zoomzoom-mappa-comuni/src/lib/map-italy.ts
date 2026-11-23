// ZoomZoom — geometrie e nomi dell'Italia per la mappa delle reputazioni.
//
// La mappa colora il territorio per livello amministrativo:
//   - REGIONI (vista Italia): confini ISTAT ufficiali in GeoJSON locale
//     (public/regioni-italia.geojson, semplificati) — il tileset Countries
//     di MapTiler per l'Italia NON contiene le regioni;
//   - PROVINCE (zoom intermedio): tileset Countries di MapTiler, layer
//     "administrative" con level = 1 (per l'Italia le divisioni di primo
//     livello sono le province, 110 poligoni con codice ISO 3166-2);
//   - COMUNI (zoom ravvicinato/ricerca): confini ISTAT ufficiali in
//     GeoJSON locale, UN FILE PER REGIONE (public/comuni/r{codice}.geojson,
//     vintage 1° gennaio 2026, 7.895 comuni): la mappa carica on demand le
//     regioni in vista e mostra la suddivisione di TUTTI i comuni d'Italia;
//     il geocoder pubblico (Nominatim) resta come riserva per le città del
//     catalogo il cui nome non corrisponde alla denominazione ISTAT.
//
// I nomi del tileset MapTiler non always coincidono con i nomi italiani
// d'uso (Torino → "Turin", Bolzano → "Bozen", Aosta → "Aoste", e persino
// "Crotene"/"Oristrano"): questo modulo normalizza e traduce, così gli
// aggregati del database trovano sempre il poligono giusto.

/** Normalizza un nome di luogo per il confronto: minuscolo, senza accenti,
 *  apostrofi e punteggiatura come separatori, trattini come spazi, spazi
 *  compressi. La stessa funzione vale per i nomi del database E per quelli
 *  del tileset: le forme con l'apostrofo restano coerenti su entrambi i
 *  lati ("L'Aquila" → "l aquila" ovunque). */
export function normName(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`´]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ------------------------------ REGIONI ------------------------------ */

/** Nomi canonici delle 20 regioni (come nel GeoJSON ISTAT locale). */
export const REGIONI_ISTAT = [
  "Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna",
  "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche",
  "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana",
  "Trentino-Alto Adige/Südtirol", "Umbria", "Valle d'Aosta/Vallée d'Aoste", "Veneto",
] as const;

const REGIONI_NORM = new Map(REGIONI_ISTAT.map(r => [normName(r), r]));

/** Varianti con cui il geocoder (Nominatim) può restituire una regione:
 *  nome normalizzato → nome canonico del GeoJSON. */
const REGIONI_ALIAS: Record<string, string> = {
  "valle d aosta": "Valle d'Aosta/Vallée d'Aoste",
  "vallee d aoste": "Valle d'Aosta/Vallée d'Aoste",
  "aosta": "Valle d'Aosta/Vallée d'Aoste",
  "trentino alto adige": "Trentino-Alto Adige/Südtirol",
  "trentino alto adige sudtirol": "Trentino-Alto Adige/Südtirol",
  "alto adige": "Trentino-Alto Adige/Südtirol",
  "sudtirol": "Trentino-Alto Adige/Südtirol",
  "trentino": "Trentino-Alto Adige/Südtirol",
};

/** Riporta il nome canonico della regione (quello del GeoJSON ISTAT)
 *  a partire da qualsiasi forma: "Valle d'Aosta", "Vallee d'Aoste",
 *  "Trentino-Alto Adige/Sudtirol"… null se non è una regione italiana. */
export function regionCanonical(raw: unknown): string | null {
  const n = normName(raw);
  if (!n) return null;
  return REGIONI_ALIAS[n] || REGIONI_NORM.get(n) || null;
}

/* ------------------------------ PROVINCE ----------------------------- */

/** Nomi ESATTI delle 110 divisioni di livello 1 dell'Italia nel tileset
 *  Countries di MapTiler (estratti dai dati pubblici del tileset: sono le
 *  chiavi del match sull'espressione fill-color, quindi vanno letterali). */
export const TILER_PROVINCE = [
  "Agrigento", "Alessandria", "Ancona", "Aoste", "Arezzo", "Ascoli Piceno",
  "Asti", "Avellino", "Bari", "Barletta-Andria Trani", "Belluno", "Benevento",
  "Bergamo", "Biella", "Bologna", "Bozen", "Brescia", "Brindisi", "Cagliari",
  "Caltanissetta", "Campobasso", "Carbonia-Iglesias", "Caserta", "Catania",
  "Catanzaro", "Chieti", "Como", "Cosenza", "Cremona", "Crotene", "Cuneo",
  "Enna", "Fermo", "Ferrara", "Firenze", "Foggia", "Forlì-Cesena", "Frosinone",
  "Genova", "Gorizia", "Grosseto", "Imperia", "Isernia", "L'Aquila",
  "La Spezia", "Latina", "Lecce", "Lecco", "Livorno", "Lodi", "Lucca",
  "Macerata", "Mantova", "Massa-Carrara", "Matera", "Medio Campidano",
  "Messina", "Milano", "Modena", "Monza e Brianza", "Napoli", "Novara",
  "Nuoro", "Ogliastra", "Olbia-Tempio", "Oristrano", "Padova", "Palermo",
  "Parma", "Pavia", "Perugia", "Pesaro e Urbino", "Pescara", "Piacenza",
  "Pisa", "Pistoia", "Pordenone", "Potenza", "Prato", "Ragusa", "Ravenna",
  "Reggio Calabria", "Reggio Emilia", "Rieti", "Rimini", "Roma", "Rovigo",
  "Salerno", "Sassari", "Savona", "Siena", "Siracusa", "Sondrio", "Taranto",
  "Teramo", "Terni", "Trapani", "Trento", "Treviso", "Trieste", "Turin",
  "Udine", "Varese", "Venezia", "Verbano-Cusio-Ossola", "Vercelli", "Verona",
  "Vibo Valentia", "Vicenza", "Viterbo",
] as const;

const TILER_PROVINCE_NORM = new Map(TILER_PROVINCE.map(p => [normName(p), p]));

/** Prefissi che il geocoder a volte aggiunge al nome della provincia. */
const PROV_PREFIX =
  /^(citta metropolitana di|citta metropolitana|provincia di|provincia|regione autonoma di|regione autonoma della|regione della|free province of)\s+/;

/** Varianti note: nome normalizzato d'uso (Nominatim/ISTAT) → nome ESATTO
 *  del tileset Countries (normalizzato). "Crotene" e "Oristrano" sono i
 *  nomi usati nei dati MapTiler (refusi nei dati ufficiali del tileset). */
const PROVINCE_ALIAS: Record<string, string> = {
  "torino": "turin",
  "bolzano": "bozen",
  "alto adige": "bozen",
  "sudtirol": "bozen",
  "aosta": "aoste",
  "valle d aosta": "aoste",
  "crotone": "crotene",
  "oristano": "oristrano",
  "reggio nell emilia": "reggio emilia",
  "reggio emilia": "reggio emilia",
  "roma capitale": "roma",
  "massa": "massa carrara",
  "barletta andria trani": "barletta andria trani",
  "pesaro urbino": "pesaro e urbino",
  "monza brianza": "monza e brianza",
  "verbano cusio ossola": "verbano cusio ossola",
  "carbonia iglesias": "carbonia iglesias",
  "medio campidano": "medio campidano",
  // province soppresse della Sardegna (2016): nomi alternativi d'uso
  "olbia tempio": "olbia tempio",
  "ogliastra": "ogliastra",
  "lanusei": "ogliastra",
  "tempio pausania": "olbia tempio",
};

/** Traduce il nome della provincia come arriva dal database (Nominatim,
 *  es. "Torino", "Reggio nell'Emilia", "Città metropolitana di Milano")
 *  nel nome ESATTO del poligono di livello 1 del tileset Countries.
 *  null se non c'è corrispondenza (il poligono resta neutro).
 *  Nota: la "Sud Sardegna" (istituita nel 2016) non esiste nel tileset,
 *  che conserva le vecchie province sarde: nessuna corrispondenza. */
export function tilerProvinceOf(raw: unknown): string | null {
  let n = normName(raw);
  if (!n) return null;
  for (let i = 0; i < 3 && PROV_PREFIX.test(n); i++) n = n.replace(PROV_PREFIX, "").trim();
  n = PROVINCE_ALIAS[n] || n;
  return TILER_PROVINCE_NORM.get(n) || null;
}

/* ------------------------------ COMUNI ------------------------------ */

/** Codice ISTAT delle 20 regioni (nome canonico → codice): i confini
 *  comunali sono raggruppati per regione in public/comuni/r{codice}.geojson
 *  (dati ISTAT, 1° gennaio 2026) e la mappa li carica on demand quando la
 *  vista interessa una regione. */
export const REGIONI_ISTAT_CODE: Record<string, number> = {
  "Piemonte": 1, "Valle d'Aosta/Vallée d'Aoste": 2, "Lombardia": 3,
  "Trentino-Alto Adige/Südtirol": 4, "Veneto": 5, "Friuli-Venezia Giulia": 6,
  "Liguria": 7, "Emilia-Romagna": 8, "Toscana": 9, "Umbria": 10,
  "Marche": 11, "Lazio": 12, "Abruzzo": 13, "Molise": 14, "Campania": 15,
  "Puglia": 16, "Basilicata": 17, "Calabria": 18, "Sicilia": 19,
  "Sardegna": 20,
};

/** URL del GeoJSON dei comuni di una regione (accetta il nome in qualsiasi
 *  forma; null se non è una regione italiana). */
export function comuniFileFor(raw: unknown): string | null {
  const c = regionCanonical(raw);
  if (!c) return null;
  const code = REGIONI_ISTAT_CODE[c];
  return code ? `/comuni/r${code}.geojson` : null;
}

/** Denominazione italiana di un comune bilingue (parte prima di "/"):
 *  i file ISTAT scrivono "Bolzano/Bozen", il geocoder "Bolzano" — la chiave
 *  di confronto si calcola sempre su questa forma base. */
export function comuneBaseName(raw: unknown): string {
  return String(raw ?? "").split("/")[0].trim();
}

/** Varianti note tra il nome che restituisce il geocoder (OSM/Nominatim,
 *  usato per le zone del catalogo) e la denominazione ufficiale ISTAT del
 *  comune: chiave normalizzata geocoder → chiave normalizzata ISTAT.
 *  Estendere qui se una città del catalogo non trova il proprio poligono
 *  nei file ISTAT (cade comunque sul contorno del geocoder). */
const COMUNI_ALIAS: Record<string, string> = {
  // ISTAT dal 2023: "Reggio di Calabria"; il geocoder restituisce "Reggio Calabria"
  "reggio calabria": "reggio di calabria",
};

/** Chiave di confronto di un comune: denominazione base normalizzata, con
 *  le varianti note applicate. È la funzione da usare SEMPRE per mettere
 *  in corrispondenza le zone del catalogo e i confini comunali (colori del
 *  coropleto, collegamenti alle schede, ripiego geocoder). */
export function comuneKey(raw: unknown): string {
  const n = normName(comuneBaseName(raw));
  return COMUNI_ALIAS[n] || n;
}
