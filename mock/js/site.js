// Landing page: consent, booking flow and consultation form, wired to the mock backend.
(function () {
  'use strict';

  const { $, h, A } = UI;
  const { CONFIG, SERVICES, PLANS, fn, util } = NB;
  const dkk = util.fmtDkk;
  const user = NB.auth.current();

  // ---- Consent ----
  const CONSENT_KEY = 'neighbor-consent';
  let consent = null;
  try { consent = JSON.parse(localStorage.getItem(CONSENT_KEY)); } catch { consent = null; }
  if (!consent || consent.version !== CONFIG.consentVersion) {
    consent = null;
    $('consent').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  const consentReady = () => { $('cok').disabled = !($('c1').checked && $('c2').checked); };
  $('c1').onchange = consentReady;
  $('c2').onchange = consentReady;
  $('cok').onclick = () => {
    consent = { data: true, terms: true, version: CONFIG.consentVersion, at: new Date().toISOString() };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    $('consent').hidden = true;
    document.body.style.overflow = '';
  };

  // ---- Business plan cards ----
  // Short versions for the landing page; the full lists are in NB.PLANS.
  const PLAN_TEXT = {
    basic: ['Get started', ['Start-up fleet check and report', 'Preventive maintenance', 'Safety inspection']],
    standard: ['Most popular', ['Start-up fleet check and report', 'Monthly check-up', 'Monthly report']],
    premium: ['Up to 35 bikes', ['Monthly check-up and report', 'Priority service', 'Cheaper tube repairs']],
  };
  PLANS.forEach((p) => {
    const card = h('div', 'paper plan');
    const price = h('p', 'price', `${p.pricePerBike} DKK `);
    price.appendChild(h('small', '', '/ bike / month'));
    const ul = h('ul');
    PLAN_TEXT[p.id][1].forEach((i) => ul.appendChild(h('li', '', i)));
    A(card, h('p', 'tagline', PLAN_TEXT[p.id][0]), h('h3', '', p.name), price, ul);
    $('plan-cards').appendChild(card);
  });

  // ---- Booking form ----
  SERVICES.forEach((s) => {
    const l = h('label', 'chk');
    const input = h('input');
    input.type = 'checkbox';
    input.name = 'svc';
    input.value = s.id;
    const span = h('span', '', s.name);
    span.appendChild(h('small', '', s.price == null ? 'Price by agreement' : dkk(s.price) + (s.monthly ? ' / month' : '')));
    A(l, input, span);
    $('svcs').appendChild(l);
  });
  const chosen = () => [...document.querySelectorAll('input[name=svc]:checked')].map((x) => x.value);
  $('svcs').addEventListener('change', () => {
    const names = chosen().map((id) => SERVICES.find((s) => s.id === id).name);
    $('saccv').textContent = names.length ? names.join(', ') : 'Select services';
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

  // Bike choice: a signed-in customer's own bikes first, then generic types.
  const bikeSel = $('bike');
  const types = ['City / commuter', 'Road', 'Mountain', 'E-bike', 'Cargo / other'];
  if (user && user.role === 'private') {
    NB.store.list(`users/${user.id}/bikes`).forEach((b) => bikeSel.appendChild(new Option(b.name, b.name)));
  }
  types.forEach((t) => bikeSel.appendChild(new Option(t, t)));

  const dateIn = $('date');
  dateIn.min = util.today();

  function renderSlots() {
    const box = $('slots');
    box.textContent = '';
    const taken = dateIn.value ? fn.takenArrivals(dateIn.value) : [];
    util.arrivalTimes().forEach((t) => {
      const l = h('label', 'slot');
      const input = h('input');
      input.type = 'radio';
      input.name = 'slot';
      input.value = t;
      input.disabled = taken.includes(t);
      const span = h('span', '', t);
      if (input.disabled) span.title = 'Already booked';
      A(l, input, span);
      box.appendChild(l);
    });
    $('accv').textContent = 'Select a time';
    $('e-date').textContent = dateIn.value && fn.isClosed(dateIn.value) ? 'We are closed that day. Please pick another date.' : '';
  }
  renderSlots();
  dateIn.addEventListener('change', renderSlots);
  $('slots').addEventListener('change', (e) => {
    $('accv').textContent = e.target.value;
    $('acc').setAttribute('aria-expanded', 'false');
    $('slots').hidden = true;
  });

  // Prefill for signed-in customers.
  if (user && user.role === 'private') {
    $('name').value = user.name;
    $('tel').value = user.phone || '';
    $('email').value = user.email;
    $('addr').value = user.address || '';
    $('signed-in').hidden = false;
    $('signed-in').textContent = `Signed in as ${user.name}. This booking will appear in your account.`;
  }

  let draft = null;
  const ERR = ['services', 'date', 'arrival', 'note', 'form'];
  const showErrors = (errors) => ERR.forEach((k) => { $('e-' + k).textContent = errors[k] || ''; });
  function show(id) {
    ['f', 'co', 'done'].forEach((x) => { $(x).hidden = x !== id; });
    $(id).scrollIntoView({ block: 'nearest' });
  }

  $('f').addEventListener('submit', (e) => {
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
    };
    const errors = {};
    if (!draft.serviceIds.length) errors.services = 'Choose at least one service.';
    if (!draft.date || draft.date < dateIn.min) errors.date = 'Choose a date from today onward.';
    if (!draft.arrival) errors.arrival = 'Choose an arrival time.';
    if (!draft.address || !draft.name || !draft.phone || !draft.email) errors.form = 'Fill in your address, name, phone and email so we can find you and confirm.';
    showErrors(errors);
    if (Object.keys(errors).length) return;
    renderCheckout();
    show('co');
  });

  function renderCheckout() {
    const q = fn.quote(draft.serviceIds, draft.address);
    $('codet').textContent = `${util.fmtDate(draft.date)} at ${draft.arrival} · ${draft.bike} · ${draft.address}`;
    const t = $('tbl');
    t.textContent = '';
    const add = (a, b, cls) => {
      const r = t.insertRow();
      if (cls) r.className = cls;
      r.insertCell().textContent = a;
      const c = r.insertCell();
      if (b instanceof Node) c.appendChild(b); else c.textContent = b;
      return r;
    };
    q.services.forEach((s) => add(s.name, s.price == null ? 'Price by agreement' : dkk(s.price) + (s.monthly ? ' / month' : '')));
    if (q.comboDiscount) add(`Combo discount (−${CONFIG.comboOff * 100}%)`, '−' + dkk(q.comboDiscount));
    if (q.oneOffCount) add('Services total', dkk(q.oneOff - q.comboDiscount));
    if (q.monthly) add('Monthly subscription', dkk(q.monthly) + ' / month');
    const rulesBtn = h('button', 'lnk', 'Travel');
    rulesBtn.type = 'button';
    rulesBtn.onclick = openRules;
    const tr = t.insertRow();
    tr.insertCell().appendChild(rulesBtn);
    tr.insertCell().textContent = q.travel == null ? 'confirmed by us' : `about ${dkk(q.travel)} (${q.distanceKm} km, estimate)`;
    const parts = [];
    if (q.oneOffCount) parts.push(dkk(q.oneOff - q.comboDiscount + (q.travel || 0)) + (q.travel == null ? ' + travel' : ''));
    if (q.monthly) parts.push(dkk(q.monthly) + ' / month');
    if (q.special) parts.push('special repair by agreement');
    add('Total to pay', parts.join(' + ') || 'Price by agreement', 'tot');

    const notes = $('notes');
    notes.textContent = '';
    const note = (x) => notes.appendChild(h('div', 'note', x));
    if (q.special) note('Special repair: we agree the price after reading your description.');
    if (q.oneOffCount === 1) note('Tip: add another service and get 10% off both.');
    if (q.distanceKm != null && q.distanceKm > CONFIG.maxKm) note(`This address looks more than ${CONFIG.maxKm} km from our base. Contact us and we will see what we can do.`);
    $('e-confirm').textContent = '';
  }

  $('back').onclick = () => show('f');

  $('confirm').onclick = () => {
    if (!consent) {
      $('consent').hidden = false;
      return;
    }
    const res = fn.createBooking(draft, consent);
    if (res.errors) {
      showErrors(res.errors);
      if (res.errors.arrival) renderSlots();
      show('f');
      return;
    }
    const b = res.booking;
    $('done-msg').textContent = `Booking ${b.ref} is saved. A confirmation is on its way to ${b.email}.`;
    $('sum').textContent = [
      ...b.services.map((s) => `${s.name}: ${s.price == null ? 'price by agreement' : dkk(s.price) + (s.monthly ? ' / month' : '')}`),
      b.pricing.comboDiscount ? `Combo discount: −${dkk(b.pricing.comboDiscount)}` : '',
      b.pricing.travel != null ? `Travel (estimate): ${dkk(b.pricing.travel)}` : 'Travel: confirmed by us',
      '',
      `Date: ${util.fmtDate(b.date)}`,
      `Arrival: ${b.arrival}`,
      `Bike: ${b.bike}`,
      `Address: ${b.address}`,
      `Notes: ${b.note || '–'}`,
    ].filter((x) => x !== '').join('\n');
    const acct = $('done-acct');
    acct.textContent = '';
    const link = h('a', 'pill');
    if (b.customerUid) {
      link.textContent = 'See it in My account';
      link.href = 'account.html';
    } else {
      link.textContent = 'Create an account to follow your booking';
      link.href = 'account.html?signup=' + encodeURIComponent(b.email);
    }
    acct.appendChild(link);
    show('done');
  };

  $('again').onclick = () => {
    $('f').reset();
    $('saccv').textContent = 'Select services';
    renderSlots();
    show('f');
  };

  // ---- Travel rules dialog ----
  let lastFocus = null;
  function openRules() {
    lastFocus = document.activeElement;
    const rl = $('rl');
    rl.textContent = '';
    [
      `${String(CONFIG.kmRate).replace('.', ',')} DKK per km from ${CONFIG.base}.`,
      `Up to ${CONFIG.maxKm} km away.`,
      'We confirm the amount before the visit.',
    ].forEach((x) => rl.appendChild(h('li', '', x)));
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

  // Service buttons preselect a service; the public-fleet button preselects a company type.
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
  const fill = (id, list, placeholder) => {
    const el = $(id);
    el.appendChild(new Option(placeholder, ''));
    list.forEach((x) => el.appendChild(new Option(x, x)));
  };
  fill('ctype', ['Hotel', 'Hostel', 'Bike rental', 'Property management', 'Office', 'Tourism company', 'Municipality / public organization', 'Other'], 'Select');
  fill('cnum', ['1', '2–5', '6–15', '16–35', '35+'], 'Select');
  fill('ctime', util.arrivalTimes(), 'No preference');
  $('cdate').min = util.today();

  $('cf').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (id) => $(id).value.trim();
    const input = {
      name: v('cname'), company: v('ccomp'), email: v('cemail'), phone: v('ctel'), companyType: v('ctype'),
      bikes: v('cnum'), preferredDate: v('cdate'), preferredTime: v('ctime'), message: v('cmsg'),
    };
    const res = fn.createConsultation(input);
    $('e-c').textContent = res.error || '';
    if (res.error) return;
    $('cok-msg').textContent = `Thanks, ${input.name}. Your request is saved and we have emailed a copy to ${input.email}.`;
    $('csum').textContent = [
      `Company: ${input.company} (${input.companyType})`,
      `Number of bicycles: ${input.bikes}`,
      `Preferred: ${input.preferredDate || '–'} ${input.preferredTime || ''}`,
      `Message: ${input.message || '–'}`,
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
})();
