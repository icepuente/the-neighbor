// Customer accounts in the browser (web/account.html) on the emulators: sign up, confirm the email
// (demo button), an earlier guest booking joins, cancel online, edit details, log out, log in as
// the demo customer, and the booking form fills itself in. Run by `npm run test:browser` after
// admin.js (which loads the demo data).
import { check, evaluate, open, run, shot, waitFor } from './cdp.js';
import * as R from '../../shared/booking-rules.js';

const SITE = 'http://127.0.0.1:5000/';
const PROJECT = 'my-first-firebase-projec-b242f';
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west1`;
const fill = (id, v) => evaluate(`(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const tab = (i) => evaluate(`document.querySelectorAll('#tabs button')[${i}].click()`);
const text = (id) => evaluate(`document.getElementById('${id}').textContent`);

run(9337, async () => {
  // A guest booking first, with the email the account will use.
  const email = `new-${Date.now()}@example.com`;
  // Well after the demo data's closed day and the other tests' bookings.
  const day = R.nextOpenDay(R.addDays(R.today(), 21));
  const g = await (await fetch(`${FN}/createBooking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {
    input: { serviceIds: ['chain'], date: day, arrival: '14:30', bike: 'City bike', address: 'Jagtvej 1, 2200 København N', name: 'Lene Holm', phone: '12345678', email },
    accept: { terms: true, earlyStart: true },
  } }) })).json();
  if (!g.result?.booking) throw new Error(`the guest booking was refused: ${JSON.stringify(g.result?.errors || g.error)}`);
  const ref = g.result.booking.ref;

  // Signed out: the log-in form, in Danish.
  await open(`${SITE}account.html`);
  await evaluate('localStorage.clear()');
  await open(`${SITE}account.html`);
  await waitFor("!document.getElementById('login').hidden", 'the log-in form');
  check(await text('lt') === 'Velkommen tilbage', 'signed out, the account page offers log-in, in Danish');
  await fill('le', 'anna@demo.dk');
  await fill('lp', 'wrong-password');
  await evaluate("document.querySelector('#lf button[type=submit]').click()");
  await waitFor("document.getElementById('e-l').textContent", 'the error');
  check(await text('e-l') === 'Forkert e-mail eller adgangskode.', 'a wrong password is refused');

  // Create an account.
  await evaluate("document.getElementById('m2').click()");
  await fill('sn', 'Lene Holm');
  await fill('se', email);
  await fill('sp', '12345678');
  await fill('sw', 'short');
  await evaluate("document.querySelector('#sf button[type=submit]').click()");
  check(await text('e-s') === 'Vælg en adgangskode på mindst 8 tegn.', 'a short password is refused');
  await fill('sw', 'lene-password');
  await evaluate("document.querySelector('#sf button[type=submit]').click()");
  await waitFor("!document.getElementById('app').hidden && document.getElementById('hi').textContent === 'Hej, Lene'", 'the new account', 20000);
  check(true, 'the account is created and opens: "Hej, Lene"');
  check(await evaluate("!document.getElementById('verify').hidden"), 'it asks to confirm the email first');
  await tab(1);
  check(await evaluate("!document.querySelector('.my-booking')"), 'the guest booking is not shown before the email is confirmed');

  // Confirm (demo button): the guest booking joins.
  await evaluate("document.getElementById('verify-demo').click()");
  await waitFor("document.getElementById('verify').hidden", 'the confirmation', 15000);
  check((await text('hs')).includes('1 tidligere booking'), `after confirming, the earlier booking joins ("${await text('hs')}")`);
  await waitFor(`!!document.querySelector('.my-booking[data-ref="${ref}"]')`, 'the linked booking');
  check(true, `${ref} is listed under Bookinger`);
  check(await evaluate("document.querySelector('#tabs button .count')?.textContent") === '1', 'the tab counts 1 upcoming visit');
  await shot('account-bookings.png', 900);

  // Cancel online: two clicks.
  const cancelBtn = `[...document.querySelector('.my-booking[data-ref="${ref}"]').querySelectorAll('button')].find((b)=>b.textContent.startsWith('Aflys')||b.textContent.startsWith('Klik'))`;
  await evaluate(`${cancelBtn}.click()`);
  check(await evaluate(`${cancelBtn}.textContent`) === 'Klik igen for at aflyse', 'cancelling asks for a second click');
  await evaluate(`${cancelBtn}.click()`);
  await waitFor(`document.querySelector('.my-booking[data-ref="${ref}"] .tag')?.textContent === 'Aflyst'`, 'the cancelled booking', 15000);
  check(true, 'the booking is cancelled and moves to "Tidligere og aflyste"');

  // Edit details.
  await tab(2);
  await waitFor("!!document.getElementById('pf-name')", 'the details form');
  check(await evaluate("document.getElementById('pf-name').value") === 'Lene Holm', 'the details form shows the profile');
  await fill('pf-addr', 'Jagtvej 10, 2200 København N');
  await fill('pf-apt', '2. tv.');
  await evaluate("document.querySelector('form.profile button[type=submit]').click()");
  await waitFor("document.querySelector('form.profile .ok')?.textContent === 'Gemt.'", 'the saved details');
  check(true, 'address and floor/door are saved');

  // Log out; log in as the demo customer.
  await evaluate("document.getElementById('out').click()");
  await waitFor("!document.getElementById('login').hidden", 'the log-in form again');
  await evaluate("document.querySelector('#demo-login button').click(); document.querySelector('#lf button[type=submit]').click()");
  await waitFor("document.getElementById('hi').textContent === 'Hej, Anna' && document.querySelectorAll('.tabs button').length === 3", 'Anna\'s account', 20000);
  check(true, 'the demo customer logs in: "Hej, Anna"');
  await tab(1);
  await waitFor("document.querySelectorAll('.my-booking').length === 2", "Anna's bookings");
  check((await evaluate("document.getElementById('view').textContent")).includes('Fuglebakkevej 12, 3. th., 2000 Frederiksberg'), 'her upcoming and earlier bookings, with floor and door');

  // The booking form knows her.
  await open(`${SITE}index.html`);
  await waitFor("!document.getElementById('signed-in').hidden", 'the signed-in note', 15000);
  check(await evaluate("document.getElementById('name').value") === 'Anna Jensen' && await evaluate("document.getElementById('addr2').value") === '3. th.', 'signed in, the booking form fills in her details');
  check(await evaluate("document.getElementById('acct-link').textContent") === 'Min konto' && await evaluate("document.getElementById('opts').hidden"), 'the header says "Min konto", and "Husk mig" is not needed');
});
