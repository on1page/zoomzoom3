#!/bin/bash
# Test end-to-end dei flussi di login sul mirror in production standalone
set -e
cd /home/z/my-project

# esporta le variabili da .env senza stamparle
set -a; source .env; set +a
export PORT=3100 HOSTNAME=127.0.0.1 NODE_ENV=production

bun .next/standalone/server.js > /tmp/zoomzoom-prod.log 2>&1 &
SRV=$!
sleep 4

BASE=http://127.0.0.1:3100
PW='ZoomZoom-Demo-2026'

echo "=== 1) login utente@ (senza 2FA dopo seed) ==="
curl -s -c /tmp/c-user.txt -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"utente@esempio.test\",\"password\":\"$PW\"}" -w "\nHTTP %{http_code}\n"

echo "=== 2) GET /api/me/overview (il problema 1 dell'utente) ==="
curl -s -b /tmp/c-user.txt $BASE/api/me/overview -w "\nHTTP %{http_code}\n" | head -c 400
echo ""

echo "=== 3) admin login superadmin con codice VUOTO (aspettato: QR enrollment) ==="
curl -s -c /tmp/c-admin.txt -X POST $BASE/api/admin/login -H "Content-Type: application/json" \
  -d "{\"email\":\"superadmin@esempio.test\",\"password\":\"$PW\",\"code\":\"\"}" -w "\nHTTP %{http_code}\n" | head -c 300
echo ""

echo "=== 4) admin login superadmin con codice TOTP valido ==="
CODE=$(bun scripts/totp.ts superadmin@esempio.test 2>/dev/null | grep -oE '^[0-9]{6}$' | head -1)
echo "codice generato: $CODE"
curl -s -c /tmp/c-admin.txt -X POST $BASE/api/admin/login -H "Content-Type: application/json" \
  -d "{\"email\":\"superadmin@esempio.test\",\"password\":\"$PW\",\"code\":\"$CODE\"}" -w "\nHTTP %{http_code}\n"

echo "=== 5) bootstrap con sessione utente (il 'loggato come ARIANNA85') ==="
curl -s -b /tmp/c-user.txt $BASE/api/public/bootstrap | head -c 300
echo ""

kill $SRV 2>/dev/null || true
