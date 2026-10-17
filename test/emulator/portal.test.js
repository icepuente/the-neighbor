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

// ---- Saved bikes (phase 3b) ----
const BUCKET = `${P}.firebasestorage.app`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
const upload = async (headers, path) => (await fetch(`http://127.0.0.1:9199/v0/b/${BUCKET}/o?name=${encodeURIComponent(path)}`, {
  method: 'POST', headers: { Authorization: headers.Authorization.replace('Bearer', 'Firebase'), 'Content-Type': 'image/jpeg' }, body: JPEG,
})).status;
const readFile = async (headers, path) => (await fetch(`http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`, {
  headers: { Authorization: headers.Authorization.replace('Bearer', 'Firebase') },
})).status;
const pid = (n) => `${'b'.repeat(14)}${String(n).padStart(6, '0')}`;
const photoVal = (uid, bike, id) => ({ mapValue: { fields: {
  id: { stringValue: id }, path: { stringValue: `users/${uid}/bikes/${bike}/${id}.jpg` }, thumbPath: { stringValue: `users/${uid}/bikes/${bike}/${id}_thumb.jpg` },
} } });
const putBike = (headers, uid, bike, fields) => fetch(`${FS}/users/${uid}/bikes/${bike}`, {
  method: 'PATCH', headers: { ...headers, ...json }, body: JSON.stringify({ fields }),
});

test('saved bikes: a customer manages their own, with up to 4 photos in their own folder', async () => {
  const u = await signUp('bikes@example.com');
  await call('syncAccount', { profile: { name: 'Bike Owner' } }, u.headers);
  const other = await signUp('bikes-other@example.com');
  await call('syncAccount', { profile: { name: 'Other' } }, other.headers);
  // Photos: into their own bike folder, as a signed-in account.
  assert.equal(await upload(u.headers, `users/${u.uid}/bikes/b1/${pid(1)}.jpg`), 200, 'own bike folder');
  assert.equal(await upload(u.headers, `users/${u.uid}/bikes/b1/${pid(1)}_thumb.jpg`), 200, 'and its thumbnail');
  assert.equal(await upload(other.headers, `users/${u.uid}/bikes/b1/${pid(2)}.jpg`), 403, "not someone else's folder");
  const anon = await (await fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: json, body: '{"returnSecureToken":true}' })).json();
  assert.equal(await upload({ Authorization: `Bearer ${anon.idToken}` }, `users/${anon.localId}/bikes/b1/${pid(3)}.jpg`), 403, 'not an anonymous guest');
  assert.equal(await readFile(u.headers, `users/${u.uid}/bikes/b1/${pid(1)}.jpg`), 200, 'the customer sees their photo');
  assert.equal(await readFile(other.headers, `users/${u.uid}/bikes/b1/${pid(1)}.jpg`), 403, 'another customer does not');
  // The bike document.
  const name = { stringValue: 'Trek FX 3' };
  assert.equal((await putBike(u.headers, u.uid, 'b1', { name, photos: { arrayValue: { values: [photoVal(u.uid, 'b1', pid(1))] } } })).status, 200, 'a bike with a photo');
  assert.equal((await putBike(other.headers, u.uid, 'b2', { name })).status, 403, "not in someone else's account");
  assert.equal((await putBike(u.headers, u.uid, 'b3', { name: { stringValue: '' } })).status, 403, 'a bike needs a name');
  assert.equal((await putBike(u.headers, u.uid, 'b3', { name, owner: { stringValue: 'x' } })).status, 403, 'only known fields');
  assert.equal((await putBike(u.headers, u.uid, 'b3', { name, photos: { arrayValue: { values: [photoVal(other.uid, 'b1', pid(9))] } } })).status, 403, "a photo must be in this bike's folder");
  const five = { arrayValue: { values: [1, 2, 3, 4, 5].map((n) => photoVal(u.uid, 'b3', pid(n))) } };
  assert.equal((await putBike(u.headers, u.uid, 'b3', { name, photos: five })).status, 403, 'at most 4 photos');
  assert.equal((await read(`users/${u.uid}/bikes/b1`, other.headers)).status, 403, "another customer cannot read the bike");
});

test("createBooking: a saved bike is linked, and the booking's photos are added to it", async () => {
  const u = await signUp('bike-booking@example.com');
  await call('syncAccount', { profile: { name: 'Bike Booker' } }, u.headers);
  assert.equal((await putBike(u.headers, u.uid, 'cargo', { name: { stringValue: 'Ladcykel' } })).status, 200);
  // The booking photo, uploaded the way the booking form does.
  const id = pid(42);
  assert.equal(await upload(u.headers, `uploads/${u.uid}/${id}.jpg`), 200);
  assert.equal(await upload(u.headers, `uploads/${u.uid}/${id}_thumb.jpg`), 200);
  const input = { serviceIds: ['chain'], date: day, arrival: '13:30', bike: 'Ladcykel', bikeId: 'cargo', address: 'Jagtvej 1, 2200 København N', name: 'B', phone: '1', email: u.email, photos: [{ id, w: 10, h: 10 }] };
  const r = (await call('createBooking', { input, accept: { terms: true, earlyStart: true } }, u.headers)).result;
  assert.ok(r.booking, JSON.stringify(r.errors));
  assert.equal(r.booking.photosAddedToBike, 1, 'the photo is added to the bike');
  const booking = await (await read(`bookings/${r.booking.id}`, u.headers)).json();
  assert.equal(booking.fields.bikeId.stringValue, 'cargo', 'the booking is linked to the saved bike');
  const bike = await (await read(`users/${u.uid}/bikes/cargo`, u.headers)).json();
  const photo = bike.fields.photos.arrayValue.values[0].mapValue.fields;
  assert.ok(photo.path.stringValue.startsWith(`users/${u.uid}/bikes/cargo/`) && photo.fromBooking.stringValue === r.booking.id, 'stored in the bike\'s folder, marked with the booking');
  assert.equal(await readFile(u.headers, photo.path.stringValue), 200, 'and the customer can see it');
  // A bike id that is not the customer's own is ignored.
  const guest = (await call('createBooking', { input: { ...input, arrival: '14:30', photos: [], email: 'g@example.com' }, accept: { terms: true, earlyStart: true } })).result;
  const gb = await (await read(`bookings/${guest.booking.id}`, ADMIN)).json();
  assert.equal(gb.fields.bikeId.nullValue, null, 'a guest cannot link a saved bike');
});

test('saved bikes: a customer deletes their own bike, not someone else\'s', async () => {
  const u = await signUp('bike-delete@example.com');
  await call('syncAccount', { profile: { name: 'Deleter' } }, u.headers);
  const other = await signUp('bike-delete-other@example.com');
  assert.equal((await putBike(u.headers, u.uid, 'old', { name: { stringValue: 'Old bike' } })).status, 200);
  assert.equal((await fetch(`${FS}/users/${u.uid}/bikes/old`, { method: 'DELETE', headers: other.headers })).status, 403, 'not another customer');
  const del = await fetch(`${FS}/users/${u.uid}/bikes/old`, { method: 'DELETE', headers: u.headers });
  assert.equal(del.status, 200, `the customer deletes it (${del.status} ${await del.text()})`);
  assert.equal((await read(`users/${u.uid}/bikes/old`, u.headers)).status, 404, 'and it is gone');
});
