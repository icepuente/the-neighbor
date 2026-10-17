// Tests for shared/emails.js: every customer email renders in Danish and English. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, email, fmtDay, langOf, money } from '../shared/emails.js';

const v = {
  name: 'Anna', contact: 'Mette', ref: 'TN-1042', date: '2026-10-20', time: '10:00', oldDate: '2026-10-19', oldTime: '13:00',
  address: 'Jagtvej 1, 2200 København N', total: 212, services: [{ name: 'Puncture Fix', price: 199 }], message: 'See you soon.',
  work: ['Tube replaced'], parts: [], notes: '', recommendation: null, hasAccount: false,
  company: 'Hotel ABC', plan: 'Standard', price: 300, link: 'https://example.dk/account.html', demo: null,
  month: '2026-10', visitDate: '2026-10-08', counts: { ready: 4, attention: 1, repair: 1 }, updated: false,
};

test('every email has a subject and a text in both languages, with no placeholders left', () => {
  for (const name of Object.keys(TEMPLATES)) {
    for (const lang of ['da', 'en']) {
      const m = TEMPLATES[name](v, lang);
      assert.ok(m.subject && m.text, `${name} (${lang})`);
      assert.ok(!/undefined|null|NaN|\{\w+\}/.test(m.subject + m.text), `${name} (${lang}) has no gaps: ${m.subject}\n${m.text}`);
      assert.ok(m.text.endsWith('The Neighbor'), `${name} (${lang}) is signed`);
    }
    assert.notEqual(TEMPLATES[name](v, 'da').subject, TEMPLATES[name](v, 'en').subject, `${name} is translated`);
  }
});

test('Danish by default; dates and prices written the local way', () => {
  assert.equal(langOf(undefined), 'da');
  assert.equal(langOf('en'), 'en');
  assert.equal(langOf('de'), 'da');
  assert.equal(fmtDay('2026-10-20', 'da'), 'tirsdag den 20. oktober 2026');
  assert.match(fmtDay('2026-10-20', 'en'), /^Tuesday,? 20 October 2026$/);
  assert.equal(money(1800, 'da'), '1.800 kr.');
  assert.equal(money(1800, 'en'), '1.800 DKK');
  const da = email('bookingConfirmed', v);
  assert.equal(da.subject, 'Din booking TN-1042 er bekræftet');
  assert.ok(da.text.includes('tirsdag den 20. oktober 2026 kl. 10:00'));
  assert.equal(email('bookingConfirmed', v, 'en').subject, 'Your booking TN-1042 is confirmed');
});

test('the visit summary lists parts, notes and the recommendation only when there are some', () => {
  const plain = email('visitDone', v, 'da').text;
  assert.ok(!plain.includes('Brugte dele') && !plain.includes('Noter') && !plain.includes('anbefaling'));
  const full = email('visitDone', { ...v, parts: [{ name: 'Slange', price: 59 }], notes: 'Dækket er slidt.', recommendation: { title: 'Nyt dæk', reason: '' }, hasAccount: true }, 'da').text;
  assert.ok(full.includes('- Slange: 59 kr.') && full.includes('Noter: Dækket er slidt.') && full.includes('Vores anbefaling: Nyt dæk') && full.includes('din konto'));
});
