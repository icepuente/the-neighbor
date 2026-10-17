// Booking photos on the emulators: the Storage rules, createBooking moving photos into the
// booking's folder, and the clean-up of uploads never booked. Run with `npm run test:functions`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../shared/booking-rules.js';
import { PROJECT, bucket, exists, listFiles } from '../helpers/emulator-admin.js';
import { deleteStaleUploads } from '../../functions/photos.js';

const BUCKET = `${PROJECT}.firebasestorage.app`;
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
const CONSENT = { data: true, terms: true, version: R.CONFIG.consentVersion };
const D = R.nextOpenDay(R.addDays(R.today(), 20)); // a day of its own, away from other tests' bookings

let counter = 0;
const newId = () => `${'p'.repeat(14)}${String(++counter).padStart(6, '0')}`; // 20 characters, a-z0-9

async function guest() {
  const r = await (await fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' })).json();
  return { uid: r.localId, token: r.idToken };
}
// Uploads like the site does (Firebase Storage REST), returning the HTTP status.
async function upload(user, path, { type = 'image/jpeg', body = JPEG } = {}) {
  const res = await fetch(`http://127.0.0.1:9199/v0/b/${BUCKET}/o?name=${encodeURIComponent(path)}`, {
    method: 'POST', headers: { Authorization: `Firebase ${user.token}`, 'Content-Type': type }, body,
  });
  return res.status;
}
const uploadPhoto = async (user, id) => [await upload(user, `uploads/${user.uid}/${id}.jpg`), await upload(user, `uploads/${user.uid}/${id}_thumb.jpg`)];
async function book(user, arrival, photos) {
  const input = { serviceIds: ['chain'], date: D, arrival, bike: 'City bike', address: 'Jagtvej 1, 2200 København N', name: 'Photo Test', phone: '1', email: 'photo@example.com', photos };
  const res = await (await fetch(`${FN}/createBooking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` }, body: JSON.stringify({ data: { input, consent: CONSENT } }),
  })).json();
  if (res.error) throw new Error(res.error.message);
  return res.result;
}

test('Storage rules: small JPEGs into your own upload folder only, and nothing can be read', async () => {
  const a = await guest();
  const b = await guest();
  const id = newId();
  assert.equal(await upload(a, `uploads/${a.uid}/${id}.jpg`), 200, 'your own folder, a JPEG');
  assert.equal(await upload(a, `uploads/${a.uid}/${id}_thumb.jpg`), 200, 'and its thumbnail');
  assert.equal(await upload(a, `uploads/${a.uid}/${id}.jpg`), 403, 'an existing file cannot be replaced');
  assert.equal(await upload(a, `uploads/${b.uid}/${newId()}.jpg`), 403, "someone else's folder");
  assert.equal(await upload(a, `uploads/${a.uid}/${newId()}.jpg`, { type: 'image/png' }), 403, 'not a JPEG');
  assert.equal(await upload(a, `uploads/${a.uid}/${newId()}.jpg`, { body: Buffer.alloc(2 * 1024 * 1024 + 1) }), 403, 'over 2 MB');
  assert.equal(await upload(a, `uploads/${a.uid}/../evil.jpg`), 403, 'a strange file name');
  assert.equal(await upload(a, `bookings/x/${newId()}.jpg`), 403, 'straight into a booking folder');
  const read = await fetch(`http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(`uploads/${a.uid}/${id}.jpg`)}?alt=media`, { headers: { Authorization: `Firebase ${a.token}` } });
  assert.equal(read.status, 403, 'not even your own upload can be read back');
});

test('createBooking moves the photos into the booking and removes the uploads', async () => {
  const g = await guest();
  const id = newId();
  assert.deepEqual(await uploadPhoto(g, id), [200, 200]);
  const r = await book(g, '09:00', [{ id, w: 1200, h: 900 }]);
  assert.ok(r.booking, JSON.stringify(r.errors));
  assert.equal(r.booking.photos, 1);
  assert.ok(await exists(`bookings/${r.booking.id}/${id}.jpg`), 'the photo is in the booking folder');
  assert.ok(await exists(`bookings/${r.booking.id}/${id}_thumb.jpg`), 'with its thumbnail');
  assert.deepEqual(await listFiles(`uploads/${g.uid}/`), [], 'the uploads are gone');
});

test('createBooking refuses photos that are not in your own upload folder', async () => {
  const owner = await guest();
  const other = await guest();
  const id = newId();
  await uploadPhoto(owner, id);
  assert.equal((await book(other, '10:00', [{ id, w: 1, h: 1 }])).errors?.photos, 'photos', "someone else's photo");
  assert.equal((await book(owner, '10:00', [{ id: newId(), w: 1, h: 1 }])).errors?.photos, 'photos', 'a photo that was never uploaded');
  assert.equal((await book(owner, '10:00', [{ id: 'NOT-VALID', w: 1, h: 1 }])).errors?.photos, 'photos', 'a malformed id');
  const four = [1, 2, 3, 4].map(() => ({ id: newId(), w: 1, h: 1 }));
  assert.equal((await book(owner, '10:00', four)).errors?.photos, 'photosMax', 'more than 3 photos');
  assert.ok(await exists(`uploads/${owner.uid}/${id}.jpg`), "the owner's upload is untouched");
});

test('when the time is taken, the copies are removed and the uploads kept for the next try', async () => {
  const g = await guest();
  const id = newId();
  await uploadPhoto(g, id);
  const r = await book(g, '09:00', [{ id, w: 1, h: 1 }]); // 09:00 was booked by the test above
  assert.equal(r.errors?.arrival, 'taken');
  assert.ok(await exists(`uploads/${g.uid}/${id}.jpg`), 'the upload is still there');
  const again = await book(g, '11:00', [{ id, w: 1, h: 1 }]);
  assert.ok(again.booking, 'booking another time with the same photo works');
  assert.ok(await exists(`bookings/${again.booking.id}/${id}.jpg`));
});

test('the clean-up deletes uploads older than 24 hours, and only those', async () => {
  const g = await guest();
  const id = newId();
  await uploadPhoto(g, id);
  assert.equal(await deleteStaleUploads(bucket), 0, 'a fresh upload is kept');
  assert.ok(await exists(`uploads/${g.uid}/${id}.jpg`));
  const later = Date.now() + 25 * 60 * 60 * 1000;
  assert.ok(await deleteStaleUploads(bucket, { now: later }) >= 2, '25 hours later it is deleted');
  assert.equal(await exists(`uploads/${g.uid}/${id}.jpg`), false);
  assert.ok((await listFiles('bookings/')).length >= 4, 'booking photos are never touched');
});
