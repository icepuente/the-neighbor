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
const { collection, doc, getDocs, onSnapshot, updateDoc, setDoc, deleteDoc, serverTimestamp } = sdk.firestore;
const { ref: storageRef, getBlob, uploadBytes, deleteObject } = sdk.storage;

const dkk = (n) => `${Math.round(n).toLocaleString('da-DK')} DKK`;
const fmtDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (ts) => (ts?.toDate ? ts.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: R.TIME_ZONE }) : '');

// ---- Live data: each collection is watched once; tabs re-draw from these lists ----
const data = { bookings: [], consultations: [], closedDates: [], mail: [], users: [], recommendations: [], serviceRecords: [], companies: [] };
const unsubscribe = [];
function watch() {
  for (const name of Object.keys(data)) {
    unsubscribe.push(onSnapshot(collection(db, name), (snap) => {
      data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (e) => showError(`Could not load ${name}: ${e.code || e.message}`)));
  }
}
function stopWatching() { while (unsubscribe.length) unsubscribe.pop()(); watchCompany(null); }
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
  ['Requests', requestsView, () => data.consultations.filter((c) => c.status === 'new' && !c.archived).length],
  ['Customers', customersView],
  ['Companies', companiesView],
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
  // Keep open <details>, typed text and the cursor when the data refreshes underneath (a booking
  // arriving or changing re-draws the view).
  const v = $('view');
  const open = new Set([...v.querySelectorAll('details[open]')].map((d) => d.dataset.key));
  const keep = [...v.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el.value, el.dataset.dirty]);
  const active = document.activeElement?.dataset?.keep;
  const caret = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  v.textContent = '';
  tabs[current][1](v);
  for (const d of v.querySelectorAll('details')) if (open.has(d.dataset.key)) d.open = true;
  for (const [k, val, dirty] of keep) {
    const el = v.querySelector(`[data-keep="${k}"]`);
    // Text the owner has typed wins over what was saved.
    if (el && dirty) { el.value = val; el.dataset.dirty = '1'; }
  }
  if (active) {
    const el = v.querySelector(`[data-keep="${active}"]`);
    if (el) { el.focus(); el.setSelectionRange?.(...caret); }
  }
}
// Marks typed text so a re-draw keeps it (see render).
document.addEventListener('input', (e) => { if (e.target.dataset?.keep) e.target.dataset.dirty = '1'; });
// Empties a kept field once its text is saved or sent. Looks the field up again: a re-draw while
// saving may have replaced the element the click came from.
function clearKept(key, value = '') {
  const el = document.querySelector(`[data-keep="${key}"]`);
  if (!el) return;
  el.value = value;
  delete el.dataset.dirty;
}

async function callFn(name, payload) {
  const res = await sdk.functions.httpsCallable(NBF.functions, name)(payload);
  return res.data;
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

// Two ways to look at bookings: a list, or a month calendar. The choice is kept on this device.
const MODE_KEY = 'neighbor-admin-bookings-view';
let bookingMode = localStorage.getItem(MODE_KEY) === 'calendar' ? 'calendar' : 'list';
let showCancelled = false;
let selectedId = null; // the booking open in the calendar
let calMonth = (() => { const [y, m] = R.today().split('-').map(Number); return [y, m - 1]; })();

function bookingsView(v) {
  const bar = h('div', 'toolbar');
  // List / Calendar switch.
  const seg = h('div', 'seg view-switch');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'View');
  for (const [mode, label] of [['list', 'List'], ['calendar', 'Calendar']]) {
    const b = button(label, '', () => { bookingMode = mode; localStorage.setItem(MODE_KEY, mode); render(); });
    b.dataset.mode = mode;
    b.setAttribute('aria-pressed', String(bookingMode === mode));
    seg.append(b);
  }
  bar.append(seg);
  if (bookingMode === 'list') {
    const sel = select([['upcoming', 'Upcoming'], ['pending', 'Waiting for confirmation'], ['all', 'All bookings']], bookingFilter);
    sel.id = 'booking-filter';
    sel.onchange = () => { bookingFilter = sel.value; render(); };
    bar.append(field('Show', sel));
  } else {
    const cb = h('input');
    cb.type = 'checkbox';
    cb.id = 'show-cancelled';
    cb.checked = showCancelled;
    cb.onchange = () => { showCancelled = cb.checked; render(); };
    const l = h('label', 'cb inline', '');
    l.htmlFor = cb.id;
    A(l, cb, h('span', '', 'Show cancelled'));
    bar.append(l);
  }
  // CSV of what is shown: the list's filter, or the calendar's month.
  const csvBtn = button('Download CSV', 'alt sm csv', () => downloadCsv(shownBookings()));
  bar.append(csvBtn);
  v.append(bar);
  if (bookingMode === 'calendar') { calendarView(v); return; }

  const list = shownBookings();
  if (!list.length) v.append(h('p', 'sub', 'Nothing here.'));

  const wrap = h('div', 'list');
  for (const b of list) wrap.append(bookingCard(b));
  v.append(wrap);
}

// The bookings the current view shows, by date and time.
function shownBookings() {
  const today = R.today();
  const month = `${calMonth[0]}-${String(calMonth[1] + 1).padStart(2, '0')}`;
  return data.bookings.filter((b) => {
    if (bookingMode === 'calendar') return b.date.startsWith(month) && (showCancelled || b.status !== 'cancelled');
    if (bookingFilter === 'pending') return b.status === 'pending';
    if (bookingFilter === 'upcoming') return b.date >= today && b.status !== 'cancelled';
    return true;
  }).sort((a, b) => (a.date + a.arrival).localeCompare(b.date + b.arrival));
}

// A CSV file for Excel in Denmark: semicolons between fields, a BOM so æ, ø and å show
// correctly, and every value quoted. Values that could start a formula are prefixed with ' so a
// spreadsheet shows them as text.
function downloadCsv(list) {
  const cols = [
    ['Ref', (b) => b.ref], ['Date', (b) => b.date], ['Time', (b) => b.arrival], ['Status', (b) => b.status],
    ['Urgent', (b) => (b.urgent ? 'yes' : '')], ['Name', (b) => b.name], ['Phone', (b) => b.phone], ['Email', (b) => b.email],
    ['Address', (b) => R.fullAddress(b.address, b.apartment)], ['Bike', (b) => b.bikeType || ''],
    ['Services', (b) => b.services.map((s) => s.name).join(', ')], ['Work (min)', (b) => b.workMin],
    ['Services (DKK)', (b) => b.pricing.oneOff], ['Discount (DKK)', (b) => b.pricing.discount], ['Travel (DKK)', (b) => b.pricing.travel ?? ''],
    ['Total (DKK)', (b) => b.pricing.total], ['Monthly (DKK)', (b) => b.pricing.monthly || ''],
    ['Customer note', (b) => b.note || ''], ['Private note', (b) => b.ownerNote || ''], ['Photos', (b) => b.photos?.length || 0],
    ['Booked', (b) => (b.createdAt?.toDate ? b.createdAt.toDate().toISOString() : '')],
  ];
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [cols.map(([name]) => cell(name)).join(';'), ...list.map((b) => cols.map(([, get]) => cell(get(b))).join(';'))];
  const blob = new Blob([`\uFEFF${rows.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const a = h('a');
  a.href = URL.createObjectURL(blob);
  a.download = `the-neighbor-bookings-${R.today()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// One booking: the essentials, photos, details and the actions. Used by the list and the calendar.
function bookingCard(b) {
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
  if (b.visitLogged) c.append(h('p', 'ok', 'Visit logged: the customer has the service record.'));
  // Tools: log the visit, private note, reschedule, message the customer.
  const tools = h('div', 'tools');
  if (['pending', 'confirmed'].includes(b.status)) tools.append(visitBox(b));
  tools.append(noteBox(b));
  if (['pending', 'confirmed'].includes(b.status)) tools.append(rescheduleBox(b));
  tools.append(messageBox(b));
  c.append(tools);
  return c;
}

// A collapsible tool on the booking card; stays open through re-draws (render keeps data-key).
function tool(b, key, title) {
  const d = h('details', 'tool');
  d.dataset.key = `${key}-${b.id}`;
  d.append(h('summary', 'meta', title));
  return d;
}

// ---- Private note: only the owner sees it ----
function noteBox(b) {
  const d = tool(b, 'note', b.ownerNote ? 'Private note ✎' : 'Private note');
  const ta = h('textarea');
  ta.rows = 3;
  ta.maxLength = 2000;
  ta.value = b.ownerNote || '';
  ta.dataset.keep = `note-${b.id}`;
  ta.setAttribute('aria-label', `Private note for ${b.ref}`);
  const msg = h('span', 'det');
  const save = button('Save note', 'alt sm', () => {
    updateDoc(doc(db, 'bookings', b.id), { ownerNote: ta.value.trim() })
      .then(() => { clearKept(`note-${b.id}`, ta.value.trim()); msg.textContent = ' Saved.'; }, (e) => { msg.textContent = ` Could not save: ${e.code || e.message}`; });
  });
  A(d, h('p', 'det', 'Only you see this. Customers never do.'), ta, save, msg);
  return d;
}

// ---- Reschedule: pick a day, then a free time; the Function moves it and emails the customer ----
const resched = new Map(); // booking id -> { date, times, pick, error, busy, done }
const RESCHED_ERRORS = {
  sunday: 'Sundays are closed.', closed: 'That day is closed.', taken: 'That time was just taken. Pick another.',
  arrival: 'That is not a start time.', date: 'Choose a day from today on.', status: 'Only pending or confirmed bookings can be moved.',
  missing: 'This booking no longer exists.',
};
function rescheduleBox(b) {
  const st = resched.get(b.id) || {};
  const d = tool(b, 'resched', 'Reschedule');
  const dateIn = h('input');
  dateIn.type = 'date';
  dateIn.id = `resched-${b.id}`;
  dateIn.value = st.date || '';
  A(d, h('p', 'det', `Now ${fmtDate(b.date)} at ${b.arrival} (${b.workMin} min). Choose a new day:`), dateIn);
  attachDatePicker(dateIn, {
    locale: 'en-GB',
    labels: { choose: 'Choose a day', prev: 'Previous month', next: 'Next month', unavailable: 'closed' },
    today: R.today,
    earliest: R.today,
    unavailable: (x) => R.closedReason(x, data.closedDates.map((cd) => cd.id)),
  });
  dateIn.onchange = async () => {
    resched.set(b.id, { date: dateIn.value, busy: true });
    render();
    try {
      const r = await callFn('rescheduleBooking', { bookingId: b.id, date: dateIn.value });
      resched.set(b.id, { date: dateIn.value, times: r.times, error: r.error });
    } catch (e) {
      resched.set(b.id, { date: dateIn.value, error: e.message });
    }
    render();
  };
  if (st.busy) d.append(h('p', 'det', 'Working…'));
  if (st.error) d.append(h('p', 'err', RESCHED_ERRORS[st.error] || st.error));
  if (st.done) d.append(h('p', 'ok', st.done));
  if (st.times) {
    const slots = h('div', 'slots');
    for (const s of st.times) {
      const t = button(s.time, `slotbtn${st.pick === s.time ? ' on' : ''}`, () => { resched.set(b.id, { ...st, pick: s.time, error: null }); render(); });
      t.disabled = !s.free;
      t.setAttribute('aria-pressed', String(st.pick === s.time));
      slots.append(t);
    }
    if (!st.times.some((s) => s.free)) d.append(h('p', 'det', 'No free times that day.'));
    d.append(slots);
  }
  if (st.pick) {
    d.append(button(`Move to ${fmtDate(st.date)} at ${st.pick} and email ${b.name}`, 'pill', async () => {
      resched.set(b.id, { ...st, busy: true });
      render();
      try {
        const r = await callFn('rescheduleBooking', { bookingId: b.id, date: st.date, arrival: st.pick });
        resched.set(b.id, r.ok ? { done: `Moved to ${fmtDate(r.date)} at ${r.arrival}. ${b.name} has been emailed.` } : { ...st, busy: false, pick: null, error: r.error });
      } catch (e) {
        resched.set(b.id, { ...st, busy: false, error: e.message });
      }
      render();
    }));
  }
  return d;
}

// ---- Message the customer: emailed, and kept with the booking ----
const messages = new Map(); // booking id -> [{ text, createdAt }] once loaded
async function loadMessages(id) {
  const snap = await getDocs(collection(db, 'bookings', id, 'messages'));
  messages.set(id, snap.docs.map((m) => m.data()).sort((x, y) => (x.createdAt?.toMillis?.() || 0) - (y.createdAt?.toMillis?.() || 0)));
  render();
}
function messageBox(b) {
  const sent = messages.get(b.id);
  const d = tool(b, 'msg', sent?.length ? `Message the customer (${sent.length} sent)` : 'Message the customer');
  d.addEventListener('toggle', () => { if (d.open && !messages.has(b.id)) loadMessages(b.id); });
  for (const m of sent || []) {
    const p = h('div', 'sent-msg');
    A(p, h('p', 'meta', `Sent ${fmtTime(m.createdAt)}`), h('p', '', m.text));
    d.append(p);
  }
  const ta = h('textarea');
  ta.rows = 3;
  ta.maxLength = 4000;
  ta.dataset.keep = `msg-${b.id}`;
  ta.setAttribute('aria-label', `Message to ${b.name}`);
  const note = h('span', 'det');
  const send = button(`Send to ${b.email}`, 'alt sm', async () => {
    if (!ta.value.trim()) { note.textContent = ' Write a message first.'; return; }
    send.disabled = true;
    try {
      const r = await callFn('messageCustomer', { bookingId: b.id, text: ta.value });
      if (r.ok) { clearKept(`msg-${b.id}`); await loadMessages(b.id); } else note.textContent = ` Could not send (${r.error}).`;
    } catch (e) {
      note.textContent = ` Could not send: ${e.message}`;
    } finally {
      send.disabled = false;
    }
  });
  A(d, ta, send, note);
  return d;
}

// ---- Month calendar of bookings ----
// Each booking is a chip on its day: time and name, with the status shown by colour, outline and a
// symbol (so it does not rely on colour alone). Clicking one opens its card, with the same actions.
const STATUS_MARK = { pending: '?', confirmed: '✓', completed: '✓✓', cancelled: '✕' };
const STATUS_WORD = { pending: 'waiting for confirmation', confirmed: 'confirmed', completed: 'completed', cancelled: 'cancelled' };

function calendarView(v) {
  const [y, m] = calMonth;
  const head = h('div', 'bcal-head');
  const shift = (n) => { const i = y * 12 + m + n; calMonth = [Math.floor(i / 12), i % 12]; render(); };
  const prev = button('‹', 'cal-nav', () => shift(-1));
  prev.setAttribute('aria-label', 'Previous month');
  const next = button('›', 'cal-nav', () => shift(1));
  next.setAttribute('aria-label', 'Next month');
  const title = h('h3', 'bcal-title', new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const todayBtn = button('Today', 'alt sm', () => { const [ty, tm] = R.today().split('-').map(Number); calMonth = [ty, tm - 1]; render(); });
  A(head, prev, title, next, todayBtn);
  v.append(head);

  // Legend.
  const legend = h('p', 'bcal-legend');
  for (const s of ['pending', 'confirmed', 'completed']) {
    const chip = h('span', `bchip ${s}`);
    A(chip, h('span', 'mark', STATUS_MARK[s]), ` ${STATUS_WORD[s][0].toUpperCase()}${STATUS_WORD[s].slice(1)}`);
    legend.append(chip, ' ');
  }
  const closedKey = h('span', 'bcal-key-closed', 'Closed');
  legend.append(closedKey);
  v.append(legend);

  const layout = h('div', 'bcal-layout');
  const grid = h('div', 'bcal');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', title.textContent);
  for (const w of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) grid.append(h('div', 'bcal-wd', w));
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  for (let i = 0; i < lead; i++) grid.append(h('div', 'bcal-day empty'));
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const today = R.today();
  const closed = new Map(data.closedDates.map((c) => [c.id, c.reason]));
  const byDay = new Map();
  for (const b of data.bookings) {
    if (b.status === 'cancelled' && !showCancelled) continue;
    if (!byDay.has(b.date)) byDay.set(b.date, []);
    byDay.get(b.date).push(b);
  }
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = h('div', 'bcal-day');
    cell.dataset.date = date;
    if (date === today) cell.classList.add('today');
    if (date < today) cell.classList.add('past');
    const reason = R.closedReason(date, [...closed.keys()]);
    if (reason) cell.classList.add('closed');
    cell.append(h('span', 'bcal-num', String(d)));
    if (reason === 'closed') cell.append(h('span', 'bcal-reason', closed.get(date) || 'Closed'));
    for (const b of (byDay.get(date) || []).sort((a, z) => a.arrival.localeCompare(z.arrival))) {
      const chip = button('', `bchip ${b.status}`, () => { selectedId = b.id; render(); document.getElementById('bcal-detail')?.scrollIntoView({ block: 'nearest' }); });
      chip.dataset.ref = b.ref;
      A(chip, h('span', 'mark', STATUS_MARK[b.status]), ` ${b.arrival}`, h('span', 'who', b.name.split(' ')[0]));
      if (b.urgent) chip.classList.add('urgent');
      chip.setAttribute('aria-label', `${b.arrival} ${b.name}, ${STATUS_WORD[b.status]}${b.urgent ? ', urgent' : ''}`);
      if (b.id === selectedId) chip.setAttribute('aria-pressed', 'true');
      cell.append(chip);
    }
    grid.append(cell);
  }
  layout.append(grid);

  // The chosen booking's card, with the same actions as in the list.
  const detail = h('div', 'bcal-detail');
  detail.id = 'bcal-detail';
  const chosen = data.bookings.find((b) => b.id === selectedId);
  if (chosen) {
    detail.append(bookingCard(chosen), button('Close', 'lnk', () => { selectedId = null; render(); }));
  } else {
    detail.append(h('p', 'sub', 'Click a booking to see it and act on it.'));
  }
  layout.append(detail);
  v.append(layout);
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
// Archived requests are kept, but out of the way: an Active / Archived switch shows either.
let requestShelf = 'active';
const setArchived = (l, archived) => updateDoc(doc(db, 'consultations', l.id), { archived })
  .catch((e) => showError(`Could not ${archived ? 'archive' : 'restore'}: ${e.code || e.message}`));

function requestsView(v) {
  const archivedCount = data.consultations.filter((c) => c.archived).length;
  const bar = h('div', 'toolbar');
  const seg = h('div', 'seg view-switch');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Show');
  for (const [shelf, label] of [['active', 'Active'], ['archived', `Archived (${archivedCount})`]]) {
    const b = button(label, '', () => { requestShelf = shelf; render(); });
    b.dataset.shelf = shelf;
    b.setAttribute('aria-pressed', String(requestShelf === shelf));
    seg.append(b);
  }
  bar.append(seg);
  v.append(bar);

  const list = data.consultations.filter((c) => Boolean(c.archived) === (requestShelf === 'archived'))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  if (!list.length) v.append(h('p', 'sub', requestShelf === 'archived' ? 'No archived requests.' : 'No requests.'));
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
    st.dataset.keep = `status-${l.id}`;
    st.onchange = () => updateDoc(doc(db, 'consultations', l.id), { status: st.value })
      .catch((e) => showError(`Could not update: ${e.code || e.message}`));
    bar.append(field('Status', st));
    bar.append(l.archived
      ? button('Restore', 'alt sm', () => setArchived(l, false))
      : button('Archive', 'alt sm', () => setArchived(l, true)));
    c.dataset.company = l.company;
    c.append(bar);
    // A won consultation becomes a business customer: the company, its contact's login, an invite.
    const bar2 = h('div', 'toolbar');
    if (l.companyId) {
      bar2.append(button('Open the company', 'alt sm', () => openCompany(l.companyId)));
    } else if (!l.archived) {
      const plan = select(R.PLANS.map((p) => [p.id, `${p.name} · ${p.pricePerBike} DKK / bike / month`]), 'standard');
      plan.dataset.keep = `plan-${l.id}`;
      const create = button('Create business account', 'alt sm', () => {
        if (!create.dataset.armed) {
          create.dataset.armed = '1';
          create.textContent = `Click again to create it and email ${l.email}`;
          setTimeout(() => { delete create.dataset.armed; create.textContent = 'Create business account'; }, 5000);
          return;
        }
        createCompany(l, plan.value);
      });
      A(bar2, field('Plan', plan), create);
    }
    if (l.id === companyErrorLead) bar2.append(h('p', 'err', companyError));
    c.append(bar2);
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
      .then(() => { reason.value = ''; delete reason.dataset.dirty; }, (x) => { err.textContent = `Could not save: ${x.code || x.message}`; });
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

// ---- Log the visit: what was done, parts, notes, photos, and a recommendation for next time ----
// The Function logVisit saves the service record (the customer sees it under Historik), completes the
// booking and emails the customer. Photos are uploaded first, into the customer's visit folder.
const visits = new Map(); // booking id -> { recordId, picker, error, busy }
function visitState(b) {
  if (!visits.has(b.id)) {
    visits.set(b.id, {
      recordId: doc(collection(db, 'serviceRecords')).id,
      picker: UI.photoPicker({ max: 6, id: `visit-photos-${b.id}`, full: 1600, quality: 0.8, thumb: 320 }),
    });
  }
  return visits.get(b.id);
}
function visitBox(b) {
  const st = visitState(b);
  const d = tool(b, 'visit', 'Log the visit');
  const area = (key, label, rows, value, ph) => {
    const wrap = h('div');
    const l = h('label', '', label);
    const ta = h('textarea');
    ta.rows = rows;
    ta.id = `${key}-${b.id}`;
    ta.dataset.keep = ta.id;
    ta.value = value || '';
    if (ph) ta.placeholder = ph;
    l.htmlFor = ta.id;
    A(wrap, l, ta);
    return wrap;
  };
  const line = (key, label, value, ph) => {
    const wrap = h('div');
    const l = h('label', '', label);
    const i = h('input');
    i.type = 'text';
    i.id = `${key}-${b.id}`;
    i.dataset.keep = i.id;
    i.value = value || '';
    if (ph) i.placeholder = ph;
    l.htmlFor = i.id;
    A(wrap, l, i);
    return wrap;
  };
  const urgency = select([['later', 'Plan ahead'], ['soon', 'Do soon']], 'later');
  urgency.id = `v-urg-${b.id}`;
  A(d,
    line('v-title', 'Title', b.services.map((s) => s.name).join(', ')),
    area('v-work', 'Work done (one per line)', 4, '', 'Brakes adjusted\nChain cleaned and lubricated'),
    area('v-parts', 'Parts (one per line: name; price in DKK)', 2, '', 'Inner tube 700×35c; 59'),
    area('v-notes', 'Notes for the customer', 2, ''),
    h('p', 'lb', 'Photos (optional, up to 6)'), st.picker.el,
    h('h4', '', 'Recommendation for next time (optional)'),
    line('v-rtitle', 'What', '', 'e.g. Replace the rear tyre'),
    field('How soon', urgency),
    line('v-rreason', 'Why', '', 'e.g. The tread is worn to the indicators'),
    line('v-rdue', 'By when', '', 'e.g. Within about a month'));
  if (st.error) d.append(h('p', 'err', st.error));
  const save = button(`Save and email ${b.name}`, 'pill', () => submitVisit(b, d));
  save.disabled = Boolean(st.busy);
  d.append(save);
  return d;
}
async function submitVisit(b, d) {
  const st = visits.get(b.id);
  const val = (key) => d.querySelector(`#${key}-${b.id}`).value.trim();
  const work = val('v-work').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!work.length) { st.error = 'Write at least one line of work done.'; render(); return; }
  const parts = val('v-parts').split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, price] = s.split(';');
    return { name: name.trim(), price: Number(String(price || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0 };
  });
  st.busy = true;
  st.error = null;
  render();
  try {
    const folder = b.customerUid ? `users/${b.customerUid}/visits/${st.recordId}` : `visits/${st.recordId}`;
    const photos = st.picker.get();
    const put = async (path, dataUrl) => uploadBytes(storageRef(storage, path), await (await fetch(dataUrl)).blob(), { contentType: 'image/jpeg' });
    await Promise.all(photos.map((p) => Promise.all([put(`${folder}/${p.id}.jpg`, p.data), put(`${folder}/${p.id}_thumb.jpg`, p.thumb)])));
    const r = await callFn('logVisit', {
      bookingId: b.id, recordId: st.recordId, title: val('v-title'), work, parts, notes: val('v-notes'),
      photos: photos.map(({ id, w, h: ht }) => ({ id, w, h: ht })),
      recommendation: { title: val('v-rtitle'), urgency: d.querySelector(`#v-urg-${b.id}`).value, reason: val('v-rreason'), dueBy: val('v-rdue') },
    });
    if (!r.ok) throw new Error(r.error);
    visits.delete(b.id);
    for (const el of document.querySelectorAll(`[data-keep$="-${b.id}"]`)) delete el.dataset.dirty;
  } catch (e) {
    st.busy = false;
    st.error = `Could not save the visit: ${e.message}`;
  }
  render();
}

// ---- Customers: accounts, with their bookings, bikes and open recommendations ----
const customerBikes = new Map(); // uid -> bikes, loaded when a customer is opened
async function loadBikes(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'bikes'));
  customerBikes.set(uid, snap.docs.map((x) => ({ id: x.id, ...x.data() })));
  render();
}
function customersView(v) {
  const customers = [...data.users].filter((u) => u.role === 'private').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  v.append(h('p', 'sub', `${customers.length} customer account(s). Guests who booked without an account are under Bookings.`));
  const wrap = h('div', 'list');
  for (const u of customers) {
    const theirs = data.bookings.filter((b) => b.customerUid === u.id);
    const recs = data.recommendations.filter((r) => r.customerUid === u.id && r.status === 'open');
    const c = h('div', 'paper customer');
    c.dataset.email = u.email;
    const email = h('a', '', u.email);
    email.href = `mailto:${u.email}`;
    A(c, h('h3', '', u.name), defList([
      ['Email', email], ['Phone', u.phone || '–'], ['Address', R.fullAddress(u.address, u.apartment) || '–'],
      ['Bookings', `${theirs.length} (${theirs.filter((b) => b.status === 'completed').length} completed)`],
      ['Service records', String(data.serviceRecords.filter((r) => r.customerUid === u.id).length)],
      ['Open recommendations', String(recs.length)],
      ['Customer since', u.createdAt?.toDate ? fmtTime(u.createdAt) : '–'],
    ]));
    const more = h('details');
    more.dataset.key = `cust-${u.id}`;
    more.addEventListener('toggle', () => { if (more.open && !customerBikes.has(u.id)) loadBikes(u.id); });
    more.append(h('summary', 'meta', 'Bikes and recommendations'));
    const bikes = customerBikes.get(u.id);
    if (!bikes) more.append(h('p', 'det', 'Loading…'));
    else if (!bikes.length) more.append(h('p', 'det', 'No saved bikes.'));
    for (const bike of bikes || []) {
      A(more, h('p', '', `${bike.name}${bike.type ? ` · ${bike.type}` : ''}${bike.year ? ` (${bike.year})` : ''}`));
      if (bike.photos?.length) more.append(photoRow({ name: bike.name, photos: bike.photos }));
    }
    for (const r of recs) {
      const row = h('div', 'rec');
      A(row, tag(r.urgency === 'soon' ? 'soon' : 'pending', r.urgency === 'soon' ? 'Do soon' : 'Plan ahead'), h('b', '', ` ${r.title}`),
        h('p', 'det', [r.reason, r.dueBy].filter(Boolean).join(' · ')),
        button('Mark done', 'alt sm', () => updateDoc(doc(db, 'recommendations', r.id), { status: 'done' })));
      more.append(row);
    }
    c.append(more);
    wrap.append(c);
  }
  v.append(wrap);
}

// ---- Companies: business customers, their fleet bikes and monthly fleet reports ----
// The Function createCompany sets up the company and its contact's login from a request; the fleet
// is kept here (Firestore and Storage directly, as the owner), and saveFleetReport saves a month's
// report and emails the contact.
let companyError = '';
let companyErrorLead = null;
const COMPANY_ERRORS = {
  taken: 'That email already has a private customer account (or another company). Use another email for the business.',
  exists: 'This request already has a business account.', email: 'The request has no valid email.', name: 'The request needs a company and contact name.',
};
async function createCompany(l, plan) {
  companyErrorLead = null;
  try {
    const r = await callFn('createCompany', { leadId: l.id, plan });
    if (r.error) throw new Error(COMPANY_ERRORS[r.error] || r.error);
    companyNote = `${l.company} is set up. The invite to ${l.email} is in the Outbox.`;
    openCompany(r.companyId);
  } catch (e) {
    companyErrorLead = l.id;
    companyError = `Could not create the business account: ${e.message}`;
    render();
  }
}

let companyId = null; // the company open in the Companies tab
let companyNote = '';
const fleet = { id: null, bikes: [], reports: [], unsub: [] };
function watchCompany(id) {
  while (fleet.unsub.length) fleet.unsub.pop()();
  Object.assign(fleet, { id, bikes: [], reports: [] });
  if (!id) return;
  const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  fleet.unsub.push(onSnapshot(collection(db, 'companies', id, 'bikes'), (s) => {
    fleet.bikes = list(s).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    render();
  }, (e) => showError(`Could not load the fleet: ${e.code || e.message}`)));
  fleet.unsub.push(onSnapshot(collection(db, 'companies', id, 'reports'), (s) => {
    fleet.reports = list(s).sort((a, b) => b.month.localeCompare(a.month));
    render();
  }, (e) => showError(`Could not load the reports: ${e.code || e.message}`)));
}
function openCompany(id) {
  companyId = id;
  current = tabs.findIndex(([, fn]) => fn === companiesView);
  render();
}

function companiesView(v) {
  const companies = [...data.companies].sort((a, b) => a.name.localeCompare(b.name));
  if (!companies.length) { v.append(h('p', 'sub', 'No business customers yet. Create one from a consultation under Requests.')); return; }
  if (!companies.some((c) => c.id === companyId)) companyId = companies[0].id;
  if (fleet.id !== companyId) watchCompany(companyId);
  const c = companies.find((x) => x.id === companyId);
  const plan = R.PLANS.find((p) => p.id === c.plan);

  const bar = h('div', 'toolbar');
  const cs = select(companies.map((x) => [x.id, `${x.name}${x.status === 'active' ? '' : ` (${x.status})`}`]), companyId);
  cs.id = 'company-select';
  cs.onchange = () => { companyId = cs.value; companyNote = ''; render(); };
  bar.append(field('Company', cs));
  v.append(bar);

  // The company: plan, contact, status and the next visit.
  const p = h('div', 'paper company');
  p.dataset.company = c.name;
  const email = h('a', '', c.email);
  email.href = `mailto:${c.email}`;
  if (companyNote) p.append(h('p', 'ok', companyNote));
  A(p, h('h3', '', c.name), h('p', 'meta', `${c.type || 'Business'} \u00b7 customer since ${c.since ? fmtDate(c.since) : '\u2013'}`), defList([
    ['Plan', `${plan?.name || c.plan} \u00b7 ${dkk(c.pricePerBike)} per bike per month${plan?.monthlyReport ? ' \u00b7 monthly report' : ' \u00b7 initial report only'}`],
    ['Bikes', `${fleet.bikes.length} \u00b7 ${dkk(c.pricePerBike * fleet.bikes.length)} per month`],
    ['Contact', c.contact], ['Email', email], ['Phone', c.phone || '\u2013'],
  ]));
  const row = h('div', 'toolbar');
  const st = select([['active', 'Active'], ['paused', 'Paused'], ['ended', 'Ended']], c.status);
  st.onchange = () => updateDoc(doc(db, 'companies', c.id), { status: st.value }).catch((e) => showError(`Could not save: ${e.code || e.message}`));
  const next = h('input');
  next.type = 'date';
  next.id = `next-${c.id}`;
  next.value = c.nextVisit || '';
  next.onchange = () => updateDoc(doc(db, 'companies', c.id), { nextVisit: next.value }).catch((e) => showError(`Could not save: ${e.code || e.message}`));
  A(row, field('Status', st), field('Next visit (the customer sees it)', next));
  p.append(row);
  const panels = h('div', 'list');
  A(panels, p, fleetPanel(c), reportPanel(c, plan));
  v.append(panels);
}

// ---- The fleet: bikes with up to 4 photos each ----
const FLEET_FIELDS = [['number', 'Number', '#001', 20], ['type', 'Type', 'City bike', 80], ['location', 'Location', 'Reception', 80],
  ['year', 'Year', '2022', 10], ['size', 'Size', '54 cm', 40], ['gears', 'Gears', '7-speed hub', 60], ['brakes', 'Brakes', 'Rim brakes', 60]];
let fleetForm = null; // { id, editing, picker, error, busy }
async function openFleetForm(c, bike) {
  const initial = [];
  for (const ph of bike?.photos || []) initial.push({ ...ph, data: await photoUrl(ph.thumbPath).catch(() => ''), stored: true });
  fleetForm = {
    companyId: c.id, id: bike ? bike.id : doc(collection(db, 'companies', c.id, 'bikes')).id, editing: bike || null,
    picker: UI.photoPicker({ max: R.CONFIG.maxBikePhotos, initial, id: 'fleet-photos', full: 1600, quality: 0.8, thumb: 320 }),
  };
  render();
  document.getElementById('fleet-form')?.scrollIntoView({ block: 'nearest' });
}
function fleetPanel(c) {
  const p = h('div', 'paper fleet');
  A(p, h('h3', '', `Fleet (${fleet.bikes.length})`));
  if (!fleet.bikes.length) p.append(h('p', 'det', 'No bikes yet: add the fleet at the first visit.'));
  const tw = h('div', 'tw');
  const tbl = h('table', 'rep');
  const hd = tbl.createTHead().insertRow();
  for (const x of ['Bike', 'Type', 'Location', 'Photos', '']) { const th = h('th', '', x); th.scope = 'col'; hd.append(th); }
  const tb = tbl.createTBody();
  for (const b of fleet.bikes) {
    const r = tb.insertRow();
    r.dataset.bike = b.number;
    r.insertCell().textContent = b.number;
    r.insertCell().textContent = [b.type, b.year].filter(Boolean).join(' \u00b7 ');
    r.insertCell().textContent = b.location;
    r.insertCell().textContent = String(b.photos?.length || 0);
    const del = button('Delete', 'lnk', () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.textContent = 'Click again to delete';
        setTimeout(() => { delete del.dataset.armed; del.textContent = 'Delete'; }, 5000);
        return;
      }
      deleteFleetBike(c, b);
    });
    const actions = r.insertCell();
    A(actions, button('Edit', 'lnk', () => openFleetForm(c, b)), ' ', del);
  }
  if (fleet.bikes.length) { tw.append(tbl); p.append(tw); }
  if (fleetForm?.companyId === c.id) p.append(fleetFormEl(c));
  else p.append(button('Add a bike', 'alt sm', () => openFleetForm(c, null)));
  return p;
}
function fleetFormEl(c) {
  const f = fleetForm;
  const form = h('form', 'box');
  form.id = 'fleet-form';
  form.noValidate = true;
  form.append(h('h4', '', f.editing ? `Edit ${f.editing.number}` : 'Add a bike'));
  const grid = h('div', 'row');
  for (const [k, label, ph, max] of FLEET_FIELDS) {
    const i = h('input');
    i.type = 'text';
    i.id = `fb-${k}`;
    i.maxLength = max;
    i.placeholder = ph;
    i.dataset.keep = `fb-${k}-${f.id}`;
    i.value = f.editing?.[k] || '';
    grid.append(field(label, i));
  }
  A(form, grid, h('p', 'lb', 'Photos (up to 4; the first is the cover the customer sees)'), f.picker.el);
  if (f.error) form.append(h('p', 'err', f.error));
  const save = h('button', 'pill', f.editing ? 'Save bike' : 'Add bike');
  save.type = 'submit';
  save.disabled = Boolean(f.busy);
  A(form, save, button('Cancel', 'alt', () => { fleetForm = null; render(); }));
  form.onsubmit = (e) => { e.preventDefault(); saveFleetBike(c, form); };
  return form;
}
async function saveFleetBike(c, form) {
  const f = fleetForm;
  const fields = {};
  for (const [k] of FLEET_FIELDS) fields[k] = form.querySelector(`#fb-${k}`).value.trim();
  if (!fields.number) { f.error = 'Give the bike a number, for example #007.'; render(); return; }
  fields.type ||= 'Bike';
  fields.location ||= 'Other';
  f.busy = true;
  f.error = null;
  render();
  try {
    const folder = `companies/${c.id}/bikes/${f.id}`;
    const photos = [];
    for (const ph of f.picker.get()) {
      if (ph.stored) { const { data: _d, stored: _s, ...kept } = ph; photos.push(kept); continue; }
      const put = async (path, dataUrl) => uploadBytes(storageRef(storage, path), await (await fetch(dataUrl)).blob(), { contentType: 'image/jpeg' });
      const path = `${folder}/${ph.id}.jpg`;
      const thumbPath = `${folder}/${ph.id}_thumb.jpg`;
      await Promise.all([put(path, ph.data), put(thumbPath, ph.thumb)]);
      photos.push({ id: ph.id, path, thumbPath, w: ph.w, h: ph.h, uploadedAt: new Date().toISOString() });
    }
    // Photos removed in the form: delete their files.
    const keep = new Set(photos.map((ph) => ph.id));
    const gone = (f.editing?.photos || []).filter((ph) => !keep.has(ph.id));
    await setDoc(doc(db, 'companies', c.id, 'bikes', f.id), { ...fields, photos, updatedAt: serverTimestamp() });
    await Promise.all(gone.flatMap((ph) => [ph.path, ph.thumbPath]).map((path) => deleteObject(storageRef(storage, path)).catch(() => {})));
    for (const el of document.querySelectorAll('#fleet-form [data-dirty]')) delete el.dataset.dirty;
    fleetForm = null;
  } catch (e) {
    f.busy = false;
    f.error = `Could not save the bike: ${e.code || e.message}`;
  }
  render();
}
async function deleteFleetBike(c, b) {
  try {
    await deleteDoc(doc(db, 'companies', c.id, 'bikes', b.id));
    await Promise.all((b.photos || []).flatMap((ph) => [ph.path, ph.thumbPath]).map((path) => deleteObject(storageRef(storage, path)).catch(() => {})));
  } catch (e) {
    showError(`Could not delete ${b.number}: ${e.code || e.message}`);
  }
}

// ---- The monthly fleet report: one row per bike, a status in one tap ----
let reportMonth = R.today().slice(0, 7);
const reportSaved = new Map(); // `${companyId}-${month}` -> message after saving
function reportPanel(c, plan) {
  const p = h('div', 'paper fleet-report');
  const existing = fleet.reports.find((r) => r.id === reportMonth);
  const previous = fleet.reports.find((r) => r.id < reportMonth);
  let start = 'New report.';
  if (existing) start = 'Editing the saved report.';
  else if (previous) start = `New report, starting from ${R.monthLabel(previous.id)}.`;
  A(p, h('h3', '', `Fleet report: ${R.monthLabel(reportMonth)}`), h('p', 'meta', start));
  if (!plan?.monthlyReport) p.append(h('p', 'note', `${c.name} is on the ${plan?.name || c.plan} plan: only the initial fleet report is included.`));
  const row = h('div', 'toolbar');
  const month = h('input');
  month.type = 'month';
  month.id = 'report-month';
  month.value = reportMonth;
  month.onchange = () => { if (R.isMonth(month.value)) { reportMonth = month.value; render(); } };
  const visit = h('input');
  visit.type = 'date';
  visit.id = 'report-visit';
  visit.dataset.keep = `visit-${c.id}-${reportMonth}`;
  visit.value = existing?.visitDate || R.today();
  A(row, field('Month', month), field('Visit date', visit));
  p.append(row);
  if (!fleet.bikes.length) { p.append(h('p', 'det', 'Add the bikes of the fleet first.')); return p; }

  const tw = h('div', 'tw');
  const tbl = h('table', 'rep');
  const hd = tbl.createTHead().insertRow();
  for (const x of ['Bike', 'Status', 'Action', 'Mechanic\u2019s note']) { const th = h('th', '', x); th.scope = 'col'; hd.append(th); }
  const tb = tbl.createTBody();
  for (const b of fleet.bikes) {
    const from = existing?.entries[b.id] || (previous?.entries[b.id] && { ...previous.entries[b.id], note: '' }) || { status: 'ready', action: '\u2013', note: '' };
    const r = tb.insertRow();
    r.dataset.bike = b.id;
    r.insertCell().textContent = `${b.number} \u00b7 ${b.location}`;
    const key = (k) => `rep-${c.id}-${reportMonth}-${b.id}-${k}`;
    const st = select(Object.entries(R.STATUS), from.status);
    st.className = 'rep-status';
    st.dataset.keep = key('status');
    st.setAttribute('aria-label', `Status for ${b.number}`);
    const text = (cls, max, value, label) => {
      const i = h('input');
      i.type = 'text';
      i.className = cls;
      i.maxLength = max;
      i.value = value;
      i.dataset.keep = key(cls);
      i.setAttribute('aria-label', `${label} for ${b.number}`);
      return i;
    };
    r.insertCell().append(st);
    r.insertCell().append(text('rep-action', 200, from.action, 'Action'));
    r.insertCell().append(text('rep-note', 500, from.note, 'Note'));
  }
  tw.append(tbl);
  p.append(tw);
  const saved = reportSaved.get(`${c.id}-${reportMonth}`);
  if (saved) p.append(h('p', saved.startsWith('Could not') ? 'err' : 'ok', saved));
  p.append(button(`Save report and email ${c.contact}`, 'pill', () => saveReport(c, p)));
  return p;
}
async function saveReport(c, panel) {
  const month = reportMonth;
  const entries = {};
  for (const r of panel.querySelectorAll('tbody tr')) {
    entries[r.dataset.bike] = {
      status: r.querySelector('.rep-status').value, action: r.querySelector('.rep-action').value.trim(), note: r.querySelector('.rep-note').value.trim(),
    };
  }
  const k = `${c.id}-${month}`;
  try {
    const res = await callFn('saveFleetReport', { companyId: c.id, month, visitDate: panel.querySelector('#report-visit').value, entries });
    if (res.error) throw new Error(res.error === 'date' ? 'choose the visit date' : res.error);
    const n = res.counts;
    reportSaved.set(k, `Saved. ${c.name} sees the ${R.monthLabel(month)} report in their account (${n.ready} ready, ${n.attention} attention, ${n.repair} repair); the email is in the Outbox.`);
    for (const el of panel.querySelectorAll('[data-dirty]')) delete el.dataset.dirty;
  } catch (e) {
    reportSaved.set(k, `Could not save the report: ${e.message}`);
  }
  render();
}
