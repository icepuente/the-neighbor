import { Router } from 'express';
import { site, publicConfig, serviceById, formatPrice } from '../config.js';
import { getAvailability, formatDate, slotLabel, todayStr } from '../schedule.js';
import { createBooking, getBookingByToken, getMessages, addMessage, setStatus } from '../bookings.js';
import { onBookingCreated, onCustomerMessage, onCustomerCancelled } from '../notify.js';
import { rateLimit, clientIp, str, EMAIL_RE, PHONE_RE } from '../http.js';

export const publicRouter = Router();

const bookingLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const messageLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });

publicRouter.get('/config', (req, res) => res.json(publicConfig()));

publicRouter.get('/availability', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(getAvailability());
});

function validateBooking(body) {
  const fields = {};
  const service = serviceById(str(body.serviceId, 50));
  if (!service) fields.serviceId = 'Please choose a service.';

  const data = {
    bike_type: str(body.bikeType, 50),
    bike_brand: str(body.bikeBrand, 60),
    bike_model: str(body.bikeModel, 60),
    problem: str(body.problem, 2000),
    date: str(body.date, 10),
    slot: str(body.slot, 5),
    name: str(body.name, 100),
    email: str(body.email, 200).toLowerCase(),
    phone: str(body.phone, 30),
    address: str(body.address, 200),
    postcode: str(body.postcode, 12),
    city: str(body.city, 80),
    access_notes: str(body.accessNotes, 1000),
  };

  if (!site.bikeTypes.includes(data.bike_type)) fields.bikeType = 'Please choose your type of bike.';
  if (!data.date) fields.date = 'Please pick a day.';
  else if (!data.slot) fields.slot = 'Please pick a time slot.';
  if (data.name.length < 2) fields.name = 'Please enter your name.';
  if (!EMAIL_RE.test(data.email)) fields.email = 'Please enter a valid email address.';
  if (!PHONE_RE.test(data.phone)) fields.phone = 'Please enter a valid phone number.';
  if (data.address.length < 3) fields.address = 'Please enter the street address.';
  if (site.postcodePattern ? !new RegExp(site.postcodePattern).test(data.postcode) : !data.postcode) {
    fields.postcode = `Please enter a valid ${site.postcodeHint || 'postcode'}.`;
  }
  if (body.consent !== true) fields.consent = 'Please agree so we can store your details for this booking.';

  if (service) Object.assign(data, { service_id: service.id, service_name: service.name, service_price: service.price ?? null });
  return { fields, data };
}

publicRouter.post('/bookings', bookingLimiter, (req, res) => {
  const body = req.body || {};

  // Spam traps: a hidden field humans leave empty, and a minimum time-on-form.
  if (str(body.website) || Number(body.elapsedMs) < 3000) {
    return res.status(400).json({ error: 'Something went wrong. Please try again in a moment.' });
  }

  const { fields, data } = validateBooking(body);
  if (Object.keys(fields).length) {
    return res.status(422).json({ error: 'Please check the highlighted fields.', fields });
  }

  const result = createBooking({ ...data, ip: clientIp(req) });
  if (!result.ok) {
    return res.status(409).json({ error: result.error, code: result.code, fields: { slot: result.error } });
  }

  const b = result.booking;
  onBookingCreated(b);
  res.status(201).json({ ref: b.ref, token: b.token, status: b.status, url: `/b/${b.token}` });
});

function canCancel(b) {
  return ['pending', 'confirmed'].includes(b.status) && b.date >= todayStr();
}

function publicBooking(b) {
  return {
    ref: b.ref,
    status: b.status,
    serviceName: b.service_name,
    servicePrice: b.service_price != null ? formatPrice(b.service_price) : null,
    date: b.date,
    dateLabel: formatDate(b.date),
    slotLabel: slotLabel(b.slot),
    name: b.name,
    email: b.email,
    phone: b.phone,
    address: b.address,
    postcode: b.postcode,
    city: b.city,
    bikeType: b.bike_type,
    bikeBrand: b.bike_brand,
    bikeModel: b.bike_model,
    problem: b.problem,
    accessNotes: b.access_notes,
    cancelReason: b.cancel_reason,
    createdAt: b.created_at,
    canCancel: canCancel(b),
    messages: getMessages(b.id)
      .filter((m) => m.kind === 'manual')
      .map((m) => ({ direction: m.direction, subject: m.subject, body: m.body, createdAt: m.created_at })),
  };
}

function loadByToken(req, res, next) {
  const b = getBookingByToken(String(req.params.token));
  if (!b) return res.status(404).json({ error: "We couldn't find that booking. Check the link in your email." });
  req.booking = b;
  next();
}

publicRouter.get('/bookings/:token', loadByToken, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicBooking(req.booking));
});

publicRouter.post('/bookings/:token/messages', messageLimiter, loadByToken, (req, res) => {
  const body = str(req.body?.body, 2000);
  if (body.length < 2) return res.status(422).json({ error: 'Please write a message.' });
  addMessage({ booking_id: req.booking.id, direction: 'in', body });
  onCustomerMessage(req.booking, body);
  res.status(201).json(publicBooking(req.booking));
});

publicRouter.post('/bookings/:token/cancel', messageLimiter, loadByToken, (req, res) => {
  if (!canCancel(req.booking)) return res.status(409).json({ error: 'This booking can no longer be cancelled online.' });
  const reason = str(req.body?.reason, 500) || null;
  const b = setStatus(req.booking.id, 'cancelled', reason);
  onCustomerCancelled(b, reason);
  res.json(publicBooking(b));
});
