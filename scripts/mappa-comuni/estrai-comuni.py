#!/usr/bin/env python3
"""ZoomZoom — estrazione dei confini comunali per regione (public/comuni/).

Fonte: guglielmo/geojson-italy (ridistribuzione CC-BY di dati ISTAT),
vintage 1 gennaio 2026, livello "comuni", TopoJSON semplificato al 20%.

Passaggi (già eseguiti, qui documentati per riproducibilità):
  1. download dei 20 file per regione:
       https://raw.githubusercontent.com/guglielmo/geojson-italy/main/
       topojson/limits_R_{N}_municipalities.topo.json     (N = 1..20, ISTAT)
  2. conversione in GeoJSON con mapshaper (semplificazione del 20% già
     presente nella fonte; coordinate arrotondate a 4 decimali ~ 11 m):
       npx -y mapshaper R_N.topo.json -clean \
            -o precision=0.0001 format=geojson raw/rN.geojson
  3. questo script: ripulisce le proprietà di ogni comune a
       { "nome": "Bolzano", "prov": "Bolzano/Bozen" }
     (nome = denominazione italiana, parte prima di "/" per i comuni
     bilingui dell'Alto Adige; prov = denominazione provinciale ISTAT),
     verifica la coerenza regione/codice e scrive i file definitivi in
       public/comuni/r{N}.geojson   (minificati)
     Consumati dalla mappa pubblica con caricamento on-demand per regione.

Il client calcola la chiave di confronto (normName) a runtime con la
stessa funzione usata per le zone del catalogo: nessuna chiave precalcolata
qui, così la normalizzazione resta definita in un solo posto (lib/map-italy).
"""
import json
import sys
from pathlib import Path

SRC = Path("/tmp/comuni-src/raw")
DST = Path("/home/z/my-project/public/comuni")

# nomi canonici attesi (come REGIONI_ISTAT in src/lib/map-italy.ts),
# indicizzati per codice ISTAT di regione
REGIONI = {
    1: "Piemonte", 2: "Valle d'Aosta/Vallée d'Aoste", 3: "Lombardia",
    4: "Trentino-Alto Adige/Südtirol", 5: "Veneto", 6: "Friuli-Venezia Giulia",
    7: "Liguria", 8: "Emilia-Romagna", 9: "Toscana", 10: "Umbria",
    11: "Marche", 12: "Lazio", 13: "Abruzzo", 14: "Molise", 15: "Campania",
    16: "Puglia", 17: "Basilicata", 18: "Calabria", 19: "Sicilia",
    20: "Sardegna",
}


def main() -> int:
    if not SRC.is_dir():
        print(f"ERRORE: sorgenti non trovate in {SRC}", file=sys.stderr)
        print("Ripetere i passaggi 1-2 descritti nel docstring.", file=sys.stderr)
        return 1
    DST.mkdir(parents=True, exist_ok=True)
    totale = 0
    for codice in range(1, 21):
        src = SRC / f"r{codice}.geojson"
        data = json.loads(src.read_text(encoding="utf-8"))
        feats = data["features"]
        ok_regione = True
        for f in feats:
            p = f["properties"] or {}
            if p.get("reg_istat_code_num") != codice:
                ok_regione = False
            # denominazione italiana (parte prima di "/" per i bilingui)
            nome = str(p.get("name", "")).split("/")[0].strip()
            prov = str(p.get("prov_name", "")).strip()
            f["properties"] = {"nome": nome, "prov": prov} if prov else {"nome": nome}
        data["features"] = feats
        out = DST / f"r{codice}.geojson"
        out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        kb = out.stat().st_size / 1024
        totale += len(feats)
        stato = "ok" if ok_regione else "CODICE REGIONE INCOERENTE"
        print(f"r{codice:<2} {REGIONI[codice]:<32} {len(feats):>5} comuni "
              f"{kb:>8.0f} KB  {stato}")
    print(f"--- totale comuni: {totale} (attesi 7896)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
