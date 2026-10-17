// Smoke test for the deployed demo (phase 7): books a visit with a photo through the real page,
// against SITE (default https://book.icepuente.com/). Run with `npm run test:demo`, or
// `SITE=http://localhost:8088/ node test/browser/demo.js` through an SSH tunnel before a switch.
// It only adds demo data, which the demo wipes daily anyway.
import { check, evaluate, open, requests, run, setFile, waitFor } from './cdp.js';
import * as R from '../../shared/booking-rules.js';

const SITE = process.env.SITE || 'https://book.icepuente.com/';
const origin = new URL(SITE).origin;
const fill = (id, v) => evaluate(`document.getElementById('${id}').value=${JSON.stringify(v)}`);

run(9335, async () => {
  await open(SITE);
  await evaluate('localStorage.clear()');
  await open(SITE);
  await waitFor('!!window.NBF', 'Firebase');
  check(await evaluate('NBF.environment') === 'demo', `${SITE} runs in demo mode`);
  check((await evaluate("document.querySelector('.env-bar')?.textContent || ''")).startsWith('Demo:'), 'and says so in the bar at the top');

  // A chain service a few days ahead, at the first free time the server offers.
  await evaluate("document.querySelector('input[name=svc][value=\"chain\"]').click()");
  const day = R.nextOpenDay(R.addDays(R.today(), 3));
  // Pick the day in the calendar, by clicking.
  await waitFor('!!document.getElementById("date").min', 'the earliest date');
  await evaluate("document.getElementById('date-btn').click()");
  if (!await evaluate(`!!document.querySelector('#date-cal [data-date="${day}"]')`)) await evaluate("document.querySelector('#date-cal .cal-nav.next').click()");
  await evaluate(`document.querySelector('#date-cal [data-date="${day}"]').click()`);
  check(await evaluate("document.getElementById('date').value") === day && await evaluate("!document.getElementById('times').hidden"), `the calendar picks ${day} and the times appear`);
  await waitFor("document.querySelectorAll('#slots input[name=slot]').length > 0", 'start times from the Functions');
  check(true, `the Functions answer through ${origin}/fn/ (start times for ${day})`);
  await evaluate("document.querySelector('#slots input[name=slot]:not(:disabled)').click()");
  await fill('addr', 'Jagtvej 1, 2200 København N');
  await fill('name', 'Demo Test');
  await fill('tel', '12345678');
  await fill('email', 'demo-test@example.com');
  await setFile('#bk-photo-input');
  await waitFor("document.querySelectorAll('#bk-photos figure img').length === 1", 'the photo');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the price page');
  check((await evaluate("document.querySelector('#tbl .tot').textContent")).includes('162'), 'the price comes back from quoteBooking');
  await evaluate("document.getElementById('acc-terms').click(); document.getElementById('acc-start').click(); document.getElementById('confirm').click()");
  await waitFor("!document.getElementById('done').hidden || document.getElementById('e-confirm').textContent", 'the booking', 30000);
  const err = await evaluate("document.getElementById('e-confirm').textContent");
  check(!err, `no error on confirm${err ? `: ${err}` : ''}`);
  check(/TN-\d+/.test(await evaluate("document.getElementById('done-msg').textContent")), 'the booking is saved, with a TN- number');
  check((await evaluate("document.getElementById('sum').textContent")).includes(await evaluate("I18N.t('pics.attached', { n: 1 })")),
    'the photo was uploaded through the anonymous sign-in and Storage, and attached');
  const ref = (await evaluate("document.getElementById('done-msg').textContent")).match(/TN-\d+/)[0];

  // The owner's dashboard: demo login, the new booking live from Firestore, and its photo from
  // Storage, both through this address.
  await open(`${origin}/admin.html`);
  await waitFor("!document.getElementById('gate').hidden || !document.getElementById('app').hidden", 'the dashboard page');
  if (await evaluate("document.getElementById('app').hidden")) {
    await evaluate("document.querySelector('#demo-login button').click(); document.querySelector('#signin button[type=submit]').click()");
  }
  await waitFor(`!!document.querySelector('.booking[data-ref="${ref}"]')`, 'the new booking in the dashboard', 30000);
  check(true, `the demo owner signs in and sees ${ref} (Firestore through ${origin}/google.firestore.v1.Firestore/)`);
  await waitFor(`document.querySelector('.booking[data-ref="${ref}"] .pic img')?.naturalWidth > 0`, 'the booking photo', 20000);
  check(true, 'and its photo, read from Storage with the owner\'s sign-in');

  const elsewhere = requests.filter((u) => /^https?:/.test(u) && !u.startsWith(origin));
  check(elsewhere.length === 0, `all ${requests.length} requests went to ${origin}${elsewhere.length ? `; elsewhere: ${[...new Set(elsewhere)].join(', ')}` : ''}`);
});
