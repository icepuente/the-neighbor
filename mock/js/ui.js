// Small DOM helpers shared by the mock pages. Text always goes in through textContent, so
// customer-entered values can never inject markup.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function A(parent, ...children) {
    children.forEach((c) => c && parent.appendChild(c));
    return parent;
  }

  function button(label, cls, onClick) {
    const b = h('button', cls, label);
    b.type = 'button';
    b.onclick = onClick;
    return b;
  }

  function defList(pairs) {
    const l = h('dl');
    pairs.forEach(([k, v]) => A(l, h('dt', '', k), h('dd', '', v == null || v === '' ? '–' : String(v))));
    return l;
  }

  function tag(status, label) {
    return h('span', 'tag ' + status, label || status[0].toUpperCase() + status.slice(1));
  }

  // Demo banner "Reset demo data" link, and the header account link.
  document.addEventListener('DOMContentLoaded', () => {
    const reset = $('reset-demo');
    if (reset) {
      reset.onclick = (e) => {
        e.preventDefault();
        NB.reset();
        location.reload();
      };
    }
    const acct = $('acct-link');
    const user = NB.auth.current();
    if (acct && user) acct.textContent = user.role === 'admin' ? 'Dashboard' : 'My account';
    if (acct && user && user.role === 'admin') acct.href = 'admin.html';
  });

  window.UI = { $, h, A, button, defList, tag };
})();
