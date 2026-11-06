// Tests for the booking API (api/): the checks, the limits, the honeypot, idempotency, header
// injection and the Resend calls, over real HTTP on a local port, with a fake email transport.
// Nothing is sent anywhere. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as R from '../web/js/booking-rules.js';
import { createApp, MAX_BODY } from '../api/app.js';
import { loadTexts, hasDanishLocale } from '../api/texts.js';
import { resendTransport, RESEND_URL } from '../api/resend.js';
import { WindowLimiter, DailyCap, IdempotencyCache } from '../api/limits.js';

const TEXTS = loadTexts();
const OWNER = R.CONFIG.contact.email;
// Saturday 17 October 2026, 12:00 in Copenhagen; the Tuesday after is a normal open day.
const SAT_NOON = Date.parse('2026-10-17T10:00:00Z');
const TUE = '2026-10-20';
const chr = (n) => String.fromCharCode(n);

let n = 0;
const newId = () => `test-request-${String(++n).padStart(6, '0')}-abcdef`;
const good = (over = {}) => ({
  id: newId(),
  lang: 'da',
  serviceIds: ['puncture', 'chain'],
  date: TUE,
  arrival: '10:00',
  bike: TEXTS.da.bikes[0],
  street: 'Jagtvej 10, 2. tv.',
  postcode: '2200',
  name: 'Søren Ødegård',
  phone: '12345678',
  email: 'soren@example.dk',
  note: 'Cyklen står i gården.',
  accept: { terms: true, earlyStart: true },
  website: '',
  ...over,
});

// A fake transport: records every email, answers ok unless told otherwise.
function fakeTransport(answer = () => ({ ok: true, status: 200 })) {
  const sent = [];
  const send = async (email, key) => {
    sent.push({ email, key });
    await new Promise((r) => setTimeout(r, 5));
    return answer(email, key, sent.length);
  };
  return { send, sent };
}

// Starts the API on a free local port. Returns { post, request, close, sent, logs, clock }.
async function start(opts = {}) {
  const t = opts.transport || fakeTransport();
  const logs = [];
  const clock = { now: SAT_NOON };
  const app = createApp({ send: opts.unconfigured ? null : t.send, now: () => clock.now, log: (l) => logs.push(l), texts: TEXTS, ...opts.app });
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const agent = new http.Agent();
  const request = ({ method = 'POST', path = '/api/request', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.end(body); else req.end();
  });
  const post = (obj, { ip = '203.0.113.1', headers = {} } = {}) => request({
    body: typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj),
    headers: { 'Content-Type': 'application/json', 'X-Client-IP': ip, ...headers },
  });
  const close = () => new Promise((r) => { agent.destroy(); server.close(r); });
  return { post, request, close, sent: t.sent, logs, clock, app };
}

test('a good request: one email to the owner, one copy to the customer', async () => {
  const api = await start();
  const body = good();
  const res = await api.post(body);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, copy: true });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(api.sent.length, 2);
  const [owner, copy] = api.sent;

  // The owner's email is exactly what the mailto: link carried, in the customer's language.
  const L = TEXTS.da;
  const q = R.quote(body.serviceIds, { distanceKm: R.estimateKm(body.postcode) });
  const expected = R.requestEmail({ ...body }, q, L);
  assert.deepEqual(owner.email, { from: 'The Neighbor <booking@theneighbor.dk>', to: [OWNER], reply_to: 'soren@example.dk', subject: expected.subject, text: expected.body });
  assert.equal(owner.key, `${body.id}-owner`);
  assert.match(owner.email.subject, /^Bookingforespørgsel: Punkteringsreparation, Kædeservice, .* kl\. 10:00$/);
  const lines = owner.email.text.split('\r\n');
  for (const l of ['Navn: Søren Ødegård', 'Telefon: 12345678', 'E-mail: soren@example.dk', 'Adresse: Jagtvej 10, 2. tv., 2200', 'Kommentar: Cyklen står i gården.']) assert.ok(lines.includes(l), l);
  assert.ok(owner.email.text.includes('ca. 361 kr. i alt'), 'the price is worked out by the server: 199 + 149 + 13 travel');

  // The customer's copy: Reply-To the owner, with both ticked statements and the terms.
  assert.equal(copy.key, `${body.id}-copy`);
  assert.deepEqual(copy.email.to, ['soren@example.dk']);
  assert.equal(copy.email.reply_to, OWNER);
  assert.equal(copy.email.from, 'The Neighbor <booking@theneighbor.dk>');
  assert.equal(copy.email.subject, `Kopi af din forespørgsel: ${expected.subject}`);
  assert.ok(copy.email.text.includes(`- ${L.t('co.acceptTerms')}.`), 'the terms statement');
  assert.ok(copy.email.text.includes(`- ${L.t('co.earlyStart')}`), 'the early start and withdrawal acknowledgement');
  assert.ok(copy.email.text.includes('https://theneighbor.dk/terms.html'), 'a link to the terms');
  assert.ok(copy.email.text.endsWith(expected.body), 'then the request itself');
  assert.deepEqual(api.logs, ['api 200 sent']);
  await api.close();
});

test('in English, both emails are in English', async () => {
  const api = await start();
  const res = await api.post(good({ lang: 'en', bike: TEXTS.en.bikes[1], serviceIds: ['other'], note: 'Loose mudguard' }));
  assert.equal(res.status, 200);
  const [owner, copy] = api.sent;
  assert.match(owner.email.subject, /^Booking request: Other Repair, /);
  assert.ok(owner.email.text.includes('Other Repair (Price by agreement)') && owner.email.text.includes('Email: soren@example.dk'));
  assert.ok(copy.email.subject.startsWith('Copy of your request: Booking request:'));
  assert.ok(copy.email.text.includes('- I accept the terms and conditions.') && copy.email.text.includes('my right of withdrawal ends'));
  await api.close();
});

test('the server re-checks the request with the page\'s rules', async () => {
  const api = await start();
  const invalid = async (over, field, code) => {
    const res = await api.post(good(over));
    assert.equal(res.status, 400, JSON.stringify(over));
    assert.equal(res.json.error, 'invalid');
    assert.equal(res.json.errors[field], code, `${JSON.stringify(over)} -> ${JSON.stringify(res.json.errors)}`);
  };
  await invalid({ email: '' }, 'email', 'email');
  for (const email of ['soren', 'soren@', '@example.dk', 'soren@example', 'sø@example.dk', 'a..b@example.dk', '.a@example.dk', 'a.@example.dk', 'a@-example.dk', `${'a'.repeat(65)}@example.dk`]) {
    await invalid({ email }, 'email', 'email');
  }
  await invalid({ date: '2026-10-18' }, 'date', 'sunday');
  await invalid({ date: '2026-10-17' }, 'date', 'lead');
  await invalid({ date: '2026-10-01' }, 'date', 'past');
  await invalid({ arrival: '15:30' }, 'arrival', 'arrival');
  await invalid({ arrival: '10:15' }, 'arrival', 'arrival');
  await invalid({ serviceIds: [] }, 'services', 'services');
  await invalid({ serviceIds: ['puncture', 'brakes', 'service'] }, 'services', 'tooLong');
  await invalid({ serviceIds: ['other'], note: '' }, 'note', 'note');
  await invalid({ note: 'x'.repeat(301) }, 'note', 'noteLong');
  await invalid({ postcode: '4000' }, 'form', 'far');
  await invalid({ postcode: 'abcd' }, 'form', 'postcode');
  await invalid({ phone: '   ' }, 'form', 'contact');
  await invalid({ accept: { terms: true } }, 'accept', 'earlyStart');
  await invalid({ accept: { terms: 'yes', earlyStart: true } }, 'accept', 'terms');
  await invalid({ accept: {} }, 'accept', 'terms');
  assert.equal(api.sent.length, 0, 'nothing invalid is sent');
  // A request that is fine after all goes through.
  assert.equal((await api.post(good())).status, 200);
  await api.close();
});

test('anything the page would not send is refused, prices included', async () => {
  const api = await start();
  const bad = async (body, why) => {
    const res = await api.post(body);
    assert.equal(res.status, 400, why);
    assert.deepEqual(res.json, { error: 'bad' }, why);
  };
  await bad(good({ total: 1 }), 'a price from the browser (unknown fields are refused)');
  await bad(good({ quote: { total: 1 } }), 'a quote from the browser');
  await bad('{"__proto__": {"x": 1}, "id": "abcdefghijklmnopq"}', '__proto__');
  await bad('[]', 'an array');
  await bad('null', 'null');
  await bad('"text"', 'a string');
  await bad('{not json', 'broken JSON');
  await bad(Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d]), 'not UTF-8');
  await bad(good({ id: 'short' }), 'a short id');
  await bad(good({ id: 'x'.repeat(65) }), 'a long id');
  await bad(good({ id: 'abc def ghi jkl mno' }), 'an id with spaces');
  await bad(good({ id: undefined }), 'no id');
  await bad(good({ lang: 'de' }), 'an unknown language');
  await bad(good({ lang: 'toString' }), 'a language that is a property of every object');
  await bad(good({ serviceIds: ['puncture', 'puncture'] }), 'a service twice');
  await bad(good({ serviceIds: ['monthly'] }), 'an unknown service');
  await bad(good({ serviceIds: 'puncture' }), 'services not as a list');
  await bad(good({ serviceIds: [1] }), 'a service that is not a string');
  await bad(good({ bike: 'Tandem' }), 'a bike type the form does not offer');
  await bad(good({ bike: TEXTS.en.bikes[0] }), 'a bike type in the other language');
  await bad(good({ name: 'x'.repeat(81) }), 'a name over 80 characters');
  await bad(good({ street: 'x'.repeat(121) }), 'an address over 120 characters');
  await bad(good({ phone: 'x'.repeat(31) }), 'a phone over 30 characters');
  await bad(good({ postcode: '22000' }), 'a 5-digit postcode');
  await bad(good({ note: 'x'.repeat(601) }), 'a comment far over the limit');
  await bad(good({ name: 42 }), 'a number for a name');
  await bad(good({ accept: true }), 'accept not as an object');
  await bad(good({ accept: { terms: true, earlyStart: true, marketing: true } }), 'an unknown statement');
  await bad(good({ website: 42 }), 'a honeypot that is not a string');
  assert.equal(api.sent.length, 0);
  await api.close();
});

test('header injection: no line breaks or control characters in any field, one plain address', async () => {
  const api = await start();
  const CR = chr(13);
  const LF = chr(10);
  const bad = async (over, why) => {
    const res = await api.post(good(over));
    assert.equal(res.status, 400, why);
    assert.equal(res.json.error, 'bad', why);
  };
  const invalidEmail = async (email, why) => {
    const res = await api.post(good({ email }));
    assert.equal(res.status, 400, why);
    assert.equal(res.json.errors?.email ?? (res.json.error === 'bad' ? 'email' : null), 'email', why);
  };
  await invalidEmail(`soren@example.dk${CR}${LF}Bcc: victim@example.com`, 'CRLF and a Bcc header');
  await invalidEmail(`soren@example.dk${LF}Bcc: victim@example.com`, 'LF and a Bcc header');
  await invalidEmail('soren@example.dk, victim@example.com', 'two addresses');
  await invalidEmail('soren@example.dk;victim@example.com', 'two addresses, semicolon');
  await invalidEmail('Søren <soren@example.dk>', 'a display name');
  await invalidEmail('<soren@example.dk>', 'angle brackets');
  await invalidEmail('"a b"@example.dk', 'a quoted local part');
  await bad({ name: `Søren${CR}${LF}Subject: free money` }, 'CRLF in the name');
  await bad({ name: `Søren${LF}X: y` }, 'LF in the name');
  await bad({ street: `Jagtvej 1${chr(0)}` }, 'NUL in the address');
  await bad({ phone: `1234${chr(0x2028)}5678` }, 'a Unicode line separator');
  await bad({ name: `Søren ${chr(0x202e)}evil` }, 'a right-to-left override');
  await bad({ note: `Hej${chr(0x1b)}[31m` }, 'an escape character in the comment');
  assert.equal(api.sent.length, 0);

  // Line breaks are fine in the comment, as LF; nothing typed reaches a subject or another header.
  const body = good({ name: 'Bcc: victim@example.com', note: `Linje 1${CR}${LF}Linje 2${CR}Linje 3` });
  assert.equal((await api.post(body)).status, 200);
  const [owner, copy] = api.sent;
  assert.ok(!owner.email.subject.includes('victim') && !copy.email.subject.includes('victim'), 'the name never reaches a subject');
  assert.ok(![owner.email.subject, copy.email.subject].some((s) => /[\r\n]/.test(s)), 'subjects are one line');
  assert.deepEqual(owner.email.to, [OWNER]);
  assert.equal(owner.email.reply_to, 'soren@example.dk');
  assert.ok(owner.email.text.includes(`Kommentar: Linje 1${LF}Linje 2${LF}Linje 3`), 'the comment keeps its lines, as LF');
  await api.close();
});

test('the honeypot: a filled-in hidden field sends nothing', async () => {
  const api = await start();
  const res = await api.post(good({ website: 'http://spam.example' }));
  assert.equal(res.status, 400);
  assert.deepEqual(res.json, { error: 'rejected' }, 'not a success: a person who somehow filled it in gets the mailto: fallback');
  assert.equal(api.sent.length, 0);
  assert.deepEqual(api.logs, ['api 400 honeypot']);
  await api.close();
});

test('idempotency: a retry or a double click sends nothing twice', async () => {
  const api = await start();
  const body = good();
  assert.equal((await api.post(body)).status, 200);
  const again = await api.post(body);
  assert.equal(again.status, 200);
  assert.deepEqual(again.json, { ok: true, copy: true });
  assert.equal(api.sent.length, 2, 'still just the two emails');

  // Two clicks at once: the second waits for the first, and nothing more is sent.
  const twice = good();
  const [a, b] = await Promise.all([api.post(twice), api.post(twice)]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(api.sent.length, 4);
  assert.ok(api.logs.filter((l) => l.startsWith('api 200 duplicate')).length === 2);
  await api.close();
});

test('a failed send can be tried again; a failed copy still counts as sent', async () => {
  let failOwner = true;
  let failCopy = false;
  const t = fakeTransport((email) => {
    if (email.to[0] === OWNER && failOwner) return { ok: false, status: 500, name: 'internal_server_error' };
    if (email.to[0] !== OWNER && failCopy) return { ok: false, status: 422, name: 'validation_error' };
    return { ok: true, status: 200 };
  });
  const api = await start({ transport: t });
  const body = good();
  const first = await api.post(body);
  assert.equal(first.status, 502, 'the owner could not be reached: the page falls back to mailto:');
  assert.equal(t.sent.length, 1, 'and no copy is sent for a request the owner did not get');
  failOwner = false;
  const retry = await api.post(body);
  assert.equal(retry.status, 200, 'the same request id can be tried again after a failure');
  assert.equal(t.sent.filter((s) => s.key === `${body.id}-owner`).length, 2, 'with the same idempotency key, so Resend would not send twice');

  failCopy = true;
  const noCopy = await api.post(good());
  assert.deepEqual([noCopy.status, noCopy.json], [200, { ok: true, copy: false }]);
  assert.deepEqual(api.logs, ['api 502 owner-failed resend=500:internal_server_error', 'api 200 sent', 'api 200 sent-no-copy resend=422:validation_error']);
  await api.close();
});

test('rate limit: 5 requests per visitor per hour', async () => {
  const api = await start();
  for (let i = 0; i < 5; i++) assert.equal((await api.post(good(), { ip: '198.51.100.7' })).status, 200);
  const sixth = await api.post(good(), { ip: '198.51.100.7' });
  assert.deepEqual([sixth.status, sixth.json], [429, { error: 'busy' }]);
  assert.equal((await api.post(good(), { ip: '198.51.100.8' })).status, 200, 'another visitor is not affected');
  // Invalid requests and repeats do not use up the limit.
  const api2 = await start();
  const body = good();
  for (let i = 0; i < 8; i++) assert.equal((await api2.post(body, { ip: '198.51.100.9' })).status, 200);
  for (let i = 0; i < 8; i++) assert.equal((await api2.post(good({ email: 'x' }), { ip: '198.51.100.9' })).status, 400);
  for (let i = 0; i < 4; i++) assert.equal((await api2.post(good(), { ip: '198.51.100.9' })).status, 200);
  assert.equal((await api2.post(good(), { ip: '198.51.100.9' })).status, 429);
  api2.clock.now += 3600e3 + 1;
  assert.equal((await api2.post(good(), { ip: '198.51.100.9' })).status, 200, 'an hour later it is fine again');
  await Promise.all([api.close(), api2.close()]);
});

test('daily cap for the whole site', async () => {
  const api = await start({ app: { dailyCap: 3 } });
  for (let i = 0; i < 3; i++) assert.equal((await api.post(good(), { ip: `192.0.2.${i}` })).status, 200);
  const res = await api.post(good(), { ip: '192.0.2.99' });
  assert.deepEqual([res.status, res.json], [429, { error: 'busy' }]);
  assert.ok(api.logs.includes('api 429 daily-cap'));
  // The cap is per day in Copenhagen: at midnight there (22:00 UTC in summer time) it starts again.
  api.clock.now = Date.parse('2026-10-17T22:00:01Z');
  assert.equal((await api.post(good({ date: '2026-10-20' }), { ip: '192.0.2.99' })).status, 200);
  await api.close();
});

test('without an API key: 503, so the page falls back to the visitor\'s mail program', async () => {
  const api = await start({ unconfigured: true });
  const res = await api.post(good());
  assert.deepEqual([res.status, res.json], [503, { error: 'unavailable' }]);
  const health = await api.request({ method: 'GET', path: '/api/health' });
  assert.equal(health.json.configured, false);
  await api.close();
});

test('size, type, method and path', async () => {
  const api = await start();
  const big = good({ note: 'x'.repeat(MAX_BODY) });
  const res = await api.post(big);
  assert.equal(res.status, 413, 'a body over 8 KB');
  const chunked = await api.request({ body: JSON.stringify(big), headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } });
  assert.equal(chunked.status, 413, 'also without a Content-Length');
  assert.equal((await api.post(JSON.stringify(good()), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await api.post(JSON.stringify(good()), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await api.post(JSON.stringify(good()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status, 200);
  const get = await api.request({ method: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.headers.allow, 'POST');
  assert.equal((await api.request({ path: '/api/other', body: '{}' })).status, 404);
  assert.equal((await api.request({ path: '/api/request/../health', body: '{}' })).status, 404);
  assert.equal(api.sent.length, 2);
  await api.close();
});

test('the logs hold no personal data, only status and outcome', async () => {
  const api = await start({ transport: fakeTransport((e, k, i) => (i === 2 ? { ok: false, status: 422, name: 'validation_error' } : { ok: true, status: 200 })) });
  const body = good({ name: 'Unique Name Xq', phone: '99887766', street: 'Hemmeligvej 7', email: 'private.person@example.dk', note: 'secret note' });
  await api.post(body, { ip: '203.0.113.77' });
  await api.post(body, { ip: '203.0.113.77' });
  await api.post(good({ email: 'private.person@example' }), { ip: '203.0.113.77' });
  await api.post(good({ website: 'spam' }), { ip: '203.0.113.77' });
  await api.post('{"broken": "Unique Name Xq', { ip: '203.0.113.77' });
  const all = api.logs.join('\n');
  for (const secret of ['Unique Name', '99887766', 'Hemmeligvej', 'private.person', 'secret note', '203.0.113.77', body.id]) {
    assert.ok(!all.includes(secret), `"${secret}" is not logged`);
  }
  assert.ok(api.logs.every((l) => /^api \d{3} [a-z0-9_:= -]+$/.test(l)), all);
  // The rate limiter keeps no IP address as it is.
  const limiter = new WindowLimiter({ limit: 5, windowMs: 1000 });
  limiter.hit('203.0.113.77');
  assert.ok(![...limiter.hits.keys()].some((k) => k.includes('203.0.113')));
  assert.notEqual(limiter.key('203.0.113.77'), new WindowLimiter({ limit: 5, windowMs: 1000 }).key('203.0.113.77'), 'a new secret on every start');
  await api.close();
});

test('the limits on their own: window, day, memory of ids', () => {
  let t = 0;
  const w = new WindowLimiter({ limit: 2, windowMs: 100, now: () => t });
  assert.deepEqual([w.hit('a'), w.hit('a'), w.hit('a'), w.hit('b')], [true, true, false, true]);
  t = 101;
  assert.equal(w.hit('a'), true);
  w.sweep(t + 200);
  assert.equal(w.size, 0, 'old visitors are forgotten');
  let day = '2026-10-17';
  const cap = new DailyCap({ limit: 1, day: () => day });
  assert.deepEqual([cap.take(), cap.take()], [true, false]);
  day = '2026-10-18';
  assert.equal(cap.take(), true);
  let now = 0;
  const ids = new IdempotencyCache({ ttlMs: 10, max: 2, now: () => now });
  ids.set('a', 1); ids.set('b', 2); ids.set('c', 3);
  assert.deepEqual([ids.get('a'), ids.get('b'), ids.get('c')], [null, 2, 3], 'the oldest goes when it is full');
  now = 11;
  assert.equal(ids.get('b'), null, 'and every id after 24 hours');
});

test('Resend: the API call', async () => {
  const calls = [];
  const fakeFetch = (answers) => async (url, init) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json' } });
  };
  const email = { from: 'The Neighbor <booking@theneighbor.dk>', to: ['a@example.dk'], reply_to: 'b@example.dk', subject: 'S', text: 'T' };

  let send = resendTransport({ apiKey: 're_test_123', fetch: fakeFetch([{ status: 200, body: { id: 'e1' } }]), retryDelayMs: 1 });
  assert.deepEqual(await send(email, 'req-1-owner'), { ok: true, status: 200, name: '' });
  assert.equal(calls[0].url, RESEND_URL);
  assert.equal(RESEND_URL, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_123');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'req-1-owner');
  assert.deepEqual(JSON.parse(calls[0].init.body), email);
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'with a timeout');

  // A validation error is not retried, and its message (which can quote an address) is not kept.
  calls.length = 0;
  send = resendTransport({ apiKey: 'k', fetch: fakeFetch([{ status: 422, body: { statusCode: 422, name: 'validation_error', message: 'Invalid `to`: a@example.dk' } }]), retryDelayMs: 1 });
  const r = await send(email, 'req-2-owner');
  assert.deepEqual(r, { ok: false, status: 422, name: 'validation_error' });
  assert.equal(calls.length, 1);

  // A server error or a network error is tried once more, with the same idempotency key.
  calls.length = 0;
  send = resendTransport({ apiKey: 'k', fetch: fakeFetch([{ status: 500, body: { name: 'internal_server_error' } }, { status: 200, body: { id: 'e2' } }]), retryDelayMs: 1 });
  assert.equal((await send(email, 'req-3-owner')).ok, true);
  assert.deepEqual(calls.map((c) => c.init.headers['Idempotency-Key']), ['req-3-owner', 'req-3-owner']);
  calls.length = 0;
  send = resendTransport({ apiKey: 'k', fetch: fakeFetch([new TypeError('fetch failed'), new TypeError('fetch failed')]), retryDelayMs: 1 });
  assert.deepEqual(await send(email, 'req-4-owner'), { ok: false, status: 0, name: 'network' });
  assert.equal(calls.length, 2);
  calls.length = 0;
  send = resendTransport({ apiKey: 'k', fetch: fakeFetch([{ status: 429, body: { name: 'rate_limit_exceeded' } }, { status: 429, body: { name: 'rate_limit_exceeded' } }]), retryDelayMs: 1 });
  assert.deepEqual(await send(email, 'req-5-owner'), { ok: false, status: 429, name: 'rate_limit_exceeded' });
  assert.throws(() => resendTransport({ apiKey: '' }), /API key/);
});

test('the texts: Danish dates and prices, as on the page', () => {
  assert.ok(hasDanishLocale(), 'this Node has the Danish locale data');
  assert.equal(TEXTS.da.fmt.dkk(1234), '1.234 kr.');
  assert.equal(TEXTS.en.fmt.dkk(199), '199 DKK');
  assert.match(TEXTS.da.fmt.date(TUE), /20\. okt\. 2026/);
  assert.equal(TEXTS.da.t('mail.subject', { services: 'X', date: 'D', time: '10:00' }), 'Bookingforespørgsel: X, D kl. 10:00');
  assert.deepEqual(TEXTS.da.bikes, ['By / pendler', 'Racer', 'Mountainbike', 'Elcykel', 'Ladcykel / andet']);
});
