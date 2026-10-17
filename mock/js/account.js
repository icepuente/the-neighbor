// Customer account area: log-in and sign-up, then private or business views.
(function () {
  'use strict';

  const { $, h, A, button, defList, tag, t } = UI;
  const { store, auth, fn, util, PLANS } = NB;
  const dkk = util.fmtDkk;
  const svcName = I18N.svc;
  const locale = I18N.lang === 'da' ? 'da-DK' : 'en-GB';
  const shortDate = (s) => new Date(s + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const statusLabel = (s) => t('st.' + s);
  const priceLabel = (s) => (s.price == null ? t('byAgreement') : dkk(s.price) + (s.monthly ? ' ' + t('perMonth') : ''));

  // ---- Log in / create account ----
  function setMode(signup) {
    $('m1').setAttribute('aria-pressed', String(!signup));
    $('m2').setAttribute('aria-pressed', String(signup));
    $('lt').textContent = t(signup ? 'acc.createTitle' : 'acc.welcome');
    $('lf').hidden = signup;
    $('sf').hidden = !signup;
  }
  $('m1').onclick = () => setMode(false);
  $('m2').onclick = () => setMode(true);

  $('lf').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = auth.signIn($('le').value);
    $('e-l').textContent = res.error ? t('acc.err.' + res.error) : '';
    if (!res.error) enter(res.user);
  });
  $('sf').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = auth.signUp({ name: $('sn').value.trim(), email: $('se').value, phone: $('sp').value.trim(), password: $('sw').value });
    $('e-s').textContent = res.error ? t('acc.err.' + res.error) : '';
    if (!res.error) enter(res.user);
  });
  document.querySelectorAll('[data-demo]').forEach((b) => {
    b.onclick = () => enter(auth.signIn(b.dataset.demo).user);
  });
  $('out').onclick = () => {
    auth.signOut();
    location.reload();
  };

  const params = new URLSearchParams(location.search);
  if (params.get('signup')) {
    setMode(true);
    $('se').value = params.get('signup');
  }

  // ---- Tabs ----
  let tabs = [];
  function go(i) {
    const bar = $('tabs');
    bar.textContent = '';
    tabs.forEach(([label, , count], j) => {
      const b = button(label, '', () => go(j));
      if (count) b.appendChild(h('span', 'count', String(count)));
      if (j === i) b.setAttribute('aria-current', 'page');
      bar.appendChild(b);
    });
    const v = $('view');
    v.textContent = '';
    tabs[i][1](v);
  }

  function enter(user) {
    $('login').hidden = true;
    $('app').hidden = false;
    $('out').hidden = false;
    if (user.role === 'admin') {
      $('hi').textContent = t('acc.owner');
      $('hs').textContent = t('acc.ownerSub');
      $('tabs').textContent = '';
      const v = $('view');
      v.textContent = '';
      const link = h('a', 'pill', t('acc.openDashboard'));
      link.href = 'admin.html';
      v.appendChild(link);
      return;
    }
    if (user.role === 'private') {
      const since = new Date(user.createdAt + 'T12:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' });
      $('hi').textContent = t('acc.hello', { name: user.name.split(' ')[0] });
      $('hs').textContent = t('acc.since', { month: since });
      const open = upcoming(user).length;
      tabs = [
        [t('tab.overview'), (v) => overview(v, user)],
        [t('tab.bookings'), (v) => bookings(v, user), open],
        [t('tab.history'), (v) => history(v, user)],
        [t('tab.bikes'), (v) => bikes(v, user)],
        [t('tab.recs'), (v) => recs(v, user)],
      ];
    } else {
      const c = store.get('companies', user.companyId);
      const plan = PLANS.find((p) => p.id === c.plan);
      const n = store.list(`companies/${c.id}/bikes`).length;
      $('hi').textContent = c.name;
      $('hs').textContent = t('plan.header', { plan: plan.name, price: dkk(c.pricePerBike), n })
        + (c.nextVisit ? t('plan.nextVisit', { date: shortDate(c.nextVisit) }) : '');
      tabs = [[t('tab.report'), (v) => report(v, c)], [t('tab.fleet'), (v) => fleet(v, c)], [t('tab.plan'), (v) => planView(v, c, plan, n)]];
    }
    go(0);
    window.scrollTo(0, 0);
  }

  // ---- Private customer ----
  const myBikes = (u) => store.list(`users/${u.id}/bikes`);
  const bikeName = (u, id) => (myBikes(u).find((b) => b.id === id) || { name: '–' }).name;
  const myRecords = (u) => store.list('serviceRecords', (r) => r.ownerUid === u.id).sort((a, b) => b.date.localeCompare(a.date));
  const myBookings = (u) => store.list('bookings', (b) => b.customerUid === u.id).sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = (u) => myBookings(u).filter((b) => b.date >= util.today() && ['pending', 'confirmed'].includes(b.status));
  const recordTotal = (r) => r.cost.service + r.cost.parts + r.cost.travel;

  function stat(value, label) {
    const c = h('div', 'card');
    A(c, h('div', 'stat', String(value)), h('small', '', label));
    return c;
  }

  function overview(v, u) {
    const year = util.today().slice(0, 4);
    const thisYear = myRecords(u).filter((r) => r.date.startsWith(year));
    const g = h('div', 'grid');
    A(g, stat(myBikes(u).length, t('ov.bikes')), stat(thisYear.length, t('ov.services', { year })),
      stat(dkk(thisYear.reduce((a, r) => a + recordTotal(r), 0)), t('ov.spent', { year })));
    v.appendChild(g);

    const g2 = h('div', 'grid');
    const next = upcoming(u)[0];
    const c0 = h('div', 'paper');
    A(c0, h('h3', '', t('ov.next')));
    if (next) {
      A(c0, h('p', '', t('dateAt', { date: util.fmtDate(next.date), time: next.arrival })),
        h('p', '', next.services.map(svcName).join(', ')), tag(next.status, t('bs.' + next.status)));
    } else {
      A(c0, h('p', '', t('ov.none')), Object.assign(h('a', 'pill', t('nav.book')), { href: 'index.html#book' }));
    }
    g2.appendChild(c0);

    const last = myRecords(u)[0];
    if (last) {
      const c1 = h('div', 'paper');
      A(c1, h('h3', '', t('ov.last')), h('p', '', `${shortDate(last.date)} · ${last.title} · ${bikeName(u, last.bikeId)}`), h('p', '', last.notes));
      g2.appendChild(c1);
    }
    const rec = openRecs(u)[0];
    if (rec) {
      const c2 = h('div', 'paper');
      A(c2, h('h3', '', t('ov.rec')), h('p', '', `${rec.title} (${bikeName(u, rec.bikeId)})`), h('p', '', rec.reason),
        button(t('ov.allRecs'), 'pill', () => go(4)));
      g2.appendChild(c2);
    }
    v.appendChild(g2);
  }

  function bookings(v, u) {
    const up = upcoming(u);
    const past = myBookings(u).filter((b) => !up.includes(b)).reverse();
    v.appendChild(h('h3', '', t('bks.upcoming')));
    if (!up.length) v.appendChild(h('p', 'sub', t('bks.none')));
    up.forEach((b) => v.appendChild(bookingCard(u, b, true)));
    if (past.length) {
      v.appendChild(h('h3', '', t('bks.earlier')));
      past.forEach((b) => v.appendChild(bookingCard(u, b, false)));
    }
    const link = h('a', 'pill', t('bks.new'));
    link.href = 'index.html#book';
    link.style.marginTop = '16px';
    v.appendChild(link);
  }

  function bookingCard(u, b, canCancel) {
    const c = h('div', 'paper');
    c.style.marginBottom = '12px';
    A(c, tag(b.status, t('bs.' + b.status)), h('h3', '', t('dateAt', { date: util.fmtDate(b.date), time: b.arrival })),
      h('p', 'meta', `${b.ref} · ${b.bike} · ${b.address}`));
    const ul = h('ul');
    b.services.forEach((s) => ul.appendChild(h('li', '', `${svcName(s)}: ${priceLabel(s)}`)));
    c.appendChild(ul);
    if (b.pricing.travel != null) c.appendChild(h('p', 'det', t('bks.price', { travel: dkk(b.pricing.travel), total: dkk(b.pricing.total) })));
    if (b.photos && b.photos.length) c.appendChild(UI.gallery(b.photos));
    if (canCancel) {
      c.appendChild(button(t('bks.cancel'), 'alt sm', () => {
        if (!confirm(t('bks.cancelAsk', { ref: b.ref }))) return;
        fn.cancelBooking(b.id, 'Cancelled by customer');
        enter(u);
        go(1);
      }));
    }
    return c;
  }

  function history(v, u) {
    const recs = myRecords(u);
    if (!recs.length) v.appendChild(h('p', 'sub', t('hist.empty')));
    recs.forEach((r, i) => {
      const d = h('details', 'paper');
      const body = h('div', 'body');
      const ul = h('ul');
      r.work.forEach((w) => ul.appendChild(h('li', '', w)));
      A(body, h('h3', '', t('hist.work')), ul);
      if (r.parts.length) {
        const pl = h('ul');
        r.parts.forEach((p) => pl.appendChild(h('li', '', `${p.name} · ${dkk(p.price)}`)));
        A(body, h('h3', '', t('hist.parts')), pl);
      }
      A(body, h('h3', '', t('hist.notes')), h('p', '', r.notes || '–'));
      const ph = h('div', 'photos');
      r.photos.forEach((name, k) => {
        const box = h('div', 'photo', t('hist.photo', { n: k + 1 }));
        box.title = name;
        ph.appendChild(box);
      });
      A(body, ph, h('h3', '', t('hist.cost')));
      const row = (a, b, total) => {
        const e = h('div', 'row2' + (total ? ' t' : ''));
        A(e, h('span', '', a), h('span', '', b));
        body.appendChild(e);
      };
      row(r.title, dkk(r.cost.service));
      r.parts.forEach((p) => row(p.name, dkk(p.price)));
      row(t('hist.travel'), dkk(r.cost.travel));
      row(t('hist.total'), dkk(recordTotal(r)), true);
      A(d, h('summary', '', `${shortDate(r.date)} · ${r.title} · ${bikeName(u, r.bikeId)}`), body);
      if (i === 0) d.open = true;
      v.appendChild(d);
    });
  }

  // The bike being edited in the form below the cards, or null when the form adds a new bike.
  let editingBike = null;

  function bikes(v, u) {
    const g = h('div', 'grid');
    myBikes(u).forEach((b) => {
      const lastRec = myRecords(u).find((r) => r.bikeId === b.id);
      const c = h('div', 'paper bike-card');
      const photos = b.photos || [];
      // The first photo is the cover; the rest sit as thumbnails under the details.
      if (photos.length) {
        const cover = h('button', 'cover');
        cover.type = 'button';
        const img = h('img');
        img.src = photos[0].data;
        img.alt = t('pics.ofBike', { name: b.name });
        cover.onclick = () => UI.openPhoto(photos[0].data, img.alt);
        cover.appendChild(img);
        c.appendChild(cover);
      }
      A(c, h('h3', '', b.name), h('p', '', [b.type, b.year].filter(Boolean).join(' · ')), defList([
        [t('bike.size'), b.size], [t('bike.frame'), b.frame], [t('bike.gears'), b.gears], [t('bike.brakes'), b.brakes],
        [t('bike.tyres'), b.tyres], [t('bike.colour'), b.colour], [t('bike.usage'), b.usage],
        [t('bike.last'), lastRec ? shortDate(lastRec.date) : t('bike.notYet')],
      ]));
      if (photos.length > 1) c.appendChild(UI.gallery(photos.slice(1), (n) => t('pics.alt', { n: n + 1 })));
      c.appendChild(button(t('bike.edit'), 'alt sm', () => {
        editingBike = b.id;
        go(3);
        $('bike-form').scrollIntoView({ block: 'start' });
      }));
      g.appendChild(c);
    });
    v.appendChild(g);

    // Add a bike, or edit the one chosen above
    const editing = editingBike ? myBikes(u).find((b) => b.id === editingBike) : null;
    const f = h('form', 'box');
    f.id = 'bike-form';
    f.noValidate = true;
    f.style.maxWidth = '640px';
    f.appendChild(h('h2', '', editing ? t('bike.editTitle', { name: editing.name }) : t('bike.add')));
    const fields = [
      ['name', t('bike.name'), t('bike.namePh')], ['type', t('bike.type'), t('bike.typePh')], ['year', t('bike.year'), ''],
      ['size', t('bike.size'), ''], ['gears', t('bike.gears'), ''], ['brakes', t('bike.brakes'), ''], ['tyres', t('bike.tyres'), ''],
      ['colour', t('bike.colour'), ''], ['usage', t('bike.usageLabel'), t('bike.usagePh')],
    ];
    const inputs = {};
    const grid = h('div', 'row');
    fields.forEach(([k, label, ph]) => {
      const wrap = h('div');
      const l = h('label', '', label);
      const i = h('input');
      i.type = 'text';
      i.id = 'nb-' + k;
      i.placeholder = ph;
      if (editing && editing[k] != null) i.value = editing[k];
      l.htmlFor = i.id;
      inputs[k] = i;
      A(wrap, l, i);
      grid.appendChild(wrap);
    });
    const photoLabel = h('label', 'lb', t('bike.photos'));
    photoLabel.htmlFor = 'nb-photos';
    const picker = UI.photoPicker({ max: NB.CONFIG.maxBikePhotos, initial: editing ? editing.photos || [] : [], id: 'nb-photos' });
    const err = h('p', 'err');
    err.setAttribute('role', 'alert');
    const submit = h('button', 'pill', t(editing ? 'bike.saveChanges' : 'bike.save'));
    submit.type = 'submit';
    A(f, grid, photoLabel, h('p', 'det', t('bike.photosHint')), picker.el, err, submit);
    if (editing) {
      f.appendChild(button(t('bike.cancel'), 'alt', () => { editingBike = null; go(3); }));
    }
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const bike = { photos: picker.get() };
      Object.entries(inputs).forEach(([k, i]) => { bike[k] = i.value.trim(); });
      if (!bike.name) {
        err.textContent = t('bike.err');
        return;
      }
      try {
        if (editing) fn.updateBike(u.id, editing.id, bike);
        else fn.addBike(u.id, bike);
      } catch (ex) {
        // The mock keeps photos in the browser, which has little room; the real site uploads them.
        if (ex.message !== 'storageFull') throw ex;
        err.textContent = t('err.storage');
        return;
      }
      editingBike = null;
      go(3);
    });
    v.appendChild(f);
  }

  const openRecs = (u) => store.list('recommendations', (r) => r.ownerUid === u.id && r.status === 'open')
    .sort((a, b) => (a.urgency === 'soon' ? -1 : 0) - (b.urgency === 'soon' ? -1 : 0));

  function recs(v, u) {
    const list = openRecs(u);
    if (!list.length) v.appendChild(h('p', 'sub', t('rec.empty')));
    list.forEach((r) => {
      const c = h('div', 'paper');
      c.style.marginBottom = '12px';
      const book = h('a', 'alt sm', t('rec.book'));
      book.href = 'index.html#book';
      A(c, tag(r.urgency, t(r.urgency === 'soon' ? 'rec.soon' : 'rec.later')), h('h3', '', r.title),
        h('p', '', `${bikeName(u, r.bikeId)} · ${r.dueBy}`), h('p', '', r.reason), book);
      v.appendChild(c);
    });
  }

  // ---- Business customer ----
  let month = null;

  function report(v, c) {
    const reports = store.list(`companies/${c.id}/reports`).sort((a, b) => b.month.localeCompare(a.month));
    if (!reports.length) {
      v.appendChild(h('p', 'sub', t('rep.empty')));
      return;
    }
    if (!month || !reports.some((r) => r.id === month)) month = reports[0].id;
    const rep = reports.find((r) => r.id === month);
    const fleetBikes = store.list(`companies/${c.id}/bikes`);

    const top = h('div', 'toolbar');
    const lb = h('label', '', t('rep.month'));
    const sel = h('select');
    sel.id = 'mo';
    lb.htmlFor = 'mo';
    reports.forEach((r) => sel.appendChild(new Option(util.monthLabel(r.id), r.id, false, r.id === month)));
    sel.onchange = () => { month = sel.value; go(0); };
    const wrap = h('div');
    A(wrap, lb, sel);
    top.appendChild(wrap);
    v.appendChild(top);

    const n = util.counts(rep.entries);
    const g = h('div', 'grid');
    A(g, stat(t('rep.of', { a: n.ready, b: fleetBikes.length }), t('rep.ready')), stat(n.attention, t('rep.attention')), stat(n.repair, t('rep.repair')));
    v.appendChild(g);

    const p = h('div', 'paper');
    const w = h('div', 'tw');
    A(p, h('h3', '', t('rep.title', { company: c.name, month: util.monthLabel(rep.id) })), h('p', 'meta', t('rep.visit', { date: shortDate(rep.visitDate) })));
    const tbl = h('table', 'rep');
    const hd = tbl.createTHead().insertRow();
    ['col.bike', 'col.location', 'col.status', 'col.action'].forEach((x) => { const th = h('th', '', t(x)); th.scope = 'col'; hd.appendChild(th); });
    const tb = tbl.createTBody();
    const det = h('div');
    det.setAttribute('aria-live', 'polite');
    fleetBikes.forEach((b) => {
      const e = rep.entries[b.id];
      if (!e) return;
      const r = tb.insertRow();
      const btn = button(b.number, 'lnk', () => {
        det.textContent = '';
        const box = h('div');
        box.style.cssText = 'border-top:2px solid #102f33;margin-top:12px;padding-top:10px';
        A(box, h('h3', '', t('rep.bike', { n: b.number })), defList([
          [t('col.bike'), `${b.number} · ${b.type} (${b.year})`], [t('col.location'), b.location], [t('rep.size'), b.size],
          [t('bike.gears'), b.gears], [t('bike.brakes'), b.brakes], [t('col.status'), statusLabel(e.status)],
          [t('col.action'), e.action], [t('rep.note'), e.note],
        ]));
        det.appendChild(box);
      });
      btn.setAttribute('aria-label', t('rep.details', { n: b.number }));
      r.insertCell().appendChild(btn);
      r.insertCell().textContent = b.location;
      const sc = r.insertCell();
      sc.className = 'st ' + e.status;
      sc.textContent = statusLabel(e.status);
      r.insertCell().textContent = e.action;
    });
    w.appendChild(tbl);
    A(p, w, h('p', 'meta', t('rep.hint')), det);
    v.appendChild(p);
    v.appendChild(h('p', 'sub', t('rep.foot'))).style.marginTop = '14px';
  }

  function fleet(v, c) {
    const fleetBikes = store.list(`companies/${c.id}/bikes`);
    const latest = store.list(`companies/${c.id}/reports`).sort((a, b) => b.month.localeCompare(a.month))[0];
    v.appendChild(h('p', 'sub', t('fleet.count', { n: fleetBikes.length })));
    [...new Set(fleetBikes.map((b) => b.location))].forEach((loc) => {
      v.appendChild(h('h3', '', loc));
      const g = h('div', 'grid');
      fleetBikes.filter((b) => b.location === loc).forEach((b) => {
        const e = latest && latest.entries[b.id];
        const card = h('div', 'paper');
        A(card, h('h3', '', `${b.number} · ${b.type}`), e ? h('p', 'st ' + e.status, statusLabel(e.status)) : null,
          defList([[t('bike.year'), b.year], [t('rep.size'), b.size], [t('bike.gears'), b.gears], [t('bike.brakes'), b.brakes]]));
        g.appendChild(card);
      });
      v.appendChild(g);
    });
  }

  function planView(v, c, plan, n) {
    const g = h('div', 'grid');
    const p1 = h('div', 'paper');
    const ul = h('ul');
    (I18N.lang === 'da' ? plan.includesDa : plan.includes).forEach((x) => ul.appendChild(h('li', '', x)));
    A(p1, h('h3', '', t('plan.name', { plan: plan.name })), h('p', 'price', `${dkk(c.pricePerBike * n)} ${t('perMonth')}`),
      h('p', 'det', t('plan.calc', { n, price: dkk(c.pricePerBike) })), ul, h('p', 'no', t('rep.foot')));
    const p2 = h('div', 'paper');
    A(p2, h('h3', '', t('plan.visits')), defList([
      [t('plan.next'), c.nextVisit ? util.fmtDate(c.nextVisit) : t('plan.tba')], [t('plan.since'), shortDate(c.since)],
      [t('plan.contact'), c.contact], [t('f.email'), c.email], [t('f.phone'), c.phone],
    ]), h('p', 'det', t('plan.help')));
    A(g, p1, p2);
    v.appendChild(g);
  }

  const current = auth.current();
  if (current) enter(current);
})();
