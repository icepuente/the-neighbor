// In-memory limits, so the API cannot be used to flood the owner's inbox (or use up the email
// quota): a limit per visitor, a cap per day for the whole site, and a short memory of request ids,
// so a retry or a double click sends nothing twice. All of it is lost on a restart, by design:
// nothing is written anywhere.
import { createHmac, randomBytes } from 'node:crypto';

// At most `limit` hits per key in any `windowMs`. Keys are visitors' IP addresses, which are never
// kept as they are: each is replaced by a keyed hash with a secret that lives only in this process
// (a new one on every start), and dropped once its hits are older than the window.
export class WindowLimiter {
  constructor({ limit, windowMs, now = Date.now }) {
    Object.assign(this, { limit, windowMs, now });
    this.hits = new Map();
    this.secret = randomBytes(32);
    this.calls = 0;
  }
  key(ip) {
    return createHmac('sha256', this.secret).update(String(ip)).digest('base64url').slice(0, 22);
  }
  // Records a hit and returns true, or returns false when the key is over its limit.
  hit(ip) {
    const t = this.now();
    if (++this.calls % 100 === 0) this.sweep(t);
    const k = this.key(ip);
    const recent = (this.hits.get(k) || []).filter((x) => x > t - this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(k, recent); return false; }
    recent.push(t);
    this.hits.set(k, recent);
    return true;
  }
  sweep(t = this.now()) {
    for (const [k, list] of this.hits) if (!list.some((x) => x > t - this.windowMs)) this.hits.delete(k);
  }
  get size() { return this.hits.size; }
}

// At most `limit` per calendar day (`day()` gives today's date, in Copenhagen).
export class DailyCap {
  constructor({ limit, day }) {
    Object.assign(this, { limit, day, today: null, count: 0 });
  }
  take() {
    const d = this.day();
    if (d !== this.today) { this.today = d; this.count = 0; }
    if (this.count >= this.limit) return false;
    this.count++;
    return true;
  }
}

// Request ids seen in the last `ttlMs` (24 hours, as Resend's idempotency keys), with their
// result, or the promise of it while the emails are being sent. Holds no personal data: the id is
// a random string from the browser, the result is { status, body } with no details of the request.
export class IdempotencyCache {
  constructor({ ttlMs = 24 * 3600e3, max = 2000, now = Date.now } = {}) {
    Object.assign(this, { ttlMs, max, now });
    this.items = new Map();
  }
  get(id) {
    const e = this.items.get(id);
    if (!e) return null;
    if (e.at < this.now() - this.ttlMs) { this.items.delete(id); return null; }
    return e.value;
  }
  set(id, value) {
    this.items.delete(id);
    this.items.set(id, { at: this.now(), value });
    // A Map keeps insertion order: the first entries are the oldest.
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value);
  }
  delete(id) { this.items.delete(id); }
}
