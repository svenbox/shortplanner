#!/usr/bin/env bash
#
# Nollställer demo-instansen till ögonblicksbilden i demo-seed/shortplanner.db.
# Tänkt att köras från cron, t.ex. varje midnatt (värdens tidszon):
#
#   0 0 * * *  /sökväg/till/shortplanner/deploy/demo-reset.sh >> /var/log/sp-demo-reset.log 2>&1
#
# Skapa seed-filen en gång från en instans i önskat utgångsläge:
#
#   docker compose -f deploy/docker-compose.demo.yml stop shortplanner-demo
#   docker run --rm -v shortplanner-demo_shortplanner-demo-data:/data -v "$PWD/deploy/demo-seed":/seed \
#     alpine sh -c 'cp /data/shortplanner.db /seed/shortplanner.db'
#   docker compose -f deploy/docker-compose.demo.yml start shortplanner-demo
#
# (Checkpointa gärna WAL först, eller kopiera även -wal/-shm.)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$HERE/docker-compose.demo.yml}"
VOLUME="${VOLUME:-shortplanner-demo_shortplanner-demo-data}"
SEED_DIR="${SEED_DIR:-$HERE/demo-seed}"
SERVICE="${SERVICE:-shortplanner-demo}"

if [ ! -f "$SEED_DIR/shortplanner.db" ]; then
  echo "FEL: ingen seed i $SEED_DIR/shortplanner.db — se kommentaren överst i skriptet." >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" stop "$SERVICE"
docker run --rm -v "$VOLUME":/data -v "$SEED_DIR":/seed:ro alpine sh -c '
  rm -f /data/shortplanner.db /data/shortplanner.db-wal /data/shortplanner.db-shm /data/logo.* &&
  cp /seed/shortplanner.db /data/shortplanner.db
'
docker compose -f "$COMPOSE_FILE" start "$SERVICE"
echo "$(date -Is) demo nollställd till seed"
