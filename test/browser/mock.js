// The clickable mock (mock/, its fake backend in the browser): clicks through it like a visitor.
// Run with `npm run test:browser` (or `node test/browser/mock.js`). Needs no server.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, FIXTURE, check, evaluate, open, run, setFile, shot, shotEl, sleep } from './cdp.js';

const MOCK = pathToFileURL(path.join(ROOT, 'mock')).href + '/';
const TEST_IMAGE = FIXTURE;

run(9333, async () => {
  // Fresh visitor: Danish by default, consent shown.
  await open(MOCK + 'index.html');
  await evaluate('localStorage.clear()');
  await open(MOCK + 'index.html');
  check(await evaluate('document.documentElement.lang') === 'da', 'a first-time visitor gets Danish');
  check(await evaluate("document.querySelector('h1').textContent") === 'Dine cykler, altid klar til at køre.', 'the headline is in Danish');
  check(await evaluate("!document.getElementById('consent').hidden"), 'the consent dialog is shown');
  check(await evaluate("[...document.querySelectorAll('#plan-cards .price')].map(e=>e.firstChild.textContent.trim()).join('|')") === '250 kr.|300 kr.|350 kr.', 'prices are shown as kr. in Danish');
  await shot('da-consent.png');
  await evaluate("document.getElementById('c1').click(); document.getElementById('c2').click(); document.getElementById('cok').click()");
  const cards = await evaluate("[...document.querySelectorAll('#svc-cards a')].map(a=>a.querySelector('b').textContent+' '+a.querySelector('.price').textContent)");
  check(cards.length === 6 && cards[0] === 'The Neighbor Cykeltjek 199 kr.' && cards[2] === 'Bremsejustering 129 kr.', 'six service cards with the new prices: ' + cards.join(' | '));
  const care = await evaluate("[...document.querySelectorAll('#care-cards h3')].map(e=>e.textContent).join(' | ')");
  check(care === 'The Neighbor Care | Neighbor Care Plus', 'two subscription cards: ' + care);
  await evaluate("['bike-check','brakes','gears'].forEach(v=>document.querySelector('input[name=svc][value=\"'+v+'\"]').click())");
  check((await evaluate("document.getElementById('e-services').textContent")).includes('højst 45 minutter'), 'choosing 55 minutes of services warns at once');
  await evaluate("['bike-check','brakes','gears'].forEach(v=>document.querySelector('input[name=svc][value=\"'+v+'\"]').click())");
  check((await evaluate("document.getElementById('e-services').textContent")) === '', 'the warning clears when the services are unticked');
  await evaluate("document.querySelector('#private details').open = true");
  await shotEl('da-private.png', '#private .wrap > .prices');
  await shotEl('da-private-more.png', '#private .after');
  await shotEl('da-care.png', '#care-cards');

  // Book: two services, next Tuesday, first free time, new account.
  const tue = await evaluate("(()=>{let d=new Date();do{d.setDate(d.getDate()+1)}while(d.getDay()!==2);return d.toLocaleDateString('sv-SE')})()");
  const sun = await evaluate("(()=>{let d=new Date();do{d.setDate(d.getDate()+1)}while(d.getDay()!==0);return d.toLocaleDateString('sv-SE')})()");
  await evaluate(`(()=>{const d=document.getElementById('date');d.value='${sun}';d.dispatchEvent(new Event('change'))})()`);
  check((await evaluate("document.getElementById('e-date').textContent")).includes('søndagen'), 'picking a Sunday shows "closed on Sundays"');
  check(await evaluate("document.querySelectorAll('input[name=slot]').length") === 0, 'no times are offered on a Sunday');
  await evaluate("document.querySelector('input[value=\"bike-check\"]').click(); document.querySelector('input[value=\"chain\"]').click()");
  await evaluate(`(()=>{const d=document.getElementById('date');d.value='${tue}';d.dispatchEvent(new Event('change'))})()`);
  const slots = await evaluate("[...document.querySelectorAll('input[name=slot]')].map(i=>i.value)");
  check(slots[0] === '08:30' && slots.at(-1) === '14:30', `times run 08:30 to 14:30 (${slots.length} offered)`);
  await evaluate("document.querySelector('input[name=slot][value=\"09:00\"]').click()");
  await evaluate(`(()=>{const s=(id,v)=>{document.getElementById(id).value=v};
    s('addr','Nørrebrogade 10, 2200 København N');s('name','Mette Larsen');s('tel','+45 30 30 30 30');s('email','mette@example.com');
    document.getElementById('remember').click();document.getElementById('mkacct').click()})()`);
  check(await evaluate("!document.getElementById('pw-row').hidden"), 'ticking "Opret en konto" shows the password field');
  await setFile('#bk-photo-input', TEST_IMAGE);
  check(await evaluate("document.querySelectorAll('#bk-photos figure img').length") === 1, 'a photo can be added to the booking');
  const shrunk = await evaluate("(()=>{const i=document.querySelector('#bk-photos figure img');return {jpeg:i.src.startsWith('data:image/jpeg'),w:i.naturalWidth}})()");
  check(shrunk.jpeg && shrunk.w <= 800, `the photo is shrunk to a JPEG of at most 800 px (${shrunk.w} px)`);
  check((await evaluate("document.querySelector('#bk-photos .det').textContent")) === '1 af 3 billeder', 'the counter shows "1 af 3 billeder"');
  await shotEl('da-form.png', '#f');
  await evaluate("document.getElementById('pw').value='abc'; document.querySelector('#f button[type=submit]').click()");
  check((await evaluate("document.getElementById('e-form').textContent")).includes('mindst 8 tegn'), 'a short password is refused in Danish');
  await evaluate("document.getElementById('pw').value='longenough1'; document.querySelector('#f button[type=submit]').click()");
  check(await evaluate("!document.getElementById('co').hidden"), 'the price page opens');
  const totalRow = await evaluate("document.querySelector('#tbl .tot').textContent");
  check(totalRow.includes('344 kr.'), `the full total with travel and 5% combo is shown before booking: "${totalRow}"`);
  check(await evaluate("document.querySelectorAll('#notes .pic img').length") === 1, 'the price page shows the attached photo');
  await shotEl('da-checkout.png', '#co');
  await evaluate("document.getElementById('confirm').click()");
  const doneMsg = await evaluate("document.getElementById('done-msg').textContent");
  check(doneMsg.includes('er gemt') && doneMsg.includes('konto er oprettet'), 'booking saved and account created');
  check((await evaluate("document.getElementById('sum').textContent")).includes('1 billede(r) vedhæftet'), 'the confirmation mentions the photo');
  check(await evaluate("JSON.parse(localStorage.getItem('neighbor-remember')).name") === 'Mette Larsen', '"Husk mig" saved the contact details');

  // The time is now blocked for the next visitor.
  await evaluate("localStorage.removeItem('neighbor-mock-session')");
  await open(MOCK + 'index.html#book');
  await evaluate(`(()=>{const d=document.getElementById('date');d.value='${tue}';d.dispatchEvent(new Event('change'))})()`);
  const free = await evaluate("Object.fromEntries([...document.querySelectorAll('input[name=slot]')].map(i=>[i.value,!i.disabled]))");
  check(free['09:00'] === false && free['09:30'] === false && free['10:00'] === true && free['08:30'] === false,
    'the booked 09:00 job blocks 08:30–09:30 for others; 10:00 is free');
  check(await evaluate("document.getElementById('name').value") === 'Mette Larsen', '"Husk mig" fills in the form next time');

  // Account page in Danish, then switch to English.
  await evaluate("localStorage.setItem('neighbor-mock-session', Object.entries(JSON.parse(localStorage.getItem('neighbor-mock-v6')).users).find(([,u])=>u.email==='mette@example.com')[0])");
  await open(MOCK + 'account.html');
  check((await evaluate("document.getElementById('hi').textContent")) === 'Hej, Mette', 'the new account opens in Danish');
  await evaluate("[...document.querySelectorAll('#tabs button')][1].click()");
  check((await evaluate("document.getElementById('view').textContent")).includes('Afventer'), 'the booking shows as "Afventer" (pending)');
  await evaluate("document.getElementById('lang-en').click()");
  await sleep(800);
  check(await evaluate('document.documentElement.lang') === 'en' && (await evaluate("document.getElementById('hi').textContent")) === 'Hello, Mette', 'the switch changes the account to English');
  await open(MOCK + 'index.html');
  check(await evaluate("document.querySelector('h1').textContent") === 'Your bikes, always ready to ride.', 'English is remembered on the next page');
  await shot('en-top.png');
  await evaluate("document.getElementById('lang-da').click()");
  await sleep(800);
  check(await evaluate('document.documentElement.lang') === 'da', 'switching back to Danish works');

  // Lead time: a guest starts 2 days ahead; Anna (Care Plus) can pick tomorrow.
  const tmr = await evaluate("(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toLocaleDateString('sv-SE')})()");
  await evaluate("localStorage.removeItem('neighbor-mock-session')");
  await open(MOCK + 'index.html');
  check(await evaluate("document.getElementById('date').min") > tmr, 'a guest cannot pick tomorrow in the date field');
  await evaluate("localStorage.setItem('neighbor-mock-session','u-anna')");
  await open(MOCK + 'index.html');
  const tmrClosed = new Date(`${tmr}T12:00:00`).getDay() === 0;
  if (tmrClosed) {
    check(await evaluate("document.getElementById('date').min") > tmr, 'tomorrow is Sunday, so not even Anna (Care Plus) can pick it');
    check(!(await evaluate("document.getElementById('signed-in').textContent")).includes('akutte besøg'), 'and the form does not offer her an urgent visit tomorrow');
  } else {
    check(await evaluate("document.getElementById('date').min") === tmr, 'Anna (Care Plus) can pick tomorrow');
    check((await evaluate("document.getElementById('signed-in').textContent")).includes('akutte besøg'), 'the form tells Anna about her urgent visit');
  }

  // My bikes: Anna edits her Trek and adds a second photo.
  await open(MOCK + 'account.html');
  await evaluate("[...document.querySelectorAll('#tabs button')][3].click()");
  check(await evaluate("document.querySelectorAll('.bike-card .cover img').length") === 1, "Anna's Trek shows its cover photo");
  await evaluate("[...document.querySelectorAll('.bike-card button.alt')][0].click()");
  check((await evaluate("document.querySelector('#bike-form h2').textContent")) === 'Rediger Trek FX 3', 'Edit opens the form for that bike');
  check(await evaluate("document.getElementById('nb-name').value") === 'Trek FX 3' && await evaluate("document.querySelectorAll('#bike-form figure').length") === 1, 'the form is filled in, with the existing photo');
  await setFile('#nb-photos', TEST_IMAGE);
  await evaluate("document.querySelector('#bike-form button[type=submit]').click()");
  check(await evaluate("document.querySelectorAll('.bike-card')[0].querySelectorAll('img').length") === 2, 'after saving, the Trek has a cover photo and one more');
  await shotEl('da-bikes.png', '#view');
  await evaluate("document.querySelector('.bike-card .cover').click()");
  check(await evaluate("!!document.querySelector('.lightbox img')"), 'clicking a photo opens it full size');
  await evaluate("document.querySelector('.lightbox .pill').click()");
  check(await evaluate("!document.querySelector('.lightbox')"), 'and the close button closes it');
  // Add a new bike with a photo.
  await evaluate("document.getElementById('nb-name').value='Christiania Light'");
  await setFile('#nb-photos', TEST_IMAGE);
  await evaluate("document.querySelector('#bike-form button[type=submit]').click()");
  check((await evaluate("[...document.querySelectorAll('.bike-card h3')].map(e=>e.textContent).join('|')")).includes('Christiania Light')
    && await evaluate("document.querySelectorAll('.bike-card .cover img').length") === 2, 'a new bike can be added with a photo');

  // Anna books her Trek with a photo: it is saved on the Trek too.
  await open(MOCK + 'index.html#book');
  check(await evaluate("document.getElementById('bike').value") === 'Trek FX 3' && await evaluate("!document.getElementById('pics-to-bike').hidden"), 'with her own bike chosen, the form says photos are saved on it');
  await evaluate("document.querySelector('input[value=\"chain\"]').click()");
  await evaluate(`(()=>{const d=document.getElementById('date');d.value='${tue}';d.dispatchEvent(new Event('change'))})()`);
  await evaluate("document.querySelector('input[name=slot][value=\"11:00\"]').click()");
  await setFile('#bk-photo-input', TEST_IMAGE);
  await evaluate("document.querySelector('#f button[type=submit]').click()");
  await evaluate("document.getElementById('confirm').click()");
  check((await evaluate("document.getElementById('done-msg').textContent")).includes('også gemt på Trek FX 3'), 'the confirmation says the photo was also saved on the Trek');
  await open(MOCK + 'account.html');
  await evaluate("[...document.querySelectorAll('#tabs button')][3].click()");
  check(await evaluate("document.querySelectorAll('.bike-card')[0].querySelectorAll('img').length") === 3, 'the Trek now has 3 photos');

  // Owner dashboard stays English and still works.
  await evaluate("localStorage.setItem('neighbor-mock-session','u-owner')");
  await open(MOCK + 'admin.html');
  check((await evaluate("document.getElementById('view').textContent")).includes('Mette Larsen'), "the owner's dashboard shows the new booking");
  check(await evaluate("[...document.querySelectorAll('#view .paper')].find(p=>p.textContent.includes('Mette Larsen')).querySelectorAll('.pic img').length") === 1, "the owner sees the customer's photo on the booking");
  await evaluate("[...document.querySelectorAll('#tabs button')][2].click()");
  check(await evaluate("document.querySelectorAll('#view form .pic img').length") >= 1, "Log a visit shows the customer's photos of the chosen bike");
  // Fleet photos: the owner photographs bike #001 at the fleet check.
  await evaluate("[...document.querySelectorAll('#tabs button')][3].click()");
  check(await evaluate("document.querySelector('[aria-label=\"Photos for #003\"]').textContent") === 'Photos (1)', 'the fleet report shows #003 already has a photo');
  await evaluate("document.querySelector('[aria-label=\"Photos for #001\"]').click()");
  check((await evaluate("document.querySelector('.pic-add').textContent")).includes('Add photo'), 'the photo field is in English on the dashboard');
  await setFile('#fleet-photos', TEST_IMAGE);
  await evaluate("[...document.querySelectorAll('#view button')].find(b=>b.textContent==='Save photos').click()");
  check(await evaluate("document.querySelector('[aria-label=\"Photos for #001\"]').textContent") === 'Photos (1)', 'saving updates the count for #001');
  // Hotel ABC sees the photos.
  await evaluate("localStorage.setItem('neighbor-mock-session','u-hotel')");
  await open(MOCK + 'account.html');
  await evaluate("[...document.querySelectorAll('#tabs button')][1].click()");
  check(await evaluate("document.querySelectorAll('.bike-card .cover img').length") === 2, 'Hotel ABC sees cover photos on #001 and #003 in its fleet list');
  await shotEl('da-fleet.png', '#view');
  await evaluate("[...document.querySelectorAll('#tabs button')][0].click()");
  await evaluate("document.querySelector('[aria-label=\"Detaljer for cykel #003\"]').click()");
  check(await evaluate("document.querySelectorAll('[aria-live] .pic img').length") === 1, "and in the report's bike details");

});
