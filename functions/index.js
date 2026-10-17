// Cloud Functions for The Neighbor: everything the public site must not be trusted with.
// Prices, free times and bookings are worked out here with the shared rules
// (shared/booking-rules.js, copied in by `npm run sync-shared`), so a visitor cannot alter them.
// Emails are queued in the `mail` collection in the Trigger Email extension's format
// ({ to, message: { subject, text } }); nothing sends them yet (plan, phase 1).
import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import * as R from './shared/booking-rules.js';
import * as P from './photos.js';

// Same region as the data. A low instance cap limits the bill if someone hammers the endpoints.
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });
initializeApp();
const db = getFirestore();

// Where the owner's notifications go. Set OWNER_EMAIL in functions/.env (not committed) or at deploy.
const OWNER_EMAIL = defineString('OWNER_EMAIL', { default: 'owner@example.com' });

// ---- Input cleaning: keep known fields only, as trimmed strings of bounded length ----
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && R.service(x)))].slice(0, 10) : []);

function bookingInput(raw = {}) {
  return {
    serviceIds: ids(raw.serviceIds),
    date: str(raw.date, 10),
    arrival: str(raw.arrival, 5),
    bike: str(raw.bike, 100),
    bikeId: str(raw.bikeId, 64) || null,
    address: str(raw.address, 200),
    name: str(raw.name, 100),
    email: str(raw.email, 200).toLowerCase(),
    phone: str(raw.phone, 40),
    note: str(raw.note, 2000),
    // Photos the visitor uploaded to uploads/{uid}/: { id, w, h }. One more than allowed is kept,
    // so checkBooking can say "too many" instead of silently dropping one.
    photos: (Array.isArray(raw.photos) ? raw.photos : []).slice(0, R.CONFIG.maxBookingPhotos + 1).map((p) => ({
      id: str(p?.id, 40),
      w: Math.min(Math.max(Math.round(Number(p?.w)) || 0, 0), 4000),
      h: Math.min(Math.max(Math.round(Number(p?.h)) || 0, 0), 4000),
    })),
  };
}

// ---- Who is asking ----
// A signed-in customer (not an anonymous guest session) gets their own discounts and urgent visit.
const customerUid = (request) => {
  const a = request.auth;
  return a && a.token.firebase?.sign_in_provider !== 'anonymous' ? a.uid : null;
};

// ---- Reads the rules need ----
const notCancelled = (d) => d.status !== 'cancelled';

async function dayBookings(date, tx) {
  const q = db.collection('bookings').where('date', '==', date);
  const snap = tx ? await tx.get(q) : await q.get();
  return snap.docs.map((d) => d.data()).filter(notCancelled).map((b) => ({ arrival: b.arrival, blockMin: b.blockMin }));
}

async function closedDates(dates) {
  const snaps = await db.getAll(...dates.map((d) => db.doc(`closedDates/${d}`)));
  return snaps.filter((s) => s.exists).map((s) => s.id);
}

async function customerContext(uid) {
  if (!uid) return { carePlus: false, urgentDates: [] };
  const [subs, bookings] = await Promise.all([
    db.collection('subscriptions').where('customerUid', '==', uid).get(),
    db.collection('bookings').where('customerUid', '==', uid).get(),
  ]);
  const carePlus = subs.docs.some((d) => d.get('planOrService') === 'premium-monthly' && notCancelled(d.data()));
  const urgentDates = bookings.docs.map((d) => d.data()).filter((b) => b.urgent && notCancelled(b)).map((b) => b.date);
  return { carePlus, urgentDates };
}

// Travel distance. Stand-in until the Google Maps Routes API is connected (plan, decision 2).
const distanceKm = async (address) => R.estimateKm(address);

const queueMail = (batchOrTx, to, subject, text) =>
  batchOrTx.set(db.collection('mail').doc(), { to, message: { subject, text }, createdAt: FieldValue.serverTimestamp() });

// ---- bookingOptions: what the booking form may offer ----
// Returns today's date, the earliest bookable date for this visitor, and, for `date`, whether it is
// closed and which start times are free. Never reveals who booked a time.
export const bookingOptions = onCall(async (request) => {
  const uid = customerUid(request);
  const todayDate = R.today();
  const tomorrow = R.addDays(todayDate, R.CONFIG.urgentLeadDays);
  const date = R.isDate(request.data?.date) ? request.data.date : null;
  const q = R.quote(ids(request.data?.serviceIds));
  const [ctx, closed] = await Promise.all([customerContext(uid), closedDates(date ? [tomorrow, date] : [tomorrow])]);
  const out = { today: todayDate, earliest: R.earliestDate({ todayDate, ...ctx, closedDates: closed }), carePlus: ctx.carePlus };
  if (date) {
    const closedReason = R.closedReason(date, closed);
    out.date = date;
    out.closed = closedReason;
    out.times = closedReason || q.tooLong ? [] : R.startTimes(q.workMin, await dayBookings(date));
  }
  return out;
});

// ---- quoteBooking: the full price, travel included, before the customer confirms ----
export const quoteBooking = onCall(async (request) => {
  const uid = customerUid(request);
  const { carePlus } = await customerContext(uid);
  const q = R.quote(ids(request.data?.serviceIds), { distanceKm: await distanceKm(str(request.data?.address)), carePlus });
  return { ...q, services: q.services.map(({ id, name, da, price, monthly }) => ({ id, name, da, price, monthly })) };
});

// ---- createBooking ----
// Re-checks everything, then writes the booking inside a transaction that re-reads the day's
// bookings, so two customers cannot both get the same time. Returns { errors } or { booking }.
export const createBooking = onCall(async (request) => {
  const input = bookingInput(request.data?.input);
  const accept = request.data?.accept;
  const uid = customerUid(request);
  const todayDate = R.today();
  const [ctx, closed, km] = await Promise.all([
    customerContext(uid),
    R.isDate(input.date) ? closedDates([input.date]) : [],
    distanceKm(input.address),
  ]);
  const q = R.quote(input.serviceIds, { distanceKm: km, carePlus: ctx.carePlus });
  const base = { todayDate, closedDates: closed, ...ctx };

  // Cheap checks first, outside the transaction.
  const errors = R.checkBooking(input, q, { ...base, dayBookings: [] });
  // The terms and the early start of work, both ticked on the price page.
  const notAccepted = R.checkAcceptance(accept);
  if (notAccepted) errors.accept = notAccepted;
  delete errors.arrival; // needs the day's bookings: checked in the transaction
  if (Object.keys(errors).length) return { errors };

  // Photos: they must be in the caller's own upload folder (an anonymous guest session counts), as
  // small JPEGs. They are copied into the booking's folder before the booking is written, so a
  // booking never points at files that are not there.
  const uploader = request.auth?.uid || null;
  const b = input.photos.length ? P.bucket() : null;
  if (input.photos.length) {
    const wellFormed = uploader && input.photos.every((p) => P.PHOTO_ID.test(p.id));
    if (!wellFormed || !(await P.uploadsReady(b, uploader, input.photos))) return { errors: { photos: 'photos' } };
  }
  const ref = db.collection('bookings').doc();
  const photos = b ? await P.copyToBooking(b, uploader, input.photos, ref.id) : [];
  const removeCopies = () => (b ? P.deleteFiles(b, photos.flatMap((p) => [p.path, p.thumbPath])) : null);

  const guestToken = randomBytes(24).toString('hex');
  let result;
  try {
    result = await runBookingTransaction();
  } catch (e) {
    await removeCopies();
    throw e;
  }
  if (result.errors) {
    await removeCopies();
  } else if (b) {
    // The booking has its copies; the originals go now (the scheduled clean-up would catch them too).
    await P.deleteUploads(b, uploader, input.photos).catch((e) => logger.warn('could not delete uploads', e));
  }
  return result;

  function runBookingTransaction() { return db.runTransaction(async (tx) => {
    // All reads before any write, as Firestore transactions require.
    const day = await dayBookings(input.date, tx);
    const slotErrors = R.checkBooking(input, q, { ...base, dayBookings: day });
    if (slotErrors.arrival) return { errors: { arrival: slotErrors.arrival } };
    const counterRef = db.doc('counters/bookings');
    const counter = await tx.get(counterRef);
    const monthly = q.services.filter((s) => s.monthly);
    const existingSubs = monthly.length
      ? (await tx.get(db.collection('subscriptions').where('email', '==', input.email))).docs.map((d) => d.data()).filter(notCancelled)
      : [];

    const number = (counter.exists ? counter.get('last') : 1040) + 1;
    tx.set(counterRef, { last: number });
    const booking = {
      ref: `TN-${number}`,
      status: 'pending',
      customerUid: uid,
      guestToken,
      services: q.services.map(({ id, name, price, monthly: m }) => ({ id, name, price, monthly: m })),
      date: input.date,
      arrival: input.arrival,
      workMin: q.workMin,
      blockMin: q.blockMin,
      urgent: R.isUrgentDate(input.date, todayDate),
      bikeType: input.bike,
      bikeId: null, // linking a saved bike comes with accounts (phase 3)
      address: input.address,
      distanceKm: q.distanceKm,
      name: input.name,
      email: input.email,
      phone: input.phone,
      note: input.note,
      photos,
      pricing: { oneOff: q.oneOff, discount: q.discount, discountReason: q.discountReason, monthly: q.monthly, travel: q.travel, total: q.total },
      // Proof of what the customer accepted, and when; the version is the server's, not the browser's.
      accepted: { terms: true, earlyStart: true, termsVersion: R.CONFIG.termsVersion, at: FieldValue.serverTimestamp() },
      createdAt: FieldValue.serverTimestamp(),
    };
    tx.set(ref, booking);
    // Start a Care subscription unless this customer already has that plan (then this booking is
    // simply their monthly visit). Minimum 3 months, then cancellable at any time.
    for (const s of monthly) {
      if (existingSubs.some((x) => x.planOrService === s.id)) continue;
      tx.set(db.collection('subscriptions').doc(), {
        customerUid: uid, email: input.email, planOrService: s.id, price: s.price, status: 'pending',
        startDate: input.date, commitmentEnds: R.commitmentEnds(input.date), bookingId: ref.id, createdAt: FieldValue.serverTimestamp(),
      });
    }
    const lines = q.services.map((s) => `- ${s.name}`).join('\n');
    queueMail(tx, input.email, `Booking received ${booking.ref}`,
      `Hi ${input.name},\n\nThanks for booking with The Neighbor. We have received:\n${lines}\n\n${input.date} at ${input.arrival}\n${input.address}\n\nTotal: ${q.total} DKK\n\nWe will confirm your booking shortly.`);
    queueMail(tx, OWNER_EMAIL.value(), `${booking.urgent ? 'URGENT ' : ''}New booking ${booking.ref}`,
      `${input.name} (${input.phone}, ${input.email}) booked ${q.services.map((s) => s.name).join(', ')} on ${input.date} at ${input.arrival}.\n${input.address}\n\nNote: ${input.note || '–'}`);
    return { booking: { id: ref.id, ref: booking.ref, date: booking.date, arrival: booking.arrival, urgent: booking.urgent, email: booking.email, pricing: booking.pricing, photos: photos.length, guestToken } };
  }); }
});

// ---- cleanUploads: delete photos uploaded more than 24 hours ago that never became a booking ----
export const cleanUploads = onSchedule({ schedule: 'every 6 hours', timeZone: R.TIME_ZONE }, async () => {
  const n = await P.deleteStaleUploads(P.bucket());
  logger.info(`cleanUploads: deleted ${n} stale upload(s)`);
});

// ---- createConsultation: a business asks for a consultation ----
export const createConsultation = onCall(async (request) => {
  const raw = request.data?.input || {};
  const input = {
    name: str(raw.name, 100), company: str(raw.company, 150), email: str(raw.email, 200).toLowerCase(),
    phone: str(raw.phone, 40), companyType: str(raw.companyType, 60), bikes: str(raw.bikes, 20),
    preferredDate: R.isDate(raw.preferredDate) ? raw.preferredDate : '', preferredTime: R.isTime(raw.preferredTime) ? raw.preferredTime : '',
    message: str(raw.message, 2000),
  };
  const error = R.checkConsultation(input);
  if (error) return { error };
  const batch = db.batch();
  const ref = db.collection('consultations').doc();
  batch.set(ref, { ...input, status: 'new', createdAt: FieldValue.serverTimestamp() });
  queueMail(batch, input.email, 'We have received your consultation request',
    `Hi ${input.name},\n\nThanks for your interest. We will contact you shortly to arrange a consultation for ${input.company}.`);
  queueMail(batch, OWNER_EMAIL.value(), `New consultation request: ${input.company}`,
    `${input.name} (${input.phone}, ${input.email})\n${input.companyType}, ${input.bikes} bikes\nPreferred: ${input.preferredDate || '–'} ${input.preferredTime}\n\n${input.message}`);
  await batch.commit();
  return { lead: { id: ref.id } };
});
