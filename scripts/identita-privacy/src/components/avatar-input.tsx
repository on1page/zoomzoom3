"use client";
// ZoomZoom — caricamento foto profilo (una sola, facoltativa).
// L'immagine viene ridimensionata e ricompresa QUI nel browser (canvas, max
// 320 px, JPEG): il file originale non lascia mai il dispositivo e i metadati
// EXIF (posizione GPS inclusa) vengono eliminati. Il server applica una
// seconda ricompilazione con sharp come garanzia.
import { useRef, useState } from "react";

const MAX_SIDE = 320;
const JPEG_QUALITY = 0.85;

async function resizeToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("immagine non leggibile"));
      im.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas non disponibile");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Selettore foto profilo: anteprima tonda, un'immagine, rimozione immediata.
 *  `value` è il data URL (o null); `onChange` notifica il nuovo valore. */
export function AvatarInput({ value, onChange, size = 72 }: {
  value: string | null;
  onChange: (next: string | null) => void;
  size?: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setErr(null); setBusy(true);
    try {
      if (!/^image\/(jpeg|png|webp)$/i.test(f.type)) throw new Error("formato");
      onChange(await resizeToDataUrl(f));
    } catch {
      setErr("Formati ammessi: JPEG, PNG, WebP.");
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="avatar-picker">
      {value ? (
        <div className="avatar-preview-big" style={{ width: size, height: size }}>
          <img src={value} alt="Anteprima della foto profilo" />
          <button type="button" className="photo-remove" aria-label="Rimuovi la foto profilo"
            onClick={() => onChange(null)}>×</button>
        </div>
      ) : (
        <button type="button" className="avatar-add" style={{ width: size, height: size }}
          onClick={() => inputRef.current?.click()} disabled={busy}
          title="Facoltativa. Viene ricompresa e i metadati (posizione EXIF inclusa) rimossi. Compare sulle tue recensioni solo se attivi l'apposita opzione.">
          {busy ? "…" : "+ Foto"}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={e => void pick(e.target.files)} />
      {err ? <p className="error-msg" style={{ display: "block", margin: 0 }}>{err}</p> : null}
    </div>
  );
}
