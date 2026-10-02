import crypto from 'node:crypto';
import { db, NOW } from './db.js';
import { site } from './config.js';
import { checkSlot, todayStr } from './schedule.js';

export const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I

function makeRef() {
  let s = '';
  for (const b of crypto.randomBytes(6)) s += REF_ALPHABET[b % 32];
  return `${site.refPrefix || 'BK'}-${s}`;
}

const insertBooking = db.prepare(`
  INSERT INTO bookings (
    ref, token, status, service_id, service_name, service_price,
    bike_type, bike_brand, bike_model, problem, date, slot,
    name, email, phone, address, postcode, city, access_notes, ip
  ) VALUES (
    @ref, @token, @status, @service_id, @service_name, @service_price,
    @bike_type, @bike_brand, @bike_model, @problem, @date, @slot,
    @name, @email, @phone, @address, @postcode, @city, @access_notes, @ip
  )
`);
const refExists = db.prepare('SELECT 1 FROM bookings WHERE ref = ?').pluck();
const byId = db.prepare('SELECT * FROM bookings WHERE id = ?');
const byToken = db.prepare('SELECT * FROM bookings WHERE token = ?');

export const getBooking = (id) => byId.get(id);
export const getBookingByToken = (token) => byToken.get(token);

// Runs inside a transaction so the capacity check and the insert are atomic.
export const createBooking = db.transaction((data) => {
  const check = checkSlot(data.date, data.slot);
  if (!check.ok) return check;

  let ref;
  do ref = makeRef();
  while (refExists.get(ref));

  const { lastInsertRowid } = insertBooking.run({
    ...data,
    ref,
    token: crypto.randomBytes(24).toString('base64url'),
    status: site.autoConfirm ? 'confirmed' : 'pending',
  });
  return { ok: true, booking: byId.get(lastInsertRowid) };
});

const setStatusStmt = db.prepare(
  `UPDATE bookings SET status = ?, cancel_reason = ?, updated_at = ${NOW} WHERE id = ?`,
);
export function setStatus(id, status, cancelReason = null) {
  setStatusStmt.run(status, status === 'cancelled' ? cancelReason : null, id);
  return byId.get(id);
}

const rescheduleStmt = db.prepare(`UPDATE bookings SET date = ?, slot = ?, updated_at = ${NOW} WHERE id = ?`);
export const reschedule = db.transaction((id, date, slot, force) => {
  if (!force) {
    const check = checkSlot(date, slot, { excludeId: id, enforceWindow: false });
    if (!check.ok) return check;
  }
  rescheduleStmt.run(date, slot, id);
  return { ok: true, booking: byId.get(id) };
});

const notesStmt = db.prepare(`UPDATE bookings SET admin_notes = ?, updated_at = ${NOW} WHERE id = ?`);
export const setAdminNotes = (id, notes) => notesStmt.run(notes, id);

// --- Messages --------------------------------------------------------------

const insertMessage = db.prepare(`
  INSERT INTO messages (booking_id, direction, kind, subject, body, email_status)
  VALUES (@booking_id, @direction, @kind, @subject, @body, @email_status)
`);
export function addMessage(m) {
  return insertMessage.run({ kind: 'manual', subject: null, email_status: null, ...m }).lastInsertRowid;
}

const emailStatusStmt = db.prepare('UPDATE messages SET email_status = ?, email_error = ? WHERE id = ?');
export const setEmailStatus = (id, status, error = null) => emailStatusStmt.run(status, error, id);

const messagesFor = db.prepare('SELECT * FROM messages WHERE booking_id = ? ORDER BY created_at, id');
export const getMessages = (bookingId) => messagesFor.all(bookingId);

const markReadStmt = db.prepare(
  `UPDATE messages SET read_at = ${NOW} WHERE booking_id = ? AND direction = 'in' AND read_at IS NULL`,
);
export const markRead = (bookingId) => markReadStmt.run(bookingId);

// --- Admin listing -----------------------------------------------------------

const VIEWS = {
  upcoming: { where: "b.status IN ('pending', 'confirmed') AND b.date >= @today", order: 'b.date, b.slot' },
  pending: { where: "b.status = 'pending'", order: 'b.date, b.slot' },
  past: {
    where: "b.status = 'completed' OR (b.status IN ('pending', 'confirmed') AND b.date < @today)",
    order: 'b.date DESC, b.slot DESC',
  },
  cancelled: { where: "b.status = 'cancelled'", order: 'b.date DESC, b.slot DESC' },
  all: { where: '1 = 1', order: 'b.created_at DESC' },
};

export function listBookings({ view = 'upcoming', q = '' } = {}) {
  const v = VIEWS[view] || VIEWS.upcoming;
  const params = { today: todayStr(), q: `%${q.trim().toLowerCase()}%` };
  const search = q.trim()
    ? `AND (lower(b.name) LIKE @q OR lower(b.email) LIKE @q OR lower(b.phone) LIKE @q
            OR lower(b.ref) LIKE @q OR lower(b.address) LIKE @q OR lower(b.postcode) LIKE @q)`
    : '';
  return db
    .prepare(
      `SELECT b.id, b.ref, b.status, b.service_name, b.date, b.slot, b.name, b.email, b.phone,
              b.address, b.postcode, b.city, b.bike_type, b.created_at,
              (SELECT COUNT(*) FROM messages m
                WHERE m.booking_id = b.id AND m.direction = 'in' AND m.read_at IS NULL) AS unread
       FROM bookings b
       WHERE (${v.where}) ${search}
       ORDER BY ${v.order}
       LIMIT 500`,
    )
    .all(params);
}

const statsStmt = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM bookings WHERE status IN ('pending', 'confirmed') AND date >= @today) AS upcoming,
    (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending,
    (SELECT COUNT(*) FROM bookings WHERE status IN ('pending', 'confirmed') AND date = @today) AS today,
    (SELECT COUNT(*) FROM messages WHERE direction = 'in' AND read_at IS NULL) AS unread
`);
export const getStats = () => statsStmt.get({ today: todayStr() });

export const allBookings = () => db.prepare('SELECT * FROM bookings ORDER BY date, slot').all();

// --- Closed dates ------------------------------------------------------------

export const listClosedDates = () =>
  db.prepare('SELECT date, reason FROM closed_dates WHERE date >= ? ORDER BY date').all(todayStr());
export const addClosedDate = (date, reason) =>
  db.prepare('INSERT OR REPLACE INTO closed_dates (date, reason) VALUES (?, ?)').run(date, reason || null);
export const removeClosedDate = (date) => db.prepare('DELETE FROM closed_dates WHERE date = ?').run(date);
