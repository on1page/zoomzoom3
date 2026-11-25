#!/bin/bash
# Riproduzione bug: POST /api/entities con città da suggerimento + pin mappa
set -u
BASE="http://localhost:3000"
JAR="/tmp/zz-cookies.txt"
rm -f "$JAR"

echo "=== 1. Login ==="
for PW in "ZoomZoom-Demo-2026" "Arianna_84"; do
  CODE=$(curl -s -o /tmp/zz-login.json -w "%{http_code}" -c "$JAR" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"utente@esempio.test\",\"password\":\"$PW\"}")
  echo "pw=$PW → HTTP $CODE $(head -c 200 /tmp/zz-login.json)"
  if [ "$CODE" = "200" ]; then break; fi
done

echo ""
echo "=== 2. Payload tipo utente: città scelta dai suggerimenti + pin mappa ==="
curl -s -b "$JAR" -X POST "$BASE/api/entities" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "Via dei Test 42",
    "zone": { "name": "Brescia", "province": "BS", "region": "Lombardia", "lat": 45.5415, "lng": 10.211 },
    "geo": { "lat": 45.5416, "lng": 10.2115 }
  }' | head -c 600
echo ""
echo ""
echo "=== 3. Variante: zone con lat/lng undefined (come manda il client se i coord non sono finiti) ==="
curl -s -b "$JAR" -X POST "$BASE/api/entities" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "Via dei Test 43",
    "zone": { "name": "Alatri", "province": "Frosinone", "region": "Lazio" },
    "geo": { "lat": 41.7333, "lng": 13.3333 }
  }' | head -c 600
echo ""
echo ""
echo "=== 4. Variante: zoneId di zona esistente (moncenisio) ==="
curl -s -b "$JAR" -X POST "$BASE/api/entities" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "Via dei Test 44",
    "zoneId": "moncenisio",
    "geo": { "lat": 45.2053, "lng": 6.9825 }
  }' | head -c 600
echo ""
