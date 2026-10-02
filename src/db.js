import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from './config.js';

fs.mkdirSync(env.dataDir, { recursive: true });

export const db = new Database(path.join(env.dataDir, 'bookings.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY,
    ref           TEXT NOT NULL UNIQUE,
    token         TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL DEFAULT 'pending',
    service_id    TEXT NOT NULL,
    service_name  TEXT NOT NULL,
    service_price INTEGER,
    bike_type     TEXT,
    bike_brand    TEXT,
    bike_model    TEXT,
    problem       TEXT,
    date          TEXT NOT NULL,
    slot          TEXT NOT NULL,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT NOT NULL,
    address       TEXT NOT NULL,
    postcode      TEXT NOT NULL,
    city          TEXT,
    access_notes  TEXT,
    admin_notes   TEXT,
    cancel_reason TEXT,
    ip            TEXT,
    created_at    TEXT NOT NULL DEFAULT ${NOW},
    updated_at    TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (date, slot);
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY,
    booking_id   INTEGER NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    direction    TEXT NOT NULL,                  -- 'out' = to customer, 'in' = from customer
    kind         TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'auto'
    subject      TEXT,
    body         TEXT NOT NULL,
    email_status TEXT,                           -- 'sending' | 'sent' | 'failed'
    email_error  TEXT,
    read_at      TEXT,
    created_at   TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages (booking_id);

  CREATE TABLE IF NOT EXISTS closed_dates (
    date   TEXT PRIMARY KEY,
    reason TEXT
  );
`);

export { NOW };
