// The site's date picker: a month calendar in the site's style, used for every date field instead
// of the browser's own (which shows its own format and look). attachDatePicker(input, opts) turns
// an <input type="date"> into a button that opens the calendar as a pop-over; the input stays in
// the page (hidden) and holds the chosen date ('YYYY-MM-DD'), and 'change' fires on it as before,
// so the code around it does not change. Without JavaScript the browser's own field remains.
//
// Days are buttons: unavailable days (before the earliest date, or unavailable(date) gives a
// reason) are disabled. Keyboard: arrow keys move by a day or a week, Page Up/Down by a month,
// Enter or Space picks, Escape closes. Screen readers hear the full date and whether it is
// unavailable.

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => s.split('-').map(Number);
const addDays = (date, n) => {
  const [y, m, d] = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
};
const localToday = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()); };

// opts: { locale, labels: { choose, prev, next, unavailable }, today(), earliest(),
// unavailable(date) -> reason or null, maxMonths }. All optional except labels; earliest defaults to
// the input's min, today to the browser's date.
export function attachDatePicker(input, opts) {
  const o = {
    locale: document.documentElement.lang === 'da' ? 'da-DK' : 'en-GB',
    today: localToday,
    earliest: () => input.min || o.today(),
    unavailable: () => null,
    maxMonths: 6,
    ...opts,
  };
  const monthFmt = new Intl.DateTimeFormat(o.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fullFmt = new Intl.DateTimeFormat(o.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shortFmt = new Intl.DateTimeFormat(o.locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayFmt = new Intl.DateTimeFormat(o.locale, { weekday: 'short', timeZone: 'UTC' });
  const asDate = (s) => { const [y, m, d] = parse(s); return new Date(Date.UTC(y, m - 1, d)); };
  // Monday-first weekday names (1 Jan 2024 was a Monday).
  const weekdays = Array.from({ length: 7 }, (_, i) => dayFmt.format(new Date(Date.UTC(2024, 0, 1 + i))).replace('.', ''));

  // ---- The field: a button showing the date, and the pop-over calendar ----
  const wrap = document.createElement('div');
  wrap.className = 'datefield';
  input.before(wrap);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'acc';
  button.id = `${input.id}-btn`;
  button.setAttribute('aria-expanded', 'false');
  const valueEl = document.createElement('span');
  button.append(valueEl);
  const panel = document.createElement('div');
  panel.className = 'cal';
  panel.id = `${input.id}-cal`;
  panel.hidden = true;
  button.setAttribute('aria-controls', panel.id);
  input.type = 'hidden';
  wrap.append(button, panel, input);
  // The field's label now names the button.
  const label = document.querySelector(`label[for="${input.id}"]`);
  if (label) label.htmlFor = button.id;
  const showValue = () => { valueEl.textContent = input.value ? shortFmt.format(asDate(input.value)) : o.labels.choose; };
  showValue();

  let view; // [year, month0] shown
  let focusDate = null;
  const firstMonth = () => { const [y, m] = parse(o.today()); return [y, m - 1]; };
  const monthIndex = ([y, m]) => y * 12 + m;
  const canGo = (v) => {
    const i = monthIndex(v);
    const f = monthIndex(firstMonth());
    return i >= f && i <= f + o.maxMonths;
  };
  const shift = ([y, m], n) => { const i = y * 12 + m + n; return [Math.floor(i / 12), i % 12]; };
  const reasonFor = (date) => (date < o.earliest() ? 'past' : o.unavailable(date));

  function render() {
    panel.textContent = '';
    const [y, m] = view;
    const head = document.createElement('div');
    head.className = 'cal-head';
    const nav = (label, n, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cal-nav ${cls}`;
      b.setAttribute('aria-label', label);
      b.textContent = n < 0 ? '‹' : '›';
      b.disabled = !canGo(shift(view, n));
      b.onclick = () => { view = shift(view, n); focusDate = null; render(); };
      return b;
    };
    const title = document.createElement('h4');
    title.className = 'cal-title';
    title.setAttribute('aria-live', 'polite');
    title.textContent = monthFmt.format(new Date(Date.UTC(y, m, 1)));
    head.append(nav(o.labels.prev, -1, 'prev'), title, nav(o.labels.next, 1, 'next'));

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', title.textContent);
    for (const w of weekdays) {
      const c = document.createElement('span');
      c.className = 'cal-wd';
      c.setAttribute('aria-hidden', 'true');
      c.textContent = w;
      grid.append(c);
    }
    const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday = 0
    for (let i = 0; i < lead; i++) grid.append(document.createElement('span'));
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const today = o.today();
    for (let d = 1; d <= days; d++) {
      const date = iso(y, m, d);
      const reason = reasonFor(date);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-day';
      b.dataset.date = date;
      b.textContent = String(d);
      if (date === today) b.classList.add('today');
      if (date === input.value) b.setAttribute('aria-pressed', 'true');
      b.setAttribute('aria-label', fullFmt.format(asDate(date)) + (reason ? ` – ${o.labels.unavailable}` : ''));
      if (reason) {
        b.disabled = true;
        b.classList.add(reason === 'past' ? 'past' : 'closed');
      }
      b.tabIndex = -1;
      b.onclick = () => pick(date);
      grid.append(b);
    }
    panel.append(head, grid);
    // One day is in the tab order: the focused or chosen one, else the first available one.
    const target = grid.querySelector(`[data-date="${focusDate}"]:not(:disabled)`)
      || grid.querySelector('[aria-pressed="true"]:not(:disabled)')
      || grid.querySelector('.cal-day:not(:disabled)');
    if (target) target.tabIndex = 0;
    return target;
  }

  function pick(date) {
    input.value = date;
    showValue();
    close();
    button.focus();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open() {
    const start = input.value || o.earliest();
    const [y, m] = parse(start);
    view = [y, m - 1];
    if (!canGo(view)) view = firstMonth();
    focusDate = input.value || null;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    render()?.focus();
  }
  function close() {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  // Arrow keys: move by a day or a week; Page Up/Down: by a month; Escape closes.
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); button.focus(); return; }
    const cur = document.activeElement?.dataset?.date;
    if (!cur) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const months = { PageUp: -1, PageDown: 1 }[e.key];
    if (!step && !months) return;
    e.preventDefault();
    let next;
    if (step) next = addDays(cur, step);
    else {
      const [y, m, d] = parse(cur);
      const [ny, nm] = shift([y, m - 1], months);
      next = iso(ny, nm, Math.min(d, new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()));
    }
    const [ny, nm] = parse(next);
    if (!canGo([ny, nm - 1])) return;
    view = [ny, nm - 1];
    focusDate = next;
    render();
    const el = panel.querySelector(`[data-date="${next}"]`);
    if (el && !el.disabled) { el.tabIndex = 0; el.focus(); } else panel.querySelector('.cal-day[tabindex="0"]')?.focus();
  });

  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  // A click anywhere else closes the calendar. composedPath() is taken when the click happens, so
  // the month buttons (which re-draw the calendar) still count as inside.
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !e.composedPath().includes(wrap)) close();
  });
  // Dates set by other code (a reset, a test) show in the button too.
  input.addEventListener('change', showValue);

  return {
    close,
    // Re-draw when what is available changed (the server's earliest date or blocked days).
    refresh() { if (!panel.hidden) render(); },
    // Empty the field (e.g. when a form is reset: a hidden input keeps its value through reset()).
    clear() { input.value = ''; showValue(); close(); },
  };
}
