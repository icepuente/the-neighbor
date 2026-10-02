import { db } from './db.js';
import { site } from './config.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE = "('pending', 'confirmed')";

export function todayStr(tz = site.timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDays(date, n) {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// ISO day of week: 1 = Monday ... 7 = Sunday
export function isoDow(date) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function isValidDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const t = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === date;
}

export function slotByStart(start) {
  return site.slots.find((s) => s.start === start);
}

export function slotLabel(start) {
  const s = slotByStart(start);
  return s ? `${s.start}–${s.end}` : start;
}

export function formatDate(date, style = 'long') {
  const opts =
    style === 'long'
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'short', day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(site.locale, { ...opts, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export function bookingRange() {
  const today = todayStr();
  return {
    today,
    first: addDays(today, site.minLeadDays ?? 1),
    last: addDays(today, site.bookingWindowDays ?? 42),
  };
}

const countsInRange = db.prepare(`
  SELECT date, slot, COUNT(*) AS n FROM bookings
  WHERE status IN ${ACTIVE} AND date BETWEEN ? AND ?
  GROUP BY date, slot
`);
const closedInRange = db.prepare('SELECT date FROM closed_dates WHERE date BETWEEN ? AND ?').pluck();
const countForSlot = db.prepare(`
  SELECT COUNT(*) FROM bookings
  WHERE status IN ${ACTIVE} AND date = ? AND slot = ? AND id != ?
`).pluck();
const isClosed = db.prepare('SELECT 1 FROM closed_dates WHERE date = ?').pluck();

export function getAvailability() {
  const { first, last } = bookingRange();
  const counts = new Map(countsInRange.all(first, last).map((r) => [`${r.date} ${r.slot}`, r.n]));
  const closed = new Set(closedInRange.all(first, last));
  const capacity = site.slotCapacity ?? 1;

  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const open = site.openDays.includes(isoDow(d)) && !closed.has(d);
    const slots = site.slots.map((s) => ({
      start: s.start,
      label: `${s.start}–${s.end}`,
      available: open && (counts.get(`${d} ${s.start}`) || 0) < capacity,
    }));
    days.push({ date: d, open, available: slots.some((s) => s.available), slots });
  }
  return { first, last, days };
}

// Checks whether a booking can occupy date + slot. Customers are held to the
// booking window and opening days; the admin can override with enforceWindow=false.
export function checkSlot(date, start, { excludeId = 0, enforceWindow = true } = {}) {
  if (!isValidDate(date)) return { ok: false, code: 'invalid_date', error: 'Please choose a valid date.' };
  if (!slotByStart(start)) return { ok: false, code: 'invalid_slot', error: 'Please choose a time slot.' };

  if (enforceWindow) {
    const { first, last } = bookingRange();
    if (date < first || date > last) {
      return { ok: false, code: 'out_of_range', error: 'That date is outside the booking window.' };
    }
    if (!site.openDays.includes(isoDow(date))) {
      return { ok: false, code: 'closed', error: "Sorry, we're not working that day." };
    }
  }
  if (isClosed.get(date)) {
    return { ok: false, code: 'closed', error: "Sorry, we're not working that day." };
  }
  if (countForSlot.get(date, start, excludeId) >= (site.slotCapacity ?? 1)) {
    return { ok: false, code: 'slot_full', error: 'Sorry, that time slot was just taken. Please pick another.' };
  }
  return { ok: true };
}

// Converts a wall-clock time in `tz` to a UTC Date (DST-aware).
export function zonedTimeToUtc(date, time, tz = site.timezone) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

function tzOffsetMs(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
