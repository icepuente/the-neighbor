// The real site (web/) on the Firebase emulators: the booking flow through the Cloud Functions,
// checked in the browser and in the emulator database. Run with `npm run test:browser`, which uses
// running emulators (`npm run dev`) or starts its own. It empties the Firestore EMULATOR first.
import { check, evaluate, open, run, setFile, shot, sleep, waitFor } from './cdp.js';
import * as R from '../../shared/booking-rules.js';
import { exists, listFiles } from '../helpers/emulator-admin.js';

const SITE = 'http://127.0.0.1:5000/';
const PROJECT = 'my-first-firebase-projec-b242f';
const FS = `http://127.0.0.1:8085/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner' };
// Documents of a collection in the Firestore emulator, as { id, ...fields } (arrays stay raw).
const list = async (col) => ((await (await fetch(`${FS}/${col}?pageSize=300`, { headers: OWNER })).json()).documents || [])
  .map((d) => ({
    id: d.name.split('/').pop(),
    ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, v.stringValue ?? v.integerValue ?? v.booleanValue ?? v.mapValue ?? v.arrayValue?.values ?? null])),
  }));
const setDate = (d) => evaluate(`(()=>{const e=document.getElementById('date');e.value='${d}';e.dispatchEvent(new Event('change'))})()`);
const tick = (id) => evaluate(`document.querySelector('input[name=svc][value="${id}"]').click()`);
const fill = (id, v) => evaluate(`document.getElementById('${id}').value=${JSON.stringify(v)}`);
const slotsReady = "document.querySelectorAll('#slots input[name=slot]').length > 0";
const slot = (time) => `document.querySelector('#slots input[value="${time}"]')`;


run(9334, async () => {
  const TODAY = R.today();
  const D1 = R.nextOpenDay(R.addDays(TODAY, 3));
  let SUNDAY = TODAY;
  while (R.weekday(SUNDAY) !== 0) SUNDAY = R.addDays(SUNDAY, 1);
  // Start from an empty emulator database (local test data only).
  const wipe = await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (wipe.status !== 200) throw new Error('could not empty the Firestore emulator: are the emulators running?');

  // A first-time visitor.
  await open(SITE);
  await evaluate('localStorage.clear()');
  await open(SITE);
  await waitFor('!!window.NBF', 'Firebase');
  check(await evaluate('NBF.emulated') && await evaluate("!!document.querySelector('.env-bar')"), 'the site runs on the emulators and says so');
  check(await evaluate("!document.getElementById('consent').hidden"), 'the consent dialog is shown');
  await evaluate("document.getElementById('c1').click();document.getElementById('c2').click();document.getElementById('cok').click()");
  check(await evaluate("document.querySelectorAll('#plan-cards .plan').length") === 3
    && await evaluate("document.querySelectorAll('#svc-cards a').length") === 6
    && await evaluate("document.querySelectorAll('#care-cards .plan').length") === 2, 'plan, service and Care cards come from the shared rules (3, 6, 2)');
  check((await evaluate("document.querySelector('#svc-cards a .price').textContent")) === '199 kr.', 'prices in Danish: 199 kr.');
  check(await evaluate("!document.getElementById('acct-link') && !document.getElementById('mkacct') && !document.querySelector('.demo')"),
    'no log-in link, no "create an account", no demo banner');
  check(await evaluate("!document.getElementById('bk-photo-block').hidden && !!document.getElementById('bk-photo-input')"), 'the photo field is shown');

  // Free times come from the server.
  await tick('chain');
  await setDate(D1);
  await waitFor(slotsReady, 'start times');
  const expected = R.startTimes(15).length;
  check(await evaluate("document.querySelectorAll('#slots input[name=slot]').length") === expected, `the server offers ${expected} start times for a 15-minute job`);
  await setDate(SUNDAY);
  await waitFor("document.getElementById('e-date').textContent", 'the Sunday message');
  check(await evaluate("document.getElementById('e-date').textContent === I18N.t('err.sunday')"), `a Sunday is refused by the server: "${await evaluate("document.getElementById('e-date').textContent")}"`);
  check(await evaluate("document.getElementById('date').min") === R.addDays(TODAY, 2), 'the date field starts 2 days ahead (from the server)');
  await tick('bike-check'); await tick('puncture'); await tick('gears');
  check(await evaluate("document.getElementById('e-services').textContent === I18N.t('err.tooLong')"), 'more than 45 minutes of work is flagged at once');
  await tick('bike-check'); await tick('puncture'); await tick('gears');

  // Book chain service at 10:00.
  await setDate(D1);
  await waitFor(slotsReady, 'start times');
  await evaluate(`${slot('10:00')}.click()`);
  await fill('addr', 'Jagtvej 1, 2200 København N');
  await fill('name', 'Mikkel Holm');
  await fill('tel', '40556677');
  await fill('email', 'mikkel@example.com');
  await evaluate("document.getElementById('remember').click()");
  await setFile('#bk-photo-input');
  await waitFor("document.querySelectorAll('#bk-photos figure img').length === 1", 'the photo thumbnail');
  const shrunk = await evaluate("(()=>{const i=document.querySelector('#bk-photos figure img');return {jpeg:i.src.startsWith('data:image/jpeg'),w:i.naturalWidth}})()");
  check(shrunk.jpeg && shrunk.w <= 1600, `a photo is added, as a JPEG of at most 1600 px (${shrunk.w} px)`);
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the price page');
  check(await evaluate("document.querySelectorAll('#notes .pic img').length") === 1, 'the price page shows the photo');
  const total = await evaluate("document.querySelector('#tbl .tot').textContent");
  check(total.includes('162 kr.'), `the price page shows the server's total, travel included: "${total}"`);
  check((await evaluate("document.getElementById('notes').textContent")).includes(await evaluate("I18N.t('co.estimateTravel')")), 'and says the distance is estimated for now');
  await evaluate("document.getElementById('confirm').click()");
  await waitFor("!document.getElementById('done').hidden", 'the confirmation');
  const done = await evaluate("document.getElementById('done-msg').textContent");
  check(done.includes('TN-1041'), `the confirmation shows the booking number: "${done.slice(0, 60)}…"`);
  const bookings = await list('bookings');
  check(bookings.length === 1 && bookings[0].arrival === '10:00' && bookings[0].date === D1 && bookings[0].status === 'pending', 'the booking is in the database');
  check((await evaluate("document.getElementById('sum').textContent")).includes(await evaluate("I18N.t('pics.attached', { n: 1 })")), 'the confirmation mentions the photo');
  const photo = bookings[0].photos?.[0]?.mapValue?.fields;
  check(bookings[0].photos?.length === 1 && photo.path.stringValue === `bookings/${bookings[0].id}/${photo.id.stringValue}.jpg`, 'the booking records its photo');
  check(await exists(photo.path.stringValue) && await exists(photo.thumbPath.stringValue), 'the photo and its thumbnail are in the booking\'s folder in Storage');
  check((await listFiles('uploads/')).every((f) => !f.includes(photo.id.stringValue)), 'and the upload itself is gone');
  check((await list('mail')).length === 2, 'two emails are queued (customer and owner)');

  // Next visit: remembered details, and 10:00 is now taken.
  await evaluate("document.getElementById('again').click()");
  await sleep(500);
  await waitFor("document.getElementById('name')?.value", 'remembered details');
  check(await evaluate("document.getElementById('name').value") === 'Mikkel Holm', '"Husk mig" fills in the form next time');
  await tick('chain');
  await setDate(D1);
  await waitFor(slotsReady, 'start times');
  check(await evaluate(`${slot('10:00')}.disabled`) && !await evaluate(`${slot('09:30')}.disabled`), '10:00 is shown as taken; 09:30 is still free');

  // Someone else takes 11:00 while this visitor is on the price page: the server refuses it.
  await evaluate(`${slot('11:00')}.click()`);
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the price page');
  const otherInput = { serviceIds: ['chain'], date: D1, arrival: '11:00', bike: 'City bike', address: 'Nørrebrogade 1, 2200 København N', name: 'Other', phone: '1', email: 'other@example.com' };
  const other = await (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west1/createBooking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { input: otherInput, consent: { data: true, terms: true, version: R.CONFIG.consentVersion } } }),
  })).json();
  check(other.result?.booking, 'meanwhile someone else books 11:00');
  await evaluate("document.getElementById('confirm').click()");
  await waitFor("!document.getElementById('f').hidden && document.getElementById('e-arrival').textContent", 'the refusal');
  check(await evaluate("document.getElementById('e-arrival').textContent === I18N.t('err.taken')"), 'the visitor is told the time was just taken, back on the form');
  await waitFor(slotsReady, 'refreshed times');
  check(await evaluate(`${slot('11:00')}.disabled`), 'and 11:00 now shows as taken');

  // Business consultation.
  await fill('cname', 'Sofie Berg');
  await fill('ccomp', 'Hostel Nørrebro');
  await fill('cemail', 'sofie@example.com');
  await fill('ctel', '22334455');
  await fill('ctype', 'Hostel');
  await fill('cnum', '16–35');
  await fill('cmsg', 'Monthly checks for 20 bikes.');
  await evaluate("document.querySelector('#cf button[type=submit]').click()");
  await waitFor("!document.getElementById('cdone').hidden", 'the consultation confirmation');
  check((await list('consultations')).length === 1, 'the consultation request is in the database');
  await shot('web-done.png', 1000);

});
