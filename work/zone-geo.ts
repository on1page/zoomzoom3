// ZoomZoom — geografia delle zone: completamento di provincia e regione.
//
// Le zone del catalogo nate PRIMA della copertura nazionale (seed precedente
// o creazione manuale) possono avere i campi province/region vuoti: senza di
// loro la mappa delle reputazioni non può aggregare nulla per regione e
// provincia (admin.regions / admin.provinces restano vuoti) e i coropleti
// restano neutri anche dove le recensioni ci sono. Le zone create dal flusso
// di conferma della città nascono invece già complete (geocodifica).
//
// Questo modulo completa SOLO i campi mancanti, in due passaggi:
//   1. elenco statico dei capoluoghi di provincia (deterministico, zero rete,
//      nessuna dipendenza esterna): copre tutte le città capoluogo;
//   2. per le altre città, reverse geocoding pubblico (Nominatim) usando le
//      coordinate GIÀ presenti nella zona — stesse regole della rotta
//      /api/public/geocode/reverse: solo Italia, User-Agent dichiarato,
//      timeout, e una pausa tra le richieste per rispettare la policy
//      (massimo `maxRemote` chiamate per giro: l'azione è ripetibile).
// I campi già valorizzati non vengono mai toccati, né altro della zona.
import { db } from "@/lib/db";
import { normPlace } from "./zones";

/** Capoluoghi di provincia: nome normalizzato (normPlace) → [provincia, regione].
 *  I nomi sono quelli d'uso italiano; la mappa li traduce nei nomi del tileset
 *  (Torino→"Turin", Bolzano→"Bozen"…) tramite tilerProvinceOf/regionCanonical. */
const CAPOLUOGHI: Record<string, [string, string]> = {
  // Abruzzo
  "l aquila": ["L'Aquila", "Abruzzo"], "pescara": ["Pescara", "Abruzzo"],
  "chieti": ["Chieti", "Abruzzo"], "teramo": ["Teramo", "Abruzzo"],
  // Basilicata
  "potenza": ["Potenza", "Basilicata"], "matera": ["Matera", "Basilicata"],
  // Calabria
  "catanzaro": ["Catanzaro", "Calabria"], "reggio calabria": ["Reggio Calabria", "Calabria"],
  "cosenza": ["Cosenza", "Calabria"], "crotone": ["Crotone", "Calabria"],
  "vibo valentia": ["Vibo Valentia", "Calabria"],
  // Campania
  "napoli": ["Napoli", "Campania"], "salerno": ["Salerno", "Campania"],
  "caserta": ["Caserta", "Campania"], "benevento": ["Benevento", "Campania"],
  "avellino": ["Avellino", "Campania"],
  // Emilia-Romagna
  "bologna": ["Bologna", "Emilia-Romagna"], "parma": ["Parma", "Emilia-Romagna"],
  "modena": ["Modena", "Emilia-Romagna"], "reggio emilia": ["Reggio Emilia", "Emilia-Romagna"],
  "reggio nell emilia": ["Reggio Emilia", "Emilia-Romagna"], "ferrara": ["Ferrara", "Emilia-Romagna"],
  "ravenna": ["Ravenna", "Emilia-Romagna"], "forli": ["Forlì-Cesena", "Emilia-Romagna"],
  "cesena": ["Forlì-Cesena", "Emilia-Romagna"], "forli cesena": ["Forlì-Cesena", "Emilia-Romagna"],
  "rimini": ["Rimini", "Emilia-Romagna"], "piacenza": ["Piacenza", "Emilia-Romagna"],
  // Friuli-Venezia Giulia
  "trieste": ["Trieste", "Friuli-Venezia Giulia"], "udine": ["Udine", "Friuli-Venezia Giulia"],
  "pordenone": ["Pordenone", "Friuli-Venezia Giulia"], "gorizia": ["Gorizia", "Friuli-Venezia Giulia"],
  // Lazio
  "roma": ["Roma", "Lazio"], "latina": ["Latina", "Lazio"],
  "frosinone": ["Frosinone", "Lazio"], "viterbo": ["Viterbo", "Lazio"],
  "rieti": ["Rieti", "Lazio"],
  // Liguria
  "genova": ["Genova", "Liguria"], "la spezia": ["La Spezia", "Liguria"],
  "savona": ["Savona", "Liguria"], "imperia": ["Imperia", "Liguria"],
  // Lombardia
  "milano": ["Milano", "Lombardia"], "brescia": ["Brescia", "Lombardia"],
  "bergamo": ["Bergamo", "Lombardia"], "monza": ["Monza e Brianza", "Lombardia"],
  "varese": ["Varese", "Lombardia"], "sondrio": ["Sondrio", "Lombardia"],
  "como": ["Como", "Lombardia"], "lecco": ["Lecco", "Lombardia"],
  "lodi": ["Lodi", "Lombardia"], "mantova": ["Mantova", "Lombardia"],
  "pavia": ["Pavia", "Lombardia"], "cremona": ["Cremona", "Lombardia"],
  // Marche
  "ancona": ["Ancona", "Marche"], "pesaro": ["Pesaro e Urbino", "Marche"],
  "urbino": ["Pesaro e Urbino", "Marche"], "macerata": ["Macerata", "Marche"],
  "ascoli piceno": ["Ascoli Piceno", "Marche"], "fermo": ["Fermo", "Marche"],
  // Molise
  "campobasso": ["Campobasso", "Molise"], "isernia": ["Isernia", "Molise"],
  // Piemonte
  "torino": ["Torino", "Piemonte"], "novara": ["Novara", "Piemonte"],
  "vercelli": ["Vercelli", "Piemonte"], "verbania": ["Verbano-Cusio-Ossola", "Piemonte"],
  "biella": ["Biella", "Piemonte"], "alessandria": ["Alessandria", "Piemonte"],
  "asti": ["Asti", "Piemonte"], "cuneo": ["Cuneo", "Piemonte"],
  // Puglia
  "bari": ["Bari", "Puglia"], "barletta": ["Barletta-Andria Trani", "Puglia"],
  "andria": ["Barletta-Andria Trani", "Puglia"], "trani": ["Barletta-Andria Trani", "Puglia"],
  "foggia": ["Foggia", "Puglia"], "lecce": ["Lecce", "Puglia"],
  "taranto": ["Taranto", "Puglia"], "brindisi": ["Brindisi", "Puglia"],
  // Sardegna (il tileset conserva le province pre-2016: i nomi li risolve tilerProvinceOf)
  "cagliari": ["Cagliari", "Sardegna"], "sassari": ["Sassari", "Sardegna"],
  "nuoro": ["Nuoro", "Sardegna"], "oristano": ["Oristano", "Sardegna"],
  "olbia": ["Olbia-Tempio", "Sardegna"], "tempio pausania": ["Olbia-Tempio", "Sardegna"],
  "lanusei": ["Ogliastra", "Sardegna"], "tortoli": ["Ogliastra", "Sardegna"],
  "carbonia": ["Carbonia-Iglesias", "Sardegna"], "iglesias": ["Carbonia-Iglesias", "Sardegna"],
  "sanluri": ["Medio Campidano", "Sardegna"], "villacidro": ["Medio Campidano", "Sardegna"],
  // Sicilia
  "palermo": ["Palermo", "Sicilia"], "catania": ["Catania", "Sicilia"],
  "messina": ["Messina", "Sicilia"], "siracusa": ["Siracusa", "Sicilia"],
  "ragusa": ["Ragusa", "Sicilia"], "caltanissetta": ["Caltanissetta", "Sicilia"],
  "agrigento": ["Agrigento", "Sicilia"], "trapani": ["Trapani", "Sicilia"],
  "enna": ["Enna", "Sicilia"],
  // Toscana
  "firenze": ["Firenze", "Toscana"], "pisa": ["Pisa", "Toscana"],
  "siena": ["Siena", "Toscana"], "arezzo": ["Arezzo", "Toscana"],
  "livorno": ["Livorno", "Toscana"], "lucca": ["Lucca", "Toscana"],
  "pistoia": ["Pistoia", "Toscana"], "prato": ["Prato", "Toscana"],
  "grosseto": ["Grosseto", "Toscana"], "massa": ["Massa-Carrara", "Toscana"],
  "carrara": ["Massa-Carrara", "Toscana"],
  // Trentino-Alto Adige
  "trento": ["Trento", "Trentino-Alto Adige"], "bolzano": ["Bolzano", "Trentino-Alto Adige"],
  // Umbria
  "perugia": ["Perugia", "Umbria"], "terni": ["Terni", "Umbria"],
  // Valle d'Aosta
  "aosta": ["Aosta", "Valle d'Aosta"],
  // Veneto
  "venezia": ["Venezia", "Veneto"], "verona": ["Verona", "Veneto"],
  "padova": ["Padova", "Veneto"], "vicenza": ["Vicenza", "Veneto"],
  "treviso": ["Treviso", "Veneto"], "belluno": ["Belluno", "Veneto"],
  "rovigo": ["Rovigo", "Veneto"],
};

export type ZoneGeoEsito = {
  id: string;
  name: string;
  province: string | null;
  region: string | null;
  via: "elenco" | "geocoder";
};

export type ZoneGeoReport = {
  totale: number;
  giaComplete: number;
  completate: ZoneGeoEsito[];
  nonRisolte: Array<{ id: string; name: string; motivo: string }>;
  chiamateRete: number;
};

/** Reverse geocoding: dalle coordinate della zona ricava provincia e regione
 *  (Nominatim, zoom 10 = livello provinciale). null se non risponde o se il
 *  punto non è in Italia. */
async function reverseGeo(lat: number, lng: number): Promise<{ province: string | null; region: string | null } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "it");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ZoomZoom/1.0 (portale recensioni casa; uso interno geocoding)" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: { county?: string; state?: string; region?: string; country_code?: string } };
    const a = data.address || {};
    if ((a.country_code || "").toLowerCase() !== "it") return null;
    const province = a.county ? a.county.trim().slice(0, 60) : null;
    const region = (a.state || a.region || "").trim().slice(0, 60) || null;
    return province || region ? { province, region } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Completa province/regione delle zone che non le hanno. Aggiorna solo i
 * campi mancanti (mai quelli già valorizzati) e nient'altro. L'azione è
 * idempotente e ripetibile: ogni giro interroga il geocoder pubblico per al
 * massimo `maxRemote` città (le altre restano da completare al giro dopo).
 */
export async function backfillZoneGeo(maxRemote = 8): Promise<ZoneGeoReport> {
  const zones = await db.zone.findMany({ orderBy: { name: "asc" } });
  const report: ZoneGeoReport = {
    totale: zones.length,
    giaComplete: 0,
    completate: [],
    nonRisolte: [],
    chiamateRete: 0,
  };
  for (const z of zones) {
    const prov = (z.province || "").trim() || null;
    const reg = (z.region || "").trim() || null;
    if (prov && reg) {
      report.giaComplete += 1;
      continue;
    }

    // 1) elenco statico dei capoluoghi (zero rete)
    const statico = CAPOLUOGHI[normPlace(z.name)];
    if (statico) {
      const np = prov || statico[0];
      const nr = reg || statico[1];
      await db.zone.update({ where: { id: z.id }, data: { province: np, region: nr } });
      report.completate.push({ id: z.id, name: z.name, province: np, region: nr, via: "elenco" });
      continue;
    }

    // 2) geocoder pubblico, entro il budget di rete del giro
    if (report.chiamateRete < maxRemote) {
      if (report.chiamateRete > 0) await new Promise(r => setTimeout(r, 1100)); // policy: max 1 richiesta al secondo
      report.chiamateRete += 1;
      const g = await reverseGeo(z.gpsLat, z.gpsLng);
      if (g) {
        const np = prov || g.province;
        const nr = reg || g.region;
        if (np || nr) {
          await db.zone.update({ where: { id: z.id }, data: { ...(np ? { province: np } : {}), ...(nr ? { region: nr } : {}) } });
          report.completate.push({ id: z.id, name: z.name, province: np, region: nr, via: "geocoder" });
          continue;
        }
      }
      report.nonRisolte.push({ id: z.id, name: z.name, motivo: "il geocoder pubblico non ha risposto per questa città: riprova tra poco" });
      continue;
    }

    report.nonRisolte.push({ id: z.id, name: z.name, motivo: "troppe città per un solo giro (limite del geocoder): premi di nuovo il pulsante" });
  }
  return report;
}
