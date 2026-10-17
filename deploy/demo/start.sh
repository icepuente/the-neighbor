#!/bin/sh
# Starts the demo's emulators, fills them with demo data (scripts/seed-demo.js: the owner's login,
# sample bookings) once they answer, and exits after 24 hours so Docker restarts everything empty:
# the daily wipe.
set -e
timeout 24h firebase emulators:start --project demo-the-neighbor --only auth,firestore,functions,storage &
EMU=$!
for _ in $(seq 1 90); do
  if node /app/healthcheck.js; then
    EMULATOR_HOST=127.0.0.1 FUNCTIONS_PACKAGE=./functions/package.json node /app/seed-demo.js demo-the-neighbor || true
    break
  fi
  sleep 2
done
wait $EMU
