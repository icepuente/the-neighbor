'use strict';

(function () {
  const token = location.pathname.split('/').pop();
  const root = document.getElementById('root');
  const STATUS_TEXT = {
    pending: "We've received your request and will confirm it by email shortly.",
    confirmed: "You're booked in. See you then!",
    completed: 'This job is done. Thanks for riding with us!',
    cancelled: 'This booking has been cancelled.',
  };

  async function load() {
    try {
      render(await api(`/api/bookings/${encodeURIComponent(token)}`));
    } catch (err) {
      root.replaceChildren(
        h('div', { class: 'card panel' },
          h('h1', {}, 'Booking not found'),
          h('p', {}, err.message),
          h('a', { class: 'btn', href: '/#book' }, 'Make a new booking'),
        ),
      );
    }
  }

  function render(b) {
    document.title = `${b.ref} · ${document.title.split(' · ').pop()}`;
    const d = new Date(`${b.date}T12:00:00Z`);
    const kv = (pairs) =>
      h('dl', { class: 'kv' }, pairs.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', {},
          h('p', { class: 'meta', style: 'margin:0 0 4px' }, 'Booking ', h('span', { class: 'ref' }, b.ref)),
          h('h1', {}, b.serviceName),
        ),
        statusBadge(b.status),
      ),

      h('div', { class: 'when-banner' },
        h('div', { class: 'cal', 'aria-hidden': 'true' },
          h('span', {}, new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(d)),
          h('strong', {}, d.getUTCDate()),
        ),
        h('div', {},
          h('strong', {}, `${b.dateLabel}, ${b.slotLabel}`),
          h('div', { class: 'meta' }, STATUS_TEXT[b.status] || ''),
          b.cancelReason ? h('div', { class: 'meta' }, `Reason: ${b.cancelReason}`) : null,
        ),
      ),

      h('section', { class: 'card panel' },
        h('h2', {}, 'Details'),
        kv([
          ['Service', b.servicePrice ? `${b.serviceName} (from ${b.servicePrice})` : b.serviceName],
          ['Address', [b.address, [b.postcode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
          ['Access notes', b.accessNotes],
          ['Bike', [b.bikeType, b.bikeBrand, b.bikeModel].filter(Boolean).join(' · ')],
          ['Problem', b.problem],
          ['Name', b.name],
          ['Email', b.email],
          ['Phone', b.phone],
        ]),
      ),

      renderMessages(b),

      b.canCancel ? renderCancel(b) : null,
    );
  }

  function renderMessages(b) {
    const thread = b.messages.length
      ? h('div', { class: 'thread' },
          b.messages.map((m) =>
            h('div', { class: `msg${m.direction === 'in' ? ' mine' : ''}` },
              h('span', { class: 'msg-meta' }, `${m.direction === 'in' ? 'You' : 'Us'} · ${formatDateTime(m.createdAt)}`),
              m.subject ? h('span', { class: 'msg-subject' }, m.subject) : null,
              m.body,
            ),
          ),
        )
      : h('p', { class: 'hint' }, 'Questions or extra details? Send us a message and we\'ll reply by email.');

    const textarea = h('textarea', { name: 'body', rows: 3, maxlength: 2000, placeholder: 'Write a message…', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Send message');
    const form = h('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        if (textarea.value.trim().length < 2) return textarea.focus();
        btn.disabled = true;
        try {
          render(await api(`/api/bookings/${encodeURIComponent(token)}/messages`, { method: 'POST', body: { body: textarea.value } }));
          toast("Message sent. We'll reply by email.");
        } catch (err) {
          toast(err.message, { error: true });
          btn.disabled = false;
        }
      },
    }, h('label', { class: 'sr-only', for: 'msg-body' }, 'Message'), textarea, h('div', { class: 'row' }, btn));
    textarea.id = 'msg-body';

    return h('section', { class: 'card panel' }, h('h2', {}, 'Messages'), thread, form);
  }

  function renderCancel(b) {
    const reason = h('input', { name: 'reason', maxlength: 500, placeholder: 'Reason (optional)' });
    const confirmBtn = h('button', { class: 'btn btn-danger', type: 'submit' }, 'Yes, cancel booking');
    const form = h('form', {
      class: 'stack',
      hidden: true,
      onsubmit: async (e) => {
        e.preventDefault();
        confirmBtn.disabled = true;
        try {
          render(await api(`/api/bookings/${encodeURIComponent(token)}/cancel`, { method: 'POST', body: { reason: reason.value } }));
          toast('Your booking has been cancelled.');
        } catch (err) {
          toast(err.message, { error: true });
          confirmBtn.disabled = false;
        }
      },
    }, h('p', { style: 'margin:0' }, `Cancel your booking on ${b.dateLabel}, ${b.slotLabel}?`), reason, h('div', { class: 'row' }, confirmBtn));

    const openBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { form.hidden = false; openBtn.hidden = true; reason.focus(); } }, 'Cancel this booking');
    return h('section', { class: 'card panel' },
      h('h2', {}, 'Need to cancel?'),
      h('p', { class: 'hint' }, 'Plans change. If you\'d rather move the booking, send us a message instead.'),
      openBtn,
      form,
    );
  }

  load();
})();
