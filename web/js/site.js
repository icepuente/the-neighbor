// Landing page: booking flow and consultation form.
// The page draws everything static from the shared rules (prices, services, plans) at once; free
// times, the earliest date, the price and the bookings themselves come from the Cloud Functions,
// so only the server's answer counts. Firebase loads in the background (js/firebase.js).
import * as R from './shared/booking-rules.js';

const { $, h, A, t } = UI;
const { CONFIG, SERVICES, PLANS } = R;
const dkk = I18N.dkk;
const fmtDate = I18N.date;
const svcName = I18N.svc;
const priceLabel = (s) => dkk(s.price) + (s.monthly ? ` ${t('perMonth')}` : '');

// ---- Cloud Functions ----
const firebaseReady = import('./firebase.js');
async function callFn(name, data) {
  const { NBF } = await firebaseReady;
  const res = await NBF.sdk.functions.httpsCallable(NBF.functions, name)(data);
  return res.data;
}

// ---- Business plan cards ----
for (const p of PLANS) {
  const card = h('div', 'paper plan');
  const price = h('p', 'price', `${dkk(p.pricePerBike)} `);
  price.appendChild(h('small', '', t('biz.perBike')));
  const ul = h('ul');
  for (const n of [1, 2, 3]) ul.appendChild(h('li', '', t(`plan.${p.id}.${n}`)));
  A(card, h('p', 'tagline', t(`plan.${p.id}.tag`)), h('h3', '', p.name), price, ul);
  $('plan-cards').appendChild(card);
}

// Price plus the owner's time estimate, e.g. "199 kr. · ca. 20–25 min."
const svcDetail = (s) => priceLabel(s) + (s.mins ? ` · ${t('svc.time', { m: s.mins })}` : '');

// ---- Private service cards (one-off services) ----
for (const s of SERVICES.filter((x) => !x.monthly)) {
  const a = h('a');
  a.href = '#book';
  a.dataset.pre = s.id;
  const sub = [t('svc.time', { m: s.mins }), s.tubeIncluded ? t('svc.tubeIncl') : null].filter(Boolean).join(' · ');
  A(a, h('b', '', svcName(s)), h('p', 'price', dkk(s.price)), h('span', '', sub));
  $('svc-cards').appendChild(a);
}

// ---- Subscription cards: The Neighbor Care and Care Plus ----
for (const id of ['monthly', 'premium-monthly']) {
  const s = R.service(id);
  const card = h('div', 'paper plan');
  const price = h('p', 'price', `${dkk(s.price)} `);
  price.appendChild(h('small', '', t('perMonth')));
  const ul = h('ul');
  for (let i = 1; i <= 4; i++) ul.appendChild(h('li', '', t(`care.${id}.${i}`)));
  const pick = h('a', 'pill', t('care.pick', { name: svcName(s) }));
  pick.href = '#book';
  pick.dataset.pre = id;
  A(card, h('h3', '', svcName(s)), price, ul, pick);
  $('care-cards').appendChild(card);
}

// ---- Booking form ----
for (const s of SERVICES) {
  const l = h('label', 'chk');
  const input = h('input');
  input.type = 'checkbox';
  input.name = 'svc';
  input.value = s.id;
  const span = h('span', '', svcName(s));
  span.appendChild(h('small', '', svcDetail(s)));
  A(l, input, span);
  $('svcs').appendChild(l);
}
const chosen = () => [...document.querySelectorAll('input[name=svc]:checked')].map((x) => x.value);
$('svcs').addEventListener('change', () => {
  const names = chosen().map((id) => svcName(R.service(id)));
  $('saccv').textContent = names.length ? names.join(', ') : t('bk.selectServices');
  // Say straight away when the chosen services do not fit in one visit.
  $('e-services').textContent = R.quote(chosen()).tooLong ? t('err.tooLong') : '';
  renderSlots();
});
const toggle = (btn, panel) => {
  btn.onclick = () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  };
};
toggle($('sacc'), $('svcs'));
toggle($('acc'), $('slots'));

// Bike type. (A signed-in customer's saved bikes come with accounts, phase 3.)
const bikeSel = $('bike');
for (const k of ['city', 'road', 'mtb', 'e', 'cargo']) bikeSel.appendChild(new Option(t(`bike.${k}`), t(`bike.${k}`)));

// The earliest date: 2 days ahead, until the server says otherwise.
const dateIn = $('date');
let options = { today: R.today(), earliest: R.addDays(R.today(), CONFIG.minLeadDays) };
dateIn.min = options.earliest;

// Why a date cannot be booked, from the server's answer, or null.
function dateError(date, o) {
  if (date < o.today) return 'past';
  if (o.closed) return o.closed;
  if (date < o.earliest) return 'lead';
  return null;
}

// Start times come from the server: they depend on the day's bookings and the chosen services.
// Only the latest request's answer is drawn, however the answers arrive.
let slotRequest = 0;
async function renderSlots() {
  const box = $('slots');
  const mine = ++slotRequest;
  box.textContent = '';
  $('accv').textContent = t('bk.selectTime');
  $('e-date').textContent = '';
  const q = R.quote(chosen());
  if (!dateIn.value || q.tooLong) return;
  box.appendChild(h('p', 'det', t('bk.loadingTimes')));
  let o;
  try {
    o = await callFn('bookingOptions', { date: dateIn.value, serviceIds: chosen() });
  } catch {
    if (mine === slotRequest) { box.textContent = ''; $('e-date').textContent = t('err.server'); }
    return;
  }
  if (mine !== slotRequest) return;
  options = o;
  dateIn.min = o.earliest;
  box.textContent = '';
  const err = dateError(dateIn.value, o);
  $('e-date').textContent = err ? t(`err.${err}`) : '';
  if (err) return;
  if (!o.times.some((s) => s.free)) box.appendChild(h('p', 'det', t('bk.noTimes')));
  for (const s of o.times) {
    const l = h('label', 'slot');
    const input = h('input');
    input.type = 'radio';
    input.name = 'slot';
    input.value = s.time;
    input.disabled = !s.free;
    A(l, input, h('span', '', s.time));
    box.appendChild(l);
  }
}
// Ask the server for today's date and the earliest bookable day as soon as Firebase is up.
callFn('bookingOptions', {}).then((o) => { options = { ...options, ...o }; dateIn.min = o.earliest; }).catch(() => {});

dateIn.addEventListener('change', () => {
  renderSlots();
  $('acc').setAttribute('aria-expanded', 'true');
  $('slots').hidden = false;
});
$('slots').addEventListener('change', (e) => {
  $('accv').textContent = e.target.value;
  $('acc').setAttribute('aria-expanded', 'false');
  $('slots').hidden = true;
});

// Contact details from "Remember me" on this device.
const REMEMBER_KEY = 'neighbor-remember';
let remembered = null;
try { remembered = JSON.parse(localStorage.getItem(REMEMBER_KEY)); } catch { remembered = null; }
if (remembered) {
  $('name').value = remembered.name || '';
  $('tel').value = remembered.phone || '';
  $('email').value = remembered.email || '';
  $('addr').value = remembered.address || '';
  $('remember').checked = true;
}

// Photos of the bike or the problem: shrunk in the browser (which also drops GPS data), with a
// small thumbnail, and uploaded only when the customer confirms.
const bookingPhotos = UI.photoPicker({ max: CONFIG.maxBookingPhotos, id: 'bk-photo-input', full: 1600, quality: 0.8, thumb: 320 });
$('bk-photos').appendChild(bookingPhotos.el);

// Uploads the photos to this visitor's own folder; createBooking then moves them to the booking.
// Storage only accepts uploads from a signed-in user, so a guest is signed in anonymously first
// (invisible to them). The rules allow creating a file but not replacing it, so photos already sent
// (before a refused booking) are not sent again.
const uploaded = new Set();
async function uploadPhotos(photos) {
  const { NBF } = await firebaseReady;
  const { auth: fbAuth, storage: fbStorage } = NBF.sdk;
  const user = NBF.auth.currentUser || (await fbAuth.signInAnonymously(NBF.auth)).user;
  const put = async (path, dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    await fbStorage.uploadBytes(fbStorage.ref(NBF.storage, path), blob, { contentType: 'image/jpeg' });
  };
  const sendOne = (p) => Promise.all([put(`uploads/${user.uid}/${p.id}.jpg`, p.data), put(`uploads/${user.uid}/${p.id}_thumb.jpg`, p.thumb)])
    .then(() => uploaded.add(p.id));
  await Promise.all(photos.filter((p) => !uploaded.has(p.id)).map(sendOne));
  return photos.map(({ id, w, h }) => ({ id, w, h }));
}

let draft = null;
let quote = null;
const ERR = ['services', 'date', 'arrival', 'note', 'photos', 'form'];
const showErrors = (errors) => { for (const k of ERR) $(`e-${k}`).textContent = errors[k] ? t(`err.${errors[k]}`) : ''; };
function show(id) {
  for (const x of ['f', 'co', 'done']) $(x).hidden = x !== id;
  $(id).scrollIntoView({ block: 'nearest' });
}

$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const slot = document.querySelector('input[name=slot]:checked');
  draft = {
    serviceIds: chosen(),
    date: dateIn.value,
    arrival: slot ? slot.value : '',
    bike: bikeSel.value,
    address: $('addr').value.trim(),
    name: $('name').value.trim(),
    phone: $('tel').value.trim(),
    email: $('email').value.trim(),
    note: $('note').value.trim(),
    photos: bookingPhotos.get(),
  };
  // The same checks the server runs, for a quick answer. Whether the time is still free, and the
  // exact price, come from the server.
  const local = R.quote(draft.serviceIds, { distanceKm: R.estimateKm(draft.address) });
  const errors = R.checkBooking(draft, local, { todayDate: options.today });
  if (!errors.date && draft.date && draft.date < options.earliest) errors.date = 'lead';
  showErrors(errors);
  if (Object.keys(errors).length) return;
  try {
    quote = await callFn('quoteBooking', { serviceIds: draft.serviceIds, address: draft.address });
  } catch {
    $('e-form').textContent = t('err.server');
    return;
  }
  renderCheckout();
  show('co');
});

function renderCheckout() {
  const q = quote;
  $('codet').textContent = `${t('dateAt', { date: fmtDate(draft.date), time: draft.arrival })} · ${draft.bike} · ${draft.address}`;
  const tb = $('tbl');
  tb.textContent = '';
  const add = (a, b, cls) => {
    const r = tb.insertRow();
    if (cls) r.className = cls;
    r.insertCell().textContent = a;
    r.insertCell().textContent = b;
    return r;
  };
  for (const s of q.services) add(svcName(s), priceLabel(s));
  if (q.discount) add(t(`co.discount.${q.discountReason}`), `−${dkk(q.discount)}`);
  const rulesBtn = h('button', 'lnk', t('co.travel'));
  rulesBtn.type = 'button';
  rulesBtn.onclick = openRules;
  const tr = tb.insertRow();
  tr.insertCell().appendChild(rulesBtn);
  tr.insertCell().textContent = t('co.travelVal', { amount: dkk(q.travel), km: q.distanceKm });
  const parts = [dkk(q.total)];
  if (q.monthly) parts.push(`${dkk(q.monthly)} ${t('perMonth')}`);
  add(t('co.total'), parts.join(' + '), 'tot');

  const notes = $('notes');
  notes.textContent = '';
  const note = (x) => notes.appendChild(h('div', 'note', x));
  note(t('co.visit', { min: q.workMin }));
  if (draft.photos.length) {
    notes.appendChild(h('p', 'det', t('pics.attached', { n: draft.photos.length })));
    notes.appendChild(UI.gallery(draft.photos));
  }
  if (R.isUrgentDate(draft.date, options.today)) note(t('co.urgent'));
  if (!q.discount && q.oneOffCount === 1 && q.services.some((s) => s.id === 'bike-check')) note(t('co.noteCombo'));
  if (q.monthly) note(t('care.terms'));
  notes.appendChild(h('p', 'det', t('co.estimateTravel')));
  $('e-confirm').textContent = '';
}

$('back').onclick = () => show('f');

$('confirm').onclick = async () => {
  // The terms and the early start of work, ticked here; the server checks the same.
  const accept = { terms: $('acc-terms').checked, earlyStart: $('acc-start').checked };
  const notAccepted = R.checkAcceptance(accept);
  if (notAccepted) {
    $('e-confirm').textContent = t(`err.accept.${notAccepted}`);
    return;
  }
  const btn = $('confirm');
  btn.disabled = true;
  let res;
  try {
    let photos;
    try {
      photos = await uploadPhotos(draft.photos);
    } catch {
      $('e-confirm').textContent = t('err.photos');
      return;
    }
    res = await callFn('createBooking', { input: { ...draft, photos }, accept });
  } catch {
    $('e-confirm').textContent = t('err.server');
    return;
  } finally {
    btn.disabled = false;
  }
  if (res.errors?.accept) {
    $('e-confirm').textContent = t(`err.accept.${res.errors.accept}`);
    return;
  }
  if (res.errors) {
    showErrors(res.errors);
    if (res.errors.arrival) renderSlots();
    show('f');
    return;
  }
  const b = res.booking;
  if ($('remember').checked) {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ name: draft.name, phone: draft.phone, email: draft.email, address: draft.address }));
  } else {
    localStorage.removeItem(REMEMBER_KEY);
  }
  $('done-msg').textContent = t('done.msg', { ref: b.ref, email: b.email });
  $('sum').textContent = [
    ...quote.services.map((s) => `${svcName(s)}: ${priceLabel(s)}`),
    b.pricing.discount ? `${t(`co.discount.${b.pricing.discountReason}`)}: −${dkk(b.pricing.discount)}` : null,
    `${t('co.travel')}: ${t('co.travelVal', { amount: dkk(b.pricing.travel), km: quote.distanceKm })}`,
    `${t('sum.total')}: ${dkk(b.pricing.total)}`,
    '',
    `${t('sum.date')}: ${fmtDate(b.date)}`,
    `${t('sum.arrival')}: ${b.arrival}`,
    `${t('sum.bike')}: ${draft.bike}`,
    `${t('sum.address')}: ${draft.address}`,
    `${t('sum.notes')}: ${draft.note || '–'}`,
    b.photos ? t('pics.attached', { n: b.photos }) : null,
  ].filter((x) => x != null).join('\n');
  show('done');
};

$('again').onclick = () => location.reload();

// ---- Travel rules dialog ----
let lastFocus = null;
function openRules() {
  lastFocus = document.activeElement;
  const rl = $('rl');
  rl.textContent = '';
  for (const x of [
    t('rules.rate', { rate: String(CONFIG.kmRate).replace('.', I18N.lang === 'da' ? ',' : '.'), base: CONFIG.base }),
    t('rules.max', { max: CONFIG.maxKm }),
    t('rules.exact'),
  ]) rl.appendChild(h('li', '', x));
  $('rules').hidden = false;
  $('rclose').focus();
}
function closeRules() {
  $('rules').hidden = true;
  if (lastFocus) lastFocus.focus();
}
$('rclose').onclick = closeRules;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('rules').hidden) closeRules();
});

// Service buttons preselect a service; the public-fleet link preselects a company type.
document.addEventListener('click', (e) => {
  const pre = e.target.closest('[data-pre]');
  if (pre) {
    const c = document.querySelector(`input[name=svc][value="${pre.dataset.pre}"]`);
    if (c && !c.checked) {
      c.checked = true;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    }
    $('sacc').setAttribute('aria-expanded', 'true');
    $('svcs').hidden = false;
    show('f');
  }
  const ct = e.target.closest('[data-ctype]');
  if (ct) $('ctype').value = ct.dataset.ctype;
});

// ---- Business consultation ----
const fill = (id, list, placeholder, label = (x) => x) => {
  const el = $(id);
  el.appendChild(new Option(placeholder, ''));
  for (const x of list) el.appendChild(new Option(label(x), x));
};
// Stored values stay English (the owner's dashboard is English); labels follow the page language.
fill('ctype', ['Hotel', 'Hostel', 'Bike rental', 'Property management', 'Office', 'Tourism company', 'Municipality / public organization', 'Other'],
  t('f.select'), (x) => t(`ctype.${x}`));
fill('cnum', ['1', '2–5', '6–15', '16–35', '35+'], t('f.select'));
fill('ctime', R.arrivalTimes(), t('f.noPref'));
$('cdate').min = R.today();

$('cf').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = (id) => $(id).value.trim();
  const input = {
    name: v('cname'), company: v('ccomp'), email: v('cemail'), phone: v('ctel'), companyType: v('ctype'),
    bikes: v('cnum'), preferredDate: v('cdate'), preferredTime: v('ctime'), message: v('cmsg'),
  };
  // A quick check here; the server checks again.
  const local = R.checkConsultation(input);
  if (local) { $('e-c').textContent = t(`cf.err.${local}`); return; }
  let res;
  try {
    res = await callFn('createConsultation', { input });
  } catch {
    $('e-c').textContent = t('err.server');
    return;
  }
  $('e-c').textContent = res.error ? t(`cf.err.${res.error}`) : '';
  if (res.error) return;
  $('cok-msg').textContent = t('cf.doneMsg', { name: input.name, email: input.email });
  $('csum').textContent = [
    `${t('sum.company')}: ${input.company} (${t(`ctype.${input.companyType}`)})`,
    `${t('sum.bikes')}: ${input.bikes}`,
    `${t('sum.pref')}: ${input.preferredDate ? fmtDate(input.preferredDate) : '–'} ${input.preferredTime || ''}`,
    `${t('sum.message')}: ${input.message || '–'}`,
  ].join('\n');
  $('cf').hidden = true;
  $('cdone').hidden = false;
  $('cdone').scrollIntoView({ block: 'nearest' });
});
$('cagain').onclick = () => {
  $('cf').reset();
  $('cdone').hidden = true;
  $('cf').hidden = false;
};
