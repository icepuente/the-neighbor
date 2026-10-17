// Calls the Cloud Functions on the emulators the way the site will. Run with `npm run test:functions`,
// which starts a fresh, empty set of emulators for the run and stops them afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../shared/booking-rules.js';

const P = 'my-first-firebase-projec-b242f';
const FN = `http://127.0.0.1:5001/${P}/europe-west1`;
const FS = `http://127.0.0.1:8085/v1/projects/${P}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const OWNER = { Authorization: 'Bearer owner' }; // emulator-only admin access, bypasses the rules

async function call(name, data, idToken) {
  const res = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${name}: ${body.error.status} ${body.error.message}`);
  return body.result;
}

// ---- Firestore emulator REST helpers ----
const toValue = (v) => {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (v === null) return { nullValue: null };
  throw new Error(`unsupported ${typeof v}`);
};
const fromValue = (v) => {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return undefined;
};
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));

async function put(path, data) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]));
  const res = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: { ...OWNER, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  assert.equal(res.status, 200, `writing ${path}`);
}
async function list(collection) {
  const body = await (await fetch(`${FS}/${collection}?pageSize=300`, { headers: OWNER })).json();
  return (body.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...fromFields(d.fields || {}) }));
}
async function signUp(email) {
  const body = email ? { email, password: 'secret-password', returnSecureToken: true } : { returnSecureToken: true };
  const r = await (await fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  return { uid: r.localId, token: r.idToken };
}

// ---- Dates relative to the real today (the Functions use the real clock) ----
const TODAY = R.today();
const TOMORROW = R.addDays(TODAY, 1);
const D1 = R.nextOpenDay(R.addDays(TODAY, 3)); // well outside the lead time
const D2 = R.nextOpenDay(R.addDays(D1, 1));
const SUNDAY = (() => { let d = TODAY; while (R.weekday(d) !== 0) d = R.addDays(d, 1); return d; })();
const CPH = 'Jagtvej 1, 2200 København N'; // 5 km: 13 kr. travel
const ACCEPT = { terms: true, earlyStart: true };
const input = (over = {}) => ({ serviceIds: ['chain'], date: D1, arrival: '10:00', bike: 'City bike', address: CPH, name: 'Test Person', email: 'guest@example.com', phone: '12345678', note: '', ...over });

test('bookingOptions: today, earliest date and free times, without revealing bookings', async () => {
  const o = await call('bookingOptions', { date: D1, serviceIds: ['chain'] });
  assert.equal(o.today, TODAY);
  assert.equal(o.earliest, R.addDays(TODAY, 2), 'a guest books 2 days ahead');
  assert.equal(o.closed, null);
  assert.equal(o.times.length, R.startTimes(15).length);
  assert.ok(o.times.every((t) => t.free));
  assert.deepEqual(Object.keys(o.times[0]).sort(), ['free', 'time'], 'only the time and whether it is free');
  const sun = await call('bookingOptions', { date: SUNDAY, serviceIds: ['chain'] });
  assert.deepEqual([sun.closed, sun.times], ['sunday', []]);
  await put(`closedDates/${D2}`, { reason: 'Holiday' });
  assert.equal((await call('bookingOptions', { date: D2 })).closed, 'closed', 'a day blocked by the owner');
});

test('quoteBooking: full price with travel and the combo discount', async () => {
  const q = await call('quoteBooking', { serviceIds: ['bike-check', 'chain'], address: CPH });
  assert.deepEqual([q.oneOff, q.discount, q.discountReason, q.travel, q.total], [348, 17, 'combo', 13, 344]);
  assert.equal((await call('quoteBooking', { serviceIds: ['chain', 'made-up'], address: CPH })).services.length, 1, 'unknown services are ignored');
});

test('createBooking: refuses incomplete or impossible bookings', async () => {
  const errs = async (over, accept = ACCEPT) => (await call('createBooking', { input: input(over), accept })).errors || {};
  assert.equal((await errs({}, null)).accept, 'terms', 'the terms must be accepted');
  assert.equal((await errs({}, { terms: true })).accept, 'earlyStart', 'and the early start of work asked for');
  assert.equal((await errs({ serviceIds: ['bike-check', 'puncture', 'gears'] })).services, 'tooLong');
  assert.equal((await errs({ address: 'Somewhere, 4000 Roskilde' })).form, 'far');
  assert.equal((await errs({ serviceIds: ['diagnostics'] })).note, 'note');
  assert.ok(['lead', 'sunday'].includes((await errs({ date: TODAY })).date), 'booking for today is refused');
  assert.equal((await errs({ date: SUNDAY })).date, 'sunday');
  assert.equal((await errs({ arrival: '15:15' })).arrival, 'arrival', 'not a start time');
  assert.equal((await list('bookings')).length, 0, 'nothing was saved');
});

test('createBooking: saves the booking, numbers it, queues both emails', async () => {
  const r = await call('createBooking', { input: input({ serviceIds: ['bike-check', 'chain'], note: 'x'.repeat(5000) }), accept: ACCEPT });
  assert.ok(r.booking, JSON.stringify(r.errors));
  assert.equal(r.booking.ref, 'TN-1041');
  assert.equal(r.booking.pricing.total, 344);
  assert.equal(r.booking.urgent, false);
  const [b] = await list('bookings');
  assert.deepEqual([b.status, b.customerUid, b.workMin, b.blockMin, b.arrival], ['pending', null, 40, 55, '10:00']);
  assert.equal(b.note.length, 2000, 'long notes are cut to 2000 characters');
  assert.deepEqual([b.accepted.terms, b.accepted.earlyStart, b.accepted.termsVersion], [true, true, R.CONFIG.termsVersion], 'what was accepted is recorded');
  assert.ok(b.accepted.at, 'with the time');
  assert.equal(b.guestToken.length, 48);
  const mail = await list('mail');
  assert.equal(mail.length, 2);
  assert.ok(mail.some((m) => m.to === 'guest@example.com' && m.message.subject === 'Booking received TN-1041'));
  assert.ok(mail.some((m) => m.to === 'owner@example.com' && m.message.subject === 'New booking TN-1041'));
});

test('createBooking: a taken time is refused, and shows as taken', async () => {
  const again = await call('createBooking', { input: input({ email: 'other@example.com' }), accept: ACCEPT });
  assert.equal(again.errors?.arrival, 'taken');
  const o = await call('bookingOptions', { date: D1, serviceIds: ['chain'] });
  const free = (t) => o.times.find((x) => x.time === t).free;
  assert.deepEqual([free('09:30'), free('10:00'), free('10:30'), free('11:00')], [true, false, false, true],
    '10:00 + 40 min + 15 min travel blocks until 10:55; a 15-min job at 09:30 ends (with travel) right at 10:00');
});

test('createBooking: two customers grabbing the same time at once, only one gets it', async () => {
  const both = await Promise.all(['a@example.com', 'b@example.com'].map((email) =>
    call('createBooking', { input: input({ arrival: '13:00', email }), accept: ACCEPT })));
  assert.equal(both.filter((r) => r.booking).length, 1);
  assert.equal(both.filter((r) => r.errors?.arrival === 'taken').length, 1);
});

test('Care plans: the first booking starts a subscription, the next does not start another', async () => {
  const first = await call('createBooking', { input: input({ serviceIds: ['premium-monthly', 'chain'], arrival: '08:30', email: 'care@example.com' }), accept: ACCEPT });
  assert.ok(first.booking, JSON.stringify(first.errors));
  assert.equal(first.booking.pricing.discountReason, 'carePlus');
  const again = await call('createBooking', { input: input({ serviceIds: ['premium-monthly'], date: R.nextOpenDay(R.addDays(D1, 7)), email: 'care@example.com' }), accept: ACCEPT });
  assert.ok(again.booking);
  const subs = (await list('subscriptions')).filter((s) => s.email === 'care@example.com');
  assert.equal(subs.length, 1);
  assert.deepEqual([subs[0].planOrService, subs[0].status, subs[0].startDate, subs[0].commitmentEnds], ['premium-monthly', 'pending', D1, R.commitmentEnds(D1)]);
});

test('a signed-in Care Plus member gets the discount and the urgent visit; anonymous guests do not', async () => {
  const member = await signUp('anna@example.com');
  await put('subscriptions/s-anna', { customerUid: member.uid, email: 'anna@example.com', planOrService: 'premium-monthly', status: 'active' });
  const q = await call('quoteBooking', { serviceIds: ['chain'], address: CPH }, member.token);
  assert.deepEqual([q.discountReason, q.discount], ['carePlus', 7]);
  const o = await call('bookingOptions', {}, member.token);
  assert.equal(o.carePlus, true);
  // Tomorrow is the urgent visit, unless tomorrow is closed (a Sunday or a blocked day).
  assert.equal(o.earliest, R.earliestDate({ todayDate: TODAY, carePlus: true, closedDates: [] }));
  if (!R.closedReason(TOMORROW)) {
    const urgent = await call('createBooking', { input: input({ date: TOMORROW, email: 'anna@example.com' }), accept: ACCEPT }, member.token);
    assert.equal(urgent.booking?.urgent, true);
    assert.ok((await list('mail')).some((m) => m.message.subject.startsWith('URGENT New booking')));
  }
  const anon = await signUp();
  assert.equal((await call('quoteBooking', { serviceIds: ['chain'], address: CPH }, anon.token)).discountReason, null);
  const r = await call('createBooking', { input: input({ arrival: '14:00', email: 'anon@example.com' }), accept: ACCEPT }, anon.token);
  assert.equal((await list('bookings')).find((b) => b.id === r.booking.id).customerUid, null, 'an anonymous session is a guest');
  const mine = await call('createBooking', { input: input({ arrival: '14:30', email: 'anna@example.com' }), accept: ACCEPT }, member.token);
  assert.equal((await list('bookings')).find((b) => b.id === mine.booking.id).customerUid, member.uid, 'a signed-in customer owns the booking');
});

test('addressSearch: Danish address suggestions from the address register', async () => {
  assert.deepEqual((await call('addressSearch', { q: 'J' })).suggestions, [], 'one letter is too short to search');
  const r = await call('addressSearch', { q: 'Jagtvej 1' });
  assert.ok(r.suggestions.length > 0 && r.suggestions.length <= 6, `up to 6 suggestions (got ${r.suggestions.length}${r.unavailable ? ', register unreachable' : ''})`);
  assert.ok(r.suggestions.some((s) => s.text === 'Jagtvej 1, 2200 København N'), 'the official address, with postcode and town');
  assert.equal(R.estimateKm(r.suggestions[0].text) !== null, true, 'a suggestion can be priced');
});

test('createBooking: floor and door are stored and written into the emails', async () => {
  const r = await call('createBooking', { input: input({ arrival: '15:00', email: 'flat@example.com', apartment: '2. tv.' }), accept: ACCEPT });
  assert.ok(r.booking, JSON.stringify(r.errors));
  const b = (await list('bookings')).find((x) => x.id === r.booking.id);
  assert.equal(b.apartment, '2. tv.');
  const mail = (await list('mail')).find((m) => m.to === 'flat@example.com');
  assert.ok(mail.message.text.includes('Jagtvej 1, 2. tv., 2200 København N'), 'the address is written the Danish way');
});

test('createConsultation: stores the lead and queues both emails', async () => {
  assert.equal((await call('createConsultation', { input: { name: 'Sofie' } })).error, 'missing');
  const r = await call('createConsultation', { input: { name: 'Sofie Berg', company: 'Hostel Nørrebro', email: 'Sofie@Example.com', phone: '22334455', companyType: 'Hostel', bikes: '16–35', preferredDate: D1, preferredTime: '11:00', message: 'Monthly checks, please.' } });
  assert.ok(r.lead?.id);
  const [lead] = await list('consultations');
  assert.deepEqual([lead.company, lead.email, lead.status], ['Hostel Nørrebro', 'sofie@example.com', 'new']);
  assert.ok((await list('mail')).some((m) => m.message.subject === 'New consultation request: Hostel Nørrebro'));
});
