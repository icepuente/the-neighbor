// Deleting texts from the owner's sheet (SLET), protected texts, and bringing a text back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as T from '../scripts/texts-lib.js';
import { report } from '../scripts/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = Object.fromEntries(Object.entries(T.FILES).map(([k, f]) => [k, readFileSync(join(root, f), 'utf8')]));

// The legal-page tests need particular paragraphs (a link, bold text, a data-if paragraph), which the
// owner may edit or delete in the live pages; they run on a pinned copy in test/fixtures instead.
const LEGAL_FILES = { ...FILES, privacy: readFileSync(join(root, 'test/fixtures/privacy.html'), 'utf8'), terms: readFileSync(join(root, 'test/fixtures/terms.html'), 'utf8') };
const HEAD = ['Hvor', 'Nøgle', 'Dansk', 'English', 'Hjælp', 'Kommentar'];
const sheet = (files, edits = {}) => [HEAD, ...T.collect(files).map((e) => [e.where, e.key, edits[e.key]?.da ?? e.da ?? '', edits[e.key]?.en ?? e.en ?? '', e.help, ''])];
const fresh = (files = FILES) => T.stateFrom(T.collect(files));
const get = (files, key) => T.collect(files).find((e) => e.key === key);
// The page's I18N.t in one language, from i18n.js as written.
const pageT = (i18n, lang) => {
  const sb = { window: {}, localStorage: { getItem: () => lang, setItem() {} } };
  vm.runInNewContext(i18n, sb);
  return sb.window.I18N.t;
};
const legal = (files, page, start) => T.collect(files).find((e) => e.kind === 'legal' && e.key.startsWith(page) && (e.da ?? '').startsWith(start));

test('SLET (any case, spaces around it) deletes one language; the sheet then shows SLET', () => {
  for (const word of ['SLET', 'slet', '  Slet ']) {
    const r = T.importSheet(FILES, sheet(FILES, { 'hero.lead': { da: word } }), fresh());
    assert.deepEqual(r.changes.map((c) => [c.key, c.lang, c.to]), [['hero.lead', 'da', T.DELETED]], word);
    const dict = T.readI18n(r.files.i18n);
    assert.equal(dict.da['hero.lead'], null, 'null in i18n.js');
    assert.equal(dict.en['hero.lead'], T.readI18n(FILES.i18n).en['hero.lead'], 'English untouched');
    assert.equal(pageT(r.files.i18n, 'da')('hero.lead'), '', 'the Danish page shows nothing (no English fallback)');
    assert.equal(pageT(r.files.i18n, 'en')('hero.lead'), T.readI18n(FILES.i18n).en['hero.lead']);
    assert.equal(get(r.files, 'hero.lead').da, T.DELETED, 'exported as SLET');
    assert.equal(r.state['hero.lead'].da, T.DELETED);
    assert.match(r.oneLanguage.join(), /hero\.lead: deleted in Danish, still there in English/);
  }
});

test('SLET in both cells deletes the text from both sites; importing again does nothing', () => {
  const rows = sheet(FILES, { 'faq.pay': { da: 'SLET', en: 'slet' }, 'faq.payA': { da: 'SLET', en: 'SLET' } });
  const r = T.importSheet(FILES, rows, fresh());
  assert.equal(r.changes.length, 4);
  assert.deepEqual(r.oneLanguage, [], 'gone in both: nothing to flag');
  assert.match(r.files.i18n, /'faq\.pay': null/);
  const again = T.importSheet(r.files, rows, r.state);
  assert.deepEqual([again.changes, again.warnings, again.stateChanged], [[], [], false]);
  // A fresh export of the deleted texts still has their rows, with SLET, and imports as no change.
  const exported = sheet(r.files);
  assert.ok(exported.some((row) => row[1] === 'faq.pay' && row[2] === T.DELETED && row[3] === T.DELETED));
  assert.deepEqual(T.importSheet(r.files, exported, r.state).changes, []);
});

test('typing text over SLET brings it back; one language back is flagged too', () => {
  const del = T.importSheet(FILES, sheet(FILES, { 'about.sub': { da: 'SLET', en: 'SLET' } }), fresh());
  const back = T.importSheet(del.files, sheet(del.files, { 'about.sub': { da: 'Ejeren gør det hele selv.' } }), del.state);
  assert.deepEqual(back.changes.map((c) => [c.lang, c.from, c.to]), [['da', T.DELETED, 'Ejeren gør det hele selv.']]);
  assert.equal(T.readI18n(back.files.i18n).da['about.sub'], 'Ejeren gør det hele selv.');
  assert.equal(T.readI18n(back.files.i18n).en['about.sub'], null);
  assert.match(back.oneLanguage.join(), /about\.sub: deleted in English, still there in Danish/);
  assert.equal(back.state['about.sub'].da, 'Ejeren gør det hele selv.');
  const both = T.importSheet(back.files, sheet(back.files, { 'about.sub': { en: 'The owner does it all.' } }), back.state);
  assert.deepEqual(both.oneLanguage, []);
  // A text brought back cannot gain {placeholders}: deletable texts have none.
  assert.throws(() => T.importSheet(del.files, sheet(del.files, { 'about.sub': { da: 'Fra {price}' } }), del.state), /curly braces/);
  // The code deleting it meanwhile, and the sheet restoring it: the usual conflict rules apply.
  const stale = T.importSheet(del.files, sheet(FILES, { 'about.sub': { da: 'Ny' } }), fresh());
  assert.equal(stale.conflicts.length, 1);
});

test('protected texts: SLET rejects that row only, with the reason; every other row applies', () => {
  const r = T.importSheet(FILES, sheet(FILES, {
    'co.send': { da: 'SLET', en: 'Send it now' },        // the button that sends the request
    'service.chain.name': { da: 'slet' },                 // a repair's name
    'service.chain.price': { da: 'SLET' },                // and price
    'err.email': { en: 'SLET' },
    'mail.subject': { da: 'SLET' },
    'svc.time': { da: 'SLET' },                           // has {m}
    'hero.lead': { da: 'Ny lead.' },
  }), fresh());
  assert.deepEqual(r.changes.map((c) => c.key), ['hero.lead'], 'only the good row applied');
  assert.equal(r.rejected.length, 6);
  const why = Object.fromEntries(r.rejected.map((x) => [x.match(/row \d+: ([\w.]+):/)[1], x]));
  assert.match(why['co.send'], /cannot be deleted .*the row was not applied/);
  assert.equal(T.readI18n(r.files.i18n).en['co.send'], T.readI18n(FILES.i18n).en['co.send'], 'the English edit in that row is not applied either');
  assert.match(why['service.chain.name'], /a repair needs a name/);
  assert.match(why['service.chain.price'], /needs a price/);
  assert.match(why['err.email'], /error message/);
  assert.match(why['mail.subject'], /placeholders|email/);
  assert.match(why['svc.time'], /placeholders/);
  assert.equal(r.state['co.send'].da, fresh()['co.send'].da, 'the state is not moved for a rejected row');
  // Still strict about everything else: a bad price elsewhere stops the import.
  assert.throws(() => T.importSheet(FILES, sheet(FILES, { 'co.send': { da: 'SLET' }, 'service.brakes.price': { da: 'billig' } }), fresh()), /nothing was changed/);
  // And the library refuses it directly too.
  assert.throws(() => T.setText(FILES, get(FILES, 'co.send'), 'da', 'SLET'), /cannot be deleted/);
});

test('the protected list: whatever the scripts use is protected, and the deletable patterns are real', () => {
  const all = T.collect(FILES);
  const site = all.filter((e) => e.kind === 'site');
  const deletable = site.filter((e) => !T.protectedReason(e));
  // Every pattern matches something (no stale entries), and no deletable text has {placeholders}.
  for (const p of T.DELETABLE) assert.ok(deletable.some((e) => (p.includes('*') ? new RegExp(`^${p.replace(/\./g, '\\.').replace(/\*/g, '[\\w-]+')}$`) : { test: (k) => k === p }).test(e.key)), p);
  for (const e of deletable) assert.ok(!/\{\w+\}/.test(`${e.da}${e.en}`), e.key);
  // Keys the scripts read through t(): protected, except the ones the page leaves out when empty.
  const handled = new Set(['svc.tubeIncl']);
  const handledTemplates = ['svc.${s.id}.what'];
  const scripts = ['web/js', 'api'].flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.js') && f !== 'i18n.js').map((f) => readFileSync(join(root, d, f), 'utf8')));
  for (const src of scripts) {
    for (const [, key] of src.matchAll(/\bt\('([\w.]+)'/g)) {
      const e = site.find((x) => x.key === key);
      if (e && !handled.has(key)) assert.ok(T.protectedReason(e), `${key} is used by a script, so it must be protected`);
    }
    for (const [, tpl] of src.matchAll(/\bt\(`([^`]+)`/g)) {
      if (handledTemplates.includes(tpl)) continue;
      const re = new RegExp(`^${tpl.replace(/\./g, '\\.').replace(/\$\{[^}]+\}/g, '[\\w-]+')}$`);
      for (const e of site.filter((x) => re.test(x.key))) assert.ok(T.protectedReason(e), `${e.key} (t(\`${tpl}\`)) must be protected`);
    }
  }
  // Placeholders in the form, and the buttons and labels, are protected.
  const html = FILES.i18n && readFileSync(join(root, 'web/index.html'), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n-ph="([\w.]+)"/g)) assert.ok(T.protectedReason(get(FILES, key)), key);
  for (const [, key] of html.matchAll(/<(?:button|label|summary)[^>]*data-i18n="([\w.]+)"/g)) if (!key.startsWith('faq.')) assert.ok(T.protectedReason(get(FILES, key)), key);
  for (const key of ['nav.book', 'co.acceptTerms', 'co.earlyStart', 'co.readTerms', 'co.privacy', 'footer.terms', 'footer.privacy', 'bk.seePrice']) assert.ok(T.protectedReason(get(FILES, key)), key);
  // The sheet tells the owner which ones.
  assert.match(get(FILES, 'co.send').help, /Kan ikke slettes/);
  assert.doesNotMatch(get(FILES, 'faq.pay').help, /Kan ikke slettes/);
});

test('legal paragraphs: deleted, emptied and hidden; the keys after it stay; flagged; brought back', () => {
  const FILES = LEGAL_FILES;
  const fresh = (files = FILES) => T.stateFrom(T.collect(files));
  const p = legal(FILES, 'privacy', 'Kan siden ikke sende forespørgslen');
  const before = T.collect(FILES).map((e) => e.key);
  const r = T.importSheet(FILES, sheet(FILES, { [p.key]: { da: 'slet', en: 'SLET' } }), fresh());
  assert.deepEqual(T.collect(r.files).map((e) => e.key), before, 'every key is where it was');
  assert.ok(!r.files.privacy.includes('Kan siden ikke sende forespørgslen'), 'the Danish text is gone from the page');
  assert.ok(r.files.privacy.includes('<p data-proofread="new" hidden data-deleted></p>') && r.files.privacy.includes('<p hidden data-deleted></p>'), 'both languages: an empty hidden paragraph');
  assert.deepEqual(r.legalDeletions.map((c) => c.lang), ['da', 'en']);
  assert.deepEqual(r.oneLanguage, []);
  const text = report(r);
  assert.match(text.split('\n')[0], /^!! LEGAL: a paragraph of the privacy policy was deleted \(privacy\.html#\d+, Dansk\)/);
  assert.equal(get(r.files, p.key).da, T.DELETED);
  // Brought back: plain text (escaped), shown again; the other language stays deleted (flagged).
  const back = T.importSheet(r.files, sheet(r.files, { [p.key]: { da: 'Virker det ikke, kan du <b>selv</b> sende en mail.' } }), r.state);
  assert.ok(back.files.privacy.includes('<p data-proofread="new">Virker det ikke, kan du &lt;b&gt;selv&lt;/b&gt; sende en mail.</p>'));
  assert.match(back.oneLanguage.join(), /deleted in English, still there in Danish/);
  assert.match(report(back), /^!! ONE LANGUAGE: /m);
  assert.match(report(back), /restored: "Virker det ikke/);

  // Deleted in one language only, in the terms: flagged as legal and as one language.
  const t = T.collect(FILES).find((e) => e.kind === 'legal' && e.key.startsWith('terms') && e.da && e.en);
  const one = T.importSheet(FILES, sheet(FILES, { [t.key]: { en: 'SLET' } }), fresh());
  assert.match(report(one), /!! LEGAL: a paragraph of the terms was deleted .*English/);
  assert.match(report(one), /!! ONE LANGUAGE: terms\.html#\S+ deleted in English, still there in Danish/);

  // A paragraph with a link: deleted, and brought back as plain text.
  const linked = legal(FILES, 'privacy', 'Du kan klage til Datatilsynet');
  const dl = T.importSheet(FILES, sheet(FILES, { [linked.key]: { da: 'SLET' } }), fresh());
  assert.ok(!dl.files.privacy.includes('datatilsynet.dk</a>, hvis'));
  const rb = T.importSheet(dl.files, sheet(dl.files, { [linked.key]: { da: 'Du kan klage til Datatilsynet.' } }), dl.state);
  assert.ok(rb.files.privacy.includes('<p>Du kan klage til Datatilsynet.</p>'));
});

test('a deleted data-if paragraph stays hidden when brought back (privacy.js shows it), and privacy.js skips deleted ones', () => {
  const FILES = LEGAL_FILES;
  const fresh = (files = FILES) => T.stateFrom(T.collect(files));
  const p = T.collect(FILES).find((e) => e.kind === 'legal' && (e.da ?? '').startsWith('Desuden: mens du skriver gadenavnet'));
  const r = T.importSheet(FILES, sheet(FILES, { [p.key]: { da: 'SLET' } }), fresh());
  assert.ok(r.files.privacy.includes('<p data-if="addressSuggest" data-proofread="new" hidden data-deleted></p>'));
  const back = T.importSheet(r.files, sheet(r.files, { [p.key]: { da: 'Igen.' } }), r.state);
  assert.ok(back.files.privacy.includes('<p data-if="addressSuggest" data-proofread="new" hidden>Igen.</p>'));
  assert.match(readFileSync(join(root, 'web/js/privacy.js'), 'utf8'), /!el\.hasAttribute\('data-deleted'\)/);
});

test('the page hides deleted texts and leaves no gaps: i18n.js apply() and the CSS', () => {
  // A small stand-in for the DOM: enough for apply() (querySelectorAll, dataset, hidden, parentElement).
  const el = (attrs = {}, children = []) => {
    const e = { attrs, children, hidden: false, textContent: '', parentElement: null, dataset: {} };
    for (const [k, v] of Object.entries(attrs)) e.dataset[k.replace(/^data-/, '').replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v;
    for (const c of children) c.parentElement = e;
    const all = () => children.flatMap((c) => [c, ...c.querySelectorAll('*')]);
    e.querySelectorAll = (sel) => (sel === '*' ? all() : all().filter((x) => `[${Object.keys(x.attrs).join('][')}]`.includes(sel)));
    return e;
  };
  const r = T.importSheet(FILES, sheet(FILES, { 'hero.title': { da: 'SLET' }, 'hero.lead': { da: 'SLET' }, 'faq.parts': { da: 'SLET' }, 'how.2': { da: 'SLET' }, 'pt.come': { da: 'SLET' } }), fresh());
  const h1 = el({ 'data-i18n': 'hero.title' });
  const lead = el({ 'data-i18n': 'hero.lead' });
  const heroText = el({ 'data-i18n-group': 'all' }, [h1, lead]);
  const card = el({ 'data-i18n-group': 'any' }, [el({ 'data-i18n': 'faq.parts' }), el({ 'data-i18n': 'faq.partsA' })]);
  const card2 = el({ 'data-i18n-group': 'any' }, [el({ 'data-i18n': 'faq.pay' }), el({ 'data-i18n': 'faq.payA' })]);
  const point = el({ 'data-i18n-group': 'all' }, [el({ 'data-i18n': 'pt.come' }), el({ 'data-i18n': 'pt.comeSub' })]);
  const how2 = el({ 'data-i18n': 'how.2' });
  const startsHidden = el({ 'data-i18n': 'bk.selectServices' });
  startsHidden.hidden = true;
  const doc = el({}, [heroText, card, card2, point, how2, startsHidden]);
  doc.documentElement = {};
  const sb = { window: {}, localStorage: { getItem: () => 'da', setItem() {} }, document: doc };
  vm.runInNewContext(r.files.i18n, sb);
  assert.deepEqual([h1.hidden, lead.hidden, heroText.hidden], [true, true, true], 'the hero text block goes when both its texts do');
  assert.deepEqual([card.hidden, card2.hidden], [true, false], 'a question without its answer goes');
  assert.deepEqual([point.hidden, point.children[1].hidden], [false, false], 'a point keeps its other text');
  assert.equal(how2.hidden, true);
  assert.equal(startsHidden.hidden, true, 'never unhides what starts hidden');
  const css = readFileSync(join(root, 'web/css/style.css'), 'utf8');
  for (const rule of ['[hidden] { display: none !important; }', '[data-deleted] { display: none !important; }', '.flow:not(:has(> li:not([hidden])))', '.legal ul:not(:has(> li:not([hidden])))', '.hero:has(> [hidden])']) assert.ok(css.includes(rule), rule);
});
