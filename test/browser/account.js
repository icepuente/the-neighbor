// Customer accounts in the browser (web/account.html) on the emulators: sign up, confirm the email
// (demo button), an earlier guest booking joins, cancel online, edit details, log out, log in as
// the demo customer, and the booking form fills itself in. Run by `npm run test:browser` after
// admin.js (which loads the demo data).
import { check, evaluate, open, run, setFile, shot, shotEl, waitFor } from './cdp.js';
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
  await tab(5);
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
  await waitFor("document.getElementById('hi').textContent === 'Hej, Anna' && document.querySelectorAll('.tabs button').length === 6", 'Anna\'s account', 20000);
  check(true, 'the demo customer logs in: "Hej, Anna"');
  await tab(1);
  await waitFor("document.querySelectorAll('.my-booking').length === 2", "Anna's bookings");
  check((await evaluate("document.getElementById('view').textContent")).includes('Fuglebakkevej 12, 3. th., 2000 Frederiksberg'), 'her upcoming and earlier bookings, with floor and door');

  // Historik: the visit the owner logged; Anbefalinger: the one still open (the owner marked the
  // other done in the dashboard test).
  await tab(2);
  await waitFor("!!document.querySelector('details.record')", 'her service history');
  const hist = await evaluate("document.querySelector('details.record').textContent");
  check(hist.includes('Punkteret bagslange skiftet') && hist.includes('212 kr.'), 'Historik shows the logged visit: work done and the total');
  await shotEl('account-history.png', '#view');
  await tab(4);
  await waitFor("document.querySelectorAll('.rec').length > 0", 'her recommendations');
  check(await evaluate("[...document.querySelectorAll('.rec h3')].map((h)=>h.textContent).join(' | ')") === 'Skift bagdækket', 'Anbefalinger shows the open recommendation, not the one marked done');
  check(await evaluate("document.querySelector('.rec a.pill').getAttribute('href')") === 'index.html#book', 'with a link to book it');

  // Mine cykler: her two saved bikes; add a photo to the Trek; add and delete a bike.
  const bikeCard = (name) => `document.querySelector('.bike-card[data-bike="${name}"]')`;
  const bikeBtn = (name, label) => `[...${bikeCard(name)}.querySelectorAll('button')].find((b)=>b.textContent.startsWith('${label}'))`;
  await tab(3);
  await waitFor("document.querySelectorAll('.bike-card').length === 2", 'her saved bikes');
  check(await evaluate("[...document.querySelectorAll('.bike-card h3')].map((h)=>h.textContent).join(' | ')") === 'Pelago Brinkeby | Trek FX 3', 'Mine cykler lists her two bikes');
  await evaluate(`${bikeBtn('Trek FX 3', 'Rediger')}.click()`);
  await waitFor("document.getElementById('nb-name')?.value === 'Trek FX 3'", 'the edit form');
  check(true, 'Rediger opens the form with the bike\'s details');
  await setFile('#nb-photos');
  await waitFor("document.querySelectorAll('#bike-form figure img').length === 1", 'the added photo');
  await evaluate("document.querySelector('#bike-form button[type=submit]').click()");
  await waitFor(`!document.getElementById('bike-form') && ${bikeCard('Trek FX 3')}?.querySelector('.cover img')?.naturalWidth > 0`, 'the cover photo', 20000);
  check(true, 'a photo is uploaded and shown as the Trek\'s cover, read back from Storage');
  await shotEl('account-bikes.png', '#view');
  await evaluate("[...document.querySelectorAll('#view > button')].find((b)=>b.textContent==='Tilføj en cykel').click()");
  await waitFor("!!document.getElementById('nb-name')", 'the add form');
  await evaluate("document.querySelector('#bike-form button[type=submit]').click()");
  check((await evaluate("document.querySelector('#bike-form > .err').textContent")).length > 0, 'a bike without a name is refused');
  await fill('nb-name', 'Christiania Light');
  await fill('nb-type', 'Ladcykel');
  await evaluate("document.querySelector('#bike-form button[type=submit]').click()");
  await waitFor(`!!${bikeCard('Christiania Light')}`, 'the new bike', 15000);
  check(true, 'a new bike is added');
  await evaluate(`${bikeBtn('Christiania Light', 'Slet')}.click()`);
  check(await evaluate(`${bikeBtn('Christiania Light', 'Klik')}?.textContent`) === 'Klik igen for at slette', 'deleting asks for a second click');
  await evaluate(`${bikeBtn('Christiania Light', 'Klik')}.click()`);
  await waitFor(`!${bikeCard('Christiania Light')}`, 'the deleted bike', 15000);
  // The card goes at once (the page shows the change before the server confirms it); wait for
  // the server before leaving the page, as a visitor's browser would finish the write.
  await evaluate('NBF.sdk.firestore.waitForPendingWrites(NBF.db)');
  check(true, 'and the second click deletes it');

  // The booking form knows her.
  await open(`${SITE}index.html`);
  await waitFor("!document.getElementById('signed-in').hidden", 'the signed-in note', 15000);
  check(await evaluate("document.getElementById('name').value") === 'Anna Jensen' && await evaluate("document.getElementById('addr2').value") === '3. th.', 'signed in, the booking form fills in her details');
  check(await evaluate("document.getElementById('acct-link').textContent") === 'Min konto' && await evaluate("document.getElementById('opts').hidden"), 'the header says "Min konto", and "Husk mig" is not needed');
  await waitFor("!!document.querySelector('#bike option[data-bike-id]')", 'her saved bikes in the bike list', 15000);
  const bikeList = await evaluate("[...document.querySelectorAll('#bike option')].map((o)=>o.textContent).join(' | ')");
  check(bikeList.startsWith('Pelago Brinkeby | Trek FX 3 | '), `her saved bikes come first in the bike list (${bikeList})`);
  check(await evaluate("!document.getElementById('pics-to-bike').hidden"), 'with a saved bike chosen, the form says photos are kept on it too');
  await evaluate("(()=>{const s=document.getElementById('bike');s.value='By / pendler';s.dispatchEvent(new Event('change'))})()");
  check(await evaluate("document.getElementById('pics-to-bike').hidden"), 'not with a general bike type');

  // "Opret en konto" while booking: signed out, a new customer books and gets an account with it.
  await evaluate('NBF.auth.signOut()');
  await open(`${SITE}index.html`);
  await waitFor("!!window.NBF && !document.getElementById('opts').hidden", 'the signed-out form');
  const newEmail = `booker-${Date.now()}@example.com`;
  await evaluate("document.querySelector('input[name=svc][value=\"brakes\"]').click()");
  await evaluate(`(()=>{const e=document.getElementById('date');e.value='${day}';e.dispatchEvent(new Event('change'))})()`);
  await waitFor("!!document.querySelector('#slots input[value=\"09:00\"]:not(:disabled)')", 'free times');
  await evaluate("document.querySelector('#slots input[value=\"09:00\"]').click()");
  for (const [id, v] of [['addr', 'Jagtvej 1, 2200 København N'], ['name', 'Ole Berg'], ['tel', '88776655'], ['email', newEmail]]) await fill(id, v);
  await evaluate("document.getElementById('mkacct').click()");
  check(await evaluate("!document.getElementById('pw-row').hidden"), 'ticking "Opret en konto" asks for a password');
  await fill('pw', 'kort');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  check(await text('e-form') === 'Vælg en adgangskode på mindst 8 tegn.', 'a short password is refused before the price page');
  await fill('pw', 'ole-password');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the price page');
  await evaluate("document.getElementById('acc-terms').click(); document.getElementById('acc-start').click(); document.getElementById('confirm').click()");
  await waitFor("!document.getElementById('done').hidden", 'the confirmation', 30000);
  check((await text('done-msg')).includes('Din konto er oprettet'), `the booking is made and the account created ("${(await text('done-msg')).slice(0, 80)}…")`);
  check(await evaluate("document.querySelector('#done-acct a').getAttribute('href')") === 'account.html', 'the confirmation links to the account');
  await evaluate("document.querySelector('#done-acct a').click()");
  await waitFor("document.getElementById('hi').textContent === 'Hej, Ole'", 'the new account page', 20000);
  await tab(1);
  await waitFor("document.querySelectorAll('.my-booking').length === 1", 'the booking in the new account', 15000);
  check(true, 'the new account already holds the booking, without waiting for email verification');

  // A business customer: Hotel ABC (demo data) sees its monthly reports, fleet and plan.
  await evaluate("document.getElementById('out').click()");
  await waitFor("!document.getElementById('login').hidden", 'the log-in form');
  await evaluate("document.getElementById('demo-business').click(); document.querySelector('#lf button[type=submit]').click()");
  await waitFor("document.getElementById('hi').textContent === 'Hotel ABC'", 'the business account', 20000);
  check(await evaluate("[...document.querySelectorAll('#tabs button')].map((b)=>b.textContent).join(' | ')") === 'Månedsrapport | Flådeoversigt | Aftale og besøg',
    'a business contact gets Månedsrapport, Flådeoversigt and Aftale og besøg');
  check((await text('hs')).startsWith('Standard-aftale · 300 kr. / cykel / md. · 6 cykler'), `the header shows the plan (${await text('hs')})`);
  await waitFor("document.querySelectorAll('#mo option').length === 2 && document.querySelectorAll('table.rep tbody tr').length === 6", 'the latest report');
  check(await evaluate("[...document.querySelectorAll('.stats .stat')].map((s)=>s.textContent).join(' | ')") === '4 af 6 | 1 | 1', 'the latest report: 4 of 6 ready, 1 needs attention, 1 repair');
  await evaluate("document.querySelector('tr[data-bike=\"#002\"] button').click()");
  await waitFor("!!document.querySelector('.bike-detail')", 'the bike details');
  check((await evaluate("document.querySelector('.bike-detail').textContent")).includes('Fælgen er bøjet'), 'selecting a bike shows the mechanic\'s note');
  await shotEl('account-report.png', '#view');
  await evaluate("(()=>{const s=document.getElementById('mo');s.value=s.options[1].value;s.dispatchEvent(new Event('change'))})()");
  await waitFor("document.querySelector('.stats .stat')?.textContent === '5 af 6'", 'the earlier month');
  check(true, 'the month picker shows the earlier report (5 of 6 ready)');
  check(await evaluate("!!document.querySelector('.toolbar button.print')"), 'with a Print / save as PDF button');
  await tab(1);
  await waitFor("document.querySelectorAll('.fleet-bike').length === 6", 'the fleet');
  check(await evaluate("[...document.querySelectorAll('#view > h3')].map((h)=>h.textContent).join(' | ')") === 'Reception | Gården', 'Flådeoversigt groups the six bikes by location');
  await tab(2);
  check((await evaluate("document.getElementById('view').textContent")).includes(await evaluate('I18N.dkk(1800)')), 'Aftale og besøg shows the monthly price for 6 bikes');

  // The company the owner created in the dashboard test: its contact logs in with the demo password.
  await evaluate("document.getElementById('out').click()");
  await waitFor("!document.getElementById('login').hidden", 'the log-in form');
  await fill('le', 'sofie@example.com');
  await fill('lp', 'neighbor-demo');
  await evaluate("document.querySelector('#lf button[type=submit]').click()");
  await waitFor("document.getElementById('hi').textContent === 'Hostel Nørrebro'", 'the new business account', 20000);
  await waitFor("document.querySelector('tr[data-bike=\"#001\"] .st')?.textContent === 'Opmærksomhed'", 'the report from the dashboard', 15000);
  check(true, 'the new company\'s contact signs in and sees the report the owner saved');
  await tab(1);
  await waitFor("document.querySelector('.fleet-bike .cover img')?.naturalWidth > 0", 'the fleet photo', 20000);
  check(true, 'and the fleet bike\'s photo, read from Storage');
});
