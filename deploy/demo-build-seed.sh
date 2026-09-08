#!/usr/bin/env bash
#
# Bygger deploy/demo-seed/shortplanner.db från deploy/demo-seed/<SEED_JSON>
# genom att importera projektet i en tillfällig, ISOLERAD app-instans
# (DEMO_MODE=0 — import är blockerad i demoläge) och sedan checkpointa och
# kopiera ut databasen. Kör om efter att ha ändrat JSON:en.
#
#   deploy/demo-build-seed.sh
#   deploy/demo-build-seed.sh annat-projekt.json
#
# Därefter checkar du in deploy/demo-seed/shortplanner.db.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SEED_DIR="$HERE/demo-seed"
SEED_JSON="${1:-${SEED_JSON:-palsen-project.json}}"
COMPOSE_FILE="$HERE/docker-compose.demo.yml"
PROJ="sp-seedbuild-$$"
PORT="${BUILD_PORT:-8097}"
APP_UID="${APP_UID:-1000}"

[ -f "$SEED_DIR/$SEED_JSON" ] || { echo "FEL: $SEED_DIR/$SEED_JSON saknas" >&2; exit 1; }

cleanup() { docker compose -p "$PROJ" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "» startar tillfällig instans ($PROJ) på :$PORT"
DEMO_MODE=0 HOST_PORT="$PORT" docker compose -p "$PROJ" -f "$COMPOSE_FILE" up -d --build

echo "» väntar på hälsokoll"
for i in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/api/version" >/dev/null 2>&1 && break
  sleep 1
done

CK="$(curl -s -c - -X POST "http://127.0.0.1:$PORT/api/login" \
  -H 'Content-Type: application/json' -d '{"password":"demo"}' | awk '/sp_session/{print $NF}')"
[ -n "$CK" ] || { echo "FEL: kunde inte logga in" >&2; exit 1; }

echo "» importerar $SEED_JSON"
RES="$(curl -s -X POST "http://127.0.0.1:$PORT/api/projects/import" \
  -H "Cookie: sp_session=$CK" -H 'Content-Type: application/json' \
  --data-binary @"$SEED_DIR/$SEED_JSON")"
echo "  $RES"
echo "$RES" | grep -q '"id"' || { echo "FEL: import misslyckades" >&2; exit 1; }

# neutralisera sajtinställningarna (bolagsnamn syns i topplisten)
curl -s -X PUT "http://127.0.0.1:$PORT/api/site" -H "Cookie: sp_session=$CK" \
  -H 'Content-Type: application/json' \
  -d '{"company":{"name":"Shortplanner-demo","orgnr":"","address":"","phone":"","email":"","website":""},"locale":"sv"}' >/dev/null

VOL="${PROJ}_shortplanner-demo-data"
docker compose -p "$PROJ" -f "$COMPOSE_FILE" stop >/dev/null
docker run --rm -v "$VOL":/data -v "$SEED_DIR":/seed alpine sh -c "
  apk add --no-cache sqlite >/dev/null &&
  sqlite3 /data/shortplanner.db 'PRAGMA wal_checkpoint(TRUNCATE); VACUUM;' &&
  cp /data/shortplanner.db /seed/shortplanner.db &&
  chown ${APP_UID}:${APP_UID} /seed/shortplanner.db
"
echo "» klart: $SEED_DIR/shortplanner.db"
