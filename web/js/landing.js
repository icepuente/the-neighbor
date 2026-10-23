// The front page (index.html): service cards and the booking form.
//
// The site has no backend. The form checks the request and shows the price, then the customer's own
// mail program opens with the request written out, addressed to the owner (a mailto: link). Nothing
// is stored or sent by the site; the owner confirms the time by replying. If no mail program opens,
// the same text is shown to copy.
import * as R from './booking-rules.js';
import { attachDatePicker } from './datepicker.js';

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
$('hero-repairs-sub').textContent = t('hero.repairsSub', { price: dkk(Math.min(...SERVICES.map((s) => s.price))) });

// Price plus the owner's time estimate, e.g. "199 kr. · ca. 15–20 min."
const svcDetail = (s) => `${dkk(s.price)} · ${t('svc.time', { m: s.mins })}`;

for (const s of SERVICES) {
  const a = h('a');
  a.href = '#book';
  a.dataset.pre = s.id;
  const sub = [t('svc.time', { m: s.mins }), s.tubeIncluded ? t('svc.tubeIncl') : null, t(`svc.${s.id}.what`)].filter(Boolean).join(' · ');
  A(a, h('b', '', svcName(s)), h('p', 'price', dkk(s.price)), h('span', '', sub));
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

// ---- Price page ----
let draft = null;
let quote = null;
let mail = null;
const ERR = ['services', 'date', 'arrival', 'note', 'form'];
const showErrors = (errors) => { for (const k of ERR) $(`e-${k}`).textContent = errors[k] ? t(`err.${errors[k]}`) : ''; };
function show(id) {
  for (const x of ['f', 'co', 'done']) $(x).hidden = x !== id;
  $(id).scrollIntoView({ block: 'nearest' });
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
    postcode: v('postcode'),
    name: v('name'),
    phone: v('tel'),
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
  $('codet').textContent = `${t('dateAt', { date: fmtDate(draft.date), time: draft.arrival })} · ${draft.bike} · ${R.fullAddress(draft.street, draft.postcode)}`;
  const tb = $('tbl');
  tb.textContent = '';
  const add = (a, b, cls) => {
    const r = tb.insertRow();
    if (cls) r.className = cls;
    r.insertCell().textContent = a;
    r.insertCell().textContent = b;
  };
  for (const s of q.services) add(svcName(s), dkk(s.price));
  const rulesBtn = h('button', 'lnk', t('co.travel'));
  rulesBtn.type = 'button';
  rulesBtn.onclick = openRules;
  const tr = tb.insertRow();
  tr.insertCell().appendChild(rulesBtn);
  tr.insertCell().textContent = t('co.travelVal', { amount: dkk(q.travel), km: q.distanceKm });
  add(t('co.total'), dkk(q.total), 'tot');

  const notes = $('notes');
  notes.textContent = '';
  notes.appendChild(h('div', 'note', t('co.visit', { min: q.workMin })));
  notes.appendChild(h('div', 'note', t('co.confirmNote', { time: draft.arrival })));
  notes.appendChild(h('p', 'det', t('co.estimate')));

  mail = R.requestEmail(draft, q, { t, fmt: { dkk, date: fmtDate }, svcName });
  $('send').href = R.mailtoLink(TO, mail);
  $('e-confirm').textContent = '';
}

$('back').onclick = () => show('f');

// The send button is a mailto: link, so the visitor's own click opens their mail program (also on
// phones). It is held back until both boxes are ticked.
$('send').addEventListener('click', (e) => {
  const notAccepted = R.checkAcceptance({ terms: $('acc-terms').checked, earlyStart: $('acc-start').checked });
  if (notAccepted) {
    e.preventDefault();
    $('e-confirm').textContent = t(`err.accept.${notAccepted}`);
    return;
  }
  $('e-confirm').textContent = '';
  // The mail program opens over the page; this page then says what happens next.
  setTimeout(showDone, 400);
});

function showDone() {
  $('done-msg').textContent = t('done.msg', { email: TO });
  $('done-help').textContent = t(CONFIG.contact.phone ? 'done.helpPhone' : 'done.help', { email: TO, phone: CONFIG.contact.phone });
  $('mailtext').value = `${t('done.to')}: ${TO}\n${t('done.subject')}: ${mail.subject}\n\n${mail.body.replace(/\r\n/g, '\n')}`;
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
