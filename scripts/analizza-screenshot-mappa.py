"""Analizza gli screenshot della mappa per capire quale basemap mostrano:
- maschera estero scura (#1B2A38 @62% su basemap chiara => ~ (110,120,130) scuri-bluastri)
- stile MapTiler backdrop (quasi bianco, grigio chiarissimo)
- OSM classico (verde/bge/colorato, tonalita' varie)
"""
from PIL import Image
import sys

def avg(img, box):
    px = img.crop(box).convert("RGB")
    w, h = px.size
    tot = [0, 0, 0]
    n = 0
    for x in range(0, w, 4):
        for y in range(0, h, 4):
            r, g, b = px.getpixel((x, y))
            tot[0] += r; tot[1] += g; tot[2] += b; n += 1
    return tuple(t // n for t in tot)

for path in sys.argv[1:]:
    im = Image.open(path).convert("RGB")
    W, H = im.size
    print(f"\n=== {path} ({W}x{H}) ===")
    # angoli e aree fuori Italia (l'Italia e' al centro): topLeft, topRight, bottomLeft, bottomRight
    zones = {
        "angolo-alto-sx (estero: Francia/CH)": (0, 0, W // 5, H // 5),
        "angolo-alto-dx (estero: Slovenia/Balcani)": (4 * W // 5, 0, W, H // 5),
        "fascia-centro (Italia)": (2 * W // 5, 2 * H // 5, 3 * W // 5, 3 * H // 5),
        "angolo-basso-sx (Mar Tirreno/Africa)": (0, 4 * H // 5, W // 5, H),
        "angolo-basso-dx (estero: Grecia/Med or.)": (4 * W // 5, 4 * H // 5, W, H),
    }
    for name, box in zones.items():
        r, g, b = avg(im, box)
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        print(f"  {name:42s} RGB=({r:3d},{g:3d},{b:3d}) lum={lum:5.1f}")
