// Tests for web/js/booking-rules.js. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../web/js/booking-rules.js';

// Saturday 17 October 2026; the Tuesday after is a normal open day.
const SAT = '2026-10-17';
const TUE = '2026-10-20';
const NEAR = { distanceKm: 5 }; // a Copenhagen postcode: 13 kr. travel

const okInput = (over = {}) => ({
  date: TUE, arrival: '10:00', street: 'Jagtvej 1, 2. tv.', postcode: '2200', name: 'Test', phone: '12345678', note: '', ...over,
});
const ctx = (over = {}) => ({ todayDate: SAT, closedDates: [], ...over });

test('today is worked out in Copenhagen time, not the machine\'s', () => {
  assert.equal(R.today(new Date('2026-10-17T21:30:00Z')), '2026-10-17'); // 23:30 in Copenhagen (summer time)
  assert.equal(R.today(new Date('2026-10-17T22:30:00Z')), '2026-10-18'); // 00:30 the next day
  assert.equal(R.today(new Date('2026-12-31T23:30:00Z')), '2027-01-01'); // winter time, new year
});

test('date arithmetic crosses months and years', () => {
  assert.equal(R.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.weekday(SAT), 6);
});

test('repairs only: the five services', () => {
  assert.deepEqual(R.SERVICES.map((s) => s.id), ['puncture', 'brakes', 'gears', 'chain', 'diagnostics']);
  assert.equal(R.service('bike-check'), undefined, 'no Bike Check');
  assert.equal(R.service('monthly'), undefined, 'no subscriptions');
  assert.equal(R.service('puncture').tubeIncluded, true);
  assert.equal(R.service('diagnostics').needsNote, true);
});

test('prices and travel', () => {
  const q = R.quote(['puncture', 'chain'], NEAR);
  assert.deepEqual([q.servicesTotal, q.travel, q.total], [348, 13, 361]);
  assert.equal(R.quote(['chain']).travel, null, 'no postcode, no travel fee');
  assert.equal(R.quote(['chain']).total, 149);
  assert.equal(R.travelFee(14), 35);
});

test('work time and the 45-minute limit', () => {
  assert.equal(R.quote(['puncture', 'brakes']).workMin, 35);
  assert.equal(R.quote(['puncture', 'brakes', 'diagnostics']).tooLong, true, '55 minutes does not fit in one visit');
  assert.equal(R.quote(['brakes', 'gears', 'chain']).tooLong, false, '45 minutes does');
  assert.equal(R.quote([]).workMin, 45, 'with nothing chosen, times are shown for a full visit');
});

test('start times: 08:30 onwards, work finished by 15:30', () => {
  const t = R.startTimes(45);
  assert.equal(t[0], '08:30');
  assert.equal(t.at(-1), '14:30');
  assert.equal(t.length, 13);
  assert.equal(R.startTimes(15).at(-1), '15:00', 'a short job can start at 15:00');
});

test('closed days and the earliest date', () => {
  assert.equal(R.closedReason('2026-10-18'), 'sunday');
  assert.equal(R.closedReason(TUE, [TUE]), 'closed');
  assert.equal(R.closedReason(TUE, []), null);
  assert.equal(R.nextOpenDay('2026-10-18', []), '2026-10-19');
  assert.equal(R.earliestDate('2026-10-19'), '2026-10-21', '2 days ahead');
});

test('the booking form checks', () => {
  const q = R.quote(['chain'], NEAR);
  const check = (input, qq = q, c) => R.checkRequest(okInput(input), qq, ctx(c));
  assert.deepEqual(check({}), {}, 'a complete request passes');
  assert.equal(check({}, R.quote([], NEAR)).services, 'services');
  assert.equal(check({}, R.quote(['puncture', 'brakes', 'diagnostics'], NEAR)).services, 'tooLong');
  assert.equal(check({}, R.quote(['diagnostics'], NEAR)).note, 'note', 'Diagnostics needs a description');
  assert.equal(check({ note: 'Creaks' }, R.quote(['diagnostics'], NEAR)).note, undefined);
  assert.equal(check({ note: 'x'.repeat(301) }).note, 'noteLong');
  assert.equal(check({ date: SAT }).date, 'lead', 'today is too soon');
  assert.equal(check({ date: '2026-10-18' }).date, 'sunday');
  assert.equal(check({ date: '2026-10-19' }).date, undefined, 'two days ahead is fine');
  assert.equal(check({ date: '2026-10-16' }).date, 'past');
  assert.equal(check({ date: '' }).date, 'date');
  assert.equal(check({}, q, { closedDates: [TUE] }).date, 'closed', 'a day the owner closed');
  assert.equal(check({ arrival: '' }).arrival, 'arrival');
  assert.equal(check({ arrival: '15:00' }, R.quote(['puncture', 'brakes'], NEAR)).arrival, 'arrival', '15:00 + 35 min ends after 15:30');
  assert.equal(check({ arrival: '15:00' }).arrival, undefined, 'a 15-minute job can start at 15:00');
  assert.equal(check({ phone: ' ' }).form, 'contact');
  assert.equal(check({ postcode: '' }).form, 'contact');
  assert.equal(check({}, R.quote(['chain'])).form, 'postcode', 'a postcode that cannot be priced');
  assert.equal(check({}, R.quote(['chain'], { distanceKm: 30 })).form, 'far', 'beyond 18 km');
});

test('travel estimate from the postcode', () => {
  assert.equal(R.estimateKm('2200'), 5);
  assert.equal(R.estimateKm(' 2500 '), 9);
  assert.equal(R.estimateKm('2900'), 14);
  assert.equal(R.estimateKm('4000'), 30);
  assert.equal(R.estimateKm('22000'), null);
  assert.equal(R.estimateKm('abcd'), null);
});

test('the address written the Danish way', () => {
  assert.equal(R.fullAddress('Jagtvej 10, 2. tv.', '2200'), 'Jagtvej 10, 2. tv., 2200');
  assert.equal(R.fullAddress('Jagtvej 10,', '2200'), 'Jagtvej 10, 2200');
  assert.equal(R.fullAddress('Jagtvej 10', ''), 'Jagtvej 10');
});

test('accepting the terms and the early start of work', () => {
  assert.equal(R.checkAcceptance({ terms: true, earlyStart: true }), null);
  assert.equal(R.checkAcceptance({ earlyStart: true }), 'terms');
  assert.equal(R.checkAcceptance({ terms: true }), 'earlyStart', 'the withdrawal acknowledgement is required too');
  assert.equal(R.checkAcceptance({ terms: 'yes', earlyStart: true }), 'terms', 'only a real true counts');
  assert.equal(R.checkAcceptance(null), 'terms');
});

test('the request email and its mailto: link', () => {
  const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
  const fmt = { dkk: (n) => `${n} kr.`, date: (d) => d };
  const r = { ...okInput(), bike: 'Racer', note: 'Æble & "pære"?' };
  const q = R.quote(['puncture', 'chain'], NEAR);
  const mail = R.requestEmail(r, q, { t, fmt, svcName: (s) => s.name });
  assert.match(mail.subject, /Puncture Fix, Chain Service/);
  const lines = mail.body.split('\r\n');
  assert.ok(lines.includes('mail.services: Puncture Fix (199 kr.), Chain Service (149 kr.)'));
  assert.ok(lines.includes('mail.address: Jagtvej 1, 2. tv., 2200'));
  assert.ok(lines.includes('mail.phone: 12345678'));
  assert.ok(lines.some((l) => l.startsWith('mail.price') && l.includes('"total":"361 kr."')), 'the price with travel');
  assert.ok(lines.includes('- co.acceptTerms.') && lines.includes('- co.earlyStart'), 'both ticked statements are in the email');
  assert.ok(!mail.body.includes('\n\n'), 'lines end in CRLF only');

  const link = R.mailtoLink('booking@example.com', mail);
  assert.match(link, /^mailto:booking@example\.com\?subject=[^&]+&body=/);
  const url = new URL(link);
  assert.equal(url.searchParams.get('body'), mail.body, 'the body survives encoding, & and ? included');
  assert.equal(url.searchParams.get('subject'), mail.subject);
  assert.ok(!link.includes('+'), 'spaces are %20, not +, which mail programs would show');
});

test('a long request still fits in a mailto: link', () => {
  // Classic Outlook on Windows has refused mailto: links over about 2,000 characters. A long but
  // realistic request, in the page's own Danish texts: three services and a full note of Danish
  // text (æ, ø and å take 6 characters each once encoded). Beyond that the page offers the text to copy.
  globalThis.window = {};
  globalThis.localStorage = { getItem: () => 'da' };
  return import('../web/js/i18n.js').then(() => {
    const { I18N } = globalThis.window;
    const words = 'Bagbremsen hviner, og gearet hopper på de små tandhjul. Cyklen står i gården bag porten. ';
    const r = { ...okInput(), bike: I18N.t('bike.cargo'), name: 'Søren Ødegård-Æbelø', street: 'Frederikssundsvej 120, 3. th.', note: words.repeat(10).slice(0, R.CONFIG.maxNote) };
    const mail = R.requestEmail(r, R.quote(['brakes', 'gears', 'chain'], NEAR), { t: I18N.t, fmt: { dkk: I18N.dkk, date: I18N.date }, svcName: I18N.svc });
    const len = R.mailtoLink('booking@the-neighbor.dk', mail).length;
    assert.ok(len < 2000, `link of ${len} characters`);
  });
});
