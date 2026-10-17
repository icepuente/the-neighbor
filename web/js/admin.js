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
const { ref: storageRef, getBlob, uploadBytes } = sdk.storage;

const dkk = (n) => `${Math.round(n).toLocaleString('da-DK')} DKK`;
const fmtDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (ts) => (ts?.toDate ? ts.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: R.TIME_ZONE }) : '');

// ---- Live data: each collection is watched once; tabs re-draw from these lists ----
const data = { bookings: [], consultations: [], closedDates: [], mail: [], users: [], recommendations: [], serviceRecords: [] };
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
  ['Requests', requestsView, () => data.consultations.filter((c) => c.status === 'new' && !c.archived).length],
  ['Customers', customersView],
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
    st.onchange = () => updateDoc(doc(db, 'consultations', l.id), { status: st.value })
      .catch((e) => showError(`Could not update: ${e.code || e.message}`));
    bar.append(field('Status', st));
    bar.append(l.archived
      ? button('Restore', 'alt sm', () => setArchived(l, false))
      : button('Archive', 'alt sm', () => setArchived(l, true)));
    c.dataset.company = l.company;
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
