// Fills EMULATORS with demo data: the owner's login, a few bookings, a business request and a
// closed day. Used by the public demo every time it starts empty (deploy/demo/start.sh) and by
// `npm run seed` while `npm run dev` is running. Refuses to run without emulator addresses, so it
// can never write to the real project.
//
// Demo owner login (shown on the demo's dashboard page): owner@demo.dk / neighbor-demo
// Demo business login (shown on the account page): hotel@demo.dk / neighbor-demo (Hotel ABC)
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
// Demo customer login (shown on the demo's account page): anna@demo.dk / neighbor-demo
const ANNA = { email: 'anna@demo.dk', password: 'neighbor-demo', displayName: 'Anna Jensen' };
const HOTEL = { email: 'hotel@demo.dk', password: 'neighbor-demo', displayName: 'Mette Lund' };
const HOTEL_ID = 'hotel-abc';

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
  // A customer with an account.
  let anna;
  try { anna = await auth.getUserByEmail(ANNA.email); } catch { anna = await auth.createUser({ ...ANNA, emailVerified: true }); }
  // A business customer's contact: the claim shows them Hotel ABC's fleet and reports.
  let hotel;
  try { hotel = await auth.getUserByEmail(HOTEL.email); } catch { hotel = await auth.createUser({ ...HOTEL, emailVerified: true }); }
  await auth.setCustomUserClaims(hotel.uid, { companyId: HOTEL_ID });

  // Only once per empty database.
  if ((await db.collection('bookings').limit(1).get()).size) return 'already seeded';

  const svc = (id, name, price, monthly = false) => ({ id, name, price, monthly });
  const accepted = { terms: true, earlyStart: true, termsVersion: '2026-10', at: FieldValue.serverTimestamp() };
  const base = { customerUid: null, bikeId: null, photos: [], urgent: false, note: '', apartment: '', accepted, createdAt: FieldValue.serverTimestamp() };
  const bookings = [
    { ...base, ref: 'TN-1041', status: 'confirmed', services: [svc('bike-check', 'The Neighbor Bike Check', 199)], date: day(3), arrival: '10:00', workMin: 25, blockMin: 40,
      bikeType: 'By / pendler', address: 'Fuglebakkevej 12, 2000 Frederiksberg', apartment: '3. th.', distanceKm: 5, name: 'Anna Jensen', email: ANNA.email, phone: '+45 20 12 34 56',
      note: 'Forbremsen føles blød.', pricing: { oneOff: 199, discount: 0, discountReason: null, monthly: 0, travel: 13, total: 212 }, customerUid: anna.uid },
    // Anna's earlier visit, already done.
    { ...base, ref: 'TN-1039', status: 'completed', services: [svc('puncture', 'Puncture Fix', 199)], date: day(-12), arrival: '11:00', workMin: 20, blockMin: 35,
      bikeType: 'Trek FX 3', bikeId: 'trek', visitLogged: true, recordId: 'seedrecordtrek000001', address: 'Fuglebakkevej 12, 2000 Frederiksberg', apartment: '3. th.', distanceKm: 5, name: 'Anna Jensen', email: ANNA.email, phone: '+45 20 12 34 56',
      pricing: { oneOff: 199, discount: 0, discountReason: null, monthly: 0, travel: 13, total: 212 }, customerUid: anna.uid },
    { ...base, ref: 'TN-1042', status: 'pending', services: [svc('puncture', 'Puncture Fix', 199), svc('chain', 'Chain Service', 149)], date: day(4), arrival: '13:00', workMin: 35, blockMin: 50,
      bikeType: 'Racer', address: 'Jagtvej 120, 2200 København N', distanceKm: 5, name: 'Mikkel Holm', email: 'mikkel@example.com', phone: '+45 40 55 66 77',
      pricing: { oneOff: 348, discount: 0, discountReason: null, monthly: 0, travel: 13, total: 361 } },
    { ...base, ref: 'TN-1043', status: 'pending', services: [svc('bike-check', 'The Neighbor Bike Check', 199), svc('gears', 'Gear Adjustment', 129)], date: day(6), arrival: '09:00', workMin: 40, blockMin: 55,
      bikeType: 'Ladcykel', address: 'Istedgade 50, 1650 København V', apartment: 'st.', distanceKm: 5, name: 'Sara Nielsen', email: 'sara@example.com', phone: '+45 31 22 33 44',
      pricing: { oneOff: 328, discount: 16, discountReason: 'combo', monthly: 0, travel: 13, total: 325 } },
  ];
  const batch = db.batch();
  batch.set(db.doc(`users/${anna.uid}`), {
    role: 'private', email: ANNA.email, name: 'Anna Jensen', phone: '+45 20 12 34 56', address: 'Fuglebakkevej 12, 2000 Frederiksberg', apartment: '3. th.',
    createdAt: new Date(`${day(-200)}T12:00:00Z`),
  });
  // Her saved bikes (no photos: add some in the demo).
  batch.set(db.doc(`users/${anna.uid}/bikes/trek`), {
    name: 'Trek FX 3', type: 'Hybrid', year: '2021', size: 'M / 54 cm', gears: '2×9', brakes: 'Hydrauliske skivebremser', tyres: '700×35c',
    colour: 'Mørkegrøn', usage: 'Daglig pendling, ca. 60 km om ugen', photos: [],
  });
  batch.set(db.doc(`users/${anna.uid}/bikes/pelago`), {
    name: 'Pelago Brinkeby', type: 'Bycykel', year: '2019', size: '54 cm', gears: '7-gear nav', brakes: 'Fælgbremser', tyres: '700×38c',
    colour: 'Creme', usage: 'Weekend og indkøb', photos: [],
  });
  const refs = bookings.map(() => db.collection('bookings').doc());
  bookings.forEach((b, i) => batch.set(refs[i], b));
  // The logged visit for TN-1039, and recommendations for next time.
  const tn1039 = refs[1].id;
  batch.set(db.doc('serviceRecords/seedrecordtrek000001'), {
    customerUid: anna.uid, bookingId: tn1039, bookingRef: 'TN-1039', bikeId: 'trek', bikeName: 'Trek FX 3', date: day(-12), title: 'Puncture Fix',
    work: ['Punkteret bagslange skiftet', 'Dækket tjekket for glasskår', 'Dæktryk sat til 4,5 bar'], parts: [{ name: 'Slange 700×35c', price: 0 }],
    notes: 'Bagdækket er ved at være slidt. Se anbefalingen.', photos: [],
    cost: { service: 199, parts: 0, travel: 13, total: 212 }, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('recommendations').doc(), {
    customerUid: anna.uid, bookingId: tn1039, bikeId: 'trek', bikeName: 'Trek FX 3', title: 'Skift bagdækket', urgency: 'soon',
    reason: 'Mønsteret er slidt ned til slidindikatorerne.', dueBy: 'Inden for ca. en måned', status: 'open', createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('recommendations').doc(), {
    customerUid: anna.uid, bookingId: tn1039, bikeId: 'pelago', bikeName: 'Pelago Brinkeby', title: 'Tjek fælgbremseklodserne', urgency: 'later',
    reason: 'Der er ca. 40 % tilbage af klodserne.', dueBy: 'Inden for 3 måneder', status: 'open', createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc('counters/bookings'), { last: 1043 });
  seedHotel(batch, hotel.uid);
  batch.set(db.collection('consultations').doc(), {
    name: 'Sofie Berg', company: 'Hostel Nørrebro', email: 'sofie@example.com', phone: '+45 22 33 44 55', companyType: 'Hostel', bikes: '16–35',
    preferredDate: day(5), preferredTime: '11:00', message: 'Vi udlejer 20 bycykler til gæster og har brug for månedlige eftersyn.', status: 'new', createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`closedDates/${day(9)}`), { reason: 'Ferie' });
  await batch.commit();
  return `seeded 4 bookings, 1 request, closed ${day(9)}, customer ${ANNA.email}, business ${HOTEL.email}`;
}

// Hotel ABC on the Standard plan: six bikes in two places and the last two monthly reports.
function seedHotel(batch, uid) {
  const company = db.doc(`companies/${HOTEL_ID}`);
  batch.set(company, {
    name: 'Hotel ABC', type: 'Hotel', contact: 'Mette Lund', email: HOTEL.email, phone: '+45 33 12 34 56', address: 'Vesterbrogade 10, 1620 København V',
    plan: 'standard', pricePerBike: 300, memberUids: [uid], nextVisit: day(8), status: 'active', since: day(-120), leadId: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`users/${uid}`), { role: 'business', companyId: HOTEL_ID, name: 'Mette Lund', email: HOTEL.email, phone: '+45 33 12 34 56', createdAt: FieldValue.serverTimestamp() });
  const city = { type: 'Bycykel', year: '2022', size: '54 cm', gears: '7-gear nav', brakes: 'Fælgbremser', photos: [] };
  const bikes = {
    b001: { ...city, number: '#001', location: 'Reception' },
    b002: { ...city, number: '#002', location: 'Reception' },
    b003: { ...city, number: '#003', location: 'Reception', size: '50 cm' },
    b004: { number: '#004', type: 'Ladcykel', location: 'Gården', year: '2021', size: '', gears: '8-gear nav', brakes: 'Hydrauliske skivebremser', photos: [] },
    b005: { ...city, number: '#005', location: 'Gården' },
    b006: { ...city, number: '#006', location: 'Gården', year: '2023' },
  };
  for (const [id, b] of Object.entries(bikes)) batch.set(company.collection('bikes').doc(id), b);
  const ok = { status: 'ready', action: '–', note: '' };
  const month = (n) => { const d = new Date(`${todayCph.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
  const reports = {
    [month(-2)]: { b001: ok, b002: ok, b003: ok, b005: ok, b006: ok,
      b004: { status: 'attention', action: 'Bremseklodser slidte', note: 'Skiftes ved næste besøg.' } },
    [month(-1)]: { b001: ok, b003: ok, b006: ok, b004: { status: 'ready', action: 'Bremseklodser skiftet', note: '' },
      b002: { status: 'repair', action: 'Nyt baghjul bestilt', note: 'Fælgen er bøjet. Cyklen er taget ud af brug.' },
      b005: { status: 'attention', action: 'Kæden strammet', note: 'Kæden er slidt: skift inden for 2 måneder.' } },
  };
  for (const [m, entries] of Object.entries(reports)) {
    const counts = { ready: 0, attention: 0, repair: 0 };
    for (const e of Object.values(entries)) counts[e.status] += 1;
    batch.set(company.collection('reports').doc(m), { month: m, visitDate: `${m}-08`, entries, counts, updatedAt: FieldValue.serverTimestamp() });
  }
}

if (!/^(127\.0\.0\.1|localhost|emulators):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('seed-demo: refusing to run without the Firestore emulator');
  process.exit(1);
}
seed().then((msg) => console.log(`seed-demo: ${msg}; owner ${OWNER.email}`), (e) => { console.error('seed-demo failed:', e.message); process.exit(1); });
