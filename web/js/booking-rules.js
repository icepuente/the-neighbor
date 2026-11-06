// The Neighbor's booking rules: services, prices, opening hours and the checks on the booking form.
// Used by the page (js/landing.js), the booking API (api/, which re-checks every request with these
// same rules and recomputes the price) and the tests (test/).
//
// A booking is a request: the site's server emails it to the owner with a copy to the customer (see
// requestEmail below), or, if that fails, the customer emails it from their own mail program. The
// owner confirms the time by replying. Nothing is stored. So these rules only guide the customer:
// they cannot know which times are already taken, and the owner has the last word.
//
// Dates are 'YYYY-MM-DD' strings in Copenhagen time, and times are 'HH:MM'.

export const TIME_ZONE = 'Europe/Copenhagen';

export const CONFIG = {
  businessName: 'The Neighbor',
  base: 'Rørsangervej 45, København',
  // Where booking requests go, and the phone shown next to it (null: no phone shown).
  // scripts/deploy.sh refuses to publish while the email is still an example.com placeholder.
  contact: { email: 't.volodymyr22@gmail.com', phone: '29 61 93 72' },
  // Shows the demo bar at the top of the page (off since the site went live on theneighbor.dk).
  demo: false,
  // Danish address suggestions under the street field (js/address.js). They come from /api/address,
  // which nginx passes on to Klimadatastyrelsen's Adressevælger (deploy/nginx/default.conf), so
  // this only works on the home server: turn it off before moving to Cloudflare Pages
  // (scripts/build-pages.js refuses to build while it is on). The privacy policy's sentence about
  // it shows only while it is on.
  addressSuggest: true,
  // Travel: 2.5 DKK per km, one way, from the base; addresses beyond 18 km are refused.
  kmRate: 2.5,
  maxKm: 18,
  // Everyone books at least 2 days ahead.
  minLeadDays: 2,
  // Open Monday to Saturday. Work starts from 08:30 and must be finished by 15:30.
  openFrom: 8 * 60 + 30,
  workEnd: 15 * 60 + 30,
  startStep: 30,
  closedWeekdays: [0],
  // Single days the owner is closed (holidays, sick days), as 'YYYY-MM-DD'. The calendar greys them out.
  closedDates: [],
  // A visit takes at most 45 minutes of work.
  maxWorkMin: 45,
  // The longest note the request email carries (some mail programs refuse mailto: links over about
  // 2,000 characters; test/booking-rules.test.js checks a long request stays under that).
  maxNote: 300,
};

// The owner's repair services (2026-10-13 list, repairs only since 2026-10-23; Diagnostics became
// Bike Service / Eftersyn and Other Repair was added the same day). durationMin is the top of the
// owner's range, so a visit never runs short; `mins` is the range shown to customers.
export const SERVICES = [
  { id: 'puncture', name: 'Puncture Fix', da: 'Punkteringsreparation', price: 199, durationMin: 20, mins: '15–20', tubeIncluded: true },
  { id: 'brakes', name: 'Brake Adjustment', da: 'Bremsejustering', price: 129, durationMin: 15, mins: '15' },
  { id: 'gears', name: 'Gear Adjustment', da: 'Gearjustering', price: 129, durationMin: 15, mins: '15' },
  { id: 'chain', name: 'Chain Service', da: 'Kædeservice', price: 149, durationMin: 15, mins: '15' },
  { id: 'service', name: 'Bike Service', da: 'Eftersyn', price: 299, durationMin: 20, mins: '15–20' },
  // Anything else: the customer describes it in the comment field, and the owner gives the price
  // (price: null, "by agreement") and the time in the reply. 20 minutes are held for it meanwhile.
  { id: 'other', name: 'Other Repair', da: 'Anden reparation', price: null, durationMin: 20, mins: null, needsNote: true },
];
export const service = (id) => SERVICES.find((s) => s.id === id);

// ---- Dates (calendar arithmetic in UTC, so the machine's time zone never matters) ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
export const isDate = (s) => typeof s === 'string' && DATE_RE.test(s);
export const isTime = (s) => typeof s === 'string' && TIME_RE.test(s);

// An email address the owner can reply to: plain ASCII, one address, no display name, no spaces,
// commas, angle brackets or line breaks (so it is safe as a Reply-To). Internationalised addresses
// are refused; the visitor can still book by phone or from their own mail program.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s) && !s.includes('..') && !/^\.|\.@/.test(s);

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
export const weekday = (date) => atNoon(date).getUTCDay();
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Why a day is closed: 'sunday' (closed weekday), 'closed' (blocked by the owner), or null.
export function closedReason(date, closedDates = CONFIG.closedDates) {
  if (CONFIG.closedWeekdays.includes(weekday(date))) return 'sunday';
  return closedDates.includes(date) ? 'closed' : null;
}

// The first open day on or after `date`.
export function nextOpenDay(date, closedDates = CONFIG.closedDates) {
  let d = date;
  while (closedReason(d, closedDates)) d = addDays(d, 1);
  return d;
}

// The earliest date a customer can ask for: 2 days ahead.
export const earliestDate = (todayDate) => addDays(todayDate, CONFIG.minLeadDays);

// ---- Travel ----
// A rough one-way distance from the postcode, until exact driving distance is worth adding. The
// price page says it is an estimate; the owner confirms the price in the reply. Returns null when
// the postcode is not 4 digits.
export function estimateKm(postcode) {
  const s = String(postcode || '').trim();
  if (!/^\d{4}$/.test(s)) return null;
  const pc = Number(s);
  if (pc >= 1000 && pc < 2500) return 5;
  if (pc >= 2500 && pc < 2800) return 9;
  if (pc >= 2800 && pc < 3000) return 14;
  return 30;
}
export const travelFee = (distanceKm) => (distanceKm == null ? null : Math.round(distanceKm * CONFIG.kmRate));

// The address written the Danish way: 'Jagtvej 10' + '2200' + '2. tv.' -> 'Jagtvej 10, 2. tv., 2200'.
// Floor and door are optional (and may also have been typed into the street field).
export function fullAddress(street, postcode, apartment = '') {
  const part = (s) => String(s || '').trim().replace(/,+$/, '');
  return [part(street), part(apartment), part(postcode)].filter(Boolean).join(', ');
}

// An address suggestion's title split for the form: 'Jagtvej 100, 2200 København N' ->
// { street: 'Jagtvej 100', postcode: '2200' }. Titles without a postcode keep it empty.
export function splitAddress(title) {
  const m = String(title || '').trim().match(/^(.*?),\s*(\d{4})(?:\s.*)?$/);
  return m ? { street: m[1].trim(), postcode: m[2] } : { street: String(title || '').trim(), postcode: '' };
}

// ---- Price ----
// Money is whole kroner. Spare parts are never included, nor is an Other Repair (priced by the
// owner later): `byAgreement` says one was chosen, and the totals leave it out.
export function quote(serviceIds, { distanceKm = null } = {}) {
  const sel = (Array.isArray(serviceIds) ? serviceIds : []).map(service).filter(Boolean);
  const services = sel.reduce((a, s) => a + (s.price ?? 0), 0);
  const travel = travelFee(distanceKm);
  // Work time is the sum of the chosen services; with nothing chosen yet, show times for a full visit.
  const workMin = sel.reduce((a, s) => a + s.durationMin, 0) || CONFIG.maxWorkMin;
  return {
    services: sel,
    workMin,
    tooLong: workMin > CONFIG.maxWorkMin,
    needsNote: sel.some((s) => s.needsNote),
    byAgreement: sel.some((s) => s.price == null),
    servicesTotal: services,
    distanceKm,
    travel,
    total: services + (travel || 0),
  };
}

// ---- Times ----
// The start times for a visit of `workMin` minutes: every half hour from 08:30, with the work
// finished by 15:30. Which of them are free is for the owner to say.
export function startTimes(workMin) {
  const out = [];
  for (let m = CONFIG.openFrom; m + workMin <= CONFIG.workEnd; m += CONFIG.startStep) out.push(hhmm(m));
  return out;
}

// ---- Checks ----
// The booking form's checks. Errors are codes, keyed by the field they belong to; the page
// translates them. input: { date, arrival, street, apartment, postcode, name, phone, email, note }.
export function checkRequest(input, q, { todayDate, closedDates = CONFIG.closedDates }) {
  const errors = {};
  if (!q.services.length) errors.services = 'services';
  else if (q.tooLong) errors.services = 'tooLong';
  if (!isDate(input.date) || input.date < todayDate) errors.date = isDate(input.date) ? 'past' : 'date';
  else if (closedReason(input.date, closedDates)) errors.date = closedReason(input.date, closedDates);
  else if (input.date < earliestDate(todayDate)) errors.date = 'lead';
  // A visit that is too long is reported on the services, so there is no start time to check.
  if (!q.tooLong && !(isTime(input.arrival) && startTimes(q.workMin).includes(input.arrival))) errors.arrival = 'arrival';
  if (!isEmail(String(input.email || '').trim())) errors.email = 'email';
  if (q.needsNote && !String(input.note || '').trim()) errors.note = 'note';
  else if (String(input.note || '').length > CONFIG.maxNote) errors.note = 'noteLong';
  if (!String(input.street || '').trim() || !String(input.postcode || '').trim() || !String(input.name || '').trim() || !String(input.phone || '').trim()) errors.form = 'contact';
  else if (q.distanceKm == null) errors.form = 'postcode';
  else if (q.distanceKm > CONFIG.maxKm) errors.form = 'far';
  return errors;
}

// What the customer ticks on the price page before sending: { terms, earlyStart }. Returns an error
// code, or null when both are ticked.
// - terms: they accept the terms and conditions.
// - earlyStart: they ask for the work to be done within the 14-day withdrawal period, and
//   acknowledge that the right of withdrawal ends once the work is fully done. Without this the
//   right would not end on completion (forbrugeraftaleloven § 18, stk. 2, nr. 2). Both sentences
//   go into the request email, so the customer's own email records them.
export function checkAcceptance(accept) {
  if (accept?.terms !== true) return 'terms';
  if (accept?.earlyStart !== true) return 'earlyStart';
  return null;
}

// ---- The request email ----
// The email the owner receives: sent by the API (api/mail.js), or, as a fallback, opened in the
// customer's mail program as a mailto: link. `t` translates (the page's I18N.t), `fmt` formats
// { dkk(n), date(d) } in the page language, and `svcName` names a service. Returns
// { subject, body } (body lines end in CRLF, as RFC 6068 asks for in mailto: links).
// The subject is made of the services, date and time only, never of anything the visitor typed.
export function requestEmail(r, q, { t, fmt, svcName }) {
  const price = (s) => (s.price == null ? t('byAgreement') : fmt.dkk(s.price));
  const travel = { travel: fmt.dkk(q.travel), km: q.distanceKm };
  const lines = [
    t('mail.hello'),
    '',
    t('mail.intro'),
    '',
    `${t('mail.services')}: ${q.services.map((s) => `${svcName(s)} (${price(s)})`).join(', ')}`,
    `${t('mail.date')}: ${fmt.date(r.date)}`,
    `${t('mail.time')}: ${t('mail.timeVal', { time: r.arrival, min: q.workMin })}`,
    `${t('mail.bike')}: ${r.bike}`,
    `${t('mail.address')}: ${fullAddress(r.street, r.postcode, r.apartment)}`,
    `${t('mail.name')}: ${r.name}`,
    `${t('mail.phone')}: ${r.phone}`,
    ...(r.email ? [`${t('mail.email')}: ${r.email}`] : []),
    `${t('mail.note')}: ${r.note || '–'}`,
    '',
    // Only an Other Repair chosen: there is no price yet but the travel.
    q.servicesTotal ? t('mail.price', { ...travel, services: fmt.dkk(q.servicesTotal), total: fmt.dkk(q.total) }) : t('mail.priceTravel', travel),
    ...(q.byAgreement ? [t('mail.other')] : []),
    '',
    `- ${t('co.acceptTerms')}.`,
    `- ${t('co.earlyStart')}`,
    '',
    t('mail.bye'),
    r.name,
  ];
  const svcList = q.services.map(svcName).join(', ');
  return {
    subject: t('mail.subject', { services: svcList, date: fmt.date(r.date), time: r.arrival }),
    body: lines.join('\r\n'),
  };
}

// The mailto: link for a request.
export const mailtoLink = (to, { subject, body }) =>
  `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
