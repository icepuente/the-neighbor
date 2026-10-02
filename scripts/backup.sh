#!/usr/bin/env bash
# Nightly SQLite backup. Install with: crontab -e  ->  15 3 * * * /opt/bike-booking/scripts/backup.sh
set -euo pipefail
DIR=/opt/bike-booking
mkdir -p "$DIR/backups"
sqlite3 "$DIR/data/bookings.db" ".backup '$DIR/backups/bookings-$(date +%F).db'"
gzip -f "$DIR/backups/bookings-$(date +%F).db"
find "$DIR/backups" -name 'bookings-*.db.gz' -mtime +30 -delete
