// Landing page: consent, booking flow and consultation form, wired to the mock backend.
(function () {
  'use strict';

  const { $, h, A, t } = UI;
  const { CONFIG, SERVICES, PLANS, fn, util } = NB;
  const dkk = util.fmtDkk;
  const svcName = I18N.svc;
  const user = NB.auth.current();
  const priceLabel = (s) => (s.price == null ? t('byAgreement') : dkk(s.price) + (s.monthly ? ' ' + t('perMonth') : ''));

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
  PLANS.forEach((p) => {
    const card = h('div', 'paper plan');
    const price = h('p', 'price', dkk(p.pricePerBike) + ' ');
    price.appendChild(h('small', '', t('biz.perBike')));
    const ul = h('ul');
    [1, 2, 3].forEach((n) => ul.appendChild(h('li', '', t(`plan.${p.id}.${n}`))));
    A(card, h('p', 'tagline', t(`plan.${p.id}.tag`)), h('h3', '', p.name), price, ul);
    $('plan-cards').appendChild(card);
  });

  // Price plus the owner's time estimate, e.g. "199 kr. · ca. 20–25 min."
  const svcDetail = (s) => priceLabel(s) + (s.mins ? ' · ' + t('svc.time', { m: s.mins }) : '');

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
  for (const [id, n] of [['monthly', 4], ['premium-monthly', 4]]) {
    const s = SERVICES.find((x) => x.id === id);
    const card = h('div', 'paper plan');
    const price = h('p', 'price', `${dkk(s.price)} `);
    price.appendChild(h('small', '', t('perMonth')));
    const ul = h('ul');
    for (let i = 1; i <= n; i++) ul.appendChild(h('li', '', t(`care.${id}.${i}`)));
    const pick = h('a', 'pill', t('care.pick', { name: svcName(s) }));
    pick.href = '#book';
    pick.dataset.pre = id;
    A(card, h('h3', '', svcName(s)), price, ul, pick);
    $('care-cards').appendChild(card);
  }

  // ---- Booking form ----
  SERVICES.forEach((s) => {
    const l = h('label', 'chk');
    const input = h('input');
    input.type = 'checkbox';
    input.name = 'svc';
    input.value = s.id;
    const span = h('span', '', svcName(s));
    span.appendChild(h('small', '', svcDetail(s)));
    A(l, input, span);
    $('svcs').appendChild(l);
  });
  const chosen = () => [...document.querySelectorAll('input[name=svc]:checked')].map((x) => x.value);
  $('svcs').addEventListener('change', () => {
    const names = chosen().map((id) => svcName(SERVICES.find((s) => s.id === id)));
    $('saccv').textContent = names.length ? names.join(', ') : t('bk.selectServices');
    // Say straight away when the chosen services do not fit in one visit.
    $('e-services').textContent = fn.quote(chosen(), '').tooLong ? t('err.tooLong') : '';
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

  // Bike choice: a signed-in customer's own bikes first, then generic types.
  const bikeSel = $('bike');
  if (user && user.role === 'private') {
    for (const b of NB.store.list(`users/${user.id}/bikes`)) {
      const o = new Option(b.name, b.name);
      o.dataset.bikeId = b.id;
      bikeSel.appendChild(o);
    }
  }
  const chosenBikeId = () => bikeSel.selectedOptions[0]?.dataset.bikeId || null;
  // Tell a signed-in customer that photos of one of their saved bikes are kept on that bike too.
  const updatePhotoHint = () => { $('pics-to-bike').hidden = !chosenBikeId(); };
  bikeSel.addEventListener('change', updatePhotoHint);
  ['city', 'road', 'mtb', 'e', 'cargo'].forEach((k) => bikeSel.appendChild(new Option(t('bike.' + k), t('bike.' + k))));

  const dateIn = $('date');
  // 2 days ahead for everyone; tomorrow for a Care Plus member whose urgent visit is unused.
  dateIn.min = fn.earliestDate(user);

  // Start times depend on the day's bookings and on how long the chosen services take.
  function renderSlots() {
    const box = $('slots');
    box.textContent = '';
    $('accv').textContent = t('bk.selectTime');
    const q = fn.quote(chosen(), '');
    // The same date rules as the backend: closed days, the 2-day lead time, the urgent visit.
    const dateErr = dateIn.value ? fn.checkBooking({ date: dateIn.value }, q).date : null;
    $('e-date').textContent = dateErr ? t(`err.${dateErr}`) : '';
    if (!dateIn.value || dateErr || q.tooLong) return;
    const times = fn.startTimes(dateIn.value, q.workMin);
    if (!times.some((s) => s.free)) box.appendChild(h('p', 'det', t('bk.noTimes')));
    times.forEach((s) => {
      const l = h('label', 'slot');
      const input = h('input');
      input.type = 'radio';
      input.name = 'slot';
      input.value = s.time;
      input.disabled = !s.free;
      A(l, input, h('span', '', s.time));
      box.appendChild(l);
    });
  }
  renderSlots();
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

  // Contact details: from the signed-in account, or from "Remember me" on this device.
  const REMEMBER_KEY = 'neighbor-remember';
  let remembered = null;
  try { remembered = JSON.parse(localStorage.getItem(REMEMBER_KEY)); } catch { remembered = null; }
  if (user && user.role === 'private') {
    $('name').value = user.name;
    $('tel').value = user.phone || '';
    $('email').value = user.email;
    $('addr').value = user.address || '';
    $('signed-in').hidden = false;
    $('signed-in').textContent = t('bk.signedIn', { name: user.name })
      + (fn.isUrgentDate(dateIn.min) ? ` ${t('bk.urgent')}` : '');
    $('opts').hidden = true;
  } else if (remembered) {
    $('name').value = remembered.name || '';
    $('tel').value = remembered.phone || '';
    $('email').value = remembered.email || '';
    $('addr').value = remembered.address || '';
    $('remember').checked = true;
  }
  $('mkacct').onchange = () => { $('pw-row').hidden = !$('mkacct').checked; };

  // Photos of the bike or the problem, shrunk in the browser before they are saved.
  const bookingPhotos = UI.photoPicker({ max: CONFIG.maxBookingPhotos, id: 'bk-photo-input' });
  $('bk-photos').appendChild(bookingPhotos.el);
  updatePhotoHint();

  let draft = null;
  const ERR = ['services', 'date', 'arrival', 'note', 'photos', 'form'];
  const showErrors = (errors) => ERR.forEach((k) => { $('e-' + k).textContent = errors[k] ? t('err.' + errors[k]) : ''; });
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
      bikeId: chosenBikeId(),
      address: $('addr').value.trim(),
      name: $('name').value.trim(),
      phone: $('tel').value.trim(),
      email: $('email').value.trim(),
      note: $('note').value.trim(),
      photos: bookingPhotos.get(),
    };
    // Same checks the backend runs, so the customer sees the price only for a bookable order.
    const errors = fn.checkBooking(draft, fn.quote(draft.serviceIds, draft.address));
    if (!errors.form && $('mkacct').checked && !$('opts').hidden) {
      if ($('pw').value.length < 8) errors.form = 'password';
      else if (NB.auth.exists(draft.email)) errors.form = 'exists';
    }
    showErrors(errors);
    if (Object.keys(errors).length) return;
    renderCheckout();
    show('co');
  });

  function renderCheckout() {
    const q = fn.quote(draft.serviceIds, draft.address);
    $('codet').textContent = `${t('dateAt', { date: util.fmtDate(draft.date), time: draft.arrival })} · ${draft.bike} · ${draft.address}`;
    const tb = $('tbl');
    tb.textContent = '';
    const add = (a, b, cls) => {
      const r = tb.insertRow();
      if (cls) r.className = cls;
      r.insertCell().textContent = a;
      const c = r.insertCell();
      if (b instanceof Node) c.appendChild(b); else c.textContent = b;
      return r;
    };
    q.services.forEach((s) => add(svcName(s), priceLabel(s)));
    if (q.discount) add(t(`co.discount.${q.discountReason}`), `−${dkk(q.discount)}`);
    const rulesBtn = h('button', 'lnk', t('co.travel'));
    rulesBtn.type = 'button';
    rulesBtn.onclick = openRules;
    const tr = tb.insertRow();
    tr.insertCell().appendChild(rulesBtn);
    tr.insertCell().textContent = t('co.travelVal', { amount: dkk(q.travel), km: q.distanceKm });
    const parts = [dkk(q.total)];
    if (q.monthly) parts.push(dkk(q.monthly) + ' ' + t('perMonth'));
    if (q.special) parts.push(t('co.special'));
    add(t('co.total'), parts.join(' + '), 'tot');

    const notes = $('notes');
    notes.textContent = '';
    const note = (x) => notes.appendChild(h('div', 'note', x));
    note(t('co.visit', { min: q.workMin }));
    if (draft.photos.length) {
      notes.appendChild(h('p', 'det', t('pics.attached', { n: draft.photos.length })));
      notes.appendChild(UI.gallery(draft.photos));
    }
    if (fn.isUrgentDate(draft.date)) note(t('co.urgent'));
    if (q.special) note(t('co.noteSpecial'));
    if (!q.discount && q.oneOffCount === 1 && q.services.some((s) => s.id === 'bike-check')) note(t('co.noteCombo'));
    if (q.monthly) note(t('care.terms'));
    notes.appendChild(h('p', 'det', t('co.mockTravel')));
    $('e-confirm').textContent = '';
  }

  $('back').onclick = () => show('f');

  $('confirm').onclick = () => {
    if (!consent) {
      $('consent').hidden = false;
      return;
    }
    let res;
    try {
      res = fn.createBooking(draft, consent);
    } catch (e) {
      // The mock keeps photos in the browser, which has little room; the real site uploads them.
      if (e.message !== 'storageFull') throw e;
      $('e-confirm').textContent = t('err.storage');
      return;
    }
    if (res.errors) {
      showErrors(res.errors);
      if (res.errors.arrival) renderSlots();
      show('f');
      return;
    }
    const b = res.booking;
    const guest = !user || user.role !== 'private';
    if (guest) {
      if ($('remember').checked) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ name: b.name, phone: b.phone, email: b.email, address: b.address }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    }
    // A new account picks up this booking, because sign-up links guest bookings by email.
    const madeAccount = guest && $('mkacct').checked
      && !NB.auth.signUp({ name: b.name, email: b.email, phone: b.phone, address: b.address, password: $('pw').value }).error;

    $('done-msg').textContent = t('done.msg', { ref: b.ref, email: b.email }) + (madeAccount ? ' ' + t('done.account') : '')
      + (b.photosAddedToBike ? ` ${t('pics.addedToBike', { n: b.photosAddedToBike, name: b.bike })}` : '');
    $('sum').textContent = [
      ...b.services.map((s) => `${svcName(s)}: ${priceLabel(s)}`),
      b.pricing.discount ? `${t(`co.discount.${b.pricing.discountReason}`)}: −${dkk(b.pricing.discount)}` : null,
      `${t('co.travel')}: ${t('co.travelVal', { amount: dkk(b.pricing.travel), km: b.pricing.distanceKm })}`,
      `${t('sum.total')}: ${dkk(b.pricing.total)}`,
      '',
      `${t('sum.date')}: ${util.fmtDate(b.date)}`,
      `${t('sum.arrival')}: ${b.arrival}`,
      `${t('sum.bike')}: ${b.bike}`,
      `${t('sum.address')}: ${b.address}`,
      `${t('sum.notes')}: ${b.note || '–'}`,
      b.photos.length ? t('pics.attached', { n: b.photos.length }) : null,
    ].filter((x) => x != null).join('\n');
    const acct = $('done-acct');
    acct.textContent = '';
    const link = h('a', 'pill');
    if (b.customerUid || madeAccount) {
      link.textContent = t('done.see');
      link.href = 'account.html';
    } else {
      link.textContent = t('done.create');
      link.href = 'account.html?signup=' + encodeURIComponent(b.email);
    }
    acct.appendChild(link);
    show('done');
  };

  $('again').onclick = () => location.reload();

  // ---- Travel rules dialog ----
  let lastFocus = null;
  function openRules() {
    lastFocus = document.activeElement;
    const rl = $('rl');
    rl.textContent = '';
    [
      t('rules.rate', { rate: String(CONFIG.kmRate).replace('.', I18N.lang === 'da' ? ',' : '.'), base: CONFIG.base }),
      t('rules.max', { max: CONFIG.maxKm }),
      t('rules.exact'),
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
    list.forEach((x) => el.appendChild(new Option(label(x), x)));
  };
  // Stored values stay English (the owner's dashboard is English); labels follow the page language.
  fill('ctype', ['Hotel', 'Hostel', 'Bike rental', 'Property management', 'Office', 'Tourism company', 'Municipality / public organization', 'Other'],
    t('f.select'), (x) => t('ctype.' + x));
  fill('cnum', ['1', '2–5', '6–15', '16–35', '35+'], t('f.select'));
  fill('ctime', util.arrivalTimes(), t('f.noPref'));
  $('cdate').min = util.today();

  $('cf').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (id) => $(id).value.trim();
    const input = {
      name: v('cname'), company: v('ccomp'), email: v('cemail'), phone: v('ctel'), companyType: v('ctype'),
      bikes: v('cnum'), preferredDate: v('cdate'), preferredTime: v('ctime'), message: v('cmsg'),
    };
    const res = fn.createConsultation(input);
    $('e-c').textContent = res.error ? t('cf.err.' + res.error) : '';
    if (res.error) return;
    $('cok-msg').textContent = t('cf.doneMsg', { name: input.name, email: input.email });
    $('csum').textContent = [
      `${t('sum.company')}: ${input.company} (${t('ctype.' + input.companyType)})`,
      `${t('sum.bikes')}: ${input.bikes}`,
      `${t('sum.pref')}: ${input.preferredDate ? util.fmtDate(input.preferredDate) : '–'} ${input.preferredTime || ''}`,
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
})();
