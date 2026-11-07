// The proofreading sheet: every Danish text the customer sees, next to its English, in one CSV that
// Danish Excel opens directly (semicolons, UTF-8 with BOM).
//
//   npm run export-texts                 writes docs/review/proofreading.csv
//   npm run import-texts -- <file.csv>   applies the "Rettelse" (correction) column for site texts to
//                                         web/js/i18n.js, and lists the legal rows to apply by hand
//
// Site texts come from web/js/i18n.js (including the request email and the customer's copy, the
// mail.* keys), and the privacy policy and terms from web/privacy.html and web/terms.html, paragraph
// by paragraph.
//
// The "Status" column flags Danish text that is new or changed since the last proofreading: the
// site texts listed in NEW_KEYS below, and legal paragraphs marked data-proofread="new" in the HTML.
// Once the proofreader has been through them, empty NEW_KEYS and remove the attributes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_FILE = join(root, 'web', 'js', 'i18n.js');
const OUT = join(root, 'docs', 'review', 'proofreading.csv');
const HEAD = ['Hvor', 'Nøgle', 'Status', 'Dansk', 'English', 'Rettelse', 'Kommentar'];
const NEW = 'Ny/ændret 2026-11-06';
// New or changed for sending requests from the site (2026-11-06), and for the address suggestions
// and the floor/door field (2026-11-07), not yet proofread.
const NEW_KEYS = new Set([
  'bk.streetPh', 'bk.apartment', 'bk.apartmentPh', 'bk.suggestions', 'co.readTerms',
  'pt.mailSub', 'bk.sub', 'f.email', 'bk.emailSub', 'bk.hp', 'err.email', 'co.confirmNote', 'co.send', 'co.sendSub', 'co.sending',
  'sent.title', 'sent.msg', 'sent.spam', 'sent.noCopy', 'done.title', 'done.msg', 'done.openMail',
  'mail.email', 'mail.copySubject', 'mail.copyIntro', 'mail.copyNext', 'mail.copyTerms', 'mail.copyHead', 'faq.confirmA', 'faq.dataA',
]);

// ---- Sources ----
function siteTexts() {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(I18N_FILE, 'utf8'), sandbox);
  const { da, en } = sandbox.window.I18N.dict;
  // The demo bar goes at launch; empty texts have nothing to read.
  return Object.keys(da).filter((k) => !k.startsWith('demo.') && da[k]).map((k) => ['Hjemmeside', k, NEW_KEYS.has(k) ? NEW : '', da[k], en[k] ?? '']);
}

// The text of each heading, paragraph and list item in an <article lang="..">, tags removed, and
// whether it is marked data-proofread="new": [{ text, isNew }].
function blocks(html, lang) {
  const article = html.match(new RegExp(`<article[^>]*lang="${lang}"[^>]*>([\\s\\S]*?)</article>`))?.[1] || '';
  return [...article.matchAll(/<(h1|h2|h3|p|li)([^>]*)>([\s\S]*?)<\/\1>/g)]
    .map((m) => ({ isNew: /data-proofread="new"/.test(m[2]), text: m[3].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() }))
    .filter((b) => b.text);
}
function legalTexts() {
  return [['privacy.html', 'Privatlivspolitik'], ['terms.html', 'Handelsbetingelser']].flatMap(([file, label]) => {
    const html = readFileSync(join(root, 'web', file), 'utf8');
    const da = blocks(html, 'da');
    const en = blocks(html, 'en');
    // The two versions are written section for section, so their paragraphs usually line up.
    const paired = da.length === en.length;
    return da.map((b, i) => [label, `${file}#${i + 1}`, b.isNew ? NEW : '', b.text, paired ? en[i].text : '']);
  });
}

// ---- CSV ----
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCsv = (rows) => `\ufeff${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const sep = text.split('\n')[0].includes(';') ? ';' : ',';
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
// Excel saves "CSV UTF-8" with a BOM; plain "CSV" on Danish Windows is Windows-1252.
function readCsv(file) {
  const bytes = readFileSync(file);
  const utf8 = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return parseCsv(new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(utf8 ? bytes.subarray(3) : bytes));
}

// ---- Import: corrected site texts back into i18n.js (the Danish block only) ----
const jsString = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
function applySiteText(source, key, value) {
  const start = source.indexOf('    da: {');
  const end = source.indexOf('    en: {');
  const block = source.slice(start, end);
  const re = new RegExp(`('${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*)'(?:[^'\\\\]|\\\\.)*'`);
  if (!re.test(block)) return null;
  return source.slice(0, start) + block.replace(re, (m, k) => k + jsString(value)) + source.slice(end);
}

const [cmd, file] = process.argv.slice(2);
if (cmd === 'export') {
  const rows = [HEAD, ...siteTexts(), ...legalTexts()].map((r) => (r.length < HEAD.length ? [...r, '', ''] : r));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, toCsv(rows));
  console.log(`${rows.length - 1} texts -> ${OUT.slice(root.length + 1)}`);
} else if (cmd === 'import' && file) {
  const rows = readCsv(file);
  const col = Object.fromEntries(rows[0].map((h, i) => [h.trim(), i]));
  if (col.Rettelse === undefined || col['Nøgle'] === undefined) throw new Error(`No "Nøgle" and "Rettelse" columns in ${file}`);
  let source = readFileSync(I18N_FILE, 'utf8');
  const applied = [];
  const byHand = [];
  for (const r of rows.slice(1)) {
    const fix = (r[col.Rettelse] || '').trim();
    if (!fix) continue;
    const key = r[col['Nøgle']];
    const updated = r[col.Hvor] === 'Hjemmeside' ? applySiteText(source, key, fix) : null;
    if (updated) { source = updated; applied.push(key); } else byHand.push(`${r[col.Hvor]} ${key}: ${fix}${r[col.Kommentar] ? ` (${r[col.Kommentar]})` : ''}`);
  }
  writeFileSync(I18N_FILE, source);
  console.log(`Applied ${applied.length} site text(s) to web/js/i18n.js${applied.length ? `: ${applied.join(', ')}` : ''}`);
  if (byHand.length) console.log(`\nTo apply by hand (legal pages in web/):\n${byHand.map((x) => `- ${x}`).join('\n')}`);
} else {
  console.log('Usage: node scripts/texts.js export | import <file.csv>');
  process.exitCode = 1;
}
