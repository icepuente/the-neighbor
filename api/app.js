// The booking API: POST /api/request sends a booking request by email, to the owner with a copy to
// the customer (api/mail.js), through an email transport (api/resend.js in production, a fake in
// the tests). Nothing is stored and nothing personal is logged: each request logs one line with
// its status and outcome only, e.g. "api 200 sent".
//
// Answers (JSON):
//   200 { ok: true, copy }            sent to the owner; copy says whether the customer's copy went too
//   400 { error: 'invalid', errors }  the page's own checks fail (the page shows the errors)
//   400 { error: 'bad' | 'rejected' } not a request the page would send, or the hidden field is filled
//   413, 415, 405, 404                too big, not JSON, not POST, not this path
//   429 { error: 'busy' }             too many requests from this visitor, or for the day
//   502 { error: 'send' }             the email could not be sent
//   503 { error: 'unavailable' }      no email transport configured (no API key)
// On anything but 200 and 400 'invalid', the page falls back to the visitor's own mail program.
//
// Visitors are told apart by the X-Client-IP header, which nginx sets from Cloudflare's
// CF-Connecting-IP (deploy/nginx/default.conf); the API is reachable only through nginx.
import * as R from '../web/js/booking-rules.js';
import { DailyCap, IdempotencyCache, WindowLimiter } from './limits.js';
import { buildEmails, DEFAULT_FROM } from './mail.js';
import { loadTexts } from './texts.js';
import { parseRequest } from './validate.js';

export const MAX_BODY = 8 * 1024;
const JSON_TYPE = /^application\/json\s*(;|$)/i;

class HttpError extends Error {
  constructor(status, outcome) { super(outcome); Object.assign(this, { status, outcome }); }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > max) { reject(new HttpError(413, 'too-large')); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { req.removeAllListeners('data'); req.resume(); reject(new HttpError(413, 'too-large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new HttpError(400, 'aborted')));
  });
}

export function createApp({
  send = null,
  from = DEFAULT_FROM,
  owner = R.CONFIG.contact.email,
  ipPerHour = 5,
  dailyCap = 40,
  now = () => Date.now(),
  log = (line) => console.log(line),
  texts = loadTexts(),
} = {}) {
  const perIp = new WindowLimiter({ limit: ipPerHour, windowMs: 3600e3, now });
  const daily = new DailyCap({ limit: dailyCap, day: () => R.today(new Date(now())) });
  const seen = new IdempotencyCache({ now });
  const counters = {};
  const count = (outcome) => { const k = outcome.split(' ')[0]; counters[k] = (counters[k] || 0) + 1; };

  function reply(res, status, body, outcome, extra = {}) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    });
    res.end(json);
    if (outcome) { count(outcome); log(`api ${status} ${outcome}`); }
  }

  async function deliver({ id, lang, request, quote }) {
    const emails = buildEmails({ request, quote }, texts[lang], { from, owner });
    const a = await send(emails.owner, `${id}-owner`);
    if (!a.ok) return { status: 502, body: { error: 'send' }, outcome: `owner-failed resend=${a.status}${a.name ? `:${a.name}` : ''}` };
    const b = await send(emails.copy, `${id}-copy`);
    return { status: 200, body: { ok: true, copy: b.ok }, outcome: b.ok ? 'sent' : `sent-no-copy resend=${b.status}${b.name ? `:${b.name}` : ''}` };
  }

  async function handleRequest(req, res) {
    if (req.method !== 'POST') return reply(res, 405, { error: 'method' }, 'method', { Allow: 'POST' });
    if (!send) return reply(res, 503, { error: 'unavailable' }, 'unconfigured');
    if (!JSON_TYPE.test(req.headers['content-type'] || '')) return reply(res, 415, { error: 'type' }, 'type');
    const raw = await readBody(req, MAX_BODY);
    let body;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      return reply(res, 400, { error: 'bad' }, 'bad-json');
    }
    const parsed = parseRequest(body, { texts, todayDate: R.today(new Date(now())) });
    if (!parsed.ok) {
      if (parsed.reason === 'invalid') return reply(res, 400, { error: 'invalid', errors: parsed.errors }, 'invalid');
      if (parsed.reason === 'spam') return reply(res, 400, { error: 'rejected' }, 'honeypot');
      return reply(res, 400, { error: 'bad' }, 'bad');
    }

    // The same request again (a retry, a double click): the first one's answer, nothing sent.
    const earlier = seen.get(parsed.id);
    if (earlier) {
      const r = await earlier;
      return reply(res, r.status, r.body, `duplicate ${r.status}`);
    }

    if (!perIp.hit(req.headers['x-client-ip'] || req.socket.remoteAddress || 'unknown')) return reply(res, 429, { error: 'busy' }, 'ip-limit');
    if (!daily.take()) return reply(res, 429, { error: 'busy' }, 'daily-cap');

    const pending = deliver(parsed);
    seen.set(parsed.id, pending);
    const result = await pending;
    // Only a request that reached the owner is remembered; after a failure the visitor may try again.
    if (result.status === 200) seen.set(parsed.id, result); else seen.delete(parsed.id);
    return reply(res, result.status, result.body, result.outcome);
  }

  async function handle(req, res) {
    try {
      const path = (req.url || '').split('?')[0];
      if (path === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        return reply(res, 200, { ok: true, configured: !!send, counters });
      }
      if (path !== '/api/request') return reply(res, 404, { error: 'not_found' }, 'not-found');
      return await handleRequest(req, res);
    } catch (e) {
      // Error messages are never logged: some (JSON's, for one) quote the input.
      const status = e instanceof HttpError ? e.status : 500;
      const outcome = e instanceof HttpError ? e.outcome : 'error';
      if (!res.headersSent) reply(res, status, { error: status === 413 ? 'too_large' : 'error' }, outcome, { Connection: 'close' });
      else res.destroy();
    }
  }

  return { handle, counters };
}
