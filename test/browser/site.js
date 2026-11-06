// The site in a real (headless) Chrome: booking a repair as a visitor would, through to the email
// that is sent. Run with `npm run test:browser` (local, on scripts/serve.js) or `npm run test:live`
// (against https://theneighbor.dk/). It sends nothing: the page's fetch() is replaced by a stub
// that records the request and answers as the API would, and the mailto: fallback is checked, not
// opened.
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
// Replaces the page's fetch(): records each request in window.__posts and answers with `status`
// and `body`, as the API would. Nothing reaches the server.
const stubApi = (status, body) => evaluate(`(() => {
  window.__posts = window.__posts || [];
  window.fetch = async (url, init = {}) => {
    window.__posts.push({ url: String(url), method: init.method, type: (init.headers || {})['Content-Type'], body: init.body });
    return new Response(${JSON.stringify(JSON.stringify(body))}, { status: ${status}, headers: { 'Content-Type': 'application/json' } });
  };
})()`);
const posts = () => evaluate('window.__posts || []');
// The mailto: link of the fallback page (set as soon as the price page is shown).
const mailParts = async () => {
  const url = new URL(await evaluate("document.getElementById('send-mail').href"));
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
    check(!(res.headers.get('x-robots-tag') || '').includes('noindex'), 'search engines are welcome (no noindex)');
    const robots = await (await fetch(new URL('robots.txt', SITE))).text();
    check(robots.includes('Allow: /') && !robots.includes('Disallow: /'), 'robots.txt allows the whole site');
    if (new URL(SITE).hostname === 'theneighbor.dk') {
      const www = await fetch('https://www.theneighbor.dk/terms.html', { redirect: 'manual' });
      check(www.status === 301 && www.headers.get('location') === 'https://theneighbor.dk/terms.html', `www redirects to the bare domain (${www.status})`);
    }
    const old = await fetch(new URL('account.html', SITE), { redirect: 'manual' });
    check(old.status === 301, `the old account page redirects to the front page (${old.status})`);
    const fn = await fetch(new URL('fn/bookingOptions', SITE), { method: 'POST', body: '{}' });
    check(fn.status === 403 || fn.status === 405, `the Firebase emulators are gone: POST /fn/... is refused (${fn.status})`);
    // The API answers only POST, and an empty request is refused (400), or 503 before the key is set.
    const api = await fetch(new URL('api/request', SITE), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check(api.status === 400 || api.status === 503, `POST /api/request with {} is refused without sending (${api.status})`);
    const apiGet = await fetch(new URL('api/request', SITE));
    check(apiGet.status === 403 || apiGet.status === 405, `GET /api/request is refused (${apiGet.status})`);
    const other = await fetch(new URL('index.html', SITE), { method: 'POST', body: '{}' });
    check(other.status === 403 || other.status === 405, `POST anywhere else is refused (${other.status})`);
  }

  // A first-time visitor, in Danish.
  await open(SITE);
  await evaluate('localStorage.clear()');
  await open(SITE);
  await waitFor("document.querySelectorAll('#svc-cards a').length > 0", 'the service cards');
  if (R.CONFIG.demo) check(await evaluate("!document.getElementById('demo-bar').hidden") && (await text('#demo-bar')).includes(TO), `the demo bar says requests go to ${TO}`);
  else check(await evaluate("document.getElementById('demo-bar').hidden"), 'no demo bar');
  check(await evaluate("document.querySelectorAll('#svc-cards a').length") === 6, 'six cards: five repairs and Anden reparation');
  check((await text('#svc-cards a .price')) === '199 kr.', 'prices in Danish: 199 kr.');
  const cards = await evaluate("[...document.querySelectorAll('#svc-cards a')].map((a) => a.innerText.replace(/\\s+/g, ' '))");
  check(cards[4].startsWith('Eftersyn 299 kr.') && !/Fejlfinding|diagnos/i.test(cards.join()), `Diagnostics is now Eftersyn: "${cards[4]}"`);
  check(cards[5].startsWith('Anden reparation Pris efter aftale') && cards[5].includes('kommentarfeltet'), `Anden reparation: "${cards[5]}"`);
  check(await evaluate("!document.getElementById('business') && !document.querySelector('a[href*=\"account\"], a[href*=\"admin\"]')"), 'no business section, no log-in, no dashboard');
  check(!(await evaluate('document.body.innerText')).match(/Care Plus|abonnement|Firebase|Opret en konto/i), 'no subscriptions or accounts mentioned');
  check((await text('footer')).includes(TO), 'the footer gives the booking address');
  check((await evaluate("I18N.t('faq.payA')")) === 'Du kan betale på stedet, med Vipps MobilePay (#124895) eller via bankoverførsel.' && !/faktura på mail/.test(await evaluate('document.body.textContent')), 'payment: on the spot, Vipps or bank transfer');
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
  await tick('service');
  await tick('brakes');
  check((await text('#e-services')).includes('45'), 'more than 45 minutes is refused at once');
  await tick('service');
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
  check((await text('#e-email')).startsWith('Skriv din e-mailadresse'), 'an email address is required');
  await fill('email', 'test@example');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  check((await text('#e-email')).startsWith('Skriv din e-mailadresse'), 'and must be a whole address');
  await fill('email', 'test.testesen@example.dk');
  await fill('postcode', '2200');
  await fill('note', 'Cyklen står i gården & bag porten?');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the price page');

  // The price: 199 + 129 for the repairs, 13 for travel from a 2200 postcode.
  check((await text('#tbl .tot')).includes('341 kr.'), `the total with travel: ${await text('#tbl .tot')}`);
  check((await text('#tbl')).includes('13 kr. (ca. 5 km, én vej)'), 'travel is shown with the distance');
  check((await text('#codet')).includes('Jagtvej 10, 2. tv., 2200'), 'the address is written the Danish way');
  await shotEl('price.png', '#co');

  // Send: held back until both boxes are ticked. The API answers 503 (not set up), so the page
  // falls back to the visitor's own mail program.
  await stubApi(503, { error: 'unavailable' });
  await evaluate("document.getElementById('send').click()");
  check((await posts()).length === 0 && (await text('#e-confirm')).includes('handelsbetingelserne'), 'nothing is sent before the terms are accepted');
  await evaluate("document.getElementById('acc-terms').click()");
  await evaluate("document.getElementById('send').click()");
  check((await posts()).length === 0 && (await text('#e-confirm')).includes('fortrydelsesretten'), 'nor before the early start is asked for');
  await evaluate("document.getElementById('acc-start').click()");
  await evaluate("document.getElementById('send').click()");
  await waitFor("!document.getElementById('done').hidden", 'the mail fallback page');
  const [post] = await posts();
  const sentReq = JSON.parse(post.body);
  check(post.url === '/api/request' && post.method === 'POST' && post.type === 'application/json', `the request is posted to /api/request (${post.url})`);
  check(sentReq.lang === 'da' && sentReq.email === 'test.testesen@example.dk' && sentReq.accept.terms === true && sentReq.accept.earlyStart === true && sentReq.website === '',
    'with the language, the email address, both ticks and an empty honeypot');
  check(/^[0-9a-f-]{32,36}$/.test(sentReq.id) && JSON.stringify(sentReq.serviceIds) === '["puncture","brakes"]', 'a request id, and the services by id');
  check(!/total|price|travel/i.test(Object.keys(sentReq).join()), 'and no prices: the server works them out');
  const mail = await mailParts();
  check(mail.to === TO, `the email goes to ${TO}`);
  check(mail.subject.startsWith('Bookingforespørgsel: Punkteringsreparation, Bremsejustering') && mail.subject.endsWith('kl. 14:30'), `subject: "${mail.subject}"`);
  for (const line of ['Navn: Test Testesen', 'Telefon: 12345678', 'Adresse: Jagtvej 10, 2. tv., 2200', 'Kommentar: Cyklen står i gården & bag porten?',
    'Ønsket ankomst: kl. 14:30 (besøget tager op til 35 min.)', 'E-mail: test.testesen@example.dk', '- Jeg accepterer handelsbetingelserne.']) {
    check(mail.body.split('\r\n').includes(line), `the email says "${line}"`);
  }
  check(mail.body.includes('ca. 341 kr. i alt') && mail.body.includes('fortrydelsesret ophører'), 'and gives the price and the withdrawal acknowledgement');
  check((await text('#done-msg')).includes('kunne ikke sende') && (await text('#done-msg')).includes(TO) && (await evaluate("document.getElementById('mailtext').value")).includes('Telefon: 12345678'),
    'the fallback page offers the mail program, and the request ready to copy');
  await evaluate("document.getElementById('copy').click()");
  await waitFor("document.getElementById('copied').textContent", 'the copy button');
  check(true, `copy: "${await text('#copied')}"`);
  await shotEl('done.png', '#done');
  check(await evaluate("document.getElementById('sent').hidden"), 'and does not claim it was sent');

  // In English, the page and the email.
  await evaluate("document.getElementById('lang-en').click()");
  await waitFor("document.documentElement.lang === 'en' && document.querySelectorAll('#svc-cards a').length === 6", 'the English page');
  check((await text('#svc-cards a .price')) === '199 DKK' && (await text('h1')) === 'Flat tyre? We come to you.', 'English: 199 DKK');
  check(await evaluate("[...document.querySelectorAll('#svc-cards b')].map((b) => b.textContent).join()") === 'Puncture Fix,Brake Adjustment,Gear Adjustment,Chain Service,Bike Service,Other Repair', 'English: Bike Service and Other Repair');
  // A chain service and an Other Repair, which must be described in the comment.
  await tick('chain');
  await evaluate("document.querySelector('#svc-cards a[data-pre=other]').click()");
  check(await evaluate("document.querySelector('input[name=svc][value=other]').checked"), 'the Other Repair card chooses it in the form');
  await pickDay(D1);
  await evaluate("document.querySelector('#slots input[value=\"09:00\"]').click()");
  await fill('street', 'Nørrebrogade 1');
  await fill('postcode', '2200');
  await fill('name', 'Ann');
  await fill('tel', '87654321');
  await fill('email', 'ann@example.com');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  check((await text('#e-note')).includes('comment field') && await evaluate("document.getElementById('co').hidden"), 'an Other Repair without a comment is refused');
  await fill('note', 'The mudguard rattles');
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the English price page');
  check((await text('#tbl')).includes('Price by agreement') && (await text('#tbl .tot')).includes('162 DKK + other repair'), `the price page: ${await text('#tbl .tot')}`);
  check((await text('#notes')).includes('we agree the price and time'), 'and says its price is agreed later');
  const en = await mailParts();
  check(en.subject.startsWith('Booking request: Chain Service, Other Repair') && en.body.includes('Kind regards') && en.body.includes('- I accept the terms and conditions.'), 'the email is in English too');
  check(en.body.includes('Other Repair (Price by agreement)') && en.body.includes('Comment: The mudguard rattles') && en.body.includes('price of the other repair is to be agreed'), 'with the Other Repair, its comment and price by agreement');
  await shotEl('price-other.png', '#co');

  // The server's own checks refuse it (say, the page was left open overnight): back to the form.
  await evaluate("document.getElementById('acc-terms').click()");
  await evaluate("document.getElementById('acc-start').click()");
  await stubApi(400, { error: 'invalid', errors: { date: 'lead' } });
  await evaluate("document.getElementById('send').click()");
  await waitFor("!document.getElementById('f').hidden", 'the form again');
  check((await text('#e-date')) === 'Please book at least 2 days ahead.', `the server's error is shown on the field: "${await text('#e-date')}"`);
  // Sent: the page says so, and where the copy went.
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await waitFor("!document.getElementById('co').hidden", 'the price page again');
  await stubApi(200, { ok: true, copy: true });
  await evaluate("document.getElementById('send').click()");
  await waitFor("!document.getElementById('sent').hidden", 'the "request sent" page');
  check((await text('#sent-msg')).includes('a copy is on its way to ann@example.com') && await evaluate("document.getElementById('sent-nocopy').hidden"), `sent: "${await text('#sent-msg')}"`);
  const ids = (await posts()).map((p) => JSON.parse(p.body).id);
  check(ids.length === 2 && ids[0] !== ids[1], 'a changed request gets a new id');
  await shotEl('sent.png', '#sent');

  // The legal pages: about this site, with nothing left about accounts, photos or Firebase.
  await open(new URL('privacy.html', SITE).href);
  const privacy = await evaluate('document.body.innerText');
  check(privacy.includes('Privacy policy') && privacy.includes('no accounts, no cookies') && !/Firebase|sign-in|Adressev/i.test(privacy) && privacy.includes("Google (Gmail)") && privacy.includes("46840291"), 'the privacy policy describes the email-only site');
  await open(new URL('terms.html', SITE).href);
  check(!/Care|subscription|account/i.test(await evaluate('document.body.innerText')), 'the terms mention no subscriptions or accounts');

  const outside = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('mailto:') && u !== 'about:blank');
  check(outside.length === 0, `every request stays on ${origin}${outside.length ? `: ${outside.join(', ')}` : ''}`);
});
