// ZoomZoom — normalizzazione degli indirizzi degli immobili (modulo PURO,
// senza dipendenze: lo importano sia le API del server sia i componenti
// client, così le regole di confronto sono sempre le stesse).
//
// L'indirizzo di un immobile ha TRE parti, perché in una via, piazza o largo
// ci sono più edifici (civici diversi) e nello stesso civico possono esserci
// più unità abitative (condomini: interno, scala…):
//
//   address      via, piazza, largo… ("Via dei Mille")
//   streetNumber civico ("15", "15/A", "12bis")
//   unit         interno/scala, facoltativo ("interno 4", "scala B interno 4")
//
// La discriminante della scheda è via + civico + interno nella stessa città:
// stesso indirizzo ma interno diverso = scheda DIVERSA (nuova recensione).

// maiuscole, accenti e punteggiatura non devono creare schede duplicate
export function normAddress(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// civico: numeri e lettere, senza spazi né punteggiatura ("15/A" → "15a",
// "12 bis" → "12bis") così le varianti di scrittura coincidono
export function normCivico(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// interno/scala: espande le abbreviazioni (int. → interno, sc. → scala) e
// ordina i termini, così "scala B interno 4" ≡ "interno 4 scala B".
// La stringa vuota ("" ) è l'edificio senza unità indicate.
export function normUnit(s: string): string {
  const t = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bint\b\.?/g, "interno").replace(/\bsc\b\.?/g, "scala")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.split(" ").sort().join(" ");
}

// separa il civico dalla coda di un indirizzo scritto di fila
// ("Via dei Mille 15" → via "Via dei Mille" + civico "15"; "Via Roma 12/B" →
// civico "12/B"; "Via 4 Novembre" resta senza civico). Serve per i client
// vecchi che mandano tutto in un campo solo.
export function splitStreetCivico(s: string): { street: string; civico: string } {
  const m = s.match(/^(.*?)[\s,]+(\d{1,4}\s?[a-z]?)(?:\s*\/\s*(\d{1,3}))?\s*$/i);
  if (!m) return { street: s.trim(), civico: "" };
  const civico = (m[2] + (m[3] ? `/${m[3]}` : "")).replace(/\s+/g, "");
  return { street: m[1].replace(/[\s,]+$/, "").trim(), civico };
}

export type BuildingTarget = {
  street: string;    // via/piazza richiesta
  civico: string;    // civico richiesto
  fullNorm: string;  // normAddress("via civico") — confronto con le schede storiche
  zoneNorm: string;  // normAddress(città) — suffisso ", città" delle schede d'epoca
};

export type BuildingCandidate = {
  name: string;
  address: string | null;
  streetNumber: string | null;
};

// vero se la scheda esistente sta nello STESSO edificio (stessa via e stesso
// civico), a prescindere dall'interno: è il presupposto per proporre il
// riuso o per segnalare i "fratelli" di un condominio.
export function sameBuilding(e: BuildingCandidate, t: BuildingTarget): boolean {
  // scheda con civico strutturato (nuove): confronto via e civico separati
  if (e.streetNumber) {
    return normAddress(e.address || "") === normAddress(t.street)
      && normCivico(e.streetNumber) === normCivico(t.civico);
  }
  // scheda storica: il civico è dentro address (con eventuale suffisso città)
  const a = normAddress(e.address || e.name);
  return a === t.fullNorm || a === `${t.fullNorm} ${t.zoneNorm}`;
}

// indirizzo di display: via + civico ("Via dei Mille 15")
export function dispAddress(address: string | null | undefined, streetNumber?: string | null): string {
  return [address, streetNumber].filter(Boolean).join(" ");
}
