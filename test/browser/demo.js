// Smoke test for the deployed demo (phase 7): books a visit with a photo through the real page,
// against SITE (default https://book.icepuente.com/). Run with `npm run test:demo`, or
// `SITE=http://localhost:8088/ node test/browser/demo.js` through an SSH tunnel before a switch.
// It only adds demo data, which the demo wipes daily anyway.
import { check, evaluate, open, requests, run, setFile, waitFor } from './cdp.js';
import * as R from '../../shared/booking-rules.js';

const SITE = process.env.SITE || 'https://book.icepuente.com/';
const origin = new URL(SITE).origin;
const fill = (id, v) => evaluate(`(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);

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
  // A new customer each run, who creates an account while booking ("Opret en konto").
  const email = `demo-test-${Date.now()}@example.com`;
  await fill('email', email);
  await evaluate("document.getElementById('mkacct').click()");
  await fill('pw', 'demo-test-password');
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
    'the photo was uploaded through Storage, and attached');
  check((await evaluate("document.getElementById('done-msg').textContent")).includes(await evaluate("I18N.t('done.account')")), 'and the account was created with the booking');
  const ref = (await evaluate("document.getElementById('done-msg').textContent")).match(/TN-\d+/)[0];
  await evaluate("document.querySelector('#done-acct a').click()");
  await waitFor("document.getElementById('hi')?.textContent === 'Hej, Demo'", 'the new account', 30000);
  await evaluate("document.querySelectorAll('#tabs button')[1].click()");
  await waitFor(`!!document.querySelector('.my-booking[data-ref="${ref}"]')`, 'the booking in the new account', 20000);
  check(true, `the new account opens from the confirmation and already holds ${ref}`);
  await evaluate("document.getElementById('out').click()");
  await waitFor("!document.getElementById('login').hidden", 'signed out');

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

  // Log the visit: work done, a photo and a recommendation; the booking is completed.
  const card = `document.querySelector('.booking[data-ref="${ref}"]')`;
  const visit = `${card}.querySelector('details.tool[data-key^="visit-"]')`;
  await evaluate(`${visit}.open = true`);
  const vid = await evaluate(`${visit}.querySelector('textarea').id.replace('v-work-', '')`);
  await fill(`v-work-${vid}`, 'Chain cleaned and lubricated\nGears adjusted');
  await fill(`v-rtitle-${vid}`, 'Replace the chain');
  await setFile(`#visit-photos-${vid}`);
  await waitFor(`${visit}.querySelectorAll('figure img').length === 1`, 'the visit photo');
  await evaluate(`[...${visit}.querySelectorAll('button')].find((b)=>b.textContent.startsWith('Save and email')).click()`);
  await waitFor(`${card}.querySelector('.tag').textContent === 'Completed' || ${visit}?.querySelector(':scope > .err')?.textContent`, 'the logged visit', 30000);
  const visitErr = await evaluate(`${visit}?.querySelector(':scope > .err')?.textContent || ''`);
  check(!visitErr && (await evaluate(`${card}.textContent`)).includes('Visit logged'), `the owner logs the visit with a photo, and ${ref} is completed${visitErr ? `: ${visitErr}` : ''}`);
  await evaluate("[...document.querySelectorAll('#tabs button')].find((b)=>b.textContent.startsWith('Customers')).click()");
  await waitFor(`!!document.querySelector('.customer[data-email="anna@demo.dk"]') && !!document.querySelector('.customer[data-email="${email}"]')`, 'the customers', 20000);
  check(true, 'the Customers tab lists Anna and the new account');

  // The customer side: the demo customer logs in and sees her own bookings.
  await evaluate("document.getElementById('out').click()");
  await open(`${origin}/account.html`);
  await waitFor("!document.getElementById('login').hidden || !document.getElementById('app').hidden", 'the account page');
  await evaluate("document.querySelector('#demo-login button').click(); document.querySelector('#lf button[type=submit]').click()");
  await waitFor("document.getElementById('hi').textContent === 'Hej, Anna'", "Anna's account", 30000);
  await evaluate("document.querySelectorAll('#tabs button')[1].click()");
  await waitFor("document.querySelectorAll('.my-booking').length >= 2", "Anna's bookings", 20000);
  check(true, 'the demo customer logs in and sees her own bookings');
  await evaluate("document.querySelectorAll('#tabs button')[2].click()");
  await waitFor("!!document.querySelector('details.record')", 'her service history', 20000);
  check((await evaluate("document.querySelector('details.record').textContent")).includes('I alt'), 'Historik shows her logged visit with costs');
  await evaluate("document.querySelectorAll('#tabs button')[4].click()");
  // Visitors may have marked the seeded recommendations done in the dashboard: either is fine.
  await waitFor("!!document.querySelector('#view .rec, #view p.sub')", 'her recommendations', 20000);
  check(true, 'Anbefalinger loads');
  await evaluate("document.getElementById('out').click()");

  const elsewhere = requests.filter((u) => /^https?:/.test(u) && !u.startsWith(origin));
  check(elsewhere.length === 0, `all ${requests.length} requests went to ${origin}${elsewhere.length ? `; elsewhere: ${[...new Set(elsewhere)].join(', ')}` : ''}`);
});
