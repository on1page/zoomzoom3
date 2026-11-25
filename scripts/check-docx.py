#!/usr/bin/env python3
"""Verifica strutturale del DOCX: titoli, tabelle, segnaposto residui."""
from docx import Document
import re

doc = Document("/home/z/my-project/download/ZoomZoom_Relazione_analisi_implementazione.docx")
h1 = [p.text for p in doc.paragraphs if p.style.name == "Heading 1"]
h2 = [p.text for p in doc.paragraphs if p.style.name == "Heading 2"]
print("H1 (%d):" % len(h1))
for t in h1: print("  -", t)
print("H2 (%d):" % len(h2))
for t in h2: print("  -", t)
print("Tabelle:", len(doc.tables))
for i, tb in enumerate(doc.tables):
    print(f"  Tabella {i+1}: {len(tb.rows)} righe x {len(tb.columns)} colonne | header: {[c.text[:30] for c in tb.rows[0].cells]}")

full = "\n".join(p.text for p in doc.paragraphs)
for tb in doc.tables:
    for row in tb.rows:
        for c in row.cells:
            full += "\n" + c.text
issues = []
for pat in ["XXX", "TODO", "TBD", "undefined", "NaN", "待补充", "____"]:
    for m in re.finditer(re.escape(pat), full):
        issues.append((pat, full[max(0, m.start()-40):m.end()+40]))
# 【…】 ammessi SOLO se genuinely-missing professional items
placeholders = re.findall(r"【[^】]*】", full)
print("\nSegnaposto 【…】 presenti (%d):" % len(placeholders))
for p in set(placeholders): print("  -", p)
print("\nProblemi:", issues if issues else "nessuno")
words = len(re.findall(r"\S+", full))
print("Conteggio parole (corpo+tabelle):", words)
