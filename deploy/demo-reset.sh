#!/usr/bin/env bash
#
# Nollställer demo-instansen till ögonblicksbilden i demo-seed/shortplanner.db.
# Tänkt att köras från cron, t.ex. varje midnatt (värdens tidszon):
#
#   0 0 * * *  /sökväg/till/shortplanner/deploy/demo-reset.sh >> /var/log/sp-demo-reset.log 2>&1
#
# Skapa seed-filen en gång från en instans i önskat utgångsläge (checkpointa
# WAL:en så allt hamnar i själva .db-filen):
#
#   docker compose -f deploy/docker-compose.demo.yml stop shortplanner-demo
#   docker run --rm -v shortplanner-demo_shortplanner-demo-data:/data -v "$PWD/deploy/demo-seed":/seed alpine \
#     sh -c 'apk add --no-cache sqlite >/dev/null; sqlite3 /data/shortplanner.db "PRAGMA wal_checkpoint(TRUNCATE);"; cp /data/shortplanner.db /seed/shortplanner.db'
#   docker compose -f deploy/docker-compose.demo.yml start shortplanner-demo

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$HERE/docker-compose.demo.yml}"
VOLUME="${VOLUME:-shortplanner-demo_shortplanner-demo-data}"
SEED_DIR="${SEED_DIR:-$HERE/demo-seed}"
SERVICE="${SERVICE:-shortplanner-demo}"
# Uid:gid som appen kör som i containern (Dockerfile: USER node = 1000:1000).
# Den kopierade filen måste ägas av den, annars öppnar SQLite databasen
# skrivskyddad och varje spar-försök blir "Serverfel".
APP_UID="${APP_UID:-1000}"

if [ ! -f "$SEED_DIR/shortplanner.db" ]; then
  echo "FEL: ingen seed i $SEED_DIR/shortplanner.db — se kommentaren överst i skriptet." >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" stop "$SERVICE"
docker run --rm -v "$VOLUME":/data -v "$SEED_DIR":/seed:ro alpine sh -c "
  rm -f /data/shortplanner.db /data/shortplanner.db-wal /data/shortplanner.db-shm /data/logo.* &&
  cp /seed/shortplanner.db /data/shortplanner.db &&
  chown ${APP_UID}:${APP_UID} /data/shortplanner.db &&
  chmod 644 /data/shortplanner.db
"
docker compose -f "$COMPOSE_FILE" start "$SERVICE"
echo "$(date -Is) demo nollställd till seed"
