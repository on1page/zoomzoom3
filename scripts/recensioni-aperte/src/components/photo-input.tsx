"use client";
// ZoomZoom — caricamento foto per una recensione (facoltativo, max 3).
// L'immagine viene ridimensionata e ricompresa QUI nel browser (canvas, max
// 1280 px, JPEG): il file originale non lascia mai il dispositivo e la
// ricompilazione elimina i metadati EXIF (posizione GPS inclusa). Il server
// applica una seconda ricompilazione con sharp come garanzia.
import { useRef, useState } from "react";

const MAX_PHOTOS = 3;
const MAX_SIDE = 1280;
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

export function PhotoInput({ photos, onChange, enabled = true }: {
  photos: string[];
  onChange: (next: string[]) => void;
  enabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!enabled) return null;

  const pick = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setErr(null); setBusy(true);
    const room = MAX_PHOTOS - photos.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    const out: string[] = [];
    let bad = 0;
    for (const f of chosen) {
      if (!/^image\/(jpeg|png|webp)$/i.test(f.type)) { bad++; continue; }
      try { out.push(await resizeToDataUrl(f)); } catch { bad++; }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (out.length) onChange([...photos, ...out].slice(0, MAX_PHOTOS));
    if (bad) setErr(`${bad} ${bad === 1 ? "file ignorato" : "file ignorati"}: formati ammessi JPEG, PNG, WebP.`);
    else if (chosen.length > room) setErr(`Massimo ${MAX_PHOTOS} foto per recensione.`);
  };

  return (
    <fieldset>
      <legend>Foto dell&apos;immobile <span className="muted">(facoltative, max {MAX_PHOTOS})</span></legend>
      <div className="photo-previews">
        {photos.map((p, i) => (
          <div className="photo-preview" key={i}>
            <img src={p} alt={`Anteprima foto ${i + 1} dell'immobile`} />
            <button type="button" className="photo-remove" aria-label={`Rimuovi la foto ${i + 1}`}
              onClick={() => onChange(photos.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS ? (
          <button type="button" className="photo-add" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Preparazione…" : "+ Aggiungi foto"}
          </button>
        ) : null}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
        onChange={e => void pick(e.target.files)} />
      <span className="hint">
        Le foto vengono ricompresse e i metadati (posizione EXIF inclusa) rimossi. Non caricare immagini con persone riconoscibili o documenti privati.
        Chi contribuisce con una foto può vedere le foto allegate alle recensioni di tutti.
      </span>
      {err ? <p className="error-msg" style={{ display: "block" }}>{err}</p> : null}
    </fieldset>
  );
}
