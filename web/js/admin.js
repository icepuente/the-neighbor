// The owner's dashboard (admin.html, English): bookings, business requests, closed days and the
// email outbox. Reads and writes Firestore directly as the signed-in owner; firestore.rules allow
// that only for an account with the `admin` claim, and only the changes made here (a booking's
// status, a request's status, closed days). Emails to customers are queued by Cloud Functions
// (bookingStatusChanged), not here. Lists update live as bookings come in.
import { NBF } from './firebase.js';
import { attachDatePicker } from './datepicker.js';
import * as R from './shared/booking-rules.js';

const { $, h, A, button, defList, tag } = UI;
const { auth, db, storage, sdk } = NBF;
const { onAuthStateChanged, signInWithEmailAndPassword, signOut } = sdk.auth;
const { collection, doc, onSnapshot, updateDoc, setDoc, deleteDoc, serverTimestamp } = sdk.firestore;
const { ref: storageRef, getBlob } = sdk.storage;

const dkk = (n) => `${Math.round(n).toLocaleString('da-DK')} DKK`;
const fmtDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (ts) => (ts?.toDate ? ts.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: R.TIME_ZONE }) : '');

// ---- Live data: each collection is watched once; tabs re-draw from these lists ----
const data = { bookings: [], consultations: [], closedDates: [], mail: [] };
const unsubscribe = [];
function watch() {
  for (const name of Object.keys(data)) {
    unsubscribe.push(onSnapshot(collection(db, name), (snap) => {
      data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (e) => showError(`Could not load ${name}: ${e.code || e.message}`)));
  }
}
function stopWatching() { while (unsubscribe.length) unsubscribe.pop()(); }
const showError = (msg) => { $('view').prepend(h('p', 'err', msg)); };

// ---- Sign-in: only an account with the owner (admin) claim gets in ----
$('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('e-signin').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pw').value);
  } catch {
    $('e-signin').textContent = 'Wrong email or password.';
  }
});
$('out').onclick = () => signOut(auth);
// The demo shows its owner login (fake data only, wiped daily).
if (NBF.environment !== 'production') {
  const hint = $('demo-login');
  hint.hidden = false;
  A(hint, 'Demo login: owner@demo.dk / neighbor-demo ', button('Fill in', 'lnk', () => { $('email').value = 'owner@demo.dk'; $('pw').value = 'neighbor-demo'; }));
}

onAuthStateChanged(auth, async (user) => {
  stopWatching();
  $('loading').hidden = true;
  // Anonymous sessions (a guest who attached photos on the booking page) count as signed out.
  const signedIn = Boolean(user && !user.isAnonymous);
  const isOwner = signedIn && (await user.getIdTokenResult()).claims.admin === true;
  $('gate').hidden = isOwner;
  $('signin').hidden = signedIn;
  $('not-owner').hidden = !signedIn || isOwner;
  $('out').hidden = !signedIn;
  $('app').hidden = !isOwner;
  if (isOwner) {
    $('today').textContent = `Today is ${fmtDate(R.today())}`;
    watch();
  }
});

// ---- Tabs ----
const tabs = [
  ['Bookings', bookingsView, () => data.bookings.filter((b) => b.status === 'pending').length],
  ['Requests', requestsView, () => data.consultations.filter((c) => c.status === 'new').length],
  ['Closed days', closedView],
  ['Outbox', outboxView],
];
let current = 0;
function render() {
  const t = $('tabs');
  t.textContent = '';
  tabs.forEach(([label, , count], i) => {
    const b = button(label, '', () => { current = i; render(); });
    const n = count?.();
    if (n) b.append(h('span', 'count', String(n)));
    if (i === current) b.setAttribute('aria-current', 'page');
    t.append(b);
  });
  // Keep an open <details> and a half-filled form when the data refreshes underneath.
  const v = $('view');
  const open = new Set([...v.querySelectorAll('details[open]')].map((d) => d.dataset.key));
  const keep = [...v.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el.value]);
  v.textContent = '';
  tabs[current][1](v);
  for (const d of v.querySelectorAll('details')) if (open.has(d.dataset.key)) d.open = true;
  for (const [k, val] of keep) { const el = v.querySelector(`[data-keep="${k}"]`); if (el && !el.value) el.value = val; }
}

function field(labelText, input) {
  const wrap = h('div');
  const l = h('label', '', labelText);
  input.id ||= `f-${Math.random().toString(36).slice(2, 8)}`;
  l.htmlFor = input.id;
  A(wrap, l, input);
  return wrap;
}
function select(options, value) {
  const s = h('select');
  for (const [v, label] of options) s.append(new Option(label, v, false, v === value));
  return s;
}

// ---- Bookings ----
let bookingFilter = 'upcoming';
const changeStatus = (b, status) => updateDoc(doc(db, 'bookings', b.id), { status, statusAt: serverTimestamp() })
  .catch((e) => showError(`Could not update ${b.ref}: ${e.code || e.message}`));

function bookingsView(v) {
  const bar = h('div', 'toolbar');
  const sel = select([['upcoming', 'Upcoming'], ['pending', 'Waiting for confirmation'], ['all', 'All bookings']], bookingFilter);
  sel.id = 'booking-filter';
  sel.onchange = () => { bookingFilter = sel.value; render(); };
  bar.append(field('Show', sel));
  v.append(bar);

  const today = R.today();
  const list = data.bookings.filter((b) => {
    if (bookingFilter === 'pending') return b.status === 'pending';
    if (bookingFilter === 'upcoming') return b.date >= today && b.status !== 'cancelled';
    return true;
  }).sort((a, b) => (a.date + a.arrival).localeCompare(b.date + b.arrival));
  if (!list.length) v.append(h('p', 'sub', 'Nothing here.'));

  const wrap = h('div', 'list');
  for (const b of list) {
    const c = h('div', 'paper booking');
    c.dataset.ref = b.ref;
    const head = h('h3', '', `${fmtDate(b.date)} · ${b.arrival} · ${b.name} `);
    head.append(tag(b.status));
    if (b.urgent) head.append(' ', tag('soon', 'Urgent (Care Plus)'));
    const services = b.services.map((s) => s.name).join(', ');
    A(c, head, h('p', 'det', `${services} · ${dkk(b.pricing.total)} incl. travel${b.pricing.monthly ? ` + ${dkk(b.pricing.monthly)}/month` : ''}`),
      h('p', 'det', R.fullAddress(b.address, b.apartment)));
    if (b.photos?.length) c.append(photoRow(b));
    const more = h('details');
    more.dataset.key = b.id;
    const phone = h('a', '', b.phone);
    phone.href = `tel:${b.phone.replace(/\s/g, '')}`;
    const email = h('a', '', b.email);
    email.href = `mailto:${b.email}`;
    A(more, h('summary', 'meta', 'Details'), defList([
      ['Phone', phone], ['Email', email], ['Bike', b.bikeType || '–'], ['Note', b.note || '–'],
      ['Work', `${b.workMin} min (blocks ${b.blockMin} min with travel)`],
      ['Travel', b.pricing.travel == null ? 'to confirm' : `${dkk(b.pricing.travel)} (${b.distanceKm} km, estimated)`],
      ['Discount', b.pricing.discount ? `${dkk(b.pricing.discount)} (${b.pricing.discountReason})` : '–'],
      ['Ref', b.ref], ['Booked', fmtTime(b.createdAt) || '–'],
    ]));
    c.append(more);
    // Actions: each change queues the matching email to the customer (bookingStatusChanged).
    if (b.status === 'pending') c.append(button('Confirm', 'alt sm', () => changeStatus(b, 'confirmed')));
    if (['pending', 'confirmed'].includes(b.status)) {
      c.append(button('Mark completed', 'alt sm', () => changeStatus(b, 'completed')));
      // Cancelling takes two clicks, so it cannot happen by accident.
      const cancel = button('Cancel booking', 'alt sm', () => {
        if (cancel.dataset.armed) { changeStatus(b, 'cancelled'); return; }
        cancel.dataset.armed = '1';
        cancel.textContent = `Click again to cancel and email ${b.name}`;
        setTimeout(() => { delete cancel.dataset.armed; cancel.textContent = 'Cancel booking'; }, 5000);
      });
      c.append(cancel);
    }
    wrap.append(c);
  }
  v.append(wrap);
}

// Booking photos: thumbnails, read with the owner's sign-in; a click opens the full photo.
const blobUrls = new Map();
async function photoUrl(path) {
  if (!blobUrls.has(path)) blobUrls.set(path, getBlob(storageRef(storage, path)).then((blob) => URL.createObjectURL(blob)));
  return blobUrls.get(path);
}
function photoRow(b) {
  const row = h('div', 'pics-grid');
  b.photos.forEach((p, i) => {
    const btn = h('button', 'pic');
    btn.type = 'button';
    const img = h('img');
    img.alt = `${b.name}'s photo ${i + 1}`;
    photoUrl(p.thumbPath).then((u) => { img.src = u; }, () => { img.alt = 'Photo could not be loaded'; });
    btn.onclick = async () => UI.openPhoto(await photoUrl(p.path), img.alt);
    btn.append(img);
    row.append(btn);
  });
  return row;
}

// ---- Business consultation requests ----
function requestsView(v) {
  const list = [...data.consultations].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  if (!list.length) v.append(h('p', 'sub', 'No requests yet.'));
  const wrap = h('div', 'list');
  for (const l of list) {
    const c = h('div', 'paper');
    const email = h('a', '', l.email);
    email.href = `mailto:${l.email}`;
    A(c, tag(l.status), h('h3', '', l.company), h('p', 'meta', `${l.companyType} · ${l.bikes} bikes · received ${fmtTime(l.createdAt)}`),
      defList([
        ['Contact', l.name], ['Email', email], ['Phone', l.phone],
        ['Preferred', [l.preferredDate && fmtDate(l.preferredDate), l.preferredTime].filter(Boolean).join(' at ') || '–'],
        ['Message', l.message || '–'],
      ]));
    const bar = h('div', 'toolbar');
    const st = select([['new', 'New'], ['contacted', 'Contacted'], ['won', 'Won'], ['lost', 'Lost']], l.status);
    st.onchange = () => updateDoc(doc(db, 'consultations', l.id), { status: st.value })
      .catch((e) => showError(`Could not update: ${e.code || e.message}`));
    bar.append(field('Status', st));
    c.append(bar);
    wrap.append(c);
  }
  v.append(wrap);
}

// ---- Closed days: bookings cannot be made on them ----
function closedView(v) {
  v.append(h('p', 'sub', 'Days you are not working. Customers cannot book them; Sundays are always closed.'));
  const form = h('form', 'box narrow');
  form.noValidate = true;
  const dateIn = h('input');
  dateIn.type = 'date';
  dateIn.id = 'closed-date';
  const reason = h('input');
  reason.type = 'text';
  reason.maxLength = 100;
  reason.placeholder = 'e.g. Holiday';
  reason.dataset.keep = 'closed-reason';
  const err = h('p', 'err');
  A(form, h('h3', '', 'Close a day'), field('Day', dateIn), field('Reason (optional)', reason), err, h('button', 'pill', 'Close this day'));
  form.lastChild.type = 'submit';
  v.append(form);
  attachDatePicker(dateIn, {
    locale: 'en-GB',
    labels: { choose: 'Choose a day', prev: 'Previous month', next: 'Next month', unavailable: 'already closed' },
    today: R.today,
    earliest: R.today,
    unavailable: (d) => R.closedReason(d, data.closedDates.map((c) => c.id)),
    maxMonths: 12,
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!dateIn.value) { err.textContent = 'Choose a day.'; return; }
    setDoc(doc(db, 'closedDates', dateIn.value), { reason: reason.value.trim() })
      .then(() => { reason.value = ''; }, (x) => { err.textContent = `Could not save: ${x.code || x.message}`; });
  };

  const upcoming = data.closedDates.filter((c) => c.id >= R.today()).sort((a, b) => a.id.localeCompare(b.id));
  v.append(h('h3', '', upcoming.length ? 'Closed days ahead' : 'No closed days ahead.'));
  const wrap = h('div', 'list');
  for (const c of upcoming) {
    const row = h('div', 'paper');
    const clash = data.bookings.filter((b) => b.date === c.id && b.status !== 'cancelled');
    A(row, h('h3', '', fmtDate(c.id)), h('p', 'det', c.reason || '–'));
    if (clash.length) row.append(h('p', 'err', `${clash.length} booking(s) on this day: ${clash.map((b) => `${b.ref} at ${b.arrival}`).join(', ')}. Closing a day does not cancel them.`));
    row.append(button('Open this day again', 'alt sm', () => deleteDoc(doc(db, 'closedDates', c.id))));
    wrap.append(row);
  }
  v.append(wrap);
}

// ---- Outbox: emails queued for sending (nothing is sent until email sending is set up) ----
function outboxView(v) {
  v.append(h('p', 'sub', 'Emails the site has queued. Sending is not set up yet, so they stay here.'));
  const list = [...data.mail].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  if (!list.length) v.append(h('p', 'sub', 'No emails yet.'));
  const wrap = h('div', 'list');
  for (const m of list) {
    const d = h('details', 'paper');
    d.dataset.key = m.id;
    A(d, h('summary', '', `${m.message?.subject || '(no subject)'} → ${m.to}`), h('p', 'meta', fmtTime(m.createdAt)), h('pre', 'mail', m.message?.text || ''));
    wrap.append(d);
  }
  v.append(wrap);
}
