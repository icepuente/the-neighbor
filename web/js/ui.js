// Small DOM helpers shared by the mock pages. Text always goes in through textContent, so
// customer-entered values can never inject markup.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  // Translate when the page loads i18n.js (public pages); the English dashboard does not.
  const t = (key, vars) => (window.I18N ? I18N.t(key, vars) : key);
  // For text the English dashboard also shows: translated on public pages, the fallback there.
  const tx = (key, fallback, vars) => (window.I18N ? I18N.t(key, vars) : fallback);

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

  // ---- Photos ----
  // Shrink an image in the browser before it is stored or uploaded. Re-drawing it on a canvas also
  // drops its EXIF data, including any GPS location the phone recorded.
  async function resizeImage(file, max = 800, quality = 0.7) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const hgt = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hgt;
      canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
      return { data: canvas.toDataURL('image/jpeg', quality), w, h: hgt };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Full-size view of one photo; click, Escape or the button closes it.
  function openPhoto(src, alt) {
    const box = h('div', 'dialog lightbox');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const img = h('img');
    img.src = src;
    img.alt = alt;
    const close = button(tx('pics.close', 'Close'), 'pill', () => done());
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    function done() {
      box.remove();
      document.removeEventListener('keydown', onKey);
    }
    box.onclick = (e) => { if (e.target === box || e.target === img) done(); };
    document.addEventListener('keydown', onKey);
    A(box, img, close);
    document.body.appendChild(box);
    close.focus();
  }

  // Thumbnails that open full size. `label` names one photo, e.g. "Photo 1".
  function gallery(photos, label = (n) => tx('pics.alt', `Photo ${n}`, { n })) {
    const row = h('div', 'pics-grid');
    (photos || []).forEach((p, i) => {
      const b = h('button', 'pic');
      b.type = 'button';
      const img = h('img');
      img.src = p.data;
      img.alt = label(i + 1);
      img.loading = 'lazy';
      b.onclick = () => openPhoto(p.data, img.alt);
      b.appendChild(img);
      row.appendChild(b);
    });
    return row;
  }

  // A photo field: an "add" tile, thumbnails with a remove button, and a counter. `get()` returns
  // the photos as { id, data, w, h, at }.
  function photoPicker({ max, initial = [], id }) {
    let photos = [...initial];
    const wrap = h('div', 'pics');
    const grid = h('div', 'pics-grid');
    const add = h('label', 'pic pic-add');
    const input = h('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    if (id) input.id = id;
    const addText = h('span', '', tx('pics.add', 'Add photo'));
    A(add, input, h('span', 'plus', '+'), addText);
    const count = h('p', 'det');
    const err = h('p', 'err');
    err.setAttribute('role', 'alert');

    function render() {
      grid.textContent = '';
      photos.forEach((p, i) => {
        const fig = h('figure', 'pic');
        const img = h('img');
        img.src = p.data;
        img.alt = tx('pics.alt', `Photo ${i + 1}`, { n: i + 1 });
        const x = button('×', 'pic-x', () => { photos.splice(i, 1); err.textContent = ''; render(); });
        x.setAttribute('aria-label', tx('pics.remove', `Remove photo ${i + 1}`, { n: i + 1 }));
        A(fig, img, x);
        grid.appendChild(fig);
      });
      add.hidden = photos.length >= max;
      grid.appendChild(add);
      count.textContent = tx('pics.count', `${photos.length} of ${max} photos`, { n: photos.length, max });
    }

    input.onchange = async () => {
      err.textContent = '';
      const files = [...input.files];
      input.value = '';
      for (const f of files) {
        if (photos.length >= max) { err.textContent = tx('pics.max', `You can add at most ${max} photos.`, { max }); break; }
        if (!f.type.startsWith('image/')) { err.textContent = tx('pics.notImage', 'Only image files can be added.'); continue; }
        if (f.size > 20 * 1024 * 1024) { err.textContent = tx('pics.tooBig', 'That photo is too large (20 MB at most).'); continue; }
        try {
          photos.push({ id: `p-${Math.random().toString(36).slice(2, 9)}`, ...(await resizeImage(f)), at: new Date().toISOString() });
        } catch {
          err.textContent = tx('pics.unreadable', 'That photo could not be read. Try another one.');
        }
        render();
      }
    };

    render();
    A(wrap, grid, count, err);
    return { el: wrap, get: () => photos.slice(), reset() { photos = []; render(); } };
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

  window.UI = { $, h, A, button, defList, tag, t, gallery, photoPicker, openPhoto };
})();
