// Customer accounts on the emulators (phase 3a): syncAccount (profile, linking guest bookings by a
// verified email), the rules for a customer's own data, and cancelling online. Run with
// `npm run test:functions`. Named to run after functions.test.js, which expects an empty database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../shared/booking-rules.js';

const P = 'my-first-firebase-projec-b242f';
const FS = `http://127.0.0.1:8085/v1/projects/${P}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = `http://127.0.0.1:5001/${P}/europe-west1`;
const ADMIN = { Authorization: 'Bearer owner' };
const json = { 'Content-Type': 'application/json' };

async function signUp(email) {
  const r = await (await fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: json, body: JSON.stringify({ email, password: 'secret-password', returnSecureToken: true }) })).json();
  return { uid: r.localId, email, headers: { Authorization: `Bearer ${r.idToken}` } };
}
// Marks the address verified (as the emailed link would) and signs in again for a fresh token.
async function verify(user) {
  await fetch(`${AUTH}/projects/${P}/accounts:update`, { method: 'POST', headers: { ...ADMIN, ...json }, body: JSON.stringify({ localId: user.uid, emailVerified: true }) });
  const s = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: json, body: JSON.stringify({ email: user.email, password: 'secret-password', returnSecureToken: true }) })).json();
  user.headers = { Authorization: `Bearer ${s.idToken}` };
}
const call = async (name, data, headers = {}) => (await fetch(`${FN}/${name}`, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify({ data }) })).json();
const read = (path, headers) => fetch(`${FS}/${path}`, { headers });
const day = R.nextOpenDay(R.addDays(R.today(), 50));
async function guestBooking(email, arrival) {
  const input = { serviceIds: ['chain'], date: day, arrival, bike: 'City bike', address: 'Jagtvej 1, 2200 København N', name: 'Portal Test', phone: '1', email };
  return (await call('createBooking', { input, accept: { terms: true, earlyStart: true } })).result.booking;
}

test('syncAccount creates the profile; guest bookings join only once the email is verified', async () => {
  const guest = await guestBooking('portal@example.com', '09:00');
  const user = await signUp('portal@example.com');
  assert.equal((await call('syncAccount', {}, user.headers)).result.error, 'name', 'a new profile needs a name');
  const first = (await call('syncAccount', { profile: { name: 'Portal Person', phone: '123' } }, user.headers)).result;
  assert.deepEqual([first.created, first.verified, first.linked], [true, false, 0], 'profile created; nothing linked before verification');
  assert.equal((await read(`bookings/${guest.id}`, user.headers)).status, 403, 'the guest booking stays private until then');
  await verify(user);
  const second = (await call('syncAccount', {}, user.headers)).result;
  assert.deepEqual([second.created, second.verified, second.linked], [false, true, 1], 'after verification the guest booking joins');
  assert.equal((await read(`bookings/${guest.id}`, user.headers)).status, 200, 'and the customer can read it');
  const profile = await (await read(`users/${user.uid}`, user.headers)).json();
  assert.deepEqual([profile.fields.role.stringValue, profile.fields.name.stringValue, profile.fields.email.stringValue], ['private', 'Portal Person', 'portal@example.com']);
});

test('accounts only see their own data', async () => {
  const a = await signUp('owner-of-booking@example.com');
  await call('syncAccount', { profile: { name: 'A' } }, a.headers);
  await verify(a);
  const own = (await call('createBooking', { input: { serviceIds: ['chain'], date: day, arrival: '10:00', bike: 'x', address: 'Jagtvej 1, 2200 København N', name: 'A', phone: '1', email: a.email }, accept: { terms: true, earlyStart: true } }, a.headers)).result.booking;
  const b = await signUp('someone-else@example.com');
  await call('syncAccount', { profile: { name: 'B' } }, b.headers);
  assert.equal((await read(`bookings/${own.id}`, a.headers)).status, 200, 'a booking made while signed in is the customer\'s');
  assert.equal((await read(`bookings/${own.id}`, b.headers)).status, 403, 'another customer cannot read it');
  assert.equal((await read(`users/${a.uid}`, b.headers)).status, 403, "nor another customer's profile");
  const list = await fetch(`${FS}:runQuery`, { method: 'POST', headers: { ...b.headers, ...json }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'bookings' }] } }) });
  assert.equal(list.status, 403, 'listing all bookings is refused');
});

test('a customer edits their contact details, and nothing else', async () => {
  const u = await signUp('profile-edit@example.com');
  await call('syncAccount', { profile: { name: 'Before' } }, u.headers);
  const patch = (fields) => fetch(`${FS}/users/${u.uid}?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`, {
    method: 'PATCH', headers: { ...u.headers, ...json },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }])) }),
  });
  assert.equal((await patch({ name: 'After', phone: '99', address: 'Jagtvej 2, 2200 København N', apartment: '1. tv.' })).status, 200, 'contact details');
  assert.equal((await patch({ role: 'admin' })).status, 403, 'not the role');
  assert.equal((await patch({ email: 'other@example.com' })).status, 403, 'not the email');
  assert.equal((await patch({ name: '' })).status, 403, 'not an empty name');
});

test('cancelMyBooking: own bookings, up to 24 hours before', async () => {
  const u = await signUp('cancel-me@example.com');
  await call('syncAccount', { profile: { name: 'C' } }, u.headers);
  const mine = (await call('createBooking', { input: { serviceIds: ['chain'], date: day, arrival: '11:00', bike: 'x', address: 'Jagtvej 1, 2200 København N', name: 'C', phone: '1', email: u.email }, accept: { terms: true, earlyStart: true } }, u.headers)).result.booking;
  const other = await guestBooking('not-mine@example.com', '12:00');
  assert.equal((await call('cancelMyBooking', { bookingId: other.id }, u.headers)).result.error, 'missing', "not someone else's");
  assert.equal((await call('cancelMyBooking', { bookingId: mine.id })).error?.status, 'UNAUTHENTICATED', 'not signed out');
  // A booking in a few hours (put in directly; the form would not allow it).
  const soon = await fetch(`${FS}/bookings?documentId=soon-${u.uid}`, { method: 'POST', headers: { ...ADMIN, ...json }, body: JSON.stringify({ fields: {
    customerUid: { stringValue: u.uid }, status: { stringValue: 'confirmed' }, date: { stringValue: R.today() }, arrival: { stringValue: '23:59' },
    ref: { stringValue: 'TN-SOON' }, name: { stringValue: 'C' }, phone: { stringValue: '1' }, email: { stringValue: u.email }, address: { stringValue: 'x' },
  } }) });
  assert.equal(soon.status, 200);
  assert.equal((await call('cancelMyBooking', { bookingId: `soon-${u.uid}` }, u.headers)).result.error, 'late', 'within 24 hours: call instead');
  assert.equal((await call('cancelMyBooking', { bookingId: mine.id }, u.headers)).result.ok, true, 'their own, days ahead');
  const after = await (await read(`bookings/${mine.id}`, u.headers)).json();
  assert.deepEqual([after.fields.status.stringValue, after.fields.cancelledBy.stringValue], ['cancelled', 'customer']);
});

test('demoVerifyEmail marks the address verified, on the emulators', async () => {
  const u = await signUp('demo-verify@example.com');
  assert.equal((await call('demoVerifyEmail', {}, u.headers)).result.ok, true);
  const s = await (await fetch(`${AUTH}/accounts:lookup?key=demo`, { method: 'POST', headers: json, body: JSON.stringify({ idToken: u.headers.Authorization.slice(7) }) })).json();
  assert.equal(s.users[0].emailVerified, true);
});
