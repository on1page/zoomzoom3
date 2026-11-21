"use client";
// ZoomZoom — campi condivisi del form recensione: punteggio complessivo,
// valutazioni per criterio, prezzo dichiarato, punti di forza, criticità e
// descrizione. Usati sia dalla via invito/verifica sia dal contributo aperto:
// una sola fonte di verità per la struttura del form.
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { fmt1 } from "@/lib/client/api";

export type ReviewFormCore = {
  score: number;
  crit: Record<string, number>;
  priceAmount: string;
  priceUnit: string;
  priceKind: string;
  pros: string;
  cons: string;
  text: string;
};

export function ReviewFields<T extends ReviewFormCore>({ cat, form, setForm }: {
  cat: { name: string; criteria: { key: string; label: string }[]; priceUnits: string[] };
  form: T;
  setForm: Dispatch<SetStateAction<T>>;
}) {
  // il selettore "Periodo" mostra la prima unità quando lo stato è vuoto:
  // lo stato deve corrispondere a ciò che l'utente vede, altrimenti l'invio
  // con il solo importo compilato verrebbe rifiutato (unità mancante)
  useEffect(() => {
    if (cat.priceUnits.length && !form.priceUnit) {
      setForm(f => ({ ...f, priceUnit: cat.priceUnits[0] }));
    }
  }, [cat.priceUnits, form.priceUnit, setForm]);

  // gli slider mostrano 5 quando un criterio non è mai stato toccato: quel 5
  // deve esistere anche nello stato, altrimenti il criterio non viene inviato
  // e il server rifiuta la recensione con "Valutazione mancante o non valida
  // per: …" (basta NON muovere uno slider per farlo scattare). Questo effetto
  // scrive nello stato, una sola volta, lo stesso 5 che è già a schermo.
  useEffect(() => {
    if (cat.criteria.some(c => form.crit[c.key] == null)) {
      setForm(f => {
        const crit = { ...f.crit };
        for (const c of cat.criteria) if (crit[c.key] == null) crit[c.key] = 5;
        return { ...f, crit };
      });
    }
  }, [cat.criteria, form.crit, setForm]);
  return (
    <>
      <div className="field">
        <label htmlFor="rv-score">Punteggio complessivo dell&apos;esperienza (0–10)</label>
        <div className="range-wrap">
          <input type="range" id="rv-score" min={0} max={10} step={0.5} value={form.score}
            onChange={e => setForm(f => ({ ...f, score: Number(e.target.value) }))} aria-describedby="rv-score-val" />
          <span className="range-val" id="rv-score-val" aria-live="polite">{fmt1(form.score)}</span>
        </div>
      </div>
      <fieldset>
        <legend>Valutazioni per criterio (specifiche della categoria &quot;{cat.name}&quot;)</legend>
        {cat.criteria.map(c => (
          <div className="field" key={c.key}>
            <label htmlFor={`rv-crit-${c.key}`}>{c.label}</label>
            <div className="range-wrap">
              <input type="range" id={`rv-crit-${c.key}`} min={0} max={10} step={0.5}
                value={form.crit[c.key] ?? 5}
                onChange={e => setForm(f => ({ ...f, crit: { ...f.crit, [c.key]: Number(e.target.value) } }))}
                aria-describedby={`rv-crit-${c.key}-val`} />
              <span className="range-val" id={`rv-crit-${c.key}-val`} aria-live="polite">{fmt1(form.crit[c.key] ?? 5)}</span>
            </div>
          </div>
        ))}
      </fieldset>
      {cat.priceUnits.length ? (
        <fieldset>
          <legend>Prezzo richiesto e/o proposto (dato dichiarato, facoltativo)</legend>
          <div className="row">
            <div className="field mb0" style={{ flex: 1, minWidth: 120 }}>
              <label htmlFor="rv-price">Importo (€)</label>
              <input id="rv-price" type="number" min={1} step={1} placeholder="Es. 850" value={form.priceAmount} onChange={e => setForm(f => ({ ...f, priceAmount: e.target.value }))} />
            </div>
            <div className="field mb0" style={{ flex: 1, minWidth: 110 }}>
              <label htmlFor="rv-price-unit">Periodo</label>
              <select id="rv-price-unit" value={form.priceUnit || cat.priceUnits[0]}
                onChange={e => setForm(f => ({ ...f, priceUnit: e.target.value }))}>
                {cat.priceUnits.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="field mb0" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="rv-price-kind">Natura</label>
              <select id="rv-price-kind" value={form.priceKind} onChange={e => setForm(f => ({ ...f, priceKind: e.target.value }))}>
                {["Richiesto", "Proposto/offerta", "Concluso/pagato"].map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <span className="hint">Sarà mostrato come <b>dato dichiarato dal recensore</b>: la piattaforma non verifica gli importi, ma aiuta chi consulta a farsi un&apos;idea dei valori praticati.</span>
        </fieldset>
      ) : null}
      <div className="field">
        <label htmlFor="rv-pros">Aspetti positivi <span className="muted">(uno per riga, almeno uno)</span></label>
        <textarea id="rv-pros" required value={form.pros} onChange={e => setForm(f => ({ ...f, pros: e.target.value }))}
          placeholder={"Es.\nTempi di risposta rapidi\nCosti chiari fin dall'inizio"} />
      </div>
      <div className="field">
        <label htmlFor="rv-cons">Criticità <span className="muted">(una per riga, facoltativo)</span></label>
        <textarea id="rv-cons" value={form.cons} onChange={e => setForm(f => ({ ...f, cons: e.target.value }))}
          placeholder={"Es.\nDocumentazione consegnata in ritardo"} />
      </div>
      <div className="field">
        <label htmlFor="rv-text">Descrizione dell&apos;esperienza <span className="muted">(almeno 100 caratteri)</span></label>
        <textarea id="rv-text" required minLength={100} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
          placeholder="Racconta l'esperienza in modo concreto e rispettoso: cosa è successo, con quali tempi, quali esiti. Senza dati personali di terzi (nomi completi, telefoni, indirizzi privati)." />
        <span className="hint">Minimo 100 caratteri. Vedi le <a href="#/regole-recensioni">regole</a>.</span>
      </div>
    </>
  );
}
