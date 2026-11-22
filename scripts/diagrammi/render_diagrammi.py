#!/usr/bin/env python3
"""
Renderizza i diagrammi di ZoomZoom.

- Legge i blocchi ```mermaid``` da download/zoomzoom-diagrammi.md (unica fonte di verita')
- Per ogni blocco individua la sezione "## Dn — Titolo" che lo precede
- Renderizza con mmdc (Mermaid CLI) in download/diagrammi/Dn-slug.png
- Rigenera il visualizzatore HTML download/zoomzoom-diagrammi.html
- Verifica che ogni PNG esista, non sia vuota e non sia bianca

Uso:  python3 /home/z/my-project/scripts/diagrammi/render_diagrammi.py [--only D2]
"""
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path("/home/z/my-project")
MD = ROOT / "download/zoomzoom-diagrammi.md"
OUTDIR = ROOT / "download/diagrammi"
HTML = ROOT / "download/zoomzoom-diagrammi.html"
WORKDIR = ROOT / "scripts/diagrammi/work"

OUTDIR.mkdir(parents=True, exist_ok=True)
WORKDIR.mkdir(parents=True, exist_ok=True)

text = MD.read_text(encoding="utf-8")

# ── Estrazione: heading "## Dn — ..." piu' vicino prima di ogni blocco mermaid ──
heading_re = re.compile(r"^## (D\d+)[ \t]*[—-][ \t]*(.+?)\s*$", re.M)
block_re = re.compile(r"^```mermaid\n(.*?)^```", re.M | re.S)

headings = [(m.start(), m.group(1), m.group(2).strip()) for m in heading_re.finditer(text)]
blocks = [(m.start(), m.group(1).strip()) for m in block_re.finditer(text)]

if not blocks:
    sys.exit("ERRORE: nessun blocco mermaid trovato nel documento")

def heading_for(pos: int):
    cur = None
    for hpos, code, title in headings:
        if hpos < pos:
            cur = (code, title)
        else:
            break
    return cur

def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s[:40] or "diagramma"

only = None
if "--only" in sys.argv:
    only = sys.argv[sys.argv.index("--only") + 1]

jobs = []
for pos, src in blocks:
    h = heading_for(pos)
    code = h[0] if h else f"B{len(jobs)+1}"
    title = h[1] if h else "Blocco"
    jobs.append((code, title, src))

# ── Controllo che ogni blocco abbia il frontmatter con il titolo coerente ──
for code, title, src in jobs:
    if not src.startswith("---"):
        print(f"AVVISO: blocco {code} senza frontmatter")

# ── Render mmdc ──
rendered = []
for code, title, src in jobs:
    if only and code != only:
        continue
    slug = slugify(title)
    png = OUTDIR / f"{code}-{slug}.png"
    mmd = WORKDIR / f"{code}.mmd"
    mmd.write_text(src + "\n", encoding="utf-8")
    cmd = ["mmdc", "-i", str(mmd), "-o", str(png), "-s", "2", "-b", "white"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        print(f"ERRORE mmdc su {code}:\n{r.stdout}\n{r.stderr}")
        sys.exit(1)
    kb = png.stat().st_size / 1024
    print(f"OK  {png.name}  ({kb:.0f} KB)")
    rendered.append((code, title, src, png.name))

if not rendered:
    sys.exit("Nessun diagramma selezionato")

# ── Verifica PNG: esiste, non vuota, non bianca (rapporto pixel non bianchi) ──
def png_stats(path: Path):
    try:
        from PIL import Image
    except ImportError:
        return None
    im = Image.open(path).convert("L")
    im.thumbnail((400, 400))
    px = list(im.getdata())
    nonwhite = sum(1 for v in px if v < 245)
    return len(px), nonwhite / len(px)

print("\nVerifica contenuti:")
bad = []
for code, title, src, name in rendered:
    p = OUTDIR / name
    st = png_stats(p)
    if st is None:
        print(f"  {code}: PIL non disponibile, salto analisi pixel")
        continue
    total, ratio = st
    if ratio < 0.005:
        bad.append(code)
        print(f"  {code}: SOSPETTA immagine quasi bianca ({ratio:.2%})")
    else:
        print(f"  {code}: ok, pixel non bianchi {ratio:.1%}")
if bad:
    sys.exit(f"ATTENZIONE: diagrammi sospetti: {bad}")

# ── Salvataggio sorgenti per il visualizzatore HTML ──
import json
data = [{"code": c, "title": t, "src": s, "png": n} for c, t, s, n in rendered]
(WORKDIR / "sources.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\nSorgenti per il visualizzatore salvati in {WORKDIR/'sources.json'} ({len(data)} diagrammi)")


# ── Generazione del visualizzatore HTML (sempre, anche con --only) ──
def build_viewer():
    import datetime
    srcs = json.loads((WORKDIR / "sources.json").read_text(encoding="utf-8"))
    # se e' stato usato --only, sources.json contiene solo un diagramma: unisci a quelli esistenti
    if only:
        prev_path = WORKDIR / "sources_all.json"
        if prev_path.exists():
            prev = {d["code"]: d for d in json.loads(prev_path.read_text(encoding="utf-8"))}
        else:
            prev = {}
        for d in srcs:
            prev[d["code"]] = d
        srcs = [prev[k] for k in sorted(prev, key=lambda x: int(x[1:]))]
    else:
        (WORKDIR / "sources_all.json").write_text(json.dumps(srcs, ensure_ascii=False), encoding="utf-8")

    template = (ROOT / "scripts/diagrammi/viewer_template.html").read_text(encoding="utf-8")
    today = datetime.date.today().strftime("%d/%m/%Y")
    html = template.replace("__DATA__", json.dumps(srcs, ensure_ascii=False, indent=1))
    html = html.replace("__GENERATED__", "v1.0 · " + today)
    HTML.write_text(html, encoding="utf-8")
    print(f"Visualizzatore HTML generato: {HTML} ({len(srcs)} diagrammi)")


build_viewer()
