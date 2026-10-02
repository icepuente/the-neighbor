#!/usr/bin/env bash
# Sync the app to the server and rebuild/restart it.
# Usage: ./deploy.sh [user@host]
set -euo pipefail
HOST="${1:-deploy@192.168.0.223}"
DIR=/opt/bike-booking

rsync -az --delete \
  --exclude node_modules --exclude data --exclude backups --exclude cloudflared \
  --exclude '.env' --exclude '.env.*' --exclude .git \
  ./ "$HOST:$DIR/"

ssh "$HOST" "cd $DIR && mkdir -p data backups cloudflared && docker compose up -d --build --remove-orphans && docker image prune -f >/dev/null && docker compose ps"
