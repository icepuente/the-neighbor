#!/usr/bin/env bash
# Deploys the site to the home server: Proxmox LXC 114, /opt/the-neighbor-demo, served as
# theneighbor.dk through Cloudflare Tunnel. Usage: scripts/deploy.sh [user@host]
# Sends web/, deploy/ and api/, then (re)starts nginx, the booking API and the tunnel. The tunnel
# container runs once cloudflared/config.yml exists on the server.
# The Resend API key stays on the server, in secrets/resend.env (docs/operations.md): this script
# never sends, reads, copies or deletes anything in secrets/ (or cloudflared/); it only makes sure
# the empty folder secrets/nginx/ exists, for nginx's mount (deploy/compose.yaml).
set -euo pipefail
HOST="${1:-deploy@192.168.0.223}"
DIR=/opt/the-neighbor-demo
cd "$(dirname "$0")/.."

# Customers' requests must reach the owner: no deploy with the example.com placeholder address.
if grep -q "email: '[^']*@example\.com'" web/js/booking-rules.js; then
  echo "Refusing to deploy: CONFIG.contact.email in web/js/booking-rules.js is still a placeholder." >&2
  exit 1
fi

# Never deploy anything but what is on GitHub (2026-11-07: a deploy from a clone that had not been
# fetched rolled theneighbor.dk back past seven commits another session had pushed and deployed).
# 1. This clone: HEAD must be origin/main exactly (not behind, diverged, or ahead and unpushed, which
#    the next deploy from elsewhere would roll back), with nothing uncommitted in what is sent.
# 2. The server: the commit it runs (.deployed-commit, written below) must be in HEAD's history, so a
#    deploy that was never pushed is not overwritten either.
# DEPLOY_ALLOW_UNSYNCED=1 skips both, for an emergency only.
refuse() { echo "Refusing to deploy: $1" >&2; echo "(DEPLOY_ALLOW_UNSYNCED=1 overrides, for an emergency only.)" >&2; exit 1; }
if [ "${DEPLOY_ALLOW_UNSYNCED:-}" = 1 ]; then
  echo "WARNING: DEPLOY_ALLOW_UNSYNCED=1: not checking this clone against GitHub or the server." >&2
else
  git fetch --quiet origin main || refuse "could not fetch origin/main to compare."
  HEAD_SHA="$(git rev-parse HEAD)"
  ORIGIN_SHA="$(git rev-parse origin/main)"
  if [ "$HEAD_SHA" != "$ORIGIN_SHA" ]; then
    if git merge-base --is-ancestor HEAD origin/main; then refuse "this clone is behind origin/main: git pull first."
    elif git merge-base --is-ancestor origin/main HEAD; then refuse "this clone has commits not on GitHub: git push first."
    else refuse "this clone and origin/main have diverged: rebase on origin/main, push, then deploy."; fi
  fi
  git diff --quiet HEAD -- web deploy api && [ -z "$(git ls-files --others --exclude-standard -- web deploy api)" ] \
    || refuse "uncommitted changes in web/, deploy/ or api/: commit and push them first."
  SERVER_SHA="$(ssh -o BatchMode=yes "$HOST" "cat $DIR/.deployed-commit 2>/dev/null || true")"
  if [ -n "$SERVER_SHA" ] && ! git merge-base --is-ancestor "$SERVER_SHA" HEAD 2>/dev/null; then
    refuse "the server runs ${SERVER_SHA:0:7}, which is not in this clone's history (deployed from elsewhere, not pushed?)."
  fi
fi

npm run --silent vendor

# A new asset path for every deploy (see deploy/nginx/default.conf): the commit, plus a timestamp
# when there are uncommitted changes.
VERSION="$(git rev-parse --short HEAD)"
DEPLOY_SHA="$(git rev-parse HEAD)"
git diff --quiet HEAD -- web || VERSION="$VERSION-$(date +%s)"

# Only these three folders are sent, and never an env file, wherever one might be.
tar -czf - --exclude='.env' --exclude='.env.*' --exclude='*.env' web deploy api \
  | ssh -o BatchMode=yes "$HOST" "set -e
      # Separate commands, so set -e stops the deploy if the folder is missing (root creates it,
      # through Jarvis: deploy cannot create folders in /opt).
      test -d $DIR
      cd $DIR
      # Remove old files but keep every folder: nginx has web/ and deploy/nginx/ mounted, and a
      # deleted (then recreated) folder leaves it attached to the old, empty one: no config, no site.
      # api/ and web/js/ are mounted into the api container the same way.
      for d in web deploy api; do mkdir -p \$d; find \$d -mindepth 1 ! -type d -delete; done
      tar -xzf - --no-same-owner
      # nginx mounts secrets/nginx/ (the address token, if any; see deploy/compose.yaml). Made here,
      # so Docker does not create it as root; nothing in it is ever sent from here.
      mkdir -p secrets/nginx
      # Pages load scripts, styles and fonts from r/$VERSION/ (relative paths inside follow).
      sed -i -E 's#(src|href)=\"(js|css)/#\1=\"r/$VERSION/\2/#g' web/*.html
      grep -q 'r/$VERSION/js/' web/index.html
      cp deploy/compose.yaml compose.yaml
      profile=''
      if [ -f cloudflared/config.yml ]; then profile='--profile public'; fi
      docker compose \$profile up -d --remove-orphans --wait --wait-timeout 120
      docker compose exec -T nginx nginx -t -q
      docker compose exec -T nginx nginx -s reload
      # The API loads its code (and web/js) at start, and its key from secrets/resend.env when the
      # container is created: recreate it on every deploy.
      docker compose \$profile up -d --no-deps --force-recreate --wait --wait-timeout 60 api
      sleep 1
      # The page must really be served, with this version's links; otherwise restart nginx and check again.
      served() { docker compose exec -T nginx wget -qO- http://127.0.0.1/ 2>/dev/null | grep -q 'r/$VERSION/js/'; }
      if ! served; then
        echo 'nginx did not serve the new page after reload: restarting it'
        docker compose \$profile up -d --force-recreate --no-deps nginx
        sleep 2
        served
      fi
      # The API answers through nginx: an empty request is refused (400), or 503 while there is no key.
      # (BusyBox wget -S prints the status line, e.g. 'HTTP/1.1 400 Bad Request'.)
      api=\$(docker compose exec -T nginx wget -S -O /dev/null --header 'Content-Type: application/json' --post-data '{}' http://127.0.0.1/api/request 2>&1 || true)
      echo \"\$api\" | grep -qE 'HTTP/1.1 (400|503)'
      if echo \"\$api\" | grep -q 'HTTP/1.1 503'; then
        echo 'api: no RESEND_API_KEY in secrets/resend.env: booking requests fall back to mailto:'
      else
        echo 'api: email configured'
      fi
      # Address suggestions through nginx (a warning only: the register being down is not this deploy).
      if docker compose exec -T nginx wget -qO- 'http://127.0.0.1/api/address?q=Jagtvej+10' 2>/dev/null | grep -q '\"status\":\"ok\"'; then
        echo 'address suggestions: ok'
      else
        echo 'WARNING: /api/address did not answer ok (the register, or the token in secrets/nginx/?)'
      fi
      # What the server now runs, for the next deploy's check (see the top of this script).
      echo '$DEPLOY_SHA' > .deployed-commit
      docker image prune -f >/dev/null
      docker compose \$profile ps --format '{{.Service}}: {{.Status}}'
      echo 'deployed version $VERSION'"
