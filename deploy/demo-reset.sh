#!/usr/bin/env bash
#
# Återställer demo-instansen till deploy/demo-seed/shortplanner.db och rullar
# sedan datumen så inspelningsdag 1 blir dagens datum (scripts/demo-redate.js),
# så att väder och 🎬 Inspelningsläge fungerar. Tänkt för cron, varje midnatt:
#
#   0 0 * * *  /sökväg/till/shortplanner/deploy/demo-reset.sh >> /var/log/sp-demo-reset.log 2>&1
#
# shortplanner.db byggs från deploy/demo-seed/*.json och checkas in i repot.
# Bygg om den efter att ha ändrat JSON:en:
#
#   deploy/demo-build-seed.sh          # importerar JSON:en -> demo-seed/shortplanner.db

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
# Rulla datumen (container fortfarande stoppad -> ingen skrivkonflikt).
docker compose -f "$COMPOSE_FILE" run --rm --no-deps "$SERVICE" node scripts/demo-redate.js /data/shortplanner.db
docker compose -f "$COMPOSE_FILE" start "$SERVICE"
echo "$(date -Is) demo nollställd till seed + omdaterad"
