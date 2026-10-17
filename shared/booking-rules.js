// The Neighbor's booking rules, shared by the site (web/) and the Cloud Functions (functions/).
//
// This is the only copy to edit: `npm run sync-shared` copies it into web/js/shared/ and
// functions/shared/ (both git-ignored); `npm run dev` and every deploy run that first.
//
// Everything here is pure: functions get the data they need as arguments (the page passes what it
// knows; a Function passes what it read from Firestore) and never read storage themselves. The
// browser may use these rules to show prices and times, but only the Functions' answer counts.
//
// Dates are 'YYYY-MM-DD' strings in Copenhagen time, and times are 'HH:MM'. The Functions run in
// UTC, so "today" is always worked out for Europe/Copenhagen, never from the machine's clock zone.

export const TIME_ZONE = 'Europe/Copenhagen';

export const CONFIG = {
  businessName: 'The Neighbor',
  base: 'Rørsangervej 45, København',
  // Travel: 2.5 DKK per km, one way, from the base; addresses beyond 18 km are refused.
  kmRate: 2.5,
  maxKm: 18,
  // 5% off the whole order when The Neighbor Bike Check is booked with other services, or for Care
  // Plus members. The two never stack: an order gets at most one 5%.
  comboOff: 0.05,
  carePlusOff: 0.05,
  subscriptionMinMonths: 3,
  // Everyone books at least 2 days ahead. Care Plus members may book tomorrow once a calendar
  // month, as their urgent visit.
  minLeadDays: 2,
  urgentLeadDays: 1,
  // Open Monday to Saturday. Work starts from 08:30 and must be finished by 15:30.
  openFrom: 8 * 60 + 30,
  workEnd: 15 * 60 + 30,
  startStep: 30,
  closedWeekdays: [0],
  // A booking takes at most 45 minutes of work; travel comes on top, with 15 minutes between jobs.
  maxWorkMin: 45,
  travelBufferMin: 15,
  // Bike photos: at most 3 per booking and 4 per saved bike (plan, decision 15).
  maxBookingPhotos: 3,
  maxBikePhotos: 4,
  consentVersion: '2026-10',
};

// The owner's service list (2026-10-13). durationMin is the top of the owner's range, so the
// calendar never runs short; `mins` is the range shown to customers.
export const SERVICES = [
  { id: 'bike-check', name: 'The Neighbor Bike Check', da: 'The Neighbor Cykeltjek', price: 199, monthly: false, durationMin: 25, mins: '20–25' },
  { id: 'puncture', name: 'Puncture Fix', da: 'Punkteringsreparation', price: 199, monthly: false, durationMin: 20, mins: '15–20', tubeIncluded: true },
  { id: 'brakes', name: 'Brake Adjustment', da: 'Bremsejustering', price: 129, monthly: false, durationMin: 15, mins: '15' },
  { id: 'gears', name: 'Gear Adjustment', da: 'Gearjustering', price: 129, monthly: false, durationMin: 15, mins: '15' },
  { id: 'chain', name: 'Chain Service', da: 'Kædeservice', price: 149, monthly: false, durationMin: 15, mins: '15' },
  { id: 'diagnostics', name: 'Diagnostics', da: 'Fejlfinding', price: 299, monthly: false, durationMin: 20, mins: '15–20', needsNote: true },
  // Subscriptions: one check-up visit a month (it does not roll over), minimum 3 months.
  { id: 'monthly', name: 'The Neighbor Care', da: 'The Neighbor Care', price: 79, monthly: true, durationMin: 25, mins: '20–25' },
  { id: 'premium-monthly', name: 'Neighbor Care Plus', da: 'Neighbor Care Plus', price: 99, monthly: true, durationMin: 25, mins: '20–25' },
];
export const service = (id) => SERVICES.find((s) => s.id === id);

// Business fleet plans, priced per bike per month.
export const PLANS = [
  { id: 'basic', name: 'Basic', pricePerBike: 250, monthlyReport: false, maxBikes: null,
    includes: ['Initial bicycle checklist', 'Initial fleet report', 'Preventive maintenance', 'Basic safety inspection'],
    includesDa: ['Opstartstjekliste', 'Opstartsrapport for flåden', 'Forebyggende vedligehold', 'Grundlæggende sikkerhedseftersyn'] },
  { id: 'standard', name: 'Standard', pricePerBike: 300, monthlyReport: true, maxBikes: null,
    includes: ['Initial bicycle checklist', 'Initial fleet report', 'Monthly bicycle check-up', 'Monthly service report', 'Preventive maintenance'],
    includesDa: ['Opstartstjekliste', 'Opstartsrapport for flåden', 'Månedligt eftersyn', 'Månedlig servicerapport', 'Forebyggende vedligehold'] },
  { id: 'premium', name: 'Premium', pricePerBike: 350, monthlyReport: true, maxBikes: 35,
    includes: ['Monthly bicycle check-up', 'Monthly service report', 'Priority service', 'Priority reporting', 'Discounted inner-tube repairs'],
    includesDa: ['Månedligt eftersyn', 'Månedlig servicerapport', 'Prioriteret service', 'Prioriteret rapportering', 'Rabat på slangereparationer'] },
];

export const STATUS = { ready: 'Ready', attention: 'Attention', repair: 'Repair needed' };

// ---- Dates (calendar arithmetic in UTC, so the machine's time zone never matters) ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
export const isDate = (s) => typeof s === 'string' && DATE_RE.test(s);
export const isTime = (s) => typeof s === 'string' && TIME_RE.test(s);

const atNoon = (date) => new Date(`${date}T12:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);

// Today's date in Copenhagen. `now` can be passed for tests.
export function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function addDays(date, n) {
  const d = atNoon(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
export function addMonths(date, n) {
  const d = atNoon(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toIso(d);
}
export const weekday = (date) => atNoon(date).getUTCDay();
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Every start time in the day, ignoring bookings; used for the consultation form.
export function arrivalTimes() {
  const out = [];
  for (let m = CONFIG.openFrom; m + CONFIG.maxWorkMin <= CONFIG.workEnd; m += CONFIG.startStep) out.push(hhmm(m));
  return out;
}

// Why a day is closed: 'sunday' (closed weekday), 'closed' (blocked by the owner), or null.
// `closedDates` holds the owner's blocked days, as an array or a { date: … } object.
export function closedReason(date, closedDates = []) {
  if (CONFIG.closedWeekdays.includes(weekday(date))) return 'sunday';
  const blocked = Array.isArray(closedDates) ? closedDates.includes(date) : Boolean(closedDates[date]);
  return blocked ? 'closed' : null;
}

// The first open day on or after `date`.
export function nextOpenDay(date, closedDates = []) {
  let d = date;
  while (closedReason(d, closedDates)) d = addDays(d, 1);
  return d;
}

// ---- Travel ----
// Stand-in until the Google Maps Routes API is connected (plan, decision 2): a rough one-way
// distance from the postcode. Returns null when the address has no postcode.
export function estimateKm(address) {
  const m = String(address || '').match(/\b(\d{4})\b/);
  if (!m) return null;
  const pc = Number(m[1]);
  if (pc >= 1000 && pc < 2500) return 5;
  if (pc >= 2500 && pc < 2800) return 9;
  if (pc >= 2800 && pc < 3000) return 14;
  return 30;
}
export const travelFee = (distanceKm) => (distanceKm == null ? null : Math.round(distanceKm * CONFIG.kmRate));

// ---- Price ----
// `distanceKm` comes from the route lookup (or the estimate); `carePlus` is true when the customer
// already holds Care Plus. Money is kept in whole kroner.
export function quote(serviceIds, { distanceKm = null, carePlus = false } = {}) {
  const sel = (Array.isArray(serviceIds) ? serviceIds : []).map(service).filter(Boolean);
  const oneOffs = sel.filter((s) => !s.monthly);
  const oneOff = oneOffs.reduce((a, s) => a + s.price, 0);
  // Combo: the Bike Check plus at least one other service. Repairs without the Bike Check are not
  // a combo. Care Plus: 5% off paid services, from the booking that starts the subscription on.
  const combo = oneOffs.some((s) => s.id === 'bike-check') && oneOffs.length > 1;
  const withCarePlus = carePlus || sel.some((s) => s.id === 'premium-monthly');
  let discountReason = null;
  if (oneOff > 0 && withCarePlus) discountReason = 'carePlus';
  else if (oneOff > 0 && combo) discountReason = 'combo';
  const discount = discountReason ? Math.round(oneOff * CONFIG[`${discountReason}Off`]) : 0;
  const monthly = sel.filter((s) => s.monthly).reduce((a, s) => a + s.price, 0);
  const travel = travelFee(distanceKm);
  // Work time is the sum of the chosen services; with nothing chosen yet, show times for a full visit.
  const workMin = sel.reduce((a, s) => a + s.durationMin, 0) || CONFIG.maxWorkMin;
  return {
    services: sel,
    workMin,
    blockMin: workMin + CONFIG.travelBufferMin,
    tooLong: workMin > CONFIG.maxWorkMin,
    needsNote: sel.some((s) => s.needsNote),
    oneOffCount: oneOffs.length,
    oneOff,
    discount,
    discountReason,
    monthly,
    distanceKm,
    travel,
    total: oneOff - discount + (travel || 0),
  };
}

// ---- Times ----
// Start times for a job of `workMin` minutes. `bookings` are that day's bookings that are not
// cancelled, each { arrival, blockMin }. A booking blocks its work plus the travel gap, so a start
// is free only if that whole stretch overlaps no other booking. Work must end by workEnd.
export function startTimes(workMin, bookings = []) {
  const busy = bookings.map((b) => [toMin(b.arrival), toMin(b.arrival) + (b.blockMin || CONFIG.maxWorkMin + CONFIG.travelBufferMin)]);
  const out = [];
  for (let m = CONFIG.openFrom; m + workMin <= CONFIG.workEnd; m += CONFIG.startStep) {
    const end = m + workMin + CONFIG.travelBufferMin;
    out.push({ time: hhmm(m), free: !busy.some(([s, e]) => m < e && s < end) });
  }
  return out;
}

// ---- Lead time and the Care Plus urgent visit ----
// A date inside the 2-day lead time; only a Care Plus member's urgent visit may use it.
export const isUrgentDate = (date, todayDate) => date < addDays(todayDate, CONFIG.minLeadDays);

// Whether this customer's urgent visit is still unused in `date`'s month. `urgentDates` are the
// dates of their urgent bookings that are not cancelled.
export const urgentAvailable = ({ carePlus, urgentDates = [] }, date) =>
  Boolean(carePlus) && !urgentDates.some((d) => d.slice(0, 7) === date.slice(0, 7));

// The earliest date this customer can pick: tomorrow for a Care Plus member with the urgent visit
// unused (and tomorrow open), otherwise 2 days ahead.
export function earliestDate({ todayDate, carePlus = false, urgentDates = [], closedDates = [] }) {
  const tomorrow = addDays(todayDate, CONFIG.urgentLeadDays);
  const urgentOk = !closedReason(tomorrow, closedDates) && urgentAvailable({ carePlus, urgentDates }, tomorrow);
  return urgentOk ? tomorrow : addDays(todayDate, CONFIG.minLeadDays);
}

// ---- Checks ----
export const isEmail = (s) => /^\S+@\S+\.\S+$/.test(String(s || '').trim());

// Checks shared by the booking form and createBooking. Errors are codes; pages translate them.
// ctx: { todayDate, closedDates, dayBookings (that day, not cancelled), carePlus, urgentDates }.
export function checkBooking(input, q, ctx) {
  const { todayDate, closedDates = [], dayBookings = [], carePlus = false, urgentDates = [] } = ctx;
  const errors = {};
  if (!q.services.length) errors.services = 'services';
  else if (q.tooLong) errors.services = 'tooLong';
  if (!isDate(input.date) || input.date < todayDate) errors.date = 'past';
  else if (closedReason(input.date, closedDates)) errors.date = closedReason(input.date, closedDates);
  else if (isUrgentDate(input.date, todayDate)) {
    // Inside the 2-day lead time only a Care Plus member's urgent visit is allowed, and not today.
    const tooSoon = input.date < addDays(todayDate, CONFIG.urgentLeadDays);
    if (tooSoon || !carePlus) errors.date = 'lead';
    else if (!urgentAvailable({ carePlus, urgentDates }, input.date)) errors.date = 'urgentUsed';
  }
  // A visit that is too long is reported on the services, so there is no start time to check.
  if (!q.tooLong) {
    const slot = isDate(input.date) && isTime(input.arrival) ? startTimes(q.workMin, dayBookings).find((s) => s.time === input.arrival) : null;
    if (!slot) errors.arrival = 'arrival';
    else if (!slot.free) errors.arrival = 'taken';
  }
  if (q.needsNote && !String(input.note || '').trim()) errors.note = 'note';
  if (!input.address || !input.name || !input.phone || !input.email) errors.form = 'contact';
  else if (!isEmail(input.email)) errors.form = 'email';
  else if (q.distanceKm == null) errors.form = 'address';
  else if (q.distanceKm > CONFIG.maxKm) errors.form = 'far';
  if ((input.photos || []).length > CONFIG.maxBookingPhotos) errors.photos = 'photosMax';
  return errors;
}

// The business consultation form. Returns an error code, or null when it is complete.
export function checkConsultation(input) {
  const need = ['name', 'company', 'email', 'phone', 'companyType', 'bikes'];
  if (need.some((k) => !String(input[k] || '').trim())) return 'missing';
  if (!isEmail(input.email)) return 'email';
  return null;
}

// When a new subscription's 3-month minimum ends.
export const commitmentEnds = (startDate) => addMonths(startDate, CONFIG.subscriptionMinMonths);
