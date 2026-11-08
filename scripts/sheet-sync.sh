#!/usr/bin/env bash
# The owner's Google Sheet -> the live site. Downloads the sheet as CSV, applies it
# (scripts/texts.js sheet-import), runs the tests, and if anything changed: commits
# "Texts from the sheet: <n> changes", pushes to main and deploys (scripts/deploy.sh).
#
#   scripts/sheet-sync.sh
#
# Where the sheet comes from:
#   - normally a private sheet, through the Google Sheets API (scripts/sheet-google.js): used when
#     a spreadsheet ID is configured, in $NEIGHBOR_SHEET_ID or ~/.config/the-neighbor/sheet-id
#     (npm run sheet-create writes it). The credentials are in $NEIGHBOR_SHEET_OAUTH or
#     ~/.config/the-neighbor/google-oauth.json (client_id, client_secret, refresh_token).
#   - otherwise, as a fallback, a sheet shared "anyone with the link: viewer": SHEET_URL, its
#     normal address (…/spreadsheets/d/<id>/edit#gid=0) or CSV export address, also read from
#     ~/.config/the-neighbor/sheet-url. Downloaded with curl, no credentials.
#
# Meant for a timer (docs/review/README.md), in a clone of its own on main that nobody works in.
# Output and exit status, for whoever runs it:
#   0, silent       nothing changed in the sheet
#   0, a summary    changes applied, pushed and deployed (or texts' bookkeeping committed)
#   1, a reason     a failure: nothing was deployed (download, a refused cell, tests, push, deploy)
#   3, a summary    done, but some cells were not applied (conflicts, warnings, or rows with SLET on
#                   a text that cannot be deleted; listed): the sheet or the code needs a look
# Deleted privacy/terms paragraphs and texts deleted in one language only are flagged on lines of
# their own, starting with "!!", at the top of the summary.
# A failed deploy after a successful push is retried on the next run.
#
# Overrides, for the tests: SHEET_SYNC_TEST_CMD (default: npm test), SHEET_SYNC_DEPLOY_CMD (default:
# bash scripts/deploy.sh), SHEET_SYNC_NO_PUSH=1 (commit only), SHEET_SYNC_ALLOW_BRANCH=1.
set -uo pipefail
cd "$(dirname "$0")/.."
export NODE_NO_WARNINGS=1

say() { printf '%s\n' "$*"; }
die() { say "Sheet sync FAILED: $*" >&2; exit 1; }

CONFDIR="${XDG_CONFIG_HOME:-$HOME/.config}/the-neighbor"
if [ -n "${NEIGHBOR_SHEET_ID:-}" ] || [ -s "$CONFDIR/sheet-id" ]; then
  MODE=api
else
  MODE=url
  URL="${SHEET_URL:-}"
  CONF="$CONFDIR/sheet-url"
  [ -z "$URL" ] && [ -f "$CONF" ] && URL="$(tr -d '[:space:]' < "$CONF")"
  [ -n "$URL" ] || die "no sheet configured: no spreadsheet ID ($CONFDIR/sheet-id or NEIGHBOR_SHEET_ID) and no SHEET_URL ($CONF)."
fi
TEST_CMD="${SHEET_SYNC_TEST_CMD:-npm test --silent}"
DEPLOY_CMD="${SHEET_SYNC_DEPLOY_CMD:-bash scripts/deploy.sh}"

# One run at a time.
GIT_DIR="$(git rev-parse --git-dir)" || die "not a git clone."
exec 9>"$GIT_DIR/sheet-sync.lock"
flock -n 9 || exit 0
PENDING="$GIT_DIR/sheet-sync-pending-deploy"

# This clone: on main, clean, and up to date with GitHub.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = main ] || [ "${SHEET_SYNC_ALLOW_BRANCH:-}" = 1 ] || die "this clone is on $BRANCH, not main."
[ -z "$(git status --porcelain)" ] || die "this clone has uncommitted changes; it should be used for the sync only."
if [ "${SHEET_SYNC_NO_PUSH:-}" != 1 ]; then
  git pull --quiet --ff-only origin "$BRANCH" || die "git pull --ff-only failed (has this clone diverged from GitHub?)."
fi
START="$(git rev-parse HEAD)"
undo() { git reset --quiet --hard "$START"; }

deploy() {
  local out
  if out="$(bash -c "$DEPLOY_CMD" 2>&1)"; then
    rm -f "$PENDING"
    say "Deployed $(git rev-parse --short HEAD) to the site."
  else
    git rev-parse HEAD > "$PENDING"
    say "$out" | tail -20 >&2
    die "the texts are on GitHub ($(git rev-parse --short HEAD)) but the deploy failed; it is tried again on the next run."
  fi
}

# A deploy that failed last time comes first.
if [ -f "$PENDING" ]; then
  say "Retrying the deploy that failed last time."
  deploy
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ "$MODE" = api ]; then
  # The private sheet, through the Sheets API. Nothing secret is printed, only Google's message.
  if ! node scripts/sheet-google.js fetch --out="$TMP/sheet.csv" 2>"$TMP/fetch.txt"; then
    cat "$TMP/fetch.txt" >&2
    die "could not read the sheet through the Google API (see above); nothing changed on the site."
  fi
else
  CSV_URL="$(node scripts/texts.js sheet-url "$URL")"
  if [[ "$CSV_URL" == file://* ]]; then
    cp "${CSV_URL#file://}" "$TMP/sheet.csv" 2>/dev/null || die "could not read $CSV_URL."
  else
    curl -fsSL --max-time 60 --retry 2 -o "$TMP/sheet.csv" "$CSV_URL" || die "could not download the sheet ($CSV_URL). Is it shared as 'anyone with the link'?"
  fi
  # A sheet that is not shared answers with Google's sign-in page, not CSV.
  if head -c 2000 "$TMP/sheet.csv" | grep -qi '<!doctype html\|<html'; then
    die "the sheet answered with a web page, not CSV: share it as 'anyone with the link: viewer'."
  fi
fi

if ! node scripts/texts.js sheet-import "$TMP/sheet.csv" --summary="$TMP/summary.json" > "$TMP/import.txt" 2>&1; then
  undo
  cat "$TMP/import.txt" >&2
  die "the sheet was not applied (see above); nothing changed on the site."
fi
N="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).changes.length)' "$TMP/summary.json")"
ATTENTION="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1])); console.log(s.conflicts.length + s.warnings.length + s.rejected.length)' "$TMP/summary.json")"

if [ -z "$(git status --porcelain)" ]; then
  # Nothing to change. Only conflicts and warnings are worth a word.
  if [ "$ATTENTION" != 0 ]; then cat "$TMP/import.txt"; exit 3; fi
  exit 0
fi

if [ "$N" != 0 ]; then
  if ! TEST_OUT="$(bash -c "$TEST_CMD" 2>&1)"; then
    undo
    cat "$TMP/import.txt"
    say "$TEST_OUT" | grep -E '^not ok|^# (pass|fail)|Error|expected|actual' | head -40 >&2
    die "the tests failed with the sheet's changes, so nothing was committed or deployed. Revert the cell(s) above in the sheet, or ask Alec."
  fi
fi

if [ "$N" != 0 ]; then MSG="Texts from the sheet: $N change$([ "$N" = 1 ] || echo s)"; else MSG="Texts from the sheet: bookkeeping (docs/review/sheet-state.json)"; fi
git add -A web docs/review/sheet-state.json
{ say "$MSG"; say; cat "$TMP/import.txt"; } | git commit --quiet -F - || { undo; die "git commit failed."; }

if [ "${SHEET_SYNC_NO_PUSH:-}" != 1 ]; then
  if ! git push --quiet origin "HEAD:$BRANCH" 2>"$TMP/push.txt"; then
    cat "$TMP/push.txt" >&2
    undo
    die "git push was refused (someone pushed meanwhile?); the next run starts again from GitHub."
  fi
fi

[ "$N" != 0 ] && cat "$TMP/import.txt"
# Only a change to web/ needs a deploy (the bookkeeping is in docs/).
if ! git diff --quiet "$START" HEAD -- web; then deploy; fi
[ "$ATTENTION" != 0 ] && exit 3
exit 0
