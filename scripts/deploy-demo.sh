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

# A new asset path for every deploy (see deploy/demo/nginx/default.conf): the commit, plus a
# timestamp when there are uncommitted changes.
VERSION="$(git rev-parse --short HEAD)"
git diff --quiet HEAD -- web || VERSION="$VERSION-$(date +%s)"

tar -czf - \
  --exclude='functions/node_modules' --exclude='functions/.env*' \
  web functions/index.js functions/photos.js functions/package.json functions/package-lock.json \
  functions/shared firestore.rules firestore.indexes.json storage.rules deploy/demo \
  | ssh -o BatchMode=yes "$HOST" "set -e
      # Separate commands, so set -e stops the deploy if the folder is missing (root creates it,
      # through Jarvis: deploy cannot create folders in /opt).
      test -d $DIR
      cd $DIR
      # Empty the folders rather than delete them: nginx has web/ and deploy/demo/nginx/ mounted, and
      # a deleted folder would leave it serving nothing.
      for d in web functions deploy; do mkdir -p \$d; find \$d -mindepth 1 -delete; done
      tar -xzf - --no-same-owner
      # Pages load scripts, styles and fonts from r/$VERSION/ (relative paths inside follow).
      sed -i -E 's#(src|href)=\"(js|css)/#\1=\"r/$VERSION/\2/#g' web/*.html
      grep -q 'r/$VERSION/js/' web/index.html
      cp deploy/demo/compose.yaml compose.yaml
      profile=''
      if [ -f cloudflared/config.yml ]; then profile='--profile public'; fi
      docker compose \$profile up -d --build --remove-orphans --wait --wait-timeout 300
      docker compose exec -T nginx nginx -t -q
      docker compose exec -T nginx nginx -s reload
      docker image prune -f >/dev/null
      docker compose \$profile ps --format '{{.Service}}: {{.Status}}'
      echo 'deployed version $VERSION'"
