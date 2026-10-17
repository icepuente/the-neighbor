// The owner's dashboard (web/admin.html) on the emulators: sign-in, the live bookings list, status
// changes and their emails, requests, closed days and the outbox. Run by `npm run test:browser`
// after web.js. Empties the Firestore EMULATOR and loads the demo data (scripts/seed-demo.js).
import { spawnSync } from 'node:child_process';
import { check, evaluate, open, run, setFile, shot, sleep, waitFor } from './cdp.js';
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

  // Calendar view: bookings on their days, status shown by colour, outline and symbol; clicking one
  // opens the same card with the same actions.
  await evaluate("document.querySelector('.view-switch [data-mode=calendar]').click()");
  await waitFor("!!document.querySelector('.bcal')", 'the calendar view');
  const chip = (ref) => `document.querySelector('.bchip[data-ref="${ref}"]')`;
  // The seeded bookings are 3-6 days ahead: possibly next month.
  if (!await evaluate(`!!${chip('TN-1042')}`)) await evaluate("document.querySelector('.bcal-head .cal-nav[aria-label=\"Next month\"]').click()");
  await waitFor(`!!${chip('TN-1042')}`, 'the TN-1042 chip');
  const look = (ref) => evaluate(`(()=>{const c=${chip(ref)};const s=getComputedStyle(c);return {cls:c.className,mark:c.querySelector('.mark').textContent,border:s.borderTopStyle,bg:s.backgroundColor,label:c.getAttribute('aria-label')}})()`);
  const pend = await look('TN-1042');
  const conf = await look('TN-1041');
  check(pend.cls.includes('pending') && pend.mark === '?' && pend.border === 'dashed' && pend.label.includes('waiting for confirmation'),
    `a pending booking is a dashed chip marked "?" ("${pend.label}")`);
  check(conf.cls.includes('confirmed') && conf.mark === '✓' && conf.border === 'solid' && conf.bg !== pend.bg,
    `a confirmed booking is a solid chip of another colour, marked "✓" ("${conf.label}")`);
  await shot('admin-calendar.png', 1000);
  await evaluate(`${chip('TN-1041')}.click()`);
  await waitFor("!!document.querySelector('#bcal-detail .booking[data-ref=\"TN-1041\"]')", 'the card for TN-1041');
  const actions = await evaluate("[...document.querySelectorAll('#bcal-detail .booking button')].map((b)=>b.textContent)");
  check(actions.includes('Mark completed') && actions.includes('Cancel booking'), `clicking it opens its card with the same actions (${actions.join(', ')})`);
  await evaluate("[...document.querySelectorAll('#bcal-detail .booking button')].find((b)=>b.textContent==='Mark completed').click()");
  await waitFor(`${chip('TN-1041')}.classList.contains('completed')`, 'the chip to turn completed');
  check(await evaluate("document.querySelector('#bcal-detail .tag').textContent") === 'Completed', 'acting from the calendar works: TN-1041 is completed, chip and card update live');
  await evaluate("document.querySelector('.view-switch [data-mode=list]').click()");
  await waitFor("!document.querySelector('.bcal') && !!document.querySelector('.booking[data-ref=\"TN-1042\"]')", 'the list again');

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

  // Booking tools on TN-1042: private note, reschedule, message.
  const toolOf = (ref, key) => `${card(ref)}.querySelector('details.tool[data-key^="${key}-"]')`;
  await evaluate(`${toolOf('TN-1042', 'note')}.open = true`);
  await evaluate(`(()=>{const t=${toolOf('TN-1042', 'note')}.querySelector('textarea');t.value='Gate code 1234';t.dispatchEvent(new Event('input',{bubbles:true}));[...${toolOf('TN-1042', 'note')}.querySelectorAll('button')][0].click()})()`);
  await waitFor(`${toolOf('TN-1042', 'note')}.querySelector('summary').textContent.includes('✎')`, 'the saved note');
  check(await evaluate(`${toolOf('TN-1042', 'note')}.querySelector('textarea').value`) === 'Gate code 1234', 'a private note is saved on the booking (and marked ✎)');

  const newDay = R.nextOpenDay(R.addDays(R.today(), 10));
  await evaluate(`${toolOf('TN-1042', 'resched')}.open = true`);
  await evaluate(`${toolOf('TN-1042', 'resched')}.querySelector('.datefield button').click()`);
  const reschedCal = `${toolOf('TN-1042', 'resched')}.querySelector('.cal')`;
  if (!await evaluate(`!!${reschedCal}.querySelector('[data-date="${newDay}"]')`)) await evaluate(`${reschedCal}.querySelector('.cal-nav.next').click()`);
  await evaluate(`${reschedCal}.querySelector('[data-date="${newDay}"]').click()`);
  await waitFor(`${toolOf('TN-1042', 'resched')}.querySelectorAll('.slotbtn').length > 0`, 'free times for the new day', 15000);
  await evaluate(`[...${toolOf('TN-1042', 'resched')}.querySelectorAll('.slotbtn')].find((t)=>t.textContent==='11:00').click()`);
  const moveLabel = await evaluate(`${toolOf('TN-1042', 'resched')}.querySelector('.pill').textContent`);
  check(moveLabel.includes('at 11:00 and email Mikkel Holm'), `picking a day and a free time offers the move ("${moveLabel}")`);
  await evaluate(`${toolOf('TN-1042', 'resched')}.querySelector('.pill').click()`);
  await waitFor(`${card('TN-1042')}.querySelector('h3').textContent.includes('11:00')`, 'the moved booking', 15000);
  check((await evaluate(`${card('TN-1042')}.querySelector('h3').textContent`)).includes(`${new Date(`${newDay}T12:00:00Z`).getUTCDate()}`), 'the booking moves to the new day and time');

  await evaluate(`${toolOf('TN-1042', 'msg')}.open = true`);
  await evaluate(`(()=>{const t=${toolOf('TN-1042', 'msg')}.querySelector('textarea');t.value='I will bring a new chain.';t.dispatchEvent(new Event('input',{bubbles:true}));${toolOf('TN-1042', 'msg')}.querySelector('button').click()})()`);
  await waitFor(`${toolOf('TN-1042', 'msg')}.textContent.includes('I will bring a new chain.') && !${toolOf('TN-1042', 'msg')}.querySelector('textarea').value`, 'the sent message', 15000);
  check((await evaluate(`${toolOf('TN-1042', 'msg')}.querySelector('summary').textContent`)) === 'Message the customer (1 sent)', 'a message is sent and kept with the booking');
  await shot('admin-tools.png', 1300);

  // CSV of the list: Danish Excel format.
  // Read the raw bytes: Blob.text() would silently drop the BOM.
  await evaluate("window.__csv=null;const o=URL.createObjectURL.bind(URL);URL.createObjectURL=(b)=>{b.arrayBuffer().then((a)=>{window.__csv=new TextDecoder('utf-8',{ignoreBOM:true}).decode(a)});return o(b)}");
  await evaluate("document.querySelector('.toolbar .csv').click()");
  await waitFor('window.__csv !== null', 'the CSV');
  const csv = await evaluate('window.__csv');
  const lines = csv.replace(/^\ufeff/, '').trim().split('\r\n');
  check(csv.startsWith('\ufeff') && lines[0].startsWith('"Ref";"Date";"Time";"Status"'), 'Download CSV gives a semicolon file with a BOM, for Danish Excel');
  check(lines.some((l) => l.includes('"TN-1042"') && l.includes('"Gate code 1234"') && l.includes('"11:00"')), 'with the bookings shown, including the private note and the new time');

  // Log the visit on TN-1042: work, a part, a photo and a recommendation.
  await evaluate(`${toolOf('TN-1042', 'visit')}.open = true`);
  const vid = await evaluate(`${toolOf('TN-1042', 'visit')}.querySelector('textarea').id.replace('v-work-', '')`);
  const setVal = (id, v) => evaluate(`(()=>{const e=document.getElementById('${id}-${vid}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await evaluate(`[...${toolOf('TN-1042', 'visit')}.querySelectorAll('button')].find((b)=>b.textContent.startsWith('Save and email')).click()`);
  await waitFor(`${toolOf('TN-1042', 'visit')}.querySelector(':scope > .err')?.textContent.includes('at least one line')`, 'the missing-work message');
  check(true, 'saving without any work done is refused');
  await setVal('v-work', 'Punctured inner tube replaced\nChain cleaned and lubricated');
  await setVal('v-parts', 'Inner tube 700×25c; 59');
  await setVal('v-notes', 'Tyres are in good shape.');
  await setVal('v-rtitle', 'Replace the chain');
  await setVal('v-rreason', 'Stretched to 0.6%');
  await setFile(`#visit-photos-${vid}`);
  await waitFor(`${toolOf('TN-1042', 'visit')}.querySelectorAll('figure img').length === 1`, 'the visit photo');
  await shot('admin-visit.png', 1300);
  await evaluate(`[...${toolOf('TN-1042', 'visit')}.querySelectorAll('button')].find((b)=>b.textContent.startsWith('Save and email')).click()`);
  await waitFor(`${card('TN-1042')}.querySelector('.tag').textContent === 'Completed'`, 'the logged visit', 20000);
  check((await evaluate(`${card('TN-1042')}.textContent`)).includes('Visit logged'), 'logging the visit completes TN-1042 and says the customer has the record');

  // Outbox: both emails queued.
  await tab('Outbox');
  await waitFor("[...document.querySelectorAll('#view summary')].some((s)=>s.textContent.includes('TN-1043 has been cancelled'))", 'the emails', 15000);
  const subjects = await evaluate("[...document.querySelectorAll('#view summary')].map((s)=>s.textContent)");
  check(subjects.some((s) => s === 'Your booking TN-1042 is confirmed → mikkel@example.com'), 'the outbox shows the confirmation email to Mikkel');
  check(subjects.some((s) => s.startsWith('Your booking TN-1043 has been cancelled')), 'and the cancellation email to Sara');
  check(subjects.some((s) => s.startsWith('Your booking TN-1042 has a new time')) && subjects.some((s) => s.startsWith('About your booking TN-1042')),
    'and the new-time email and the message to Mikkel');
  check(subjects.includes('Your bike service is done (TN-1042) → mikkel@example.com') && !subjects.some((s) => s.startsWith('Your booking TN-1042 is complete')),
    'and the service summary for the logged visit (not a second "complete" email)');

  // Customers: Anna's account, her bikes and recommendations; mark one done.
  await tab('Customers');
  await waitFor("!!document.querySelector('.customer[data-email=\"anna@demo.dk\"]')", 'the customers');
  const anna = "document.querySelector('.customer[data-email=\"anna@demo.dk\"]')";
  check((await evaluate(`${anna}.textContent`)).includes('Open recommendations2'), 'Anna is listed, with her 2 open recommendations');
  await evaluate(`${anna}.querySelector('details').open = true`);
  await waitFor(`${anna}.querySelector('details').textContent.includes('Trek FX 3')`, 'her bikes');
  check((await evaluate(`${anna}.querySelector('details').textContent`)).includes('Pelago Brinkeby'), 'opening her shows her saved bikes and recommendations');
  await evaluate(`[...${anna}.querySelectorAll('.rec')].find((r)=>r.textContent.includes('fælgbremse')).querySelector('button').click()`);
  await waitFor(`${anna}.textContent.includes('Open recommendations1')`, 'one recommendation done');
  check(true, 'Mark done closes a recommendation');

  // Requests.
  await tab('Requests');
  check((await evaluate("document.getElementById('view').textContent")).includes('Hostel Nørrebro'), 'the business request is listed');
  await evaluate("(()=>{const s=document.querySelector('#view select');s.value='contacted';s.dispatchEvent(new Event('change'))})()");
  await waitFor("document.querySelector('#view .tag')?.textContent === 'Contacted'", 'the new request status');
  check(true, 'its status can be moved to Contacted');
  // Archive: out of the active list, kept under Archived, and restorable.
  const reqButton = (label) => `[...document.querySelectorAll('#view .paper button')].find((b)=>b.textContent==='${label}')`;
  await evaluate(`${reqButton('Archive')}.click()`);
  await waitFor("!document.getElementById('view').textContent.includes('Hostel Nørrebro')", 'the request to leave the active list');
  check(await evaluate("document.querySelector('[data-shelf=archived]').textContent") === 'Archived (1)', 'Archive moves it out of the active list (Archived: 1)');
  await evaluate("document.querySelector('[data-shelf=archived]').click()");
  check((await evaluate("document.getElementById('view').textContent")).includes('Hostel Nørrebro') && await evaluate(`!!${reqButton('Restore')}`), 'it is kept under Archived, with Restore');
  await shot('admin-archived.png', 800);
  await evaluate(`${reqButton('Restore')}.click()`);
  await waitFor("document.querySelector('[data-shelf=archived]').textContent === 'Archived (0)'", 'the restored request');
  await evaluate("document.querySelector('[data-shelf=active]').click()");
  check((await evaluate("document.getElementById('view').textContent")).includes('Hostel Nørrebro'), 'Restore brings it back to the active list');

  // A business account from the request: two clicks, then the company opens under Companies.
  const hostel = "[...document.querySelectorAll('#view .paper')].find((p)=>p.dataset.company==='Hostel Nørrebro')";
  const createBtn = `[...${hostel}.querySelectorAll('button')].find((b)=>b.textContent.startsWith('Create business')||b.textContent.startsWith('Click again'))`;
  await evaluate(`${createBtn}.click()`);
  check((await evaluate(`${createBtn}.textContent`)).startsWith('Click again to create it and email sofie@example.com'), 'creating a business account asks for a second click');
  await evaluate(`${createBtn}.click()`);
  await waitFor("document.querySelector('#tabs [aria-current]')?.textContent.startsWith('Companies') && document.getElementById('view').textContent.includes('Hostel Nørrebro is set up')", 'the new company', 20000);
  check(true, 'the second click creates Hostel Nørrebro and opens it under Companies');
  check((await evaluate("document.querySelector('.company').textContent")).includes('Sofie Berg'), 'with the contact from the request');

  // Its first bike, with a photo.
  await evaluate("[...document.querySelectorAll('#view .fleet button')].find((b)=>b.textContent==='Add a bike').click()");
  await waitFor("!!document.getElementById('fb-number')", 'the bike form');
  await evaluate("document.querySelector('#fleet-form button[type=submit]').click()");
  await waitFor("document.querySelector('#fleet-form > .err')?.textContent.includes('number')", 'the missing number');
  check(true, 'a fleet bike needs a number');
  for (const [id, val] of [['fb-number', '#001'], ['fb-type', 'City bike'], ['fb-location', 'Bike shed']]) {
    await evaluate(`(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(val)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  }
  await setFile('#fleet-photos');
  await waitFor("document.querySelectorAll('#fleet-form figure img').length === 1", 'the fleet photo');
  await evaluate("document.querySelector('#fleet-form button[type=submit]').click()");
  await waitFor("!document.getElementById('fleet-form') && !!document.querySelector('.fleet tr[data-bike=\"#001\"]')", 'the saved bike', 20000);
  check(await evaluate("document.querySelector('.fleet tr[data-bike=\"#001\"]').cells[3].textContent") === '1', 'the bike is added to the fleet, with its photo uploaded');

  // The month's report: one row per bike; save and email the contact.
  await waitFor("document.querySelectorAll('.fleet-report tbody tr').length === 1", 'the report row');
  await evaluate("(()=>{const s=document.querySelector('.fleet-report .rep-status');s.value='attention';s.dispatchEvent(new Event('input',{bubbles:true}))})()");
  await evaluate("(()=>{const e=document.querySelector('.fleet-report .rep-action');e.value='Chain replaced soon';e.dispatchEvent(new Event('input',{bubbles:true}))})()");
  await evaluate("[...document.querySelectorAll('.fleet-report button')].find((b)=>b.textContent.startsWith('Save report')).click()");
  await waitFor("document.querySelector('.fleet-report .ok')?.textContent.startsWith('Saved.')", 'the saved report', 20000);
  check((await evaluate("document.querySelector('.fleet-report .ok').textContent")).includes('0 ready, 1 attention, 0 repair'), 'the fleet report is saved, with the counts');
  await shot('admin-companies.png', 1400);

  // Hotel ABC (demo data): six bikes and the reports so far.
  await evaluate("(()=>{const s=document.getElementById('company-select');s.value='hotel-abc';s.dispatchEvent(new Event('change'))})()");
  await waitFor("document.querySelectorAll('.fleet tbody tr').length === 6", 'Hotel ABC\'s fleet', 15000);
  check((await evaluate("document.querySelector('.fleet-report .meta').textContent")).startsWith('New report, starting from'), 'Hotel ABC: six bikes, and a new month starts from the last report');
  const outbox = async () => { await tab('Outbox'); await sleep(300); return evaluate("[...document.querySelectorAll('#view summary')].map((s)=>s.textContent)"); };
  const mails = await outbox();
  check(mails.includes('Your business account at The Neighbor → sofie@example.com') && mails.some((s) => s.startsWith('Fleet report ready:') && s.endsWith('sofie@example.com')),
    'the Outbox has the invite and the report email to Sofie');

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
