// ZoomZoom — validazione input lato server (fonte di verità, il client duplica
// solo per usabilità) e costanti condivise dei domini applicativi.
import type { CategoryDef } from "./categories";
import { PRICE_KINDS } from "./categories";

export const REPORT_REASONS = [
  { id: "minacce", label: "Minacce, insulti o contenuto diffamatorio" },
  { id: "dati-personali", label: "Dati personali pubblicati senza autorizzazione" },
  { id: "discriminazione", label: "Contenuti discriminatori" },
  { id: "falsita", label: "Falsità manifeste" },
  { id: "spam", label: "Spam o finalità promozionali" },
  { id: "non-pertinente", label: "Non riguarda un'esperienza pertinente" },
  { id: "conflitto", label: "Conflitto di interessi sospetto" },
  { id: "altro", label: "Altro (specificare nei dettagli)" },
] as const;

export const REPORT_STATUS_LABELS: Record<string, string> = {
  received: "Ricevuta", reviewing: "In valutazione", decided: "Decisa", appeal: "Appello presentato", closed: "Chiusa",
};

export function validateEmail(s: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());
}

export function validHalfStep(v: number): boolean {
  return v >= 0 && v <= 10 && (v * 2) % 1 === 0;
}

export type ReviewPayload = {
  score: number;
  // i punteggi per criterio: la chiave storica usata dai form è "crit",
  // "criteria" è accettata come equivalente (entrambe valide)
  criteria?: Record<string, number>;
  crit?: Record<string, number>;
  pros: string;
  cons: string;
  text: string;
  honesty: boolean;
  hp?: string;
  priceAmount?: string | number | null;
  priceUnit?: string;
  priceKind?: string;
};

export type ReviewValidation =
  | { ok: true; score: number; criteria: Record<string, number>; pros: string[]; cons: string[]; text: string; price: { amount: number; unit: string; kind: string } | null }
  | { ok: false; error: string };

/** Validazione completa di una recensione (creazione e rettifica). */
export function validateReviewPayload(p: ReviewPayload, cat: CategoryDef): ReviewValidation {
  const num = (v: unknown): number | null => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const score = num(p.score);
  if (score == null || Number.isNaN(score) || !validHalfStep(score)) {
    return { ok: false, error: "Punteggio complessivo non valido (0–10, step 0,5)." };
  }
  const criteria: Record<string, number> = {};
  // i form inviano i punteggi per criterio con la chiave "crit"; per
  // robustezza si accetta anche "criteria" (stesso significato)
  const critIn: Record<string, number> | undefined = p.criteria ?? p.crit;
  for (const c of cat.criteria) {
    const v = num(critIn?.[c.key]);
    if (v == null) {
      // TOLLERANZA SERVER (robustezza): i cursori del modulo mostrano 5
      // quando un criterio non è stato toccato; moduli in versione cache
      // (o client vecchi) possono non inviare quel valore. Il 5 è ciò che
      // l'utente ha visto a schermo: lo si adotta come punteggio del
      // criterio, invece di rifiutare la recensione con "Valutazione
      // mancante o non valida per: …". I valori PRESENTI restano validati
      // rigorosamente (sotto): un valore sbagliato non passa.
      criteria[c.key] = 5;
      continue;
    }
    if (Number.isNaN(v) || !validHalfStep(v)) {
      return { ok: false, error: `Valutazione non valida per: ${c.label}.` };
    }
    criteria[c.key] = v;
  }
  const pros = String(p.pros || "").split("\n").map(s => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  if (!pros.length) return { ok: false, error: "Indica almeno un aspetto positivo." };
  const cons = String(p.cons || "").split("\n").map(s => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  const text = String(p.text || "").trim();
  if (text.length < 100) return { ok: false, error: "La descrizione dell'esperienza deve essere di almeno 100 caratteri." };
  if (!p.honesty) return { ok: false, error: "Devi confermare la dichiarazione sull'esperienza personale e sulle regole." };
  if (String(p.hp || "").trim()) return { ok: false, error: "Richiesta rifiutata (controllo anti-bot)." };

  let price: { amount: number; unit: string; kind: string } | null = null;
  if (p.priceAmount !== "" && p.priceAmount != null) {
    const amt = Number(p.priceAmount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 100_000_000) {
      return { ok: false, error: "Importo del prezzo non valido (tra 1 € e 100.000.000 €)." };
    }
    if (cat.priceUnits.length === 0) {
      return { ok: false, error: "Questa categoria non prevede campi prezzo." };
    }
    // unità mancante o non valida → la prima della categoria, che è quella
    // mostrata di default dal selettore (coerenza tra ciò che si vede e ciò
    // che viene inviato, anche per client con versioni precedenti in cache)
    const unit = cat.priceUnits.includes(String(p.priceUnit || ""))
      ? String(p.priceUnit)
      : cat.priceUnits[0];
    const kind = PRICE_KINDS.includes(p.priceKind as (typeof PRICE_KINDS)[number]) ? p.priceKind! : "Concluso/pagato";
    price = { amount: Math.round(amt), unit, kind };
  } else if (cat.priceUnits.length === 0 && p.priceUnit) {
    return { ok: false, error: "Questa categoria non prevede campi prezzo." };
  }
  return { ok: true, score, criteria, pros, cons, text, price };
}
