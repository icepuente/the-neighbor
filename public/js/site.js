'use strict';

(async function () {
  const form = document.getElementById('booking-form');
  const loadedAt = Date.now();
  const state = { config: null, availability: null, serviceId: null, date: null, slot: null };

  let config;
  try {
    config = state.config = await api('/api/config');
  } catch (err) {
    document.getElementById('calendar').replaceChildren(h('p', { class: 'alert alert-error' }, err.message));
    return;
  }

  // ---------- Static content from config ----------

  document.getElementById('highlights').replaceChildren(...config.highlights.map((t) => h('li', {}, t)));

  document.getElementById('services-grid').replaceChildren(
    ...config.services.map((s) =>
      h('article', { class: 'service-card' },
        h('h3', {}, s.name),
        h('div', { class: 'price' }, h('small', {}, 'from'), s.priceLabel),
        h('span', { class: 'meta' }, s.duration),
        h('p', {}, s.description),
      ),
    ),
  );

  document.getElementById('faq-list').replaceChildren(
    ...config.faq.map((f) => h('details', {}, h('summary', {}, f.q), h('p', {}, f.a))),
  );

  const contact = [];
  if (config.contactPhone) contact.push(h('a', { href: `tel:${config.contactPhone.replace(/\s/g, '')}` }, config.contactPhone));
  if (config.contactEmail) contact.push(h('a', { href: `mailto:${config.contactEmail}` }, config.contactEmail));
  document.getElementById('footer-contact').replaceChildren(...contact.flatMap((c, i) => (i ? [' · ', c] : [c])));

  // ---------- Step 1: services ----------

  document.getElementById('service-choices').replaceChildren(
    ...config.services.map((s) =>
      h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'serviceId', value: s.id, onchange: () => { state.serviceId = s.id; clearError('serviceId'); renderSummary(); } }),
        h('span', { class: 'choice-title' }, h('span', {}, s.name), h('span', { class: 'choice-price' }, s.priceLabel)),
        h('span', { class: 'meta' }, s.duration),
      ),
    ),
  );

  // Preselect a service from a link like /?service=puncture#book
  const preselect = new URLSearchParams(location.search).get('service');
  const preInput = preselect && form.querySelector(`input[name="serviceId"][value="${CSS.escape(preselect)}"]`);
  if (preInput) {
    preInput.checked = true;
    state.serviceId = preselect;
  }

  // ---------- Step 2: bike types ----------

  form.bikeType.append(...config.bikeTypes.map((t) => h('option', { value: t }, t)));
  form.postcode.pattern = config.postcodePattern || '';
  form.postcode.title = config.postcodeHint || '';

  // ---------- Step 3: calendar + slots ----------

  const fmtMonth = new Intl.DateTimeFormat(config.locale, { month: 'short', timeZone: 'UTC' });
  const fmtLong = new Intl.DateTimeFormat(config.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtDow = new Intl.DateTimeFormat(config.locale, { weekday: 'short', timeZone: 'UTC' });
  const utc = (d) => new Date(`${d}T12:00:00Z`);

  async function loadAvailability() {
    try {
      state.availability = await api('/api/availability');
      renderCalendar();
    } catch (err) {
      document.getElementById('calendar').replaceChildren(h('p', { class: 'alert alert-error' }, err.message));
    }
  }

  function renderCalendar() {
    const { days } = state.availability;
    const cal = document.getElementById('calendar');
    const nodes = [];
    // Weekday headers, Monday first (2024-01-01 was a Monday).
    for (let i = 0; i < 7; i++) nodes.push(h('div', { class: 'calendar-dow' }, fmtDow.format(new Date(Date.UTC(2024, 0, 1 + i, 12)))));
    const leading = (utc(days[0].date).getUTCDay() + 6) % 7;
    for (let i = 0; i < leading; i++) nodes.push(h('div', { class: 'day blank' }));

    days.forEach((day, i) => {
      const d = utc(day.date);
      const showMonth = i === 0 || d.getUTCDate() === 1;
      nodes.push(
        h('button', {
          type: 'button',
          class: 'day',
          disabled: !day.available,
          'aria-pressed': String(state.date === day.date),
          'aria-label': `${fmtLong.format(d)}${day.available ? '' : day.open ? ', fully booked' : ', closed'}`,
          onclick: () => selectDate(day.date),
        },
          h('span', { class: 'd' }, d.getUTCDate()),
          h('span', { class: 'm' }, showMonth ? fmtMonth.format(d) : day.available ? '' : day.open ? 'full' : ''),
        ),
      );
    });
    cal.replaceChildren(...nodes);

    if (state.date && !days.find((d) => d.date === state.date)?.available) {
      state.date = null;
      state.slot = null;
    }
    renderSlots();
    renderSummary();
  }

  function selectDate(date) {
    state.date = date;
    const day = state.availability.days.find((d) => d.date === date);
    if (state.slot && !day.slots.find((s) => s.start === state.slot)?.available) state.slot = null;
    clearError('date');
    renderCalendar();
    document.getElementById('slots').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderSlots() {
    const wrap = document.getElementById('slots');
    const day = state.date && state.availability.days.find((d) => d.date === state.date);
    if (!day) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    document.getElementById('slots-label').textContent = `Available times on ${fmtLong.format(utc(day.date))}`;
    document.getElementById('slot-grid').replaceChildren(
      ...day.slots.map((s) =>
        h('button', {
          type: 'button',
          class: 'slot',
          disabled: !s.available,
          'aria-pressed': String(state.slot === s.start),
          'aria-label': `${s.label}${s.available ? '' : ', booked'}`,
          onclick: () => {
            state.slot = s.start;
            clearError('slot');
            renderSlots();
            renderSummary();
          },
        }, s.label),
      ),
    );
  }

  // ---------- Summary ----------

  function renderSummary() {
    const service = config.services.find((s) => s.id === state.serviceId);
    const day = state.date && state.availability?.days.find((d) => d.date === state.date);
    const slot = day && state.slot && day.slots.find((s) => s.start === state.slot);
    const item = (label, value) => [h('dt', {}, label), h('dd', { class: value ? '' : 'empty' }, value || 'Not chosen yet')];
    document.getElementById('summary').replaceChildren(
      ...item('Service', service?.name),
      ...item('Day', day && fmtLong.format(utc(day.date))),
      ...item('Time', slot?.label),
      h('div', { class: 'total' }, h('span', { class: 'meta' }, 'From'), h('strong', {}, service ? service.priceLabel : '–')),
      h('p', { class: 'hint', style: 'margin:0' }, 'Pay after the job. Parts are extra at cost.'),
    );
  }

  // ---------- Errors ----------

  function fieldWrap(name) {
    return form.querySelector(`[data-field="${name}"]`);
  }

  function clearError(name) {
    const wrap = fieldWrap(name);
    if (!wrap) return;
    wrap.classList.remove('invalid');
    wrap.querySelector(':scope > .field-error')?.remove();
  }

  function showErrors(fields) {
    form.querySelectorAll('.field-error').forEach((e) => e.remove());
    form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
    let first = null;
    for (const [name, message] of Object.entries(fields)) {
      const wrap = fieldWrap(name);
      if (!wrap) continue;
      wrap.classList.add('invalid');
      wrap.append(h('span', { class: 'field-error' }, message));
      first ??= wrap;
    }
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('input', (e) => {
    const wrap = e.target.closest('[data-field]');
    if (wrap) clearError(wrap.dataset.field);
  });

  // ---------- Submit ----------

  function clientValidate(v) {
    const f = {};
    if (!v.serviceId) f.serviceId = 'Please choose a service.';
    if (!v.bikeType) f.bikeType = 'Please choose your type of bike.';
    if (!v.date) f.date = 'Please pick a day.';
    else if (!v.slot) f.slot = 'Please pick a time slot.';
    if (v.name.length < 2) f.name = 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) f.email = 'Please enter a valid email address.';
    if (!/^\+?[\d\s()-]{6,20}$/.test(v.phone)) f.phone = 'Please enter a valid phone number.';
    if (v.address.length < 3) f.address = 'Please enter the street address.';
    if (config.postcodePattern && !new RegExp(config.postcodePattern).test(v.postcode)) f.postcode = `Please enter a valid ${config.postcodeHint || 'postcode'}.`;
    if (!v.consent) f.consent = 'Please agree so we can store your details for this booking.';
    return f;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('form-error');
    errorBox.hidden = true;

    const fd = new FormData(form);
    const values = {
      serviceId: state.serviceId,
      bikeType: fd.get('bikeType'),
      bikeBrand: fd.get('bikeBrand').trim(),
      bikeModel: fd.get('bikeModel').trim(),
      problem: fd.get('problem').trim(),
      date: state.date,
      slot: state.slot,
      name: fd.get('name').trim(),
      email: fd.get('email').trim(),
      phone: fd.get('phone').trim(),
      address: fd.get('address').trim(),
      postcode: fd.get('postcode').trim(),
      city: fd.get('city').trim(),
      accessNotes: fd.get('accessNotes').trim(),
      consent: form.consent.checked,
      website: fd.get('website'),
      elapsedMs: Date.now() - loadedAt,
    };

    const fields = clientValidate(values);
    if (Object.keys(fields).length) {
      showErrors(fields);
      return;
    }

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const result = await api('/api/bookings', { method: 'POST', body: values });
      showSuccess(result, values);
    } catch (err) {
      if (err.data?.fields) showErrors(err.data.fields);
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      if (err.data?.code === 'slot_full' || err.data?.code === 'closed') {
        state.slot = null;
        await loadAvailability();
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Request booking';
    }
  });

  function showSuccess(result, values) {
    document.getElementById('booking-layout').hidden = true;
    const box = document.getElementById('booking-success');
    const first = values.name.split(/\s+/)[0];
    const day = state.availability.days.find((d) => d.date === values.date);
    const slot = day.slots.find((s) => s.start === values.slot);
    document.getElementById('success-title').textContent = result.status === 'confirmed' ? `You're booked in, ${first}!` : `Thanks, ${first}! Request received.`;
    document.getElementById('success-text').replaceChildren(
      'Booking ', h('span', { class: 'ref' }, result.ref), ` for ${fmtLong.format(utc(values.date))}, ${slot.label}. `,
      result.status === 'confirmed'
        ? `We've emailed the confirmation to ${values.email}.`
        : `We'll confirm it by email at ${values.email} shortly.`,
    );
    document.getElementById('success-link').href = result.url;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.focus({ preventScroll: true });
  }

  renderSummary();
  loadAvailability();
})();
