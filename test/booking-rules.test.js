// Tests for shared/booking-rules.js. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../shared/booking-rules.js';

// Saturday 17 October 2026; the Tuesday after is a normal open day.
const SAT = '2026-10-17';
const TUE = '2026-10-20';
const NEAR = { distanceKm: 5 }; // a Copenhagen postcode: 13 kr. travel

const okInput = (over = {}) => ({
  date: TUE, arrival: '10:00', address: 'Jagtvej 1, 2200 København N', name: 'Test', phone: '12345678',
  email: 'test@example.com', note: '', photos: [], ...over,
});
const ctx = (over = {}) => ({ todayDate: SAT, closedDates: [], dayBookings: [], carePlus: false, urgentDates: [], ...over });

test('today is worked out in Copenhagen time, not the machine\'s', () => {
  assert.equal(R.today(new Date('2026-10-17T21:30:00Z')), '2026-10-17'); // 23:30 in Copenhagen (summer time)
  assert.equal(R.today(new Date('2026-10-17T22:30:00Z')), '2026-10-18'); // 00:30 the next day
  assert.equal(R.today(new Date('2026-12-31T23:30:00Z')), '2027-01-01'); // winter time, new year
});

test('date arithmetic crosses months, years and the clock change', () => {
  assert.equal(R.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.addMonths('2026-10-17', 3), '2027-01-17');
  assert.equal(R.weekday(SAT), 6);
});

test('prices, discounts and travel', () => {
  let q = R.quote(['puncture', 'chain'], NEAR);
  assert.deepEqual([q.oneOff, q.discount, q.travel, q.total], [348, 0, 13, 361], 'repairs without the Bike Check get no combo');
  q = R.quote(['bike-check', 'chain'], NEAR);
  assert.deepEqual([q.discount, q.discountReason, q.total], [17, 'combo', 344], 'Bike Check + another service: 5% off');
  assert.equal(R.quote(['bike-check'], NEAR).discount, 0, 'the Bike Check alone is not a combo');
  q = R.quote(['premium-monthly', 'chain'], NEAR);
  assert.deepEqual([q.discountReason, q.discount, q.monthly], ['carePlus', 7, 99], 'choosing Care Plus gives 5% in the same booking');
  q = R.quote(['bike-check', 'chain'], { ...NEAR, carePlus: true });
  assert.deepEqual([q.discountReason, q.discount], ['carePlus', 17], 'combo and Care Plus do not stack');
  assert.equal(R.quote(['chain'], { ...NEAR, carePlus: true }).discount, 7, 'a Care Plus member gets 5% off later repairs');
  assert.equal(R.quote(['chain']).travel, null, 'no distance, no travel fee yet');
});

test('work time and the 45-minute limit', () => {
  assert.equal(R.quote(['bike-check', 'brakes']).workMin, 40);
  assert.equal(R.quote(['bike-check', 'brakes']).blockMin, 55, 'a booking blocks its work plus 15 minutes of travel');
  assert.equal(R.quote(['bike-check', 'puncture', 'gears']).tooLong, true, '55 minutes is refused');
  assert.equal(R.quote([]).workMin, 45, 'with nothing chosen, times are shown for a full visit');
  assert.equal(R.service('diagnostics').price, 299);
  assert.equal(R.service('diagnostics').durationMin, 20);
});

test('start times: 08:30 onwards, work finished by 15:30', () => {
  const t = R.startTimes(45);
  assert.equal(t[0].time, '08:30');
  assert.equal(t.at(-1).time, '14:30');
  assert.equal(t.length, 13);
  assert.equal(R.startTimes(15).at(-1).time, '15:00', 'a short job can start at 15:00');
  assert.deepEqual(R.arrivalTimes().slice(0, 2), ['08:30', '09:00']);
});

test('a booking blocks its time plus the travel gap', () => {
  const day = [{ arrival: '11:00', blockMin: 55 }]; // 11:00–11:55
  const free = (time, work = 40) => R.startTimes(work, day).find((s) => s.time === time).free;
  assert.equal(free('11:00'), false, 'the same start');
  assert.equal(free('11:30'), false, 'a start inside the blocked time');
  assert.equal(free('10:30'), false, 'a job that would run into the next booking');
  assert.equal(free('12:00'), true, 'the next free start');
  assert.equal(free('10:00', 15), true, '10:00 + 15 min work + 15 min travel ends at 10:30');
});

test('closed days', () => {
  assert.equal(R.closedReason('2026-10-18'), 'sunday');
  assert.equal(R.closedReason(TUE, [TUE]), 'closed');
  assert.equal(R.closedReason(TUE, { [TUE]: { reason: 'Holiday' } }), 'closed');
  assert.equal(R.closedReason(TUE), null);
  assert.equal(R.nextOpenDay('2026-10-18'), '2026-10-19');
});

test('lead time and the Care Plus urgent visit', () => {
  const q = R.quote(['chain'], NEAR);
  const err = (date, c) => R.checkBooking(okInput({ date }), q, ctx(c)).date;
  assert.equal(err(SAT), 'lead', 'booking for today is refused');
  assert.equal(err('2026-10-16'), 'past');
  assert.equal(err('2026-10-19'), undefined, 'guests can book from 2 days ahead');
  // Monday 19 Oct is 2 days ahead of Saturday; use a Monday "today" to test tomorrow.
  const MON = '2026-10-19';
  const errMon = (date, c) => R.checkBooking(okInput({ date }), q, ctx({ todayDate: MON, ...c })).date;
  assert.equal(errMon(TUE), 'lead', 'a guest cannot book tomorrow');
  assert.equal(errMon(TUE, { carePlus: true }), undefined, 'a Care Plus member can book tomorrow');
  assert.equal(errMon(TUE, { carePlus: true, urgentDates: ['2026-10-05'] }), 'urgentUsed', 'one urgent visit per month');
  assert.equal(errMon(TUE, { carePlus: true, urgentDates: ['2026-09-30'] }), undefined, 'last month\'s does not count');
  assert.equal(R.isUrgentDate(TUE, MON), true);
  assert.equal(R.isUrgentDate('2026-10-21', MON), false);
});

test('the earliest date offered', () => {
  assert.equal(R.earliestDate({ todayDate: '2026-10-19' }), '2026-10-21', 'everyone: 2 days ahead');
  assert.equal(R.earliestDate({ todayDate: '2026-10-19', carePlus: true }), '2026-10-20', 'Care Plus: tomorrow');
  assert.equal(R.earliestDate({ todayDate: SAT, carePlus: true }), '2026-10-19', 'not when tomorrow is a Sunday');
  assert.equal(R.earliestDate({ todayDate: '2026-10-19', carePlus: true, closedDates: ['2026-10-20'] }), '2026-10-21', 'or blocked');
  assert.equal(R.earliestDate({ todayDate: '2026-10-19', carePlus: true, urgentDates: ['2026-10-02'] }), '2026-10-21', 'or already used');
});

test('booking form checks', () => {
  const q = R.quote(['chain'], NEAR);
  assert.deepEqual(R.checkBooking(okInput(), q, ctx()), {}, 'a complete booking passes');
  assert.equal(R.checkBooking(okInput(), R.quote([], NEAR), ctx()).services, 'services');
  assert.equal(R.checkBooking(okInput(), R.quote(['bike-check', 'puncture', 'gears'], NEAR), ctx()).services, 'tooLong');
  assert.equal(R.checkBooking(okInput(), R.quote(['diagnostics'], NEAR), ctx()).note, 'note', 'Diagnostics needs a description');
  assert.equal(R.checkBooking(okInput({ note: 'Creaks' }), R.quote(['diagnostics'], NEAR), ctx()).note, undefined);
  assert.equal(R.checkBooking(okInput({ date: '2026-10-25' }), q, ctx()).date, 'sunday');
  assert.equal(R.checkBooking(okInput({ arrival: '15:00' }), R.quote(['bike-check', 'brakes'], NEAR), ctx()).arrival, 'arrival', '15:00 + 40 min ends after 15:30');
  assert.equal(R.checkBooking(okInput({ arrival: '10:00' }), q, ctx({ dayBookings: [{ arrival: '10:00', blockMin: 30 }] })).arrival, 'taken');
  assert.equal(R.checkBooking(okInput({ email: '' }), q, ctx()).form, 'contact');
  assert.equal(R.checkBooking(okInput({ email: 'nope' }), q, ctx()).form, 'email');
  assert.equal(R.checkBooking(okInput(), R.quote(['chain'], { distanceKm: 30 }), ctx()).form, 'far', 'beyond 18 km');
  assert.equal(R.checkBooking(okInput(), R.quote(['chain']), ctx()).form, 'address', 'an address that cannot be priced');
  assert.equal(R.checkBooking(okInput({ photos: [1, 2, 3, 4] }), q, ctx()).photos, 'photosMax');
  assert.equal(R.checkBooking(okInput({ date: 'tomorrow' }), q, ctx()).date, 'past', 'malformed dates are refused');
});

test('travel estimate stand-in, consultation form, subscriptions', () => {
  assert.equal(R.estimateKm('Jagtvej 1, 2200 København N'), 5);
  assert.equal(R.estimateKm('No postcode'), null);
  assert.equal(R.travelFee(14), 35);
  assert.equal(R.checkConsultation({ name: 'A', company: 'B', email: 'a@b.dk', phone: '1', companyType: 'Hotel', bikes: '6–15' }), null);
  assert.equal(R.checkConsultation({ name: 'A' }), 'missing');
  assert.equal(R.checkConsultation({ name: 'A', company: 'B', email: 'x', phone: '1', companyType: 'Hotel', bikes: '6–15' }), 'email');
  assert.equal(R.commitmentEnds('2026-10-20'), '2027-01-20', 'Care plans: 3-month minimum');
});

test('accepting the terms and the early start of work', () => {
  assert.equal(R.checkAcceptance({ terms: true, earlyStart: true }), null);
  assert.equal(R.checkAcceptance({ earlyStart: true }), 'terms');
  assert.equal(R.checkAcceptance({ terms: true }), 'earlyStart', 'the withdrawal acknowledgement is required too');
  assert.equal(R.checkAcceptance({ terms: 'yes', earlyStart: true }), 'terms', 'only a real true counts');
  assert.equal(R.checkAcceptance(null), 'terms');
});

test('the address with floor and door, written the Danish way', () => {
  assert.equal(R.fullAddress('Jagtvej 10, 2200 København N', '2. tv.'), 'Jagtvej 10, 2. tv., 2200 København N');
  assert.equal(R.fullAddress('Jagtvej 10, Grønholt, 3480 Fredensborg', 'st.'), 'Jagtvej 10, st., Grønholt, 3480 Fredensborg');
  assert.equal(R.fullAddress('Jagtvej 10, 2200 København N', ''), 'Jagtvej 10, 2200 København N', 'no apartment');
  assert.equal(R.fullAddress('Jagtvej 10', ' 3. th, '), 'Jagtvej 10, 3. th', 'no comma in the address');
});
