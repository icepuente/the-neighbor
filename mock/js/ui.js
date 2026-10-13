// Small DOM helpers shared by the mock pages. Text always goes in through textContent, so
// customer-entered values can never inject markup.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  // Translate when the page loads i18n.js (public pages); the English dashboard does not.
  const t = (key, vars) => (window.I18N ? I18N.t(key, vars) : key);

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

  // Demo banner "Reset demo data" link, the header account link and the language switch.
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
    if (acct && user) {
      acct.textContent = t(user.role === 'admin' ? 'nav.dashboard' : 'nav.account');
      if (user.role === 'admin') acct.href = 'admin.html';
    }
    ['da', 'en'].forEach((l) => {
      const b = $('lang-' + l);
      if (!b || !window.I18N) return;
      b.setAttribute('aria-pressed', String(I18N.lang === l));
      b.onclick = () => I18N.set(l);
    });
  });

  window.UI = { $, h, A, button, defList, tag, t };
})();
