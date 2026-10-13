// Fake backend for the mock site. It stands in for Firebase so the pages can be clicked through:
// data lives in this browser's localStorage, laid out like the Firestore collections in
// docs/firebase-plan.md (section 4), and NB.fn mirrors the planned Cloud Functions.
// Nothing leaves the browser; "emails" are written to a `mail` collection shown in the dashboard.
(function () {
  'use strict';

  // v2: the owner's service list of 2026-10-13. A new key replaces stale sample data in old browsers.
  const KEY = 'neighbor-mock-v3';
  const SESSION = 'neighbor-mock-session';

  const CONFIG = {
    businessName: 'The Neighbor',
    email: 'hello@example.com',
    base: 'Rørsangervej 45, København',
    kmRate: 2.5,
    maxKm: 18,
    // 5% off the whole order when The Neighbor Bike Check is booked with other services, or for Care
    // Plus members. The two never stack: an order gets at most one 5%.
    comboOff: 0.05,
    carePlusOff: 0.05,
    subscriptionMinMonths: 3,
    // Open Monday to Saturday. Work starts from 08:30 and must be finished by 15:30.
    openFrom: 8 * 60 + 30,
    workEnd: 15 * 60 + 30,
    startStep: 30,
    closedWeekdays: [0],
    // A booking takes at most 45 minutes of work; travel comes on top, with 15 minutes between jobs.
    maxWorkMin: 45,
    travelBufferMin: 15,
    consentVersion: '2026-10',
  };

  // The owner's service list (2026-10-13). durationMin is the top of the owner's range, so the
  // calendar never runs short; `mins` is the range shown to customers.
  const SERVICES = [
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
  const svc = (id) => SERVICES.find((s) => s.id === id);

  const PLANS = [
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

  const STATUS = { ready: 'Ready', attention: 'Attention', repair: 'Repair needed' };

  // ---- Dates ----
  function isoDate(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  const today = () => isoDate(new Date());
  function addDays(date, n) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  // Every start time in the day, ignoring bookings; used for the consultation form.
  function arrivalTimes() {
    const out = [];
    for (let m = CONFIG.openFrom; m + CONFIG.maxWorkMin <= CONFIG.workEnd; m += CONFIG.startStep) out.push(hhmm(m));
    return out;
  }
  // The first open day on or after `date` (seed data must not land on a Sunday).
  function nextOpenDay(date) {
    let d = date;
    while (CONFIG.closedWeekdays.includes(new Date(`${d}T12:00:00`).getDay())) d = addDays(d, 1);
    return d;
  }
  const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
  function addMonths(date, n) {
    const d = new Date(`${date}T12:00:00`);
    d.setMonth(d.getMonth() + n);
    return isoDate(d);
  }

  // ---- Sample data (from the account-preview document) ----
  function seed() {
    const t = today();
    const open = (n) => nextOpenDay(addDays(t, n));
    const block = (workMin) => ({ workMin, blockMin: workMin + CONFIG.travelBufferMin });
    const fleet = [
      ['#001', 'City bike', 'Reception', 2022, 'M', '7-speed', 'Rim', ['ready', '–', 'All checks passed.'], ['ready', '–', 'All checks passed.']],
      ['#002', 'City bike', 'Reception', 2022, 'M', '7-speed', 'Rim', ['ready', '–', 'All checks passed.'], ['attention', 'Brake adjustment', 'Rear brake is rubbing. Adjusted at the next visit.']],
      ['#003', 'Hybrid', 'Garage', 2021, 'L', '21-speed', 'Disc', ['attention', 'Tyre pressure', 'Pressure low. Corrected.'], ['repair', 'Inner tube', 'Slow puncture in the front tyre. Tube is outside the plan. We confirm the price before any work.']],
      ['#004', 'Hybrid', 'Garage', 2021, 'L', '21-speed', 'Disc', ['ready', '–', 'All checks passed.'], ['ready', '–', 'All checks passed.']],
      ['#005', 'City bike', 'Terrace', 2020, 'M', '3-speed hub', 'Coaster', ['ready', '–', 'All checks passed.'], ['attention', 'Gear adjustment', 'Hub gear needs adjusting.']],
      ['#006', 'City bike', 'Terrace', 2020, 'S', '3-speed hub', 'Coaster', ['ready', '–', 'All checks passed.'], ['ready', '–', 'All checks passed.']],
      ['#007', 'Hybrid', 'Garage', 2019, 'M', '21-speed', 'Rim', ['attention', 'Wheel check', 'Slight wobble noted.'], ['repair', 'Rear wheel', 'Wheel is out of true. Repair is outside the plan. We confirm the price first.']],
      ['#008', 'City bike', 'Reception', 2022, 'M', '7-speed', 'Rim', ['ready', '–', 'All checks passed.'], ['ready', '–', 'All checks passed.']],
    ];
    const companyBikes = {};
    const sep = {};
    const oct = {};
    fleet.forEach((f, i) => {
      const id = `cb${i + 1}`;
      companyBikes[id] = { number: f[0], type: f[1], location: f[2], year: f[3], size: f[4], gears: f[5], brakes: f[6] };
      sep[id] = { status: f[7][0], action: f[7][1], note: f[7][2] };
      oct[id] = { status: f[8][0], action: f[8][1], note: f[8][2] };
    });

    return {
      users: {
        'u-anna': { role: 'private', name: 'Anna Jensen', email: 'anna@example.com', phone: '+45 20 12 34 56', address: 'Fuglebakkevej 12, 2000 Frederiksberg', createdAt: '2026-03-02' },
        'u-hotel': { role: 'business', name: 'Lars Holm', email: 'hotel@example.com', phone: '+45 33 11 22 33', companyId: 'c-hotelabc', createdAt: '2026-08-20' },
        'u-owner': { role: 'admin', name: 'The Neighbor (owner)', email: 'owner@example.com', phone: '', createdAt: '2026-01-01' },
      },
      'users/u-anna/bikes': {
        b1: { name: 'Trek FX 3', type: 'Hybrid commuter', year: 2021, size: 'M / 54 cm', gears: '2×9 speed', brakes: 'Hydraulic disc', tyres: '700×35c', frame: 'Aluminium', colour: 'Dark green', usage: 'Daily commuter, about 60 km per week' },
        b2: { name: 'Pelago Brinkeby', type: 'City bike', year: 2019, size: '54 cm', gears: '7-speed hub', brakes: 'Rim brakes', tyres: '700×38c', frame: 'Steel', colour: 'Cream', usage: 'Weekend and shopping bike' },
      },
      companies: {
        'c-hotelabc': { name: 'Hotel ABC', type: 'Hotel', plan: 'standard', pricePerBike: 300, contact: 'Lars Holm', email: 'hotel@example.com', phone: '+45 33 11 22 33', address: 'Vesterbrogade 1, 1620 København V', memberUids: ['u-hotel'], nextVisit: '2026-11-05', status: 'active', since: '2026-09-01' },
      },
      'companies/c-hotelabc/bikes': companyBikes,
      'companies/c-hotelabc/reports': {
        '2026-09': { month: '2026-09', visitDate: '2026-09-04', entries: sep },
        '2026-10': { month: '2026-10', visitDate: '2026-10-02', entries: oct },
      },
      serviceRecords: {
        r1: { ownerUid: 'u-anna', bikeId: 'b1', date: '2026-09-12', title: 'The Neighbor Bike Check', work: ['Brakes inspected and adjusted', 'Gears indexed', 'Tyre pressure set to 4.5 bar', 'Chain cleaned and lubricated'], parts: [], notes: 'Rear tyre is showing wear. See recommendations.', photos: ['photo-1.jpg', 'photo-2.jpg'], cost: { service: 199, parts: 0, travel: 35 } },
        r2: { ownerUid: 'u-anna', bikeId: 'b2', date: '2026-06-03', title: 'Puncture Fix', work: ['Punctured rear inner tube replaced', 'Tyre checked for debris'], parts: [{ name: 'Inner tube 700×38c', price: 59 }], notes: 'Tyre in good condition.', photos: ['photo-1.jpg'], cost: { service: 199, parts: 59, travel: 35 } },
        r3: { ownerUid: 'u-anna', bikeId: 'b1', date: '2026-03-18', title: 'The Neighbor Bike Check', work: ['Full safety check', 'Brake pads checked (60% left)', 'Gears and chain checked', 'Bolts torqued'], parts: [], notes: 'Bike in good condition.', photos: ['photo-1.jpg', 'photo-2.jpg'], cost: { service: 199, parts: 0, travel: 35 } },
      },
      recommendations: {
        k1: { ownerUid: 'u-anna', bikeId: 'b1', title: 'Replace rear tyre', urgency: 'soon', reason: 'Tread is worn to the wear indicators.', dueBy: 'Within about 1 month', status: 'open' },
        k2: { ownerUid: 'u-anna', bikeId: 'b1', title: 'Replace chain at next visit', urgency: 'later', reason: 'Chain stretch measured at 0.5%. Replacing at 0.75% protects the cassette.', dueBy: 'Next service', status: 'open' },
        k3: { ownerUid: 'u-anna', bikeId: 'b2', title: 'Check rim brake pads', urgency: 'later', reason: 'About 40% of the pad is left.', dueBy: 'Within 3 months', status: 'open' },
        k4: { ownerUid: 'u-anna', bikeId: 'b2', title: 'Annual full check', urgency: 'later', reason: 'The last full check was in June 2026.', dueBy: 'By June 2027', status: 'open' },
      },
      bookings: {
        bk1: { ref: 'TN-1041', status: 'confirmed', customerUid: 'u-anna', guestToken: 'tok-anna1', services: [svc('bike-check')], date: open(6), arrival: '10:30', ...block(25), bike: 'Pelago Brinkeby', address: 'Fuglebakkevej 12, 2000 Frederiksberg', name: 'Anna Jensen', email: 'anna@example.com', phone: '+45 20 12 34 56', note: 'Front brake feels soft.', pricing: { oneOff: 199, discount: 0, discountReason: null, monthly: 0, travel: 13, distanceKm: 5, total: 212 }, createdAt: addDays(t, -3) },
        bk2: { ref: 'TN-1042', status: 'pending', customerUid: null, guestToken: 'tok-mikkel', services: [svc('puncture'), svc('chain')], date: open(2), arrival: '13:00', ...block(35), bike: 'Road', address: 'Jagtvej 120, 2200 København N', name: 'Mikkel Holm', email: 'mikkel@example.com', phone: '+45 40 55 66 77', note: '', pricing: { oneOff: 348, discount: 0, discountReason: null, monthly: 0, travel: 13, distanceKm: 5, total: 361 }, createdAt: addDays(t, -1) },
      },
      consultations: {
        l1: { name: 'Sofie Berg', company: 'Hostel Nørrebro', email: 'sofie@example.com', phone: '+45 22 33 44 55', companyType: 'Hostel', bikes: '16–35', preferredDate: open(4), preferredTime: '11:00', message: 'We rent 20 city bikes to guests and need monthly checks.', status: 'new', createdAt: addDays(t, -1) },
      },
      subscriptions: {},
      closedDates: { [open(9)]: { reason: 'Holiday' } },
      mail: {},
    };
  }

  // ---- Storage ----
  let db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
    if (!db) { db = seed(); save(); }
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
  load();

  const col = (path) => (db[path] = db[path] || {});
  const store = {
    list(path, where) {
      return Object.entries(col(path))
        .map(([id, doc]) => ({ id, ...doc }))
        .filter((d) => !where || where(d));
    },
    get(path, id) { const d = col(path)[id]; return d ? { id, ...d } : null; },
    add(path, doc) { const id = uid(path.split('/').pop().slice(0, 2)); col(path)[id] = doc; save(); return { id, ...doc }; },
    set(path, id, doc) { col(path)[id] = doc; save(); return { id, ...doc }; },
    update(path, id, patch) { Object.assign(col(path)[id], patch); save(); return store.get(path, id); },
  };

  function sendMail(to, subject, body) {
    store.add('mail', { to, subject, body, createdAt: new Date().toISOString() });
  }

  // ---- Auth (mock: passwords are not checked or stored) ----
  const auth = {
    current() {
      const id = localStorage.getItem(SESSION);
      return id ? store.get('users', id) : null;
    },
    signIn(email) {
      const u = store.list('users', (x) => x.email.toLowerCase() === String(email).trim().toLowerCase())[0];
      if (!u) return { error: 'noAccount' };
      localStorage.setItem(SESSION, u.id);
      return { user: u };
    },
    exists(email) {
      const e = String(email || '').trim().toLowerCase();
      return store.list('users', (x) => x.email.toLowerCase() === e).length > 0;
    },
    signUp({ name, email, phone, address, password }) {
      email = String(email || '').trim();
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { error: 'nameEmail' };
      if (!password || password.length < 8) return { error: 'password' };
      if (auth.exists(email)) return { error: 'exists' };
      const u = store.add('users', { role: 'private', name, email, phone: phone || '', address: address || '', createdAt: today() });
      // Guest bookings made with this email become part of the new account.
      for (const b of store.list('bookings', (x) => !x.customerUid && x.email.toLowerCase() === email.toLowerCase())) {
        store.update('bookings', b.id, { customerUid: u.id });
      }
      sendMail(email, 'Welcome to The Neighbor', `Hi ${name},\n\nYour account is ready. Please confirm your email address.`);
      localStorage.setItem(SESSION, u.id);
      return { user: u };
    },
    signOut() { localStorage.removeItem(SESSION); },
  };

  // ---- Pricing and availability (would run in Cloud Functions) ----
  // Mock distance: a rough estimate from the postcode. The real site asks the Google Maps Routes API
  // for the exact one-way driving distance (plan, decision 2).
  function estimateKm(address) {
    const m = String(address || '').match(/\b(\d{4})\b/);
    if (!m) return null;
    const pc = Number(m[1]);
    if (pc >= 1000 && pc < 2500) return 5;
    if (pc >= 2500 && pc < 2800) return 9;
    if (pc >= 2800 && pc < 3000) return 14;
    return 30;
  }

  // A Care Plus subscription that is not cancelled, held by the signed-in customer.
  function hasCarePlus(user) {
    return !!user && store.list('subscriptions', (s) => s.customerUid === user.id && s.service === 'premium-monthly' && s.status !== 'cancelled').length > 0;
  }

  function quote(serviceIds, address) {
    const sel = serviceIds.map(svc).filter(Boolean);
    const priced = sel.filter((s) => s.price != null);
    const oneOffs = priced.filter((s) => !s.monthly);
    const oneOff = oneOffs.reduce((a, s) => a + s.price, 0);
    // Combo: the Bike Check plus at least one other service. Repairs without the Bike Check are not
    // a combo. Care Plus: 5% off paid services, from the booking that starts the subscription on.
    const combo = oneOffs.some((s) => s.id === 'bike-check') && oneOffs.length > 1;
    const carePlus = sel.some((s) => s.id === 'premium-monthly') || hasCarePlus(auth.current());
    let discountReason = null;
    if (oneOff > 0 && carePlus) discountReason = 'carePlus';
    else if (oneOff > 0 && combo) discountReason = 'combo';
    // Money is kept in whole kroner so stored totals never carry floating-point remainders.
    const discount = discountReason ? Math.round(oneOff * CONFIG[`${discountReason}Off`]) : 0;
    const monthly = priced.filter((s) => s.monthly).reduce((a, s) => a + s.price, 0);
    const distanceKm = estimateKm(address);
    const travel = distanceKm == null ? null : Math.round(distanceKm * CONFIG.kmRate);
    // Work time is the sum of the chosen services; with nothing chosen yet, show times for a full visit.
    const workMin = sel.reduce((a, s) => a + s.durationMin, 0) || CONFIG.maxWorkMin;
    return {
      services: sel,
      workMin,
      tooLong: workMin > CONFIG.maxWorkMin,
      needsNote: sel.some((s) => s.needsNote),
      oneOffCount: oneOffs.length,
      oneOff,
      discount,
      discountReason,
      monthly,
      distanceKm,
      travel,
      special: sel.some((s) => s.price == null),
      total: oneOff - discount + (travel || 0),
    };
  }

  // Why a day is closed: 'sunday' (closed weekday), 'closed' (blocked by the owner), or null.
  function closedReason(date) {
    if (CONFIG.closedWeekdays.includes(new Date(`${date}T12:00:00`).getDay())) return 'sunday';
    return col('closedDates')[date] ? 'closed' : null;
  }

  // Start times for a job of `workMin` minutes. A booking blocks its work plus the travel gap, so a
  // start is free only if that whole stretch overlaps no other booking. Work must end by workEnd.
  function startTimes(date, workMin) {
    const busy = store.list('bookings', (b) => b.date === date && b.status !== 'cancelled')
      .map((b) => [toMin(b.arrival), toMin(b.arrival) + (b.blockMin || CONFIG.maxWorkMin + CONFIG.travelBufferMin)]);
    const out = [];
    for (let m = CONFIG.openFrom; m + workMin <= CONFIG.workEnd; m += CONFIG.startStep) {
      const end = m + workMin + CONFIG.travelBufferMin;
      out.push({ time: hhmm(m), free: !busy.some(([s, e]) => m < e && s < end) });
    }
    return out;
  }

  // Pages set <html lang>; Danish pages get Danish dates and "kr.", everything else English.
  const isDa = () => typeof document !== 'undefined' && document.documentElement.lang === 'da';
  const fmtDkk = (n) => Math.round(n).toLocaleString('da-DK') + (isDa() ? ' kr.' : ' DKK');
  const fmtDate = (s, locale) => new Date(`${s}T12:00:00`).toLocaleDateString(locale || (isDa() ? 'da-DK' : 'en-GB'), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  function nextRef() {
    const n = store.list('bookings').map((b) => Number(b.ref.split('-')[1]) || 0);
    return `TN-${Math.max(1040, ...n) + 1}`;
  }

  // Checks shared by the booking form and createBooking. Errors are codes; pages translate them.
  function checkBooking(input, q) {
    const errors = {};
    if (!q.services.length) errors.services = 'services';
    else if (q.tooLong) errors.services = 'tooLong';
    if (!input.date || input.date < today()) errors.date = 'past';
    else if (closedReason(input.date)) errors.date = closedReason(input.date);
    // A visit that is too long is reported on the services, so there is no start time to check.
    if (!q.tooLong) {
      const slot = input.date ? startTimes(input.date, q.workMin).find((s) => s.time === input.arrival) : null;
      if (!slot) errors.arrival = 'arrival';
      else if (!slot.free) errors.arrival = 'taken';
    }
    if ((q.special || q.needsNote) && !String(input.note || '').trim()) errors.note = 'note';
    if (!input.address || !input.name || !input.phone || !input.email) errors.form = 'contact';
    else if (!/^\S+@\S+\.\S+$/.test(input.email)) errors.form = 'email';
    else if (q.distanceKm == null) errors.form = 'address';
    else if (q.distanceKm > CONFIG.maxKm) errors.form = 'far';
    return errors;
  }

  const fn = {
    quote,
    startTimes,
    closedReason,
    checkBooking,

    createBooking(input, consent) {
      const q = quote(input.serviceIds || [], input.address);
      const errors = checkBooking(input, q);
      if (!consent) errors.form = 'consent';
      if (Object.keys(errors).length) return { errors };

      const user = auth.current();
      const booking = store.add('bookings', {
        ref: nextRef(),
        status: 'pending',
        customerUid: user && user.role === 'private' ? user.id : null,
        guestToken: uid('tok'),
        services: q.services,
        date: input.date,
        arrival: input.arrival,
        workMin: q.workMin,
        blockMin: q.workMin + CONFIG.travelBufferMin,
        bike: input.bike,
        address: input.address,
        name: input.name,
        email: input.email,
        phone: input.phone,
        note: input.note || '',
        pricing: { oneOff: q.oneOff, discount: q.discount, discountReason: q.discountReason, monthly: q.monthly, travel: q.travel, distanceKm: q.distanceKm, special: q.special, total: q.total },
        consent,
        createdAt: new Date().toISOString(),
      });
      // Start a subscription, unless this customer already has one for the plan (then this booking is
      // simply their monthly visit). Minimum 3 months, then cancellable at any time.
      for (const s of q.services.filter((x) => x.monthly)) {
        const same = (x) => x.service === s.id && x.status !== 'cancelled'
          && ((booking.customerUid && x.customerUid === booking.customerUid) || x.email.toLowerCase() === booking.email.toLowerCase());
        if (store.list('subscriptions', same).length) continue;
        store.add('subscriptions', {
          customerUid: booking.customerUid, email: booking.email, service: s.id, price: s.price, status: 'pending',
          startDate: booking.date, commitmentEnds: addMonths(booking.date, CONFIG.subscriptionMinMonths),
        });
      }
      const lines = q.services.map((s) => `- ${s.name}`).join('\n');
      sendMail(booking.email, `Booking received ${booking.ref}`,
        `Hi ${booking.name},\n\nThanks for booking with The Neighbor. We have received:\n${lines}\n\n${fmtDate(booking.date, 'en-GB')} at ${booking.arrival}\n${booking.address}\n\nWe will confirm your booking shortly.`);
      sendMail(CONFIG.email, `New booking ${booking.ref}`, `${booking.name} (${booking.phone}) booked ${q.services.map((s) => s.name).join(', ')} on ${booking.date} at ${booking.arrival}.`);
      return { booking };
    },

    createConsultation(input) {
      const need = ['name', 'company', 'email', 'phone', 'companyType', 'bikes'];
      if (need.some((k) => !String(input[k] || '').trim())) return { error: 'missing' };
      if (!/^\S+@\S+\.\S+$/.test(input.email)) return { error: 'email' };
      const lead = store.add('consultations', { ...input, status: 'new', createdAt: new Date().toISOString() });
      sendMail(input.email, 'We have received your consultation request', `Hi ${input.name},\n\nThanks for your interest. We will contact you shortly to arrange a consultation for ${input.company}.`);
      sendMail(CONFIG.email, `New consultation request: ${input.company}`, `${input.name} (${input.phone}, ${input.email})\n${input.companyType}, ${input.bikes} bikes\nPreferred: ${input.preferredDate || '–'} ${input.preferredTime || ''}\n\n${input.message || ''}`);
      return { lead };
    },

    cancelBooking(id, reason) {
      const b = store.get('bookings', id);
      store.update('bookings', id, { status: 'cancelled', cancelReason: reason || '' });
      sendMail(CONFIG.email, `Booking ${b.ref} cancelled by customer`, `${b.name} cancelled ${b.date} ${b.arrival}.`);
    },

    addBike(ownerUid, bike) { return store.add(`users/${ownerUid}/bikes`, bike); },

    // ---- Owner (admin) actions ----
    setBookingStatus(id, status) {
      const b = store.update('bookings', id, { status });
      const words = { confirmed: 'is confirmed', completed: 'is complete', cancelled: 'has been cancelled' };
      if (words[status]) sendMail(b.email, `Your booking ${b.ref} ${words[status]}`, `Hi ${b.name},\n\nYour booking on ${fmtDate(b.date, 'en-GB')} at ${b.arrival} ${words[status]}.`);
      return b;
    },

    logVisit(v) {
      const rec = store.add('serviceRecords', {
        ownerUid: v.ownerUid || null,
        companyId: v.companyId || null,
        bikeId: v.bikeId,
        bookingId: v.bookingId || null,
        date: v.date,
        title: v.title,
        work: v.work,
        parts: v.parts,
        notes: v.notes,
        photos: v.photos,
        cost: { service: v.servicePrice, parts: v.parts.reduce((a, p) => a + p.price, 0), travel: v.travel },
      });
      if (v.recommendation) {
        store.add('recommendations', { ownerUid: v.ownerUid || null, companyId: v.companyId || null, bikeId: v.bikeId, status: 'open', ...v.recommendation });
      }
      if (v.bookingId) store.update('bookings', v.bookingId, { status: 'completed' });
      const to = v.ownerUid ? store.get('users', v.ownerUid).email : store.get('companies', v.companyId).email;
      sendMail(to, `Service done: ${v.title}`, `Your bike has been serviced on ${fmtDate(v.date, 'en-GB')}.\n\nWork done:\n${v.work.map((w) => `- ${w}`).join('\n')}\n\nSee the full record, photos and costs in My account.`);
      return rec;
    },

    saveReport(companyId, month, visitDate, entries) {
      store.set(`companies/${companyId}/reports`, month, { month, visitDate, entries });
      const c = store.get('companies', companyId);
      sendMail(c.email, `Fleet report ready: ${monthLabel(month, 'en-GB')}`, `Hi ${c.contact},\n\nThe ${monthLabel(month, 'en-GB')} report for ${c.name} is ready in My account.\n\n${countLine(entries)}`);
    },

    createCompanyFromLead(leadId, planId) {
      const lead = store.get('consultations', leadId);
      const plan = PLANS.find((p) => p.id === planId);
      const company = store.add('companies', {
        name: lead.company, type: lead.companyType, plan: plan.id, pricePerBike: plan.pricePerBike, contact: lead.name,
        email: lead.email, phone: lead.phone, address: '', memberUids: [], nextVisit: '', status: 'active', since: today(),
      });
      let user = store.list('users', (u) => u.email.toLowerCase() === lead.email.toLowerCase())[0];
      if (!user) user = store.add('users', { role: 'business', name: lead.name, email: lead.email, phone: lead.phone, companyId: company.id, createdAt: today() });
      store.update('companies', company.id, { memberUids: [user.id] });
      store.update('consultations', leadId, { status: 'won', companyId: company.id });
      sendMail(lead.email, 'Your business account at The Neighbor', `Hi ${lead.name},\n\nWelcome aboard on the ${plan.name} plan. Use the link in this email to set your password and see your fleet reports.`);
      return company;
    },
  };

  function monthLabel(m, locale) {
    return new Date(`${m}-01T12:00:00`).toLocaleDateString(locale || (isDa() ? 'da-DK' : 'en-GB'), { month: 'long', year: 'numeric' });
  }
  function counts(entries) {
    const c = { ready: 0, attention: 0, repair: 0 };
    for (const e of Object.values(entries || {})) c[e.status] = (c[e.status] || 0) + 1;
    return c;
  }
  function countLine(entries) {
    const c = counts(entries);
    return `Ready: ${c.ready} · Need attention: ${c.attention} · Repair needed: ${c.repair}`;
  }

  window.NB = {
    CONFIG,
    SERVICES,
    PLANS,
    STATUS,
    store,
    auth,
    fn,
    util: { today, addDays, nextOpenDay, arrivalTimes, fmtDkk, fmtDate, monthLabel, counts, isDa },
    reset() { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); load(); },
  };
})();
