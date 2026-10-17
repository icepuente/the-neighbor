// Customer account (account.html): log in, create an account, and see one's own bookings, bikes,
// service history, recommendations and details. A business contact (an account with the custom
// claim `companyId`, set up by the owner with the Function createCompany) sees their company's
// monthly fleet reports, fleet list and plan instead.
//
// Accounts are Firebase Authentication email accounts. The profile (users/{uid}) is created by the
// Function syncAccount, which also links bookings made earlier as a guest once the email address is
// verified. firestore.rules let a customer read only their own profile and bookings.
import { NBF } from './firebase.js';
import { attachAddressSuggest } from './address.js';
import * as R from './shared/booking-rules.js';

const { $, h, A, button, tag, t } = UI;
const { auth, db, sdk } = NBF;
const {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendEmailVerification,
  sendPasswordResetEmail, EmailAuthProvider, linkWithCredential, updateProfile,
} = sdk.auth;
const { collection, doc, onSnapshot, query, where, updateDoc, setDoc, deleteDoc, serverTimestamp } = sdk.firestore;
const { ref: storageRef, uploadBytes, getBlob, deleteObject } = sdk.storage;

const dkk = I18N.dkk;
const fmtDate = I18N.date;
const svcName = I18N.svc;
const locale = I18N.lang === 'da' ? 'da-DK' : 'en-GB';
const callFn = async (name, data) => (await sdk.functions.httpsCallable(NBF.functions, name)(data)).data;

// ---- Log in / create an account ----
function setMode(signup) {
  $('m1').setAttribute('aria-pressed', String(!signup));
  $('m2').setAttribute('aria-pressed', String(signup));
  $('lt').textContent = t(signup ? 'acc.createTitle' : 'acc.welcome');
  $('lf').hidden = signup;
  $('sf').hidden = !signup;
}
$('m1').onclick = () => setMode(false);
$('m2').onclick = () => setMode(true);
const params = new URLSearchParams(location.search);
if (params.get('signup')) {
  setMode(true);
  $('se').value = params.get('signup');
}

// Firebase error codes in the visitor's language.
const AUTH_ERRORS = {
  'auth/invalid-credential': 'wrong', 'auth/wrong-password': 'wrong', 'auth/user-not-found': 'wrong', 'auth/invalid-email': 'nameEmail',
  'auth/email-already-in-use': 'exists', 'auth/credential-already-in-use': 'exists', 'auth/weak-password': 'password',
  'auth/too-many-requests': 'tooMany', 'auth/missing-password': 'wrong',
};
const authError = (e) => t(`acc.err.${AUTH_ERRORS[e.code] || 'server'}`);

$('lf').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('e-l').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, $('le').value.trim(), $('lp').value);
  } catch (err) {
    $('e-l').textContent = authError(err);
  }
});

// While an account is being created, the sign-in event waits for the profile to exist.
let signingUp = false;
$('sf').addEventListener('submit', async (e) => {
  e.preventDefault();
  const profile = { name: $('sn').value.trim(), phone: $('sp').value.trim() };
  const email = $('se').value.trim();
  const password = $('sw').value;
  $('e-s').textContent = '';
  if (!profile.name || !R.isEmail(email)) { $('e-s').textContent = t('acc.err.nameEmail'); return; }
  if (password.length < 8) { $('e-s').textContent = t('acc.err.password'); return; }
  signingUp = true;
  try {
    // A guest who attached photos already has an anonymous session: turn it into the account, so
    // the same user keeps what it uploaded.
    const cred = auth.currentUser?.isAnonymous
      ? await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password))
      : await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: profile.name });
    await callFn('syncAccount', { profile });
    sendEmailVerification(cred.user).catch(() => {});
    signingUp = false;
    await enter(cred.user);
  } catch (err) {
    signingUp = false;
    $('e-s').textContent = authError(err);
  }
});

$('forgot').onclick = async () => {
  const email = $('le').value.trim();
  $('e-l').textContent = '';
  if (!R.isEmail(email)) { $('e-l').textContent = t('acc.forgotEmail'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
  } catch { /* the same answer either way, so it does not reveal who has an account */ }
  $('forgot-ok').hidden = false;
  $('forgot-ok').textContent = t('acc.forgotSent', { email });
};
$('out').onclick = () => signOut(auth);

// The demo shows its customer login (fake data only, wiped daily).
if (NBF.environment !== 'production') {
  const hint = $('demo-login');
  hint.hidden = false;
  A(hint, `${t('acc.demoLogin')} `, button(t('acc.fill'), 'lnk', () => { $('le').value = 'anna@demo.dk'; $('lp').value = 'neighbor-demo'; }));
  const business = button(t('acc.fill'), 'lnk', () => { $('le').value = 'hotel@demo.dk'; $('lp').value = 'neighbor-demo'; });
  business.id = 'demo-business';
  A(hint, h('br'), `${t('acc.demoBusiness')} `, business);
}

// ---- Signed in ----
const unsubscribe = [];
const stop = () => { while (unsubscribe.length) unsubscribe.pop()(); };
let me = null;
let profile = null;
let bookings = [];
let myBikes = [];
let records = [];
let recommendations = [];
let current = 0;
// A business contact's company, its fleet and its monthly reports (newest first).
let company = null;
let fleetBikes = [];
let reports = [];

onAuthStateChanged(auth, async (user) => {
  if (signingUp) return;
  stop();
  $('loading').hidden = true;
  if (!user || user.isAnonymous) { show('login'); return; }
  if ((await user.getIdTokenResult()).claims.admin === true) { show('owner'); return; }
  await enter(user);
});

function show(section) {
  for (const id of ['login', 'app', 'owner']) $(id).hidden = id !== section;
  $('out').hidden = section === 'login';
}

async function enter(user) {
  me = user;
  current = 0;
  show('app');
  const { companyId } = (await user.getIdTokenResult()).claims;
  if (companyId) { enterBusiness(companyId); return; }
  tabs = PRIVATE_TABS;
  // Creates the profile if a sign-up was interrupted, and links guest bookings once verified.
  try {
    const r = await callFn('syncAccount', { profile: { name: user.displayName || user.email.split('@')[0] } });
    if (r.linked) note(t('acc.linked', { n: r.linked }));
  } catch { /* shown as missing data below */ }
  showVerify();
  unsubscribe.push(onSnapshot(doc(db, 'users', user.uid), (s) => { profile = s.data() || null; render(); }));
  unsubscribe.push(onSnapshot(query(collection(db, 'bookings'), where('customerUid', '==', user.uid)), (s) => {
    bookings = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }));
  unsubscribe.push(onSnapshot(collection(db, 'users', user.uid, 'bikes'), (s) => {
    myBikes = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
    render();
  }));
  // Service records and recommendations, written when the owner logs a visit.
  unsubscribe.push(onSnapshot(query(collection(db, 'serviceRecords'), where('customerUid', '==', user.uid)), (s) => {
    records = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.date.localeCompare(a.date));
    render();
  }));
  unsubscribe.push(onSnapshot(query(collection(db, 'recommendations'), where('customerUid', '==', user.uid)), (s) => {
    recommendations = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }));
}

function enterBusiness(id) {
  tabs = BUSINESS_TABS;
  $('verify').hidden = true;
  const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  unsubscribe.push(onSnapshot(doc(db, 'companies', id), (s) => { company = s.exists() ? { id, ...s.data() } : null; render(); }));
  unsubscribe.push(onSnapshot(collection(db, 'companies', id, 'bikes'), (s) => {
    fleetBikes = list(s).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    render();
  }));
  unsubscribe.push(onSnapshot(collection(db, 'companies', id, 'reports'), (s) => {
    reports = list(s).sort((a, b) => b.month.localeCompare(a.month));
    render();
  }));
}

const note = (msg) => { $('verify-msg').textContent = msg; };

// Email verification: guest bookings join the account only once the address is confirmed.
function showVerify() {
  $('verify').hidden = me.emailVerified;
  $('verify-demo').hidden = NBF.environment === 'production';
}
async function afterVerified() {
  await me.reload();
  await me.getIdToken(true);
  if (!auth.currentUser.emailVerified) { note(t('acc.notVerifiedYet')); return; }
  const r = await callFn('syncAccount', {});
  $('verify').hidden = true;
  $('hs').dataset.fixed = '1';
  $('hs').textContent = t('acc.verified', { n: r.linked || 0 });
}
$('verify-again').onclick = async () => {
  try { await sendEmailVerification(me); note(t('acc.verifySent', { email: me.email })); } catch { note(t('acc.err.tooMany')); }
};
$('verify-done').onclick = () => afterVerified().catch(() => note(t('acc.err.server')));
$('verify-demo').onclick = async () => {
  try { await callFn('demoVerifyEmail', {}); await afterVerified(); } catch { note(t('acc.err.server')); }
};

// ---- Tabs ----
const upcoming = () => bookings.filter((b) => b.date >= R.today() && ['pending', 'confirmed'].includes(b.status))
  .sort((a, b) => (a.date + a.arrival).localeCompare(b.date + b.arrival));
const PRIVATE_TABS = [
  [() => t('tab.overview'), overview],
  [() => t('tab.bookings'), bookingsView, () => upcoming().length],
  [() => t('tab.history'), historyView],
  [() => t('tab.bikes'), bikesView],
  [() => t('tab.recs'), recsView, () => openRecs().length],
  [() => t('tab.profile'), profileView],
];
const BUSINESS_TABS = [
  [() => t('tab.report'), reportView],
  [() => t('tab.fleet'), fleetView],
  [() => t('tab.plan'), planView],
];
let tabs = PRIVATE_TABS;

function render() {
  if (!me) return;
  const first = (profile?.name || me.displayName || '').split(' ')[0];
  $('hi').textContent = t('acc.hello', { name: first });
  if (tabs === BUSINESS_TABS) {
    if (!company) return;
    const plan = R.PLANS.find((p) => p.id === company.plan);
    $('hi').textContent = company.name;
    $('hs').textContent = t('plan.header', { plan: plan?.name || company.plan, price: dkk(company.pricePerBike), n: fleetBikes.length })
      + (company.nextVisit ? t('plan.nextVisit', { date: fmtDate(company.nextVisit) }) : '');
  } else if (profile?.createdAt?.toDate && !$('hs').dataset.fixed) {
    $('hs').textContent = t('acc.since', { month: profile.createdAt.toDate().toLocaleDateString(locale, { month: 'long', year: 'numeric' }) });
  }
  const bar = $('tabs');
  bar.textContent = '';
  tabs.forEach(([label, , count], i) => {
    const b = button(label(), '', () => { current = i; render(); });
    const n = count?.();
    if (n) b.append(h('span', 'count', String(n)));
    if (i === current) b.setAttribute('aria-current', 'page');
    bar.append(b);
  });
  // Keep typed text in the profile form through live updates.
  const v = $('view');
  const keep = [...v.querySelectorAll('[data-keep]')].filter((el) => el.dataset.dirty).map((el) => [el.dataset.keep, el.value]);
  v.textContent = '';
  tabs[current][1](v);
  for (const [k, val] of keep) { const el = v.querySelector(`[data-keep="${k}"]`); if (el) { el.value = val; el.dataset.dirty = '1'; } }
}
document.addEventListener('input', (e) => { if (e.target.dataset?.keep) e.target.dataset.dirty = '1'; });

function overview(v) {
  const g = h('div', 'grid');
  const next = upcoming()[0];
  const c = h('div', 'paper');
  c.append(h('h3', '', t('ov.next')));
  if (next) {
    A(c, h('p', '', t('dateAt', { date: fmtDate(next.date), time: next.arrival })),
      h('p', '', next.services.map(svcName).join(', ')), tag(next.status, t(`bs.${next.status}`)));
  } else {
    const link = h('a', 'pill', t('nav.book'));
    link.href = 'index.html#book';
    A(c, h('p', '', t('ov.none')), link);
  }
  g.append(c);
  const last = records[0];
  if (last) {
    const c1 = h('div', 'paper');
    A(c1, h('h3', '', t('ov.last')), h('p', '', `${fmtDate(last.date)} · ${last.title}${last.bikeName ? ` · ${last.bikeName}` : ''}`), h('p', '', last.notes || ''));
    g.append(c1);
  }
  const rec = openRecs()[0];
  if (rec) {
    const c2 = h('div', 'paper');
    A(c2, h('h3', '', t('ov.rec')), h('p', '', rec.title + (rec.bikeName ? ` (${rec.bikeName})` : '')), h('p', '', rec.reason || ''),
      button(t('ov.allRecs'), 'alt sm', () => { current = tabs.findIndex(([, fn]) => fn === recsView); render(); }));
    g.append(c2);
  }
  v.append(g);
}

// Open recommendations, the urgent ones first.
const openRecs = () => recommendations.filter((r) => r.status === 'open')
  .sort((a, b) => (a.urgency === 'soon' ? 0 : 1) - (b.urgency === 'soon' ? 0 : 1));

// ---- History: one record per logged visit, the newest open ----
function historyView(v) {
  if (!records.length) { v.append(h('p', 'sub', t('hist.empty'))); return; }
  records.forEach((r, i) => {
    const d = h('details', 'paper record');
    d.dataset.ref = r.bookingRef || '';
    if (i === 0) d.open = true;
    const body = h('div', 'body');
    const ul = h('ul');
    for (const w of r.work) ul.append(h('li', '', w));
    A(body, h('h4', '', t('hist.work')), ul);
    if (r.parts.length) {
      const pl = h('ul');
      for (const p of r.parts) pl.append(h('li', '', `${p.name} · ${dkk(p.price)}`));
      A(body, h('h4', '', t('hist.parts')), pl);
    }
    if (r.notes) A(body, h('h4', '', t('hist.notes')), h('p', '', r.notes));
    if (r.photos?.length) {
      const row = h('div', 'pics-grid');
      r.photos.forEach((p, k) => {
        const btn = h('button', 'pic');
        btn.type = 'button';
        const img = h('img');
        img.alt = t('hist.photo', { n: k + 1 });
        photoUrl(p.thumbPath).then((u) => { img.src = u; }, () => {});
        btn.onclick = async () => UI.openPhoto(await photoUrl(p.path), img.alt);
        btn.append(img);
        row.append(btn);
      });
      body.append(row);
    }
    body.append(h('h4', '', t('hist.cost')));
    const row2 = (a, b, total) => { const e = h('div', `row2${total ? ' t' : ''}`); A(e, h('span', '', a), h('span', '', b)); body.append(e); };
    row2(r.title, dkk(r.cost.service));
    for (const p of r.parts) row2(p.name, dkk(p.price));
    row2(t('hist.travel'), dkk(r.cost.travel));
    row2(t('hist.total'), dkk(r.cost.total), true);
    A(d, h('summary', '', `${fmtDate(r.date)} · ${r.title}${r.bikeName ? ` · ${r.bikeName}` : ''}`), body);
    v.append(d);
  });
}

// ---- Recommendations from the mechanic ----
function recsView(v) {
  const open = openRecs();
  if (!open.length) { v.append(h('p', 'sub', t('rec.empty'))); return; }
  const g = h('div', 'grid');
  for (const r of open) {
    const c = h('div', 'paper rec');
    const link = h('a', 'pill', t('rec.book'));
    link.href = 'index.html#book';
    A(c, tag(r.urgency === 'soon' ? 'soon' : 'pending', t(`rec.${r.urgency}`)), h('h3', '', r.title),
      h('p', 'meta', [r.bikeName, r.dueBy].filter(Boolean).join(' · ')), h('p', '', r.reason || ''), link);
    g.append(c);
  }
  v.append(g);
}

function bookingsView(v) {
  const up = upcoming();
  const past = bookings.filter((b) => !up.includes(b)).sort((a, b) => (b.date + b.arrival).localeCompare(a.date + a.arrival));
  v.append(h('h3', '', t('bks.upcoming')));
  if (!up.length) v.append(h('p', 'sub', t('bks.none')));
  for (const b of up) v.append(bookingCard(b));
  if (past.length) {
    v.append(h('h3', '', t('bks.earlier')));
    for (const b of past) v.append(bookingCard(b));
  }
  const link = h('a', 'pill', t('bks.new'));
  link.href = 'index.html#book';
  link.style.marginTop = '16px';
  v.append(link);
}

function bookingCard(b) {
  const c = h('div', 'paper my-booking');
  c.dataset.ref = b.ref;
  c.style.marginBottom = '12px';
  A(c, tag(b.status, t(`bs.${b.status}`)), h('h3', '', t('dateAt', { date: fmtDate(b.date), time: b.arrival })),
    h('p', 'meta', `${b.ref} · ${b.bikeType || ''} · ${R.fullAddress(b.address, b.apartment)}`));
  const ul = h('ul');
  for (const s of b.services) ul.append(h('li', '', `${svcName(s)}: ${dkk(s.price)}${s.monthly ? ` ${t('perMonth')}` : ''}`));
  c.append(ul);
  if (b.pricing.travel != null) c.append(h('p', 'det', t('bks.price', { travel: dkk(b.pricing.travel), total: dkk(b.pricing.total) })));
  if (['pending', 'confirmed'].includes(b.status)) {
    if (R.customerCanCancel(b)) {
      // Two clicks, so it cannot happen by accident.
      const btn = button(t('bks.cancel'), 'alt sm', async () => {
        if (!btn.dataset.armed) {
          btn.dataset.armed = '1';
          btn.textContent = t('bks.cancelArmed');
          setTimeout(() => { delete btn.dataset.armed; btn.textContent = t('bks.cancel'); }, 5000);
          return;
        }
        btn.disabled = true;
        const r = await callFn('cancelMyBooking', { bookingId: b.id }).catch(() => ({ error: 'server' }));
        if (r.error) { btn.disabled = false; c.append(h('p', 'err', t(r.error === 'late' ? 'bks.late' : 'acc.err.server'))); }
      });
      c.append(btn);
    } else {
      c.append(h('p', 'det', t('bks.late', { hours: R.CONFIG.cancelHours })));
    }
  }
  return c;
}

// The result of the last save, shown again after a re-draw: Firestore reports the local change
// (and the form is re-drawn) before the save itself has finished.
let profileNote = null;
function profileView(v) {
  const p = profile || {};
  const form = h('form', 'box narrow profile');
  form.noValidate = true;
  const input = (id, label, value, opts = {}) => {
    const wrap = h('div');
    const l = h('label', '', label);
    l.htmlFor = id;
    const i = h('input');
    i.id = id;
    i.type = opts.type || 'text';
    i.value = value || '';
    if (opts.max) i.maxLength = opts.max;
    if (opts.auto) i.autocomplete = opts.auto;
    i.dataset.keep = id;
    A(wrap, l, i);
    return wrap;
  };
  const ok = h('p', 'ok');
  ok.hidden = profileNote?.kind !== 'ok';
  ok.textContent = profileNote?.kind === 'ok' ? profileNote.text : '';
  const err = h('p', 'err', profileNote?.kind === 'err' ? profileNote.text : '');
  form.addEventListener('input', () => { profileNote = null; ok.hidden = true; });
  A(form, h('h3', '', t('prof.title')),
    input('pf-name', t('f.name'), p.name, { max: 100, auto: 'name' }),
    input('pf-phone', t('f.phone'), p.phone, { type: 'tel', max: 40, auto: 'tel' }),
    input('pf-addr', t('bk.address'), p.address, { max: 200 }),
    input('pf-apt', t('bk.apartment'), p.apartment, { max: 40, auto: 'address-line2' }),
    h('p', 'det', t('prof.email', { email: me.email })), err, ok);
  const save = h('button', 'pill', t('prof.save'));
  save.type = 'submit';
  form.append(save);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const val = (id) => form.querySelector(`#${id}`).value.trim();
    const next = { name: val('pf-name'), phone: val('pf-phone'), address: val('pf-addr'), apartment: val('pf-apt') };
    profileNote = null;
    if (!next.name) { profileNote = { kind: 'err', text: t('acc.err.nameEmail') }; render(); return; }
    try {
      await updateDoc(doc(db, 'users', me.uid), next);
      // Saved: the fields no longer hold unsaved text (look them up again: the form may be new).
      for (const el of document.querySelectorAll('form.profile [data-dirty]')) delete el.dataset.dirty;
      profileNote = { kind: 'ok', text: t('prof.saved') };
    } catch {
      profileNote = { kind: 'err', text: t('acc.err.server') };
    }
    render();
  };
  v.append(form);
  attachAddressSuggest(form.querySelector('#pf-addr'), {
    label: t('bk.suggestions'),
    search: async (q) => (await callFn('addressSearch', { q })).suggestions || [],
    onPick: () => form.querySelector('#pf-apt').focus(),
  });
}

// ---- My bikes: saved bikes with up to 4 photos (the first is the cover) ----
// Photos live in Cloud Storage under users/{uid}/bikes/{bikeId}/ (storage.rules); the bike document
// lists them. Files are read with the customer's sign-in and shown from local object URLs.
const blobUrls = new Map();
const photoUrl = (path) => {
  if (!blobUrls.has(path)) blobUrls.set(path, getBlob(storageRef(NBF.storage, path)).then((b) => URL.createObjectURL(b)));
  return blobUrls.get(path);
};
const BIKE_FIELDS = [
  ['name', 'bike.name', 'bike.namePh', 80], ['type', 'bike.type', 'bike.typePh', 80], ['year', 'bike.year', '', 10],
  ['size', 'bike.size', '', 40], ['gears', 'bike.gears', '', 60], ['brakes', 'bike.brakes', '', 60], ['tyres', 'bike.tyres', '', 60],
  ['colour', 'bike.colour', '', 40], ['usage', 'bike.usageLabel', 'bike.usagePh', 200],
];
// The form's state lives here, not in the page, so live re-draws keep its photos.
let bikeForm = null; // { id, editing, picker, error, busy }

async function openBikeForm(bike) {
  const initial = [];
  for (const p of bike?.photos || []) {
    // Existing photos are shown from their thumbnails and kept as they are when saved.
    initial.push({ ...p, data: await photoUrl(p.thumbPath).catch(() => ''), stored: true });
  }
  bikeForm = {
    id: bike ? bike.id : doc(collection(db, 'users', me.uid, 'bikes')).id,
    editing: bike || null,
    picker: UI.photoPicker({ max: R.CONFIG.maxBikePhotos, initial, id: 'nb-photos', full: 1600, quality: 0.8, thumb: 320 }),
  };
  render();
  document.getElementById('bike-form')?.scrollIntoView({ block: 'start' });
}

function bikesView(v) {
  if (!myBikes.length) v.append(h('p', 'sub', t('bike.none')));
  const g = h('div', 'grid');
  for (const b of myBikes) {
    const c = h('div', 'paper bike-card');
    c.dataset.bike = b.name;
    const photos = b.photos || [];
    if (photos.length) {
      const cover = h('button', 'cover');
      cover.type = 'button';
      const img = h('img');
      img.alt = t('pics.ofBike', { name: b.name });
      photoUrl(photos[0].thumbPath).then((u) => { img.src = u; }, () => {});
      cover.onclick = async () => UI.openPhoto(await photoUrl(photos[0].path), img.alt);
      cover.append(img);
      c.append(cover);
    }
    A(c, h('h3', '', b.name), h('p', '', [b.type, b.year].filter(Boolean).join(' · ')), UI.defList([
      [t('bike.size'), b.size], [t('bike.gears'), b.gears], [t('bike.brakes'), b.brakes], [t('bike.tyres'), b.tyres],
      [t('bike.colour'), b.colour], [t('bike.usage'), b.usage],
    ]));
    if (photos.length > 1) {
      const row = h('div', 'pics-grid');
      photos.slice(1).forEach((p, i) => {
        const btn = h('button', 'pic');
        btn.type = 'button';
        const img = h('img');
        img.alt = t('pics.alt', { n: i + 2 });
        photoUrl(p.thumbPath).then((u) => { img.src = u; }, () => {});
        btn.onclick = async () => UI.openPhoto(await photoUrl(p.path), img.alt);
        btn.append(img);
        row.append(btn);
      });
      c.append(row);
    }
    c.append(button(t('bike.edit'), 'alt sm', () => openBikeForm(b)));
    // Deleting takes two clicks, and removes the photos too.
    const del = button(t('bike.delete'), 'alt sm', async () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.textContent = t('bike.deleteArmed');
        setTimeout(() => { delete del.dataset.armed; del.textContent = t('bike.delete'); }, 5000);
        return;
      }
      del.disabled = true;
      await Promise.all(photos.flatMap((p) => [p.path, p.thumbPath]).map((path) => deleteObject(storageRef(NBF.storage, path)).catch(() => {})));
      await deleteDoc(doc(db, 'users', me.uid, 'bikes', b.id));
      if (bikeForm?.id === b.id) bikeForm = null;
    });
    c.append(del);
    g.append(c);
  }
  v.append(g);

  if (!bikeForm) {
    v.append(button(t('bike.add'), 'pill', () => openBikeForm(null)));
    return;
  }
  const f = bikeForm;
  const e = f.editing;
  const form = h('form', 'box');
  form.id = 'bike-form';
  form.noValidate = true;
  form.style.maxWidth = '640px';
  form.append(h('h2', '', e ? t('bike.editTitle', { name: e.name }) : t('bike.add')));
  const grid = h('div', 'row');
  for (const [k, label, ph, max] of BIKE_FIELDS) {
    const wrap = h('div');
    const l = h('label', '', t(label));
    const i = h('input');
    i.type = 'text';
    i.id = `nb-${k}`;
    i.maxLength = max;
    if (ph) i.placeholder = t(ph);
    i.value = e?.[k] || '';
    i.dataset.keep = `nb-${k}`;
    l.htmlFor = i.id;
    A(wrap, l, i);
    grid.append(wrap);
  }
  const photoLabel = h('label', 'lb', t('bike.photos'));
  photoLabel.htmlFor = 'nb-photos';
  const err = h('p', 'err', f.error || '');
  err.setAttribute('role', 'alert');
  const submit = h('button', 'pill', t(e ? 'bike.saveChanges' : 'bike.save'));
  submit.type = 'submit';
  submit.disabled = Boolean(f.busy);
  A(form, grid, photoLabel, h('p', 'det', t('bike.photosHint')), f.picker.el, err, submit,
    button(t('bike.cancel'), 'alt', () => { bikeForm = null; render(); }));
  form.onsubmit = (ev) => { ev.preventDefault(); saveBike(form); };
  v.append(form);
}

async function saveBike(form) {
  const f = bikeForm;
  const fields = {};
  for (const [k] of BIKE_FIELDS) fields[k] = form.querySelector(`#nb-${k}`).value.trim();
  if (!fields.name) { f.error = t('bike.err'); render(); return; }
  f.busy = true;
  f.error = null;
  render();
  try {
    const folder = `users/${me.uid}/bikes/${f.id}`;
    const photos = [];
    for (const p of f.picker.get()) {
      if (p.stored) { const { data: _d, stored: _s, ...kept } = p; photos.push(kept); continue; }
      const put = async (path, dataUrl) => uploadBytes(storageRef(NBF.storage, path), await (await fetch(dataUrl)).blob(), { contentType: 'image/jpeg' });
      const path = `${folder}/${p.id}.jpg`;
      const thumbPath = `${folder}/${p.id}_thumb.jpg`;
      await Promise.all([put(path, p.data), put(thumbPath, p.thumb)]);
      photos.push({ id: p.id, path, thumbPath, w: p.w, h: p.h, uploadedAt: new Date().toISOString() });
    }
    // Photos removed in the form: delete their files.
    const keep = new Set(photos.map((p) => p.id));
    const gone = (f.editing?.photos || []).filter((p) => !keep.has(p.id));
    await setDoc(doc(db, 'users', me.uid, 'bikes', f.id), { ...fields, photos, updatedAt: serverTimestamp() });
    await Promise.all(gone.flatMap((p) => [p.path, p.thumbPath]).map((path) => deleteObject(storageRef(NBF.storage, path)).catch(() => {})));
    for (const el of document.querySelectorAll('#bike-form [data-dirty]')) delete el.dataset.dirty;
    bikeForm = null;
  } catch {
    f.busy = false;
    f.error = t('acc.err.server');
  }
  render();
}

// ---- Business: monthly fleet report, fleet list, plan ----
const statusLabel = (s) => t(`st.${s}`);
const monthName = (m) => R.monthLabel(m, locale);
function stat(value, label) {
  const c = h('div', 'card');
  A(c, h('div', 'stat', String(value)), h('small', '', label));
  return c;
}
// Thumbnails of photos in Storage that open full size; `label(n)` names photo n.
function storagePhotos(photos, label, from = 0) {
  const row = h('div', 'pics-grid');
  photos.forEach((p, i) => {
    const btn = h('button', 'pic');
    btn.type = 'button';
    const img = h('img');
    img.alt = label(from + i + 1);
    photoUrl(p.thumbPath).then((u) => { img.src = u; }, () => {});
    btn.onclick = async () => UI.openPhoto(await photoUrl(p.path), img.alt);
    btn.append(img);
    row.append(btn);
  });
  return row;
}

let reportMonth = null;
let reportBike = null; // the bike whose details are open under the report
function reportView(v) {
  if (!reports.length) { v.append(h('p', 'sub', t('rep.empty'))); return; }
  if (!reports.some((r) => r.id === reportMonth)) reportMonth = reports[0].id;
  const rep = reports.find((r) => r.id === reportMonth);

  const top = h('div', 'toolbar');
  const wrap = h('div');
  const lb = h('label', '', t('rep.month'));
  const sel = h('select');
  sel.id = 'mo';
  lb.htmlFor = 'mo';
  for (const r of reports) sel.append(new Option(monthName(r.id), r.id, false, r.id === reportMonth));
  sel.onchange = () => { reportMonth = sel.value; reportBike = null; render(); };
  A(wrap, lb, sel);
  A(top, wrap, button(t('rep.print'), 'alt sm print', () => window.print()));
  v.append(top);

  const n = R.fleetCounts(rep.entries);
  const g = h('div', 'grid stats');
  A(g, stat(t('rep.of', { a: n.ready, b: Object.keys(rep.entries).length }), t('rep.ready')), stat(n.attention, t('rep.attention')), stat(n.repair, t('rep.repair')));
  v.append(g);

  const p = h('div', 'paper report');
  A(p, h('h3', '', t('rep.title', { company: company.name, month: monthName(rep.id) })), h('p', 'meta', t('rep.visit', { date: fmtDate(rep.visitDate) })));
  const tbl = h('table', 'rep');
  const hd = tbl.createTHead().insertRow();
  for (const x of ['col.bike', 'col.location', 'col.status', 'col.action']) { const th = h('th', '', t(x)); th.scope = 'col'; hd.append(th); }
  const tb = tbl.createTBody();
  for (const b of fleetBikes) {
    const e = rep.entries[b.id];
    if (!e) continue;
    const r = tb.insertRow();
    r.dataset.bike = b.number;
    const btn = button(b.number, 'lnk', () => { reportBike = reportBike === b.id ? null : b.id; render(); });
    btn.setAttribute('aria-label', t('rep.details', { n: b.number }));
    btn.setAttribute('aria-expanded', String(reportBike === b.id));
    r.insertCell().append(btn);
    r.insertCell().textContent = b.location;
    const sc = r.insertCell();
    sc.className = `st ${e.status}`;
    sc.textContent = statusLabel(e.status);
    r.insertCell().textContent = e.action;
  }
  const tw = h('div', 'tw');
  tw.append(tbl);
  A(p, tw, h('p', 'meta no-print', t('rep.hint')));
  const b = fleetBikes.find((x) => x.id === reportBike);
  const e = b && rep.entries[b.id];
  if (e) {
    const box = h('div', 'bike-detail');
    box.setAttribute('aria-live', 'polite');
    A(box, h('h3', '', t('rep.bike', { n: b.number })), UI.defList([
      [t('col.bike'), [b.number, b.type, b.year && `(${b.year})`].filter(Boolean).join(' · ')], [t('col.location'), b.location],
      [t('rep.size'), b.size], [t('bike.gears'), b.gears], [t('bike.brakes'), b.brakes], [t('col.status'), statusLabel(e.status)],
      [t('col.action'), e.action], [t('rep.note'), e.note],
    ]));
    if (b.photos?.length) box.append(storagePhotos(b.photos, (k) => t('pics.ofFleetBike', { bike: b.number, n: k })));
    p.append(box);
  }
  v.append(p);
  v.append(h('p', 'sub', t('rep.foot')));
}

function fleetView(v) {
  const latest = reports[0];
  v.append(h('p', 'sub', t('fleet.count', { n: fleetBikes.length })));
  for (const loc of [...new Set(fleetBikes.map((b) => b.location))]) {
    v.append(h('h3', '', loc));
    const g = h('div', 'grid');
    for (const b of fleetBikes.filter((x) => x.location === loc)) {
      const e = latest?.entries[b.id];
      const card = h('div', 'paper bike-card fleet-bike');
      card.dataset.bike = b.number;
      const photos = b.photos || [];
      const alt = (n) => t('pics.ofFleetBike', { bike: b.number, n });
      if (photos.length) {
        const cover = h('button', 'cover');
        cover.type = 'button';
        const img = h('img');
        img.alt = alt(1);
        photoUrl(photos[0].thumbPath).then((u) => { img.src = u; }, () => {});
        cover.onclick = async () => UI.openPhoto(await photoUrl(photos[0].path), img.alt);
        cover.append(img);
        card.append(cover);
      }
      A(card, h('h3', '', `${b.number} · ${b.type}`), e ? h('p', `st ${e.status}`, statusLabel(e.status)) : null,
        UI.defList([[t('bike.year'), b.year], [t('rep.size'), b.size], [t('bike.gears'), b.gears], [t('bike.brakes'), b.brakes]]));
      if (photos.length > 1) card.append(storagePhotos(photos.slice(1), alt, 1));
      g.append(card);
    }
    v.append(g);
  }
}

function planView(v) {
  const plan = R.PLANS.find((p) => p.id === company.plan);
  const n = fleetBikes.length;
  const g = h('div', 'grid');
  const p1 = h('div', 'paper');
  const ul = h('ul');
  for (const x of (I18N.lang === 'da' ? plan.includesDa : plan.includes)) ul.append(h('li', '', x));
  A(p1, h('h3', '', t('plan.name', { plan: plan.name })), h('p', 'price', `${dkk(company.pricePerBike * n)} ${t('perMonth')}`),
    h('p', 'det', t('plan.calc', { n, price: dkk(company.pricePerBike) })), ul, h('p', 'no', t('rep.foot')));
  const p2 = h('div', 'paper');
  A(p2, h('h3', '', t('plan.visits')), UI.defList([
    [t('plan.next'), company.nextVisit ? fmtDate(company.nextVisit) : t('plan.tba')],
    [t('plan.since'), company.since ? fmtDate(company.since) : '–'],
    [t('plan.contact'), company.contact], [t('f.email'), company.email], [t('f.phone'), company.phone],
  ]), h('p', 'det', t('plan.help')));
  A(g, p1, p2);
  v.append(g);
}
