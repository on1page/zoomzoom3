// ZoomZoom — generatore PDF minimale, senza dipendenze esterne.
// Serve per le relazioni di perizia/valutazione dei Consulenti Tecnici:
// testo A4 con font standard Helvetica/Helvetica-Bold (nessun embedding
// richiesto), codifica WinAnsi (accenti italiani ed € compresi),
// impaginazione a blocchi con ritorno a capo automatico e piè di pagina.
// L'output è un Buffer pronto da servire con application/pdf.

/* ---------- larghezze dei glifi Helvetica (tabella AFM standard) ---------- */
// larghezze per i codici 32..126; i caratteri WinAnsi alti (à, è, €…)
// usano la larghezza approssimata 556: più che sufficiente per il wrapping
const W_HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const W_HELV_B = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/* ---------- Unicode → WinAnsi (un byte per carattere) ---------- */
const WINANSI_EXTRA: Record<string, number> = {
  "€": 0x80, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "…": 0x85, "†": 0x86, "‡": 0x87, "˜": 0x98,
  "™": 0x99, "š": 0x9a, "‹": 0x8b, "œ": 0x9c, "›": 0x9b, "ƒ": 0x83,
  "Œ": 0x8c, "Š": 0x8a, "Ž": 0x8e, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Codifica una stringa in byte WinAnsi (i caratteri non rappresentabili
 *  diventano "?"), per l'uso nei contenuti PDF. */
export function encodeWinAnsi(s: string): Buffer {
  const out = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c <= 0x7e) out[i] = c;
    else if (c >= 0xa0 && c <= 0xff) out[i] = c;
    else {
      const m = WINANSI_EXTRA[ch];
      out[i] = m ?? 0x3f; // "?"
    }
  }
  return out;
}

function charWidth(ch: string, bold: boolean): number {
  const c = ch.codePointAt(0)!;
  if (c >= 0x20 && c <= 0x7e) {
    const w = (bold ? W_HELV_B : W_HELV)[c - 0x20];
    if (w) return w;
  }
  // caratteri WinAnsi alti (accentati, €): approssimazione sufficiente
  return bold ? 556 : 556;
}

function textWidth(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

/** Spezza il testo in righe che stanno nella larghezza disponibile. */
function wrap(s: string, size: number, bold: boolean, maxWidth: number): string[] {
  const out: string[] = [];
  for (const par of s.replace(/\r\n?/g, "\n").split("\n")) {
    if (!par.trim()) { out.push(""); continue; }
    const words = par.split(/(\s+)/); // conserva gli spazi per unire meglio
    let line = "";
    const push = () => { out.push(line.replace(/\s+$/, "")); line = ""; };
    for (const w of words) {
      if (/^\s+$/.test(w)) { line += w; continue; }
      if (textWidth(line + w, size, bold) <= maxWidth) { line += w; continue; }
      if (line.trim()) push();
      // parola singola più larga della riga: spezzatura dura
      let piece = "";
      for (const ch of w) {
        if (textWidth(piece + ch, size, bold) > maxWidth) { out.push(piece); piece = ch; }
        else piece += ch;
      }
      line = piece;
    }
    if (line.trim()) push();
    else out.push("");
  }
  return out;
}

/* ---------- blocchi di contenuto ---------- */
export type PdfBlock = {
  text: string;
  bold?: boolean;
  size?: number;        // pt (default 11)
  color?: number;       // 0 = nero, 0.45 = grigio (default 0)
  gapBefore?: number;   // pt di spazio prima (default 6)
  gapAfter?: number;    // pt di spazio dopo (default 0)
  indent?: number;      // pt di rientro (default 0)
  keepWithNext?: boolean;
};

const A4_W = 595, A4_H = 842;
const MARGIN = 56;
const FOOTER_H = 30;

type Line = { text: string; bold: boolean; size: number; color: number; x: number };

/** Costruisce il PDF dai blocchi. Ritorna un Buffer completo. */
export function buildPdf(blocks: PdfBlock[], footerLabel: string): Buffer {
  const contentW = A4_W - 2 * MARGIN;
  const pages: Line[][] = [];
  let cur: Line[] = [];
  let y = A4_H - MARGIN;

  const newPage = () => { pages.push(cur); cur = []; y = A4_H - MARGIN; };
  const fits = (h: number) => y - h >= MARGIN + FOOTER_H;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const size = b.size ?? 11;
    const bold = !!b.bold;
    const leading = Math.round(size * 1.45);
    const gapBefore = b.gapBefore ?? 6;
    const gapAfter = b.gapAfter ?? 0;
    const x = MARGIN + (b.indent ?? 0);
    const availW = contentW - (b.indent ?? 0);
    const lines = wrap(b.text, size, bold, availW);
    const blockH = gapBefore + lines.length * leading + gapAfter;

    if (!fits(blockH) && fits(leading)) {
      newPage();
    }
    y -= gapBefore;
    for (const ln of lines) {
      if (!fits(leading)) newPage();
      cur.push({ text: ln, bold, size, color: b.color ?? 0, x });
      y -= leading;
    }
    y -= gapAfter;
  }
  pages.push(cur);

  /* ---------- stream di contenuto per ogni pagina ---------- */
  const esc = (b: Buffer) => b.toString("latin1")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const streams = pages.map((lines, pi) => {
    const parts: string[] = [];
    // intestazione discreta (tranne prima pagina: il titolo è nel corpo)
    if (pi > 0) {
      parts.push(`BT /F1 8 Tf 0.45 g 1 0 0 1 ${MARGIN} ${A4_H - MARGIN + 12} Tm (${esc(encodeWinAnsi(footerLabel))}) Tj ET 0 g`);
    }
    let py = A4_H - MARGIN;
    for (const ln of lines) {
      const f = ln.bold ? "/F2" : "/F1";
      const c = ln.color.toFixed(2);
      parts.push(`BT ${f} ${ln.size} Tf ${c} g 1 0 0 1 ${ln.x} ${py.toFixed(1)} Tm (${esc(encodeWinAnsi(ln.text))}) Tj ET 0 g`);
      py -= Math.round(ln.size * 1.45);
    }
    // piè di pagina: pagina i di N
    parts.push(`0.45 g BT /F1 8 Tf 1 0 0 1 ${MARGIN} ${MARGIN - 24} Tm (${esc(encodeWinAnsi(`Pagina ${pi + 1} di ${pages.length}`))}) Tj ET 0 g`);
    return parts.join("\n");
  });

  /* ---------- assemblaggio degli oggetti PDF ---------- */
  const nPages = pages.length;
  // oggetti: 1 catalogo · 2 pages · pagine · stream · 2 font
  const firstPageObj = 3;
  const firstStreamObj = firstPageObj + nPages;
  const font1Obj = firstStreamObj + nPages;
  const font2Obj = font1Obj + 1;
  const objs: string[] = [];
  const kids = Array.from({ length: nPages }, (_, i) => `${firstPageObj + i} 0 R`).join(" ");
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Count ${nPages} /Kids [${kids}] >>`;
  for (let i = 0; i < nPages; i++) {
    objs[firstPageObj + i] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
      `/Resources << /Font << /F1 ${font1Obj} 0 R /F2 ${font2Obj} 0 R >> >> ` +
      `/Contents ${firstStreamObj + i} 0 R >>`;
  }
  for (let i = 0; i < nPages; i++) {
    objs[firstStreamObj + i] = `STREAM:${streams[i]}`;
  }
  objs[font1Obj] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objs[font2Obj] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (s: string | Buffer) => {
    const b = typeof s === "string" ? Buffer.from(s, "latin1") : s;
    chunks.push(b);
    offset += b.length;
  };
  const offsets: number[] = [];

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  for (let i = 1; i <= font2Obj; i++) {
    offsets[i] = offset;
    const o = objs[i];
    if (o.startsWith("STREAM:")) {
      const data = o.slice(8);
      push(`${i} 0 obj\n<< /Length ${Buffer.byteLength(data, "latin1")} >>\nstream\n${data}\nendstream\nendobj\n`);
    } else {
      push(`${i} 0 obj\n${o}\nendobj\n`);
    }
  }
  const xrefPos = offset;
  const n = font2Obj + 1;
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
