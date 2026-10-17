#!/usr/bin/env bash
# Deploys the demo (phase 7) to the home server: Proxmox LXC 114, /opt/the-neighbor-demo, served as
# book.icepuente.com through Cloudflare Tunnel. Usage: scripts/deploy-demo.sh [user@host]
# Sends only what the demo needs (web/, the Functions, rules, deploy/demo/) and rebuilds the
# containers. The tunnel container runs once cloudflared/config.yml exists on the server.
set -euo pipefail
HOST="${1:-deploy@192.168.0.223}"
DIR=/opt/the-neighbor-demo
cd "$(dirname "$0")/.."

npm run --silent sync-shared

tar -czf - \
  --exclude='functions/node_modules' --exclude='functions/.env*' \
  web functions/index.js functions/photos.js functions/package.json functions/package-lock.json \
  functions/shared firestore.rules firestore.indexes.json storage.rules deploy/demo \
  | ssh -o BatchMode=yes "$HOST" "set -e
      # Separate commands, so set -e stops the deploy if the folder is missing (root creates it,
      # through Jarvis: deploy cannot create folders in /opt).
      test -d $DIR
      cd $DIR
      rm -rf web functions deploy
      tar -xzf - --no-same-owner
      cp deploy/demo/compose.yaml compose.yaml
      profile=''
      if [ -f cloudflared/config.yml ]; then profile='--profile public'; fi
      docker compose \$profile up -d --build --remove-orphans --wait --wait-timeout 300
      docker image prune -f >/dev/null
      docker compose \$profile ps"
