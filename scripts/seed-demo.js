// Fills EMULATORS with demo data: the owner's login, a few bookings, a business request and a
// closed day. Used by the public demo every time it starts empty (deploy/demo/start.sh) and by
// `npm run seed` while `npm run dev` is running. Refuses to run without emulator addresses, so it
// can never write to the real project.
//
// Demo owner login (shown on the demo's dashboard page): owner@demo.dk / neighbor-demo
import { createRequire } from 'node:module';

const PROJECT = process.argv[2] || 'my-first-firebase-projec-b242f';
const host = process.env.EMULATOR_HOST || '127.0.0.1';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= `${host}:9099`;
process.env.FIRESTORE_EMULATOR_HOST ||= `${host}:8085`;

// firebase-admin is installed with the Functions (functions/ here, /app/functions in the demo).
const require = createRequire(new URL(process.env.FUNCTIONS_PACKAGE || '../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = initializeApp({ projectId: PROJECT });
const auth = getAuth(app);
const db = getFirestore(app);

const OWNER = { email: 'owner@demo.dk', password: 'neighbor-demo' };

// Dates in Copenhagen time; the shop is closed on Sundays.
const todayCph = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
const day = (n) => {
  const d = new Date(`${todayCph}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function seed() {
  // The owner.
  let owner;
  try { owner = await auth.getUserByEmail(OWNER.email); } catch { owner = await auth.createUser({ ...OWNER, emailVerified: true }); }
  await auth.setCustomUserClaims(owner.uid, { admin: true });

  // Only once per empty database.
  if ((await db.collection('bookings').limit(1).get()).size) return 'already seeded';

  const svc = (id, name, price, monthly = false) => ({ id, name, price, monthly });
  const accepted = { terms: true, earlyStart: true, termsVersion: '2026-10', at: FieldValue.serverTimestamp() };
  const base = { customerUid: null, bikeId: null, photos: [], urgent: false, note: '', apartment: '', accepted, createdAt: FieldValue.serverTimestamp() };
  const bookings = [
    { ...base, ref: 'TN-1041', status: 'confirmed', services: [svc('bike-check', 'The Neighbor Bike Check', 199)], date: day(3), arrival: '10:00', workMin: 25, blockMin: 40,
      bikeType: 'By / pendler', address: 'Fuglebakkevej 12, 2000 Frederiksberg', apartment: '3. th.', distanceKm: 5, name: 'Anna Jensen', email: 'anna@example.com', phone: '+45 20 12 34 56',
      note: 'Forbremsen føles blød.', pricing: { oneOff: 199, discount: 0, discountReason: null, monthly: 0, travel: 13, total: 212 } },
    { ...base, ref: 'TN-1042', status: 'pending', services: [svc('puncture', 'Puncture Fix', 199), svc('chain', 'Chain Service', 149)], date: day(4), arrival: '13:00', workMin: 35, blockMin: 50,
      bikeType: 'Racer', address: 'Jagtvej 120, 2200 København N', distanceKm: 5, name: 'Mikkel Holm', email: 'mikkel@example.com', phone: '+45 40 55 66 77',
      pricing: { oneOff: 348, discount: 0, discountReason: null, monthly: 0, travel: 13, total: 361 } },
    { ...base, ref: 'TN-1043', status: 'pending', services: [svc('bike-check', 'The Neighbor Bike Check', 199), svc('gears', 'Gear Adjustment', 129)], date: day(6), arrival: '09:00', workMin: 40, blockMin: 55,
      bikeType: 'Ladcykel', address: 'Istedgade 50, 1650 København V', apartment: 'st.', distanceKm: 5, name: 'Sara Nielsen', email: 'sara@example.com', phone: '+45 31 22 33 44',
      pricing: { oneOff: 328, discount: 16, discountReason: 'combo', monthly: 0, travel: 13, total: 325 } },
  ];
  const batch = db.batch();
  for (const b of bookings) batch.set(db.collection('bookings').doc(), b);
  batch.set(db.doc('counters/bookings'), { last: 1043 });
  batch.set(db.collection('consultations').doc(), {
    name: 'Sofie Berg', company: 'Hostel Nørrebro', email: 'sofie@example.com', phone: '+45 22 33 44 55', companyType: 'Hostel', bikes: '16–35',
    preferredDate: day(5), preferredTime: '11:00', message: 'Vi udlejer 20 bycykler til gæster og har brug for månedlige eftersyn.', status: 'new', createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`closedDates/${day(9)}`), { reason: 'Ferie' });
  await batch.commit();
  return `seeded 3 bookings, 1 request, closed ${day(9)}`;
}

if (!/^(127\.0\.0\.1|localhost|emulators):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('seed-demo: refusing to run without the Firestore emulator');
  process.exit(1);
}
seed().then((msg) => console.log(`seed-demo: ${msg}; owner ${OWNER.email}`), (e) => { console.error('seed-demo failed:', e.message); process.exit(1); });
