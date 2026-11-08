// Tests for the owner's sheet: scripts/texts-lib.js (reading and writing every editable text, the
// checks, the three-way import) and scripts/sheet-sync.sh (in a throwaway git clone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import * as T from '../scripts/texts-lib.js';
import { csvUrl } from '../scripts/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = Object.fromEntries(Object.entries(T.FILES).map(([k, f]) => [k, readFileSync(join(root, f), 'utf8')]));
const HEAD = ['Hvor', 'Nøgle', 'Dansk', 'English', 'Hjælp', 'Kommentar'];
// The sheet as exported from `files`, with `edits` ({ key: { da?, en? } }) typed in.
const sheet = (files, edits = {}) => [HEAD, ...T.collect(files).map((e) => [e.where, e.key, edits[e.key]?.da ?? e.da ?? '', edits[e.key]?.en ?? e.en ?? '', e.help, ''])];
const fresh = (files = FILES) => T.stateFrom(T.collect(files));
const get = (files, key) => T.collect(files).find((e) => e.key === key);

test('the sheet covers the site texts, the services and both legal pages, in both languages', () => {
  const all = T.collect(FILES);
  const keys = new Set(all.map((e) => e.key));
  assert.equal(keys.size, all.length, 'every key is unique');
  for (const k of ['hero.title', 'mail.subject', 'service.puncture.name', 'service.puncture.price', 'service.other.price', 'privacy.html#1', 'terms.html#1']) assert.ok(keys.has(k), k);
  assert.ok(![...keys].some((k) => k.startsWith('demo.')), 'not the demo bar');
  assert.deepEqual([get(FILES, 'service.puncture.name').da, get(FILES, 'service.puncture.name').en].map(Boolean), [true, true]);
  assert.equal(get(FILES, 'service.puncture.price').en, null, 'a price has one value, in the Danish column');
  assert.equal(get(FILES, 'service.other.price').da, T.BY_AGREEMENT);
  // The English terms have one paragraph more (it is a translation); the rest still pair up.
  const terms = all.filter((e) => e.kind === 'legal' && e.key.startsWith('terms'));
  assert.equal(terms.filter((e) => e.da == null).length, 1, 'one English-only paragraph');
  assert.ok(terms.filter((e) => e.da && e.en).length >= 40);
  const privacy = all.filter((e) => e.kind === 'legal' && e.key.startsWith('privacy'));
  assert.ok(privacy.every((e) => e.da && e.en), 'the privacy policy pairs up entirely');
});

test('an unchanged sheet changes nothing, and the state starts as the export', () => {
  const r = T.importSheet(FILES, sheet(FILES), fresh());
  assert.deepEqual([r.changes, r.conflicts, r.warnings, r.stateChanged], [[], [], [], false]);
  assert.deepEqual(r.files, FILES);
});

test('the committed state matches the site (the sheet export and the code are in step)', () => {
  const state = JSON.parse(readFileSync(join(root, 'docs/review/sheet-state.json'), 'utf8')).texts;
  const r = T.importSheet(FILES, sheet(FILES), state);
  assert.deepEqual([r.changes, r.conflicts, r.warnings], [[], [], []]);
});

test('site texts: Danish and English are edited in place; the braces must stay', () => {
  const r = T.importSheet(FILES, sheet(FILES, { 'hero.title': { da: 'Punktering? Vi kommer hjem til dig.', en: "Flat tyre? We'll come to you." } }), fresh());
  assert.equal(r.changes.length, 2);
  const dict = T.readI18n(r.files.i18n);
  assert.equal(dict.da['hero.title'], 'Punktering? Vi kommer hjem til dig.');
  assert.equal(dict.en['hero.title'], "Flat tyre? We'll come to you.", 'quotes are escaped in the JS');
  assert.equal(T.readI18n(r.files.i18n).en['about.quote'], T.readI18n(FILES.i18n).en['about.quote'], 'a double-quoted text is left alone');
  // A double-quoted text can be edited too.
  const q = T.importSheet(FILES, sheet(FILES, { 'about.quote': { en: 'You need a neighbour who knows bikes.' } }), fresh());
  assert.equal(T.readI18n(q.files.i18n).en['about.quote'], 'You need a neighbour who knows bikes.');
  assert.throws(() => T.importSheet(FILES, sheet(FILES, { 'mail.subject': { da: 'Booking: {services} den {date}' } }), fresh()), /curly braces/);
  // An empty cell is never a deletion: left as it is, and reported.
  const empty = T.importSheet(FILES, sheet(FILES, { 'hero.title': { en: '  ' }, 'hero.lead': { da: 'Ny lead.' } }), fresh());
  assert.deepEqual(empty.changes.map((c) => c.key), ['hero.lead'], 'the other edits still apply');
  assert.match(empty.warnings.join(), /hero\.title \(en\): the cell is empty.*write SLET/);
  // Code cannot be smuggled in: the text is a JS string, nothing more.
  const evil = "x'; alert(1); '";
  const e = T.importSheet(FILES, sheet(FILES, { 'hero.title': { da: evil } }), fresh());
  assert.equal(T.readI18n(e.files.i18n).da['hero.title'], evil);
});

test('services: names in both languages, prices as whole kroner', () => {
  const r = T.importSheet(FILES, sheet(FILES, { 'service.chain.price': { da: '159' }, 'service.chain.name': { da: 'Kædepleje', en: 'Chain Care' } }), fresh());
  const s = T.readServices(r.files.rules).find((x) => x.id === 'chain');
  assert.deepEqual([s.da, s.name, s.price], ['Kædepleje', 'Chain Care', 159]);
  for (const bad of ['1.000', '149 kr.', '-5', '12,5', 'gratis', '5001', T.BY_AGREEMENT, '']) {
    assert.throws(() => T.importSheet(FILES, sheet(FILES, { 'service.chain.price': { da: bad } }), fresh()), /service\.chain\.price/, bad);
  }
  assert.equal(T.readServices(T.importSheet(FILES, sheet(FILES, { 'service.chain.price': { da: '0' } }), fresh()).files.rules).find((x) => x.id === 'chain').price, 0);
  assert.throws(() => T.importSheet(FILES, sheet(FILES, { 'service.other.price': { da: '300' } }), fresh()), /always priced by agreement/);
  assert.equal(T.importSheet(FILES, sheet(FILES, { 'service.other.price': { da: '' } }), fresh()).changes.length, 0, 'empty is "aftale" too');
  assert.throws(() => T.importSheet(FILES, sheet(FILES, { 'service.chain.price': { en: '159' } }), fresh()), /Dansk column/);
  assert.match(T.importSheet(FILES, sheet(FILES, { 'service.chain.name': { en: '' } }), fresh()).warnings.join(), /empty/);
  assert.throws(() => T.setText(FILES, get(FILES, 'service.chain.name'), 'en', ''), /needs a name/);
});

test('legal paragraphs: plain text replaced and escaped; links and bold stay as they are', () => {
  const plain = T.collect(FILES).find((e) => e.kind === 'legal' && e.key.startsWith('privacy') && e.da.startsWith('Siden gemmer kun'));
  const r = T.importSheet(FILES, sheet(FILES, { [plain.key]: { da: 'Siden gemmer kun dit sprogvalg <script>alert(1)</script> & intet andet.' } }), fresh());
  assert.ok(r.files.privacy.includes('<p>Siden gemmer kun dit sprogvalg &lt;script&gt;alert(1)&lt;/script&gt; &amp; intet andet.</p>'), 'HTML from the sheet is escaped');
  assert.equal(get(r.files, plain.key).da, 'Siden gemmer kun dit sprogvalg <script>alert(1)</script> & intet andet.');

  const linked = T.collect(FILES).find((e) => e.kind === 'legal' && e.da?.startsWith('Du kan klage til Datatilsynet'));
  const ok = T.importSheet(FILES, sheet(FILES, { [linked.key]: { da: linked.da.replace('Du kan klage', 'Du kan altid klage').replace('utilfreds', 'ikke tilfreds') } }), fresh());
  assert.ok(ok.files.privacy.includes('<p>Du kan altid klage til Datatilsynet, <a href="https://www.datatilsynet.dk">datatilsynet.dk</a>, hvis du er ikke tilfreds med'));
  // Changing the link's own words is allowed (they are text inside the tag); crossing it is not.
  assert.throws(() => T.importSheet(FILES, sheet(FILES, { [linked.key]: { da: 'Du kan klage til tilsynet.' } }), fresh()), /link, bold text or line break/);

  const bold = T.collect(FILES).find((e) => e.kind === 'legal' && e.da?.startsWith('Google (Gmail) opbevarer'));
  const b = T.importSheet(FILES, sheet(FILES, { [bold.key]: { da: 'Google (Gmail) opbevarer alle vores mails.' } }), fresh());
  assert.ok(b.files.privacy.includes('<li><strong>Google (Gmail)</strong> opbevarer alle vores mails.</li>'));
  // The English article is edited separately.
  const en = T.importSheet(FILES, sheet(FILES, { [bold.key]: { en: bold.en.replace('stores', 'keeps') } }), fresh());
  assert.ok(en.changes.length === 1 && en.changes[0].lang === 'en');
  const empty = T.importSheet(FILES, sheet(FILES, { [bold.key]: { da: '' } }), fresh());
  assert.deepEqual([empty.changes, empty.files], [[], FILES]);
  assert.match(empty.warnings.join(), /empty/);
});

test('a block edit inside the HTML, piece by piece', () => {
  const inner = 'Dataansvarlig er:<br>\n    The Neighbor v/ Volodymyr Taran<br>\n    E-mail: <a href="mailto:a@b.dk">a@b.dk</a> · Telefon: 12';
  assert.equal(T.editBlock(inner, 'Dataansvarlig er: The Neighbor v/ Volodymyr Taran E-mail: a@b.dk · Telefon: 12'), inner, 'unchanged');
  const out = T.editBlock(inner, 'Den dataansvarlige er: The Neighbor v/ Volodymyr Taran E-mail: a@b.dk · Telefon: 34');
  assert.equal(out, 'Den dataansvarlige er:<br>\n    The Neighbor v/ Volodymyr Taran<br>\n    E-mail: <a href="mailto:a@b.dk">a@b.dk</a> · Telefon: 34');
  assert.throws(() => T.editBlock(inner, 'Dataansvarlig er: The Neighbor'), /link, bold text or line break/);
});

test('a stale sheet never reverts a text changed in the code', () => {
  const state = fresh();
  // The code changes after the sheet was made; the sheet still has the old text.
  const code = { ...FILES, i18n: T.setSiteText(FILES.i18n, 'da', 'hero.title', 'Ny overskrift fra koden') };
  const r = T.importSheet(code, sheet(FILES), state);
  assert.deepEqual([r.changes, r.conflicts], [[], []]);
  assert.equal(r.files.i18n, code.i18n);
  // The owner edits something else in that old sheet: only that is applied.
  const r2 = T.importSheet(code, sheet(FILES, { 'hero.lead': { da: 'En ny lead.' } }), state);
  assert.deepEqual(r2.changes.map((c) => c.key), ['hero.lead']);
  assert.equal(T.readI18n(r2.files.i18n).da['hero.title'], 'Ny overskrift fra koden');
  // Both changed: a conflict, reported and skipped.
  const r3 = T.importSheet(code, sheet(FILES, { 'hero.title': { da: 'Ejerens overskrift' } }), state);
  assert.deepEqual(r3.changes, []);
  assert.equal(r3.conflicts.length, 1);
  assert.match(r3.conflicts[0], /hero\.title \(da\)/);
  // Once the sheet agrees with the code, the state follows and there is nothing more to say.
  const r4 = T.importSheet(code, sheet(code), state);
  assert.deepEqual([r4.changes, r4.conflicts, r4.stateChanged], [[], [], true]);
  assert.equal(r4.state['hero.title'].da, 'Ny overskrift fra koden');
});

test('importing is idempotent: the second run of the same sheet does nothing', () => {
  const edited = sheet(FILES, { 'hero.lead': { da: 'En ny lead.' }, 'service.brakes.price': { da: '139' } });
  const first = T.importSheet(FILES, edited, fresh());
  assert.equal(first.changes.length, 2);
  const second = T.importSheet(first.files, edited, first.state);
  assert.deepEqual([second.changes, second.conflicts, second.stateChanged], [[], [], false]);
  assert.deepEqual(second.files, first.files);
});

test('one bad cell stops the whole import, with every problem listed', () => {
  const rows = sheet(FILES, { 'hero.lead': { da: 'Fint.' }, 'service.brakes.price': { da: 'billig' }, 'mail.subject': { da: 'Ingen klammer' } });
  assert.throws(() => T.importSheet(FILES, rows, fresh()), (e) => e instanceof T.TextError && /2 problem/.test(e.message) && /nothing was changed/.test(e.message));
  assert.throws(() => T.importSheet(FILES, [['Hvor', 'Rettelse'], ['x', 'y']], fresh()), /no "Nøgle", "Dansk" and "English"/);
  const dup = sheet(FILES);
  dup.push(dup[1]);
  assert.throws(() => T.importSheet(FILES, dup, fresh()), /appears twice/);
});

test('rows the site no longer has, and rows the sheet never had, are reported, not applied', () => {
  const rows = sheet(FILES);
  rows.push(['Hjemmeside', 'old.key', 'Gammel', 'Old', '', '']);
  const r = T.importSheet(FILES, rows, fresh());
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /old\.key is no longer on the site/);
  const state = fresh();
  delete state['hero.lead'];
  const r2 = T.importSheet(FILES, sheet(FILES, { 'hero.lead': { da: 'Ny' } }), state);
  assert.deepEqual(r2.changes, []);
  assert.match(r2.warnings.join(), /hero\.lead \(da\) was not in the sheet/);
});

test('CSV: Google Sheets (comma, UTF-8, no BOM), Excel (semicolon, BOM, or Windows-1252)', () => {
  const g = T.parseCsv(T.decodeCsv(Buffer.from('Hvor,Nøgle,Dansk\r\nHjemmeside,a.b,"Æble, ""pære""\nog ål"\r\n', 'utf8')));
  assert.deepEqual(g, [['Hvor', 'Nøgle', 'Dansk'], ['Hjemmeside', 'a.b', 'Æble, "pære"\nog ål']]);
  const x = T.parseCsv(T.decodeCsv(Buffer.from(T.toCsv([['Hvor', 'Nøgle'], ['a;b', 'ø']]), 'utf8')));
  assert.deepEqual(x, [['Hvor', 'Nøgle'], ['a;b', 'ø']]);
  const w = T.parseCsv(T.decodeCsv(Buffer.from([0x48, 0x76, 0x6f, 0x72, 0x3b, 0xf8, 0x0d, 0x0a])));
  assert.deepEqual(w, [['Hvor', 'ø']]);
  assert.equal(csvUrl('https://docs.google.com/spreadsheets/d/AbC-123_x/edit#gid=42'), 'https://docs.google.com/spreadsheets/d/AbC-123_x/export?format=csv&gid=42');
  assert.equal(csvUrl('https://docs.google.com/spreadsheets/d/AbC/edit?usp=sharing'), 'https://docs.google.com/spreadsheets/d/AbC/export?format=csv&gid=0');
});

// ---- scripts/sheet-sync.sh, in a throwaway clone with a local "GitHub" ----
const SYNC_FILES = ['package.json', 'scripts/texts.js', 'scripts/texts-lib.js', 'scripts/sheet-sync.sh', 'scripts/sheet-google.js', 'docs/review/sheet-state.json', ...Object.values(T.FILES)];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sheet-sync-'));
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const src = join(dir, 'src');
  for (const f of SYNC_FILES) { mkdirSync(dirname(join(src, f)), { recursive: true }); cpSync(join(root, f), join(src, f)); }
  git(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(src, 'init', '-q', '-b', 'main');
  for (const c of [src]) { git(c, 'config', 'user.email', 'test@example.dk'); git(c, 'config', 'user.name', 'Test'); }
  git(src, 'add', '-A');
  git(src, 'commit', '-qm', 'start');
  git(src, 'push', '-q', join(dir, 'origin.git'), 'main');
  git(dir, 'clone', '-q', 'origin.git', 'sync');
  const sync = join(dir, 'sync');
  git(sync, 'config', 'user.email', 'sync@example.dk');
  git(sync, 'config', 'user.name', 'Sync');
  const csv = join(dir, 'sheet.csv');
  const run = (env = {}) => spawnSync('bash', ['scripts/sheet-sync.sh'], {
    cwd: sync,
    encoding: 'utf8',
    env: { ...process.env, SHEET_URL: `file://${csv}`, SHEET_SYNC_TEST_CMD: 'true', SHEET_SYNC_DEPLOY_CMD: `echo deployed >> '${join(dir, 'deploys')}'`, HOME: dir, ...env },
  });
  const deploys = () => (existsSync(join(dir, 'deploys')) ? readFileSync(join(dir, 'deploys'), 'utf8').trim().split('\n').length : 0);
  const originLog = () => git(join(dir, 'origin.git'), 'log', '--format=%s', 'main');
  return { dir, sync, csv, run, deploys, originLog, git, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const writeSheet = (file, rows) => writeFileSync(file, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'));

test('sheet-sync: silent without changes; commits, pushes and deploys a change; then silent again', () => {
  const s = setup();
  try {
    writeSheet(s.csv, sheet(FILES));
    let r = s.run();
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
    writeSheet(s.csv, sheet(FILES, { 'hero.title': { da: 'Punktering? Vi kommer hjem til dig.' }, 'service.brakes.price': { da: '139' } }));
    r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Applied 2 change/);
    assert.match(r.stdout, /Deployed/);
    assert.equal(s.originLog().split('\n')[0], 'Texts from the sheet: 2 changes');
    assert.equal(s.deploys(), 1);
    assert.match(readFileSync(join(s.sync, 'web/js/booking-rules.js'), 'utf8'), /id: 'brakes'.*price: 139/);
    r = s.run();
    assert.deepEqual([r.status, r.stdout, s.deploys()], [0, '', 1], 'the same sheet again: nothing');
  } finally { s.done(); }
});

test('sheet-sync: a refused cell, failing tests or a failed deploy never leave a half-done clone', () => {
  const s = setup();
  try {
    writeSheet(s.csv, sheet(FILES, { 'service.brakes.price': { da: 'billig' } }));
    let r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /service\.brakes\.price.*not a price/);
    assert.match(r.stderr, /Sheet sync FAILED/);
    assert.equal(s.git(s.sync, 'status', '--porcelain'), '');
    assert.equal(s.deploys(), 0);

    writeSheet(s.csv, sheet(FILES, { 'hero.title': { da: 'Ny' } }));
    r = s.run({ SHEET_SYNC_TEST_CMD: 'false' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /tests failed/);
    assert.equal(s.git(s.sync, 'status', '--porcelain'), '', 'the change is undone');
    assert.equal(s.originLog().trim(), 'start', 'nothing pushed');

    r = s.run({ SHEET_SYNC_DEPLOY_CMD: 'false' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /deploy failed; it is tried again/);
    assert.equal(s.originLog().split('\n')[0], 'Texts from the sheet: 1 change', 'pushed');
    r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Retrying the deploy/);
    assert.equal(s.deploys(), 1);

    writeFileSync(s.csv, '<!DOCTYPE html><html>Sign in</html>');
    r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /anyone with the link/);
  } finally { s.done(); }
});

test('sheet-sync: a conflict is reported (exit 3) but does not block the other changes', () => {
  const s = setup();
  try {
    // Someone changes hero.title in the code; the owner changes it too, and hero.lead.
    const f = join(s.dir, 'src', 'web/js/i18n.js');
    writeFileSync(f, T.setSiteText(readFileSync(f, 'utf8'), 'da', 'hero.title', 'Fra koden'));
    s.git(join(s.dir, 'src'), 'commit', '-qam', 'code change');
    s.git(join(s.dir, 'src'), 'push', '-q', join(s.dir, 'origin.git'), 'main');
    writeSheet(s.csv, sheet(FILES, { 'hero.title': { da: 'Fra arket' }, 'hero.lead': { da: 'Ny lead' } }));
    const r = s.run();
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /Conflicts, not applied/);
    const dict = T.readI18n(readFileSync(join(s.sync, 'web/js/i18n.js'), 'utf8'));
    assert.deepEqual([dict.da['hero.title'], dict.da['hero.lead']], ['Fra koden', 'Ny lead']);
    assert.equal(s.deploys(), 1);
  } finally { s.done(); }
});

test('sheet-sync: deletions are flagged on "!!" lines; SLET on a protected text is reported (exit 3) and the rest still goes out', () => {
  const s = setup();
  try {
    const p = T.collect(FILES).find((e) => e.kind === 'legal' && e.key.startsWith('privacy') && (e.da ?? '').startsWith('Kan siden ikke sende'));
    writeSheet(s.csv, sheet(FILES, { [p.key]: { da: 'SLET' }, 'hero.lead': { en: 'slet' }, 'co.send': { da: 'SLET' } }));
    const r = s.run();
    assert.equal(r.status, 3, r.stderr);
    const lines = r.stdout.split('\n');
    assert.match(lines[0], /^!! LEGAL: a paragraph of the privacy policy was deleted/);
    assert.ok(lines.some((l) => /^!! ONE LANGUAGE: hero\.lead: deleted in English, still there in Danish/.test(l)));
    assert.ok(lines.some((l) => /^!! ONE LANGUAGE: privacy\.html#\S+ deleted in Danish/.test(l)));
    assert.match(r.stdout, /Rows not applied \(SLET on a text that cannot be deleted\):\n- row \d+: co\.send/);
    assert.equal(s.originLog().split('\n')[0], 'Texts from the sheet: 2 changes');
    assert.match(s.git(s.sync, 'log', '-1', '--format=%B'), /!! LEGAL/, 'the flags are in the commit message too');
    assert.equal(s.deploys(), 1);
    assert.equal(T.readI18n(readFileSync(join(s.sync, 'web/js/i18n.js'), 'utf8')).en['hero.lead'], null);
    // The same sheet again: only the rejected row is still worth a word.
    const again = s.run();
    assert.equal(again.status, 3);
    assert.doesNotMatch(again.stdout, /!!/);
    assert.match(again.stdout, /co\.send/);
    assert.equal(s.deploys(), 1);
  } finally { s.done(); }
});

// ---- sheet-sync through the Google API, against a local fake Google ----
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const runAsync = (cmd, args, opts) => new Promise((resolve) => {
  const p = spawn(cmd, args, opts);
  let stdout = '';
  let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => resolve({ status, stdout, stderr }));
});
async function fakeGoogleServer(state) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      seen.push({ method: req.method, path: decodeURIComponent(u.pathname), auth: req.headers.authorization, body });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (u.pathname === '/token') {
        const f = new URLSearchParams(body);
        if (state.tokenError || f.get('refresh_token') !== 'REFRESH-abc' || f.get('client_secret') !== 'SECRET-xyz') return send(400, { error: 'invalid_grant', error_description: 'Bad Request' });
        return send(200, { access_token: 'ya29.TOKEN', expires_in: 3599 });
      }
      if (req.headers.authorization !== 'Bearer ya29.TOKEN') return send(401, { error: { code: 401, message: 'unauthenticated' } });
      if (u.pathname === `/sheets/v4/spreadsheets/${state.id}`) return send(200, { sheets: [{ properties: { sheetId: 0, title: 'Tekster', index: 0 } }] });
      if (decodeURIComponent(u.pathname) === `/sheets/v4/spreadsheets/${state.id}/values/'Tekster'`) return send(200, { values: state.rows });
      return send(404, { error: { code: 404, message: 'Requested entity was not found.' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

test('sheet-sync: a private sheet through the Google API (token from the refresh token); no secret in any output', async () => {
  const s = setup();
  const state = { id: '1SheetIdForTheTestsOnly_abcdefghij', rows: sheet(FILES, { 'hero.title': { da: 'Fra det private ark' } }) };
  const g = await fakeGoogleServer(state);
  try {
    const conf = join(s.dir, '.config', 'the-neighbor');
    mkdirSync(conf, { recursive: true });
    writeFileSync(join(conf, 'google-oauth.json'), JSON.stringify({ client_id: 'cid', client_secret: 'SECRET-xyz', refresh_token: 'REFRESH-abc' }));
    writeFileSync(join(conf, 'sheet-id'), `${state.id}\n`);
    const env = { ...process.env, HOME: s.dir, NEIGHBOR_GOOGLE_API: g.url, SHEET_SYNC_TEST_CMD: 'true', SHEET_SYNC_DEPLOY_CMD: `echo deployed >> '${join(s.dir, 'deploys')}'`, SHEET_URL: '' };
    // A local fake Google: never through a proxy from the environment.
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NODE_USE_ENV_PROXY']) delete env[k];
    delete env.XDG_CONFIG_HOME;
    delete env.NEIGHBOR_SHEET_ID;
    delete env.NEIGHBOR_SHEET_OAUTH;
    let r = await runAsync('bash', ['scripts/sheet-sync.sh'], { cwd: s.sync, env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Applied 1 change/);
    assert.equal(T.readI18n(readFileSync(join(s.sync, 'web/js/i18n.js'), 'utf8')).da['hero.title'], 'Fra det private ark');
    assert.ok(g.seen.some((x) => x.path === '/token') && g.seen.some((x) => x.path.endsWith("/values/'Tekster'")));
    for (const out of [r.stdout, r.stderr, s.git(s.sync, 'log', '--format=%B')]) for (const secret of ['SECRET-xyz', 'REFRESH-abc', 'ya29.TOKEN']) assert.ok(!out.includes(secret), secret);
    // Google refuses the refresh token: exit 1, Google's reason, nothing changed, no secrets.
    state.tokenError = true;
    state.rows = sheet(FILES, { 'hero.title': { da: 'Igen' } });
    r = await runAsync('bash', ['scripts/sheet-sync.sh'], { cwd: s.sync, env });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /invalid_grant/);
    assert.match(r.stderr, /could not read the sheet through the Google API/);
    for (const secret of ['SECRET-xyz', 'REFRESH-abc']) assert.ok(!r.stderr.includes(secret) && !r.stdout.includes(secret));
    assert.equal(s.git(s.sync, 'status', '--porcelain'), '');
    // An ID configured but no credentials: it says so, and does not fall back to a public link.
    rmSync(join(conf, 'google-oauth.json'));
    r = await runAsync('bash', ['scripts/sheet-sync.sh'], { cwd: s.sync, env: { ...env, SHEET_URL: `file://${s.csv}` } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /google-oauth\.json is missing/);
  } finally { await g.close(); s.done(); }
});
