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
  const input = { serviceIds: ['chain'], date: R.nextOpenDay(R.addDays(R.today(), 30)), arrival, bike: 'City bike', address: 'Jagtvej 1, 2200 København N', apartment: '4. tv.', name: 'Rule Test', phone: '1', email };
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
