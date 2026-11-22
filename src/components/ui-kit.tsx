"use client";
// ZoomZoom — componenti UI condivisi fedeli al design system del prototipo:
// stelle accessibili, chip di categoria, badge, card entità, modali con focus
// trap, toast, breadcrumb. Tutti senza dipendenze esterne.
import { useEffect, useRef, type ReactNode } from "react";
import { CheckSvg, iconSvg } from "./icons";
import { fmt1, fmtInt } from "@/lib/client/api";
import { navigate } from "@/lib/client/router";
import { useApp, type CategoryInfo } from "@/lib/client/store";

/* ---------- Stelle (accessibili: aria-label con voto su 10 e su 5) ---------- */
function starPathD(cx: number, cy: number, R: number): string {
  const r = R * 0.42;
  let d = "";
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    d += (i === 0 ? "M" : " L") + (cx + rad * Math.cos(ang)).toFixed(2) + "," + (cy + rad * Math.sin(ang)).toFixed(2);
  }
  return d + "Z";
}

let starSeq = 0;
export function Stars({ score, size = 17 }: { score: number | null; size?: number }) {
  const gap = Math.max(2, size * 0.14);
  const R = size / 2 - 0.6;
  const w = 5 * size + 4 * gap;
  const stars5 = Math.min(5, Math.max(0, (score ?? 0) / 2));
  const pct = (stars5 / 5) * 100;
  const clipId = `sc${++starSeq}`;
  const label = score == null
    ? "nessuna recensione"
    : `${fmt1(stars5).replace(/,0$/, "")} stelle su 5 (punteggio ${fmt1(score)} su 10)`;
  const row = Array.from({ length: 5 }, (_, i) => (
    <path key={i} d={starPathD(size / 2 + i * (size + gap), size / 2, R)} />
  ));
  return (
    <svg className="stars" width={w} height={size} viewBox={`0 0 ${w} ${size}`} role="img" aria-label={label}>
      <defs>
        <clipPath id={clipId}><rect x="0" y="0" width={(w * pct) / 100} height={size} /></clipPath>
      </defs>
      <g fill="#D8D2C0">{row}</g>
      <g fill="#C9A227" clipPath={`url(#${clipId})`}>{row}</g>
    </svg>
  );
}

/* ---------- Chip e badge ---------- */
export function ChipCat({ cat, href }: { cat: CategoryInfo; href?: boolean }) {
  const inner = <>{iconSvg(cat.icon, 13)}<span>{cat.shortName}</span></>;
  const style = { ["--c" as string]: cat.hexColor } as React.CSSProperties;
  if (href === false) return <span className="chip chip-cat" style={style} title={cat.name}>{inner}</span>;
  return (
    <a className="chip chip-cat" style={style}
      href={`#/categoria/${cat.id}`} title={cat.name} onClick={e => { e.preventDefault(); navigate(`#/categoria/${cat.id}`); }}>
      {inner}
    </a>
  );
}

export const VerifBadge = () => (
  <span className="badge-verif" title="Verifichiamo l'esistenza dell'invito o dell'interazione registrata, non la veridicità di ogni affermazione.">
    <CheckSvg /> Esperienza verificata
  </span>
);
export const DemoChip = () => (
  <span className="badge-demo" title="Contenuto generato per la demo: non corrisponde a persone o fatti reali.">Dato fittizio</span>
);
export const insuffChip = (n: number) => (
  <span className="badge-insuff" title="Media calcolata su poche recensioni: non è statisticamente solida.">Dati insufficienti ({n})</span>
);

/* ---------- Punteggio ---------- */
export function ScoreLine({ stats, size = 17 }: { stats: { n: number; mean: number | null; sufficient: boolean }; size?: number }) {
  return (
    <div className="score-line">
      <Stars score={stats.mean} size={size} />
      {stats.mean != null
        ? <span className="score-num">{fmt1(stats.mean)}<small>/10</small></span>
        : <span className="score-num">— <small>/10</small></span>}
      <span className="score-n">{stats.n === 1 ? "1 recensione" : `${stats.n} recensioni`}</span>
      {stats.n > 0 && !stats.sufficient && insuffChip(stats.n)}
    </div>
  );
}

export function CriteriaBars({ criteria, stats }: { criteria: { key: string; label: string }[]; stats: { n: number; crit: Record<string, number | null> } }) {
  if (stats.n === 0) return null;
  return (
    <div className="crit-bars">
      {criteria.map(c => {
        const v = stats.crit[c.key];
        return (
          <div className="crit-row" key={c.key}>
            <div className="crit-label">{c.label} <span className="n">({stats.n})</span></div>
            <div className="crit-val">{v == null ? "—" : fmt1(v)}</div>
            <div className="bar"><span style={{ width: `${v == null ? 0 : v * 10}%` }}></span></div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Card entità ---------- */
export type EntCardData = {
  entity: { id: string; name: string; categoryId: string; subtitle?: string | null; address?: string | null; streetNumber?: string | null; zoneId?: string | null; verifiedBusiness?: boolean; isDemo?: boolean };
  n: number; mean: number | null; sufficient: boolean;
  priceStats?: { unit: string; min: number; max: number; median: number; n: number } | null;
  rank?: number;
};

export function EntityCard({ data, cat, zoneName }: { data: EntCardData; cat: CategoryInfo; zoneName?: (id: string | null) => string }) {
  const { entity, n, mean, sufficient, priceStats } = data;
  const rank = data.rank;
  return (
    <article className="card card-click ent-card">
      <div className="ent-card-head">
        <h3>
          {rank ? <span className={`rank-num${rank === 2 ? " r2" : rank === 3 ? " r3" : ""}`}>{rank}</span> : null}{" "}
          <a href={`#/scheda/${entity.id}`}>{entity.name}</a> {entity.isDemo ? <DemoChip /> : null}
        </h3>
        {entity.verifiedBusiness ? <span className="pill pill-blue" title="Soggetto con account verificato sulla piattaforma.">Soggetto verificato</span> : null}
      </div>
      <div className="ent-meta">
        <ChipCat cat={cat} href={false} />
        {entity.address ? <span>{[entity.address, entity.streetNumber].filter(Boolean).join(" ")}</span>
          : entity.subtitle ? <span>{entity.subtitle}</span>
          : entity.zoneId && zoneName ? <span>{zoneName(entity.zoneId)}</span> : null}
      </div>
      <ScoreLine stats={{ n, mean, sufficient }} />
      {priceStats ? (
        <div className="ent-meta">
          <span title="Importi dichiarati dai recensori nelle loro esperienze: la piattaforma non verifica i prezzi.">
            <b>Prezzo: </b>
            {priceStats.min === priceStats.max ? fmtInt(priceStats.min) : `${fmtInt(priceStats.min)} – ${fmtInt(priceStats.max)}`} {priceStats.unit} · {priceStats.n} {priceStats.n === 1 ? "dichiarazione" : "dichiarazioni"}
          </span>
        </div>
      ) : null}
    </article>
  );
}

/* ---------- Metodo ---------- */
export function MethodNoteBox() {
  const { boot } = useApp();
  const min = boot?.settings.minReviews ?? 3;
  return (
    <div className="method-box">
      <h3>Come ordiniamo gli elenchi e le classifiche</h3>
      <p className="mb0">
        Le classifiche usano una <strong>media ponderata</strong>: al punteggio medio viene applicato un peso verso la media della categoria finché una scheda non raggiunge almeno <strong>{min} recensioni</strong>. Così una singola recensione massima non basta a conquistare il primo posto, e le schede con pochi dati vengono segnalate come non sufficienti. <a href="#/come-funziona">Dettagli e formula</a>.
      </p>
    </div>
  );
}

/* ---------- Breadcrumb ---------- */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Percorso">
      <div className="container">
        {items.map((it, i) => (
          <span key={i}>
            {i > 0 ? <span className="sep">›</span> : null}
            {it.href ? <a href={it.href}>{it.label}</a> : <span>{it.label}</span>}
          </span>
        ))}
      </div>
    </nav>
  );
}

/* ---------- Modale con focus trap ---------- */
export function Modal({ label, children, large, onClose }: { label: string; children: ReactNode; large?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [tabindex]:not([tabindex='-1'])") || [])
        .filter(el => !el.disabled && el.offsetParent !== null);
    focusables()[0]?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { onClose(); return; }
      if (ev.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    };
    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} ref={ref as React.Ref<HTMLDivElement>}>
      <div className={`modal${large ? " modal-lg" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, body, okLabel, okClass, onOk, onClose }: {
  title: string; body: ReactNode; okLabel: string; okClass?: string;
  onOk: () => void; onClose: () => void;
}) {
  return (
    <Modal label={title} onClose={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="modal-close" onClick={onClose} aria-label="Chiudi">×</button>
      </div>
      <p className="mb2">{body}</p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
        <button className={`btn ${okClass || "btn-primary"}`} id="cf-ok" onClick={() => { onClose(); onOk(); }}>{okLabel}</button>
      </div>
    </Modal>
  );
}

/* ---------- Alert ---------- */
export function Alert({ kind, children }: { kind: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

/* ---------- Legal note ---------- */
export function LegalNote() {
  return (
    <div className="legal-note">
      <b>Nota sullo stato del documento.</b> Testo predisposto come <b>bozza</b> per la piattaforma: non costituisce consulenza legale e non dichiara conformità. Prima del lancio va sottoposto a revisione professionale (GDPR, ePrivacy, normativa italiana e UE su recensioni e consumatori, regolamento sui servizi digitali) e integrato con i dati del titolare effettivo. I segnaposto <code>【…】</code> indicano i dati mancanti.
    </div>
  );
}
