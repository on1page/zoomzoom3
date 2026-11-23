// ZoomZoom — criteri di valutazione per la mappa delle reputazioni.
//
// Le recensioni delle schede città (categoria "zona") esprimono un voto per
// ciascun criterio specifico della categoria — Servizi alla persona e
// vivibilità, Trasporti e mobilità, Sicurezza percepita, Verde/aria/ambiente,
// Costi della vita nella zona. La mappa può colorare il territorio in
// funzione di uno o più criteri selezionati dall'utente: questo modulo
// contiene le funzioni pure condivise da rotta API (aggregati) e client
// (colore dei coropleti, pin e popup), così la formula è unica e verificata.

/** Aggregato per criterio pubblicato dalla rotta mappa:
 *  chiave del criterio → [media arrotondata ai decimi, numero di voti]. */
export type CritMap = Record<string, [number, number]>;

/** Colore per fascia di punteggio (stessa scala di pin, punti e legenda):
 *  8–10 verde, 6–8 giallo, 4–6 arancio, 0–4 rosso, senza dati grigio. */
export function scoreBandColor(v: number | null): string {
  if (v == null) return "#9AA4AE";
  if (v >= 8) return "#2C6E49";
  if (v >= 6) return "#C9A227";
  if (v >= 4) return "#C07A2D";
  return "#A63A2B";
}

/** Valore da colorare per una riga di aggregato, tenendo conto dei criteri
 *  selezionati:
 *   - nessun criterio selezionato → media complessiva (row.mean, sempre
 *     presente nelle righe pubblicate dalla rotta);
 *   - criteri selezionati → media PONDERATA per numero di voti dei criteri
 *     presenti nell'aggregato; se nessuno dei criteri selezionati ha dati,
 *     restituisce null e l'area resta senza colore (non cade mai sul
 *     complessivo: sarebbe un dato diverso da quello richiesto).
 * multi = true quando la selezione ha più criteri con dati (il conteggio
 * voti non sarebbe più "recensioni": le UI mostrano "media di N criteri"). */
export function critAggregate(
  crit: CritMap | undefined | null,
  sel: readonly string[],
): { mean: number; n: number; multi: boolean } | null {
  if (!sel.length || !crit) return null;
  let sum = 0, n = 0;
  for (const k of sel) {
    const v = crit[k];
    if (Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[1] > 0) {
      sum += v[0] * v[1];
      n += v[1];
    }
  }
  if (!n) return null;
  return { mean: sum / n, n, multi: sel.filter(k => Array.isArray(crit[k])).length > 1 };
}

/** Etichette corte per i pulsanti di filtro sulla mappa: le etichette
 *  complete del catalogo sono lunghe ("Servizi alla persona e vivibilità")
 *  e sui chip servono poche parole; l'etichetta completa resta nel tooltip
 *  e nei popup. Le chiavi non previste cadono sull'etichetta completa
 *  (tagliata se necessario): funziona anche con criteri aggiunti dal back
 *  office senza toccare il client. */
const CRIT_SHORT: Record<string, string> = {
  servizi: "Servizi",
  trasporti: "Trasporti",
  sicurezza: "Sicurezza",
  verde: "Verde e aria",
  costi: "Costi della vita",
};

export function criterionShortLabel(key: string, fullLabel: string): string {
  const s = CRIT_SHORT[key];
  if (s) return s;
  const t = String(fullLabel || "").trim();
  return t.length <= 22 ? t : t.slice(0, 21) + "…";
}
