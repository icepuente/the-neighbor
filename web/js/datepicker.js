// A month calendar for choosing the booking date, in the site's style (replaces <input type=date>,
// which shows the browser's own format and picker). It writes the chosen date ('YYYY-MM-DD') into
// a hidden input and fires 'change' on it, so the page reads the date exactly as before.
//
// Days are buttons: unavailable days (before the earliest date, Sundays, days the owner blocked)
// are disabled. Keyboard: arrow keys move by a day or a week, Page Up/Down by a month, Enter or
// Space picks. Screen readers hear the full date and whether it is unavailable.

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => s.split('-').map(Number);
const addDays = (date, n) => {
  const [y, m, d] = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
};

// Opens and closes the calendar in `panel` below `button`; `input` receives the date.
// opts: { locale, labels: { prev, next, unavailable }, today(), earliest(), unavailable(date) ->
// reason or null, maxMonths, onOpen }.
export function datePicker({ button, panel, input, valueEl, opts }) {
  const { locale } = opts;
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fullFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shortFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const asDate = (s) => { const [y, m, d] = parse(s); return new Date(Date.UTC(y, m - 1, d)); };
  // Monday-first weekday names (1 Jan 2024 was a Monday).
  const weekdays = Array.from({ length: 7 }, (_, i) => dayFmt.format(new Date(Date.UTC(2024, 0, 1 + i))));

  let view; // [year, month0] shown
  let focusDate = null;

  const firstMonth = () => { const [y, m] = parse(opts.today()); return [y, m - 1]; };
  const monthIndex = ([y, m]) => y * 12 + m;
  const canGo = (v) => {
    const i = monthIndex(v);
    const f = monthIndex(firstMonth());
    return i >= f && i <= f + (opts.maxMonths ?? 6);
  };
  const shift = ([y, m], n) => { const i = y * 12 + m + n; return [Math.floor(i / 12), i % 12]; };
  const reasonFor = (date) => (date < opts.earliest() ? 'past' : opts.unavailable(date));

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
    head.append(nav(opts.labels.prev, -1, 'prev'), title, nav(opts.labels.next, 1, 'next'));

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', title.textContent);
    for (const w of weekdays) {
      const c = document.createElement('span');
      c.className = 'cal-wd';
      c.setAttribute('aria-hidden', 'true');
      c.textContent = w.replace('.', '');
      grid.append(c);
    }
    const first = new Date(Date.UTC(y, m, 1));
    const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
    for (let i = 0; i < lead; i++) grid.append(document.createElement('span'));
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const today = opts.today();
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
      b.setAttribute('aria-label', fullFmt.format(asDate(date)) + (reason ? ` – ${opts.labels.unavailable}` : ''));
      if (reason) {
        b.disabled = true;
        b.classList.add(reason === 'past' ? 'past' : 'closed');
      }
      b.tabIndex = -1;
      b.onclick = () => pick(date);
      grid.append(b);
    }
    panel.append(head, grid);
    // One day is in the tab order: the chosen one, else the first available one this month.
    const target = grid.querySelector(`[data-date="${focusDate}"]:not(:disabled)`)
      || grid.querySelector('[aria-pressed="true"]:not(:disabled)')
      || grid.querySelector('.cal-day:not(:disabled)');
    if (target) target.tabIndex = 0;
    return target;
  }

  function pick(date) {
    input.value = date;
    valueEl.textContent = shortFmt.format(asDate(date));
    close();
    button.focus();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open() {
    const start = input.value || opts.earliest();
    const [y, m] = parse(start);
    view = [y, m - 1];
    if (!canGo(view)) view = firstMonth();
    focusDate = input.value || null;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    opts.onOpen?.();
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
    let next = cur;
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

  return {
    close,
    // Re-draw when what is available changed (the server's earliest date or blocked days).
    refresh() { if (!panel.hidden) render(); },
    // Show a date chosen by other code (e.g. tests) in the button.
    sync() { valueEl.textContent = input.value ? shortFmt.format(asDate(input.value)) : valueEl.dataset.placeholder; },
  };
}
