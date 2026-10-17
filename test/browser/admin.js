// The owner's dashboard (web/admin.html) on the emulators: sign-in, the live bookings list, status
// changes and their emails, requests, closed days and the outbox. Run by `npm run test:browser`
// after web.js. Empties the Firestore EMULATOR and loads the demo data (scripts/seed-demo.js).
import { spawnSync } from 'node:child_process';
import { check, evaluate, open, run, shot, sleep, waitFor } from './cdp.js';
import * as R from '../../shared/booking-rules.js';

const SITE = 'http://127.0.0.1:5000/';
const PROJECT = 'my-first-firebase-projec-b242f';
const tab = (name) => evaluate(`[...document.querySelectorAll('#tabs button')].find((b)=>b.textContent.startsWith('${name}')).click()`);
const card = (ref) => `document.querySelector('.booking[data-ref="${ref}"]')`;
const buttonIn = (ref, label) => `[...${card(ref)}.querySelectorAll('button')].find((b)=>b.textContent.startsWith('${label}'))`;

run(9336, async () => {
  const wipe = await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (wipe.status !== 200) throw new Error('could not empty the Firestore emulator: are the emulators running?');
  const seeded = spawnSync('node', ['scripts/seed-demo.js', PROJECT], { encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

  // Signed out: the sign-in form, with the demo login offered.
  await open(`${SITE}admin.html`);
  await waitFor("!document.getElementById('gate').hidden", 'the sign-in form');
  check(await evaluate("document.getElementById('app').hidden"), 'signed out, the dashboard stays hidden');
  await evaluate("document.getElementById('email').value='owner@demo.dk';document.getElementById('pw').value='wrong-password';document.querySelector('#signin button[type=submit]').click()");
  await waitFor("document.getElementById('e-signin').textContent", 'the sign-in error');
  check(await evaluate("document.getElementById('e-signin').textContent") === 'Wrong email or password.', 'a wrong password is refused');
  await evaluate("[...document.querySelectorAll('#demo-login button')][0].click(); document.querySelector('#signin button[type=submit]').click()");
  await waitFor("!document.getElementById('app').hidden && document.querySelectorAll('.booking').length === 3", 'the dashboard with the demo bookings', 20000);
  check(true, 'the demo owner signs in and sees the 3 demo bookings, live from the database');
  check(await evaluate("document.querySelector('#tabs button .count')?.textContent") === '2', 'the Bookings tab counts the 2 waiting for confirmation');
  check((await evaluate(`${card('TN-1041')}.textContent`)).includes('Fuglebakkevej 12, 3. th., 2000 Frederiksberg'), 'addresses show floor and door the Danish way');
  await shot('admin-bookings.png', 1100);

  // Confirm TN-1042: the status changes, and the customer's email is queued by the Function.
  await evaluate(`${buttonIn('TN-1042', 'Confirm')}.click()`);
  await waitFor(`${card('TN-1042')}.querySelector('.tag').textContent === 'Confirmed'`, 'the confirmed status');
  check(true, 'Confirm marks TN-1042 confirmed');
  check(await evaluate("document.querySelector('#tabs button .count')?.textContent") === '1', 'the waiting count drops to 1');
  // Cancelling needs a second click.
  await evaluate(`${buttonIn('TN-1043', 'Cancel booking')}.click()`);
  check((await evaluate(`${buttonIn('TN-1043', 'Click again')}?.textContent || ''`)).includes('Sara Nielsen'), 'Cancel asks for a second click first');
  await evaluate(`${buttonIn('TN-1043', 'Click again')}.click()`);
  await waitFor(`!${card('TN-1043')}`, 'the cancelled booking to leave the upcoming list');
  check(true, 'the second click cancels TN-1043, which leaves the upcoming list');

  // Outbox: both emails queued.
  await tab('Outbox');
  await waitFor("[...document.querySelectorAll('#view summary')].some((s)=>s.textContent.includes('TN-1043 has been cancelled'))", 'the emails', 15000);
  const subjects = await evaluate("[...document.querySelectorAll('#view summary')].map((s)=>s.textContent)");
  check(subjects.some((s) => s === 'Your booking TN-1042 is confirmed → mikkel@example.com'), 'the outbox shows the confirmation email to Mikkel');
  check(subjects.some((s) => s.startsWith('Your booking TN-1043 has been cancelled')), 'and the cancellation email to Sara');

  // Requests.
  await tab('Requests');
  check((await evaluate("document.getElementById('view').textContent")).includes('Hostel Nørrebro'), 'the business request is listed');
  await evaluate("(()=>{const s=document.querySelector('#view select');s.value='contacted';s.dispatchEvent(new Event('change'))})()");
  await waitFor("document.querySelector('#view .tag')?.textContent === 'Contacted'", 'the new request status');
  check(true, 'its status can be moved to Contacted');

  // Closed days: close one with the calendar; the public booking calendar then greys it out.
  await tab('Closed days');
  const day = R.nextOpenDay(R.addDays(R.today(), 12));
  await evaluate("document.getElementById('closed-date-btn').click()");
  if (!await evaluate(`!!document.querySelector('#closed-date-cal [data-date="${day}"]')`)) await evaluate("document.querySelector('#closed-date-cal .cal-nav.next').click()");
  await evaluate(`document.querySelector('#closed-date-cal [data-date="${day}"]').click()`);
  await evaluate("(()=>{const r=document.querySelector('#view input[data-keep]');r.value='Bike fair';document.querySelector('#view form button[type=submit]').click()})()");
  await waitFor(`document.getElementById('view').textContent.includes('Bike fair')`, 'the closed day in the list');
  check(true, `a day (${day}) is closed with the calendar and a reason`);
  await shot('admin-closed.png', 900);
  await open(`${SITE}index.html`);
  await waitFor('!!document.getElementById("date").min', 'the public booking form');
  await sleep(500);
  await evaluate("document.getElementById('date-btn').click()");
  if (!await evaluate(`!!document.querySelector('#date-cal [data-date="${day}"]')`)) await evaluate("document.querySelector('#date-cal .cal-nav.next').click()");
  check(await evaluate(`document.querySelector('#date-cal [data-date="${day}"]').disabled`), 'customers can no longer pick that day');

  // Signing out hides everything again.
  await open(`${SITE}admin.html`);
  await waitFor("!document.getElementById('app').hidden", 'the dashboard');
  await evaluate("document.getElementById('out').click()");
  await waitFor("document.getElementById('app').hidden && !document.getElementById('gate').hidden", 'the sign-in form again');
  check(true, 'signing out hides the dashboard');
});
