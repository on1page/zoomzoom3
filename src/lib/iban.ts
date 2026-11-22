// ZoomZoom — validazione IBAN condivisa (browser e server, zero dipendenze).
// Controlli: struttura, lunghezza per paese (registro IBAN ufficiale) e
// codice di controllo ISO 7064 mod-97. Per l'Italia anche la forma del BBAN
// (CIN + ABI + CAB + conto). Non verifica l'intestatario: quello richiede
// un servizio bancario esterno (vedi src/lib/server/iban-verify.ts).

/** Lunghezza totale ufficiale dell'IBAN per paese (registro IBAN). */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22,
  BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27,
  DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27,
  GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22,
  IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19,
  MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31,
  SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23,
  TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

export type IbanCheck =
  | { ok: true; country: string; length: number }
  | { ok: false; error: string };

/** Maiuscolo e senza spazi: la forma in cui l'IBAN va conservato. */
export function normalizeIban(s: unknown): string {
  return String(s || "").toUpperCase().replace(/[\s-]+/g, "").slice(0, 34);
}

/** Spazi ogni 4 caratteri: la forma leggibile per la visualizzazione. */
export function formatIban(s: unknown): string {
  const v = normalizeIban(s);
  return v.replace(/(.{4})/g, "$1 ").trim();
}

/** Verifica struttura + lunghezza paese + mod-97 (+ forma del BBAN italiano). */
export function validateIban(input: unknown): IbanCheck {
  const iban = normalizeIban(input);
  if (!iban) return { ok: false, error: "Indica l'IBAN del conto per l'accredito dei compensi." };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) {
    return { ok: false, error: "Formato IBAN non riconosciuto: servono 2 lettere di paese, 2 cifre di controllo e il codice del conto (es. IT60X0542811101000000123456)." };
  }
  const cc = iban.slice(0, 2);
  const expected = IBAN_LENGTHS[cc];
  if (!expected) {
    return { ok: false, error: `Codice paese "${cc}" non previsto nel registro IBAN: verifica di aver scritto le prime due lettere correttamente.` };
  }
  if (iban.length !== expected) {
    return { ok: false, error: `Lunghezza IBAN errata: per il paese ${cc} servono ${expected} caratteri, il tuo ne ha ${iban.length}.` };
  }
  if (!/^[0-9A-Z]+$/.test(iban)) {
    return { ok: false, error: "L'IBAN contiene caratteri non ammessi (solo lettere e cifre, senza spazi)." };
  }
  // ISO 7064 mod-97: le prime 4 posizioni vanno in fondo, A=10 … Z=35
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    const v = ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 55;
    rest = (rest * (v > 9 ? 100 : 10) + v) % 97;
  }
  if (rest !== 1) {
    return { ok: false, error: "Il codice di controllo dell'IBAN non corrisponde: molto probabilmente c'è un errore di battitura, ricontrolla le cifre." };
  }
  // Italia: IT + controllo + CIN (1 lettera) + ABI (5 cifre) + CAB (5 cifre) + conto (12 alfanumerici)
  if (cc === "IT" && !/^[A-Z][0-9]{10}[0-9A-Z]{12}$/.test(iban.slice(4))) {
    return { ok: false, error: "Struttura dell'IBAN italiano non valida (CIN, ABI, CAB o numero di conto errati)." };
  }
  return { ok: true, country: cc, length: expected };
}
