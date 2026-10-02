import { Router } from 'express';
import { site, formatPrice } from '../config.js';
import { formatDate, slotLabel, isValidDate, slotByStart } from '../schedule.js';
import {
  STATUSES, getBooking, listBookings, getStats, getMessages, markRead, setStatus, reschedule,
  setAdminNotes, allBookings, listClosedDates, addClosedDate, removeClosedDate,
} from '../bookings.js';
import { onStatusChanged, onRescheduled, sendCustomMessage } from '../notify.js';
import { fillTemplate } from '../emails.js';
import { mailEnabled } from '../mailer.js';
import { rateLimit, str, checkPassword, startSession, endSession, isAdmin, requireAdmin } from '../http.js';

export const adminRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Try again in 15 minutes.' });

adminRouter.post('/login', loginLimiter, (req, res) => {
  if (!checkPassword(str(req.body?.password, 200))) return res.status(401).json({ error: 'Wrong password.' });
  startSession(res);
  res.json({ ok: true });
});

adminRouter.post('/logout', (req, res) => {
  endSession(res);
  res.json({ ok: true });
});

adminRouter.get('/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please log in.' });
  res.json({
    businessName: site.businessName,
    mailEnabled,
    statuses: STATUSES,
    slots: site.slots.map((s) => ({ start: s.start, label: `${s.start}–${s.end}` })),
  });
});

adminRouter.use(requireAdmin);
adminRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const decorate = (b) => ({ ...b, date_label: formatDate(b.date, 'short'), slot_label: slotLabel(b.slot) });

adminRouter.get('/bookings', (req, res) => {
  res.json({
    stats: getStats(),
    bookings: listBookings({ view: str(req.query.view, 20), q: str(req.query.q, 100) }).map(decorate),
  });
});

function loadBooking(req, res, next) {
  const b = getBooking(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  req.booking = b;
  next();
}

function detail(b) {
  return {
    booking: {
      ...decorate(b),
      date_long: formatDate(b.date),
      price_label: b.service_price != null ? formatPrice(b.service_price) : null,
    },
    messages: getMessages(b.id),
    templates: (site.messageTemplates || []).map((t) => ({
      label: t.label,
      subject: fillTemplate(t.subject, b),
      body: fillTemplate(t.body, b),
    })),
  };
}

adminRouter.get('/bookings/:id', loadBooking, (req, res) => {
  markRead(req.booking.id);
  res.json(detail(req.booking));
});

adminRouter.post('/bookings/:id/status', loadBooking, async (req, res) => {
  const status = str(req.body?.status, 20);
  if (!STATUSES.includes(status)) return res.status(422).json({ error: 'Unknown status.' });
  const reason = str(req.body?.reason, 500) || null;
  const b = setStatus(req.booking.id, status, reason);
  const email = req.body?.notify ? await onStatusChanged(b, { reason }) : null;
  res.json({ ...detail(b), email });
});

adminRouter.post('/bookings/:id/reschedule', loadBooking, async (req, res) => {
  const date = str(req.body?.date, 10);
  const slot = str(req.body?.slot, 5);
  if (!isValidDate(date) || !slotByStart(slot)) return res.status(422).json({ error: 'Pick a valid date and slot.' });
  const result = reschedule(req.booking.id, date, slot, !!req.body?.force);
  if (!result.ok) return res.status(409).json({ error: result.error, code: result.code });
  const email = req.body?.notify ? await onRescheduled(result.booking) : null;
  res.json({ ...detail(result.booking), email });
});

adminRouter.post('/bookings/:id/notes', loadBooking, (req, res) => {
  setAdminNotes(req.booking.id, str(req.body?.notes, 5000) || null);
  res.json(detail(getBooking(req.booking.id)));
});

adminRouter.post('/bookings/:id/messages', loadBooking, async (req, res) => {
  const subject = str(req.body?.subject, 150) || `Message about your booking`;
  const body = str(req.body?.body, 5000);
  if (body.length < 2) return res.status(422).json({ error: 'Write a message first.' });
  const email = await sendCustomMessage(req.booking, subject, body);
  res.status(email.ok ? 201 : 502).json({ ...detail(req.booking), email });
});

adminRouter.get('/closed-dates', (req, res) => res.json(listClosedDates()));

adminRouter.post('/closed-dates', (req, res) => {
  const date = str(req.body?.date, 10);
  if (!isValidDate(date)) return res.status(422).json({ error: 'Pick a valid date.' });
  addClosedDate(date, str(req.body?.reason, 200));
  res.status(201).json(listClosedDates());
});

adminRouter.delete('/closed-dates/:date', (req, res) => {
  removeClosedDate(String(req.params.date));
  res.json(listClosedDates());
});

const CSV_COLUMNS = [
  'ref', 'status', 'date', 'slot', 'service_name', 'service_price', 'name', 'email', 'phone',
  'address', 'postcode', 'city', 'bike_type', 'bike_brand', 'bike_model', 'problem',
  'access_notes', 'admin_notes', 'cancel_reason', 'created_at',
];

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

adminRouter.get('/export.csv', (req, res) => {
  const rows = [CSV_COLUMNS.join(','), ...allBookings().map((b) => CSV_COLUMNS.map((c) => csvCell(b[c])).join(','))];
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="bookings-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + rows.join('\r\n'));
});
