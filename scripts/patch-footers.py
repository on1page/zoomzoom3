#!/usr/bin/env python3
"""Post-processing WPS: patch instrText dei piè di pagina (ROMAN/arabic) e rimozione pgNumType vuote."""
import sys, zipfile, shutil, re, os

path = sys.argv[1]
tmp = path + ".tmp"
shutil.copy(path, tmp)

with zipfile.ZipFile(tmp, "r") as zin:
    names = zin.namelist()
    contents = {n: zin.read(n) for n in names}

# 1) Rimuovi <w:pgNumType/> vuote dal document.xml (sezione copertina)
doc = contents["word/document.xml"].decode("utf-8")
doc2 = doc.replace("<w:pgNumType/>", "")

# 1b) Rimuovi la voce TOC auto-generata da docx-js intrappolata nel paragrafo del campo
#     (il separatore e la prima voce hyperlinks convivono nello stesso <w:p>:
#      add_toc_placeholders.py non la rimuove e la prima voce risulta duplicata)
i = doc2.find("TOC \\h")
if i >= 0:
    pend = doc2.find("</w:p>", i)
    seg = doc2[i:pend]
    if "<w:hyperlink" in seg:
        seg2 = re.sub(r"<w:hyperlink.*?</w:hyperlink>", "", seg, count=1, flags=re.S)
        doc2 = doc2[:i] + seg2 + doc2[pend:]
        print("Rimossa voce TOC auto-generata duplicata (hyperlink nel paragrafo del campo)")
    else:
        print("Nessun hyperlink duplicato nel paragrafo del campo TOC")
else:
    print("AVVISO: campo TOC non trovato")

# Identifica l'ordine dei riferimenti ai footer nel document.xml:
# sectPr della sezione 2 (indice, ROMAN) e sezione 3 (corpo, arabic).
# docx-js genera footerN.xml in ordine di sezione; mappiamo tramite i rId nel sectPr.
rels = contents["word/_rels/document.xml.rels"].decode("utf-8")
rid_to_file = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"', rels))
# Ordine di dichiarazione dei footerReference nel document.xml
footer_refs = re.findall(r'<w:footerReference[^>]*r:id="(rId\d+)"', doc2)
ordered_files = [rid_to_file[r] for r in footer_refs if r in rid_to_file]
print("Footer in ordine di sezione:", ordered_files)

# Il primo footer dichiarato appartiene alla sezione con numerazione romana (indice),
# l'ultimo a quella araba (corpo). Se un solo footer è presente, resta arabic.
fmt_map = {}
if len(ordered_files) >= 2:
    fmt_map[ordered_files[0]] = "ROMAN"
    for f in ordered_files[1:]:
        fmt_map[f] = "arabic"
elif len(ordered_files) == 1:
    fmt_map[ordered_files[0]] = "arabic"

for fname, fmt in fmt_map.items():
    key = "word/" + fname
    if key not in contents:
        continue
    xml = contents[key].decode("utf-8")
    xml_new = re.sub(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        lambda m: m.group(1) + " PAGE \\* " + fmt + " \\* MERGEFORMAT " + m.group(2),
        xml,
    )
    if xml_new != xml:
        contents[key] = xml_new.encode("utf-8")
        print(f"Patch {fname}: PAGE -> PAGE \\* {fmt} \\* MERGEFORMAT")

contents["word/document.xml"] = doc2.encode("utf-8")
removed = doc.count("<w:pgNumType/>")
print(f"Rimosse {removed} pgNumType vuote")

with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        zout.writestr(n, contents[n])
os.remove(tmp)
print("Post-processing completato:", path)
