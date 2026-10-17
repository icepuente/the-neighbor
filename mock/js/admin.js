// Owner dashboard: bookings, consultation requests, logging visits, fleet reports, customers, outbox.
(function () {
  'use strict';

  const { $, h, A, button, defList, tag } = UI;
  const { store, auth, fn, util, STATUS, PLANS } = NB;
  const dkk = util.fmtDkk;

  // ---- Gate ----
  function start() {
    const user = auth.current();
    const isOwner = user && user.role === 'admin';
    $('gate').hidden = isOwner;
    $('app').hidden = !isOwner;
    $('out').hidden = !user;
    if (isOwner) {
      $('today').textContent = 'Today is ' + util.fmtDate(util.today());
      go(0);
    }
  }
  $('as-owner').onclick = () => {
    auth.signIn('owner@example.com');
    start();
  };
  $('out').onclick = () => {
    auth.signOut();
    start();
  };

  // ---- Tabs ----
  const tabs = [
    ['Bookings', bookingsView, () => store.list('bookings', (b) => b.status === 'pending').length],
    ['Requests', requestsView, () => store.list('consultations', (l) => l.status === 'new').length],
    ['Log a visit', visitView],
    ['Fleet reports', reportsView],
    ['Customers', customersView],
    ['Outbox', outboxView, () => store.list('mail').length],
  ];
  let visitPrefill = null;

  function go(i) {
    const t = $('tabs');
    t.textContent = '';
    tabs.forEach(([label, , count], j) => {
      const b = button(label, '', () => go(j));
      const n = count && count();
      if (n) b.appendChild(h('span', 'count', String(n)));
      if (j === i) b.setAttribute('aria-current', 'page');
      t.appendChild(b);
    });
    const v = $('view');
    v.textContent = '';
    tabs[i][1](v);
  }

  function field(labelText, input) {
    const wrap = h('div');
    const l = h('label', '', labelText);
    input.id = input.id || 'f-' + Math.random().toString(36).slice(2, 8);
    l.htmlFor = input.id;
    A(wrap, l, input);
    return wrap;
  }
  function input(type, value) {
    const i = h(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') i.type = type;
    else i.rows = 3;
    if (value != null) i.value = value;
    return i;
  }
  function select(options, value) {
    const s = h('select');
    options.forEach(([v, label]) => s.appendChild(new Option(label, v, false, v === value)));
    return s;
  }

  // ---- Bookings ----
  let bookingFilter = 'upcoming';
  function bookingsView(v) {
    const bar = h('div', 'toolbar');
    const sel = select([['upcoming', 'Upcoming'], ['pending', 'Waiting for confirmation'], ['all', 'All bookings']], bookingFilter);
    sel.onchange = () => { bookingFilter = sel.value; go(0); };
    bar.appendChild(field('Show', sel));
    v.appendChild(bar);

    const today = util.today();
    const list = store.list('bookings', (b) => {
      if (bookingFilter === 'pending') return b.status === 'pending';
      if (bookingFilter === 'upcoming') return b.date >= today && b.status !== 'cancelled';
      return true;
    }).sort((a, b) => (a.date + a.arrival).localeCompare(b.date + b.arrival));
    if (!list.length) v.appendChild(h('p', 'sub', 'Nothing here.'));

    const wrap = h('div', 'list');
    list.forEach((b) => {
      // Compact card: the essentials up front, contact details behind a toggle.
      const c = h('div', 'paper');
      const services = b.services.map((s) => s.name).join(', ');
      const price = b.pricing.special ? 'price by agreement' : `≈ ${dkk(b.pricing.total)}`;
      const head = h('h3', '', `${util.fmtDate(b.date)} · ${b.arrival} · ${b.name} `);
      head.appendChild(tag(b.status));
      if (b.urgent) head.appendChild(tag('soon', 'Urgent (Care Plus)'));
      const more = h('details');
      A(more, h('summary', 'meta', 'Details'), defList([
        ['Phone', b.phone], ['Email', b.email], ['Address', b.address], ['Bike', b.bike], ['Notes', b.note],
        ['Travel', b.pricing.travel == null ? 'to confirm' : `${dkk(b.pricing.travel)} (${b.pricing.distanceKm} km)`], ['Ref', b.ref],
      ]));
      A(c, head, h('p', 'det', `${services} · ${price}`));
      // Photos the customer attached: the bike, or the problem to look at.
      if (b.photos && b.photos.length) c.appendChild(UI.gallery(b.photos, (n) => `Customer photo ${n}`));
      c.appendChild(more);
      if (b.status === 'pending') c.appendChild(button('Confirm', 'alt sm', () => { fn.setBookingStatus(b.id, 'confirmed'); go(0); }));
      if (['pending', 'confirmed'].includes(b.status)) {
        if (b.customerUid) {
          c.appendChild(button('Log the visit', 'alt sm', () => {
            visitPrefill = b;
            go(2);
          }));
        } else {
          c.appendChild(button('Mark completed', 'alt sm', () => { fn.setBookingStatus(b.id, 'completed'); go(0); }));
        }
        c.appendChild(button('Cancel', 'alt sm', () => {
          if (confirm(`Cancel ${b.ref} and email ${b.name}?`)) { fn.setBookingStatus(b.id, 'cancelled'); go(0); }
        }));
      }
      wrap.appendChild(c);
    });
    v.appendChild(wrap);
  }

  // ---- Consultation requests ----
  function requestsView(v) {
    const list = store.list('consultations').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!list.length) v.appendChild(h('p', 'sub', 'No consultation requests yet.'));
    const wrap = h('div', 'list');
    list.forEach((l) => {
      const c = h('div', 'paper');
      A(c, tag(l.status), h('h3', '', l.company), h('p', 'meta', `${l.companyType} · ${l.bikes} bikes · received ${util.fmtDate(l.createdAt.slice(0, 10))}`),
        defList([
          ['Contact', l.name], ['Email', l.email], ['Phone', l.phone],
          ['Preferred', [l.preferredDate && util.fmtDate(l.preferredDate), l.preferredTime].filter(Boolean).join(' at ')], ['Message', l.message],
        ]));
      const bar = h('div', 'toolbar');
      const st = select([['new', 'New'], ['contacted', 'Contacted'], ['won', 'Won'], ['lost', 'Lost']], l.status);
      st.onchange = () => { store.update('consultations', l.id, { status: st.value }); go(1); };
      bar.appendChild(field('Status', st));
      if (l.status !== 'won') {
        const plan = select(PLANS.map((p) => [p.id, `${p.name} · ${p.pricePerBike} DKK / bike`]), 'standard');
        bar.appendChild(field('Plan', plan));
        bar.appendChild(button('Create business account', 'alt sm', () => {
          const company = fn.createCompanyFromLead(l.id, plan.value);
          alert(`${company.name} is set up and an invite was emailed to ${l.email}. Add their bikes in a fleet report.`);
          go(1);
        }));
      }
      c.appendChild(bar);
      wrap.appendChild(c);
    });
    v.appendChild(wrap);
  }

  // ---- Log a visit ----
  function visitView(v) {
    const pre = visitPrefill;
    visitPrefill = null;
    const privates = store.list('users', (u) => u.role === 'private');
    const companies = store.list('companies');

    const f = h('form', 'box');
    f.noValidate = true;
    f.style.maxWidth = '760px';
    f.appendChild(h('h2', '', 'Log a visit'));
    f.appendChild(h('p', 'det', 'Fill this in on site. The customer sees it in their account and gets an email.'));

    const who = h('select');
    const g1 = h('optgroup');
    g1.label = 'Private customers';
    privates.forEach((u) => g1.appendChild(new Option(u.name, 'u:' + u.id, false, pre && pre.customerUid === u.id)));
    const g2 = h('optgroup');
    g2.label = 'Businesses';
    companies.forEach((c) => g2.appendChild(new Option(c.name, 'c:' + c.id)));
    A(who, g1, g2);
    const bike = h('select');
    // The customer's own photos of the chosen bike, to recognise it on site.
    const bikePhotos = h('div');
    let bikeList = [];
    const showBikePhotos = () => {
      bikePhotos.textContent = '';
      const b = bikeList.find((x) => x.id === bike.value);
      if (b && b.photos && b.photos.length) {
        A(bikePhotos, h('p', 'det', "Customer's photos of this bike"), UI.gallery(b.photos, (n) => `${b.name} photo ${n}`));
      }
    };
    const fillBikes = () => {
      bike.textContent = '';
      const [kind, id] = who.value.split(':');
      bikeList = kind === 'u' ? store.list(`users/${id}/bikes`) : store.list(`companies/${id}/bikes`);
      bikeList.forEach((b) => bike.appendChild(new Option(b.name || `${b.number} · ${b.type}`, b.id)));
      if (!bikeList.length) bike.appendChild(new Option('No bikes saved yet', ''));
      showBikePhotos();
    };
    who.onchange = fillBikes;
    bike.onchange = showBikePhotos;
    fillBikes();

    const date = input('date', pre ? pre.date : util.today());
    const title = input('text', pre ? pre.services.map((s) => s.name).join(' + ') : '');
    const price = input('number', pre ? pre.pricing.oneOff - (pre.pricing.discount || 0) : '');
    const travel = input('number', pre && pre.pricing.travel != null ? pre.pricing.travel : 35);
    const work = input('textarea');
    work.placeholder = 'One line per job, e.g.\nBrakes adjusted\nChain cleaned and lubricated';
    const parts = input('textarea');
    parts.placeholder = 'One line per part: name; price\nInner tube 700×38c; 59';
    const notes = input('textarea', pre ? pre.note : '');
    const photos = input('file');
    photos.multiple = true;
    photos.accept = 'image/*';

    const r1 = h('div', 'row');
    A(r1, field('Customer', who), field('Bike', bike));
    const r2 = h('div', 'row');
    A(r2, field('Date', date), field('Title', title));
    const r3 = h('div', 'row');
    A(r3, field('Service price (DKK)', price), field('Travel (DKK)', travel));
    A(f, r1, bikePhotos, r2, r3, field('Work done', work), field('Parts used', parts), field('Mechanic\'s notes', notes), field('Photos', photos));

    const recBox = h('details', 'paper');
    recBox.style.background = '#fff';
    const recTitle = input('text');
    const recUrg = select([['soon', 'Do soon'], ['later', 'Plan ahead']], 'later');
    const recReason = input('text');
    const recDue = input('text');
    recDue.placeholder = 'e.g. Within about 1 month';
    const recBody = h('div', 'body');
    const rr = h('div', 'row');
    A(rr, field('Recommendation', recTitle), field('Urgency', recUrg));
    const rr2 = h('div', 'row');
    A(rr2, field('Why', recReason), field('When', recDue));
    A(recBody, rr, rr2);
    A(recBox, h('summary', '', 'Add a recommendation (optional)'), recBody);
    f.appendChild(recBox);

    const err = h('p', 'err');
    err.setAttribute('role', 'alert');
    const save = h('button', 'pill', 'Save visit and email the customer');
    save.type = 'submit';
    A(f, err, save);

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const [kind, id] = who.value.split(':');
      const workLines = work.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const partLines = parts.value.split('\n').map((s) => s.trim()).filter(Boolean).map((line) => {
        const [name, p] = line.split(';');
        return { name: name.trim(), price: Number(String(p || '0').replace(',', '.')) || 0 };
      });
      if (!bike.value || !title.value.trim() || !workLines.length) {
        err.textContent = 'Choose a bike and fill in a title and at least one line of work done.';
        return;
      }
      fn.logVisit({
        ownerUid: kind === 'u' ? id : null,
        companyId: kind === 'c' ? id : null,
        bikeId: bike.value,
        bookingId: pre ? pre.id : null,
        date: date.value,
        title: title.value.trim(),
        work: workLines,
        parts: partLines,
        notes: notes.value.trim(),
        photos: [...photos.files].map((x) => x.name),
        servicePrice: Number(price.value) || 0,
        travel: Number(travel.value) || 0,
        recommendation: recTitle.value.trim()
          ? { title: recTitle.value.trim(), urgency: recUrg.value, reason: recReason.value.trim(), dueBy: recDue.value.trim() || 'Next service' }
          : null,
      });
      v.textContent = '';
      A(v, h('p', 'ok', `Saved. The visit is in the customer's history and an email is in the Outbox.`), button('Log another visit', 'pill', () => go(2)));
    });
    v.appendChild(f);
  }

  // ---- Fleet reports ----
  let reportCompany = null;
  let reportMonth = util.today().slice(0, 7);

  function reportsView(v) {
    const companies = store.list('companies');
    if (!companies.length) {
      v.appendChild(h('p', 'sub', 'No business customers yet.'));
      return;
    }
    if (!reportCompany) reportCompany = companies[0].id;
    const c = store.get('companies', reportCompany);
    const plan = PLANS.find((p) => p.id === c.plan);

    const bar = h('div', 'toolbar');
    const cs = select(companies.map((x) => [x.id, x.name]), reportCompany);
    cs.onchange = () => { reportCompany = cs.value; go(3); };
    const ms = input('month', reportMonth);
    ms.onchange = () => { reportMonth = ms.value; go(3); };
    A(bar, field('Company', cs), field('Month', ms));
    v.appendChild(bar);

    if (!plan.monthlyReport) v.appendChild(h('p', 'note', `${c.name} is on the ${plan.name} plan: only the initial fleet report is included.`));

    const path = `companies/${c.id}/bikes`;
    const reports = store.list(`companies/${c.id}/reports`).sort((a, b) => b.month.localeCompare(a.month));
    const existing = reports.find((r) => r.id === reportMonth);
    const previous = reports.find((r) => r.id < reportMonth);
    const p = h('div', 'paper');
    A(p, h('h3', '', `${c.name}: ${util.monthLabel(reportMonth)}`),
      h('p', 'meta', existing ? 'Editing the saved report.' : previous ? `New report, starting from ${util.monthLabel(previous.id)}.` : 'New report.'));
    const visit = input('date', existing ? existing.visitDate : util.today());
    p.appendChild(field('Visit date', visit));

    const tw = h('div', 'tw');
    const t = h('table', 'rep');
    const hd = t.createTHead().insertRow();
    ['Bike', 'Status', 'Action', "Mechanic's note"].forEach((x) => { const th = h('th', '', x); th.scope = 'col'; hd.appendChild(th); });
    const tb = t.createTBody();
    const rows = [];
    store.list(path).forEach((b) => {
      const start = (existing && existing.entries[b.id]) || (previous && previous.entries[b.id] && { ...previous.entries[b.id], note: '' }) || { status: 'ready', action: '–', note: '' };
      const r = tb.insertRow();
      r.insertCell().textContent = `${b.number} · ${b.location}`;
      const st = select(Object.entries(STATUS), start.status);
      st.setAttribute('aria-label', `Status for ${b.number}`);
      const ac = input('text', start.action);
      ac.setAttribute('aria-label', `Action for ${b.number}`);
      const no = input('text', start.note);
      no.setAttribute('aria-label', `Note for ${b.number}`);
      r.insertCell().appendChild(st);
      r.insertCell().appendChild(ac);
      r.insertCell().appendChild(no);
      rows.push([b.id, st, ac, no]);
    });
    tw.appendChild(t);
    p.appendChild(tw);

    // Add a bike to the fleet
    const nb = h('div', 'row');
    const nNum = input('text');
    nNum.placeholder = `#${String(rows.length + 1).padStart(3, '0')}`;
    const nType = input('text');
    nType.placeholder = 'City bike';
    const nLoc = input('text');
    nLoc.placeholder = 'Reception';
    A(nb, field('New bike number', nNum), field('Type', nType));
    p.appendChild(nb);
    p.appendChild(field('Location', nLoc));
    p.appendChild(button('Add bike to fleet', 'alt sm', () => {
      if (!nNum.value.trim()) return;
      store.add(path, { number: nNum.value.trim(), type: nType.value.trim() || 'Bike', location: nLoc.value.trim() || 'Other', year: '', size: '', gears: '', brakes: '' });
      go(3);
    }));

    const done = h('p', 'ok');
    done.hidden = true;
    p.appendChild(button('Save report and email the customer', 'pill', () => {
      const entries = {};
      rows.forEach(([id, st, ac, no]) => { entries[id] = { status: st.value, action: ac.value.trim() || '–', note: no.value.trim() }; });
      fn.saveReport(c.id, reportMonth, visit.value, entries);
      done.hidden = false;
      done.textContent = `Saved. ${c.name} can see the ${util.monthLabel(reportMonth)} report in their account.`;
    }));
    p.appendChild(done);
    v.appendChild(p);
  }

  // ---- Customers ----
  function customersView(v) {
    v.appendChild(h('h3', '', 'Private customers'));
    const g = h('div', 'grid');
    store.list('users', (u) => u.role === 'private').forEach((u) => {
      const c = h('div', 'paper');
      A(c, h('h3', '', u.name), defList([
        ['Email', u.email], ['Phone', u.phone], ['Bikes', store.list(`users/${u.id}/bikes`).length],
        ['Visits', store.list('serviceRecords', (r) => r.ownerUid === u.id).length],
        ['Bookings', store.list('bookings', (b) => b.customerUid === u.id).length],
      ]));
      g.appendChild(c);
    });
    v.appendChild(g);

    v.appendChild(h('h3', '', 'Businesses'));
    const g2 = h('div', 'grid');
    store.list('companies').forEach((co) => {
      const n = store.list(`companies/${co.id}/bikes`).length;
      const plan = PLANS.find((p) => p.id === co.plan);
      const c = h('div', 'paper');
      A(c, h('h3', '', co.name), defList([
        ['Plan', plan.name], ['Bikes', n], ['Monthly', dkk(n * co.pricePerBike)], ['Contact', co.contact], ['Email', co.email],
        ['Next visit', co.nextVisit ? util.fmtDate(co.nextVisit) : 'To be agreed'],
      ]));
      g2.appendChild(c);
    });
    v.appendChild(g2);
  }

  // ---- Outbox ----
  function outboxView(v) {
    v.appendChild(h('p', 'sub', 'Every email the real system would send. In production these go out through SMTP from a Cloud Function.'));
    store.list('mail').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach((m) => {
      const c = h('div', 'paper');
      c.style.marginBottom = '12px';
      A(c, h('h3', '', m.subject), h('p', 'meta', `To ${m.to} · ${new Date(m.createdAt).toLocaleString('en-GB')}`), h('div', 'mail', m.body));
      v.appendChild(c);
    });
  }

  start();
})();
