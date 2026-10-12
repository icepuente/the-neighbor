// Fake backend for the mock site. It stands in for Firebase so the pages can be clicked through:
// data lives in this browser's localStorage, laid out like the Firestore collections in
// docs/firebase-plan.md (section 4), and NB.fn mirrors the planned Cloud Functions.
// Nothing leaves the browser; "emails" are written to a `mail` collection shown in the dashboard.
(function () {
  'use strict';

  const KEY = 'neighbor-mock-v1';
  const SESSION = 'neighbor-mock-session';

  const CONFIG = {
    businessName: 'The Neighbor',
    email: 'hello@example.com',
    base: 'Rørsangervej 45, København',
    kmRate: 2.5,
    maxKm: 18,
    comboOff: 0.1,
    arrivalStart: 10 * 60,
    arrivalEnd: 16 * 60,
    arrivalStep: 30,
    consentVersion: '2026-10',
  };

  const SERVICES = [
    { id: 'one-time', name: 'One-Time Bike Service', price: 199, monthly: false, description: 'Basic inspection and adjustment.' },
    { id: 'monthly', name: 'Monthly Bike Check-Up', price: 79, monthly: true, description: 'One bicycle check-up every month.' },
    { id: 'premium-monthly', name: 'Premium Monthly Check-Up', price: 99, monthly: true, description: 'Monthly check-up plus priority booking.' },
    { id: 'check-up', name: 'Bike check-up', price: 269, monthly: false, description: 'Brakes, gears, tyre pressure, chain and a full safety check.' },
    { id: 'tube', name: 'Change tube', price: 149, monthly: false, description: 'Punctured or worn inner tube replaced on the spot.' },
    { id: 'special', name: 'Special repair', price: null, monthly: false, description: 'Describe the problem and we agree the price with you.' },
  ];

  const PLANS = [
    { id: 'basic', name: 'Basic', pricePerBike: 250, monthlyReport: false, maxBikes: null,
      includes: ['Initial bicycle checklist', 'Initial fleet report', 'Preventive maintenance', 'Basic safety inspection'] },
    { id: 'standard', name: 'Standard', pricePerBike: 300, monthlyReport: true, maxBikes: null,
      includes: ['Initial bicycle checklist', 'Initial fleet report', 'Monthly bicycle check-up', 'Monthly service report', 'Preventive maintenance'] },
    { id: 'premium', name: 'Premium', pricePerBike: 350, monthlyReport: true, maxBikes: 35,
      includes: ['Monthly bicycle check-up', 'Monthly service report', 'Priority service', 'Priority reporting', 'Discounted inner-tube repairs'] },
  ];

  const STATUS = { ready: 'Ready', attention: 'Attention', repair: 'Repair needed' };

  // ---- Dates ----
  function isoDate(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  const today = () => isoDate(new Date());
  function addDays(date, n) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function arrivalTimes() {
    const out = [];
    for (let m = CONFIG.arrivalStart; m < CONFIG.arrivalEnd; m += CONFIG.arrivalStep) {
      out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
    }
    return out;
  }
  const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 9);

  // ---- Sample data (from the account-preview document) ----
  function seed() {
    const t = today();
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
      const id = 'cb' + (i + 1);
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
        r1: { ownerUid: 'u-anna', bikeId: 'b1', date: '2026-09-12', title: 'One-Time Bike Service', work: ['Brakes inspected and adjusted', 'Gears indexed', 'Tyre pressure set to 4.5 bar', 'Chain cleaned and lubricated'], parts: [], notes: 'Rear tyre is showing wear. See recommendations.', photos: ['photo-1.jpg', 'photo-2.jpg'], cost: { service: 199, parts: 0, travel: 35 } },
        r2: { ownerUid: 'u-anna', bikeId: 'b2', date: '2026-06-03', title: 'Change tube', work: ['Punctured rear inner tube replaced', 'Tyre checked for debris'], parts: [{ name: 'Inner tube 700×38c', price: 59 }], notes: 'Tyre in good condition.', photos: ['photo-1.jpg'], cost: { service: 149, parts: 59, travel: 35 } },
        r3: { ownerUid: 'u-anna', bikeId: 'b1', date: '2026-03-18', title: 'Bike check-up', work: ['Full safety check', 'Brake pads checked (60% left)', 'Gears and chain checked', 'Bolts torqued'], parts: [], notes: 'Bike in good condition.', photos: ['photo-1.jpg', 'photo-2.jpg'], cost: { service: 269, parts: 0, travel: 35 } },
      },
      recommendations: {
        k1: { ownerUid: 'u-anna', bikeId: 'b1', title: 'Replace rear tyre', urgency: 'soon', reason: 'Tread is worn to the wear indicators.', dueBy: 'Within about 1 month', status: 'open' },
        k2: { ownerUid: 'u-anna', bikeId: 'b1', title: 'Replace chain at next visit', urgency: 'later', reason: 'Chain stretch measured at 0.5%. Replacing at 0.75% protects the cassette.', dueBy: 'Next service', status: 'open' },
        k3: { ownerUid: 'u-anna', bikeId: 'b2', title: 'Check rim brake pads', urgency: 'later', reason: 'About 40% of the pad is left.', dueBy: 'Within 3 months', status: 'open' },
        k4: { ownerUid: 'u-anna', bikeId: 'b2', title: 'Annual full check', urgency: 'later', reason: 'The last full check was in June 2026.', dueBy: 'By June 2027', status: 'open' },
      },
      bookings: {
        bk1: { ref: 'TN-1041', status: 'confirmed', customerUid: 'u-anna', guestToken: 'tok-anna1', services: [SERVICES[3]], date: addDays(t, 6), arrival: '10:30', bike: 'Pelago Brinkeby', address: 'Fuglebakkevej 12, 2000 Frederiksberg', name: 'Anna Jensen', email: 'anna@example.com', phone: '+45 20 12 34 56', note: 'Front brake feels soft.', pricing: { oneOff: 269, comboDiscount: 0, monthly: 0, travel: 13, distanceKm: 5, special: false, total: 282 }, createdAt: addDays(t, -3) },
        bk2: { ref: 'TN-1042', status: 'pending', customerUid: null, guestToken: 'tok-mikkel', services: [SERVICES[0], SERVICES[4]], date: addDays(t, 2), arrival: '13:00', bike: 'Road', address: 'Jagtvej 120, 2200 København N', name: 'Mikkel Holm', email: 'mikkel@example.com', phone: '+45 40 55 66 77', note: '', pricing: { oneOff: 348, comboDiscount: 35, monthly: 0, travel: 13, distanceKm: 5, special: false, total: 326 }, createdAt: addDays(t, -1) },
      },
      consultations: {
        l1: { name: 'Sofie Berg', company: 'Hostel Nørrebro', email: 'sofie@example.com', phone: '+45 22 33 44 55', companyType: 'Hostel', bikes: '16–35', preferredDate: addDays(t, 4), preferredTime: '11:00', message: 'We rent 20 city bikes to guests and need monthly checks.', status: 'new', createdAt: addDays(t, -1) },
      },
      subscriptions: {},
      closedDates: { [addDays(t, 9)]: { reason: 'Holiday' } },
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
      if (!u) return { error: 'No account with that email. Create one, or use a demo account.' };
      localStorage.setItem(SESSION, u.id);
      return { user: u };
    },
    signUp({ name, email, phone, password }) {
      email = String(email || '').trim();
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { error: 'Fill in your name and a valid email.' };
      if (!password || password.length < 8) return { error: 'Choose a password of at least 8 characters.' };
      if (store.list('users', (x) => x.email.toLowerCase() === email.toLowerCase()).length) {
        return { error: 'An account with that email already exists. Log in instead.' };
      }
      const u = store.add('users', { role: 'private', name, email, phone: phone || '', address: '', createdAt: today() });
      // Guest bookings made with this email become part of the new account.
      store.list('bookings', (b) => !b.customerUid && b.email.toLowerCase() === email.toLowerCase())
        .forEach((b) => store.update('bookings', b.id, { customerUid: u.id }));
      sendMail(email, 'Welcome to The Neighbor', `Hi ${name},\n\nYour account is ready. Please confirm your email address.`);
      localStorage.setItem(SESSION, u.id);
      return { user: u };
    },
    signOut() { localStorage.removeItem(SESSION); },
  };

  // ---- Pricing and availability (would run in Cloud Functions) ----
  // Mock distance: a rough estimate from the postcode. The real version is open decision 2 in the plan.
  function estimateKm(address) {
    const m = String(address || '').match(/\b(\d{4})\b/);
    if (!m) return null;
    const pc = Number(m[1]);
    if (pc >= 1000 && pc < 2500) return 5;
    if (pc >= 2500 && pc < 2800) return 9;
    if (pc >= 2800 && pc < 3000) return 14;
    return 30;
  }

  function quote(serviceIds, address) {
    const sel = serviceIds.map((id) => SERVICES.find((s) => s.id === id)).filter(Boolean);
    const priced = sel.filter((s) => s.price != null);
    const oneOffs = priced.filter((s) => !s.monthly);
    const oneOff = oneOffs.reduce((a, s) => a + s.price, 0);
    // Money is kept in whole kroner so stored totals never carry floating-point remainders.
    const comboDiscount = oneOffs.length > 1 ? Math.round(oneOff * CONFIG.comboOff) : 0;
    const monthly = priced.filter((s) => s.monthly).reduce((a, s) => a + s.price, 0);
    const distanceKm = estimateKm(address);
    const travel = distanceKm == null ? null : Math.round(distanceKm * CONFIG.kmRate);
    return {
      services: sel,
      oneOffCount: oneOffs.length,
      oneOff,
      comboDiscount,
      monthly,
      distanceKm,
      travel,
      special: sel.some((s) => s.price == null),
      total: oneOff - comboDiscount + (travel || 0),
    };
  }

  function takenArrivals(date) {
    return store.list('bookings', (b) => b.date === date && b.status !== 'cancelled').map((b) => b.arrival);
  }
  const isClosed = (date) => !!col('closedDates')[date];

  const fmtDkk = (n) => Math.round(n).toLocaleString('da-DK') + ' DKK';
  const fmtDate = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  function nextRef() {
    const n = store.list('bookings').map((b) => Number(b.ref.split('-')[1]) || 0);
    return 'TN-' + (Math.max(1040, ...n) + 1);
  }

  const fn = {
    quote,
    takenArrivals,
    isClosed,

    createBooking(input, consent) {
      const errors = {};
      const q = quote(input.serviceIds || [], input.address);
      if (!q.services.length) errors.services = 'Choose at least one service.';
      if (!input.date || input.date < today()) errors.date = 'Choose a date from today onward.';
      else if (isClosed(input.date)) errors.date = 'We are closed that day. Please pick another date.';
      if (!arrivalTimes().includes(input.arrival)) errors.arrival = 'Choose an arrival time.';
      else if (takenArrivals(input.date).includes(input.arrival)) errors.arrival = 'That time was just taken. Please pick another.';
      if (q.special && !String(input.note || '').trim()) errors.note = 'Describe your problem here so we can agree a price.';
      if (!input.address || !input.name || !input.phone) errors.form = 'Fill in your address, name and phone so we can find you.';
      else if (!/^\S+@\S+\.\S+$/.test(input.email || '')) errors.form = 'Add a valid email so we can confirm the booking.';
      else if (q.distanceKm != null && q.distanceKm > CONFIG.maxKm) errors.form = `That address looks more than ${CONFIG.maxKm} km from our base. Contact us and we will see what we can do.`;
      if (!consent) errors.form = 'Please accept the consent notice first.';
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
        bike: input.bike,
        address: input.address,
        name: input.name,
        email: input.email,
        phone: input.phone,
        note: input.note || '',
        pricing: { oneOff: q.oneOff, comboDiscount: q.comboDiscount, monthly: q.monthly, travel: q.travel, distanceKm: q.distanceKm, special: q.special, total: q.total },
        consent,
        createdAt: new Date().toISOString(),
      });
      q.services.filter((s) => s.monthly).forEach((s) => store.add('subscriptions', {
        customerUid: booking.customerUid, email: booking.email, service: s.id, price: s.price, status: 'pending', startDate: booking.date,
      }));
      const lines = q.services.map((s) => `- ${s.name}`).join('\n');
      sendMail(booking.email, `Booking received ${booking.ref}`,
        `Hi ${booking.name},\n\nThanks for booking with The Neighbor. We have received:\n${lines}\n\n${fmtDate(booking.date)} at ${booking.arrival}\n${booking.address}\n\nWe will confirm the exact arrival time and final price shortly.`);
      sendMail(CONFIG.email, `New booking ${booking.ref}`, `${booking.name} (${booking.phone}) booked ${q.services.map((s) => s.name).join(', ')} on ${booking.date} at ${booking.arrival}.`);
      return { booking };
    },

    createConsultation(input) {
      const need = ['name', 'company', 'email', 'phone', 'companyType', 'bikes'];
      if (need.some((k) => !String(input[k] || '').trim())) return { error: 'Fill in name, company, email, phone, company type and number of bicycles.' };
      if (!/^\S+@\S+\.\S+$/.test(input.email)) return { error: 'Check your email address.' };
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
      if (words[status]) sendMail(b.email, `Your booking ${b.ref} ${words[status]}`, `Hi ${b.name},\n\nYour booking on ${fmtDate(b.date)} at ${b.arrival} ${words[status]}.`);
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
      sendMail(to, `Service done: ${v.title}`, `Your bike has been serviced on ${fmtDate(v.date)}.\n\nWork done:\n${v.work.map((w) => '- ' + w).join('\n')}\n\nSee the full record, photos and costs in My account.`);
      return rec;
    },

    saveReport(companyId, month, visitDate, entries) {
      store.set(`companies/${companyId}/reports`, month, { month, visitDate, entries });
      const c = store.get('companies', companyId);
      sendMail(c.email, `Fleet report ready: ${monthLabel(month)}`, `Hi ${c.contact},\n\nThe ${monthLabel(month)} report for ${c.name} is ready in My account.\n\n${countLine(entries)}`);
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

  function monthLabel(m) {
    return new Date(m + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  function counts(entries) {
    const c = { ready: 0, attention: 0, repair: 0 };
    Object.values(entries || {}).forEach((e) => { c[e.status] = (c[e.status] || 0) + 1; });
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
    util: { today, addDays, arrivalTimes, fmtDkk, fmtDate, monthLabel, counts },
    reset() { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); load(); },
  };
})();
