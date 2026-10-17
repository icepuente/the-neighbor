// The real site (web/) on the Firebase emulators: the booking flow through the Cloud Functions,
// checked in the browser and in the emulator database. Run with `npm run test:browser`, which uses
// running emulators (`npm run dev`) or starts its own. It empties the Firestore EMULATOR first.
import { check, evaluate, open, requests, run, setFile, shot, shotEl, sleep, waitFor } from './cdp.js';
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
  check(await evaluate("!document.getElementById('consent') && !document.querySelector('.dialog:not([hidden])')"), 'no popup blocks the page on arrival');
  check(await evaluate("document.querySelectorAll('#plan-cards .plan').length") === 3
    && await evaluate("document.querySelectorAll('#svc-cards a').length") === 6
    && await evaluate("document.querySelectorAll('#care-cards .plan').length") === 2, 'plan, service and Care cards come from the shared rules (3, 6, 2)');
  check((await evaluate("document.querySelector('#svc-cards a .price').textContent")) === '199 kr.', 'prices in Danish: 199 kr.');
  check(await evaluate("document.getElementById('acct-link')?.getAttribute('href') === 'account.html' && document.getElementById('acct-link').textContent === 'Log ind'"),
    'the header has "Log ind", to the account page');
  check(await evaluate("!!document.getElementById('mkacct') && document.getElementById('pw-row').hidden && !document.querySelector('.demo')"), '"Opret en konto" is offered (password hidden until ticked), no demo banner');
  check(await evaluate("!document.getElementById('bk-photo-block').hidden && !!document.getElementById('bk-photo-input')"), 'the photo field is shown');

  // The date picker and the times, used by clicking as a visitor would.
  check(await evaluate("document.getElementById('date').type === 'hidden' && !!document.getElementById('date-btn') && !document.querySelector('input[type=date]')"),
    'every date field uses the site\'s calendar, not the browser\'s');
  check(await evaluate("document.getElementById('times').hidden"), 'no times are shown before a date is chosen');
  await evaluate("document.querySelector('input[name=svc][value=\"chain\"]').click()");
  await waitFor('!!document.getElementById("date").min', 'the earliest date');
  await evaluate("document.getElementById('date-btn').click()");
  check(await evaluate("!document.getElementById('date-cal').hidden"), 'the date button opens the calendar');
  check(await evaluate("document.querySelectorAll('#date-cal .cal-wd')[0].textContent") === 'man', `the calendar starts on Monday, in Danish ("${await evaluate("document.querySelectorAll('#date-cal .cal-wd')[0].textContent")}")`);
  const dayBtn = (d) => `document.querySelector('#date-cal [data-date="${d}"]')`;
  if (await evaluate(`!!${dayBtn(R.addDays(TODAY, 1))}`)) check(await evaluate(`${dayBtn(R.addDays(TODAY, 1))}.disabled`), 'tomorrow cannot be picked (2 days ahead)');
  // A Sunday after the earliest date (an earlier one is disabled as too early instead).
  let laterSunday = R.addDays(TODAY, 3);
  while (R.weekday(laterSunday) !== 0) laterSunday = R.addDays(laterSunday, 1);
  if (await evaluate(`!!${dayBtn(laterSunday)}`)) check(await evaluate(`${dayBtn(laterSunday)}.disabled && ${dayBtn(laterSunday)}.classList.contains('closed')`), 'Sundays cannot be picked');
  if (!await evaluate(`!!${dayBtn(D1)}`)) await evaluate("document.querySelector('#date-cal .cal-nav.next').click()");
  check(await evaluate("!document.getElementById('date-cal').hidden"), 'changing month keeps the calendar open');
  await shotEl('calendar.png', '#f');
  // A browser translating the page once turned "man" into "Monday" and pushed the weekend out of
  // the box: the calendar asks translators to leave it alone, and long names cannot widen it.
  check(await evaluate("document.getElementById('date-cal').translate === false"), 'the calendar asks browser translators to leave it alone');
  const fits = "(()=>{const c=document.getElementById('date-cal');const r=c.getBoundingClientRect();return [...c.querySelectorAll('.cal-day,.cal-wd')].every((d)=>{const b=d.getBoundingClientRect();return b.right<=r.right+0.5&&b.left>=r.left-0.5})})()";
  check(await evaluate(fits), 'every day fits inside the calendar');
  await evaluate("(()=>{const long=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];document.querySelectorAll('#date-cal .cal-wd').forEach((w,i)=>{w.textContent=long[i]})})()");
  check(await evaluate(fits), 'and still does with long, translated weekday names');
  await evaluate(`${dayBtn(D1)}.click()`);
  check(await evaluate("document.getElementById('date-cal').hidden") && await evaluate("document.getElementById('date').value") === D1, 'picking a day closes the calendar');
  check(await evaluate("document.getElementById('date-btn').textContent !== I18N.t('bk.selectDate')"), `the date button shows the day: "${await evaluate("document.getElementById('date-btn').textContent")}"`);
  await waitFor(slotsReady, 'start times after picking a day');
  check(await evaluate("!document.getElementById('times').hidden"), 'and the free times appear straight away, with no list to open');
  await evaluate(`${slot('09:00')}.click()`);
  check(await evaluate(`${slot('09:00')}.checked`) && await evaluate("!document.getElementById('times').hidden"), 'clicking a time chooses it, and the times stay in view');
  await shotEl('times.png', '#f');
  await evaluate("document.getElementById('date-btn').click()");
  await evaluate("document.querySelector('#svc-cards').click()");
  check(await evaluate("document.getElementById('date-cal').hidden"), 'a click elsewhere closes the calendar');

  // The consultation's preferred date uses the same calendar.
  check(await evaluate("document.querySelector('label[for=\"cdate-btn\"]') !== null"), 'the consultation date has the calendar, with its label');
  await evaluate("document.getElementById('cdate-btn').click()");
  if (!await evaluate(`!!document.querySelector('#cdate-cal [data-date="${D1}"]')`)) await evaluate("document.querySelector('#cdate-cal .cal-nav.next').click()");
  await evaluate(`document.querySelector('#cdate-cal [data-date="${D1}"]').click()`);
  check(await evaluate("document.getElementById('cdate').value") === D1, 'a consultation day can be picked');
  await evaluate("document.getElementById('cdate').value = ''; document.getElementById('cdate').dispatchEvent(new Event('change'))");
  await tick('chain');

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
  // The address: type part of it, then choose a suggestion with the keyboard.
  await evaluate("(()=>{const a=document.getElementById('addr');a.focus();a.value='Jagtvej 1';a.dispatchEvent(new Event('input',{bubbles:true}))})()");
  await waitFor("!document.getElementById('addr-suggest').hidden", 'address suggestions', 10000);
  const suggestions = await evaluate("[...document.querySelectorAll('#addr-suggest [role=option]')].map((o)=>o.textContent)");
  check(suggestions.includes('Jagtvej 1, 2200 København N') && suggestions.length <= 6, `typing shows Danish address suggestions (${suggestions.length}: ${suggestions.slice(0, 2).join(' | ')} …)`);
  await shotEl('address.png', '#f');
  const pickIndex = suggestions.indexOf('Jagtvej 1, 2200 København N');
  for (let i = 0; i <= pickIndex; i++) await evaluate("document.getElementById('addr').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
  await evaluate("document.getElementById('addr').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  check(await evaluate("document.getElementById('addr').value") === 'Jagtvej 1, 2200 København N' && await evaluate("document.getElementById('addr-suggest').hidden"),
    'arrow keys and Enter choose a suggestion and close the list');
  check(await evaluate("document.activeElement.id") === 'addr2', 'and move on to floor and door');
  await fill('addr2', '2. tv.');
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
  check(await evaluate("[...document.querySelectorAll('#co a')].map(a=>a.getAttribute('href')).join(' ')") === 'terms.html privacy.html',
    'the price page links to the terms and the privacy policy');
  // Both boxes must be ticked: first neither, then only the terms.
  await evaluate("document.getElementById('confirm').click()");
  check(await evaluate("document.getElementById('e-confirm').textContent === I18N.t('err.accept.terms')") && await evaluate("!document.getElementById('co').hidden"),
    'booking without accepting the terms is stopped, on the price page');
  await evaluate("document.getElementById('acc-terms').click(); document.getElementById('confirm').click()");
  check(await evaluate("document.getElementById('e-confirm').textContent === I18N.t('err.accept.earlyStart')"), 'and without the right-of-withdrawal box too');
  check((await list('bookings')).length === 0, 'nothing was booked');
  await evaluate("document.getElementById('acc-start').click(); document.getElementById('confirm').click()");
  await waitFor("!document.getElementById('done').hidden", 'the confirmation');
  const done = await evaluate("document.getElementById('done-msg').textContent");
  check(done.includes('TN-1041'), `the confirmation shows the booking number: "${done.slice(0, 60)}…"`);
  const bookings = await list('bookings');
  check(bookings.length === 1 && bookings[0].arrival === '10:00' && bookings[0].date === D1 && bookings[0].status === 'pending', 'the booking is in the database');
  check(bookings[0].apartment === '2. tv.' && (await evaluate("document.getElementById('sum').textContent")).includes('Jagtvej 1, 2. tv., 2200 København N'),
    'floor and door are stored, and shown in the address the Danish way');
  check((await evaluate("document.getElementById('sum').textContent")).includes(await evaluate("I18N.t('pics.attached', { n: 1 })")), 'the confirmation mentions the photo');
  const photo = bookings[0].photos?.[0]?.mapValue?.fields;
  check(bookings[0].photos?.length === 1 && photo.path.stringValue === `bookings/${bookings[0].id}/${photo.id.stringValue}.jpg`, 'the booking records its photo');
  check(await exists(photo.path.stringValue) && await exists(photo.thumbPath.stringValue), 'the photo and its thumbnail are in the booking\'s folder in Storage');
  check((await listFiles('uploads/')).every((f) => !f.includes(photo.id.stringValue)), 'and the upload itself is gone');
  check((await list('mail')).length === 2, 'two emails are queued (customer and owner)');
  const accepted = bookings[0].accepted?.fields;
  check(accepted?.terms.booleanValue && accepted?.earlyStart.booleanValue && accepted?.termsVersion.stringValue === R.CONFIG.termsVersion && accepted?.at,
    'the booking records both boxes, the terms version and the time');

  // Next visit: remembered details, and 10:00 is now taken.
  await evaluate("document.getElementById('again').click()");
  await sleep(500);
  await waitFor("document.getElementById('name')?.value", 'remembered details');
  check(await evaluate("document.getElementById('name').value") === 'Mikkel Holm' && await evaluate("document.getElementById('addr2').value") === '2. tv.',
    '"Husk mig" fills in the form next time, floor and door included');
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
    body: JSON.stringify({ data: { input: otherInput, accept: { terms: true, earlyStart: true } } }),
  })).json();
  check(other.result?.booking, 'meanwhile someone else books 11:00');
  await evaluate("document.getElementById('acc-terms').click(); document.getElementById('acc-start').click(); document.getElementById('confirm').click()");
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

  // Privacy policy and terms (drafts): reached from the footer, one language at a time.
  check(await evaluate("[...document.querySelectorAll('footer a')].map(a=>a.getAttribute('href')).join(' ')") === 'terms.html privacy.html',
    'the footer links to the terms and the privacy policy');
  const visible = (id) => `getComputedStyle(document.getElementById('${id}')).display !== 'none'`;
  await evaluate("document.querySelector('footer a[href=\"privacy.html\"]').click()");
  await waitFor("location.pathname.endsWith('/privacy.html') && document.readyState === 'complete'", 'the privacy page');
  await sleep(300);
  check(await evaluate(visible('privacy-da')) && !await evaluate(visible('privacy-en')), 'the privacy policy opens in Danish only');
  check(await evaluate('document.title') === 'Privatlivspolitik · The Neighbor', `its title is Danish: "${await evaluate('document.title')}"`);
  check(await evaluate("document.querySelectorAll('#privacy-da mark.todo').length") > 0, 'placeholders are highlighted');
  await shot('privacy-da.png', 1000);
  await evaluate("document.getElementById('lang-en').click()");
  await sleep(800);
  check(await evaluate(visible('privacy-en')) && !await evaluate(visible('privacy-da')), 'the language switch shows the English version');
  await open(`${SITE}terms.html`);
  check(await evaluate(visible('terms-en')) && !await evaluate(visible('terms-da')), 'the terms open in English, as chosen');
  check((await evaluate("document.getElementById('terms-en').textContent")).includes('Model withdrawal form'), 'the terms include the model withdrawal form');
  await evaluate("document.getElementById('lang-da').click()");
  await sleep(800);
  check(await evaluate(visible('terms-da')) && (await evaluate("document.getElementById('terms-da').textContent")).includes('Standardfortrydelsesformular'), 'and in Danish, the standard form');

  // Fonts and the Firebase SDK are served by the site itself: in this whole run, the browser asked
  // nothing of any other machine (no Google Fonts, no gstatic CDN).
  const outside = requests.filter((u) => /^https?:/.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u));
  check(requests.length > 20 && outside.length === 0, `all ${requests.length} requests stayed on this machine${outside.length ? `; outside: ${[...new Set(outside)].join(', ')}` : ''}`);
  check(await evaluate("document.fonts.check('16px \"Source Serif 4\"') && document.fonts.check('16px \"DM Serif Display\"')")
    && await evaluate("[...document.fonts].filter((f) => f.status === 'loaded').length") >= 2, 'the self-hosted fonts are loaded');

});
