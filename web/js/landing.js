// The front page (index.html): service cards and the booking form.
//
// The form checks the request and shows the price. "Send" posts it to the site's API
// (POST /api/request, api/), which checks it again and emails it to the owner with a copy to the
// customer; nothing is stored. If the API cannot send it (not set up, busy, down, or the visitor
// is offline), the page falls back to the customer's own mail program: a mailto: link with the same
// email, and the text to copy. The owner confirms the time by replying. While CONFIG.addressSuggest
// is on, what is typed in the street field also goes to /api/address for suggestions (nothing else,
// and nothing is kept).
import * as R from './booking-rules.js';
import { attachDatePicker } from './datepicker.js';
import { attachAddressSuggest } from './address.js';

const { $, h, A, t } = UI;
const { CONFIG, SERVICES } = R;
const dkk = I18N.dkk;
const fmtDate = I18N.date;
const svcName = I18N.svc;
const TO = CONFIG.contact.email;

// ---- Demo bar and contact details ----
if (CONFIG.demo) {
  $('demo-bar').textContent = t('demo.bar', { email: TO });
  $('demo-bar').hidden = false;
}
const mailLink = h('a', '', TO);
mailLink.href = `mailto:${TO}`;
$('foot-mail').append(mailLink);
if (CONFIG.contact.phone) $('foot-mail').append(` · ${CONFIG.contact.phone}`);

// ---- Hero and service cards ----
const puncture = R.service('puncture');
$('hero-puncture-sub').textContent = `${dkk(puncture.price)} · ${t('svc.tubeIncl')}`;
const fixedPrices = SERVICES.filter((s) => s.price != null).map((s) => s.price);
$('hero-repairs-sub').textContent = t('hero.repairsSub', { price: dkk(Math.min(...fixedPrices)) });

// A service's price, or "Pris efter aftale" for an Other Repair; its time estimate, when it has one.
const priceText = (s) => (s.price == null ? t('byAgreement') : dkk(s.price));
const timeText = (s) => (s.mins ? t('svc.time', { m: s.mins }) : null);
// Price plus the owner's time estimate, e.g. "199 kr. · ca. 15–20 min."
const svcDetail = (s) => [priceText(s), timeText(s)].filter(Boolean).join(' · ');

for (const s of SERVICES) {
  const a = h('a');
  a.href = '#book';
  a.dataset.pre = s.id;
  const sub = [timeText(s), s.tubeIncluded ? t('svc.tubeIncl') : null, t(`svc.${s.id}.what`)].filter(Boolean).join(' · ');
  A(a, h('b', '', svcName(s)), h('p', s.price == null ? 'price soft' : 'price', priceText(s)), h('span', '', sub));
  $('svc-cards').appendChild(a);
}

// ---- Booking form: services ----
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
$('sacc').onclick = () => {
  const open = $('sacc').getAttribute('aria-expanded') === 'true';
  $('sacc').setAttribute('aria-expanded', String(!open));
  $('svcs').hidden = open;
};

const bikeSel = $('bike');
for (const k of ['city', 'road', 'mtb', 'e', 'cargo']) bikeSel.appendChild(new Option(t(`bike.${k}`), t(`bike.${k}`)));

// ---- Date and time ----
// The calendar starts 2 days ahead; Sundays and the owner's closed days cannot be picked.
const TODAY = R.today();
const dateIn = $('date');
dateIn.min = R.earliestDate(TODAY);
attachDatePicker(dateIn, {
  locale: I18N.lang === 'da' ? 'da-DK' : 'en-GB',
  labels: { choose: t('bk.selectDate'), prev: t('cal.prev'), next: t('cal.next'), unavailable: t('cal.unavailable') },
  today: () => TODAY,
  earliest: () => R.earliestDate(TODAY),
  unavailable: (date) => R.closedReason(date),
});

// Why a date cannot be asked for, or null.
function dateError(date) {
  if (date < TODAY) return 'past';
  return R.closedReason(date) || (date < R.earliestDate(TODAY) ? 'lead' : null);
}

// The start times that fit the chosen services. Which are free is for the owner to say, so all of
// them can be picked; the reply confirms the time.
function renderSlots() {
  const box = $('slots');
  const before = document.querySelector('input[name=slot]:checked')?.value;
  box.textContent = '';
  const q = R.quote(chosen());
  $('times').hidden = !dateIn.value;
  const err = dateIn.value ? dateError(dateIn.value) : null;
  $('e-date').textContent = err ? t(`err.${err}`) : '';
  if (!dateIn.value || err) return;
  if (q.tooLong) { box.appendChild(h('p', 'det', t('err.tooLong'))); return; }
  for (const time of R.startTimes(q.workMin)) {
    const l = h('label', 'slot');
    const input = h('input');
    input.type = 'radio';
    input.name = 'slot';
    input.value = time;
    input.checked = time === before;
    A(l, input, h('span', '', time));
    box.appendChild(l);
  }
}
dateIn.addEventListener('change', renderSlots);

// ---- Address suggestions ----
// Picking one fills in the street and the postcode (so the travel price follows), then moves on to
// floor and door. Free text still works, and a failed lookup simply shows no suggestions.
if (CONFIG.addressSuggest) {
  attachAddressSuggest($('street'), {
    label: t('bk.suggestions'),
    search: async (q) => {
      const res = await fetch(`/api/address?${new URLSearchParams({ q })}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.fund || []).filter((f) => typeof f.titel === 'string').map((f) => ({ id: f.id, text: f.titel }));
    },
    onPick: (title) => {
      const { street, postcode } = R.splitAddress(title);
      $('street').value = street;
      if (postcode) $('postcode').value = postcode;
      $('apartment').focus();
    },
  });
}

// ---- Price page ----
let draft = null;
let quote = null;
let mail = null;
const ERR = ['services', 'date', 'arrival', 'email', 'note', 'form'];
const showErrors = (errors) => { for (const k of ERR) $(`e-${k}`).textContent = errors[k] ? t(`err.${errors[k]}`) : ''; };
function show(id) {
  for (const x of ['f', 'co', 'sent', 'done']) $(x).hidden = x !== id;
  // 'start', under the sticky header (scroll-padding-top): on a phone each panel is taller than the
  // screen, and 'nearest' left the visitor half-way down it, past the price.
  $(id).scrollIntoView({ block: 'start' });
}

$('f').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = (id) => $(id).value.trim();
  draft = {
    serviceIds: chosen(),
    date: dateIn.value,
    arrival: document.querySelector('input[name=slot]:checked')?.value || '',
    bike: bikeSel.value,
    street: v('street'),
    apartment: v('apartment'),
    postcode: v('postcode'),
    name: v('name'),
    phone: v('tel'),
    email: v('email'),
    note: v('note'),
  };
  quote = R.quote(draft.serviceIds, { distanceKm: R.estimateKm(draft.postcode) });
  const errors = R.checkRequest(draft, quote, { todayDate: TODAY });
  showErrors(errors);
  if (Object.keys(errors).length) {
    // Move to the first field with a problem.
    const first = ERR.find((k) => errors[k]);
    $(`e-${first}`).scrollIntoView({ block: 'center' });
    return;
  }
  renderCheckout();
  show('co');
});

function renderCheckout() {
  const q = quote;
  $('codet').textContent = `${t('dateAt', { date: fmtDate(draft.date), time: draft.arrival })} · ${draft.bike} · ${R.fullAddress(draft.street, draft.postcode, draft.apartment)}`;
  const tb = $('tbl');
  tb.textContent = '';
  // The amounts may wrap on a phone, but never inside "199 kr." or "5 km".
  const keep = (s) => s.replace(/(\d) (?=kr\.|DKK|km)/g, '$1 ');
  const add = (a, b, cls) => {
    const r = tb.insertRow();
    if (cls) r.className = cls;
    r.insertCell().textContent = a;
    r.insertCell().textContent = keep(b);
  };
  for (const s of q.services) add(svcName(s), priceText(s));
  const rulesBtn = h('button', 'lnk', t('co.travel'));
  rulesBtn.type = 'button';
  rulesBtn.onclick = openRules;
  const tr = tb.insertRow();
  tr.insertCell().appendChild(rulesBtn);
  tr.insertCell().textContent = keep(t('co.travelVal', { amount: dkk(q.travel), km: q.distanceKm }));
  // An Other Repair is priced later, so the total is "341 kr. + anden reparation".
  add(t('co.total'), q.byAgreement ? t('co.totalPlus', { total: dkk(q.total) }) : dkk(q.total), 'tot');

  const notes = $('notes');
  notes.textContent = '';
  if (q.byAgreement) notes.appendChild(h('div', 'note', t('co.noteOther')));
  notes.appendChild(h('div', 'note', t('co.visit', { min: q.workMin })));
  notes.appendChild(h('div', 'note', t('co.confirmNote', { time: draft.arrival })));
  notes.appendChild(h('p', 'det', t('co.estimate')));

  mail = R.requestEmail(draft, q, { t, fmt: { dkk, date: fmtDate }, svcName });
  $('send-mail').href = R.mailtoLink(TO, mail);
  // A new id for each version of the request: the API sends a request with the same id only once,
  // so a double click or a retry cannot send it twice.
  requestId = newRequestId();
  $('e-confirm').textContent = '';
}

$('back').onclick = () => show('f');

let requestId = null;
function newRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Send: held back until both boxes are ticked, then posted to the API.
let sending = false;
$('send').addEventListener('click', async () => {
  const accept = { terms: $('acc-terms').checked, earlyStart: $('acc-start').checked };
  const notAccepted = R.checkAcceptance(accept);
  if (notAccepted) {
    $('e-confirm').textContent = t(`err.accept.${notAccepted}`);
    return;
  }
  $('e-confirm').textContent = '';
  if (sending) return;
  sending = true;
  const btn = $('send');
  btn.disabled = true;
  btn.textContent = t('co.sending');
  const { serviceIds, date, arrival, bike, street, apartment, postcode, name, phone, email, note } = draft;
  let res = null;
  let data = null;
  try {
    res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify({ id: requestId, lang: I18N.lang, serviceIds, date, arrival, bike, street, apartment, postcode, name, phone, email, note, accept, website: $('hp').value }),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(30000) : undefined,
    });
    data = await res.json().catch(() => null);
  } catch {
    res = null; // offline, or no answer in time
  }
  sending = false;
  btn.disabled = false;
  btn.textContent = t('co.send');

  if (res?.ok && data?.ok) { showSent(data.copy !== false); return; }
  // The server's own checks said no (say, the date is now too soon, on a page left open overnight):
  // show why, where it can be fixed.
  if (res?.status === 400 && data?.error === 'invalid' && data.errors) {
    if (data.errors.accept) { $('e-confirm').textContent = t(`err.accept.${data.errors.accept}`); return; }
    showErrors(data.errors);
    show('f');
    const first = ERR.find((k) => data.errors[k]);
    if (first) $(`e-${first}`).scrollIntoView({ block: 'center' });
    return;
  }
  // Anything else (no API key yet, too many requests, the email service down, offline): the
  // visitor's own mail program.
  showDone();
});

const mailText = () => `${t('done.to')}: ${TO}\n${t('done.subject')}: ${mail.subject}\n\n${mail.body.replace(/\r\n/g, '\n')}`;

function showSent(copy) {
  $('sent-msg').textContent = t('sent.msg', { email: draft.email });
  $('sent-spam').hidden = !copy;
  $('sent-nocopy').hidden = copy;
  if (!copy) {
    $('sent-nocopy-msg').textContent = t('sent.noCopy', { email: draft.email });
    $('senttext').value = mailText();
  }
  show('sent');
}

function showDone() {
  $('done-msg').textContent = t('done.msg', { email: TO });
  $('done-help').textContent = t(CONFIG.contact.phone ? 'done.helpPhone' : 'done.help', { email: TO, phone: CONFIG.contact.phone });
  $('mailtext').value = mailText();
  $('copied').textContent = '';
  show('done');
}

$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('mailtext').value);
    $('copied').textContent = t('done.copied');
  } catch {
    // No clipboard access: select the text, so the visitor can copy it themselves.
    $('mailtext').select();
    $('copied').textContent = t('done.copySelf');
  }
};
$('again').onclick = () => location.reload();
$('again2').onclick = () => location.reload();

// ---- Travel rules dialog ----
let lastFocus = null;
function openRules() {
  lastFocus = document.activeElement;
  const rl = $('rl');
  rl.textContent = '';
  for (const x of [
    t('rules.rate', { rate: String(CONFIG.kmRate).replace('.', I18N.lang === 'da' ? ',' : '.'), base: CONFIG.base }),
    t('rules.max', { max: CONFIG.maxKm }),
    t('rules.estimate'),
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

// Service cards preselect their service in the form.
document.addEventListener('click', (e) => {
  const pre = e.target.closest('[data-pre]');
  if (!pre) return;
  const c = document.querySelector(`input[name=svc][value="${pre.dataset.pre}"]`);
  if (c && !c.checked) {
    c.checked = true;
    c.dispatchEvent(new Event('change', { bubbles: true }));
  }
  $('sacc').setAttribute('aria-expanded', 'true');
  $('svcs').hidden = false;
  show('f');
});
