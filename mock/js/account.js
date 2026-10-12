// Customer account area: log-in and sign-up, then private or business views.
(function () {
  'use strict';

  const { $, h, A, button, defList, tag } = UI;
  const { store, auth, fn, util, STATUS, PLANS } = NB;
  const dkk = util.fmtDkk;
  const shortDate = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // ---- Log in / create account ----
  function setMode(signup) {
    $('m1').setAttribute('aria-pressed', String(!signup));
    $('m2').setAttribute('aria-pressed', String(signup));
    $('lt').textContent = signup ? 'Create your account' : 'Welcome back';
    $('lf').hidden = signup;
    $('sf').hidden = !signup;
  }
  $('m1').onclick = () => setMode(false);
  $('m2').onclick = () => setMode(true);

  $('lf').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = auth.signIn($('le').value);
    $('e-l').textContent = res.error || '';
    if (!res.error) enter(res.user);
  });
  $('sf').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = auth.signUp({ name: $('sn').value.trim(), email: $('se').value, phone: $('sp').value.trim(), password: $('sw').value });
    $('e-s').textContent = res.error || '';
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
    const t = $('tabs');
    t.textContent = '';
    tabs.forEach(([label, , count], j) => {
      const b = button(label, '', () => go(j));
      if (count) b.appendChild(h('span', 'count', String(count)));
      if (j === i) b.setAttribute('aria-current', 'page');
      t.appendChild(b);
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
      $('hi').textContent = 'Signed in as the owner';
      $('hs').textContent = 'The owner works from the dashboard rather than a customer account.';
      $('tabs').textContent = '';
      const v = $('view');
      v.textContent = '';
      const link = h('a', 'pill', 'Open the dashboard');
      link.href = 'admin.html';
      v.appendChild(link);
      return;
    }
    if (user.role === 'private') {
      const since = new Date(user.createdAt + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      $('hi').textContent = `Hello, ${user.name.split(' ')[0]}`;
      $('hs').textContent = `Customer since ${since}`;
      const open = upcoming(user).length;
      tabs = [['Overview', (v) => overview(v, user)], ['Bookings', (v) => bookings(v, user), open], ['History', (v) => history(v, user)], ['My bikes', (v) => bikes(v, user)], ['Recommendations', (v) => recs(v, user)]];
    } else {
      const c = store.get('companies', user.companyId);
      const plan = PLANS.find((p) => p.id === c.plan);
      const n = store.list(`companies/${c.id}/bikes`).length;
      $('hi').textContent = c.name;
      $('hs').textContent = `${plan.name} plan · ${c.pricePerBike} DKK / bike / month · ${n} bikes` + (c.nextVisit ? ` · Next visit ${shortDate(c.nextVisit)}` : '');
      tabs = [['Monthly report', (v) => report(v, c)], ['Fleet list', (v) => fleet(v, c)], ['Plan & visits', (v) => planView(v, c, plan, n)]];
    }
    go(0);
    window.scrollTo(0, 0);
  }

  // ---- Private customer ----
  const myBikes = (u) => store.list(`users/${u.id}/bikes`);
  const bikeName = (u, id) => (myBikes(u).find((b) => b.id === id) || { name: 'Bike' }).name;
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
    A(g, stat(myBikes(u).length, 'Bikes'), stat(thisYear.length, `Services in ${year}`), stat(dkk(thisYear.reduce((a, r) => a + recordTotal(r), 0)), `Total spent in ${year}`));
    v.appendChild(g);

    const g2 = h('div', 'grid');
    const next = upcoming(u)[0];
    const c0 = h('div', 'paper');
    A(c0, h('h3', '', 'Next visit'));
    if (next) A(c0, h('p', '', `${util.fmtDate(next.date)} at ${next.arrival}`), h('p', '', next.services.map((s) => s.name).join(', ')), tag(next.status));
    else A(c0, h('p', '', 'Nothing booked.'), Object.assign(h('a', 'pill', 'Book a Bike Service'), { href: 'index.html#book' }));
    g2.appendChild(c0);

    const last = myRecords(u)[0];
    if (last) {
      const c1 = h('div', 'paper');
      A(c1, h('h3', '', 'Last service'), h('p', '', `${shortDate(last.date)} · ${last.title} · ${bikeName(u, last.bikeId)}`), h('p', '', last.notes));
      g2.appendChild(c1);
    }
    const rec = openRecs(u)[0];
    if (rec) {
      const c2 = h('div', 'paper');
      A(c2, h('h3', '', 'Next recommendation'), h('p', '', `${rec.title} (${bikeName(u, rec.bikeId)})`), h('p', '', rec.reason), button('See all recommendations', 'pill', () => go(4)));
      g2.appendChild(c2);
    }
    v.appendChild(g2);
  }

  function bookings(v, u) {
    const up = upcoming(u);
    const past = myBookings(u).filter((b) => !up.includes(b)).reverse();
    v.appendChild(h('h3', '', 'Upcoming'));
    if (!up.length) v.appendChild(h('p', 'sub', 'No upcoming visits.'));
    up.forEach((b) => v.appendChild(bookingCard(u, b, true)));
    if (past.length) {
      v.appendChild(h('h3', '', 'Earlier and cancelled'));
      past.forEach((b) => v.appendChild(bookingCard(u, b, false)));
    }
    const link = h('a', 'pill', 'Book a new visit');
    link.href = 'index.html#book';
    link.style.marginTop = '16px';
    v.appendChild(link);
  }

  function bookingCard(u, b, canCancel) {
    const c = h('div', 'paper');
    c.style.marginBottom = '12px';
    A(c, tag(b.status), h('h3', '', `${util.fmtDate(b.date)} at ${b.arrival}`), h('p', 'meta', `${b.ref} · ${b.bike} · ${b.address}`));
    const ul = h('ul');
    b.services.forEach((s) => ul.appendChild(h('li', '', `${s.name}: ${s.price == null ? 'price by agreement' : dkk(s.price) + (s.monthly ? ' / month' : '')}`)));
    c.appendChild(ul);
    if (b.pricing.travel != null) c.appendChild(h('p', 'det', `Travel estimate ${dkk(b.pricing.travel)} · estimated total ${dkk(b.pricing.total)}`));
    if (canCancel) {
      c.appendChild(button('Cancel this booking', 'alt sm', () => {
        if (!confirm(`Cancel booking ${b.ref}?`)) return;
        fn.cancelBooking(b.id, 'Cancelled by customer');
        enter(u);
        go(1);
      }));
    }
    return c;
  }

  function history(v, u) {
    const recs = myRecords(u);
    if (!recs.length) v.appendChild(h('p', 'sub', 'No services yet. After each visit, the work done, parts, notes and photos appear here.'));
    recs.forEach((r, i) => {
      const d = h('details', 'paper');
      const body = h('div', 'body');
      const ul = h('ul');
      r.work.forEach((w) => ul.appendChild(h('li', '', w)));
      A(body, h('h3', '', 'Work done'), ul);
      if (r.parts.length) {
        const pl = h('ul');
        r.parts.forEach((p) => pl.appendChild(h('li', '', `${p.name} · ${dkk(p.price)}`)));
        A(body, h('h3', '', 'Parts used'), pl);
      }
      A(body, h('h3', '', 'Notes'), h('p', '', r.notes || '–'));
      const ph = h('div', 'photos');
      r.photos.forEach((name, k) => {
        const box = h('div', 'photo', `Photo ${k + 1}`);
        box.title = name;
        ph.appendChild(box);
      });
      A(body, ph, h('h3', '', 'Cost'));
      const row = (a, b, total) => {
        const e = h('div', 'row2' + (total ? ' t' : ''));
        A(e, h('span', '', a), h('span', '', b));
        body.appendChild(e);
      };
      row(r.title, dkk(r.cost.service));
      r.parts.forEach((p) => row(p.name, dkk(p.price)));
      row('Travel', dkk(r.cost.travel));
      row('Total', dkk(recordTotal(r)), true);
      A(d, h('summary', '', `${shortDate(r.date)} · ${r.title} · ${bikeName(u, r.bikeId)}`), body);
      if (i === 0) d.open = true;
      v.appendChild(d);
    });
  }

  function bikes(v, u) {
    const g = h('div', 'grid');
    myBikes(u).forEach((b) => {
      const lastRec = myRecords(u).find((r) => r.bikeId === b.id);
      const c = h('div', 'paper');
      A(c, h('h3', '', b.name), h('p', '', [b.type, b.year].filter(Boolean).join(' · ')), defList([
        ['Frame size', b.size], ['Frame', b.frame], ['Gears', b.gears], ['Brakes', b.brakes], ['Tyres', b.tyres],
        ['Colour', b.colour], ['Usage', b.usage], ['Last service', lastRec ? shortDate(lastRec.date) : 'Not yet'],
      ]));
      g.appendChild(c);
    });
    v.appendChild(g);

    // Add a bike
    const f = h('form', 'box');
    f.noValidate = true;
    f.style.maxWidth = '640px';
    f.appendChild(h('h2', '', 'Add a bike'));
    const fields = [['name', 'Name or model', 'e.g. Trek FX 3'], ['type', 'Type', 'e.g. City bike'], ['year', 'Year', ''], ['size', 'Frame size', ''], ['gears', 'Gears', ''], ['brakes', 'Brakes', ''], ['tyres', 'Tyres', ''], ['colour', 'Colour', ''], ['usage', 'How you use it', 'e.g. Daily commute']];
    const inputs = {};
    const grid = h('div', 'row');
    fields.forEach(([k, label, ph]) => {
      const wrap = h('div');
      const l = h('label', '', label);
      const i = h('input');
      i.type = 'text';
      i.id = 'nb-' + k;
      i.placeholder = ph;
      l.htmlFor = i.id;
      inputs[k] = i;
      A(wrap, l, i);
      grid.appendChild(wrap);
    });
    const err = h('p', 'err');
    const submit = h('button', 'pill', 'Save bike');
    submit.type = 'submit';
    A(f, grid, err, submit);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const bike = {};
      Object.entries(inputs).forEach(([k, i]) => { bike[k] = i.value.trim(); });
      if (!bike.name) {
        err.textContent = 'Give the bike a name or model.';
        return;
      }
      fn.addBike(u.id, bike);
      go(3);
    });
    v.appendChild(f);
  }

  const openRecs = (u) => store.list('recommendations', (r) => r.ownerUid === u.id && r.status === 'open')
    .sort((a, b) => (a.urgency === 'soon' ? -1 : 0) - (b.urgency === 'soon' ? -1 : 0));

  function recs(v, u) {
    const list = openRecs(u);
    if (!list.length) v.appendChild(h('p', 'sub', 'No recommendations right now.'));
    list.forEach((r) => {
      const c = h('div', 'paper');
      c.style.marginBottom = '12px';
      const book = h('a', 'alt sm', 'Book this');
      book.href = 'index.html#book';
      A(c, tag(r.urgency, r.urgency === 'soon' ? 'Do soon' : 'Plan ahead'), h('h3', '', r.title), h('p', '', `${bikeName(u, r.bikeId)} · ${r.dueBy}`), h('p', '', r.reason), book);
      v.appendChild(c);
    });
  }

  // ---- Business customer ----
  let month = null;

  function report(v, c) {
    const reports = store.list(`companies/${c.id}/reports`).sort((a, b) => b.month.localeCompare(a.month));
    if (!reports.length) {
      v.appendChild(h('p', 'sub', 'Your first fleet report appears here after the initial fleet assessment.'));
      return;
    }
    if (!month || !reports.some((r) => r.id === month)) month = reports[0].id;
    const rep = reports.find((r) => r.id === month);
    const fleetBikes = store.list(`companies/${c.id}/bikes`);

    const top = h('div', 'toolbar');
    const lb = h('label', '', 'Report month');
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
    A(g, stat(`${n.ready} of ${fleetBikes.length}`, 'Ready to ride'), stat(n.attention, 'Need attention'), stat(n.repair, 'Repair needed'));
    v.appendChild(g);

    const p = h('div', 'paper');
    const w = h('div', 'tw');
    A(p, h('h3', '', `${c.name}: Fleet Report, ${util.monthLabel(rep.id)}`), h('p', 'meta', `Visit on ${shortDate(rep.visitDate)}`));
    const t = h('table', 'rep');
    const hd = t.createTHead().insertRow();
    ['Bike', 'Location', 'Status', 'Action'].forEach((x) => { const th = h('th', '', x); th.scope = 'col'; hd.appendChild(th); });
    const tb = t.createTBody();
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
        A(box, h('h3', '', `Bike ${b.number}`), defList([
          ['Bike', `${b.number} · ${b.type} (${b.year})`], ['Location', b.location], ['Size', b.size], ['Gears', b.gears],
          ['Brakes', b.brakes], ['Status', STATUS[e.status]], ['Action', e.action], ["Mechanic's note", e.note],
        ]));
        det.appendChild(box);
      });
      btn.setAttribute('aria-label', `Details for bike ${b.number}`);
      r.insertCell().appendChild(btn);
      r.insertCell().textContent = b.location;
      const sc = r.insertCell();
      sc.className = 'st ' + e.status;
      sc.textContent = STATUS[e.status];
      r.insertCell().textContent = e.action;
    });
    w.appendChild(t);
    A(p, w, h('p', 'meta', 'Select a bike number to see its details.'), det);
    v.appendChild(p);
    v.appendChild(h('p', 'sub', 'Parts and repairs outside the plan are charged separately. You are told the price before any extra work.')).style.marginTop = '14px';
  }

  function fleet(v, c) {
    const fleetBikes = store.list(`companies/${c.id}/bikes`);
    const latest = store.list(`companies/${c.id}/reports`).sort((a, b) => b.month.localeCompare(a.month))[0];
    v.appendChild(h('p', 'sub', `${fleetBikes.length} bikes in the fleet, grouped by location.`));
    [...new Set(fleetBikes.map((b) => b.location))].forEach((loc) => {
      v.appendChild(h('h3', '', loc));
      const g = h('div', 'grid');
      fleetBikes.filter((b) => b.location === loc).forEach((b) => {
        const e = latest && latest.entries[b.id];
        const card = h('div', 'paper');
        A(card, h('h3', '', `${b.number} · ${b.type}`), e ? h('p', 'st ' + e.status, STATUS[e.status]) : null,
          defList([['Year', b.year], ['Size', b.size], ['Gears', b.gears], ['Brakes', b.brakes]]));
        g.appendChild(card);
      });
      v.appendChild(g);
    });
  }

  function planView(v, c, plan, n) {
    const g = h('div', 'grid');
    const p1 = h('div', 'paper');
    const ul = h('ul');
    plan.includes.forEach((x) => ul.appendChild(h('li', '', x)));
    A(p1, h('h3', '', `${plan.name} plan`), h('p', 'price', dkk(c.pricePerBike * n) + ' / month'), h('p', 'det', `${n} bikes × ${c.pricePerBike} DKK`), ul,
      h('p', 'no', 'Parts and repairs outside the plan are charged separately.'));
    const p2 = h('div', 'paper');
    A(p2, h('h3', '', 'Visits'), defList([
      ['Next visit', c.nextVisit ? util.fmtDate(c.nextVisit) : 'To be agreed'], ['Customer since', shortDate(c.since)],
      ['Contact', c.contact], ['Email', c.email], ['Phone', c.phone],
    ]), h('p', 'det', 'Need a change of plan or an extra visit? Reply to any report email or call us.'));
    A(g, p1, p2);
    v.appendChild(g);
  }

  const current = auth.current();
  if (current) enter(current);
})();
