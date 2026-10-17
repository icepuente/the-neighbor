// The owner's access (firestore.rules, storage.rules) and the status emails (bookingStatusChanged),
// on the emulators. Run with `npm run test:functions`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../shared/booking-rules.js';

const P = 'my-first-firebase-projec-b242f';
const FS = `http://127.0.0.1:8085/v1/projects/${P}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = `http://127.0.0.1:5001/${P}/europe-west1`;
const ADMIN = { Authorization: 'Bearer owner' }; // emulator-only bypass, to set up test data
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function account(email, claims) {
  const body = { email, password: 'secret-password', returnSecureToken: true };
  const r = await (await fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (claims) {
    await fetch(`${AUTH}/projects/${P}/accounts:update`, { method: 'POST', headers: { ...ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: r.localId, customAttributes: JSON.stringify(claims) }) });
  }
  // Sign in again so the token carries the claims.
  const s = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  return { Authorization: `Bearer ${s.idToken}` };
}
const getDoc = (path, headers) => fetch(`${FS}/${path}`, { headers });
const patch = (path, fields, headers) => fetch(`${FS}/${path}?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`, {
  method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }])) }),
});
const mailFor = async (to) => ((await (await fetch(`${FS}/mail?pageSize=300`, { headers: ADMIN })).json()).documents || [])
  .filter((d) => d.fields.to.stringValue === to).map((d) => d.fields.message.mapValue.fields.subject.stringValue);

// A booking made through the Functions, as a customer would.
async function makeBooking(email, arrival) {
  const input = { serviceIds: ['chain'], date: R.nextOpenDay(R.addDays(R.today(), 30)), arrival, bike: 'City bike', address: 'Jagtvej 1, 2200 København N', apartment: '4. tv.', lang: 'en', name: 'Rule Test', phone: '1', email };
  const res = await (await fetch(`${FN}/createBooking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { input, accept: { terms: true, earlyStart: true } } }) })).json();
  return res.result.booking;
}

test('only the owner reads bookings; other accounts and guests are refused', async () => {
  const b = await makeBooking('rules@example.com', '09:00');
  const owner = await account('owner-rules@example.com', { admin: true });
  const customer = await account('someone@example.com');
  assert.equal((await getDoc(`bookings/${b.id}`, owner)).status, 200, 'the owner');
  assert.equal((await getDoc(`bookings/${b.id}`, customer)).status, 403, 'a signed-in customer');
  assert.equal((await getDoc(`bookings/${b.id}`, {})).status, 403, 'a guest');
  assert.equal((await getDoc('counters/bookings', owner)).status, 403, 'internal counters stay closed, even to the owner');
});

test('the owner may change a booking\'s status, and nothing else', async () => {
  const b = await makeBooking('rules2@example.com', '10:00');
  const owner = await account('owner-rules2@example.com', { admin: true });
  assert.equal((await patch(`bookings/${b.id}`, { status: 'confirmed' }, owner)).status, 200, 'confirm');
  assert.equal((await patch(`bookings/${b.id}`, { status: 'paid' }, owner)).status, 403, 'not an unknown status');
  assert.equal((await patch(`bookings/${b.id}`, { name: 'Someone else' }, owner)).status, 403, 'not the customer\'s details');
  assert.equal((await patch(`bookings/${b.id}`, { status: 'cancelled' }, await account('x@example.com'))).status, 403, 'not as a customer');
});

test('a status change emails the customer', async () => {
  const b = await makeBooking('status-mail@example.com', '11:00');
  const owner = await account('owner-rules3@example.com', { admin: true });
  await patch(`bookings/${b.id}`, { status: 'confirmed' }, owner);
  let subjects = [];
  for (let i = 0; i < 40 && !subjects.some((s) => s.includes('is confirmed')); i++) { await sleep(250); subjects = await mailFor('status-mail@example.com'); }
  assert.ok(subjects.includes(`Your booking ${b.ref} is confirmed`), `confirmation email queued (${subjects.join(' | ')})`);
  await patch(`bookings/${b.id}`, { status: 'cancelled' }, owner);
  for (let i = 0; i < 40 && !subjects.some((s) => s.includes('cancelled')); i++) { await sleep(250); subjects = await mailFor('status-mail@example.com'); }
  assert.ok(subjects.includes(`Your booking ${b.ref} has been cancelled`), 'cancellation email queued');
});

test('closed days: the owner adds and removes them, others cannot', async () => {
  const owner = await account('owner-rules4@example.com', { admin: true });
  const day = R.nextOpenDay(R.addDays(R.today(), 40));
  assert.equal((await patch(`closedDates/${day}`, { reason: 'Holiday' }, owner)).status, 200, 'the owner closes a day');
  assert.equal((await patch('closedDates/not-a-date', { reason: 'x' }, owner)).status, 403, 'only real dates');
  assert.equal((await patch(`closedDates/${R.addDays(day, 1)}`, { reason: 'x' }, await account('y@example.com'))).status, 403, 'not a customer');
  const options = (await (await fetch(`${FN}/bookingOptions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { date: day } }) })).json()).result;
  assert.equal(options.closed, 'closed', 'customers can no longer book it');
  assert.ok(options.closedDates.includes(day), 'and the calendar greys it out');
  assert.equal((await fetch(`${FS}/closedDates/${day}`, { method: 'DELETE', headers: owner })).status, 200, 'the owner opens it again');
});

test('requests: the owner archives and restores them, as true or false only', async () => {
  const lead = await (await fetch(`${FN}/createConsultation`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { input: { name: 'Arkiv Test', company: 'Archive ApS', email: 'archive@example.com', phone: '1', companyType: 'Hotel', bikes: '6–15' } } }) })).json();
  const id = lead.result.lead.id;
  const owner = await account('owner-rules5@example.com', { admin: true });
  const setArchived = (value, headers) => fetch(`${FS}/consultations/${id}?updateMask.fieldPaths=archived`, {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { archived: value } }),
  });
  assert.equal((await setArchived({ booleanValue: true }, owner)).status, 200, 'archive');
  assert.equal((await setArchived({ booleanValue: false }, owner)).status, 200, 'restore');
  assert.equal((await setArchived({ stringValue: 'yes' }, owner)).status, 403, 'only true or false');
  assert.equal((await setArchived({ booleanValue: true }, await account('z@example.com'))).status, 403, 'not a customer');
});

const callAs = async (name, data, headers = {}) => (await fetch(`${FN}/${name}`, {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ data }),
})).json();

test('rescheduleBooking: owner only; free times leave the booking itself out; the customer is emailed', async () => {
  const owner = await account('owner-resched@example.com', { admin: true });
  const a = await makeBooking('resched-a@example.com', '12:00');
  const b = await makeBooking('resched-b@example.com', '13:00');
  const day = R.nextOpenDay(R.addDays(R.today(), 30));
  assert.equal((await callAs('rescheduleBooking', { bookingId: a.id, date: day }, await account('cust@example.com'))).error?.status, 'PERMISSION_DENIED', 'not for customers');
  assert.equal((await callAs('rescheduleBooking', { bookingId: a.id, date: day })).error?.status, 'PERMISSION_DENIED', 'not for guests');
  const times = (await callAs('rescheduleBooking', { bookingId: a.id, date: day }, owner)).result.times;
  const free = (t) => times.find((s) => s.time === t).free;
  assert.equal(free('12:00'), true, 'its own time counts as free');
  assert.equal(free('13:00'), false, "the other booking's time does not");
  assert.equal((await callAs('rescheduleBooking', { bookingId: a.id, date: day, arrival: '13:00' }, owner)).result.error, 'taken', 'a taken time is refused');
  const sunday = (() => { let d = day; while (R.weekday(d) !== 0) d = R.addDays(d, 1); return d; })();
  assert.equal((await callAs('rescheduleBooking', { bookingId: a.id, date: sunday }, owner)).result.error, 'sunday', 'Sundays are closed');
  const later = R.nextOpenDay(R.addDays(day, 1));
  const moved = (await callAs('rescheduleBooking', { bookingId: a.id, date: later, arrival: '09:30' }, owner)).result;
  assert.deepEqual([moved.ok, moved.date, moved.arrival], [true, later, '09:30']);
  const doc = await (await getDoc(`bookings/${a.id}`, ADMIN)).json();
  assert.deepEqual([doc.fields.date.stringValue, doc.fields.arrival.stringValue, doc.fields.previous.mapValue.fields.arrival.stringValue], [later, '09:30', '12:00'], 'moved, with the old time kept');
  assert.ok((await mailFor('resched-a@example.com')).includes(`Your booking ${a.ref} has a new time`), 'the customer is emailed');
  assert.ok(b.id, 'the other booking is untouched');
});

test('messageCustomer: owner only; emailed and kept with the booking', async () => {
  const owner = await account('owner-msg@example.com', { admin: true });
  const b = await makeBooking('msg@example.com', '14:00');
  assert.equal((await callAs('messageCustomer', { bookingId: b.id, text: 'Hi' }, await account('cust2@example.com'))).error?.status, 'PERMISSION_DENIED', 'not for customers');
  assert.equal((await callAs('messageCustomer', { bookingId: b.id, text: '  ' }, owner)).result.error, 'empty');
  assert.equal((await callAs('messageCustomer', { bookingId: b.id, text: 'Could I come at 14:30 instead?' }, owner)).result.ok, true);
  assert.ok((await mailFor('msg@example.com')).includes(`About your booking ${b.ref}`), 'emailed');
  const kept = await (await getDoc(`bookings/${b.id}/messages`, owner)).json();
  assert.equal(kept.documents?.[0]?.fields.text.stringValue, 'Could I come at 14:30 instead?', 'kept with the booking, readable by the owner');
  assert.equal((await getDoc(`bookings/${b.id}/messages`, await account('cust3@example.com'))).status, 403, 'not readable by customers');
});

test('the owner can save a private note on a booking', async () => {
  const owner = await account('owner-note@example.com', { admin: true });
  const b = await makeBooking('note@example.com', '15:00');
  assert.equal((await patch(`bookings/${b.id}`, { ownerNote: 'Gate code 1234' }, owner)).status, 200);
  assert.equal((await patch(`bookings/${b.id}`, { ownerNote: 'x' }, await account('cust4@example.com'))).status, 403, 'not customers');
});

test('logVisit: owner only; saves the record and a recommendation, completes the booking, one email', async () => {
  const owner = await account('owner-visit@example.com', { admin: true });
  const b = await makeBooking('visit@example.com', '08:30');
  const rid = 'visitrecord000000001';
  const payload = { bookingId: b.id, recordId: rid, work: ['Brakes adjusted', ''], parts: [{ name: 'Brake pads', price: '89' }], notes: 'All good.',
    recommendation: { title: 'Replace chain', urgency: 'soon', reason: 'Stretched 0.6%', dueBy: 'Next visit' } };
  assert.equal((await callAs('logVisit', payload, await account('cust-visit@example.com'))).error?.status, 'PERMISSION_DENIED', 'not for customers');
  assert.equal((await callAs('logVisit', { ...payload, work: [] }, owner)).result.error, 'work', 'work done is required');
  assert.equal((await callAs('logVisit', { ...payload, photos: [{ id: 'ppppppppppppppppppp1', w: 1, h: 1 }] }, owner)).result.error, 'photos', 'photos must have been uploaded');
  const r = (await callAs('logVisit', payload, owner)).result;
  assert.deepEqual([r.ok, r.recordId], [true, rid]);
  const rec = await (await getDoc(`serviceRecords/${rid}`, owner)).json();
  assert.deepEqual([rec.fields.work.arrayValue.values.length, rec.fields.cost.mapValue.fields.total.integerValue], [1, String(149 + 89 + 13)], 'one line of work; services + parts + travel');
  const booking = await (await getDoc(`bookings/${b.id}`, owner)).json();
  assert.deepEqual([booking.fields.status.stringValue, booking.fields.visitLogged.booleanValue], ['completed', true], 'the booking is completed');
  assert.equal((await callAs('logVisit', payload, owner)).result.error, 'status', 'a visit is logged once');
  await sleep(1500);
  const subjects = await mailFor('visit@example.com');
  assert.ok(subjects.includes(`Your bike service is done (${b.ref})`), 'the customer gets the service summary');
  assert.ok(!subjects.some((s) => s.includes('is complete')), 'and not the plain "complete" email as well');
  const recs = await (await fetch(`${FS}:runQuery`, { method: 'POST', headers: { ...owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'recommendations' }] } }) })).json();
  assert.ok(recs.some((x) => x.document?.fields.title.stringValue === 'Replace chain'), 'the recommendation is saved');
});
