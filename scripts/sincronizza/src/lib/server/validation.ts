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
  criteria: Record<string, number>;
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
  for (const c of cat.criteria) {
    const v = num(p.criteria?.[c.key]);
    if (v == null || Number.isNaN(v) || !validHalfStep(v)) {
      return { ok: false, error: `Valutazione mancante o non valida per: ${c.label}.` };
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
    if (cat.priceUnits.length && !cat.priceUnits.includes(String(p.priceUnit || ""))) {
      return { ok: false, error: "Periodo del prezzo non valido per questa categoria." };
    }
    const kind = PRICE_KINDS.includes(p.priceKind as (typeof PRICE_KINDS)[number]) ? p.priceKind! : "Concluso/pagato";
    price = { amount: Math.round(amt), unit: String(p.priceUnit), kind };
  } else if (cat.priceUnits.length === 0 && p.priceUnit) {
    return { ok: false, error: "Questa categoria non prevede campi prezzo." };
  }
  return { ok: true, score, criteria, pros, cons, text, price };
}
