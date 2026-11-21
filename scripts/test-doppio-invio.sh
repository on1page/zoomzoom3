#!/bin/bash
# Test post-fix: flusso normale, DOPPIO INVIO concorrente sulla stessa città nuova,
# riuso della zona alla seconda richiesta.
set -u
BASE="http://localhost:3000"
JAR="/tmp/zz-cookies.txt"

echo "=== 1. Città nuova: primo invio ==="
curl -s -b "$JAR" -X POST "$BASE/api/entities" -H "Content-Type: application/json" \
  -d '{"address":"Via del Test Doppio 1","zone":{"name":"Viggiano","province":"Potenza","region":"Basilicata","lat":40.0333,"lng":15.9}}' | head -c 200
echo ""; echo ""

echo "=== 2. DOPPIO INVIO CONCORRENTE su città nuova (Satriano di Lucania) ==="
BODY1='{"address":"Via del Test Doppio 2","zone":{"name":"Satriano di Lucania","province":"Potenza","region":"Basilicata","lat":40.6,"lng":15.6167}}'
BODY2='{"address":"Via del Test Doppio 3","zone":{"name":"Satriano di Lucania","province":"Potenza","region":"Basilicata","lat":40.6,"lng":15.6167}}'
curl -s -b "$JAR" -X POST "$BASE/api/entities" -H "Content-Type: application/json" -d "$BODY1" -o /tmp/zz-r1.json &
curl -s -b "$JAR" -X POST "$BASE/api/entities" -H "Content-Type: application/json" -d "$BODY2" -o /tmp/zz-r2.json &
wait
echo "risposta 1: $(head -c 160 /tmp/zz-r1.json)"
echo "risposta 2: $(head -c 160 /tmp/zz-r2.json)"
echo ""

echo "=== 3. Stessa città di nuovo (dedup: zona già nota) ==="
curl -s -b "$JAR" -X POST "$BASE/api/entities" -H "Content-Type: application/json" \
  -d '{"address":"Via del Test Doppio 4","zone":{"name":"Satriano di Lucania","province":"Potenza","region":"Basilicata","lat":40.6,"lng":15.6167}}' | head -c 200
echo ""; echo ""

echo "=== 4. Zona nel DB (conteggio Satriano/Viggiano — deve essere 1 ciascuna) ==="
cd /home/z/my-project && python3 -c "
import sqlite3
con = sqlite3.connect('db/custom.db')
for z in ('satriano-di-lucania','viggiano'):
    n = con.execute('SELECT COUNT(*) FROM Zone WHERE id=?', (z,)).fetchone()[0]
    print(f'{z}: {n}')
"
echo "=== 5. Cleanup schede di test ==="
python3 -c "
import sqlite3
con = sqlite3.connect('/home/z/my-project/db/custom.db')
con.execute(\"DELETE FROM Entity WHERE name LIKE 'Via del Test Doppio%'\")
con.commit()
print('ripulite', con.total_changes, 'schede')
"
