// The site in a real (headless) Chrome: booking a repair as a visitor would, through to the email
// that opens. Run with `npm run test:browser` (local, on scripts/serve.js) or `npm run test:live`
// (against https://book.icepuente.com/). It sends nothing: the mailto: link is checked, not opened.
import { check, evaluate, open, requests, run, shot, shotEl, waitFor } from './cdp.js';
import * as R from '../../web/js/booking-rules.js';

const SITE = process.env.SITE || 'http://127.0.0.1:5000/';
const origin = new URL(SITE).origin;
const live = origin.startsWith('https:');
const TO = R.CONFIG.contact.email;

const fill = (id, v) => evaluate(`(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent || ''`);
const tick = (id) => evaluate(`document.querySelector('input[name=svc][value="${id}"]').click()`);
const dayBtn = (d) => `document.querySelector('#date-cal [data-date="${d}"]')`;
// Opens the calendar on the month of `date` and clicks that day.
async function pickDay(date) {
  await evaluate("document.getElementById('date-btn').click()");
  for (let i = 0; i < 3 && !await evaluate(`!!${dayBtn(date)}`); i++) await evaluate("document.querySelector('#date-cal .cal-nav.next').click()");
  await evaluate(`${dayBtn(date)}.click()`);
}
// Remembers whether the page let the send link open the mail program, and stops it doing so (the
// test sends nothing). Runs after the page's own click handler.
const catchSend = () => evaluate(`document.addEventListener('click', (e) => {
  if (!e.target.closest('#send')) return;
  window.__sent = e.defaultPrevented ? 'blocked' : 'sent';
  e.preventDefault();
})`);
const mailParts = async () => {
  const url = new URL(await evaluate("document.getElementById('send').href"));
  return { to: url.pathname, subject: url.searchParams.get('subject'), body: url.searchParams.get('body') };
};

run(9336, async () => {
  const TODAY = R.today();
  const D1 = R.nextOpenDay(R.addDays(TODAY, 3));
  let sunday = R.addDays(TODAY, 3);
  while (R.weekday(sunday) !== 0) sunday = R.addDays(sunday, 1);

  if (live) {
    const res = await fetch(SITE);
    const csp = res.headers.get('content-security-policy') || '';
    check(res.status === 200 && csp.includes("default-src 'self'") && csp.includes("script-src 'self'"), `${SITE} answers, with the Content-Security-Policy`);
    check((res.headers.get('x-robots-tag') || '').includes('noindex'), 'the demo asks search engines to stay away');
    const old = await fetch(new URL('account.html', SITE), { redirect: 'manual' });
    check(old.status === 301, `the old account page redirects to the front page (${old.status})`);
    const fn = await fetch(new URL('fn/bookingOptions', SITE), { method: 'POST', body: '{}' });
    check(fn.status === 403 || fn.status === 405, `the Firebase emulators are gone: POST /fn/... is refused (${fn.status})`);
  }

  // A first-time visitor, in Danish.
  await open(SITE);
  await evaluate('localStorage.clear()');
  await open(SITE);
  await waitFor("document.querySelectorAll('#svc-cards a').length > 0", 'the service cards');
  check(await evaluate("!document.getElementById('demo-bar').hidden") && (await text('#demo-bar')).includes(TO), `the demo bar says requests go to ${TO}`);
  check(await evaluate("document.querySelectorAll('#svc-cards a').length") === 5, 'five repair services');
  check((await text('#svc-cards a .price')) === '199 kr.', 'prices in Danish: 199 kr.');
  check(await evaluate("!document.getElementById('business') && !document.querySelector('a[href*=\"account\"], a[href*=\"admin\"]')"), 'no business section, no log-in, no dashboard');
  check(!(await evaluate('document.body.innerText')).match(/Care Plus|abonnement|Firebase|Opret en konto/i), 'no subscriptions or accounts mentioned');
  check((await text('footer')).includes(TO), 'the footer gives the booking address');
  await shot('front.png', 1600);

  // The puncture card starts a booking with the puncture fix chosen.
  await evaluate("document.querySelector('.choose a[data-pre=puncture]').click()");
  check(await evaluate("document.querySelector('input[name=svc][value=puncture]').checked") && (await text('#saccv')) === 'Punkteringsreparation', '"Jeg er punkteret" chooses the puncture fix');

  // The date: 2 days ahead at the earliest, never on a Sunday.
  check(await evaluate("document.getElementById('times').hidden"), 'no times before a date is chosen');
  await evaluate("document.getElementById('date-btn').click()");
  if (await evaluate(`!!${dayBtn(R.addDays(TODAY, 1))}`)) check(await evaluate(`${dayBtn(R.addDays(TODAY, 1))}.disabled`), 'tomorrow cannot be picked');
  for (let i = 0; i < 2 && !await evaluate(`!!${dayBtn(sunday)}`); i++) await evaluate("document.querySelector('#date-cal .cal-nav.next').click()");
  check(await evaluate(`${dayBtn(sunday)}.disabled && ${dayBtn(sunday)}.classList.contains('closed')`), 'Sundays cannot be picked');
  await evaluate("document.getElementById('date-btn').click()");
  await pickDay(D1);
  check(await evaluate("document.getElementById('date').value") === D1 && await evaluate("document.getElementById('date-cal').hidden"), `picking ${D1} closes the calendar`);
  const times = await evaluate("[...document.querySelectorAll('#slots input[name=slot]')].map((x) => x.value)");
  check(times[0] === '08:30' && times.at(-1) === '15:00' && times.length === 14, `a 20-minute puncture fix can start 08:30-15:00 (${times.length} times)`);
  check(await evaluate("[...document.querySelectorAll('#slots input')].every((x) => !x.disabled)"), 'every time can be asked for (the owner confirms)');

  // Too much for one visit.
  await tick('diagnostics');
  await tick('brakes');
  check((await text('#e-services')).includes('45'), 'more than 45 minutes is refused at once');
  await tick('diagnostics');
  await evaluate("document.querySelector('#slots input[value=\"14:30\"]').click()");

  // The form's checks.
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  check((await text('#e-form')) === 'Udfyld adresse, postnummer, navn og telefon.', 'address, postcode, name and phone are required');
  await fill('street', 'Jagtvej 10, 2. tv.');
  await fill('postcode', '4000');
  await fill('name', 'Test Testesen');
  await fill('tel', '12345678');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  check((await text('#e-form')).includes('18 km'), 'a postcode beyond 18 km is refused');
  await fill('postcode', '2200');
  await fill('note', 'Cyklen står i gården & bag porten?');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the price page');

  // The price: 199 + 129 for the repairs, 13 for travel from a 2200 postcode.
  check((await text('#tbl .tot')).includes('341 kr.'), `the total with travel: ${await text('#tbl .tot')}`);
  check((await text('#tbl')).includes('13 kr. (ca. 5 km, én vej)'), 'travel is shown with the distance');
  check((await text('#codet')).includes('Jagtvej 10, 2. tv., 2200'), 'the address is written the Danish way');
  await shotEl('price.png', '#co');

  // Send: held back until both boxes are ticked.
  await catchSend();
  await evaluate("document.getElementById('send').click()");
  check(await evaluate('window.__sent') === 'blocked' && (await text('#e-confirm')).includes('handelsbetingelserne'), 'nothing opens before the terms are accepted');
  await evaluate("document.getElementById('acc-terms').click()");
  await evaluate("document.getElementById('send').click()");
  check(await evaluate('window.__sent') === 'blocked' && (await text('#e-confirm')).includes('fortrydelsesretten'), 'nor before the early start is asked for');
  await evaluate("document.getElementById('acc-start').click()");
  const mail = await mailParts();
  check(mail.to === TO, `the email goes to ${TO}`);
  check(mail.subject.startsWith('Bookingforespørgsel: Punkteringsreparation, Bremsejustering') && mail.subject.endsWith('kl. 14:30'), `subject: "${mail.subject}"`);
  for (const line of ['Navn: Test Testesen', 'Telefon: 12345678', 'Adresse: Jagtvej 10, 2. tv., 2200', 'Besked: Cyklen står i gården & bag porten?',
    'Ønsket ankomst: kl. 14:30 (besøget tager op til 35 min.)', '- Jeg accepterer handelsbetingelserne.']) {
    check(mail.body.split('\r\n').includes(line), `the email says "${line}"`);
  }
  check(mail.body.includes('ca. 341 kr. i alt') && mail.body.includes('fortrydelsesret ophører'), 'and gives the price and the withdrawal acknowledgement');
  await evaluate("document.getElementById('send').click()");
  check(await evaluate('window.__sent') === 'sent', 'with both boxes ticked, the link opens the mail program');
  await waitFor("!document.getElementById('done').hidden", 'the "almost done" page');
  check((await text('#done-msg')).includes(TO) && (await evaluate("document.getElementById('mailtext').value")).includes('Telefon: 12345678'), 'which shows the request, ready to copy');
  await evaluate("document.getElementById('copy').click()");
  await waitFor("document.getElementById('copied').textContent", 'the copy button');
  check(true, `copy: "${await text('#copied')}"`);
  await shotEl('done.png', '#done');

  // In English, the page and the email.
  await evaluate("document.getElementById('lang-en').click()");
  await waitFor("document.documentElement.lang === 'en' && document.querySelectorAll('#svc-cards a').length === 5", 'the English page');
  check((await text('#svc-cards a .price')) === '199 DKK' && (await text('h1')) === 'Flat tyre? We come to you.', 'English: 199 DKK');
  await tick('chain');
  await pickDay(D1);
  await evaluate("document.querySelector('#slots input[value=\"09:00\"]').click()");
  await fill('street', 'Nørrebrogade 1');
  await fill('postcode', '2200');
  await fill('name', 'Ann');
  await fill('tel', '87654321');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the English price page');
  const en = await mailParts();
  check(en.subject.startsWith('Booking request: Chain Service') && en.body.includes('Kind regards') && en.body.includes('- I accept the terms and conditions.'), 'the email is in English too');

  // The legal pages: about this site, with nothing left about accounts, photos or Firebase.
  await open(new URL('privacy.html', SITE).href);
  const privacy = await evaluate('document.body.innerText');
  check(privacy.includes('Privacy policy') && privacy.includes('no accounts, no cookies') && !/Firebase|Google|sign-in|Adressev/i.test(privacy), 'the privacy policy describes the email-only site');
  await open(new URL('terms.html', SITE).href);
  check(!/Care|subscription|account/i.test(await evaluate('document.body.innerText')), 'the terms mention no subscriptions or accounts');

  const outside = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('mailto:') && u !== 'about:blank');
  check(outside.length === 0, `every request stays on ${origin}${outside.length ? `: ${outside.join(', ')}` : ''}`);
});
