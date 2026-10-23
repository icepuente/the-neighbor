#!/usr/bin/env bash
# Deploys the site to the home server: Proxmox LXC 114, /opt/the-neighbor-demo, served as
# book.icepuente.com through Cloudflare Tunnel. Usage: scripts/deploy.sh [user@host]
# Sends web/ and deploy/, then (re)starts nginx and the tunnel. The tunnel container runs once
# cloudflared/config.yml exists on the server.
set -euo pipefail
HOST="${1:-deploy@192.168.0.223}"
DIR=/opt/the-neighbor-demo
cd "$(dirname "$0")/.."

npm run --silent vendor

# A new asset path for every deploy (see deploy/nginx/default.conf): the commit, plus a timestamp
# when there are uncommitted changes.
VERSION="$(git rev-parse --short HEAD)"
git diff --quiet HEAD -- web || VERSION="$VERSION-$(date +%s)"

tar -czf - web deploy \
  | ssh -o BatchMode=yes "$HOST" "set -e
      # Separate commands, so set -e stops the deploy if the folder is missing (root creates it,
      # through Jarvis: deploy cannot create folders in /opt).
      test -d $DIR
      cd $DIR
      # Remove old files but keep every folder: nginx has web/ and deploy/nginx/ mounted, and a
      # deleted (then recreated) folder leaves it attached to the old, empty one: no config, no site.
      for d in web deploy; do mkdir -p \$d; find \$d -mindepth 1 ! -type d -delete; done
      tar -xzf - --no-same-owner
      # Pages load scripts, styles and fonts from r/$VERSION/ (relative paths inside follow).
      sed -i -E 's#(src|href)=\"(js|css)/#\1=\"r/$VERSION/\2/#g' web/*.html
      grep -q 'r/$VERSION/js/' web/index.html
      cp deploy/compose.yaml compose.yaml
      profile=''
      if [ -f cloudflared/config.yml ]; then profile='--profile public'; fi
      docker compose \$profile up -d --remove-orphans --wait --wait-timeout 120
      docker compose exec -T nginx nginx -t -q
      docker compose exec -T nginx nginx -s reload
      sleep 1
      # The page must really be served, with this version's links; otherwise restart nginx and check again.
      served() { docker compose exec -T nginx wget -qO- http://127.0.0.1/ 2>/dev/null | grep -q 'r/$VERSION/js/'; }
      if ! served; then
        echo 'nginx did not serve the new page after reload: restarting it'
        docker compose \$profile up -d --force-recreate --no-deps nginx
        sleep 2
        served
      fi
      docker image prune -f >/dev/null
      docker compose \$profile ps --format '{{.Service}}: {{.Status}}'
      echo 'deployed version $VERSION'"
