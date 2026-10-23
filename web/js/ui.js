// Small DOM helpers shared by the pages, and the language switch. Text always goes in through
// textContent, so values the visitor typed can never inject markup.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const t = (key, vars) => I18N.t(key, vars);

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Appends elements and plain text (text is added as text, never as markup).
  function A(parent, ...children) {
    children.forEach((c) => c && parent.append(c));
    return parent;
  }

  // The DA/EN switch in the header.
  document.addEventListener('DOMContentLoaded', () => {
    ['da', 'en'].forEach((l) => {
      const b = $('lang-' + l);
      if (!b) return;
      b.setAttribute('aria-pressed', String(I18N.lang === l));
      b.onclick = () => I18N.set(l);
    });
  });

  window.UI = { $, h, A, t };
})();
