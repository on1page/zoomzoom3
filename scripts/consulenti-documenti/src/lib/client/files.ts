// ZoomZoom — preparazione dei file AL CLIENT per la domanda da Consulente
// Tecnico. Le foto dei documenti vengono ridimensionate e ricompresse QUI
// nel browser (canvas, JPEG): il file originale non lascia mai il
// dispositivo e il invio resta sotto i limiti del server. I PDF non sono
// comprimibili: vengono solo misurati e rifiutati se troppo grandi.
// Gli stessi limiti sono ripetuti LATO SERVER (src/lib/server/consultants.ts):
// qui servono a evitare l'invio, là a respingerlo comunque.

export const MAX_FILES = 8;                                  // documenti totali
export const MAX_DOC_BYTES = 2 * 1024 * 1024;                // 2 MB per documento
export const MAX_TOTAL_DOC_BYTES = 3 * 1024 * 1024;          // 3 MB tutti i documenti insieme
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;             // file originale prima della compressione
export const ALLOWED_DOC_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

export type PreparedDoc = {
  kind: string;                 // qualifica | esperienza | documento | altro
  name: string;
  mime: string;
  data: string;                 // dataURL pronto per l'invio
  sizeBytes: number;            // dimensione STIMATA del contenuto (base64 → byte)
  compressed: boolean;          // true se ricompreso dal browser
};

export type PrepareResult =
  | { ok: true; doc: PreparedDoc }
  | { ok: false; error: string };

/** Dimensione leggibile: "245 KB", "2,1 MB". */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB`;
}

/** Byte di contenuto a partire da un dataURL base64 (senza decodificarlo). */
export function dataUrlBytes(dataUrl: string): number {
  const i = String(dataUrl).indexOf(";base64,");
  const b64 = i >= 0 ? String(dataUrl).slice(i + 8) : String(dataUrl);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/** Ridimensiona e ricompresse un'immagine in JPEG (canvas, come le foto delle recensioni). */
export function compressImage(file: File, maxSide: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas non disponibile");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("immagine non leggibile")); };
    img.src = url;
  });
}

const readFile = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});

/** Prepara un documento per l'invio: comprime le immagini, misura tutto,
 *  rifiuta ciò che non rispetta i limiti. kind decide la sezione del modulo. */
export async function prepareDocFile(file: File, kind: string): Promise<PrepareResult> {
  const name = file.name || "documento";
  if (file.size > MAX_INPUT_BYTES) {
    return { ok: false, error: `"${name}" è troppo grande (${fmtBytes(file.size)}): massimo ${fmtBytes(MAX_INPUT_BYTES)} prima della compressione.` };
  }
  const mime = (file.type || "").toLowerCase();

  if (mime === "application/pdf") {
    if (file.size > MAX_DOC_BYTES) {
      return { ok: false, error: `"${name}" pesa ${fmtBytes(file.size)}: i PDF non si possono comprimere, massimo ${fmtBytes(MAX_DOC_BYTES)}. Prova a fotografare il documento e a caricare la foto (viene compressa automaticamente).` };
    }
    const data = await readFile(file);
    return { ok: true, doc: { kind, name, mime, data, sizeBytes: file.size, compressed: false } };
  }

  if (/^image\/(jpeg|png|webp)$/.test(mime)) {
    try {
      let data = await compressImage(file, 1600, 0.72);
      let size = dataUrlBytes(data);
      if (size > MAX_DOC_BYTES) {               // immagine molto ostica: seconda passata più spinta
        data = await compressImage(file, 1200, 0.5);
        size = dataUrlBytes(data);
      }
      if (size > MAX_DOC_BYTES) {
        return { ok: false, error: `"${name}" resta oltre ${fmtBytes(MAX_DOC_BYTES)} anche dopo la compressione: prova una foto più nitida ma più leggera.` };
      }
      return { ok: true, doc: { kind, name: name.replace(/\.[a-z0-9]+$/i, ".jpg"), mime: "image/jpeg", data, sizeBytes: size, compressed: true } };
    } catch {
      return { ok: false, error: `"${name}" non è leggibile come immagine: usa JPG, PNG, WebP o PDF.` };
    }
  }

  return { ok: false, error: `"${name}" ha un formato non ammesso: JPG, PNG, WebP o PDF.` };
}

/** Foto profilo: compressa a 800 px prima dell'invio (il server la ricompila comunque). */
export async function preparePhotoFile(file: File): Promise<{ ok: true; data: string; sizeBytes: number } | { ok: false; error: string }> {
  const mime = (file.type || "").toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) {
    return { ok: false, error: "La foto profilo deve essere un'immagine JPG, PNG o WebP." };
  }
  if (file.size > MAX_INPUT_BYTES) {
    return { ok: false, error: `La foto è troppo grande (${fmtBytes(file.size)}).` };
  }
  try {
    const data = await compressImage(file, 800, 0.8);
    return { ok: true, data, sizeBytes: dataUrlBytes(data) };
  } catch {
    return { ok: false, error: "La foto non è leggibile: prova un'immagine diversa." };
  }
}
