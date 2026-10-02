'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const adminApi = (path, opts = {}) => api(`/api/admin${path}`, { ...opts, admin: true });

  const TABS = [
    { id: 'upcoming', label: 'Upcoming', stat: 'upcoming' },
    { id: 'pending', label: 'Needs confirming', stat: 'pending' },
    { id: 'past', label: 'Past' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'all', label: 'All' },
    { id: 'settings', label: 'Days off' },
  ];

  const state = { me: null, view: 'upcoming', q: '', stats: {}, openId: null };

  // ---------- Auth ----------

  async function init() {
    try {
      state.me = await adminApi('/me');
    } catch (err) {
      if (err.status === 401) return showLogin();
      throw err;
    }
    $('login').hidden = true;
    $('app').hidden = false;
    $('mail-warning').hidden = state.me.mailEnabled;
    renderTabs();
    await refresh();
    openFromHash();
  }

  function showLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
    $('login-form').password.focus();
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error');
    err.hidden = true;
    try {
      await adminApi('/login', { method: 'POST', body: { password: e.target.password.value } });
      e.target.reset();
      init();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    await adminApi('/logout', { method: 'POST' }).catch(() => {});
    closeDrawer();
    showLogin();
  });

  function handleError(err) {
    if (err.status === 401) return showLogin();
    toast(err.message, { error: true });
  }

  // ---------- List ----------

  function renderTabs() {
    $('tabs').replaceChildren(
      ...TABS.map((t) =>
        h('button', {
          class: 'tab',
          role: 'tab',
          type: 'button',
          'aria-selected': String(state.view === t.id),
          onclick: () => {
            state.view = t.id;
            renderTabs();
            refresh();
          },
        }, t.label, t.stat && state.stats[t.stat] ? h('span', { class: 'count' }, state.stats[t.stat]) : null),
      ),
    );
    $('view-bookings').hidden = state.view === 'settings';
    $('view-settings').hidden = state.view !== 'settings';
  }

  function renderStats(s) {
    const stat = (n, label) => h('div', { class: 'card stat' }, h('strong', {}, n), h('span', {}, label));
    $('stats').replaceChildren(
      stat(s.today, 'Today'),
      stat(s.upcoming, 'Upcoming'),
      stat(s.pending, 'Need confirming'),
      stat(s.unread, 'Unread messages'),
    );
  }

  async function refresh() {
    try {
      if (state.view === 'settings') {
        renderClosed(await adminApi('/closed-dates'));
        return;
      }
      const params = new URLSearchParams({ view: state.view, q: state.q });
      const data = await adminApi(`/bookings?${params}`);
      state.stats = data.stats;
      renderStats(data.stats);
      renderTabs();
      renderList(data.bookings);
    } catch (err) {
      handleError(err);
    }
  }

  function renderList(bookings) {
    if (!bookings.length) {
      $('list').replaceChildren(h('div', { class: 'card empty-state' }, state.q ? 'No bookings match your search.' : 'No bookings here yet.'));
      return;
    }
    $('list').replaceChildren(
      ...bookings.map((b) =>
        h('button', { class: 'card booking-row', type: 'button', onclick: () => openBooking(b.id) },
          h('div', { class: 'when' }, h('strong', {}, b.date_label), h('span', { class: 'meta' }, b.slot_label)),
          h('div', { class: 'who' },
            h('strong', {}, b.name),
            h('span', {}, `${b.service_name} · ${[b.address, b.postcode].filter(Boolean).join(', ')}`),
          ),
          h('div', { class: 'side' },
            statusBadge(b.status),
            b.unread ? h('span', { class: 'unread' }, `${b.unread} new`) : null,
          ),
        ),
      ),
    );
  }

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = e.target.value;
      refresh();
    }, 250);
  });

  $('export').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/export.csv', { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
      if (!res.ok) throw Object.assign(new Error('Export failed'), { status: res.status });
      const url = URL.createObjectURL(await res.blob());
      const a = h('a', { href: url, download: `bookings-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      handleError(err);
    }
  });

  // ---------- Days off ----------

  function renderClosed(list) {
    $('closed-list').replaceChildren(
      ...(list.length
        ? list.map((c) =>
            h('li', {},
              h('span', {}, h('strong', {}, new Date(`${c.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })), c.reason ? ` · ${c.reason}` : ''),
              h('button', {
                class: 'btn btn-sm btn-ghost',
                type: 'button',
                onclick: async () => {
                  try {
                    renderClosed(await adminApi(`/closed-dates/${c.date}`, { method: 'DELETE' }));
                  } catch (err) {
                    handleError(err);
                  }
                },
              }, 'Remove'),
            ),
          )
        : [h('li', { class: 'hint' }, 'No days off scheduled.')]),
    );
  }

  $('closed-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      renderClosed(await adminApi('/closed-dates', { method: 'POST', body: { date: e.target.date.value, reason: e.target.reason.value } }));
      e.target.reset();
      toast('Day off added.');
    } catch (err) {
      handleError(err);
    }
  });

  // ---------- Booking drawer ----------

  function openFromHash() {
    const m = location.hash.match(/^#booking-(\d+)$/);
    if (m) openBooking(Number(m[1]));
  }
  window.addEventListener('hashchange', openFromHash);

  async function openBooking(id) {
    try {
      const data = await adminApi(`/bookings/${id}`);
      state.openId = id;
      if (location.hash !== `#booking-${id}`) history.replaceState(null, '', `#booking-${id}`);
      renderDrawer(data);
      $('drawer').hidden = false;
      $('drawer-backdrop').hidden = false;
      document.body.style.overflow = 'hidden';
    } catch (err) {
      handleError(err);
    }
  }

  function closeDrawer() {
    $('drawer').hidden = true;
    $('drawer-backdrop').hidden = true;
    document.body.style.overflow = '';
    state.openId = null;
    history.replaceState(null, '', location.pathname);
  }

  $('drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer();
  });

  function afterUpdate(data, okMessage) {
    renderDrawer(data);
    refresh();
    if (data.email && !data.email.ok) toast(`Saved, but the email failed: ${data.email.error}`, { error: true, ms: 6000 });
    else toast(data.email ? `${okMessage} Customer emailed.` : okMessage);
  }

  function renderDrawer({ booking: b, messages, templates }) {
    const notifyBox = h('input', { type: 'checkbox', checked: true });
    const setStatus = async (status, reason) => {
      try {
        const data = await adminApi(`/bookings/${b.id}/status`, { method: 'POST', body: { status, reason, notify: notifyBox.checked } });
        afterUpdate(data, `Marked as ${status}.`);
      } catch (err) {
        handleError(err);
      }
    };

    // Status actions
    const cancelReason = h('input', { placeholder: 'Reason (included in the email)', maxlength: 500 });
    const cancelForm = h('div', { class: 'stack', hidden: true },
      cancelReason,
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => setStatus('cancelled', cancelReason.value) }, 'Confirm cancellation'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { cancelForm.hidden = true; } }, 'Keep booking'),
      ),
    );
    const actions = [];
    if (b.status === 'pending') actions.push(h('button', { class: 'btn btn-success', type: 'button', onclick: () => setStatus('confirmed') }, 'Confirm booking'));
    if (b.status === 'confirmed' || b.status === 'pending') actions.push(h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => setStatus('completed') }, 'Mark completed'));
    if (b.status !== 'cancelled') actions.push(h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { cancelForm.hidden = false; cancelReason.focus(); } }, 'Cancel…'));
    if (b.status === 'cancelled' || b.status === 'completed') actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setStatus('confirmed') }, 'Reopen as confirmed'));

    // Reschedule
    const dateInput = h('input', { type: 'date', value: b.date, style: 'max-width:180px' });
    const slotSelect = h('select', { style: 'max-width:160px' }, state.me.slots.map((s) => h('option', { value: s.start, selected: s.start === b.slot }, s.label)));
    const resNotify = h('input', { type: 'checkbox', checked: true });
    const doReschedule = async (force = false) => {
      try {
        const data = await adminApi(`/bookings/${b.id}/reschedule`, { method: 'POST', body: { date: dateInput.value, slot: slotSelect.value, notify: resNotify.checked, force } });
        afterUpdate(data, 'Booking moved.');
      } catch (err) {
        if (err.status === 409 && confirm(`${err.message}\n\nMove it there anyway?`)) return doReschedule(true);
        handleError(err);
      }
    };

    // Notes
    const notes = h('textarea', { rows: 3, placeholder: 'Only visible to you', maxlength: 5000 });
    notes.value = b.admin_notes || '';

    // Compose
    const subject = h('input', { placeholder: 'Subject', maxlength: 150, value: `About your booking on ${b.date_label}` });
    const body = h('textarea', { rows: 6, placeholder: `Hi ${b.name.split(/\s+/)[0]},…`, maxlength: 5000 });
    const sendBtn = h('button', { class: 'btn', type: 'submit' }, 'Send email');
    const composeForm = h('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        if (body.value.trim().length < 2) return body.focus();
        sendBtn.disabled = true;
        try {
          const data = await adminApi(`/bookings/${b.id}/messages`, { method: 'POST', body: { subject: subject.value, body: body.value } });
          renderDrawer(data);
          toast('Email sent.');
        } catch (err) {
          if (err.data?.messages) renderDrawer(err.data);
          handleError(err);
          sendBtn.disabled = false;
        }
      },
    },
      templates.length
        ? h('div', { class: 'template-chips' },
            h('span', { class: 'meta', style: 'align-self:center' }, 'Templates:'),
            templates.map((t) => h('button', { class: 'chip', type: 'button', onclick: () => { subject.value = t.subject; body.value = t.body; body.focus(); } }, t.label)),
          )
        : null,
      subject,
      body,
      h('div', { class: 'row' }, sendBtn, h('span', { class: 'hint' }, `To ${b.email}. Replies go to your inbox.`)),
    );

    const kv = (pairs) => h('dl', { class: 'kv' }, pairs.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([b.address, b.postcode, b.city].filter(Boolean).join(', '))}`;

    $('drawer').replaceChildren(
      h('div', { class: 'drawer-head' },
        h('div', { style: 'flex:1;min-width:0' },
          h('h2', { id: 'drawer-title' }, b.name),
          h('span', { class: 'meta' }, h('span', { class: 'ref' }, b.ref), ` · booked ${formatDateTime(b.created_at)}`),
        ),
        statusBadge(b.status),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: closeDrawer }, '×'),
      ),
      h('div', { class: 'drawer-body' },
        h('div', { class: 'when-banner' },
          h('div', {},
            h('strong', {}, `${b.date_long}, ${b.slot_label}`),
            h('div', { class: 'meta' }, `${b.service_name}${b.price_label ? ` · from ${b.price_label}` : ''}`),
            b.cancel_reason ? h('div', { class: 'meta' }, `Cancelled: ${b.cancel_reason}`) : null,
          ),
        ),

        h('section', { class: 'card panel stack' },
          h('div', { class: 'row' }, actions),
          cancelForm,
          h('label', { class: 'check' }, notifyBox, h('span', {}, 'Email the customer about status changes')),
        ),

        h('section', { class: 'card panel' },
          h('h2', {}, 'Customer'),
          kv([
            ['Email', h('a', { href: `mailto:${b.email}` }, b.email)],
            ['Phone', h('a', { href: `tel:${b.phone.replace(/\s/g, '')}` }, b.phone)],
            ['Address', h('a', { href: mapsUrl, target: '_blank', rel: 'noopener' }, [b.address, [b.postcode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))],
            ['Access notes', b.access_notes],
            ['Bike', [b.bike_type, b.bike_brand, b.bike_model].filter(Boolean).join(' · ')],
            ['Problem', b.problem],
          ]),
        ),

        h('section', { class: 'card panel' },
          h('h2', {}, 'Messages'),
          messages.length
            ? h('div', { class: 'thread' }, messages.map(renderMessage))
            : h('p', { class: 'hint' }, 'No messages yet.'),
          composeForm,
        ),

        h('section', { class: 'card panel stack' },
          h('h2', { style: 'margin:0' }, 'Move booking'),
          h('div', { class: 'row' }, dateInput, slotSelect, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => doReschedule() }, 'Move')),
          h('label', { class: 'check' }, resNotify, h('span', {}, 'Email the customer the new time')),
        ),

        h('section', { class: 'card panel stack' },
          h('h2', { style: 'margin:0' }, 'Private notes'),
          notes,
          h('div', { class: 'row' },
            h('button', {
              class: 'btn btn-quiet',
              type: 'button',
              onclick: async () => {
                try {
                  renderDrawer(await adminApi(`/bookings/${b.id}/notes`, { method: 'POST', body: { notes: notes.value } }));
                  toast('Notes saved.');
                } catch (err) {
                  handleError(err);
                }
              },
            }, 'Save notes'),
          ),
        ),
      ),
    );
  }

  function renderMessage(m) {
    const emailStatus = m.direction === 'out' && m.email_status
      ? h('span', { class: `email-status ${m.email_status}`, title: m.email_error || '' }, m.email_status === 'sent' ? ' · ✓ emailed' : m.email_status === 'failed' ? ' · ✗ email failed' : ' · sending…')
      : null;
    if (m.kind === 'auto') {
      return h('div', { class: 'msg auto' }, `${formatDateTime(m.created_at)} · Auto email: ${m.subject}`, emailStatus);
    }
    return h('div', { class: `msg${m.direction === 'out' ? ' mine' : ''}` },
      h('span', { class: 'msg-meta' }, `${m.direction === 'out' ? 'You' : 'Customer'} · ${formatDateTime(m.created_at)}`, emailStatus),
      m.subject ? h('span', { class: 'msg-subject' }, m.subject) : null,
      m.body,
    );
  }

  // Keep the list fresh while the tab is open.
  setInterval(() => {
    if (!$('app').hidden && !state.openId && document.visibilityState === 'visible') refresh();
  }, 60000);

  init().catch(handleError);
})();
