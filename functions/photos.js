// Booking photos in Cloud Storage (plan, decision 15). Browsers upload to uploads/{uid}/ (see
// storage.rules); these helpers check the files, move them into the booking's folder, and clean up
// uploads that never became part of a booking.
import { getStorage } from 'firebase-admin/storage';

export const PHOTO_ID = /^[a-z0-9]{20}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

// The project's default bucket (the same name the site's Firebase settings use).
export const bucket = () => getStorage().bucket(`${process.env.GCLOUD_PROJECT}.firebasestorage.app`);

const uploadPaths = (uid, id) => [`uploads/${uid}/${id}.jpg`, `uploads/${uid}/${id}_thumb.jpg`];

// True when every photo (full size and thumbnail) is in the caller's upload folder as a JPEG of at
// most 2 MB. The rules already require that at upload; this checks again before anything is moved.
export async function uploadsReady(b, uid, photos) {
  const files = photos.flatMap((p) => uploadPaths(uid, p.id));
  const metas = await Promise.all(files.map((f) => b.file(f).getMetadata().then(([m]) => m, () => null)));
  return metas.every((m) => m && m.contentType === 'image/jpeg' && Number(m.size) <= MAX_BYTES);
}

// Copies the photos into bookings/{bookingId}/ and returns what the booking records about them.
export async function copyToBooking(b, uid, photos, bookingId) {
  const uploadedAt = new Date().toISOString();
  return Promise.all(photos.map(async (p) => {
    const [full, thumb] = uploadPaths(uid, p.id);
    const path = `bookings/${bookingId}/${p.id}.jpg`;
    const thumbPath = `bookings/${bookingId}/${p.id}_thumb.jpg`;
    await Promise.all([b.file(full).copy(b.file(path)), b.file(thumb).copy(b.file(thumbPath))]);
    return { id: p.id, path, thumbPath, w: p.w, h: p.h, uploadedAt };
  }));
}

// Copies a booking's photos onto the customer's saved bike (decision 15), as new files with new ids
// so deleting one copy leaves the other. Returns the entries for the bike's photo list.
export async function copyToBike(b, photos, uid, bikeId, bookingId) {
  const uploadedAt = new Date().toISOString();
  return Promise.all(photos.map(async (p) => {
    const id = randomId();
    const path = `users/${uid}/bikes/${bikeId}/${id}.jpg`;
    const thumbPath = `users/${uid}/bikes/${bikeId}/${id}_thumb.jpg`;
    await Promise.all([b.file(p.path).copy(b.file(path)), b.file(p.thumbPath).copy(b.file(thumbPath))]);
    return { id, path, thumbPath, w: p.w, h: p.h, uploadedAt, fromBooking: bookingId };
  }));
}
// 20 lower-case letters and digits, as the site makes photo ids.
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');

export const deleteFiles = (b, paths) => Promise.all(paths.map((p) => b.file(p).delete({ ignoreNotFound: true })));
export const deleteUploads = (b, uid, photos) => deleteFiles(b, photos.flatMap((p) => uploadPaths(uid, p.id)));

// Deletes uploads older than `maxAgeMs` (24 hours): photos a visitor added but never booked.
// Returns how many files were deleted.
export async function deleteStaleUploads(b, { now = Date.now(), maxAgeMs = DAY_MS } = {}) {
  const [files] = await b.getFiles({ prefix: 'uploads/' });
  const stale = files.filter((f) => now - Date.parse(f.metadata.timeCreated) > maxAgeMs);
  await Promise.all(stale.map((f) => f.delete({ ignoreNotFound: true })));
  return stale.length;
}
