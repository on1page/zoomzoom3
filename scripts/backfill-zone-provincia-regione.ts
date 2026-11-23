// ZoomZoom — BACKFILL provincia/regione delle ZONE esistenti.
// Uso:   bun scripts/backfill-zone-provincia-regione.ts [--dry-run]
//
// PERCHÉ SERVE
// ------------
// La mappa delle reputazioni colora REGIONI e PROVINCE aggregando le
// recensioni per territorio: l'aggregato si può calcolare solo se le zone
// del catalogo hanno i campi province/region valorizzati. Questi campi
// vengono compilati in automatico dal geocoder quando si conferma una
// città nel flusso di recensione (aggiornamento "conferma indirizzo" in
// poi) — ma tutte le zone create PRIMA di quell'aggiornamento (per
// esempio le città demo o le zone inserite a mano) li hanno VUOTI, e
// sulla mappa non si colora né la regione né la provincia, con o senza
// filtri per criterio.
//
// COSA FA
// -------
// Per ogni zona con provincia o regione mancante chiede al geocoder
// pubblico Nominatim (stesso servizio già usato dal sito) i dati
// amministrativi a partire dalle COORDINATE della zona (le zone li hanno
// sempre): county → provincia, state → regione. Se il reverse non trova
// la provincia, ritenta con la ricerca per NOME della zona. Aggiorna SOLO
// i campi mancanti (non tocca quelli già compilati). Rispetta la policy
// Nominatim (max 1 richiesta al secondo). Rilanciabile quante volte si
// vuole: le zone già complete vengono ignorate.
//
// --dry-run : mostra cosa farebbe senza scrivere nulla.
//
// NOTA: lo script usa il DATABASE_URL del file .env del progetto (lo
// stesso del sito): eseguito dal progetto in locale aggiorna il database
// di produzione, quello che vede anche Vercel.

import { PrismaClient } from "@prisma/client";
import { regionCanonical } from "../src/lib/map-italy";

const db = new PrismaClient();
const DRY = process.argv.includes("--dry-run");
const UA = "ZoomZoom/1.0 (portale recensioni casa; uso interno geocoding)";

type NominatimAddress = {
  city?: string; town?: string; village?: string; municipality?: string; hamlet?: string;
  county?: string; state?: string; region?: string; country_code?: string;
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** provincia "in forma breve" dalla county di Nominatim:
 *  "Città metropolitana di Milano" → "Milano", "Provincia di Savona" → "Savona" */
function shortProvince(county: string | undefined | null): string | null {
  if (!county) return null;
  const c = county.trim();
  const m = /^(?:città metropolitana|provincia|libero consorzio|regional decentralization entity)\s+(?:di|dell['’]|del|della)?\s*(.+)$/i.exec(c);
  return (m ? m[1] : c).trim() || null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** reverse geocoding dalle coordinate della zona */
async function reverseGeo(lat: number, lng: number): Promise<NominatimAddress | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("accept-language", "it");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "10"); // livello provinciale
  const r = await fetchJson<{ address?: NominatimAddress }>(url.toString());
  return r?.address || null;
}

/** ricerca per nome (fallback se il reverse non trova la provincia) */
async function searchGeo(name: string): Promise<NominatimAddress | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${name}, Italia`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "it");
  url.searchParams.set("accept-language", "it");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "3");
  const rows = await fetchJson<Array<{ address?: NominatimAddress }>>(url.toString());
  if (!rows?.length) return null;
  // primo risultato con provincia e regione nell'indirizzo
  return rows.find(r => r.address?.county && (r.address.state || r.address.region))?.address || null;
}

async function main() {
  const zones = await db.zone.findMany({ orderBy: { name: "asc" } });
  const todo = zones.filter(z => !z.province || !z.region);
  console.log(`Zone totali: ${zones.length} · con provincia/regione mancante: ${todo.length}${DRY ? " · DRY-RUN (nessuna scrittura)" : ""}`);
  if (!todo.length) { console.log("Niente da fare: tutte le zone hanno già provincia e regione."); return; }

  let updated = 0, failed: Array<{ name: string; why: string }> = [];
  for (const z of todo) {
    process.stdout.write(`- ${z.name} … `);
    let addr = await reverseGeo(z.gpsLat, z.gpsLng);
    await sleep(1100);
    if (!addr?.county) {
      addr = (await searchGeo(z.name)) || addr;
      await sleep(1100);
    }
    const province = z.province || shortProvince(addr?.county);
    const regionRaw = z.region || addr?.state || addr?.region || null;
    const region = z.region || (regionRaw ? regionCanonical(regionRaw) || regionRaw.trim() : null);
    if (!province || !region) {
      failed.push({ name: z.name, why: `geocoder non ha restituito ${!province && !region ? "provincia né regione" : !province ? "la provincia" : "la regione"} (coordinate ${z.gpsLat}, ${z.gpsLng})` });
      console.log(`NON RISOLTA (${!province ? "provincia" : ""}${!province && !region ? " e " : ""}${!region ? "regione" : ""} mancanti)`);
      continue;
    }
    console.log(`${z.name}${z.province ? "" : ` · provincia: ${province}`}${z.region ? "" : ` · regione: ${region}`}  ${DRY ? "(dry-run)" : "→ salvata"}`);
    if (!DRY) {
      await db.zone.update({
        where: { id: z.id },
        data: {
          province: z.province || province.slice(0, 60),
          region: z.region || region.slice(0, 60),
        },
      });
    }
    updated++;
  }

  console.log("\n--- RISULTATO ---");
  console.log(`Zone aggiornate: ${updated}/${todo.length}`);
  if (failed.length) {
    console.log(`Non risolte: ${failed.length}`);
    for (const f of failed) console.log(`  · ${f.name}: ${f.why}`);
    console.log("Rilancia lo script più tardi (il geocoder pubblico può rifiutare qualche richiesta).");
  }
  if (!DRY && updated > 0) {
    console.log("\nOra sulla mappa tornano a colorarsi regioni e province (anche con i");
    console.log("pulsanti Criterio). Se qualche regione resta neutra, dipende dalla soglia");
    console.log("di pubblicazione degli aggregati: servono almeno 3 recensioni nel territorio.");
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
