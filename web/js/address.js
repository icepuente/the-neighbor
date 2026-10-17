// Address suggestions while the visitor types (Danish addresses, from the address register through
// the addressSearch Cloud Function). Typing shows up to 6 official addresses under the field;
// clicking one, or choosing it with the arrow keys and Enter, fills the field in. Typing freely still
// works: the suggestions only help. Follows the ARIA combobox pattern (list box, active option).

// field: the <input>; search(q) -> Promise<[{ id, text }]>; onPick(text) after a choice.
export function attachAddressSuggest(field, { search, onPick, label }) {
  const list = document.createElement('ul');
  list.className = 'suggest';
  list.id = `${field.id}-suggest`;
  list.setAttribute('role', 'listbox');
  if (label) list.setAttribute('aria-label', label);
  list.hidden = true;
  const wrap = document.createElement('div');
  wrap.className = 'suggest-wrap';
  field.before(wrap);
  wrap.append(field, list);
  field.setAttribute('role', 'combobox');
  field.setAttribute('aria-autocomplete', 'list');
  field.setAttribute('aria-controls', list.id);
  field.setAttribute('aria-expanded', 'false');
  // The browser's own address autofill would open on top of the suggestions.
  field.autocomplete = 'off';
  // Addresses are names: a browser translating the page should leave them alone.
  list.translate = false;

  let items = [];
  let active = -1;
  let request = 0;
  let timer;

  function show(found) {
    items = found;
    active = -1;
    list.textContent = '';
    found.forEach((s, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-${i}`;
      li.className = 'suggest-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.textContent = s.text;
      // mousedown, not click: it fires before the field loses focus.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      list.append(li);
    });
    list.hidden = !found.length;
    field.setAttribute('aria-expanded', String(!list.hidden));
    field.removeAttribute('aria-activedescendant');
  }
  const close = () => show([]);

  function highlight(i) {
    active = i;
    [...list.children].forEach((li, n) => li.setAttribute('aria-selected', String(n === i)));
    if (i >= 0) {
      field.setAttribute('aria-activedescendant', `${list.id}-${i}`);
      list.children[i].scrollIntoView({ block: 'nearest' });
    } else field.removeAttribute('aria-activedescendant');
  }

  function pick(i) {
    const s = items[i];
    if (!s) return;
    field.value = s.text;
    close();
    onPick?.(s.text);
  }

  field.addEventListener('input', () => {
    clearTimeout(timer);
    const q = field.value.trim();
    if (q.length < 2) { close(); return; }
    // Wait for a pause in typing; only the latest answer is shown.
    timer = setTimeout(async () => {
      const mine = ++request;
      let found = [];
      try { found = await search(q); } catch { found = []; }
      if (mine === request && document.activeElement === field) show(found);
    }, 200);
  });
  field.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active <= 0 ? items.length - 1 : active - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  field.addEventListener('blur', close);
}
