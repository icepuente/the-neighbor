// The site's texts in a spreadsheet, and back. Two sheets (see docs/review/README.md):
//
//   npm run export-texts                  docs/review/proofreading.csv: for a proofreader, in Excel
//   npm run import-texts -- <file.csv>    applies its "Rettelse" (correction) column (Danish)
//
//   npm run sheet-export                  docs/review/sheet.csv: the owner's Google Sheet, made once
//                                         from this file; Dansk and English are edited in place
//   npm run sheet-import -- <file.csv>    applies the sheet (scripts/sheet-sync.sh downloads it,
//                                         imports, tests, commits, pushes and deploys)
//   node scripts/texts.js sheet-url <url> the CSV download address for a Google Sheet's address
//
// The texts: everything in web/js/i18n.js (including the emails, the mail.* keys), the services'
// names and prices in web/js/booking-rules.js, and the privacy policy and terms, paragraph by
// paragraph (scripts/texts-lib.js has the details and the checks).
//
// The proofreading sheet's "Status" column flags Danish text that is new or changed since the last
// proofreading: the site texts listed in NEW_KEYS below, and legal paragraphs marked
// data-proofread="new" in the HTML. Once the proofreader has been through them, empty NEW_KEYS and
// remove the attributes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from './texts-lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_OUT = join(root, 'docs', 'review', 'proofreading.csv');
const SHEET_OUT = join(root, 'docs', 'review', 'sheet.csv');
export const STATE_FILE = join(root, 'docs', 'review', 'sheet-state.json');
const PROOF_HEAD = ['Hvor', 'Nøgle', 'Status', 'Dansk', 'English', 'Rettelse', 'Kommentar'];
const SHEET_HEAD = ['Hvor', 'Nøgle', 'Dansk', 'English', 'Hjælp', 'Kommentar'];
const NEW = 'Ny/ændret 2026-11-06';
// New or changed for sending requests from the site (2026-11-06), and for the address suggestions
// and the floor/door field (2026-11-07), not yet proofread.
const NEW_KEYS = new Set([
  'bk.streetPh', 'bk.apartment', 'bk.apartmentPh', 'bk.suggestions', 'co.readTerms',
  'pt.mailSub', 'bk.sub', 'f.email', 'bk.emailSub', 'bk.hp', 'err.email', 'co.confirmNote', 'co.send', 'co.sendSub', 'co.sending',
  'sent.title', 'sent.msg', 'sent.spam', 'sent.noCopy', 'done.title', 'done.msg', 'done.openMail',
  'mail.email', 'mail.copySubject', 'mail.copyIntro', 'mail.copyNext', 'mail.copyTerms', 'mail.copyHead', 'faq.confirmA', 'faq.dataA',
]);

const readFiles = () => Object.fromEntries(Object.entries(T.FILES).map(([k, f]) => [k, readFileSync(join(root, f), 'utf8')]));
const writeFiles = (before, after) => {
  for (const [k, f] of Object.entries(T.FILES)) if (after[k] !== before[k]) writeFileSync(join(root, f), after[k]);
};
const readState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')).texts : {});
const writeState = (texts) => writeFileSync(STATE_FILE, `${JSON.stringify({
  about: 'What the Google Sheet held at the last sync, per text: scripts/texts.js sheet-import only applies cells that differ from this. Written by the sheet export and import; do not edit by hand.',
  texts,
}, null, 1)}\n`);
const readCsv = (file) => T.parseCsv(T.decodeCsv(readFileSync(file)));
const isNewLegal = (files, e) => {
  // A legal paragraph is flagged when its Danish block carries data-proofread="new".
  const m = e.key.match(/^(privacy|terms)\.html#(?:(\d+)|d(\d+))/);
  if (!m) return false;
  const html = files[m[1]];
  const art = html.match(/<article[^>]*lang="da"[^>]*>([\s\S]*?)<\/article>/)?.[1] || '';
  const blocks = [...art.matchAll(/<(h1|h2|h3|p|li)(\s[^>]*)?>([\s\S]*?)<\/\1>/g)].filter((b) => b[3].replace(/<[^>]+>/g, '').trim());
  return /data-proofread="new"/.test(blocks[Number(m[2] ?? m[3]) - 1]?.[2] || '');
};

// A Google Sheet's address (…/spreadsheets/d/<id>/edit#gid=<tab>) as its CSV download address.
export function csvUrl(url) {
  const m = String(url).match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (!m) return url;
  if (/\/export\?/.test(url) || /\/pub\?/.test(url)) return url;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? '0';
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

function main(argv) {
  const [cmd, ...args] = argv;
  const file = args.find((a) => !a.startsWith('--'));
  const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  if (cmd === 'export') {
    const files = readFiles();
    const rows = T.collect(files).map((e) => [e.where, e.key, (e.kind === 'site' && NEW_KEYS.has(e.key)) || (e.kind === 'legal' && isNewLegal(files, e)) ? NEW : '', e.da ?? '', e.en ?? '', '', '']);
    mkdirSync(dirname(PROOF_OUT), { recursive: true });
    writeFileSync(PROOF_OUT, T.toCsv([PROOF_HEAD, ...rows]));
    console.log(`${rows.length} texts -> ${PROOF_OUT.slice(root.length + 1)}`);
    return 0;
  }
  if (cmd === 'import' && file) {
    // The proofreader's corrections, Danish only, applied straight to the files (a correction is
    // written against the text in the sheet, which is the text at export).
    const rows = readCsv(file);
    const col = Object.fromEntries(rows[0].map((h, i) => [h.trim(), i]));
    if (col.Rettelse === undefined || col['Nøgle'] === undefined) throw new Error(`No "Nøgle" and "Rettelse" columns in ${file}`);
    const before = readFiles();
    let files = before;
    const applied = [];
    const refused = [];
    for (const r of rows.slice(1)) {
      const fix = (r[col.Rettelse] || '').trim();
      if (!fix) continue;
      const key = r[col['Nøgle']];
      const entry = T.collect(files).find((e) => e.key === key);
      try {
        if (!entry) throw new T.TextError(`${key}: no such text any more`);
        files = T.setText(files, entry, 'da', fix);
        applied.push(key);
      } catch (e) {
        if (!(e instanceof T.TextError)) throw e;
        refused.push(`${e.message}${r[col.Kommentar] ? ` (comment: ${r[col.Kommentar]})` : ''}\n    correction: ${fix}`);
      }
    }
    writeFiles(before, files);
    console.log(`Applied ${applied.length} correction(s)${applied.length ? `: ${applied.join(', ')}` : ''}`);
    if (refused.length) console.log(`\nNot applied, to do by hand:\n${refused.map((x) => `- ${x}`).join('\n')}`);
    return 0;
  }
  if (cmd === 'sheet-export') {
    // The texts as they are now. Texts the state does not know yet are added to it; the rest of the
    // state stays, since a sheet made earlier may still be in use.
    const entries = T.collect(readFiles());
    const out = opt('out') || SHEET_OUT;
    const rows = entries.map((e) => [e.where, e.key, e.da ?? '', e.en ?? '', e.help, '']);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, T.toCsv([SHEET_HEAD, ...rows], ',', true));
    const state = readState();
    const fresh = T.stateFrom(entries);
    let added = 0;
    for (const [k, v] of Object.entries(fresh)) for (const [lang, val] of Object.entries(v)) if (!(state[k] && lang in state[k])) { (state[k] ||= {})[lang] = val; added++; }
    if (added || !existsSync(STATE_FILE)) writeState(Object.fromEntries(Object.keys(state).sort().map((k) => [k, state[k]])));
    console.log(`${rows.length} texts -> ${out.startsWith(root) ? out.slice(root.length + 1) : out}${added ? ` (${added} new in ${STATE_FILE.slice(root.length + 1)})` : ''}`);
    return 0;
  }
  if (cmd === 'sheet-import' && file) {
    const before = readFiles();
    let result;
    try {
      result = T.importSheet(before, readCsv(file), readState());
    } catch (e) {
      if (!(e instanceof T.TextError)) throw e;
      console.error(e.message);
      return 1;
    }
    const dry = args.includes('--dry-run');
    if (!dry) {
      writeFiles(before, result.files);
      if (result.stateChanged) writeState(result.state);
    }
    const summary = { changes: result.changes, conflicts: result.conflicts, warnings: result.warnings, stateChanged: result.stateChanged };
    if (opt('summary')) writeFileSync(opt('summary'), JSON.stringify(summary, null, 1));
    const short = (s) => (s.length > 90 ? `${s.slice(0, 87)}...` : s);
    if (result.changes.length) console.log(`${dry ? 'Would apply' : 'Applied'} ${result.changes.length} change(s) from the sheet:\n${result.changes.map((c) => `- ${c.key} (${c.lang}): "${short(c.from)}" -> "${short(c.to)}"`).join('\n')}`);
    if (result.conflicts.length) console.log(`Conflicts, not applied (fix the sheet or the code so they agree):\n${result.conflicts.map((x) => `- ${x}`).join('\n')}`);
    if (result.warnings.length) console.log(`Warnings:\n${result.warnings.map((x) => `- ${x}`).join('\n')}`);
    return 0;
  }
  if (cmd === 'sheet-url' && file) {
    console.log(csvUrl(file));
    return 0;
  }
  console.log('Usage: node scripts/texts.js export | import <file.csv> | sheet-export [--out=file] | sheet-import <file.csv> [--dry-run] [--summary=file.json] | sheet-url <url>');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
