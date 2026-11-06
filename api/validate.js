// Checks a booking request posted by the page, as strictly as the page itself and more: the API
// trusts nothing the browser sends. The fields are checked for type, length and characters, then
// the request goes through the page's own rules (web/js/booking-rules.js) and the price is worked
// out again from the services and postcode. Prices the browser might send are never read (the
// request has no price fields, and unknown fields are refused).
import * as R from '../web/js/booking-rules.js';

// The longest value of each text field (the form's maxlength, or the rules' limit).
export const LIMITS = { date: 10, arrival: 5, bike: 40, street: 120, apartment: 20, postcode: 4, name: 80, phone: 30, email: 254, note: R.CONFIG.maxNote };
const FIELDS = new Set(['id', 'lang', 'serviceIds', 'accept', 'website', ...Object.keys(LIMITS)]);
// The browser's request id (crypto.randomUUID()), used as the idempotency key.
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
// Characters no field may hold: control characters (CR and LF included, so nothing typed can start
// a new email header), Unicode line and paragraph separators, and bidirectional overrides (which
// could make a line in the owner's email read differently from what it says). The comment may hold
// line breaks, as LF only.
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const BAD_CHARS_NOTE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// Returns one of
//   { ok: true, id, lang, request, quote }       a request to send
//   { ok: false, reason: 'bad' }                 not what the page sends (a script, or a broken client)
//   { ok: false, reason: 'spam' }                the hidden field is filled in
//   { ok: false, reason: 'invalid', errors }     the page's own checks fail (e.g. the date is now too
//                                                soon): errors are the rules' codes, which the page shows
// `texts` is api/texts.js's loadTexts(); `todayDate` is today in Copenhagen.
export function parseRequest(body, { texts, todayDate }) {
  const bad = { ok: false, reason: 'bad' };
  if (!plainObject(body)) return bad;
  if (Object.keys(body).some((k) => !FIELDS.has(k))) return bad;
  // The honeypot: a field people never see. Anything in it is a robot.
  if (body.website !== undefined && body.website !== '') return typeof body.website === 'string' ? { ok: false, reason: 'spam' } : bad;
  if (typeof body.id !== 'string' || !ID_RE.test(body.id)) return bad;
  if (!Object.hasOwn(texts, body.lang)) return bad;
  const L = texts[body.lang];

  const ids = body.serviceIds;
  if (!Array.isArray(ids) || ids.length > R.SERVICES.length || new Set(ids).size !== ids.length
    || !ids.every((x) => typeof x === 'string' && R.service(x))) return bad;

  const request = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    let v = body[k] ?? '';
    if (typeof v !== 'string') return bad;
    if (k === 'note') v = v.replace(/\r\n?/g, '\n');
    v = v.trim();
    if ((k === 'note' ? BAD_CHARS_NOTE : BAD_CHARS).test(v)) return bad;
    // A comment that is too long is the rules' noteLong; anything else over its limit is not the page.
    if (v.length > (k === 'note' ? max * 2 : max)) return bad;
    request[k] = v;
  }
  request.serviceIds = [...ids];
  if (!L.bikes.includes(request.bike)) return bad;

  const accept = body.accept;
  if (!plainObject(accept) || Object.keys(accept).some((k) => k !== 'terms' && k !== 'earlyStart')) return bad;

  const quote = R.quote(request.serviceIds, { distanceKm: R.estimateKm(request.postcode) });
  const errors = R.checkRequest(request, quote, { todayDate });
  const notAccepted = R.checkAcceptance(accept);
  if (notAccepted) errors.accept = notAccepted;
  if (Object.keys(errors).length) return { ok: false, reason: 'invalid', errors };
  return { ok: true, id: body.id, lang: body.lang, request, quote };
}
