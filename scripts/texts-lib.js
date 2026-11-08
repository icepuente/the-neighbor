// Every text the owner can edit, read from and written back to the site's source files. Used by
// scripts/texts.js (the proofreading sheet and the Google Sheet) and its tests. Pure functions on
// the files' contents: `files` is { i18n, rules, privacy, terms } (web/js/i18n.js,
// web/js/booking-rules.js, web/privacy.html, web/terms.html as strings).
//
// A text has a key, and a Danish and an English value (null where there is none):
//   site texts         'hero.title'                       from web/js/i18n.js (DA and EN blocks)
//   service names      'service.puncture.name'            SERVICES in web/js/booking-rules.js
//   service prices     'service.puncture.price'           the same; Danish column only
//   legal paragraphs   'privacy.html#3', 'terms.html#d3-e4', 'terms.html#e3'
//                                                         each heading, paragraph and list item of
//                                                         the DA and EN articles; the numbers are its
//                                                         position in each language (#3 = both 3rd)
import vm from 'node:vm';

export const FILES = { i18n: 'web/js/i18n.js', rules: 'web/js/booking-rules.js', privacy: 'web/privacy.html', terms: 'web/terms.html' };
export const LANGS = ['da', 'en'];
const LEGAL = [['privacy', 'privacy.html', 'Privatlivspolitik'], ['terms', 'terms.html', 'Handelsbetingelser']];
export const MAX_PRICE = 5000;
export const BY_AGREEMENT = 'aftale';

// One line, single spaces: how legal paragraphs and service names are compared and shown.
const oneLine = (s) => String(s ?? '').replace(/[ \t\r\n]+/g, ' ').trim();
// Site texts keep their line breaks (a few have them); only the ends are trimmed.
const trimText = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

export class TextError extends Error {}
const fail = (msg) => { throw new TextError(msg); };

// ---- Site texts: web/js/i18n.js ----
export function readI18n(source) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  return sandbox.window.I18N.dict;
}
// The source of one language's block: from '    da: {' to '    en: {' (or the end).
function langBlock(source, lang) {
  const start = source.indexOf(`    ${lang}: {`);
  if (start < 0) fail(`web/js/i18n.js has no ${lang} block`);
  const next = lang === 'da' ? source.indexOf('    en: {') : -1;
  return [start, next < 0 ? source.length : next];
}
const jsString = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}'`;
export function setSiteText(source, lang, key, value) {
  const [start, end] = langBlock(source, lang);
  const block = source.slice(start, end);
  const re = new RegExp(`('${reEscape(key)}':\\s*)(?:'(?:[^'\\\\\\n]|\\\\.)*'|"(?:[^"\\\\\\n]|\\\\.)*")`);
  if (!re.test(block)) fail(`${key}: not found in the ${lang} texts of web/js/i18n.js`);
  const out = source.slice(0, start) + block.replace(re, (m, k) => k + jsString(value)) + source.slice(end);
  if (readI18n(out)[lang][key] !== value) fail(`${key}: could not be written to web/js/i18n.js`);
  return out;
}

// ---- Services: SERVICES in web/js/booking-rules.js, one service per line ----
const SERVICE_LINE = /^\s*\{ id: '([\w-]+)',.*\},?\s*$/;
const field = (line, name) => line.match(new RegExp(`\\b${name}: (null|\\d+|'(?:[^'\\\\]|\\\\.)*')`))?.[1];
const unquote = (v) => (v == null || v === 'null' ? null : v.startsWith("'") ? v.slice(1, -1).replace(/\\(.)/g, '$1') : Number(v));
export function readServices(source) {
  const block = source.slice(source.indexOf('export const SERVICES = ['), source.indexOf('];', source.indexOf('export const SERVICES = [')));
  return block.split('\n').map((line) => line.match(SERVICE_LINE)).filter(Boolean).map((m) => ({
    id: m[1], name: unquote(field(m[0], 'name')), da: unquote(field(m[0], 'da')), price: unquote(field(m[0], 'price')), needsNote: /\bneedsNote: true\b/.test(m[0]),
  }));
}
function setServiceField(source, id, name, literal) {
  const lines = source.split('\n');
  const i = lines.findIndex((l) => SERVICE_LINE.test(l) && l.includes(`{ id: '${id}',`));
  if (i < 0) fail(`service.${id}: no such service in web/js/booking-rules.js`);
  const re = new RegExp(`\\b${name}: (null|\\d+|'(?:[^'\\\\]|\\\\.)*')`);
  if (!re.test(lines[i])) fail(`service.${id}: no ${name} in web/js/booking-rules.js`);
  lines[i] = lines[i].replace(re, () => `${name}: ${literal}`);
  return lines.join('\n');
}
// A price from the sheet: whole kroner 0-5000, or "aftale" (empty also means that) for the service
// whose price is always agreed later (Other Repair, needsNote): that one cannot get a fixed price,
// nor can the others become "by agreement". Returns the normalised text: '199' or 'aftale'.
export function normPrice(v) {
  const s = oneLine(v).toLowerCase();
  if (s === '' || s === BY_AGREEMENT || s === 'efter aftale' || s === 'pris efter aftale') return BY_AGREEMENT;
  return /^\d+$/.test(s) ? String(Number(s)) : s;
}
function checkPrice(key, svc, v) {
  if (v === BY_AGREEMENT) {
    if (!svc.needsNote) fail(`${key}: "${BY_AGREEMENT}" (pris efter aftale) is only for a service the customer describes (Anden reparation); write a price in whole kroner`);
    return null;
  }
  if (svc.needsNote) fail(`${key}: this repair is always priced by agreement (the customer describes it first); leave "${BY_AGREEMENT}"`);
  if (!/^\d+$/.test(v)) fail(`${key}: "${v}" is not a price; write whole kroner, digits only (fx 199)`);
  const n = Number(v);
  if (n > MAX_PRICE) fail(`${key}: ${n} kr. is over ${MAX_PRICE} kr.; is that a typo?`);
  return n;
}

// ---- Legal pages: web/privacy.html, web/terms.html ----
// Each heading, paragraph and list item in the <article lang=".."> of the page.
const BLOCK_RE = /<(h1|h2|h3|p|li)(\s[^>]*)?>([\s\S]*?)<\/\1>/g;
function articleRange(html, lang) {
  const m = new RegExp(`<article[^>]*lang="${lang}"[^>]*>`).exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  return [start, html.indexOf('</article>', start)];
}
function legalBlocks(html, lang) {
  const r = articleRange(html, lang);
  if (!r) return [];
  const article = html.slice(r[0], r[1]);
  return [...article.matchAll(BLOCK_RE)].map((m) => {
    const innerStart = r[0] + m.index + m[0].indexOf('>') + 1;
    return { tag: m[1], inner: m[3], innerStart, innerEnd: innerStart + m[3].length, text: tokens(m[3]).text };
  }).filter((b) => b.text);
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m));
export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
// A block's inner HTML as tags and text pieces, and its text as shown in the sheet (tags left out,
// spaces collapsed): each text piece knows which part of that text it makes up.
function tokens(inner) {
  const parts = inner.split(/(<[^>]*>)/);
  const out = [];
  let text = '';
  let depth = 0;
  for (const raw of parts) {
    if (raw.startsWith('<')) {
      out.push({ tag: raw });
      // <br> and the like add no nesting; </x> closes.
      if (/^<\//.test(raw)) depth--; else if (!/^<(br|img|wbr|hr)\b/i.test(raw) && !raw.endsWith('/>')) depth++;
      continue;
    }
    let t = decode(raw).replace(/[ \t\r\n]+/g, ' ');
    if (t.startsWith(' ') && (text === '' || text.endsWith(' '))) t = t.slice(1);
    out.push({ raw, from: text.length, text: t, depth });
    text += t;
  }
  // The trailing space of the text (from the last pieces) is not shown.
  const trimmed = text.replace(/ +$/, '');
  for (const p of out) if (p.text != null && p.from + p.text.length > trimmed.length) p.text = p.text.slice(0, Math.max(0, trimmed.length - p.from));
  return { parts: out, text: trimmed };
}
// Words, spaces and single punctuation marks: what a block's old and new texts are compared by.
const words = (s) => s.match(/[ ]+|[\p{L}\p{N}]+|[^ \p{L}\p{N}]/gu) || [];
// Where `next` differs from `old`: [{ from, to, text }], old[from, to) replaced by text, from a
// longest-common-subsequence comparison of their words.
function hunks(old, next) {
  const a = words(old);
  const b = words(next);
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  let pos = 0;
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); pos += a[i].length; i++; j++; continue; }
    cur ||= { from: pos, to: pos, text: '' };
    if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) cur.text += b[j++];
    else { pos += a[i].length; cur.to = pos; i++; }
  }
  flush();
  return out;
}
// A new text for a block. Without tags the block is replaced (escaped). With tags (a link, bold,
// a line break) only the text between them may change: each changed stretch must fall inside one
// text piece, and the tags stay as they are. Anything typed that looks like HTML is escaped, never
// kept as HTML.
export function editBlock(inner, value) {
  const { parts, text: old } = tokens(inner);
  const next = oneLine(value);
  if (next === old) return inner;
  const pieces = parts.filter((p) => p.text != null && p.raw.trim() !== '');
  const edits = new Map();
  for (const h of hunks(old, next)) {
    // The piece the change belongs to; an insertion right where two pieces meet goes into the less
    // nested one (outside the bold or the link).
    const fits = pieces.filter((p) => p.from <= h.from && h.to <= p.from + p.text.length);
    if (!fits.length) fail('crosses a link, bold text or line break; change only the words between them (or ask Alec)');
    const piece = fits.reduce((x, y) => (y.depth < x.depth ? y : x));
    if (!edits.has(piece)) edits.set(piece, []);
    edits.get(piece).push(h);
  }
  const rewrite = (piece) => {
    let newText = piece.text;
    for (const h of edits.get(piece).sort((x, y) => y.from - x.from)) newText = newText.slice(0, h.from - piece.from) + h.text + newText.slice(h.to - piece.from);
    // The piece's own leading and trailing whitespace (line breaks in the HTML) is kept, unless the
    // edit removed or added the space there.
    const [, lead, , trail] = piece.raw.match(/^([ \t\r\n]*)([\s\S]*?)([ \t\r\n]*)$/);
    const L = newText.startsWith(' ') ? lead || ' ' : piece.text.startsWith(' ') ? '' : lead;
    const T = newText.endsWith(' ') ? trail || ' ' : piece.text.endsWith(' ') ? '' : trail;
    return L + escapeHtml(newText.replace(/^ /, '').replace(/ $/, '')) + T;
  };
  const result = parts.map((p) => (edits.has(p) ? rewrite(p) : p.tag ?? p.raw)).join('');
  if (tokens(result).text !== next) fail('could not be applied without moving a link or bold text; change only the words between them (or ask Alec)');
  return result;
}
// Danish and English blocks paired by position, allowing for a block only one language has (the
// English terms have an extra paragraph): the longest run of matching block types (h2 with h2,
// p with p) is paired, the rest stand alone.
function align(da, en) {
  const n = da.length;
  const m = en.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = da[i].tag === en[j].tag ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && da[i].tag === en[j].tag && L[i][j] === L[i + 1][j + 1] + 1) pairs.push([i++, j++]);
    else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) pairs.push([i++, null]);
    else pairs.push([null, j++]);
  }
  return pairs;
}
export function legalKey(file, d, e) {
  if (d != null && e != null) return d === e ? `${file}#${d + 1}` : `${file}#d${d + 1}-e${e + 1}`;
  return d != null ? `${file}#d${d + 1}` : `${file}#e${e + 1}`;
}
function parseLegalKey(key) {
  const m = key.match(/^(privacy|terms)\.html#(?:(\d+)|d(\d+)-e(\d+)|d(\d+)|e(\d+))$/);
  if (!m) return null;
  const [, page, both, d1, e1, d2, e2] = m;
  const num = (s) => (s == null ? null : Number(s) - 1);
  return { page, da: num(both ?? d1 ?? d2), en: num(both ?? e1 ?? e2) };
}
function setLegal(html, lang, index, value, key) {
  const b = legalBlocks(html, lang)[index];
  if (!b) fail(`${key}: the page has no such ${lang === 'da' ? 'Danish' : 'English'} paragraph any more`);
  if (!oneLine(value)) fail(`${key}: empty; to remove a paragraph, ask Alec`);
  let inner;
  try { inner = editBlock(b.inner, value); } catch (e) { fail(`${key} (${lang === 'da' ? 'Dansk' : 'English'}): ${e.message}`); }
  return html.slice(0, b.innerStart) + inner + html.slice(b.innerEnd);
}

// ---- All texts ----
// [{ key, where, da, en, help, kind }], in sheet order: site texts, services, then the legal pages.
// da/en are null where that language has no text to edit.
export function collect(files) {
  const out = [];
  const dict = readI18n(files.i18n);
  // The demo bar goes at launch; empty texts have nothing to read.
  for (const key of Object.keys(dict.da)) {
    if (key.startsWith('demo.') || !dict.da[key]) continue;
    const vars = placeholders(dict.da[key]);
    out.push({ kind: 'site', key, where: 'Hjemmeside', da: dict.da[key], en: dict.en[key] ?? null, help: vars ? `Behold ${vars.split(',').map((v) => `{${v}}`).join(' ')} som de er` : '' });
  }
  for (const s of readServices(files.rules)) {
    out.push({ kind: 'name', key: `service.${s.id}.name`, where: 'Reparation: navn', da: s.da, en: s.name, help: 'Navnet på reparationen' });
    out.push({ kind: 'price', key: `service.${s.id}.price`, where: 'Reparation: pris', da: s.price == null ? BY_AGREEMENT : String(s.price), en: null,
      help: s.needsNote ? `Altid pris efter aftale: lad "${BY_AGREEMENT}" stå` : `Pris i hele kroner, kun tal (0–${MAX_PRICE}). Kun i Dansk-kolonnen` });
  }
  for (const [name, file, label] of LEGAL) {
    const html = files[name];
    const da = legalBlocks(html, 'da');
    const en = legalBlocks(html, 'en');
    for (const [d, e] of align(da, en)) {
      const tagged = (b) => b && /<(?!br\b)\w/i.test(b.inner);
      out.push({ kind: 'legal', key: legalKey(file, d, e), where: label, da: d == null ? null : da[d].text, en: e == null ? null : en[e].text,
        help: [d == null ? 'Kun på engelsk' : e == null ? 'Kun på dansk' : '', tagged(da[d]) || tagged(en[e]) ? 'Har link eller fed skrift: ret kun ordene, ikke selve linket' : ''].filter(Boolean).join('. ') });
    }
  }
  return out;
}
// Values compared the way the sheet shows them.
export function norm(kind, v) {
  if (v == null) return '';
  if (kind === 'price') return normPrice(v);
  if (kind === 'site') return trimText(v);
  return oneLine(v);
}

// Writes one value: returns the updated files, or throws a TextError saying why the value is refused.
export function setText(files, entry, lang, value) {
  const { key, kind } = entry;
  const v = norm(kind, value);
  if (entry[lang] == null) fail(`${key}: has no ${lang === 'da' ? 'Danish' : 'English'} text to change${kind === 'price' ? ' (the price goes in the Dansk column)' : ''}`);
  if (kind === 'site') {
    if (!v) fail(`${key} (${lang}): empty; every text on the site needs words`);
    if (v.length > 2000) fail(`${key} (${lang}): over 2000 characters`);
    if (placeholders(v) !== placeholders(entry[lang])) fail(`${key} (${lang}): keep the words in curly braces exactly as they were (${placeholders(entry[lang]).split(',').filter(Boolean).map((x) => `{${x}}`).join(' ') || 'none'}); the site fills them in`);
    return { ...files, i18n: setSiteText(files.i18n, lang, key, v) };
  }
  if (kind === 'name' || kind === 'price') {
    const id = key.split('.')[1];
    const svc = readServices(files.rules).find((s) => s.id === id);
    if (!svc) fail(`${key}: no such service`);
    if (kind === 'price') {
      const n = checkPrice(key, svc, v);
      return { ...files, rules: setServiceField(files.rules, id, 'price', n == null ? 'null' : String(n)) };
    }
    if (!v) fail(`${key} (${lang}): empty; a repair needs a name`);
    if (v.length > 60) fail(`${key} (${lang}): over 60 characters`);
    return { ...files, rules: setServiceField(files.rules, id, lang === 'da' ? 'da' : 'name', jsString(v)) };
  }
  const k = parseLegalKey(key);
  if (!k || k[lang] == null) fail(`${key}: not a paragraph key`);
  return { ...files, [k.page]: setLegal(files[k.page], lang, k[lang], v, key) };
}

// ---- The Google Sheet import: a three-way comparison ----
// The sheet can be stale: texts may have changed in the code since it was made. So a cell only
// counts as an edit when it differs from what the sheet held the last time (the state: what was
// exported, then what each import read), and an edit is only applied when the code still has that
// same old text. For each cell:
//   sheet == state            nothing (unchanged in the sheet, even if the code has moved on)
//   sheet == code             nothing to write; the state follows the sheet
//   code  == state            an edit in the sheet: applied, after the checks above
//   otherwise                 a conflict (both changed): skipped and reported; resolved once the
//                             sheet or the code is made to agree
// Any refused value stops the whole import (nothing is written), so a bad cell can never half-apply.
// Returns { files, state, changes: [{ key, lang, from, to }], conflicts: [..], warnings: [..], stateChanged }.
export function importSheet(files, rows, state) {
  const head = rows[0].map((h) => h.trim());
  const col = (name) => head.indexOf(name);
  if (col('Nøgle') < 0 || col('Dansk') < 0 || col('English') < 0) fail('the sheet has no "Nøgle", "Dansk" and "English" columns (is it shared as "anyone with the link"?)');
  const entries = new Map(collect(files).map((e) => [e.key, e]));
  const nextState = structuredClone(state || {});
  const changes = [];
  const conflicts = [];
  const warnings = [];
  const errors = [];
  let out = files;
  const seen = new Set();
  for (const [n, r] of rows.slice(1).entries()) {
    const key = (r[col('Nøgle')] || '').trim();
    if (!key) continue;
    const line = `row ${n + 2}`;
    if (seen.has(key)) { errors.push(`${line}: ${key} appears twice in the sheet`); continue; }
    seen.add(key);
    // Look the entry up in the files as changed so far (legal texts move as paragraphs change).
    const entry = entries.get(key);
    if (!entry) { warnings.push(`${line}: ${key} is no longer on the site; row ignored`); continue; }
    for (const lang of LANGS) {
      const cell = r[col(lang === 'da' ? 'Dansk' : 'English')];
      if (cell == null) continue;
      // A cell with no text behind it (the English of a price, a paragraph only one language has)
      // must stay empty.
      if (entry[lang] == null) {
        if (cell.trim()) errors.push(`${line}: ${key} has no ${lang === 'da' ? 'Danish' : 'English'} text; leave that cell empty${entry.kind === 'price' ? ' (the price goes in the Dansk column)' : ''}`);
        continue;
      }
      const sheet = norm(entry.kind, cell);
      const known = state?.[key] && lang in state[key];
      const last = norm(entry.kind, state?.[key]?.[lang]);
      const code = norm(entry.kind, entry[lang]);
      if (known && sheet === last) continue;
      if (sheet === code) { (nextState[key] ||= {})[lang] = sheet; continue; }
      if (!known) { warnings.push(`${line}: ${key} (${lang}) was not in the sheet when it was made; not applied`); continue; }
      if (code !== last) { conflicts.push(`${key} (${lang}): changed both in the sheet and on the site since the last sync; not applied. Sheet: "${sheet}"  Site: "${code}"`); continue; }
      try {
        const fresh = new Map(collect(out).map((e) => [e.key, e])).get(key) || entry;
        out = setText(out, fresh, lang, sheet);
        changes.push({ key, lang, from: code, to: sheet });
        (nextState[key] ||= {})[lang] = sheet;
      } catch (e) {
        if (!(e instanceof TextError)) throw e;
        errors.push(`${line}: ${e.message}`);
      }
    }
  }
  if (errors.length) fail(`The sheet has ${errors.length} problem(s); nothing was changed:\n${errors.map((x) => `- ${x}`).join('\n')}`);
  const stateChanged = JSON.stringify(sortState(nextState)) !== JSON.stringify(sortState(state || {}));
  return { files: out, state: sortState(nextState), changes, conflicts, warnings, stateChanged };
}
// The state for a fresh sheet: every text as exported.
export function stateFrom(entries) {
  const s = {};
  for (const e of entries) {
    s[e.key] = {};
    for (const lang of LANGS) if (e[lang] != null) s[e.key][lang] = norm(e.kind, e[lang]);
  }
  return sortState(s);
}
const sortState = (s) => Object.fromEntries(Object.keys(s).sort().map((k) => [k, s[k]]));

// ---- CSV ----
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export const toCsv = (rows, sep = ';', bom = true) => `${bom ? '\ufeff' : ''}${rows.map((r) => r.map(cell).join(sep)).join('\r\n')}\r\n`;
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const first = text.split('\n')[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; } else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
// UTF-8 (with or without a BOM, as Google Sheets and Excel's "CSV UTF-8" save it), or else
// Windows-1252 (plain "CSV" from Excel on Danish Windows).
export function decodeCsv(bytes) {
  const b = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); }
}
